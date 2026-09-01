import { randomUUID } from 'node:crypto';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { DeviceBuildPlan } from '../../agentic/types.js';
import type { HardwareSimProvider, SimCheck, SimContext, SimResult } from './types.js';
import { normalizeWifiForEmulator } from '../../agentic/velxioProject.js';

/**
 * VelxioSimProvider — REAL adapter for the vendored Velxio emulator
 * (external/velxio, https://github.com/davidmonterocrespo24/velxio).
 *
 * This speaks Velxio's actual API — the same one its own frontend uses — not
 * an invented contract:
 *
 *   1. COMPILE  POST {VELXIO_URL}/api/compile/start
 *                 { files:[{name,content}…], board_fqbn, libraries, … }
 *               → { job_id }, then poll GET /api/compile/status/{job_id}
 *               until state is done/error. (Falls back to the synchronous
 *               POST /api/compile/ if /start is not available.)
 *
 *   2. BOOT     WebSocket {VELXIO_URL→ws}/api/simulation/ws/{client_id}
 *               → { type:'start_esp32', data:{ board, firmware_b64,
 *                   sensors:[], wifi_enabled } }
 *               then watch { type:'serial_output' } events until the
 *               firmware prints its HTTP-server line (the same
 *               "listening on port" marker the Wokwi gate asserts), or
 *               the boot window closes.
 *
 * Verdict semantics (same contract as the mock):
 *   ok:false, errored:false — the FIRMWARE failed (compile error, boot
 *                             timeout). A legitimate red verdict.
 *   errored:true            — VELXIO itself failed (unreachable, HTTP 5xx,
 *                             WS refused). Surfaced loudly, downloads lock.
 */

/** The serial line the generated firmware prints once Wi-Fi + HTTP are up. */
const EXPECT_TEXT = 'listening on port';

/** Wireup board id → Velxio board kind + arduino-cli FQBN. */
function velxioBoard(plan: DeviceBuildPlan): { kind: string; fqbn: string } {
  switch (plan.board.id) {
    case 'esp32-s3-devkit':
      return { kind: 'esp32-s3', fqbn: 'esp32:esp32:esp32s3' };
    case 'esp32-devkit-v1':
    default:
      return { kind: 'esp32', fqbn: 'esp32:esp32:esp32' };
  }
}

interface CompileResponsePayload {
  success: boolean;
  hex_content?: string | null;
  binary_content?: string | null;
  binary_type?: string | null;
  has_wifi?: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
}

/** Last N non-empty lines of a build log, joined for a check detail. */
function tail(text: string | undefined | null, lines = 6, max = 500): string {
  if (!text) return '';
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-lines).join(' | ').slice(0, max);
}

export class VelxioSimProvider implements HardwareSimProvider {
  readonly mode = 'velxio' as const;

  constructor(private readonly baseUrl: string) {}

  describe(): string {
    return `VelxioSimProvider (real emulator → ${this.baseUrl}: arduino-cli compile + QEMU boot over /api/simulation/ws)`;
  }

  private get base(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(env.VELXIO_API_KEY ? { Authorization: `Bearer ${env.VELXIO_API_KEY}` } : {}),
    };
  }

  async runSim(plan: DeviceBuildPlan, context?: SimContext): Promise<SimResult> {
    const started = Date.now();
    const log: string[] = [];
    const checks: SimCheck[] = [];
    const board = velxioBoard(plan);

    // ── The firmware to run: the pipeline's own artifacts ──────────────────
    const sources = this.firmwareSources(plan, context);
    if (!sources) {
      return this.errorResult(started, [
        'velxio: no firmware sources were handed to the simulator (pipeline passed no files and none could be derived)',
      ]);
    }
    log.push(
      `velxio: compiling ${sources.map((f) => f.name).join(', ')} for ${board.fqbn} at ${this.base}/api/compile`,
    );

    // ── 0. Make sure the declared libraries exist on the Velxio side ───────
    // (DHT, Adafruit SSD1306, …). Velxio resolves #includes against its own
    // installed-library dir; a fresh install has none of them. Best-effort:
    // install is idempotent, and a failure here surfaces as the compile's
    // own "No such file or directory" diagnostic anyway.
    const libraries = [...new Set(plan.modules.flatMap((m) => m.libraries.map((lib) => lib.name)))];
    for (const name of libraries) {
      try {
        const install = await fetch(`${this.base}/api/libraries/install`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ name }),
          signal: AbortSignal.timeout(120_000),
        });
        const payload = (await install.json().catch(() => ({}))) as { success?: boolean; error?: string | null };
        log.push(
          install.ok && payload.success !== false
            ? `velxio: library "${name}" available`
            : `velxio: library "${name}" install failed — ${payload.error ?? `HTTP ${install.status}`} (compile will show the missing header if it matters)`,
        );
      } catch (error) {
        log.push(
          `velxio: library "${name}" install skipped — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }


    // ── 1. Compile with the real toolchain ─────────────────────────────────
    let compiled: CompileResponsePayload;
    try {
      compiled = await this.compile(sources, board, plan, log);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.errorResult(started, [...log, `velxio: compile request failed — ${message}`]);
    }

    if (!compiled.success) {
      checks.push({
        name: 'velxio compile (arduino-cli, real ESP32 toolchain)',
        ok: false,
        detail: tail(compiled.stderr || compiled.error || compiled.stdout) || 'compile failed with no diagnostics',
      });
      log.push('velxio: compile FAILED — this is a firmware verdict, not a provider error');
      for (const line of (compiled.stderr ?? '').split('\n').filter(Boolean).slice(-10)) log.push(`  ${line}`);
      return {
        provider: 'velxio',
        ok: false,
        errored: false,
        checks,
        log,
        durationMs: Date.now() - started,
      };
    }

    checks.push({
      name: 'velxio compile (arduino-cli, real ESP32 toolchain)',
      ok: true,
      detail: `Real ${board.fqbn} binary produced (${compiled.binary_type ?? 'bin'}${compiled.has_wifi ? ', Wi-Fi sketch detected' : ''})`,
    });
    log.push('velxio: compile OK — real ESP32 binary produced');

    const firmwareB64 = compiled.binary_content ?? compiled.hex_content ?? null;
    if (!firmwareB64) {
      return this.errorResult(started, [
        ...log,
        'velxio: compile reported success but returned no binary_content — cannot boot',
      ]);
    }

    // ── 2. Boot it in the emulator and watch serial ────────────────────────
    let boot: { ok: boolean; serial: string; error: string | null; providerError: boolean };
    try {
      boot = await this.bootAndWatch(firmwareB64, board.kind, Boolean(compiled.has_wifi), log);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.errorResult(started, [...log, `velxio: simulation websocket failed — ${message}`], checks);
    }

    if (boot.providerError) {
      return this.errorResult(started, [...log, `velxio: emulator error — ${boot.error}`], checks);
    }

    checks.push({
      name: `velxio boot (QEMU ${board.kind}) reaches "${EXPECT_TEXT}"`,
      ok: boot.ok,
      detail: boot.ok
        ? 'Firmware booted in the emulator and brought its HTTP server up'
        : `Firmware never reached "${EXPECT_TEXT}" within ${Math.round(env.VELXIO_TIMEOUT_MS / 1000)}s. Serial tail: ${tail(boot.serial) || '(no serial output)'}`,
    });

    const result: SimResult = {
      provider: 'velxio',
      ok: boot.ok,
      errored: false,
      checks,
      log,
      durationMs: Date.now() - started,
      runUrl: env.VELXIO_EMBED_URL ?? this.baseUrl,
    };
    logger.info({ slug: plan.slug, ok: result.ok, durationMs: result.durationMs }, 'velxio hardware sim finished');
    return result;
  }

  /** The .ino + local headers to compile — from the pipeline's artifacts. */
  private firmwareSources(
    plan: DeviceBuildPlan,
    context?: SimContext,
  ): { name: string; content: string }[] | null {
    const files = context?.firmwareFiles ?? [];
    const ino = files.find((f) => f.path.endsWith('.ino'));
    if (!ino) return null;
    const sources = [{ name: ino.path.split('/').pop() ?? `${plan.slug}.ino`, content: ino.content }];
    for (const file of files) {
      if (file.path.endsWith('.h') && file.path.startsWith('firmware/')) {
        sources.push({ name: file.path.split('/').pop() ?? 'config.h', content: file.content });
      }
    }
    // QEMU has exactly one AP ("Espressif", open). Velxio only rewrites the
    // entry sketch; our credentials live in config.h — normalise them here so
    // the emulated board genuinely joins the network and its web server is
    // reachable through Velxio's IoT gateway.
    return normalizeWifiForEmulator(sources);
  }

  /** Async job API first (survives long first-time core builds), sync fallback. */
  private async compile(
    files: { name: string; content: string }[],
    board: { kind: string; fqbn: string },
    plan: DeviceBuildPlan,
    log: string[],
  ): Promise<CompileResponsePayload> {
    const libraries = [...new Set(plan.modules.flatMap((m) => m.libraries.map((lib) => lib.name)))];
    const body = JSON.stringify({
      files,
      board_fqbn: board.fqbn,
      board_kind: board.kind,
      libraries: libraries.length > 0 ? libraries : null,
      initiated_by: 'agent',
    });

    const start = await fetch(`${this.base}/api/compile/start`, {
      method: 'POST',
      headers: this.headers(),
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (start.status === 404 || start.status === 405) {
      // Older Velxio without the async job API — one synchronous call.
      log.push('velxio: /api/compile/start not available, using synchronous /api/compile/');
      const sync = await fetch(`${this.base}/api/compile/`, {
        method: 'POST',
        headers: this.headers(),
        body,
        signal: AbortSignal.timeout(env.VELXIO_COMPILE_TIMEOUT_MS),
      });
      if (!sync.ok) throw new Error(`HTTP ${sync.status} from /api/compile/: ${(await sync.text()).slice(0, 300)}`);
      return (await sync.json()) as CompileResponsePayload;
    }
    if (!start.ok) {
      throw new Error(`HTTP ${start.status} from /api/compile/start: ${(await start.text()).slice(0, 300)}`);
    }

    const { job_id: jobId } = (await start.json()) as { job_id: string };
    log.push(`velxio: compile job ${jobId} queued — polling (first ESP32 build can take minutes)`);

    const deadline = Date.now() + env.VELXIO_COMPILE_TIMEOUT_MS;
    let lastLoggedLen = 0;
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(`compile job ${jobId} did not finish within ${Math.round(env.VELXIO_COMPILE_TIMEOUT_MS / 1000)}s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const poll = await fetch(`${this.base}/api/compile/status/${jobId}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(30_000),
      });
      if (!poll.ok) throw new Error(`HTTP ${poll.status} polling compile job ${jobId}`);
      const status = (await poll.json()) as {
        state: 'pending' | 'running' | 'done' | 'error';
        stdout?: string;
        result?: CompileResponsePayload | null;
        error?: string | null;
      };
      // Stream the build log into the terminal as it grows.
      const stdout = status.stdout ?? '';
      if (stdout.length > lastLoggedLen) {
        for (const line of stdout.slice(lastLoggedLen).split('\n').filter(Boolean).slice(-3)) {
          log.push(`  [build] ${line.trim().slice(0, 160)}`);
        }
        lastLoggedLen = stdout.length;
      }
      if (status.state === 'done' && status.result) return status.result;
      if (status.state === 'error') {
        return { success: false, error: status.error ?? 'compile job errored', stdout, stderr: status.error ?? '' };
      }
    }
  }

  /** Open the sim WebSocket, start the board, watch serial for the marker. */
  private bootAndWatch(
    firmwareB64: string,
    boardKind: string,
    wifiEnabled: boolean,
    log: string[],
  ): Promise<{ ok: boolean; serial: string; error: string | null; providerError: boolean }> {
    if (typeof WebSocket === 'undefined') {
      return Promise.reject(
        new Error('this Node runtime has no global WebSocket (need Node >= 22) — cannot drive the Velxio emulator'),
      );
    }
    const wsUrl = `${this.base.replace(/^http/, 'ws')}/api/simulation/ws/${encodeURIComponent(`wireup-${randomUUID()}`)}`;
    log.push(`velxio: booting ${boardKind} over ${wsUrl} (wifi=${wifiEnabled})`);

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      let serial = '';
      let settled = false;
      let serialLines = 0;

      const finish = (outcome: { ok: boolean; error: string | null; providerError: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.send(JSON.stringify({ type: 'stop_esp32', data: {} }));
        } catch {
          /* already closed */
        }
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        resolve({ ...outcome, serial });
      };

      const timer = setTimeout(() => {
        log.push(`velxio: boot window (${Math.round(env.VELXIO_TIMEOUT_MS / 1000)}s) closed without "${EXPECT_TEXT}"`);
        finish({ ok: false, error: null, providerError: false });
      }, env.VELXIO_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            type: 'start_esp32',
            data: {
              board: boardKind,
              firmware_b64: firmwareB64,
              sensors: [],
              wifi_enabled: wifiEnabled,
            },
          }),
        );
      });

      socket.addEventListener('message', (event: MessageEvent) => {
        let message: { type?: string; data?: Record<string, unknown> };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === 'serial_output') {
          const chunk = String(message.data?.data ?? '');
          serial += chunk;
          // Mirror the interesting serial lines into the build terminal.
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && serialLines < 40) {
              log.push(`  [serial] ${trimmed.slice(0, 160)}`);
              serialLines += 1;
            }
          }
          if (serial.includes(EXPECT_TEXT)) {
            log.push(`velxio: firmware reached "${EXPECT_TEXT}" — boot verified`);
            finish({ ok: true, error: null, providerError: false });
          }
        } else if (message.type === 'error') {
          const detail = String(message.data?.message ?? 'unknown emulator error');
          log.push(`velxio: emulator reported: ${detail}`);
          finish({ ok: false, error: detail, providerError: true });
        }
      });

      socket.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`could not connect to ${wsUrl}`));
      });

      socket.addEventListener('close', () => {
        // Server closed on us before a verdict → count what we saw.
        finish({ ok: serial.includes(EXPECT_TEXT), error: null, providerError: false });
      });
    });
  }

  private errorResult(started: number, log: string[], priorChecks: SimCheck[] = []): SimResult {
    logger.error({ log: log.slice(-4) }, 'velxio hardware sim errored');
    return {
      provider: 'velxio',
      ok: false,
      errored: true,
      checks: [
        ...priorChecks,
        { name: 'velxio reachable', ok: false, detail: log[log.length - 1] ?? 'unknown provider failure' },
      ],
      log,
      durationMs: Date.now() - started,
    };
  }
}

export function velxioConfigured(): boolean {
  return Boolean(env.VELXIO_URL);
}
