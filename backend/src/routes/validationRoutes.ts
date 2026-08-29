import { Router } from 'express';

import {
  runValidationLoopEndpoint,
  getGraphDSAEndpoint,
  listPerfectGraphDSAsEndpoint,
  checkPerfectStatusEndpoint,
} from '../controllers/validationController.js';

const router = Router();

router.post('/validation/loop', runValidationLoopEndpoint);
router.get('/validation/dsa/perfect', listPerfectGraphDSAsEndpoint);
router.get('/validation/dsa/:id', getGraphDSAEndpoint);
router.post('/validation/check-perfect', checkPerfectStatusEndpoint);

export default router;
