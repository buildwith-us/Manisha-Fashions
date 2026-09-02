import path from 'path';
import compression from 'compression';
import cors from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProduction } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { generalLimiter } from './middleware/rateLimiter';
import { responseFormatter } from './middleware/responseFormatter';
import routes from './routes';
import webhookRoutes from './routes/webhook.routes';

/**
 * Assembles the middleware pipeline described in PRD 8.6, in this fixed order:
 *
 *   Nginx (SSL/HTTPS, outside this process)
 *     → Express Router
 *     → Request Validation (Zod)      ─┐ per-route, in routes/*.ts
 *     → Rate Limiter                   │
 *     → JWT Authentication             │
 *     → Role & Permission Check (RBAC) ─┘
 *     → Controller → Service → Repository → MongoDB
 *     → Response Formatter → JSON
 */
export function createApp(): Application {
  const app = express();

  // Nginx terminates TLS and forwards; trust its X-Forwarded-* so req.ip is the
  // real client and rate limiting is not keyed on the proxy (PRD 2 / 8.6).
  app.set('trust proxy', Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY));
  app.disable('x-powered-by');

  // ── Security headers (PRD 8.11) ──
  app.use(helmet());
  app.use(
    cors({
      // CORS is locked to known origins; the mobile app sends no Origin header,
      // so an empty allow-list still serves the app but blocks browsers.
      origin(origin, callback) {
        if (!origin || env.CORS_ORIGINS.length === 0 || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  /**
   * Stand-in product photography (PRD 8.3 says images belong in Cloudinary).
   *
   * Cloudinary is the real home for these: it does the resizing and format
   * negotiation, and it keeps image bytes off the API process. Until those
   * credentials exist, the demo catalogue would otherwise render as grey
   * boxes, so the files in public/ are served directly.
   *
   * Lives outside `${env.API_PREFIX}` because it is not part of the API, and
   * outside src/ because tsc only emits .ts — nothing here needs building.
   * Replace with Cloudinary URLs and this mount can go.
   */
  app.use(
    '/static',
    express.static(path.resolve(process.cwd(), 'public'), {
      maxAge: isProduction ? '7d' : 0,
      // The directory holds only product photography; never let a miss fall
      // through to the API's 404 handler as an index listing.
      index: false,
      redirect: false,
    }),
  );

  // ── Webhooks: mounted before the JSON parser's normal path so the raw body
  // survives for HMAC verification (PRD 4.4). ──
  app.use(
    `${env.API_PREFIX}/webhooks`,
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        (req as express.Request).rawBody = Buffer.from(buffer);
      },
    }),
    webhookRoutes,
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(responseFormatter);

  // ── Rate limiting across all public endpoints (PRD 8.11) ──
  app.use(env.API_PREFIX, generalLimiter);

  app.use(env.API_PREFIX, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
