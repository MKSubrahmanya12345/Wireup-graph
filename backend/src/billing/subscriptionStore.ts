import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import mongoose from 'mongoose';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Billing persistence: subscriptions, payments, the webhook log and per-user
 * usage counters.
 *
 * Same two-backend strategy as the user store, for the same reason: a fresh
 * clone with no MongoDB must still be able to run — and prove — the whole
 * billing loop.
 *   - MongoBillingStore (MONGO_URI set)  → `subscriptions`, `payments`,
 *     `webhookevents`, `usageevents` collections
 *   - FileBillingStore                   → one JSON file (BILLING_DB_PATH)
 */

export type SubscriptionStatus = 'pending' | 'active' | 'failed' | 'refunded' | 'cancelled';

export interface Subscription {
  id: string;
  userId: string;
  userEmail: string;
  plan: string;
  status: SubscriptionStatus;
  /** 'mock' | 'razorpay' */
  provider: string;
  /** Provider-side order/subscription id. */
  externalId: string;
  reference: string;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  subscriptionId: string;
  userId: string;
  plan: string;
  provider: string;
  externalId: string;
  eventId: string;
  amount: number;
  currency: string;
  status: 'paid' | 'failed' | 'refunded' | 'pending';
  createdAt: string;
}

export interface WebhookLogEntry {
  id: string;
  eventId: string;
  provider: string;
  type: string;
  externalId: string;
  /** 'applied' when it changed state, 'duplicate' when replayed, 'rejected'. */
  outcome: 'applied' | 'duplicate' | 'rejected' | 'unmatched';
  message: string;
  receivedAt: string;
}

export interface UsageEvent {
  id: string;
  userId: string;
  userEmail: string;
  kind: string;
  plan: string;
  /** Which LLM provider actually ran for this build. */
  llmProvider?: string;
  detail?: string;
  createdAt: string;
}

export interface BillingStore {
  createSubscription(input: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>): Promise<Subscription>;
  findSubscriptionByExternalId(externalId: string): Promise<Subscription | null>;
  findSubscriptionById(id: string): Promise<Subscription | null>;
  updateSubscription(id: string, patch: Partial<Subscription>): Promise<Subscription | null>;
  listSubscriptions(): Promise<Subscription[]>;
  /** The user's current entitlement: newest active subscription, else null. */
  activeSubscriptionFor(userId: string): Promise<Subscription | null>;

  recordPayment(input: Omit<PaymentRecord, 'id' | 'createdAt'>): Promise<PaymentRecord>;
  listPayments(): Promise<PaymentRecord[]>;

  /** Idempotency: true when this provider event id has already been applied. */
  hasWebhookEvent(eventId: string): Promise<boolean>;
  logWebhook(input: Omit<WebhookLogEntry, 'id' | 'receivedAt'>): Promise<WebhookLogEntry>;
  listWebhooks(): Promise<WebhookLogEntry[]>;

  recordUsage(input: Omit<UsageEvent, 'id' | 'createdAt'>): Promise<UsageEvent>;
  listUsage(): Promise<UsageEvent[]>;
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ── File-backed store ───────────────────────────────────────────────────────

interface FileShape {
  subscriptions: Subscription[];
  payments: PaymentRecord[];
  webhooks: WebhookLogEntry[];
  usage: UsageEvent[];
}

const EMPTY: FileShape = { subscriptions: [], payments: [], webhooks: [], usage: [] };

class FileBillingStore implements BillingStore {
  private file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.file = path.resolve(process.cwd(), filePath);
  }

  private async readAll(): Promise<FileShape> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<FileShape>;
      return {
        subscriptions: parsed.subscriptions ?? [],
        payments: parsed.payments ?? [],
        webhooks: parsed.webhooks ?? [],
        usage: parsed.usage ?? [],
      };
    } catch {
      return { ...EMPTY };
    }
  }

  private async writeAll(data: FileShape): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, this.file);
  }

  /** Serialise mutations — a self-firing webhook can race the checkout call. */
  private withLock<T>(fn: (data: FileShape) => Promise<T> | T): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.readAll();
      const result = await fn(data);
      await this.writeAll(data);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async createSubscription(input: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>): Promise<Subscription> {
    const now = new Date().toISOString();
    const record: Subscription = { id: id('sub'), createdAt: now, updatedAt: now, ...input };
    await this.withLock((data) => {
      data.subscriptions.push(record);
    });
    return record;
  }

  async findSubscriptionByExternalId(externalId: string): Promise<Subscription | null> {
    const data = await this.readAll();
    return data.subscriptions.find((s) => s.externalId === externalId) ?? null;
  }

  async findSubscriptionById(subId: string): Promise<Subscription | null> {
    const data = await this.readAll();
    return data.subscriptions.find((s) => s.id === subId) ?? null;
  }

  updateSubscription(subId: string, patch: Partial<Subscription>): Promise<Subscription | null> {
    return this.withLock((data) => {
      const sub = data.subscriptions.find((s) => s.id === subId);
      if (!sub) return null;
      Object.assign(sub, patch, { updatedAt: new Date().toISOString() });
      return { ...sub };
    });
  }

  async listSubscriptions(): Promise<Subscription[]> {
    const data = await this.readAll();
    return [...data.subscriptions].reverse();
  }

  async activeSubscriptionFor(userId: string): Promise<Subscription | null> {
    const data = await this.readAll();
    return (
      [...data.subscriptions].reverse().find((s) => s.userId === userId && s.status === 'active') ?? null
    );
  }

  async recordPayment(input: Omit<PaymentRecord, 'id' | 'createdAt'>): Promise<PaymentRecord> {
    const record: PaymentRecord = { id: id('pay'), createdAt: new Date().toISOString(), ...input };
    await this.withLock((data) => {
      data.payments.push(record);
    });
    return record;
  }

  async listPayments(): Promise<PaymentRecord[]> {
    const data = await this.readAll();
    return [...data.payments].reverse();
  }

  async hasWebhookEvent(eventId: string): Promise<boolean> {
    const data = await this.readAll();
    return data.webhooks.some((w) => w.eventId === eventId && w.outcome === 'applied');
  }

  async logWebhook(input: Omit<WebhookLogEntry, 'id' | 'receivedAt'>): Promise<WebhookLogEntry> {
    const record: WebhookLogEntry = { id: id('whk'), receivedAt: new Date().toISOString(), ...input };
    await this.withLock((data) => {
      data.webhooks.push(record);
    });
    return record;
  }

  async listWebhooks(): Promise<WebhookLogEntry[]> {
    const data = await this.readAll();
    return [...data.webhooks].reverse();
  }

  async recordUsage(input: Omit<UsageEvent, 'id' | 'createdAt'>): Promise<UsageEvent> {
    const record: UsageEvent = { id: id('use'), createdAt: new Date().toISOString(), ...input };
    await this.withLock((data) => {
      data.usage.push(record);
      // Keep the file bounded — the admin panel only shows recent activity.
      if (data.usage.length > 5000) data.usage.splice(0, data.usage.length - 5000);
    });
    return record;
  }

  async listUsage(): Promise<UsageEvent[]> {
    const data = await this.readAll();
    return [...data.usage].reverse();
  }
}

// ── Mongo-backed store ──────────────────────────────────────────────────────

const subscriptionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, default: '' },
    plan: { type: String, required: true },
    status: { type: String, required: true, default: 'pending' },
    provider: { type: String, required: true },
    externalId: { type: String, required: true, index: true },
    reference: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
  },
  { timestamps: true },
);

const paymentSchema = new mongoose.Schema(
  {
    subscriptionId: String,
    userId: { type: String, index: true },
    plan: String,
    provider: String,
    externalId: String,
    eventId: { type: String, index: true },
    amount: Number,
    currency: String,
    status: String,
  },
  { timestamps: true },
);

const webhookSchema = new mongoose.Schema(
  {
    eventId: { type: String, index: true },
    provider: String,
    type: String,
    externalId: String,
    outcome: String,
    message: String,
  },
  { timestamps: true },
);

const usageSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true },
    userEmail: String,
    kind: String,
    plan: String,
    llmProvider: String,
    detail: String,
  },
  { timestamps: true },
);

/* eslint-disable @typescript-eslint/no-explicit-any */
function model(name: string, schema: mongoose.Schema): mongoose.Model<any> {
  return (mongoose.models[name] as mongoose.Model<any>) ?? mongoose.model<any>(name, schema);
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? new Date().toISOString());
}

class MongoBillingStore implements BillingStore {
  private Sub = model('WireupSubscription', subscriptionSchema);
  private Pay = model('WireupPayment', paymentSchema);
  private Hook = model('WireupWebhookEvent', webhookSchema);
  private Use = model('WireupUsageEvent', usageSchema);

  private toSub(doc: any): Subscription {
    return {
      id: String(doc._id),
      userId: doc.userId,
      userEmail: doc.userEmail ?? '',
      plan: doc.plan,
      status: doc.status,
      provider: doc.provider,
      externalId: doc.externalId,
      reference: doc.reference ?? '',
      amount: doc.amount ?? 0,
      currency: doc.currency ?? 'INR',
      createdAt: iso(doc.createdAt),
      updatedAt: iso(doc.updatedAt),
    };
  }

  async createSubscription(input: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>): Promise<Subscription> {
    return this.toSub(await this.Sub.create(input));
  }

  async findSubscriptionByExternalId(externalId: string): Promise<Subscription | null> {
    const doc = await this.Sub.findOne({ externalId }).lean();
    return doc ? this.toSub(doc) : null;
  }

  async findSubscriptionById(subId: string): Promise<Subscription | null> {
    if (!mongoose.isValidObjectId(subId)) return null;
    const doc = await this.Sub.findById(subId).lean();
    return doc ? this.toSub(doc) : null;
  }

  async updateSubscription(subId: string, patch: Partial<Subscription>): Promise<Subscription | null> {
    if (!mongoose.isValidObjectId(subId)) return null;
    const doc = await this.Sub.findByIdAndUpdate(subId, patch, { new: true }).lean();
    return doc ? this.toSub(doc) : null;
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return (await this.Sub.find().sort({ createdAt: -1 }).lean()).map((d: any) => this.toSub(d));
  }

  async activeSubscriptionFor(userId: string): Promise<Subscription | null> {
    const doc = await this.Sub.findOne({ userId, status: 'active' }).sort({ createdAt: -1 }).lean();
    return doc ? this.toSub(doc) : null;
  }

  async recordPayment(input: Omit<PaymentRecord, 'id' | 'createdAt'>): Promise<PaymentRecord> {
    const doc: any = await this.Pay.create(input);
    return { id: String(doc._id), createdAt: iso(doc.createdAt), ...input };
  }

  async listPayments(): Promise<PaymentRecord[]> {
    return (await this.Pay.find().sort({ createdAt: -1 }).lean()).map((d: any) => ({
      id: String(d._id),
      subscriptionId: d.subscriptionId,
      userId: d.userId,
      plan: d.plan,
      provider: d.provider,
      externalId: d.externalId,
      eventId: d.eventId,
      amount: d.amount,
      currency: d.currency,
      status: d.status,
      createdAt: iso(d.createdAt),
    }));
  }

  async hasWebhookEvent(eventId: string): Promise<boolean> {
    return Boolean(await this.Hook.exists({ eventId, outcome: 'applied' }));
  }

  async logWebhook(input: Omit<WebhookLogEntry, 'id' | 'receivedAt'>): Promise<WebhookLogEntry> {
    const doc: any = await this.Hook.create(input);
    return { id: String(doc._id), receivedAt: iso(doc.createdAt), ...input };
  }

  async listWebhooks(): Promise<WebhookLogEntry[]> {
    return (await this.Hook.find().sort({ createdAt: -1 }).limit(500).lean()).map((d: any) => ({
      id: String(d._id),
      eventId: d.eventId,
      provider: d.provider,
      type: d.type,
      externalId: d.externalId,
      outcome: d.outcome,
      message: d.message,
      receivedAt: iso(d.createdAt),
    }));
  }

  async recordUsage(input: Omit<UsageEvent, 'id' | 'createdAt'>): Promise<UsageEvent> {
    const doc: any = await this.Use.create(input);
    return { id: String(doc._id), createdAt: iso(doc.createdAt), ...input };
  }

  async listUsage(): Promise<UsageEvent[]> {
    return (await this.Use.find().sort({ createdAt: -1 }).limit(1000).lean()).map((d: any) => ({
      id: String(d._id),
      userId: d.userId,
      userEmail: d.userEmail,
      kind: d.kind,
      plan: d.plan,
      llmProvider: d.llmProvider,
      detail: d.detail,
      createdAt: iso(d.createdAt),
    }));
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Selection ───────────────────────────────────────────────────────────────

let cached: BillingStore | null = null;

export function getBillingStore(): BillingStore {
  if (cached) return cached;
  if (env.MONGO_URI && mongoose.connection.readyState === 1) {
    cached = new MongoBillingStore();
    logger.info('Wireup billing: using MongoDB store');
  } else {
    cached = new FileBillingStore(env.BILLING_DB_PATH);
    logger.info({ path: env.BILLING_DB_PATH }, 'Wireup billing: using file store (no MONGO_URI)');
  }
  return cached;
}

export function resetBillingStoreForTests(): void {
  cached = null;
}
