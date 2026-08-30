import type { NextFunction, Request, Response } from 'express';

import { logger } from '../config/logger.js';
import { isProduction } from '../config/env.js';

/** Throw this from anywhere; the handler below turns it into a clean JSON reply. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static serviceUnavailable(message = 'Service unavailable') {
    return new ApiError(503, message);
  }

  static upstream(message: string) {
    return new ApiError(502, message);
  }
}

type Handler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

/**
 * Express 5 forwards rejected promises, but wrapping is explicit and keeps the
 * behaviour identical if this ever moves to Express 4.
 */
export const asyncHandler =
  (fn: Handler): Handler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) logger.error({ err }, err.message);
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error';
  logger.error({ err, url: req.originalUrl }, 'Unhandled error');

  res.status(500).json({
    error: isProduction ? 'Unexpected server error' : message,
  });
}