import { isProduction } from './env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: number = isProduction ? levelOrder.info : levelOrder.debug;

function emit(level: Level, message: string, meta?: unknown) {
  if (levelOrder[level] < minLevel) return;
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${level.toUpperCase().padEnd(5)} ${message}`;
  if (meta === undefined) {
    console[level === 'debug' ? 'log' : level](line);
  } else {
    console[level === 'debug' ? 'log' : level](line, meta);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
};
