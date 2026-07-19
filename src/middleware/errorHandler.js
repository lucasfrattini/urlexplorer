'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');

/** 404 para rutas de API no reconocidas. */
function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return next(new AppError(`Ruta no encontrada: ${req.path}`, 404, 'NOT_FOUND'));
  }
  return next();
}

/**
 * Manejador de errores unificado. Antes cada endpoint devolvía una forma
 * distinta ({error}, {error, message}, o un 500 genérico).
 */
// eslint-disable-next-line no-unused-vars -- Express identifica el handler por aridad
function errorHandler(error, req, res, next) {
  const isAppError = error instanceof AppError;
  const statusCode = isAppError ? error.statusCode : 500;

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.path} → ${statusCode}`, error);
  } else {
    logger.warn(`${req.method} ${req.path} → ${statusCode}: ${error.message}`);
  }

  if (res.headersSent) {
    return res.end();
  }

  const body = isAppError
    ? error.toJSON()
    : {
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR',
      };

  // La traza solo se expone fuera de producción
  if (config.env !== 'production' && statusCode >= 500) {
    body.stack = error.stack;
  }

  return res.status(statusCode).json(body);
}

module.exports = { errorHandler, notFoundHandler };
