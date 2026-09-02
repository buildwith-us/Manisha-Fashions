/**
 * Transport-agnostic application error. The error handler turns these into the
 * standard JSON envelope; anything that is not an ApiError becomes a 500 with
 * its detail withheld from the client.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? defaultCodeFor(statusCode);
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, code);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, message, 'FORBIDDEN');
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, 'NOT_FOUND');
  }

  static conflict(message: string, details?: unknown) {
    return new ApiError(409, message, 'CONFLICT', details);
  }

  static tooManyRequests(message = 'Too many requests, please try again later', details?: unknown) {
    return new ApiError(429, message, 'RATE_LIMITED', details);
  }

  static serviceUnavailable(message: string) {
    return new ApiError(503, message, 'SERVICE_UNAVAILABLE');
  }

  static internal(message = 'Something went wrong') {
    return new ApiError(500, message, 'INTERNAL_ERROR');
  }
}

function defaultCodeFor(statusCode: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
    503: 'SERVICE_UNAVAILABLE',
  };
  return map[statusCode] ?? 'ERROR';
}
