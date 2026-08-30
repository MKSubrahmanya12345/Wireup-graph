# ⚡ Wireup

**Describe the hardware on your bench. Get a validated architecture, compilable firmware, and a local dashboard — as two zip files.**

Wireup is an agentic hardware workspace. Three pages, one pipeline:

| Step | Page | What happens |
| ---- | ---- | ------------ |
| 01 | **Prompt & Questions** | You describe the parts you own. Wireup reads its device knowledge base (RAG), decides what it can, and asks only what's left. |
| 02 | **Architecture Graph** | A validated system graph — components, pins, rails — checked by deterministic engineering rules (power budget, voltage rails, orphans…), with datasheet sources. |
| 03 | **Agentic Build** | The pipeline generates firmware, **compiles it with g++ in a real terminal**, generates a MERN dashboard, **installs + typechecks + builds it with npm/tsc/vite**, cross-checks the firmware⇄software contract — then hands you **two zips**. |

Not an AI wrapper: the core engine is a curated knowledge base + engineering rules + terminal validation. An LLM (Groq) is an *optional assistant* whose drafts must survive the exact same terminal gauntlet — and are discarded if they don't.

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

Open http://localhost:5173, create an account, and you land on the pipeline.

## The final test (try this exact prompt)

> **a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer**

1. **Page 01** — Wireup detects `DHT22 + ESP32`, asks two questions it can't decide (Wi-Fi setup, sample interval) and nothing else.
2. **Page 02** — the graph: ESP32 DevKit, DHT22 on GPIO4 (10 kΩ pull-up noted), USB 5 V rail, engineering checks ✔ verified.
3. **Page 03** — run the agentic build. Watch the terminal: RAG retrieval → firmware synthesis → `g++ -fsyntax-only` ✔ → MERN scaffold merge → `npm install` → `tsc --noEmit` ✔ → `vite build` ✔ → contract checks ✔.
4. Download **dht22-monitor-firmware.zip** and **dht22-monitor-software.zip**.
5. On your bench: edit `firmware/config.h` with your Wi-Fi, flash, read the IP from Serial (115200), put it in `backend/.env` of the software zip, `npm install && npm run dev` — live temperature/humidity on `localhost:5173`. No cloud anywhere. (Can't join your Wi-Fi? The board starts its own hotspot, `http://192.168.4.1`.)

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

## Why it's agentic, not a wrapper

1. **Retrieval first** — parts come from a curated corpus with datasheets, never free-form invention.
2. **Deterministic rules** — power, voltage, structural integrity are arithmetic checks, not model opinions.
3. **The terminal is the judge** — firmware must compile; the MERN app must install, typecheck, and build. The browser log shows every command and its exit code.
4. **Repair loops bounded** — failures feed a repair pass (≤3 iterations); unfixable LLM output is replaced by the deterministic path, and *nothing unvalidated ships*.

`docs/archive/` holds older dev-log notes from earlier iterations.
