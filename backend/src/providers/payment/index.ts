import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { MockPaymentProvider } from './mockPaymentProvider.js';
import { RazorpayAdapter, razorpayConfigured } from './razorpayAdapter.js';
import type { PaymentProvider } from './types.js';

/**
 * Env-driven adapter selection.
 *
 *   PAYMENT_MODE=mock      → always the mock
 *   PAYMENT_MODE=razorpay  → real adapter; falls back to mock (loudly) if the
 *                            keys are missing, so the app still boots
 *   PAYMENT_MODE=auto      → razorpay when keys are present, mock otherwise
 */
let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const wantsReal =
    env.PAYMENT_MODE === 'razorpay' || (env.PAYMENT_MODE === 'auto' && razorpayConfigured());

  if (wantsReal && razorpayConfigured()) {
    cached = new RazorpayAdapter(
      env.RAZORPAY_KEY_ID!,
      env.RAZORPAY_KEY_SECRET!,
      env.RAZORPAY_WEBHOOK_SECRET,
    );
  } else {
    if (wantsReal) {
      logger.warn(
        'PAYMENT_MODE=razorpay but RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are missing — falling back to MockPaymentProvider.',
      );
    }
    cached = new MockPaymentProvider();
  }
  return cached;
}

/** Test hook. */
export function resetPaymentProviderForTests(): void {
  cached = null;
}

export * from './types.js';
export { MockPaymentProvider } from './mockPaymentProvider.js';
export { RazorpayAdapter } from './razorpayAdapter.js';
