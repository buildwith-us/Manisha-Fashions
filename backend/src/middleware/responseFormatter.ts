import type { NextFunction, Request, Response } from 'express';

/**
 * PRD 8.6 — Response Formatter stage. Every successful response leaves the API
 * in one shape, so the mobile client can unwrap it in exactly one place.
 *
 *   { "success": true, "data": <payload>, "meta": { ... } }
 */
export function responseFormatter(_req: Request, res: Response, next: NextFunction): void {
  res.success = function success<T>(
    data: T,
    meta?: Record<string, unknown>,
    statusCode = 200,
  ): Response {
    return res.status(statusCode).json({
      success: true,
      data,
      ...(meta ? { meta } : {}),
    });
  };
  next();
}
