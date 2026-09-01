import crypto from 'node:crypto';

import { logger } from '../config/logger.js';
import { getPaymentProvider } from '../providers/payment/index.js';
import type { WebhookEvent } from '../providers/payment/types.js';
import { getPlan, type PlanId } from './plans.js';
import { getBillingStore, type Subscription } from './subscriptionStore.js';

/**
 * Billing service — provider-agnostic. Everything here works identically
 * against MockPaymentProvider and RazorpayAdapter.
 */

export interface CheckoutOutcome {
  subscriptionId: string;
  provider: string;
  externalId: string;
  checkoutUrl: string;
  publicKey?: string;
  amount: number;
  currency: string;
  plan: PlanId;
  /** Mock mode settles itself; the UI polls instead of redirecting. */
  selfSettling: boolean;
  pricingPending: boolean;
}

export async function startCheckout(input: {
  userId: string;
  userEmail: string;
  planId: string;
}): Promise<CheckoutOutcome> {
  const plan = getPlan(input.planId);
  const provider = getPaymentProvider();
  const store = getBillingStore();
  const reference = `wu_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;

  const session = await provider.checkout({
    userId: input.userId,
    userEmail: input.userEmail,
    planId: plan.id,
    // ₹0 placeholder prices are still routed through the real code path.
    amount: plan.amountPaise,
    currency: plan.currency,
    reference,
  });

  const subscription = await store.createSubscription({
    userId: input.userId,
    userEmail: input.userEmail,
    plan: plan.id,
    status: 'pending',
    provider: session.provider,
    externalId: session.externalId,
    reference,
    amount: session.amount,
    currency: session.currency,
  });

  logger.info(
    { subscriptionId: subscription.id, provider: session.provider, plan: plan.id },
    'billing: checkout started',
  );

  return {
    subscriptionId: subscription.id,
    provider: session.provider,
    externalId: session.externalId,
    checkoutUrl: session.checkoutUrl,
    publicKey: session.publicKey,
    amount: session.amount,
    currency: session.currency,
    plan: plan.id,
    selfSettling: session.selfSettling,
    pricingPending: plan.pricingPending,
  };
}

export interface WebhookOutcome {
  outcome: 'applied' | 'duplicate' | 'unmatched';
  message: string;
  subscription?: Subscription;
}

/**
 * Apply a verified webhook. Idempotent on the provider event id in BOTH
 * modes: a replayed event is logged as a duplicate and grants nothing.
 */
export async function applyWebhook(event: WebhookEvent): Promise<WebhookOutcome> {
  const store = getBillingStore();

  if (await store.hasWebhookEvent(event.eventId)) {
    await store.logWebhook({
      eventId: event.eventId,
      provider: event.provider,
      type: event.type,
      externalId: event.externalId,
      outcome: 'duplicate',
      message: 'Replayed event id — no state changed, no double grant.',
    });
    logger.warn({ eventId: event.eventId }, 'billing: duplicate webhook ignored');
    return { outcome: 'duplicate', message: 'Event already processed.' };
  }

  const subscription = await store.findSubscriptionByExternalId(event.externalId);
  if (!subscription) {
    await store.logWebhook({
      eventId: event.eventId,
      provider: event.provider,
      type: event.type,
      externalId: event.externalId,
      outcome: 'unmatched',
      message: 'No subscription matches this order id.',
    });
    return { outcome: 'unmatched', message: 'No subscription for this order.' };
  }

  const status: Subscription['status'] =
    event.status === 'paid'
      ? 'active'
      : event.status === 'failed'
        ? 'failed'
        : event.status === 'refunded'
          ? 'refunded'
          : 'pending';

  const updated = (await store.updateSubscription(subscription.id, { status })) ?? subscription;

  await store.recordPayment({
    subscriptionId: subscription.id,
    userId: subscription.userId,
    plan: subscription.plan,
    provider: event.provider,
    externalId: event.externalId,
    eventId: event.eventId,
    amount: event.amount ?? subscription.amount,
    currency: event.currency ?? subscription.currency,
    status: event.status,
  });

  await store.logWebhook({
    eventId: event.eventId,
    provider: event.provider,
    type: event.type,
    externalId: event.externalId,
    outcome: 'applied',
    message: `subscription ${subscription.id} → ${status}`,
  });

  logger.info(
    { subscriptionId: subscription.id, status, eventId: event.eventId },
    'billing: webhook applied',
  );
  return { outcome: 'applied', message: `Subscription ${status}.`, subscription: updated };
}

/** The plan a user is entitled to right now (defaults to free). */
export async function planForUser(userId: string): Promise<PlanId> {
  try {
    const active = await getBillingStore().activeSubscriptionFor(userId);
    return active ? (getPlan(active.plan).id as PlanId) : 'free';
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'billing: plan lookup failed — defaulting to free',
    );
    return 'free';
  }
}
