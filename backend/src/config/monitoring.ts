import * as Sentry from '@sentry/node';
import { scrubText, scrubValue } from '../utils/scrubPii';
import { env } from './env';
import { logger } from './logger';

/**
 * Error reporting to Sentry — off unless SENTRY_DSN is set.
 *
 * No personal data goes out: default PII is off, and every event has its
 * request body, cookies, headers and query string removed, the user reduced
 * to an id, and all remaining text scrubbed (utils/scrubPii.ts). Only server
 * faults (5xx) and crashes are reported; a customer's 4xx is not an error.
 */
let enabled = false;

export function initMonitoring(): void {
  if (!env.SENTRY_DSN || env.NODE_ENV === 'test') return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    // Collect nothing personal automatically (Sentry v11's replacement for
    // sendDefaultPii: false). beforeSend below strips whatever remains.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        event.request = { method: event.request.method, url: event.request.url && scrubText(event.request.url.split('?')[0]) };
      }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      if (event.message) event.message = scrubText(event.message);
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = scrubText(exception.value);
      }
      if (event.extra) event.extra = scrubValue(event.extra);
      if (event.contexts) event.contexts = scrubValue(event.contexts);
      if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((crumb) => scrubValue(crumb));
      return event;
    },
    beforeBreadcrumb(crumb) {
      return scrubValue(crumb);
    },
  });
  enabled = true;
  logger.info('Sentry error reporting on (PII scrubbed).');
}

/** Reports a server fault. `userId` is the only identity ever attached. */
export function reportError(error: unknown, context: { route?: string; userId?: string } = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.route) scope.setTag('route', scrubText(context.route.split('?')[0]));
    Sentry.captureException(error);
  });
}
