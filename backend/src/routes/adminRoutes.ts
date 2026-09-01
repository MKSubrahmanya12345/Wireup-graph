import { Router } from 'express';
import { z } from 'zod';

import { requireAdmin, requireAuth } from '../auth/authMiddleware.js';
import { getUserStore } from '../auth/userStore.js';
import { getBillingStore } from '../billing/subscriptionStore.js';
import { PLANS } from '../billing/plans.js';
import { env } from '../config/env.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { getPaymentProvider } from '../providers/payment/index.js';
import { getHardwareSimProvider } from '../providers/sim/index.js';

/**
 * Admin API — everything under /api/admin/* is behind requireAuth +
 * requireAdmin. A logged-in non-admin gets 403, an anonymous caller 401.
 */
const router = Router();

router.use('/admin', requireAuth, requireAdmin);

/** GET /api/admin/overview — the numbers the dashboard leads with. */
router.get(
  '/admin/overview',
  asyncHandler(async (_req, res) => {
    const store = getBillingStore();
    const [users, subscriptions, payments, usage] = await Promise.all([
      getUserStore().list(),
      store.listSubscriptions(),
      store.listPayments(),
      store.listUsage(),
    ]);

    const paid = payments.filter((payment) => payment.status === 'paid');
    const refunded = payments.filter((payment) => payment.status === 'refunded');
    const grossPaise = paid.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
    const refundedPaise = refunded.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);

    const revenueByPlan: Record<string, number> = {};
    for (const payment of paid) {
      revenueByPlan[payment.plan] = (revenueByPlan[payment.plan] ?? 0) + (payment.amount ?? 0);
    }

    res.status(200).json({
      users: { total: users.length, admins: users.filter((u) => u.role === 'admin').length },
      subscriptions: {
        total: subscriptions.length,
        active: subscriptions.filter((s) => s.status === 'active').length,
        pending: subscriptions.filter((s) => s.status === 'pending').length,
        failed: subscriptions.filter((s) => s.status === 'failed').length,
      },
      revenue: {
        currency: 'INR',
        grossPaise,
        refundedPaise,
        netPaise: grossPaise - refundedPaise,
        byPlan: revenueByPlan,
        payments: paid.length,
        // Prices are ₹0 placeholders until a human sets them.
        pricingPending: Object.values(PLANS).some((plan) => plan.pricingPending),
      },
      usage: {
        total: usage.length,
        builds: usage.filter((event) => event.kind === 'build').length,
        byLlmProvider: usage.reduce<Record<string, number>>((acc, event) => {
          if (event.llmProvider) acc[event.llmProvider] = (acc[event.llmProvider] ?? 0) + 1;
          return acc;
        }, {}),
      },
      adapters: {
        payment: { mode: getPaymentProvider().mode, detail: getPaymentProvider().describe() },
        sim: { mode: getHardwareSimProvider().mode, detail: getHardwareSimProvider().describe() },
        llm: { gemini: Boolean(env.GEMINI_API_KEY), groq: Boolean(env.GROQ_API_KEY) },
      },
    });
  }),
);

/** GET /api/admin/users */
router.get(
  '/admin/users',
  asyncHandler(async (_req, res) => {
    const users = await getUserStore().list();
    const subs = await getBillingStore().listSubscriptions();
    res.status(200).json({
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        plan: subs.find((sub) => sub.userId === user.id && sub.status === 'active')?.plan ?? 'free',
      })),
    });
  }),
);

const roleSchema = z.object({ role: z.enum(['admin', 'user']) });

/** POST /api/admin/users/:id/role — promote/demote. */
router.post(
  '/admin/users/:id/role',
  asyncHandler(async (req, res) => {
    const parsed = roleSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw ApiError.badRequest('role must be "admin" or "user".');
    const userId = String(req.params.id ?? '');
    const updated = await getUserStore().setRole(userId, parsed.data.role);
    if (!updated) throw ApiError.notFound('No such user.');
    res.status(200).json({ id: updated.id, role: updated.role });
  }),
);

/** GET /api/admin/payments — payments + the subscriptions they belong to. */
router.get(
  '/admin/payments',
  asyncHandler(async (_req, res) => {
    const store = getBillingStore();
    res.status(200).json({
      payments: await store.listPayments(),
      subscriptions: await store.listSubscriptions(),
    });
  }),
);

/** GET /api/admin/usage */
router.get(
  '/admin/usage',
  asyncHandler(async (_req, res) => {
    res.status(200).json({ usage: await getBillingStore().listUsage() });
  }),
);

/** GET /api/admin/webhooks — every inbound event, including duplicates. */
router.get(
  '/admin/webhooks',
  asyncHandler(async (_req, res) => {
    res.status(200).json({ webhooks: await getBillingStore().listWebhooks() });
  }),
);

/** POST /api/admin/refund — provider-agnostic refund. */
router.post(
  '/admin/refund',
  asyncHandler(async (req, res) => {
    const schema = z.object({ externalId: z.string().min(1), amount: z.number().int().optional(), reason: z.string().optional() });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) throw ApiError.badRequest('externalId is required.');
    const result = await getPaymentProvider().refund(parsed.data);
    const store = getBillingStore();
    const subscription = await store.findSubscriptionByExternalId(parsed.data.externalId);
    if (subscription) {
      await store.updateSubscription(subscription.id, { status: 'refunded' });
      await store.recordPayment({
        subscriptionId: subscription.id,
        userId: subscription.userId,
        plan: subscription.plan,
        provider: result.provider,
        externalId: result.externalId,
        eventId: result.refundId,
        amount: result.amount || subscription.amount,
        currency: subscription.currency,
        status: 'refunded',
      });
    }
    res.status(200).json(result);
  }),
);

export default router;
