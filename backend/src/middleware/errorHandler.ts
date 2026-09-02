import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { isProduction } from '../config/env';
import { logger } from '../config/logger';
import { ApiError } from '../utils/ApiError';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Terminal error stage. Everything leaves as:
 *   { "success": false, "error": { "code", "message", "details"? } }
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let apiError: ApiError;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof mongoose.Error.ValidationError) {
    apiError = new ApiError(
      422,
      'Validation failed',
      'VALIDATION_ERROR',
      Object.values(error.errors).map((fieldError) => ({
        field: fieldError.path,
        message: fieldError.message,
      })),
    );
  } else if (error instanceof mongoose.Error.CastError) {
    apiError = ApiError.badRequest(`Invalid value for '${error.path}'`);
  } else if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? 'field';
    apiError = ApiError.conflict(`A record with this ${field} already exists`);
  } else {
    apiError = ApiError.internal();
  }

  if (apiError.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} → ${apiError.statusCode}`, error);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} → ${apiError.statusCode} ${apiError.code}`);
  }

  res.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      // Stack traces are development-only; never leak internals to a client.
      ...(!isProduction && !(error instanceof ApiError) && error instanceof Error
        ? { debug: error.message }
        : {}),
    },
  });
}

function isDuplicateKeyError(
  error: unknown,
): error is { code: number; keyPattern?: Record<string, unknown> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 11000
  );
}
