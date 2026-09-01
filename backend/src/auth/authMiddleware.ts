import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '../middleware/errorHandler.js';
import { verifyToken, type TokenPayload } from './authService.js';
import { getUserStore } from './userStore.js';

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

/**
 * Role gate for /admin/*.
 *
 * 401 when there is no session at all, 403 when the session exists but is not
 * an admin — a non-admin must never be able to tell the two apart by luck.
 * The role is read from the signed token AND re-checked against the store, so
 * revoking an admin takes effect without waiting for the token to expire.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    next(new ApiError(401, 'Log in to use Wireup.'));
    return;
  }
  if (user.guest) {
    next(new ApiError(403, 'Admin access required.'));
    return;
  }
  void (async () => {
    try {
      const stored = await getUserStore().findById(user.sub);
      if (!stored || stored.role !== 'admin') {
        next(new ApiError(403, 'Admin access required.'));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  })();
}
