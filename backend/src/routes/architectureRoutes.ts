import { Router } from 'express';

import {
  interpretBrief,
  planArchitecture,
  repairArchitecture,
  // ??$$$ SpecGraph controller functions
  generateSpecGraph,
  answerSpecGraph,
} from '../controllers/architectureController.js';
import { renderArchitectureImage } from '../controllers/renderController.js';
import { planRateLimiter, renderRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Rate limited: every call here spends real Bedrock credits.
router.post('/architecture/interpret', planRateLimiter, interpretBrief);
router.post('/architecture/plan', planRateLimiter, planArchitecture);

// ??$$$ Hardware Spec Graph endpoints
router.post('/architecture/spec-graph', generateSpecGraph);
router.post('/architecture/spec-graph/answer', answerSpecGraph);

// Deterministic graph repair — no LLM spend, so no credit rate limit.
router.post('/architecture/repair', repairArchitecture);

// Rate limited: every call here spends real Cloudflare credits.
router.post('/architecture/render', renderRateLimiter, renderArchitectureImage);

export default router;
