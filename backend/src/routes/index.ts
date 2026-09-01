import { Router } from 'express';

import adminRoutes from './adminRoutes.js';
import architectureRoutes from './architectureRoutes.js';
import authRoutes from './authRoutes.js';
import billingRoutes from './billingRoutes.js';
import buildRoutes from './buildRoutes.js';
import configRoutes from './configRoutes.js';
import demoRoutes from './demoRoutes.js';
import healthRoutes from './healthRoutes.js';
import projectRoutes from './projectRoutes.js';
import { previewRouter } from '../agentic/preview.js';
import { requireAuth } from '../auth/authMiddleware.js';

const router = Router();

// Open: health + auth.
router.use(healthRoutes);
router.use(authRoutes);

// Config endpoint (available without auth for UI setup).
router.use(configRoutes);

// The canonical demo project (weather station) — the one-click product tour
// from the landing page straight to page 04. Deterministic, user-agnostic.
router.use(demoRoutes);

// Live dashboard previews. Unauthenticated by necessity — an <iframe> cannot
// send the Bearer token — and guarded instead by a 12-byte random id that
// only the build's own result carries.
router.use(previewRouter());

// Billing: the provider webhook is unauthenticated by necessity (the payment
// provider has no Wireup session); the other billing routes gate themselves.
router.use(billingRoutes);

// Admin: gates itself with requireAuth + requireAdmin.
router.use(adminRoutes);

// Everything below needs a Wireup session — these routes do the paid/heavy work.
router.use(requireAuth);
router.use(architectureRoutes);
router.use(buildRoutes);
router.use(projectRoutes);

export default router;