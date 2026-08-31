# Wireup agentic roadmap

The honest gap analysis and phased plan for taking Wireup from a *build-gated
generator* to a full *agentic hardware+software engineer*. Every item ships
behind an env flag with the deterministic path intact — nothing ships
unvalidated.

## Where it stood

The pipeline was a fixed DAG: retrieve → firmware template → `g++ -fsyntax-only`
against stub headers → MERN scaffold overlay → `npm/tsc/vite build` → boot smoke
test. The gates were real, but "repair" was either regex include-remap or a full
resynthesis — the model never saw the compiler output, and nothing iterated on
its own artifacts.

---

## ✅ Phase 1 — agentic core (done)

Zero external runtime dependencies; fully verified in CI/sandbox.

| Capability | What changed | Where |
| --- | --- | --- |
| **Diagnostics-fed repair** | g++/validator findings become edits. Mechanical fixes (include remap, Arduino prelude, `DHT22 dht()`→`DHT dht(pin,type)`) run first; with an LLM key, the model receives the *exact diagnostics + failing sources* and returns surgical search/replace patches. Patches apply deterministically: a search block must match exactly once and change the bytes, else it is rejected. | `backend/src/agentic/repairAgent.ts` |
| **No-oscillation guard** | firmware fingerprints tracked per repair round; a patch that produces identical source is dropped before re-validation (mirrors the software guard). | `pipeline.ts` |
| **Multi-turn revision** | `revisionInstruction` on the build endpoints applies a follow-up request ("make the relay active-low") to the current firmware through the same gated edit path, then re-runs the whole gauntlet. | `repairAgent.ts` `reviseFirmwareWithLlm`; `agenticController.ts` |
| **Pin-safety engine** | board profiles carry per-GPIO constraints (strapping / input-only / flash / reserved). Allocation never hands back GPIO12 (MTDI — high at boot bricks the board), 0/2/5/15 strapping, ADC input-only 34–39, or flash 6–11. Human-drawn graph pins that violate constraints are rejected with a reason and the safe auto-pin kept. | `knowledge/devices.ts` (`gpioConstraints`), `planResolver.ts` (`isOutputSafe`/`isInputSafe`/`pinConstraint`) |
| **Device-generalised smoke test** | the runtime boot gate used to hard-code `temperature_c`/`humidity_pct` and would fail an OLED/relay build. It now derives the stub device payload and assertions from the resolved plan's metrics, and skips history assertions when there are no telemetry metrics. | `softwareValidator.ts` |
| **Tests** | 13 new cases: pin safety (allocation + graph rejection), the edit applicator (apply/reject ambiguity/stale/prepend), deterministic fixes, deterministic-repair→clean-compile, and LLM repair + revision via a stub model. Total 69 green. | `backend/test/agenticRepair.test.mjs` |

### Verified behaviour

- A sketch sabotaged with a bad include + missing prelude is repaired and
  **compiles clean under g++**.
- An LLM-returned undefined-symbol fix applies via the stub model.
- An OLED+relay build (no temperature metric) passes the runtime boot smoke test.
- DHT22 + ESP32 reference build ships firmware+software that agree, 1 iteration.

---

## 🟡 Phase 2 — the real firmware gauntlet (code in; runs where the tools exist)

The gates are implemented and tested; they auto-skip in environments without the
embedded toolchain (this sandbox blocks `dl.registry.platformio.org`,
`downloads.arduino.cc`, and `wokwi.com`), exactly like the `GPP-MISSING` badge.
On a machine/CI with the tools installed they run for real.

1. **Real compile gate** ✅ — `compileFirmware` (`embeddedBuild.ts`) builds the
   firmware with PlatformIO (`pio pkg install` + `pio run`, preferred — reads the
   generated `platformio.ini`) or `arduino-cli` (`core install esp32:esp32` +
   `compile --fqbn`), producing a real ESP32 binary. Tool detection lives in
   `toolchain.ts`; failures become `EMBED-COMPILE`/`EMBED-BUILD` findings that
   feed the Phase-1 diagnostics repair loop.
2. **Wokwi firmware simulation** ✅ — `wokwiConfig.ts` generates `wokwi.toml` +
   `diagram.json` from the build plan: a virtual ESP32 with the exact parts
   (DHT22/11, BME280, DS18B20, HC-SR04, PIR, relay, SG90, SSD1306, LED) wired to
   the *exact GPIOs the firmware uses*; parts without a Wokwi model (MQ-2, soil)
   are reported, not faked. The gate runs `wokwi-cli --expect-text "listening on
   port"` (firmware reaching HTTP-server-up). The config is also shipped in the
   firmware zip. Requires `wokwi-cli` + free `WOKWI_CLI_TOKEN`
   (https://wokwi.com/dashboard/ci); flags `AGENTIC_WOKWI`, `AGENTIC_EMBEDDED_COMPILE`.
3. **Diagnostics into repair** ✅ — embedded/sim findings carry file+line and
   flow into the same `repairAgent` patch path as g++ errors.

**To run Phase 2 locally:** `pip install platformio` (and `npm i -g wokwi-cli` +
set `WOKWI_CLI_TOKEN`); the `/api/healthz/toolchain` badge reports what's present.

Remaining Phase-2 nicety: HTTP-probe the simulated device's `/api/sensors` over
Wokwi's port forwarding (today the sim asserts boot + HTTP-server-up via serial).

---

## ⏳ Phase 3 — hardware intelligence

1. **KiCad netlist + ERC** emitted from the graph; netlist-level checks (shorts,
   missing pull-ups added to the BOM, level-shifter insertion).
2. **Datasheet → KB ingestion** so "add a part" scales past the curated 14.
3. **Rules that change the design** (auto-add I2C pull-ups, choose rails), not
   just warn.
4. Optional Web Serial bench loop: capture boot logs from a flashed board and
   feed runtime failures back into a repair turn.

---

## Operating flags

| Flag | Effect |
| --- | --- |
| `AGENTIC_TERMINAL_VALIDATION=0` | skip all terminal gates (default `1`) |
| `AGENTIC_SMOKE_TEST=0` | skip the generated-app boot smoke test (default `1`) |
| `AGENTIC_EMBEDDED_COMPILE=0` | skip the PlatformIO/arduino-cli real-binary compile (default on; auto-skips if the tool is absent) |
| `AGENTIC_WOKWI=0` | skip the Wokwi headless simulation gate (default on; auto-skips without `wokwi-cli`/token) |
| `WOKWI_CLI_TOKEN` | free token from https://wokwi.com/dashboard/ci — enables the sim gate |
| `AGENTIC_MAX_REPAIR_LOOPS=n` | repair rounds per artifact (default 3) |
| `GROQ_API_KEY` / Bedrock creds | enables LLM first-draft, **diagnostics-fed repair**, and multi-turn revision |
