import crypto from 'node:crypto';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  RefundRequest,
  RefundResult,
  WebhookEvent,
} from './types.js';

/**
 * MockPaymentProvider — a complete, deterministic payment backend.
 *
 * checkout()      → returns a fake hosted-checkout URL and, after
 *                   MOCK_PAYMENT_DELAY_MS, POSTs a `payment.captured` webhook
 *                   at our own /api/billing/webhook. The full loop
 *                   (checkout → webhook → plan upgrade) therefore runs with
 *                   zero credentials.
 * verifyWebhook() → accepts the body as-is (no signature exists) but returns
 *                   the same normalised shape as the real adapter, including
 *                   a stable event id so replay protection is exercised.
 * refund()        → always succeeds, deterministically.
 *
 * Failure paths are testable too: a reference containing 'fail' produces a
 * `payment.failed` event instead of a capture.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly mode = 'mock' as const;

  /** Test hook: set to intercept the self-fired webhook instead of HTTP. */
  static onSelfWebhook: ((event: WebhookEvent) => void | Promise<void>) | null = null;

  describe(): string {
    return 'MockPaymentProvider (deterministic; checkout self-fires its webhook)';
  }

  async checkout(input: CheckoutRequest): Promise<CheckoutSession> {
    const externalId = `mock_ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const shouldFail = /fail/i.test(input.reference) || /fail/i.test(input.planId);

    const session: CheckoutSession = {
      provider: 'mock',
      externalId,
      checkoutUrl: `${env.APP_BASE_URL}/billing/mock-checkout?order=${externalId}&ref=${encodeURIComponent(input.reference)}`,
      amount: input.amount,
      currency: input.currency,
      selfSettling: true,
    };

    const event: WebhookEvent = {
      provider: 'mock',
      eventId: `mock_evt_${externalId}`,
      type: shouldFail ? 'payment.failed' : 'payment.captured',
      externalId,
      reference: input.reference,
      userId: input.userId,
      planId: input.planId,
      amount: input.amount,
      currency: input.currency,
      status: shouldFail ? 'failed' : 'paid',
      raw: { mock: true, ...input, externalId },
    };

    // Self-fire after a delay so the client sees a realistic "pending → paid"
    // transition rather than an instantaneous, unrealistic upgrade.
    setTimeout(() => {
      void this.fire(event);
    }, env.MOCK_PAYMENT_DELAY_MS).unref?.();

    logger.info(
      { externalId, planId: input.planId, delayMs: env.MOCK_PAYMENT_DELAY_MS },
      'mock payment: checkout created, webhook scheduled',
    );
    return session;
  }

  private async fire(event: WebhookEvent): Promise<void> {
    try {
      if (MockPaymentProvider.onSelfWebhook) {
        await MockPaymentProvider.onSelfWebhook(event);
        return;
      }
      const response = await fetch(`${env.APP_BASE_URL}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wireup-mock-webhook': '1' },
        body: JSON.stringify(event),
      });
      logger.info(
        { eventId: event.eventId, status: response.status },
        'mock payment: self-fired webhook delivered',
      );
    } catch (error) {
      // Never crash the process because a mock callback could not be delivered.
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), eventId: event.eventId },
        'mock payment: could not deliver self-fired webhook (is APP_BASE_URL correct?)',
      );
    }
  }

  verifyWebhook(rawBody: string, _headers: Record<string, string | undefined>): WebhookEvent {
    const body = JSON.parse(rawBody) as Partial<WebhookEvent> & Record<string, unknown>;
    const externalId = String(body.externalId ?? body.order_id ?? 'mock_ord_unknown');
    return {
      provider: 'mock',
      eventId: String(body.eventId ?? `mock_evt_${externalId}`),
      type: String(body.type ?? 'payment.captured'),
      externalId,
      reference: body.reference ? String(body.reference) : undefined,
      userId: body.userId ? String(body.userId) : undefined,
      planId: body.planId ? String(body.planId) : undefined,
      amount: typeof body.amount === 'number' ? body.amount : undefined,
      currency: body.currency ? String(body.currency) : undefined,
      status:
        body.status === 'failed' || body.status === 'refunded' || body.status === 'pending'
          ? body.status
          : 'paid',
      raw: body,
    };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    logger.info({ externalId: input.externalId }, 'mock payment: refund processed');
    return {
      provider: 'mock',
      refundId: `mock_rfnd_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
      externalId: input.externalId,
      amount: input.amount ?? 0,
      status: 'processed',
    };
  }
}
