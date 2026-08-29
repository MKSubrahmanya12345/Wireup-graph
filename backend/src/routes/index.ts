import { Router } from 'express';

import architectureRoutes from './architectureRoutes.js';
import healthRoutes from './healthRoutes.js';
import projectRoutes from './projectRoutes.js';
import validationRoutes from './validationRoutes.js';

const router = Router();

router.use(healthRoutes);
router.use(architectureRoutes);
router.use(projectRoutes);
router.use(validationRoutes);

export default router;