'use strict';

/**
 * Error de aplicación con código HTTP y código simbólico.
 * Permite que todas las rutas respondan con la misma forma de error.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Marca los errores esperados (validación, bloqueos) frente a los bugs
    this.expected = statusCode < 500;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** Se lanza cuando el cliente aborta la petición y hay que parar el trabajo. */
class AbortedError extends AppError {
  constructor(message = 'Operación cancelada') {
    super(message, 499, 'ABORTED');
  }
}

module.exports = { AppError, AbortedError };
