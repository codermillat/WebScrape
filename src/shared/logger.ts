// Lightweight structured logger (Phase 2 bootstrap)
// Usage: import { log, logger, setLogLevel, LogLevel } from '@shared/logger';
export type LogLevelName = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogEntry {
  ts: string;
  level: LogLevelName;
  code?: string;
  msg: string;
  meta?: unknown;
}

const levelPriority: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};

let currentLevel: LogLevelName = 'info';

export function setLogLevel(lvl: LogLevelName) {
  currentLevel = lvl;
}

function emit(entry: LogEntry) {
  if (levelPriority[entry.level] < levelPriority[currentLevel]) return;
  // Consistent console mapping
  const payload = { ...entry };
  switch (entry.level) {
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug('[EXT]', payload);
      break;
    case 'info':
      // eslint-disable-next-line no-console
      console.info('[EXT]', payload);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn('[EXT]', payload);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.error('[EXT]', payload);
      break;
  }
}

export function log(level: LogLevelName, msg: string, meta?: unknown, code?: string) {
  emit({
    ts: new Date().toISOString(),
    level,
    msg,
    meta,
    code
  });
}

export const logger = {
  setLevel: setLogLevel,
  debug: (msg: string, meta?: unknown, code?: string) => log('debug', msg, meta, code),
  info: (msg: string, meta?: unknown, code?: string) => log('info', msg, meta, code),
  warn: (msg: string, meta?: unknown, code?: string) => log('warn', msg, meta, code),
  error: (msg: string, meta?: unknown, code?: string) => log('error', msg, meta, code)
};

// Auto elevate to debug if extension loaded with ?debug in popup URL
try {
  if (typeof location !== 'undefined' && /\bdebug\b/i.test(location.search)) {
    setLogLevel('debug');
  }
} catch { /* ignore */ }
