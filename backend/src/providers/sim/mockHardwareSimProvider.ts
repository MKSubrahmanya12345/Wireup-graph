import { isInputSafe, isOutputSafe, pinConstraint } from '../../agentic/planResolver.js';
import type { DeviceBuildPlan } from '../../agentic/types.js';
import { logger } from '../../config/logger.js';
import type { HardwareSimProvider, SimCheck, SimResult } from './types.js';

/**
 * MockHardwareSimProvider — a deterministic hardware simulation.
 *
 * It is not a hand-wave: the "canned" log is computed from the actual
 * resolved plan (board, pins, supply rails, bus collisions), so two different
 * device builds produce two different simulation logs, and a genuinely
 * unsafe pin assignment genuinely fails.
 *
 * Escape hatch for the download-gate test: SIM_FORCE_FAIL=1 makes the
 * simulated hardware fail on purpose; SIM_FORCE_ERROR=1 makes the provider
 * itself error (a different, explicitly surfaced state).
 */
export class MockHardwareSimProvider implements HardwareSimProvider {
  readonly mode = 'mock' as const;

  describe(): string {
    return 'MockHardwareSimProvider (deterministic virtual bench, derived from the resolved plan)';
  }

  async runSim(plan: DeviceBuildPlan): Promise<SimResult> {
    const started = Date.now();
    const log: string[] = [];
    const checks: SimCheck[] = [];

    log.push(`virtual-bench: booting ${plan.board.name} (${plan.board.mcu}) @ ${plan.board.voltage} V`);
    log.push(`virtual-bench: plan "${plan.slug}" · ${plan.modules.length} module(s) · ${plan.sampleIntervalMs} ms cadence`);

    if (process.env.SIM_FORCE_ERROR === '1') {
      log.push('virtual-bench: FORCED PROVIDER ERROR (SIM_FORCE_ERROR=1)');
      return {
        provider: 'mock',
        ok: false,
        errored: true,
        checks: [{ name: 'simulator reachable', ok: false, detail: 'SIM_FORCE_ERROR=1' }],
        log,
        durationMs: Date.now() - started,
      };
    }

    // 1. Power-on self test.
    checks.push({
      name: 'power-on self test',
      ok: true,
      detail: `${plan.board.voltage} V rail stable; brown-out detector armed`,
    });
    log.push('virtual-bench: POST ok — rail stable, brown-out detector armed');

    // 2. Per-module pin sanity, using the same board constraints the planner
    //    uses. A module bound to a flash/strapping pin fails here.
    const used = new Map<string, string>();
    for (const module of plan.modules) {
      for (const [role, pin] of Object.entries(module.pins)) {
        const constraint = pinConstraint(plan.board, pin);
        const needsOutput = role !== 'data' || module.kind === 'actuator';
        const safe = needsOutput ? isOutputSafe(plan.board, pin) : isInputSafe(plan.board, pin);
        const collision = used.get(pin);
        used.set(pin, `${module.name}.${role}`);

        if (collision) {
          checks.push({
            name: `${module.name} ${role} → ${pin}`,
            ok: false,
            detail: `pin collision with ${collision}`,
          });
          log.push(`virtual-bench: ✘ ${pin} driven by two nets (${collision} and ${module.name}.${role})`);
          continue;
        }
        checks.push({
          name: `${module.name} ${role} → ${pin}`,
          ok: safe,
          detail: safe
            ? 'signal toggles cleanly in simulation'
            : (constraint?.note ?? `${pin} is not usable for this role`),
        });
        log.push(
          safe
            ? `virtual-bench: ✔ ${pin} (${module.name}.${role}) — edge timing within spec`
            : `virtual-bench: ✘ ${pin} (${module.name}.${role}) — ${constraint?.note ?? 'unusable pin'}`,
        );
      }

      // 3. Simulated readings for every metric the KB says this part emits.
      for (const metric of module.metrics) {
        const sample = simulatedSample(metric.min, metric.max, `${plan.slug}:${metric.jsonField}`);
        const inRange =
          (metric.min === undefined || sample >= metric.min) &&
          (metric.max === undefined || sample <= metric.max);
        checks.push({
          name: `${metric.jsonField} reading`,
          ok: inRange,
          detail: `${sample}${metric.unit} within [${metric.min ?? '-∞'}, ${metric.max ?? '∞'}]`,
        });
        log.push(`virtual-bench: sample ${metric.jsonField} = ${sample} ${metric.unit}`);
      }
    }

    // 4. Wi-Fi / web server bring-up.
    if (plan.webServer) {
      checks.push({
        name: 'http server bring-up',
        ok: true,
        detail: 'virtual NIC associated; GET /api/sensors returned 200',
      });
      log.push('virtual-bench: wifi associated (virtual AP) — GET /api/sensors → 200 OK');
    }

    const forced = process.env.SIM_FORCE_FAIL === '1';
    if (forced) {
      checks.push({ name: 'forced failure', ok: false, detail: 'SIM_FORCE_FAIL=1' });
      log.push('virtual-bench: ✘ forced failure (SIM_FORCE_FAIL=1)');
    }

    const ok = checks.every((check) => check.ok);
    log.push(`virtual-bench: run complete — ${ok ? 'PASS' : 'FAIL'} (${checks.length} checks)`);
    logger.info({ slug: plan.slug, ok, checks: checks.length }, 'mock hardware sim finished');

    return { provider: 'mock', ok, errored: false, checks, log, durationMs: Date.now() - started };
  }
}

/** Stable pseudo-random sample inside the metric window — same plan, same log. */
function simulatedSample(min: number | undefined, max: number | undefined, seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 1000;
  const lo = min ?? 0;
  const hi = max ?? (min ?? 0) + 100;
  // Stay comfortably inside the window so a valid plan never fails on noise.
  const value = lo + (hi - lo) * (0.2 + unit * 0.6);
  return Math.round(value * 100) / 100;
}
