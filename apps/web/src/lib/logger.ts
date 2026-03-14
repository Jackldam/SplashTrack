type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
const minimumLevel = levelWeight[configuredLevel] ? configuredLevel : 'info';

function shouldLog(level: LogLevel) {
  return levelWeight[level] >= levelWeight[minimumLevel];
}

function formatEntry(level: LogLevel, message: string, meta?: unknown) {
  return {
    level,
    message,
    meta,
    timestamp: new Date().toISOString(),
  };
}

function log(level: LogLevel, message: string, meta?: unknown) {
  if (!shouldLog(level)) {
    return;
  }

  const entry = formatEntry(level, message, meta);
  const method = level === 'debug' ? 'log' : level;

  console[method](JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, meta?: unknown) => log('debug', message, meta),
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  error: (message: string, meta?: unknown) => log('error', message, meta),
};
