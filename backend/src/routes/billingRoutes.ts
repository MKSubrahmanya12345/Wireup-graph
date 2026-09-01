import { Router, type Request } from 'express';
import { z } from 'zod';

import { requireAuth } from '../auth/authMiddleware.js';
import { applyWebhook, planForUser, startCheckout } from '../billing/billingService.js';
import { listPlans, PLANS } from '../billing/plans.js';
import { getBillingStore } from '../billing/subscriptionStore.js';
import { logger } from '../config/logger.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { getPaymentProvider } from '../providers/payment/index.js';
import { PaymentSignatureError } from '../providers/payment/types.js';

const router = Router();

/** GET /api/billing/plans — public: what can be bought, and for how much. */
router.get(
  '/billing/plans',
  asyncHandler(async (_req, res) => {
    res.status(200).json({
      plans: listPlans(),
      provider: getPaymentProvider().mode,
      // Honest about the placeholder: the UI shows a "pricing pending" badge.
      pricingPending: listPlans().some((plan) => plan.pricingPending),
    });
  }),
);

/**
 * POST /api/billing/webhook — provider callback.
 *
 * Mounted BEFORE requireAuth: the payment provider has no Wireup session.
 * Real mode verifies the HMAC signature; mock mode accepts the body as-is.
 * Both are idempotent on the provider event id.
 */
router.post(
  '/billing/webhook',
  asyncHandler(async (req: Request, res) => {
    const provider = getPaymentProvider();
    const raw =
      (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }

    let event;
    try {
      event = provider.verifyWebhook(raw, headers);
    } catch (error) {
      if (error instanceof PaymentSignatureError) {
        await getBillingStore().logWebhook({
          eventId: `rejected_${Date.now()}`,
          provider: provider.mode,
          type: 'unknown',
          externalId: 'unknown',
          outcome: 'rejected',
          message: error.message,
        });
        logger.warn({ err: error.message }, 'billing: webhook rejected');
        throw ApiError.badRequest(error.message);
      }
      throw error;
    }

    const outcome = await applyWebhook(event);
    res.status(200).json({ received: true, ...outcome });
  }),
);

// ── Everything below needs a Wireup session (per-route requireAuth) ────────

const checkoutSchema = z.object({
  plan: z.string().trim().min(1).default('pro'),
});

/** POST /api/billing/checkout — routes to mock or real per PAYMENT_MODE. */
router.post(
  '/billing/checkout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw ApiError.badRequest('Pick a plan to check out.');
    const planId = parsed.data.plan;
    if (!(planId in PLANS)) throw ApiError.badRequest(`Unknown plan "${planId}".`);
    if (planId === 'free') throw ApiError.badRequest('The free plan needs no checkout.');

    const user = req.user!;
    if (user.guest) {
      throw new ApiError(403, 'Create an account before subscribing — guest sessions cannot be billed.');
    }

    const outcome = await startCheckout({
      userId: user.sub,
      userEmail: user.email,
      planId,
    });
    res.status(201).json(outcome);
  }),
);

/** GET /api/billing/subscription — the caller's current entitlement. */
router.get(
  '/billing/subscription',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const plan = await planForUser(user.sub);
    const store = getBillingStore();
    const all = await store.listSubscriptions();
    res.status(200).json({
      plan,
      provider: getPaymentProvider().mode,
      subscriptions: all.filter((sub) => sub.userId === user.sub),
    });
  }),
);

export default router;
