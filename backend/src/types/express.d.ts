import type { AuthenticatedUser } from './index';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the JWT authentication middleware (PRD 8.8). */
      user?: AuthenticatedUser;
      /** Raw body buffer, captured only on the Razorpay webhook route for signature verification. */
      rawBody?: Buffer;
    }

    interface Response {
      /** Standard success envelope — see middleware/responseFormatter.ts. */
      success<T>(data: T, meta?: Record<string, unknown>, statusCode?: number): Response;
    }
  }
}

export {};
