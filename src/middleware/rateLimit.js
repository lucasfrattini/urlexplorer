'use strict';

const config = require('../config');
const { AppError } = require('../lib/errors');

/**
 * Rate limiting en memoria por IP.
 *
 * No había ninguno: un cliente podía encadenar crawls con useJavaScript y
 * tumbar el proceso (y machacar el sitio objetivo). Ventana deslizante simple,
 * suficiente para una app de un solo proceso; si esto escalara a varias
 * instancias haría falta un store compartido.
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs ?? config.security.rateLimit.windowMs;
  const maxRequests = options.maxRequests ?? config.security.rateLimit.maxRequests;

  /**
   * Identificar por la dirección REAL del socket, ignorando X-Forwarded-For.
   *
   * Defensa en profundidad para el desbloqueo de admin: `req.ip` depende de
   * `trust proxy`, y si algún día alguien lo pone en `true` para depurar, el
   * límite de 5 intentos por minuto —lo único que frena la fuerza bruta
   * contra ADMIN_TOKEN— se vuelve inútil sin que nada avise. El contador de
   * intentos de contraseña no debe depender de un ajuste de red.
   */
  const useSocketAddress = options.useSocketAddress === true;

  /** @type {Map<string, number[]>} */
  const hits = new Map();

  // Limpieza periódica para que el Map no crezca sin límite
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter(time => time > cutoff);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }, windowMs);
  cleanup.unref?.();

  return function rateLimit(req, res, next) {
    const key = useSocketAddress
      ? req.socket?.remoteAddress || 'unknown'
      : req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;

    const timestamps = (hits.get(key) || []).filter(time => time > cutoff);

    if (timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(Math.max(1, retryAfter)));
      return next(
        new AppError(
          `Demasiadas peticiones. Reintenta en ${Math.max(1, retryAfter)} segundos.`,
          429,
          'RATE_LIMITED'
        )
      );
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - timestamps.length)));
    return next();
  };
}

module.exports = { createRateLimiter };
