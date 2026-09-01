import crypto from 'node:crypto';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  PaymentSignatureError,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
  type RefundRequest,
  type RefundResult,
  type WebhookEvent,
} from './types.js';

/**
 * RazorpayAdapter — the real payment backend, behind the same interface as
 * the mock. Selected only when RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are set
 * (or PAYMENT_MODE=razorpay is forced).
 *
 * Uses the Razorpay Orders REST API directly over fetch — no SDK dependency,
 * so a missing package can never break the build.
 *   POST /v1/orders            → create an order
 *   POST /v1/payments/:id/refund
 *   webhook: X-Razorpay-Signature = HMAC-SHA256(body, RAZORPAY_WEBHOOK_SECRET)
 */
const RAZORPAY_API = 'https://api.razorpay.com/v1';

export class RazorpayAdapter implements PaymentProvider {
  readonly mode = 'razorpay' as const;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string | undefined,
  ) {}

  describe(): string {
    return `RazorpayAdapter (live orders API, key ${this.keyId.slice(0, 8)}…${this.webhookSecret ? '' : ' — WARNING: no RAZORPAY_WEBHOOK_SECRET, webhooks will be rejected'})`;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  async checkout(input: CheckoutRequest): Promise<CheckoutSession> {
    const response = await fetch(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        receipt: input.reference,
        // Notes come back on the webhook — this is how we map an event to a
        // user/plan without trusting anything client-side.
        notes: {
          wireup_user_id: input.userId,
          wireup_plan_id: input.planId,
          wireup_reference: input.reference,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Razorpay order creation failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const order = (await response.json()) as { id: string; amount: number; currency: string };
    logger.info({ orderId: order.id, planId: input.planId }, 'razorpay: order created');

    return {
      provider: 'razorpay',
      externalId: order.id,
      // Razorpay is a browser-side widget: the frontend opens Checkout with
      // this order id + the public key. The URL is the hosted fallback.
      checkoutUrl: `https://api.razorpay.com/v1/checkout/embedded?order_id=${order.id}`,
      amount: order.amount,
      currency: order.currency,
      publicKey: this.keyId,
      selfSettling: false,
    };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent {
    const signature = headers['x-razorpay-signature'];
    if (!this.webhookSecret) {
      throw new PaymentSignatureError(
        'RAZORPAY_WEBHOOK_SECRET is not configured — refusing to trust an unsigned webhook.',
      );
    }
    if (!signature) throw new PaymentSignatureError('Missing X-Razorpay-Signature header.');

    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new PaymentSignatureError('Razorpay webhook signature mismatch.');
    }

    const body = JSON.parse(rawBody) as {
      event?: string;
      // Razorpay does not put the event id in the body; it is a header.
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            amount?: number;
            currency?: string;
            status?: string;
            notes?: Record<string, string>;
          };
        };
        refund?: { entity?: { id?: string; payment_id?: string; amount?: number } };
      };
    };

    const payment = body.payload?.payment?.entity;
    const notes = payment?.notes ?? {};
    const type = body.event ?? 'payment.captured';

    return {
      provider: 'razorpay',
      eventId: headers['x-razorpay-event-id'] ?? `${type}:${payment?.id ?? crypto.randomUUID()}`,
      type,
      externalId: payment?.order_id ?? body.payload?.refund?.entity?.payment_id ?? 'unknown',
      reference: notes.wireup_reference,
      userId: notes.wireup_user_id,
      planId: notes.wireup_plan_id,
      amount: payment?.amount,
      currency: payment?.currency,
      status:
        type.startsWith('refund')
          ? 'refunded'
          : type === 'payment.failed'
            ? 'failed'
            : payment?.status === 'captured' || type === 'payment.captured'
              ? 'paid'
              : 'pending',
      raw: body,
    };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    const response = await fetch(`${RAZORPAY_API}/payments/${input.externalId}/refund`, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(input.amount ? { amount: input.amount } : {}),
        notes: { reason: input.reason ?? 'wireup admin refund' },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Razorpay refund failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    const refund = (await response.json()) as { id: string; amount: number; status: string };
    return {
      provider: 'razorpay',
      refundId: refund.id,
      externalId: input.externalId,
      amount: refund.amount,
      status: refund.status === 'processed' ? 'processed' : refund.status === 'failed' ? 'failed' : 'pending',
    };
  }
}

/** Exported for the boot banner / env plumbing. */
export function razorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}
