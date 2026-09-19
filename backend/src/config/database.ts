import mongoose from 'mongoose';
import { env, isProduction } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

/**
 * Strips credentials from a connection string so the host and database name
 * can be logged. Those two are what actually go wrong (wrong cluster, missing
 * database name) and neither is a secret.
 */
function describeTarget(uri: string): string {
  try {
    const withoutCredentials = uri.replace(/\/\/[^@]*@/, '//***:***@');
    const [beforeQuery] = withoutCredentials.split('?');
    const path = beforeQuery.split('.net/')[1];
    return `${beforeQuery}${path ? '' : '   ⚠️ no database name in the URI'}`;
  } catch {
    return '(unparseable MONGODB_URI)';
  }
}

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (error) => logger.error('MongoDB error', error));

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      autoIndex: !isProduction,
    });
  } catch (error) {
    // Atlas reports every credential problem as the same opaque
    // "bad auth : authentication failed", buried under a driver stack trace.
    // Say what to actually check, and against which cluster.
    const message = error instanceof Error ? error.message : String(error);
    if (/bad auth|authentication failed/i.test(message)) {
      logger.error(`MongoDB rejected the credentials in MONGODB_URI.`);
      logger.error(`  Target: ${describeTarget(env.MONGODB_URI)}`);
      logger.error('  Check, in order:');
      logger.error('   1. The password was rotated in Atlas but not updated here.');
      logger.error('   2. Special characters in the password need percent-encoding');
      logger.error('      (@ → %40, : → %3A, / → %2F, # → %23, ? → %3F, % → %25).');
      logger.error('   3. The database user still exists under Atlas → Database Access.');
    }
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
}
