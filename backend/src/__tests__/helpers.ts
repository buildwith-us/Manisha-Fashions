import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { Application } from 'express';

let mongod: MongoMemoryServer;

export async function startTestApp(): Promise<Application> {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('manisha_test');

  const { createApp } = await import('../app');
  const { initStore } = await import('../config/store');
  initStore();
  await mongoose.connect(process.env.MONGODB_URI);
  return createApp();
}

export async function stopTestApp(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongod?.stop();
}

export async function resetDb(): Promise<void> {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
  // Rate-limit counters live outside Mongo and would otherwise leak between tests.
  const { disconnectStore, initStore } = await import('../config/store');
  await disconnectStore();
  initStore();
}

export const API = '/api/v1';
