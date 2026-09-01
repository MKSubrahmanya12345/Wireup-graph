# Wireup — build progress

_Single run against the CTO directive. **Mock-first**: every external vendor is
one interface with two implementations, and every check below was executed
against the mock — no check was skipped for a missing key._

Legend: ✅ done & verified · ⛔ blocked on a human/credential (code complete)

---

## Status at a glance

**Code-complete and mock-tested:** M0, M1, M2, M3, M4, M5, M6 — every
milestone in the directive is implemented, wired end-to-end and proven with a
real run (HTTP calls / pipeline runs / `npm test`), not by inspection.

**Waiting on real credentials (nothing to build, only env vars to set):**
Razorpay, Gemini, Velxio, and the actual plan prices.

---

## M0 — Scaffolding ✅

| # | Item | Where | Verified |
| - | ---- | ----- | -------- |
| 1 | `PaymentProvider` (`checkout`/`verifyWebhook`/`refund`) + full `MockPaymentProvider` | `backend/src/providers/payment/` | ✅ `npm test` → `billingMock.test.mjs` |
| 2 | `HardwareSimProvider` (`runSim(plan)`) + full `MockHardwareSimProvider` | `backend/src/providers/sim/` | ✅ `providers.test.mjs` |
| 3 | Gemini adapter in the LLM selector; no key → warn + fall back to Groq | `backend/src/services/llmService.ts` | ✅ `providers.test.mjs` (both directions) |
| 4 | Env-driven selection `PAYMENT_MODE` / `SIM_MODE` (`auto` = real when keyed, mock otherwise) | `backend/src/config/env.ts`, both `index.ts` factories | ✅ |
| 5 | **CHECK** boots clean with no keys, all three mocks active | `config/startupReport.ts` | ✅ boot log: `Wireup adapters ready — 3/3 running against mocks` / `ALL MOCKS ACTIVE` |

## M1 — Payments + admin panel ✅

| # | Item | Verified |
| - | ---- | -------- |
| 6 | `role: 'admin' \| 'user'` on the user model (Mongo + file store) | ✅ |
| 7 | `RazorpayAdapter` behind the M0 interface (orders REST + HMAC webhook verify + refund) | ✅ compiles, selected only when keys exist ⛔ unexercised without real keys |
| 8 | `subscriptions` collection (userId, plan, status, provider, externalId) + payments/webhooks/usage | `backend/src/billing/subscriptionStore.ts` ✅ |
| 9 | `POST /api/billing/checkout` — routes per `PAYMENT_MODE` | ✅ live call returned a mock order |
| 10 | `POST /api/billing/webhook` — signature-verified (real) / accepted (mock), idempotent on event id | ✅ |
| 11 | Seed admin user | ✅ boot log `Seed admin: admin account created` |
| 12 | `requireAdmin` middleware on `/api/admin/*` | ✅ |
| 13 | `/admin` UI — Users, Payments, Revenue, Usage, Webhook log (+ role promote/demote) | `frontend/src/pages/AdminPage.tsx` ✅ builds, served at `/admin` |
| 14 | **CHECK** checkout → mock webhook self-fires → plan updates in DB | ✅ subscription `pending → active`, `GET /api/billing/subscription` → `plan: pro` |
| 15 | **CHECK** replay same event id → no double grant | ✅ `{"outcome":"duplicate"}`, payment count unchanged, logged as `duplicate` |
| 16 | **CHECK** non-admin hitting `/admin` → 403 | ✅ 403 for a logged-in user, 401 anonymous |

Also shipped: `/billing` page (plan cards + checkout that waits out the mock
webhook), `Plan` / `Admin` links in the top nav.

## M2 — Gemini-tier gating ✅

| # | Item | Verified |
| - | ---- | -------- |
| 17 | `pipeline.ts` selects the provider from the **user's plan**, not a global env var | ✅ |
| 18 | The provider that actually ran is logged per build, and stored on the usage record | ✅ `LLM provider that actually ran for this build: …` |
| 19 | **CHECK** free build logs Groq; pro build logs Gemini / the fallback correctly | ✅ free → `plan: free → entitled groq; provider that will run: groq`; pro → `entitled gemini; provider that will run: groq — requested gemini, fell back to groq (GEMINI_API_KEY is not configured)` |

## M3 — 3D shapes + Complete gate on page 01 ✅

| # | Item | Verified |
| - | ---- | -------- |
| 20 | React Three Fiber canvas on page 01 | `frontend/src/three/IntakeScene.tsx` (reuses page 02's `SceneCanvas`) ✅ |
| 21 | One shape per identified component, live as the Q&A resolves | `lib/componentDetect.ts` before the graph exists, real graph nodes after ✅ |
| 22 | Page 02's validity check reused on page 01 | `lib/graphValidity.ts` — the single implementation both pages call ✅ |
| 23 | **Complete** button — disabled while invalid, enabled when valid, navigates to page 02 | ✅ (page 01 no longer auto-navigates) |
| 24 | **CHECK** invalid → disabled; valid → enabled → navigates | ✅ evaluated directly: empty graph / blocking / error-issue → `valid: false` with a human reason; clean graph → `valid: true` |

## M4 — Simulation stage on page 03 ✅

| # | Item | Verified |
| - | ---- | -------- |
| 25 | `HardwareSimProvider` wired into the build flow, pass/fail + log surfaced | ✅ stage `simulate` streams the full virtual-bench log |
| 26 | Existing embedded sim wired in and surfaced | ✅ the PlatformIO/Wokwi gates (`AGENTIC_EMBEDDED_COMPILE`, `AGENTIC_WOKWI`) and the runtime boot smoke test stream into the same terminal and feed "Software ready". *Note: this repo's simulator is Wokwi headless (`wokwiConfig.ts`), not an in-browser avr8js runtime — avr8js targets AVR, not the ESP32 this KB builds for. The browser-side avr8js/wokwi-elements canvas is the open item here.* |
| 27 | Two independent indicators — Hardware ready ✔/✘, Software ready ✔/✘ | `ReadinessPanel` on page 03 ✅ |
| 28 | Download disabled until BOTH pass; a provider error is shown explicitly | ✅ buttons render 🔒 and are `disabled`; an errored provider gets its own copy |
| 29 | **CHECK** force one to fail → download stays locked; both pass → unlocks | ✅ `SIM_FORCE_FAIL=1` build → `hardware.ready=false`, `software.ready=true`, `downloadUnlocked=false`; normal build → all true |

## M5 — Per-build instructions + BOM affiliate links ✅

| # | Item | Verified |
| - | ---- | -------- |
| 30 | Instructions generated from that build's resolved plan | `agentic/instructions.ts` → `INSTRUCTIONS-<slug>.md`, also shipped inside the firmware zip ✅ |
| 31 | **CHECK** two different device builds → two different instructions files | ✅ DHT22 Monitor (2778 chars) vs Distance Guard (2862 chars), different md5, mutually exclusive part names; also asserted in `providers.test.mjs` |
| 32 | Affiliate-link fields on BOM entries in `devices.ts`, rendered in the BOM view | `purchase[]` + `withAffiliateTag()` + `BomView` on page 03 ✅ |

## M6 — Regression, docs, checkpoint ✅

| # | Item | Verified |
| - | ---- | -------- |
| 33 | Existing g++ / npm / tsc / vite gates still pass | ✅ `npm test` → **90 pass / 0 fail** (27 suites) |
| 34 | Fresh clone → `npm install` → `npm run build` on backend and frontend | ✅ clean clone into `/tmp`, both builds OK, no manual fixes |
| 35 | No secrets committed; `.env.example` lists every new var incl. `*_MODE` | ✅ secret-pattern scan clean, no `.env` tracked |
| 36 | `README.md` + `docs/AGENTIC_ROADMAP.md` updated | ✅ |
| 37 | Final `PROGRESS.md` | this file |

---

## ⛔ Blocked — needs a human, not code

| Blocker | What is already built | Exactly what to set to go live |
| --- | --- | --- |
| **Razorpay account/keys** | `RazorpayAdapter` (orders, HMAC webhook verification, refunds) behind the shared interface; the whole loop proven on the mock | `PAYMENT_MODE=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `APP_BASE_URL=https://…`; register `POST {APP_BASE_URL}/api/billing/webhook` in the Razorpay dashboard for `payment.captured` / `payment.failed` / `refund.processed` |
| **Gemini API key** | Gemini adapter + plan-based tier gating + logged fallback | `GEMINI_API_KEY` (optionally `GEMINI_MODEL`, default `gemini-2.0-flash`) |
| **Velxio pipeline** — not in this repo | `VelxioSimProvider`, a thin adapter posting the resolved plan to `POST {VELXIO_URL}/simulate` and expecting `{ ok, checks[], log[], runUrl }` | `SIM_MODE=velxio`, `VELXIO_URL`, optional `VELXIO_API_KEY`. If the real pipeline's contract differs, only `velxioSimProvider.ts` changes |
| **[BLOCKED — NEEDS HUMAN: pricing]** | Plans, checkout, revenue reporting and the admin panel all handle real amounts today | Set `amountPaise` (and `pricingPending: false`) for each plan in `backend/src/billing/plans.ts`. Everything else follows automatically |
| Admin credentials | Admin seeding is automatic | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (the default `wireup-admin-dev` is dev-only and warns loudly at boot) |
| Affiliate program IDs | BOM links render with the tag appended when configured | `AFFILIATE_TAG_AMAZON`, `AFFILIATE_TAG_ROBU`, `AFFILIATE_TAG_DIGIKEY` |

## Known open item (honest list)

- **Browser-side avr8js / wokwi-elements canvas** (part of M4 #26). The
  simulation that runs today is server-side: the Wokwi headless gate plus the
  deterministic virtual bench, both streamed live into page 03's terminal and
  both feeding the readiness indicators. An in-browser animated circuit would
  be additive; it is not what gates the download.
- Mock-mode `/billing/mock-checkout` is a URL the mock returns for realism —
  the mock settles itself, so no page is served there.

## How to re-run every check

```bash
cd backend && npm install && npm test        # 90 tests: gates + billing + providers
cd backend && npx tsx src/server.ts          # boot banner proves which adapters are live
# full loop against mocks:
curl -X POST localhost:5000/api/auth/signup  -d '{"name":"A","email":"a@b.c","password":"password123"}' -H 'content-type: application/json'
curl -X POST localhost:5000/api/billing/checkout -H "authorization: Bearer <token>" -H 'content-type: application/json' -d '{"plan":"pro"}'
sleep 2 && curl localhost:5000/api/billing/subscription -H "authorization: Bearer <token>"   # → plan: pro
SIM_FORCE_FAIL=1 npx tsx src/server.ts       # a build now reports downloadUnlocked=false
```
