import Constants from 'expo-constants';
import type * as SentryModule from '@sentry/react-native';
import { scrubText, scrubUrl, scrubValue } from '../utils/scrubPii';

/**
 * Crash and error reporting to Sentry — off unless app.json → extra.sentryDsn
 * is set (a DSN is public by design; it only allows sending events).
 *
 * No personal data leaves the device: default PII is off, events keep only
 * the user id, request URLs lose their query strings, and all text is
 * scrubbed (utils/scrubPii.ts). Loaded lazily so tests, Expo Go and builds
 * without a DSN never touch the native module.
 *
 * Source maps are not uploaded (the @sentry/react-native build plugin is
 * deliberately not in app.json: its upload step fails builds that have no
 * Sentry auth token). Release stack traces are therefore minified until the
 * plugin is added with SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN.
 */
type Sentry = typeof SentryModule;

let sentry: Sentry | null = null;

const dsn = (Constants.expoConfig?.extra as { sentryDsn?: unknown } | undefined)?.sentryDsn;

export function initMonitoring(): void {
  if (typeof dsn !== 'string' || !dsn.startsWith('https://')) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sentry = require('@sentry/react-native') as Sentry;
  } catch {
    return;
  }
  sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request?.url) event.request = { url: scrubUrl(event.request.url) };
      if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
      if (event.message) event.message = scrubText(event.message);
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = scrubText(exception.value);
      }
      if (event.extra) event.extra = scrubValue(event.extra);
      if (event.contexts) event.contexts = scrubValue(event.contexts);
      return event;
    },
    beforeBreadcrumb(crumb) {
      const data = crumb.data ? { ...crumb.data } : undefined;
      if (data && typeof data.url === 'string') data.url = scrubUrl(data.url);
      return {
        ...crumb,
        ...(crumb.message ? { message: scrubText(crumb.message) } : {}),
        ...(data ? { data: scrubValue(data) } : {}),
      };
    },
  });
}

/** Attaches only the account id to future reports (or clears it on sign-out). */
export function setMonitoringUser(userId: string | null): void {
  sentry?.setUser(userId ? { id: userId } : null);
}
