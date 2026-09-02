import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { ApiError } from '../utils/ApiError';

export interface RequestSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * PRD 8.6 — Request Validation stage, and PRD 8.11 "all input validated
 * server-side before it touches the database".
 *
 * Validated output replaces the raw input, so downstream code always sees
 * coerced, trimmed, schema-shaped values rather than whatever arrived.
 */
export function validate(schemas: RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) {
        // Express 5 makes req.query a getter; assign onto a writable copy.
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', { value: parsedQuery, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        }));
        next(new ApiError(422, 'Validation failed', 'VALIDATION_ERROR', details));
        return;
      }
      next(error);
    }
  };
}
