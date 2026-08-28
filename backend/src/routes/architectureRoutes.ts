import { Router } from 'express';

import {
  interpretBrief,
  planArchitecture,
} from '../controllers/architectureController.js';
import { renderArchitectureImage } from '../controllers/renderController.js';
import { planRateLimiter, renderRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Rate limited: every call here spends real Groq credits.
router.post('/architecture/interpret', planRateLimiter, interpretBrief);
router.post('/architecture/plan', planRateLimiter, planArchitecture);

// Rate limited: every call here spends real Cloudflare credits.
router.post('/architecture/render', renderRateLimiter, renderArchitectureImage);

export default router;
