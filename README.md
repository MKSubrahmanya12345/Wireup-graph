# ⚡ Wireup

**Describe the hardware on your bench. Get a validated architecture, compilable firmware, and a local dashboard — as two zip files.**

Wireup is an agentic hardware workspace. Three pages, one pipeline:

| Step | Page | What happens |
| ---- | ---- | ------------ |
| 01 | **Prompt & Questions** | You describe the parts you own. Wireup reads its device knowledge base (RAG), decides what it can, asks only what's left, and draws one 3D shape per part it identifies — live. **Complete** unlocks only once the graph passes the very same validity check page 02 uses. |
| 02 | **Architecture Graph** | A validated system graph — components, pins, rails — checked by deterministic engineering rules (power budget, voltage rails, orphans…), with datasheet sources. |
| 03 | **Agentic Build** | The pipeline generates firmware, **compiles it with g++ in a real terminal**, generates a MERN dashboard, **installs + typechecks + builds it with npm/tsc/vite**, cross-checks the firmware⇄software contract — then hands you **two zips**. |

Not an AI wrapper: the core engine is a curated knowledge base + engineering rules + terminal validation. An LLM (Groq) is an *optional assistant* whose drafts must survive the exact same terminal gauntlet — and are discarded if they don't.

## Hosting it

A single Docker image serves the frontend **and** API on one port (same-origin),
with `g++` baked in so the build gates run server-side. It's a long-running
service (builds stream for minutes), not serverless. One-command configs for
**Fly.io** (`fly.toml`) and **Render** (`render.yaml`) are included.

Users never need a terminal — they click **"Skip — try as guest"** and the build
log streams from the server into any browser (mobile included). The firmware
serves its own dashboard at `http://<device-ip>/` once flashed. Full steps, env
vars, and per-component verification: **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**.

## Quick start

```bash
# terminal 1 — API (http://localhost:5000)
cd backend
cp .env.example .env     # optional; defaults work out of the box
npm install
npm run dev

# terminal 2 — app (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — create an account or hit **"Skip — try as guest"**
(one-click session, nothing stored) — and you land on the pipeline.

## The final test (try this exact prompt)

> **a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer**

1. **Page 01** — Wireup detects `DHT22 + ESP32`, asks two questions it can't decide (Wi-Fi setup, sample interval) and nothing else.
2. **Page 02** — the graph: ESP32 DevKit, DHT22 on GPIO4 (10 kΩ pull-up noted), USB 5 V rail, engineering checks ✔ verified.
3. **Page 03** — run the agentic build. Watch the terminal: RAG retrieval → firmware synthesis → `g++ -fsyntax-only` ✔ → MERN scaffold merge → `npm install` → `tsc --noEmit` ✔ → `vite build` ✔ → contract checks ✔.
4. Download **dht22-monitor-firmware.zip** and **dht22-monitor-software.zip**.
5. On your bench: edit `firmware/config.h` with your Wi-Fi, flash, open **`http://<device-ip>/`** — the device serves its own dashboard (live tiles + temperature chart + Wi-Fi settings), no laptop app required. The software zip adds long-term history: `npm install && npm run dev` on any computer/phone on the same Wi-Fi (`CORS_ORIGIN=*`, mDNS `dht22-monitor.local` supported). No cloud anywhere. (Can't join your Wi-Fi? The board starts its own hotspot, `http://192.168.4.1`.)

### The firmware is a full product, not just JSON

- **Embedded dashboard** at `/` — live readings, a temperature sparkline from the on-device history, and Wi-Fi setup. Zero install.
- **`/api/history`** — ring buffer in RAM (1 sample/min, ~12 h) so readings survive laptop sleep.
- **`/api/wifi`** — change network from the browser; stored in NVS, no re-flash.
- **OTA** — update firmware over Wi-Fi (Arduino IDE / PlatformIO), no USB after the first flash.
- **`mDNS`** — reach the device at `dht22-monitor.local` when your OS resolves it.
- Control endpoints accept form *and* JSON bodies; the dashboard sends form-encoded (what `server.arg()` actually parses).

## What's inside

```
├── frontend/            React 19 + Vite — the three-page Wireup app
└── backend/
    ├── src/auth/        jwt + bcrypt auth (Mongo when MONGO_URI set, file store otherwise)
    ├── src/agentic/     the engine:
    │   ├── knowledge/     device knowledge base (RAG corpus) + retriever
    │   ├── architect.ts   deterministic /interpret + /plan engines
    │   ├── planResolver.ts  graph → pin-accurate build plan
    │   ├── firmwareSynth.ts template synthesiser (ESP32/Arduino)
    │   ├── softwareSynth.ts MERN wiring synthesiser (on the committed scaffold)
    │   ├── firmwareValidator.ts  structural checks + g++ compile gate
    │   ├── softwareValidator.ts  consistency + npm/tsc/vite build gate
    │   └── pipeline.ts    orchestrator: generate → validate → repair (≤3) → ship
    ├── agentic/arduino-stubs/  compile harness (Arduino/ESP32 core headers)
    └── scaffolds/website/      committed MERN scaffold the dashboard is built on

## App niceties

- **Guest mode** — `POST /api/auth/guest` issues a one-click signed session; no signup wall.
- **Refresh-proof** — graph, plan and build result persist to `localStorage`; reloading page 02/03 loses nothing (Mongo still optional for cross-machine persistence).
- **Parts list (BOM)** — page 02 shows the bill of materials with datasheet links, one click copies it as a spreadsheet.
- **Live device test** — page 03 polls `http://<device-ip>/api/sensors` straight from the browser once the device is flashed, closing the loop between download and "it works".
- **Toolchain badge** — `GET /api/healthz/toolchain` reports node/npm/g++; page 03 shows whether the real compile gate can run before you start a build.
```

### Supported parts (knowledge base)

ESP32 DevKit / ESP32-S3 · DHT22 (AM2302), DHT11 · BME280 · DS18B20 · capacitive soil moisture · MQ-2 gas · HC-SR04 ultrasonic · HC-SR501 PIR · 1-ch relay · SG90 servo · status LED · SSD1306 OLED.

Adding a part? Append an entry to `backend/src/agentic/knowledge/devices.ts` (facts, pins, libraries, metrics) and a code template to `firmwareSynth.ts` — everything downstream (graph, firmware, dashboard, validation) picks it up.

### Optional LLM assist

Set `GROQ_API_KEY` in `backend/.env` to let an LLM draft plans/firmware for
parts outside the knowledge base. Every draft still goes through the same
deterministic repair + terminal validation before it ships; the engine falls
back to knowledge-base synthesis on any failure.

## Auth

- Signed sessions (JWT), bcrypt password hashing, Zod-validated inputs.
- Users persist to MongoDB when `MONGO_URI` is set; otherwise to a local file store (`backend/.data/users.json`, git-ignored) so a fresh clone just works.
- All architecture/build routes require a session; `/api/healthz` and `/api/auth/*` stay open.

Key env vars (all optional, see `backend/.env.example`): `JWT_SECRET`, `MONGO_URI`, `GROQ_API_KEY`, `AGENTIC_MAX_REPAIR_LOOPS`, `AGENTIC_COMMAND_TIMEOUT_MS`, `AGENTIC_TERMINAL_VALIDATION`.

Users carry a `role` (`user` | `admin`). One admin is seeded at boot from
`ADMIN_EMAIL` / `ADMIN_PASSWORD` (defaults `admin@wireup.local` /
`wireup-admin-dev` — change them anywhere real, or set `ADMIN_SEED=0`).

## Plans, payments and the admin console

Wireup is **mock-first**: every external vendor sits behind one interface with
two implementations, and the mock is the default. The entire commercial loop —
checkout, webhook, plan upgrade, revenue reporting — runs on a laptop with no
accounts, and going live is an env-var change.

| Dependency | Default (no keys) | Real | Switch |
| --- | --- | --- | --- |
| Payments | `MockPaymentProvider` — the fake checkout self-fires its own webhook after `MOCK_PAYMENT_DELAY_MS` | `RazorpayAdapter` (Orders API + HMAC-verified webhooks) | `PAYMENT_MODE=razorpay` + `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Hardware simulation | `MockHardwareSimProvider` — a deterministic virtual bench computed from the resolved plan | `VelxioSimProvider` → `POST {VELXIO_URL}/simulate` | `SIM_MODE=velxio` + `VELXIO_URL` |
| Pro-tier model | Gemini requested → **logged** fallback to Groq | Gemini | `GEMINI_API_KEY` |

The boot log prints exactly which side is live:

```
Wireup adapters ready — 3/3 running against mocks
  adapter[payments]     = MockPaymentProvider (mock)
  adapter[hardware-sim] = MockHardwareSimProvider (mock)
  adapter[llm]          = MockLLMProvider (mock)
ALL MOCKS ACTIVE — no external credentials configured.
```

- **`/billing`** — pick a plan. In mock mode the page waits for the self-fired
  webhook and flips to *active* in about a second.
- **`/admin`** (admins only; everyone else gets a 403 from the API and an
  explicit 403 panel in the UI) — Users, Payments, Revenue, Usage and every
  webhook Wireup has received, including replays marked `duplicate`.
- Webhooks are **idempotent on the provider event id** in both modes: replaying
  an event grants nothing twice.
- **Pricing is not set yet.** Every plan is a ₹0 placeholder in
  `backend/src/billing/plans.ts`; see `PROGRESS.md`.

## Readiness gates on page 03

The build ends with two *independent* verdicts:

- **Hardware ready ✔/✘** — from the `HardwareSimProvider` (mock virtual bench
  or Velxio). A simulator that *errors* is reported as an error, never a skip.
- **Software ready ✔/✘** — `npm install` → `tsc --noEmit` → `vite build` →
  runtime boot smoke test → firmware⇄software contract.

**Both must pass before the zips unlock.** Force the failure path with
`SIM_FORCE_FAIL=1` (circuit fails) or `SIM_FORCE_ERROR=1` (provider errors).

Every build also writes `INSTRUCTIONS-<slug>.md` from that build's resolved
plan (parts, pins, cadence, verification record) — shipped in the firmware zip
and rendered on page 03 next to a BOM with per-part purchase links.

## The live bench on page 03

Under the readiness panel, page 03 animates **your** circuit:

- The parts and wires come from the diagram the pipeline generated
  (`hardware/universal-diagram.json`, falling back to Wokwi's `diagram.json`)
  and are drawn with the real [`@wokwi/elements`](https://github.com/wokwi/wokwi-elements)
  web components. A part with no Wokwi model renders as a labelled stub tile —
  it is never swapped for a lookalike.
- The heartbeat is **real AVR machine code** executing on
  [`avr8js`](https://github.com/wokwi/avr8js) in your tab: `src/sim/avrProgram.ts`
  assembles a PORTB5 blink and `useAvrHeartbeat` steps the core ~16 simulated
  ms per animation frame. The panel reports cycles retired and simulated time.
- Sensor values are **replayed** from this build's `HardwareSimProvider` log,
  not invented in the browser.

Honest caveat, stated in the UI too: avr8js simulates AVR silicon, and Wireup
targets the ESP32 — your firmware is compiled and simulated **server-side**
(g++/PlatformIO + Wokwi headless + the virtual bench), and those runs are what
gate the downloads. The bench is the visual/timing layer over them.

```bash
cd frontend && npm test   # avr8js heartbeat + diagram-parsing suites
```

## Why it's agentic, not a wrapper

1. **Retrieval first** — parts come from a curated corpus with datasheets, never free-form invention.
2. **Deterministic rules** — power, voltage, structural integrity are arithmetic checks, not model opinions.
3. **The terminal is the judge** — firmware must compile; the MERN app must install, typecheck, build, and *boot*. The browser log shows every command and its exit code.
4. **Diagnostics-fed repair** — compiler output and validator findings are fed back into a real fix step: mechanical edits first (include remap, missing prelude, DHT-class fixes), then — when an LLM key is set — the model reads the **exact diagnostics + failing sources** and returns surgical search/replace patches that are applied deterministically (every patch must match exactly once and change the bytes, or it is rejected). The loop is fingerprint-guarded so it cannot spin on a no-op patch.
5. **Multi-turn revision** — a follow-up change request (e.g. *"make the relay active-low"*) is applied to the current firmware via the same gated edit path, then re-compiled. Iteration survives the terminal gauntlet too.
6. **Pin-safety engine** — the planner never assigns strapping pins (GPIO0/2/5/12/15), input-only ADC pins (34–39) or flash pins (6–11) to modules; a human-drawn graph that tries is rejected with the reason. GPIO12 held high at boot bricks an ESP32 — the compiler can never catch that.

### Multi-turn builds

`POST /api/build/agentic/stream` accepts an optional `revisionInstruction`. On a
second turn, pass it alongside the same brief/graph and Wireup edits the existing
firmware to satisfy the request, then re-runs the full compile → build → boot
gauntlet. With no LLM key the unmodified deterministic plan is built (a warning
is logged); with `GROQ_API_KEY`/Bedrock set, the model applies the change.

### Roadmap status

See [`docs/AGENTIC_ROADMAP.md`](docs/AGENTIC_ROADMAP.md) for the phased plan.
- **Phase 1 (agentic core) — in:** diagnostics-fed repair, multi-turn revision,
  pin-safety enforcement, device-generalised runtime smoke test.
- **Phase 2 (real firmware gauntlet) — code in, runs where the tools exist:**
  PlatformIO/arduino-cli real-binary compile and a headless Wokwi simulation
  gate (virtual circuit generated from the plan, wired pin-for-pin). Both
  auto-skip when the toolchain/token is absent and run for real when installed.
  `GET /api/healthz/toolchain` reports what's available.
- **Phase 3 (KiCad netlist/ERC, datasheet ingestion, bench loop) — scoped.**

`docs/archive/` holds older dev-log notes from earlier iterations.
