'use strict';

const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLevel = LEVELS[config.logging.level] ?? LEVELS.info;

function emit(level, stream, message, meta) {
  if (LEVELS[level] > activeLevel) return;
  const timestamp = new Date().toISOString();
  const suffix = meta === undefined ? '' : ` ${format(meta)}`;
  stream(`${timestamp} [${level.toUpperCase()}] ${message}${suffix}`);
}

function format(meta) {
  if (meta instanceof Error) return meta.stack || meta.message;
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

const logger = {
  error: (message, meta) => emit('error', console.error, message, meta),
  warn: (message, meta) => emit('warn', console.warn, message, meta),
  info: (message, meta) => emit('info', console.log, message, meta),
  debug: (message, meta) => emit('debug', console.log, message, meta),
};

module.exports = logger;
