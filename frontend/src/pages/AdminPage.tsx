import { useCallback, useEffect, useState } from 'react';

import { api } from '../services/api';
import type {
  AdminOverview,
  AdminUser,
  PaymentRecord,
  Subscription,
  UsageEvent,
  WebhookLogEntry,
} from '../types/build';
import { toast } from '../store/useToastStore';

/**
 * /admin — the operator console.
 *
 * Five views, all fed by /api/admin/*, which is behind requireAuth +
 * requireAdmin: Users, Payments, Revenue, Usage and the Webhook log. Works
 * identically against the mock payment provider and Razorpay.
 */

type Tab = 'users' | 'payments' | 'revenue' | 'usage' | 'webhooks';

const TABS: { id: Tab; label: string }[] = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'users', label: 'Users' },
  { id: 'payments', label: 'Payments' },
  { id: 'usage', label: 'Usage' },
  { id: 'webhooks', label: 'Webhook log' },
];

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('revenue');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [usage, setUsage] = useState<UsageEvent[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, us, pay, use, hooks] = await Promise.all([
        api.adminOverview(),
        api.adminUsers(),
        api.adminPayments(),
        api.adminUsage(),
        api.adminWebhooks(),
      ]);
      setOverview(ov);
      setUsers(us.users);
      setPayments(pay.payments);
      setSubscriptions(pay.subscriptions);
      setUsage(use.usage);
      setWebhooks(hooks.webhooks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the admin data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (user: AdminUser, role: 'admin' | 'user') => {
    try {
      await api.adminSetRole(user.id, role);
      toast(`${user.email} is now ${role}.`);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change the role.');
    }
  };

  return (
    <div className="page admin-page">
      <section className="build-head">
        <div>
          <div className="eyebrow">Wireup · admin console</div>
          <h1>Operations</h1>
          <p className="muted">
            Users, payments, revenue, usage and every webhook Wireup has received — live from the
            billing store.
          </p>
        </div>
        <div className="build-actions">
          <button type="button" className="ghost-button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </section>

      {error && <div className="inline-error">{error}</div>}

      {overview && (
        <div className="admin-adapters">
          <span className={`verdict-pill ${overview.adapters.payment.mode === 'mock' ? 'warn' : 'good'}`}>
            payments: {overview.adapters.payment.mode}
          </span>
          <span className={`verdict-pill ${overview.adapters.sim.mode === 'mock' ? 'warn' : 'good'}`}>
            hardware sim: {overview.adapters.sim.mode}
          </span>
          <span className={`verdict-pill ${overview.adapters.llm.gemini ? 'good' : 'warn'}`}>
            gemini: {overview.adapters.llm.gemini ? 'live' : 'absent → Groq fallback'}
          </span>
          {overview.revenue.pricingPending && (
            <span className="verdict-pill bad">pricing pending — plans are ₹0 placeholders</span>
          )}
        </div>
      )}

      <nav className="fb-tabs admin-tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`fb-tab${tab === entry.id ? ' active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'revenue' && overview && (
        <section className="admin-panel">
          <div className="admin-metrics">
            <div className="admin-metric">
              <span className="admin-metric-label">Net revenue</span>
              <strong>{rupees(overview.revenue.netPaise)}</strong>
              <span className="muted tiny">{overview.revenue.payments} captured payment(s)</span>
            </div>
            <div className="admin-metric">
              <span className="admin-metric-label">Gross</span>
              <strong>{rupees(overview.revenue.grossPaise)}</strong>
              <span className="muted tiny">refunded {rupees(overview.revenue.refundedPaise)}</span>
            </div>
            <div className="admin-metric">
              <span className="admin-metric-label">Active subscriptions</span>
              <strong>{overview.subscriptions.active}</strong>
              <span className="muted tiny">
                {overview.subscriptions.pending} pending · {overview.subscriptions.failed} failed
              </span>
            </div>
            <div className="admin-metric">
              <span className="admin-metric-label">Users</span>
              <strong>{overview.users.total}</strong>
              <span className="muted tiny">{overview.users.admins} admin(s)</span>
            </div>
            <div className="admin-metric">
              <span className="admin-metric-label">Builds run</span>
              <strong>{overview.usage.builds}</strong>
              <span className="muted tiny">
                {Object.entries(overview.usage.byLlmProvider)
                  .map(([provider, count]) => `${provider}: ${count}`)
                  .join(' · ') || 'no builds yet'}
              </span>
            </div>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(overview.revenue.byPlan).map(([plan, amount]) => (
                <tr key={plan}>
                  <td>{plan}</td>
                  <td>{rupees(amount)}</td>
                </tr>
              ))}
              {Object.keys(overview.revenue.byPlan).length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    No captured payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'users' && (
        <section className="admin-panel">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Plan</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`verdict-pill ${user.role === 'admin' ? 'good' : 'neutral'}`}>{user.role}</span>
                  </td>
                  <td>{user.plan}</td>
                  <td>{when(user.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="ghost-button small"
                      onClick={() => void changeRole(user, user.role === 'admin' ? 'user' : 'admin')}
                    >
                      {user.role === 'admin' ? 'Demote' : 'Promote'}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'payments' && (
        <section className="admin-panel">
          <h3>Payments</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Plan</th>
                <th>Provider</th>
                <th>Order</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{when(payment.createdAt)}</td>
                  <td>{payment.plan}</td>
                  <td>{payment.provider}</td>
                  <td><code>{payment.externalId}</code></td>
                  <td>{rupees(payment.amount)}</td>
                  <td>
                    <span className={`verdict-pill ${payment.status === 'paid' ? 'good' : payment.status === 'failed' ? 'bad' : 'warn'}`}>
                      {payment.status}
                    </span>
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">No payments recorded.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h3>Subscriptions</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Provider</th>
                <th>External id</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id}>
                  <td>{sub.userEmail || sub.userId}</td>
                  <td>{sub.plan}</td>
                  <td>
                    <span className={`verdict-pill ${sub.status === 'active' ? 'good' : sub.status === 'failed' ? 'bad' : 'neutral'}`}>
                      {sub.status}
                    </span>
                  </td>
                  <td>{sub.provider}</td>
                  <td><code>{sub.externalId}</code></td>
                  <td>{when(sub.updatedAt)}</td>
                </tr>
              ))}
              {subscriptions.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">No subscriptions yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'usage' && (
        <section className="admin-panel">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Kind</th>
                <th>Plan</th>
                <th>LLM provider that ran</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((event) => (
                <tr key={event.id}>
                  <td>{when(event.createdAt)}</td>
                  <td>{event.userEmail || event.userId}</td>
                  <td>{event.kind}</td>
                  <td>{event.plan}</td>
                  <td><code>{event.llmProvider ?? '—'}</code></td>
                  <td className="muted">{event.detail ?? ''}</td>
                </tr>
              ))}
              {usage.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">No usage recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'webhooks' && (
        <section className="admin-panel">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Provider</th>
                <th>Type</th>
                <th>Event id</th>
                <th>Outcome</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((hook) => (
                <tr key={hook.id}>
                  <td>{when(hook.receivedAt)}</td>
                  <td>{hook.provider}</td>
                  <td>{hook.type}</td>
                  <td><code>{hook.eventId}</code></td>
                  <td>
                    <span
                      className={`verdict-pill ${
                        hook.outcome === 'applied' ? 'good' : hook.outcome === 'duplicate' ? 'warn' : 'bad'
                      }`}
                    >
                      {hook.outcome}
                    </span>
                  </td>
                  <td className="muted">{hook.message}</td>
                </tr>
              ))}
              {webhooks.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">No webhooks received yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
