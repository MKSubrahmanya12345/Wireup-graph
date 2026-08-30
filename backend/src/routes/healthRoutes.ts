import { Router } from 'express';

import { healthCheck, toolchainCheck } from '../controllers/healthController.js';

const router = Router();

router.get('/healthz', healthCheck);
router.get('/healthz/toolchain', toolchainCheck);

export default router;