import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '../middleware/errorHandler.js';
import { verifyToken, type TokenPayload } from './authService.js';

/**
 * Express augmentation: routes behind `requireAuth` can read `req.user`.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim() || null;
  return null;
}

/** Hard gate: a valid Wireup session is required. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    next(new ApiError(401, 'Log in to use Wireup.'));
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

/** Soft gate: attaches the user when present but never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      /* ignore invalid token for optional routes */
    }
  }
  next();
}
