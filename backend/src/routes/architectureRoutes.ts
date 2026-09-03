import { Router } from 'express';

import {
  interpretBrief,
  planArchitecture,
  repairArchitecture,
  // ??$$$ SpecGraph controller functions
  generateSpecGraph,
  answerSpecGraph,
  getSpecGraphManifest,
  getSpecGraphBranch,
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
// §2 reads: the manifest, or one branch + its direct requires neighbours.
// No LLM spend — deterministic disk reads, so no credit rate limit.
router.get('/architecture/spec-graph/:projectId', getSpecGraphManifest);
router.get('/architecture/spec-graph/:projectId/nodes/:branchId', getSpecGraphBranch);

// Deterministic graph repair — no LLM spend, so no credit rate limit.
router.post('/architecture/repair', repairArchitecture);

// Rate limited: every call here spends real Cloudflare credits.
router.post('/architecture/render', renderRateLimiter, renderArchitectureImage);

export default router;
