import { Router } from 'express';

import architectureRoutes from './architectureRoutes.js';
import authRoutes from './authRoutes.js';
import buildRoutes from './buildRoutes.js';
import healthRoutes from './healthRoutes.js';
import projectRoutes from './projectRoutes.js';
import validationRoutes from './validationRoutes.js';
import { requireAuth } from '../auth/authMiddleware.js';

const router = Router();

// Open: health + auth.
router.use(healthRoutes);
router.use(authRoutes);

// Everything below needs a Wireup session — these routes do the paid/heavy work.
router.use(requireAuth);
router.use(architectureRoutes);
router.use(buildRoutes);
router.use(projectRoutes);
router.use(validationRoutes);

export default router;