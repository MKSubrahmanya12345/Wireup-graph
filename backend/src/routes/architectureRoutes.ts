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
router.post('/architecture/interpret', (req, res, next) => {
  console.log('[architectureRoutes] /interpret route hit');
  console.log('[architectureRoutes] Body:', JSON.stringify(req.body).slice(0, 200));
  next();
}, planRateLimiter, interpretBrief);
router.post('/architecture/plan', planRateLimiter, planArchitecture);

// Deterministic graph repair — no LLM spend, so no credit rate limit.
router.post('/architecture/repair', repairArchitecture);

// Rate limited: every call here spends real Cloudflare credits.
router.post('/architecture/render', renderRateLimiter, renderArchitectureImage);

export default router;
