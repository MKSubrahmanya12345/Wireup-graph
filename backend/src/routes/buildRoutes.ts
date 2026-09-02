import { Router } from 'express';

import { getScaffold } from '../controllers/buildController.js';
import { buildRateLimiter } from '../middleware/rateLimiter.js';
import {
  agenticBufferedEndpoint,
  agenticJobEndpoint,
  agenticJobStreamEndpoint,
  agenticStreamEndpoint,
  cancelAgenticJobEndpoint,
  latestAgenticJobEndpoint,
  listAgenticJobsEndpoint,
  startAgenticJobEndpoint,
} from '../controllers/agenticController.js';

const router = Router();

// Scaffold inspection is free (no LLM), but cap it lightly anyway.
router.get('/build/scaffold', getScaffold);

// ── Wireup agentic pipeline (deterministic core, optional LLM assist) ──────
// A build is a server-side JOB: start it once, then attach from as many pages
// as you like. That is what lets the simulator page run the generated website
// while the firmware is still being written, and what lets a refresh resume.
router.post('/build/agentic/jobs', buildRateLimiter, startAgenticJobEndpoint);
router.get('/build/agentic/jobs', listAgenticJobsEndpoint);
router.get('/build/agentic/jobs/latest', latestAgenticJobEndpoint);
router.get('/build/agentic/jobs/:jobId', agenticJobEndpoint);
router.get('/build/agentic/jobs/:jobId/stream', agenticJobStreamEndpoint);
router.post('/build/agentic/jobs/:jobId/cancel', cancelAgenticJobEndpoint);

// Legacy shapes, kept working: the stream variant now starts a job and tails
// it, so a dropped connection no longer throws the build away.
router.post('/build/agentic', buildRateLimiter, agenticBufferedEndpoint);
router.post('/build/agentic/stream', buildRateLimiter, agenticStreamEndpoint);

export default router;
