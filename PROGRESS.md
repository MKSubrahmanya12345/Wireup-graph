# Wireup — build progress

_Single-run CTO directive. Mock-first: every external vendor has one interface
and two implementations, and every check below was run against the mock._

Legend: ✅ done & verified · 🟡 in progress · ⛔ blocked on a human/credential

---

## M0 — Scaffolding ✅

| # | Item | State |
| - | ---- | ----- |
| 1 | `PaymentProvider` interface (`checkout`/`verifyWebhook`/`refund`) + `MockPaymentProvider` | ✅ `backend/src/providers/payment/` |
| 2 | `HardwareSimProvider` interface (`runSim(plan)`) + `MockHardwareSimProvider` | ✅ `backend/src/providers/sim/` |
| 3 | Gemini adapter in the LLM selector, warns + falls back to Groq without a key | ✅ `backend/src/services/llmService.ts` |
| 4 | Env-driven adapter selection (`PAYMENT_MODE`, `SIM_MODE`, `auto` default) | ✅ `backend/src/config/env.ts` |
| 5 | CHECK — boots clean with no keys, all three mocks active | ✅ boot log: `Wireup adapters ready — 3/3 running against mocks` |

## M1 — Payments + Admin panel (backend) ✅

| # | Item | State |
| - | ---- | ----- |
| 6 | `role: 'admin' \| 'user'` on the user model | ✅ `auth/userStore.ts` (Mongo + file backends) |
| 7 | `RazorpayAdapter` behind the M0 interface | ✅ `providers/payment/razorpayAdapter.ts` (used only when keys exist) |
| 8 | `subscriptions` collection (userId, plan, status, provider, externalId) | ✅ `billing/subscriptionStore.ts` |
| 9 | `POST /api/billing/checkout` | ✅ |
| 10 | `POST /api/billing/webhook` — signed (real) / accepted (mock), idempotent | ✅ |
| 11 | Seed admin user | ✅ `auth/seedAdmin.ts` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) |
| 12 | Role middleware protecting `/admin/*` | ✅ `requireAdmin` |
| 14 | CHECK — checkout → mock webhook self-fires → plan updates | ✅ subscription went `pending → active`, `GET /api/billing/subscription` reports `plan: pro` |
| 15 | CHECK — replay same event id → no double grant | ✅ second POST → `{"outcome":"duplicate"}`, payments count stayed 1 |
| 16 | CHECK — non-admin `/admin` → 403 (anon → 401) | ✅ |

Next in M1: 13 — `/admin` UI (Users, Payments, Revenue, Usage, Webhook log).

---

## Known blockers (accounts, not code)

- ⛔ **Razorpay test keys** — code complete. Set `PAYMENT_MODE=razorpay`,
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- ⛔ **Gemini API key** — code complete. Set `GEMINI_API_KEY` (optionally
  `GEMINI_MODEL`). Without it, Pro-tier builds log the fallback to Groq.
- ⛔ **Velxio pipeline** — not present in this repo. `VelxioSimProvider` is a
  thin HTTP adapter (`POST {VELXIO_URL}/simulate`); mock is the default.
- ⛔ **[BLOCKED — NEEDS HUMAN: pricing]** — all plan prices are ₹0 placeholders
  in `backend/src/billing/plans.ts` (`amountPaise`). Everything downstream
  (checkout, revenue, admin panel) already handles real numbers.

## Resume point

Continue at **M1 #13** — the `/admin` React UI, then M2 (Gemini-tier gating in
`pipeline.ts`).
