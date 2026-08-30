import { Router } from 'express';
import telemetryRoutes from './telemetry.js';

const router = Router();

router.use(telemetryRoutes);

export default router;
