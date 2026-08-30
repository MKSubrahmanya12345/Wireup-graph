import { Router } from 'express';

import { getScaffold } from '../controllers/buildController.js';
import { buildRateLimiter } from '../middleware/rateLimiter.js';
import { agenticBufferedEndpoint, agenticStreamEndpoint } from '../controllers/agenticController.js';

const router = Router();

// Scaffold inspection is free (no LLM), but cap it lightly anyway.
router.get('/build/scaffold', getScaffold);

// ── Wireup agentic pipeline (deterministic core, optional LLM assist) ──────
router.post('/build/agentic', buildRateLimiter, agenticBufferedEndpoint);
router.post('/build/agentic/stream', buildRateLimiter, agenticStreamEndpoint);

export default router;
