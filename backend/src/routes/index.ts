import { Router } from 'express';

import architectureRoutes from './architectureRoutes.js';
import healthRoutes from './healthRoutes.js';
import projectRoutes from './projectRoutes.js';

const router = Router();

router.use(healthRoutes);
router.use(architectureRoutes);
router.use(projectRoutes);

export default router;