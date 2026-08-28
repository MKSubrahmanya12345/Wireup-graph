import mongoose from 'mongoose';
import type { Request, Response } from 'express';

import { isPersistenceEnabled } from '../config/db.js';
import { Project } from '../models/Project.js';
import { createProjectBodySchema } from '../schemas/architecture.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';

function requirePersistence(): void {
  if (!isPersistenceEnabled()) {
    throw new ApiError(
      503,
      'Persistence is disabled. Set MONGO_URI in backend/.env to enable saved projects.',
    );
  }
}

/** GET /api/projects */
export const listProjects = asyncHandler(async (_req: Request, res: Response) => {
  requirePersistence();

  const projects = await Project.find()
    .sort({ updatedAt: -1 })
    .limit(50)
    .select('name summary graph.nodes updatedAt')
    .lean();

  res.status(200).json(
    projects.map((project) => ({
      id: String(project._id),
      name: project.name,
      summary: project.summary,
      nodeCount: Array.isArray((project.graph as { nodes?: unknown[] })?.nodes)
        ? (project.graph as { nodes: unknown[] }).nodes.length
        : 0,
      updatedAt: project.updatedAt,
    })),
  );
});

/** POST /api/projects */
export const createProject = asyncHandler(async (req: Request, res: Response) => {
  requirePersistence();

  const parsed = createProjectBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw ApiError.badRequest('Invalid project payload.', parsed.error.flatten());

  const project = await Project.create(parsed.data);
  res.status(201).json({
    id: String(project._id),
    name: project.name,
    summary: project.summary,
    nodeCount: 0,
    updatedAt: project.updatedAt,
  });
});

/** GET /api/projects/:id */
export const getProject = asyncHandler(async (req: Request, res: Response) => {
  requirePersistence();

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid project id.');

  const project = await Project.findById(id).lean();
  if (!project) throw ApiError.notFound('Project not found.');

  res.status(200).json({
    id: String(project._id),
    name: project.name,
    summary: project.summary,
    nodeCount: Array.isArray((project.graph as { nodes?: unknown[] })?.nodes)
      ? (project.graph as { nodes: unknown[] }).nodes.length
      : 0,
    updatedAt: project.updatedAt,
    graph: project.graph,
    verification: project.verification ?? null,
    revisions: (project.revisions ?? []).map((revision) => ({
      id: String(revision._id),
      request: revision.request,
      createdAt: revision.createdAt,
    })),
  });
});

/** DELETE /api/projects/:id */
export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  requirePersistence();

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid project id.');

  const result = await Project.findByIdAndDelete(id);
  if (!result) throw ApiError.notFound('Project not found.');

  res.status(200).json({ ok: true });
});