'use strict';

const express = require('express');

const config = require('../config');
const { AppError } = require('../lib/errors');
const logger = require('../lib/logger');
const { createRateLimiter } = require('../middleware/rateLimit');
const { requireAdmin, hasValidToken, isAdminEnabled } = require('../middleware/adminAuth');
const { readProfiles, writeProfiles } = require('../services/profiles');

const router = express.Router();

/**
 * Rate limiting propio del desbloqueo, mucho más estricto que el general
 * (5 intentos por minuto frente a 30 peticiones). Es el único endpoint de la
 * aplicación donde la fuerza bruta tiene sentido.
 */
const unlockLimiter = createRateLimiter({
  ...config.admin.unlockRateLimit,
  // Por la dirección real del socket, no por X-Forwarded-For: el contador de
  // intentos de contraseña no puede depender de cómo esté puesto trust proxy.
  useSocketAddress: true,
});

/**
 * POST /api/admin/unlock — valida el token.
 *
 * No devuelve nada aprovechable: el cliente ya tiene el token, lo único que
 * gana es saber si sirve. Se responde igual de escueto en éxito y en fallo.
 */
router.post('/admin/unlock', unlockLimiter, (req, res, next) => {
  if (!isAdminEnabled()) {
    return next(new AppError('No encontrado', 404, 'NOT_FOUND'));
  }

  const { token } = req.body || {};
  if (typeof token !== 'string' || token === '') {
    return next(new AppError('Se requiere un token', 400, 'TOKEN_REQUIRED'));
  }

  // Se reutiliza la validación de la cabecera montando una petición
  // equivalente, para que exista un único punto de comparación del token.
  const ok = hasValidToken({
    get: name => (name.toLowerCase() === 'x-admin-token' ? token : undefined),
  });

  if (!ok) {
    logger.warn('Intento de desbloqueo fallido', { ip: req.ip });
    return next(new AppError('Contraseña incorrecta', 401, 'ADMIN_UNAUTHORIZED'));
  }

  return res.json({ success: true });
});

/** GET /api/admin/profiles — perfiles guardados. Requiere token. */
router.get('/admin/profiles', requireAdmin, async (req, res, next) => {
  try {
    res.json({ success: true, profiles: await readProfiles() });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/admin/profiles — reemplaza la lista completa. Requiere token.
 *
 * El guardado se valida aquí y no solo en el frontend: ocultar el botón no es
 * la defensa, es solo la parte visible.
 */
router.put('/admin/profiles', requireAdmin, async (req, res, next) => {
  try {
    const { profiles } = req.body || {};
    const saved = await writeProfiles(profiles);
    logger.info('Perfiles actualizados', { count: saved.length });
    res.json({ success: true, profiles: saved });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
