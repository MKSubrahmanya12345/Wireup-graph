import { Router } from 'express';

import {
  interpretBrief,
  planArchitecture,
  repairArchitecture,
} from '../controllers/architectureController.js';
import { renderArchitectureImage } from '../controllers/renderController.js';
import { planRateLimiter, renderRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Rate limited: every call here spends real Groq credits.
router.post('/architecture/interpret', planRateLimiter, interpretBrief);
router.post('/architecture/plan', planRateLimiter, planArchitecture);

// Deterministic graph repair — no LLM spend, so no credit rate limit.
router.post('/architecture/repair', repairArchitecture);

// Rate limited: every call here spends real Cloudflare credits.
router.post('/architecture/render', renderRateLimiter, renderArchitectureImage);

export default router;
