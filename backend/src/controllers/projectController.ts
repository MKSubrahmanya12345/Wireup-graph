import mongoose from 'mongoose';
import type { Request, Response } from 'express';

import { isPersistenceEnabled } from '../config/db.js';
import { Project, type ProjectDoc } from '../models/Project.js';
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

/**
 * Projects are per-account: a session only ever sees docs it owns. Legacy docs
 * created before accounts existed (ownerId '' / missing) remain reachable to
 * everyone rather than becoming dead data — and are claimed by whoever touches
 * them next (see claimOwnership).
 */
function ownerFilter(req: Request): Record<string, unknown> {
  const user = req.user;
  if (!user) return { ownerId: '__nobody__' };
  if (user.role === 'admin') return {};
  return { $or: [{ ownerId: user.sub }, { ownerId: '' }, { ownerId: { $exists: false } }] };
}

/** First touch of an unowned legacy doc claims it for this session. */
async function claimOwnership(project: ProjectDoc, req: Request): Promise<void> {
  if (!project.ownerId && req.user) {
    project.ownerId = req.user.sub;
  }
}

/** GET /api/projects — the signed-in user's projects, newest first. */
export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  requirePersistence();

  // The home list is strictly "mine" — even for admins. The admin console has
  // its own views; this page is a personal workbench.
  const ownerId = req.user?.sub ?? '__nobody__';
  const projects = await Project.find({ ownerId })
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

  const project = await Project.create({
    ...parsed.data,
    ownerId: req.user?.sub ?? '',
  });
  res.status(201).json({
    id: String(project._id),
    name: project.name,
    summary: project.summary,
    nodeCount: 0,
    updatedAt: project.updatedAt,
  });
});

async function findOwnedProject(req: Request, rawId: unknown): Promise<ProjectDoc | null> {
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw ApiError.badRequest('Invalid project id.');
  }
  return Project.findOne({ _id: id, ...ownerFilter(req) });
}

/** GET /api/projects/:id */
export const getProject = asyncHandler(async (req: Request, res: Response) => {
  requirePersistence();

  const project = await findOwnedProject(req, req.params.id);
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

  const project = await findOwnedProject(req, req.params.id);
  if (!project) throw ApiError.notFound('Project not found.');

  await Project.deleteOne({ _id: project._id });
  res.status(200).json({ ok: true });
});

export { claimOwnership };
