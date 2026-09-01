/**
 * PaymentProvider — the single interface every payment backend implements.
 *
 * Two implementations ship in the repo:
 *   - MockPaymentProvider  (deterministic; the fake checkout self-fires its
 *     own webhook after a short delay, so the whole billing loop is provable
 *     with zero credentials)
 *   - RazorpayAdapter      (real; used only when RAZORPAY_KEY_ID is present)
 *
 * Going live is an env-var change (PAYMENT_MODE=razorpay + keys), not a
 * rewrite: nothing above this interface knows which side is active.
 */

export type PaymentMode = 'mock' | 'razorpay';

export interface CheckoutRequest {
  /** Wireup user the subscription belongs to. */
  userId: string;
  userEmail: string;
  /** Plan id from billing/plans.ts, e.g. 'pro'. */
  planId: string;
  /** Amount in the smallest currency unit (paise for INR). */
  amount: number;
  currency: string;
  /** Our own idempotent handle for this attempt. */
  reference: string;
}

export interface CheckoutSession {
  provider: PaymentMode;
  /** Provider-side order/session id (Razorpay order_id, or mock_ord_*). */
  externalId: string;
  /** Where the browser should send the user to pay. */
  checkoutUrl: string;
  amount: number;
  currency: string;
  /** Public key the browser checkout widget needs (real mode only). */
  publicKey?: string;
  /** True when this session settles itself without a human (mock only). */
  selfSettling: boolean;
}

/** Normalised webhook, whatever the provider's wire format was. */
export interface WebhookEvent {
  provider: PaymentMode;
  /** Provider event id — the idempotency key. Never trust the body twice. */
  eventId: string;
  /** e.g. 'payment.captured', 'payment.failed', 'refund.processed'. */
  type: string;
  /** The order/subscription id this event belongs to. */
  externalId: string;
  /** Our reference echoed back through provider notes/metadata. */
  reference?: string;
  userId?: string;
  planId?: string;
  amount?: number;
  currency?: string;
  status: 'paid' | 'failed' | 'refunded' | 'pending';
  raw: unknown;
}

export interface RefundRequest {
  externalId: string;
  /** Omit for a full refund. */
  amount?: number;
  reason?: string;
}

export interface RefundResult {
  provider: PaymentMode;
  refundId: string;
  externalId: string;
  amount: number;
  status: 'processed' | 'pending' | 'failed';
}

export interface PaymentProvider {
  readonly mode: PaymentMode;
  /** Human-readable one-liner for the boot banner. */
  describe(): string;
  /** Create a payment session the browser can be sent to. */
  checkout(input: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Verify + normalise an inbound webhook.
   * Real mode: HMAC signature check, throws on mismatch.
   * Mock mode: accepted as-is (still normalised, still idempotent upstream).
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent;
  refund(input: RefundRequest): Promise<RefundResult>;
}

/** Signature/verification failure — the route turns this into a 400. */
export class PaymentSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentSignatureError';
  }
}
