import { env } from './env.js';
import { logger } from './logger.js';
import { getPaymentProvider } from '../providers/payment/index.js';
import { getHardwareSimProvider } from '../providers/sim/index.js';
import { isBedrockConfigured } from '../services/llmService.js';

/**
 * One loud, greppable line per external dependency at boot.
 *
 * Wireup is mock-first: every external vendor has one interface and two
 * implementations. This banner makes it impossible to be confused about
 * which side is live — the M0 check ("no keys set → all three mocks
 * active") is literally read off this output.
 */
export function logAdapterBanner(): void {
  const payment = getPaymentProvider();
  const sim = getHardwareSimProvider();

  const llm = isBedrockConfigured()
    ? {
        adapter: 'BedrockAdapter',
        mode: 'real' as const,
        detail: `model ${env.BEDROCK_MODEL} (${env.AWS_REGION})`,
      }
    : {
        adapter: 'MockLLMProvider',
        mode: 'mock' as const,
        detail:
          'no AWS Bedrock credentials — builds run the deterministic knowledge-base engine',
      };

  const rows = [
    { dependency: 'payments', adapter: payment.constructor.name, mode: payment.mode, detail: payment.describe() },
    { dependency: 'hardware-sim', adapter: sim.constructor.name, mode: sim.mode, detail: sim.describe() },
    { dependency: 'llm', adapter: llm.adapter, mode: llm.mode, detail: llm.detail },
  ];

  const mockCount = rows.filter((row) => row.mode === 'mock').length;

  logger.info(
    { adapters: rows, mocksActive: mockCount, total: rows.length },
    `Wireup adapters ready — ${mockCount}/${rows.length} running against mocks`,
  );
  for (const row of rows) {
    logger.info(`  adapter[${row.dependency}] = ${row.adapter} (${row.mode}) — ${row.detail}`);
  }
  if (mockCount === rows.length) {
    logger.info('ALL MOCKS ACTIVE — no external credentials configured. Set the *_MODE flags and keys in .env to go live.');
  }
}
