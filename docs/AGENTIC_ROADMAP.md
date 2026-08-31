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

## ⏳ Phase 2 — the real firmware gauntlet

Buildable now; partly depends on the local toolchain/cloud to run.

1. **Real compile gate.** Drive `arduino-cli` or PlatformIO with the actual
   `arduino-esp32` core and declared library deps, producing a `.bin`. Detect
   the toolchain like today's `GPP-MISSING` badge and fall back to the stub gate.
   *(Sandbox blocks `dl.registry.platformio.org` and `downloads.arduino.cc`;
   the gate skips gracefully here and runs on a normal machine/CI.)*
2. **Wokwi firmware simulation.** Generate `wokwi.toml` + `diagram.json` from the
   build plan (virtual DHT/servo/relay/OLED on the virtual ESP32), boot the
   compiled binary headlessly with `wokwi-cli --expect-text`, and `curl` the
   simulated device's `/api/sensors` over the Wi-Fi simulation. This is the
   firmware equivalent of the software boot smoke test. Requires the free
   `WOKWI_CLI_TOKEN` (https://wokwi.com/dashboard/ci); flag: `AGENTIC_WOKWI=1`.
3. Feed **arduino-cli/Wokwi diagnostics** into the same `repairAgent` patch path.

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
| `AGENTIC_MAX_REPAIR_LOOPS=n` | repair rounds per artifact (default 3) |
| `GROQ_API_KEY` / Bedrock creds | enables LLM first-draft, **diagnostics-fed repair**, and multi-turn revision |
