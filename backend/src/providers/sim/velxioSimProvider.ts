import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { DeviceBuildPlan } from '../../agentic/types.js';
import type { HardwareSimProvider, SimCheck, SimResult } from './types.js';

/**
 * VelxioSimProvider — thin real adapter for a Velxio simulation pipeline
 * (https://github.com/davidmonterocrespo24/velxio).
 *
 * The Velxio pipeline was not found inside this repository, so this adapter
 * talks to it over HTTP at VELXIO_URL:
 *
 *   POST {VELXIO_URL}/simulate
 *     { plan: <DeviceBuildPlan>, format: 'wireup-plan@1' }
 *   → { ok, checks?: [{name, ok, detail}], log?: string[], runUrl? }
 *
 * Anything unexpected is reported as `errored: true` — a provider failure is
 * never silently downgraded into "hardware not ready" or, worse, skipped.
 */
export class VelxioSimProvider implements HardwareSimProvider {
  readonly mode = 'velxio' as const;

  constructor(private readonly baseUrl: string) {}

  describe(): string {
    return `VelxioSimProvider (real adapter → ${this.baseUrl})`;
  }

  async runSim(plan: DeviceBuildPlan): Promise<SimResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.VELXIO_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/simulate`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(env.VELXIO_API_KEY ? { Authorization: `Bearer ${env.VELXIO_API_KEY}` } : {}),
        },
        body: JSON.stringify({ format: 'wireup-plan@1', plan }),
      });

      const text = await response.text();
      if (!response.ok) {
        return this.errorResult(started, [
          `velxio: HTTP ${response.status}`,
          text.slice(0, 500),
        ]);
      }

      const payload = JSON.parse(text) as {
        ok?: boolean;
        checks?: SimCheck[];
        log?: string[];
        runUrl?: string;
      };
      const checks = Array.isArray(payload.checks) ? payload.checks : [];
      const ok = payload.ok ?? checks.every((check) => check.ok);
      logger.info({ slug: plan.slug, ok }, 'velxio hardware sim finished');
      return {
        provider: 'velxio',
        ok,
        errored: false,
        checks: checks.length > 0 ? checks : [{ name: 'velxio run', ok, detail: ok ? 'passed' : 'failed' }],
        log: Array.isArray(payload.log) ? payload.log : [`velxio: run finished (ok=${ok})`],
        durationMs: Date.now() - started,
        runUrl: payload.runUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.errorResult(started, [`velxio: request failed — ${message}`]);
    } finally {
      clearTimeout(timer);
    }
  }

  private errorResult(started: number, log: string[]): SimResult {
    logger.error({ log }, 'velxio hardware sim errored');
    return {
      provider: 'velxio',
      ok: false,
      errored: true,
      checks: [{ name: 'velxio reachable', ok: false, detail: log.join(' ') }],
      log,
      durationMs: Date.now() - started,
    };
  }
}

export function velxioConfigured(): boolean {
  return Boolean(env.VELXIO_URL);
}
