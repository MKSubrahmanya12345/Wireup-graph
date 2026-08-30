import { Router } from 'express';

import {
  buildAllEndpoint,
  buildFirmwareEndpoint,
  buildWebsiteEndpoint,
  getScaffold,
  websiteRequirementsEndpoint,
} from '../controllers/buildController.js';
import { buildRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Scaffold inspection is free (no LLM), but cap it lightly anyway.
router.get('/build/scaffold', getScaffold);

// Every other endpoint spends Groq credits.
router.post('/build/firmware', buildRateLimiter, buildFirmwareEndpoint);
router.post('/build/website-requirements', buildRateLimiter, websiteRequirementsEndpoint);
router.post('/build/website', buildRateLimiter, buildWebsiteEndpoint);
router.post('/build/all', buildRateLimiter, buildAllEndpoint);

export default router;
