import { Router } from 'express';

import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
} from '../controllers/projectController.js';

const router = Router();

router.get('/projects', listProjects);
router.post('/projects', createProject);
router.get('/projects/:id', getProject);
router.delete('/projects/:id', deleteProject);

export default router;