import { useCallback, useEffect, useState } from 'react';

import { api } from '../services/api';
import { toast } from '../store/useToastStore';
import type { Plan, Subscription } from '../types/build';

/**
 * /billing — pick a plan and check out.
 *
 * Provider-agnostic: in mock mode the checkout self-settles (the backend
 * fires its own webhook), so this page polls the subscription until the plan
 * flips to active. With Razorpay keys present the same button hands off to
 * the real hosted checkout.
 */
function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [provider, setProvider] = useState<string>('mock');
  const [current, setCurrent] = useState<'free' | 'pro'>('free');
  const [history, setHistory] = useState<Subscription[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [planList, sub] = await Promise.all([api.plans(), api.subscription()]);
    setPlans(planList.plans);
    setProvider(planList.provider);
    setCurrent(sub.plan);
    setHistory(sub.subscriptions);
  }, []);

  useEffect(() => {
    void refresh().catch((error) =>
      toast(error instanceof Error ? error.message : 'Could not load plans.'),
    );
  }, [refresh]);

  const subscribe = async (plan: Plan) => {
    setBusy(plan.id);
    setStatus(null);
    try {
      const outcome = await api.checkout(plan.id);
      if (outcome.selfSettling) {
        setStatus(
          `Mock checkout ${outcome.externalId} created — the provider webhook fires in a moment, waiting for it…`,
        );
        // Poll until the self-fired webhook lands (mock settles in ~1.2 s).
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          await refresh();
          const sub = await api.subscription();
          if (sub.plan === plan.id) {
            setStatus(`Payment captured — you are on the ${plan.name} plan.`);
            toast(`${plan.name} plan is active.`);
            break;
          }
        }
      } else {
        setStatus(`Redirecting to ${outcome.provider} checkout…`);
        window.location.href = outcome.checkoutUrl;
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Checkout failed.');
    } finally {
      setBusy(null);
      await refresh().catch(() => undefined);
    }
  };

  return (
    <div className="page billing-page">
      <section className="build-head">
        <div>
          <div className="eyebrow">Wireup · plans</div>
          <h1>Your plan</h1>
          <p className="muted">
            The plan decides which model tier your builds get. Payment provider in use:{' '}
            <strong>{provider}</strong>.
          </p>
        </div>
      </section>

      <section className="download-grid">
        {plans.map((plan) => (
          <div key={plan.id} className={`download-card${current === plan.id ? ' firmware' : ''}`}>
            <div className="download-icon">{plan.id === 'pro' ? '★' : '◇'}</div>
            <h3>
              {plan.name}
              {current === plan.id && <span className="verdict-pill good"> current</span>}
            </h3>
            <p className="muted">
              {plan.amountPaise === 0 ? (plan.id === 'free' ? 'Free forever' : rupees(0)) : `${rupees(plan.amountPaise)} / month`}
              {plan.pricingPending && (
                <>
                  {' '}
                  <span className="verdict-pill warn">price pending</span>
                </>
              )}
            </p>
            <ul className="download-files compact">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <p className="muted tiny">model tier: {plan.llmTier}</p>
            {plan.id !== 'free' && (
              <button
                type="button"
                className="primary-button wide"
                disabled={busy !== null || current === plan.id}
                onClick={() => void subscribe(plan)}
              >
                {current === plan.id ? 'Active' : busy === plan.id ? 'Starting checkout…' : `Subscribe to ${plan.name}`}
              </button>
            )}
          </div>
        ))}
      </section>

      {status && <div className="inline-note">{status}</div>}

      {history.length > 0 && (
        <section className="admin-panel">
          <h3>Your subscriptions</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Status</th>
                <th>Provider</th>
                <th>Order</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {history.map((sub) => (
                <tr key={sub.id}>
                  <td>{sub.plan}</td>
                  <td>
                    <span className={`verdict-pill ${sub.status === 'active' ? 'good' : sub.status === 'failed' ? 'bad' : 'neutral'}`}>
                      {sub.status}
                    </span>
                  </td>
                  <td>{sub.provider}</td>
                  <td><code>{sub.externalId}</code></td>
                  <td>{new Date(sub.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
