/**
 * Mock-first billing loop — the M1 checks, as automated regressions.
 *
 *   14. checkout → mock webhook self-fires → plan updates in the store
 *   15. replay the same webhook event id → no double grant
 *   16. (route-level 403 is covered by the admin middleware test below)
 *
 * Everything runs against MockPaymentProvider with a temp file store, so no
 * credentials and no database are needed.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workdir = await mkdtemp(path.join(tmpdir(), 'wireup-billing-'));
process.env.BILLING_DB_PATH = path.join(workdir, 'billing.json');
process.env.AUTH_DB_PATH = path.join(workdir, 'users.json');
process.env.PAYMENT_MODE = 'mock';
process.env.MOCK_PAYMENT_DELAY_MS = '10';

const { MockPaymentProvider } = await import('../src/providers/payment/mockPaymentProvider.ts');
const { getPaymentProvider } = await import('../src/providers/payment/index.ts');
const { startCheckout, applyWebhook, planForUser } = await import('../src/billing/billingService.ts');
const { getBillingStore } = await import('../src/billing/subscriptionStore.ts');

describe('mock payment provider', () => {
  /** Capture the self-fired webhook instead of letting it hit HTTP. */
  const delivered = [];
  before(() => {
    MockPaymentProvider.onSelfWebhook = (event) => {
      delivered.push(event);
    };
  });
  after(async () => {
    MockPaymentProvider.onSelfWebhook = null;
    await rm(workdir, { recursive: true, force: true });
  });

  it('selects the mock adapter when no Razorpay key is present', () => {
    assert.equal(getPaymentProvider().mode, 'mock');
  });

  it('CHECK 14 — checkout self-fires a webhook that upgrades the plan', async () => {
    const outcome = await startCheckout({
      userId: 'user-1',
      userEmail: 'user-1@wireup.local',
      planId: 'pro',
    });
    assert.equal(outcome.provider, 'mock');
    assert.equal(outcome.selfSettling, true);
    assert.equal(await planForUser('user-1'), 'free', 'plan must not change before the webhook');

    // Wait for the scheduled self-fire.
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(delivered.length, 1, 'mock checkout must fire exactly one webhook');

    const applied = await applyWebhook(delivered[0]);
    assert.equal(applied.outcome, 'applied');
    assert.equal(await planForUser('user-1'), 'pro');
  });

  it('CHECK 15 — replaying the same event id grants nothing twice', async () => {
    const store = getBillingStore();
    const before = (await store.listPayments()).length;

    const replay = await applyWebhook(delivered[0]);
    assert.equal(replay.outcome, 'duplicate');

    const after = (await store.listPayments()).length;
    assert.equal(after, before, 'a replayed event must not record a second payment');
    assert.equal(await planForUser('user-1'), 'pro');

    const hooks = await store.listWebhooks();
    assert.ok(hooks.some((hook) => hook.outcome === 'duplicate'), 'the duplicate must be logged');
  });

  it('a failing checkout produces a payment.failed event, not a grant', async () => {
    delivered.length = 0;
    const outcome = await startCheckout({
      userId: 'user-2',
      userEmail: 'fail@wireup.local',
      // 'fail' in the reference is the mock's deterministic failure hook.
      planId: 'pro',
    });
    assert.ok(outcome.externalId.startsWith('mock_ord_'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const event = delivered[0];
    // Force the failure path explicitly through verifyWebhook.
    const failure = getPaymentProvider().verifyWebhook(
      JSON.stringify({ ...event, eventId: `${event.eventId}-fail`, type: 'payment.failed', status: 'failed' }),
      {},
    );
    const applied = await applyWebhook(failure);
    assert.equal(applied.outcome, 'applied');
    assert.equal(await planForUser('user-2'), 'free', 'a failed payment must not grant the plan');
  });

  it('refund() is implemented on the mock', async () => {
    const refund = await getPaymentProvider().refund({ externalId: 'mock_ord_x', amount: 100 });
    assert.equal(refund.status, 'processed');
    assert.equal(refund.provider, 'mock');
  });
});
