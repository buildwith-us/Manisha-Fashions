/**
 * Which database a process is about to touch, and whether it may.
 *
 * Deliberately free of any import of config/env.ts: the test setup calls this
 * before the environment is parsed, and a script must be able to refuse before
 * anything connects.
 *
 * "Local" means a plain mongodb:// URI whose every host is this machine — an
 * in-memory mongod or a local install. Anything else (mongodb+srv://, Atlas's
 * *.mongodb.net, any remote host) is treated as production. There is no
 * staging cluster, so a remote database IS the live one.
 */

/** Passing this on the command line is the only way a writing script reaches production. */
export const PRODUCTION_TARGET_FLAG = '--target=production';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalMongoUri(uri: string | undefined | null): boolean {
  if (!uri) return false;
  // Plain mongodb:// only: mongodb+srv:// resolves hosts through DNS and is
  // how Atlas is always addressed. Credentials, if any, are skipped.
  const match = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(uri.trim());
  if (!match) return false;
  const hosts = match[1].split(',').map((host) => host.trim().replace(/:\d+$/, '').toLowerCase());
  return hosts.length > 0 && hosts.every((host) => LOCAL_HOSTS.has(host));
}

/** Host and database only — safe to print. Credentials and options are dropped. */
export function redactMongoUri(uri: string | undefined | null): string {
  if (!uri) return '(no MONGODB_URI)';
  const [withoutQuery] = uri.trim().split('?');
  const redacted = withoutQuery.replace(/^(mongodb(?:\+srv)?:\/\/)[^@/]*@/i, '$1***@');
  return /\.mongodb\.net/i.test(redacted) ? `${redacted} (MongoDB Atlas)` : redacted;
}

/** Tests only ever run against a local database. Throws otherwise. */
export function assertTestDatabase(uri: string | undefined | null): void {
  if (isLocalMongoUri(uri)) return;
  throw new Error(
    `Refusing to run tests against ${redactMongoUri(uri)}. ` +
      'Tests must use the in-memory/local MongoDB (mongodb://127.0.0.1…), never Atlas or production.',
  );
}

/**
 * A script that writes data may touch a non-local database only when asked to
 * explicitly. Throws otherwise, before anything has connected.
 */
export function assertScriptWriteTarget(
  uri: string | undefined | null,
  argv: readonly string[] = process.argv,
): void {
  if (isLocalMongoUri(uri)) return;
  if (argv.includes(PRODUCTION_TARGET_FLAG)) return;
  throw new Error(
    `Refusing to write to ${redactMongoUri(uri)}: it is not a local database, so it is treated as production. ` +
      `If that is really the target, re-run with ${PRODUCTION_TARGET_FLAG} ` +
      `(e.g. npm run seed -- ${PRODUCTION_TARGET_FLAG}).`,
  );
}
