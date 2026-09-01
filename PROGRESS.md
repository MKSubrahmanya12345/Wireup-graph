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

## M4b — Browser bench closed out ✅ (was the one open item)

| # | Item | Verified |
| - | ---- | -------- |
| 38 | `avr8js` + `@wokwi/elements` installed in `frontend/` (they were never actually dependencies) | `frontend/package.json` ✅ |
| 39 | Real AVR machine code assembled in the browser — `src/sim/avrProgram.ts` (sbi/cbi/ldi/sbiw/dec/brne/rjmp encoders → a PORTB5 heartbeat) | ✅ `cd frontend && npm test` → opcode `0x9A25`/`0x9A2D`/`0x982D` asserted, PORTB5 toggles on a real `CPU`, half-period 100–1000 ms |
| 40 | `src/sim/useAvrHeartbeat.ts` runs the core on `requestAnimationFrame` (~16 simulated ms/frame) and exposes led/cycles/sim-time/edges | ✅ tsc + build; the UI reads the CPU, it never drives it |
| 41 | `src/sim/diagram.ts` parses the pipeline's own diagram — Wokwi v1 tuples **and** Wireup universal v2 objects — and maps part types to registered custom elements only | ✅ 7 tests incl. "no lookalike substitution" and "every mapped tag is really registered by @wokwi/elements" |
| 42 | `src/components/WokwiBench.tsx` on page 03: real Wokwi elements for the generated parts, stub tiles for parts with no model, sensor values replayed from this build's `simulation.hardware.log`, Run/Pause/Reset, connection list | ✅ mounted in `BuildPage.tsx` under the readiness panel; `npx tsc -b` clean, `npm run build` clean (elements lazy-loaded into their own 438 kB chunk) |
| 43 | Labelled honestly on screen: avr8js is AVR silicon, so the panel states the ESP32 firmware is compiled + simulated **server-side** and this is the visual/timing bench over it | ✅ header copy in `WokwiBench.tsx` |

Not verified: pixel rendering in a real browser — this sandbox has no Chrome/Playwright. Types, bundling, the AVR core and the diagram parsing are all covered by `frontend/npm test`; the visual layer is the standard @wokwi/elements web components.

## M7 — Velxio submodule, simulator page, live website preview ✅

| # | Item | Verified |
| - | ---- | -------- |
| 44 | Velxio vendored at `external/velxio` as a **git submodule** pinned to `2642ed7`, with `external/README.md` covering the AGPL-3.0 boundary | `git submodule status`; repo objects unchanged (upstream is 101 MB / 1,866 files) |
| 45 | Every build emits a native Velxio project `simulation/<slug>.vlx` (`format: velxio-project`, v1: board + sketch + components + wires) | ✅ `npm test` → `velxioProject.test.mjs` 6/6, and end-to-end over `/api/build/agentic/stream` |
| 46 | Plan nets translated to pin names the board element really has (`4`→`D4`, `GND.0`→`GND.1`, `5V`→`VIN`) — a wire to a non-existent pin is dropped silently on import | ✅ asserted per wire, plus a unit test of the translator |
| 47 | Parts Velxio has no model for are reported, never substituted | ✅ test 4 of the suite |
| 48 | Page 04 rewritten: swap button (Simulation ⇄ Website), state in `?view=`, both halves say why they are empty when they are | ✅ `simSources.test.mjs` 4/4 + `tsc -b` + `vite build` |
| 49 | Simulation half runs the native bench by default and embeds `VELXIO_URL` when configured, with a manual switch and a `.vlx` download | ✅ `GET /api/config/sim`; `chooseEngine` falls back to native rather than iframing `null` |
| 50 | Website half serves the **real generated bundle**: the gate builds it with `vite build --base=/api/preview/<id>/`, the pipeline keeps that `dist/` before the workspace is wiped | ✅ live run — `curl /api/preview/<id>/` returns the dashboard HTML with its hashed assets |
| 51 | Preview device API stub answers the dashboard's contract (`/health`, `/capabilities`, `/telemetry/live`, `/telemetry/history`, `/telemetry/control`) with this plan's metric fields | ✅ `preview.test.mjs` 7/7 against a real socket; live payload nests `temperature.temperature_c` exactly as the device does |
| 52 | Preview routes are open (an iframe cannot send a Bearer token) but keyed by 12 random base64url chars, capped at the newest 8 builds, and 404 cleanly when expired | ✅ tests 1/5 of that suite |
| 53 | Firmware validator no longer misreads an artifact that *embeds* the sketch (the `.vlx`) as a malformed dashboard string | ✅ full backend suite back to green after the fix |

**Honest limits of M7**: the preview's API is a stub, and that sentence is on
screen above the iframe. The native bench still clocks its animation with
avr8js (AVR), not an emulated ESP32 — an embedded Velxio instance is what gives
you true ESP32/RISC-V emulation in the browser, which is why the swap to it is
one env var. Neither Docker nor the Velxio backend is installed in this
sandbox, so the embed path is proven by config plumbing and fallback logic, not
by a running Velxio.

---

## ⛔ Blocked — needs a human, not code

| Blocker | What is already built | Exactly what to set to go live |
| --- | --- | --- |
| **Razorpay account/keys** | `RazorpayAdapter` (orders, HMAC webhook verification, refunds) behind the shared interface; the whole loop proven on the mock | `PAYMENT_MODE=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `APP_BASE_URL=https://…`; register `POST {APP_BASE_URL}/api/billing/webhook` in the Razorpay dashboard for `payment.captured` / `payment.failed` / `refund.processed` |
| **Gemini API key** | Gemini adapter + plan-based tier gating + logged fallback | `GEMINI_API_KEY` (optionally `GEMINI_MODEL`, default `gemini-2.0-flash`) |
| **Velxio pipeline** — not in this repo | `VelxioSimProvider`, a thin adapter posting the resolved plan to `POST {VELXIO_URL}/simulate` and expecting `{ ok, checks[], log[], runUrl }` | `SIM_MODE=velxio`, `VELXIO_URL`, optional `VELXIO_API_KEY`. If the real pipeline's contract differs, only `velxioSimProvider.ts` changes |
| **[BLOCKED — NEEDS HUMAN: pricing]** | Plans, checkout, revenue reporting and the admin panel all handle real amounts today | Set `amountPaise` (and `pricingPending: false`) for each plan in `backend/src/billing/plans.ts`. Everything else follows automatically |
| Admin credentials | Admin seeding is automatic | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (the default `wireup-admin-dev` is dev-only and warns loudly at boot) |
| **Velxio instance for the embed** | `/sim` embeds it when configured, and falls back to the native bench when not | `VELXIO_URL=http://localhost:3000` after `docker compose -f external/velxio/docker-compose.yml up -d`. Its compile/emulate backend needs Docker + the ESP-IDF/QEMU images — not installable in this sandbox |
| Affiliate program IDs | BOM links render with the tag appended when configured | `AFFILIATE_TAG_AMAZON`, `AFFILIATE_TAG_ROBU`, `AFFILIATE_TAG_DIGIKEY` |

## Known open item (honest list)

- ~~Browser-side avr8js / wokwi-elements canvas~~ — **closed**, see M4b above.
  Note what it is and is not: the heartbeat is genuine AVR execution and the
  circuit is your generated diagram, but the ESP32 firmware itself still runs
  server-side (Wokwi headless gate + the virtual bench). Those server-side runs
  are what gate the download; the bench is the visual layer over them.
- The bench has no automated **visual** regression (no browser in CI here).
- `frontend/pnpm-lock.yaml` and `frontend/bun.lock` are tracked but predate
  `avr8js`/`@wokwi/elements` (neither pnpm nor bun is installed in this
  sandbox). `npm install` — the documented path, and the one the fresh-clone
  check uses — resolves them from `package.json`; regenerate the other two
  lockfiles if your team uses pnpm/bun.
- Mock-mode `/billing/mock-checkout` is a URL the mock returns for realism —
  the mock settles itself, so no page is served there.

## How to re-run every check

```bash
cd backend  && npm install && npm test       # 90 tests: gates + billing + providers
cd frontend && npm install && npm test       # 16 tests: avr8js heartbeat, diagram parsing, page-04 sources
git submodule update --init external/velxio  # the emulator source (AGPL-3.0, 101 MB)
cd backend && npx tsx src/server.ts          # boot banner proves which adapters are live
# full loop against mocks:
curl -X POST localhost:5000/api/auth/signup  -d '{"name":"A","email":"a@b.c","password":"password123"}' -H 'content-type: application/json'
curl -X POST localhost:5000/api/billing/checkout -H "authorization: Bearer <token>" -H 'content-type: application/json' -d '{"plan":"pro"}'
sleep 2 && curl localhost:5000/api/billing/subscription -H "authorization: Bearer <token>"   # → plan: pro
SIM_FORCE_FAIL=1 npx tsx src/server.ts       # a build now reports downloadUnlocked=false
```
