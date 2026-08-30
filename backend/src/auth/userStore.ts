import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import mongoose from 'mongoose';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Wireup user persistence.
 *
 * Two interchangeable backends so the app is shippable in every environment:
 *  - MongoUserStore  — when MONGO_URI is configured (production).
 *  - FileUserStore   — zero-dependency JSON file, so a fresh clone with no
 *    database still has fully working authentication.
 */

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  /** bcrypt hash — never the raw password. */
  passwordHash: string;
  createdAt: string;
}

export interface UserStore {
  findByEmail(email: string): Promise<StoredUser | null>;
  findById(id: string): Promise<StoredUser | null>;
  create(input: { name: string; email: string; passwordHash: string }): Promise<StoredUser>;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── Mongo-backed store ──────────────────────────────────────────────────────

const userMongoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

interface WireupUserDoc {
  name: string;
  email: string;
  passwordHash: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Unique index races: E11000 is mapped to a friendly error by the service.
const MongoUser: mongoose.Model<WireupUserDoc> =
  (mongoose.models.WireupUser as mongoose.Model<WireupUserDoc> | undefined) ??
  mongoose.model<WireupUserDoc>('WireupUser', userMongoSchema);

class MongoUserStore implements UserStore {
  async findByEmail(email: string): Promise<StoredUser | null> {
    const doc = await MongoUser.findOne({ email: normaliseEmail(email) }).lean();
    return doc ? toStored(doc) : null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await MongoUser.findById(id).lean();
    return doc ? toStored(doc) : null;
  }

  async create(input: { name: string; email: string; passwordHash: string }): Promise<StoredUser> {
    const doc = await MongoUser.create({ name: input.name, email: normaliseEmail(input.email), passwordHash: input.passwordHash });
    return toStored(doc);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStored(doc: any): StoredUser {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    passwordHash: doc.passwordHash,
    createdAt: (doc.createdAt ?? new Date()).toISOString?.() ?? String(doc.createdAt),
  };
}

// ── File-backed store ───────────────────────────────────────────────────────

interface FileShape {
  users: StoredUser[];
}

class FileUserStore implements UserStore {
  private file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.file = path.resolve(process.cwd(), filePath);
  }

  private async readAll(): Promise<FileShape> {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as FileShape;
      if (!Array.isArray(parsed.users)) return { users: [] };
      return parsed;
    } catch {
      return { users: [] };
    }
  }

  private async writeAll(data: FileShape): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    // Atomic-ish write: temp file + rename so a crash never leaves half JSON.
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, this.file);
  }

  /** Serialise mutations so concurrent signups never interleave writes. */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    const data = await this.readAll();
    const needle = normaliseEmail(email);
    return data.users.find((user) => user.email === needle) ?? null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    const data = await this.readAll();
    return data.users.find((user) => user.id === id) ?? null;
  }

  create(input: { name: string; email: string; passwordHash: string }): Promise<StoredUser> {
    return this.withLock(async () => {
      const data = await this.readAll();
      const email = normaliseEmail(input.email);
      if (data.users.some((user) => user.email === email)) {
        const error = new Error('Email already registered');
        (error as Error & { code?: string }).code = 'EMAIL_TAKEN';
        throw error;
      }
      const user: StoredUser = {
        id: `wu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        name: input.name.trim(),
        email,
        passwordHash: input.passwordHash,
        createdAt: new Date().toISOString(),
      };
      data.users.push(user);
      await this.writeAll(data);
      return user;
    });
  }
}

// ── Selection ───────────────────────────────────────────────────────────────

let cached: UserStore | null = null;

export function getUserStore(): UserStore {
  if (cached) return cached;
  if (env.MONGO_URI && mongoose.connection.readyState === 1) {
    cached = new MongoUserStore();
    logger.info('Wireup auth: using MongoDB user store');
  } else {
    cached = new FileUserStore(env.AUTH_DB_PATH);
    logger.info({ path: env.AUTH_DB_PATH }, 'Wireup auth: using file user store (no MONGO_URI)');
  }
  return cached;
}

/** Test hook — reset the cached store (and pick the backend up fresh). */
export function resetUserStoreForTests(): void {
  cached = null;
}
