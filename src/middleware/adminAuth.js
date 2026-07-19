'use strict';

const crypto = require('node:crypto');

const config = require('../config');
const { AppError } = require('../lib/errors');

const HEADER = 'x-admin-token';

/** ¿Hay modo admin? Sin token configurado, la funcionalidad no existe. */
function isAdminEnabled() {
  return config.admin.token !== '';
}

/**
 * Compara dos cadenas en tiempo constante.
 *
 * `a === b` sale en cuanto encuentra el primer byte distinto, así que el
 * tiempo de respuesta filtra cuántos caracteres del token se han acertado y
 * permite adivinarlo carácter a carácter. `timingSafeEqual` siempre recorre
 * todo el buffer.
 *
 * Exige buffers de la misma longitud, y esa comprobación previa vuelve a
 * filtrar la longitud del token. Se resuelve pasando ambos lados por un hash
 * de tamaño fijo: dos entradas de cualquier longitud producen 32 bytes.
 */
function safeEqual(candidate, expected) {
  const a = crypto.createHash('sha256').update(String(candidate), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/** ¿Trae la petición un token válido? */
function hasValidToken(req) {
  if (!isAdminEnabled()) return false;
  const provided = req.get(HEADER);
  if (typeof provided !== 'string' || provided === '') return false;
  return safeEqual(provided, config.admin.token);
}

/**
 * Exige token de admin.
 *
 * Con el modo deshabilitado responde 404, no 401: si no hay token configurado
 * la funcionalidad no existe, y un 401 anunciaría una puerta que no está.
 */
function requireAdmin(req, res, next) {
  if (!isAdminEnabled()) {
    return next(new AppError('No encontrado', 404, 'NOT_FOUND'));
  }
  if (!hasValidToken(req)) {
    return next(new AppError('Token de administración no válido', 401, 'ADMIN_UNAUTHORIZED'));
  }
  return next();
}

module.exports = { requireAdmin, hasValidToken, isAdminEnabled, safeEqual, HEADER };
