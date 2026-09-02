import mongoose from 'mongoose';
import { env, isProduction } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (error) => logger.error('MongoDB error', error));

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: !isProduction,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
}
