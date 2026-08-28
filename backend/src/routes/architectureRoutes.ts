import { Router } from 'express';

import {
  interpretBrief,
  planArchitecture,
} from '../controllers/architectureController.js';
import { planRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Rate limited: every call here spends real Groq credits.
router.post('/architecture/interpret', planRateLimiter, interpretBrief);
router.post('/architecture/plan', planRateLimiter, planArchitecture);

export default router;
