/**
 * PRD Export Controller — exports the verified Graph DSA as a PRD file.
 */
import type { Request, Response } from 'express';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { GraphDSA } from '../models/GraphDSA.js';
import { isPersistenceEnabled } from '../config/db.js';

export const exportGraphDSAEndpoint = asyncHandler(async (req: Request, res: Response) => {
  if (!isPersistenceEnabled()) {
    throw ApiError.serviceUnavailable('Persistence disabled. Set MONGO_URI.');
  }
  const { id } = req.params;
  const doc = await GraphDSA.findById(id).lean();
  if (!doc) throw ApiError.notFound('Graph DSA not found.');

  const filename = `graph-dsa-${doc.projectName?.toLowerCase().replace(/\s+/g, '-') ?? 'project'}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).json({
    graphDSA: doc,
    exportFormat: 'graph-dsa-v1.0.0',
    exportDate: new Date().toISOString(),
    note: 'Verified architecture PRD for agentic coding agents.',
  });
});
