'use strict';

const express = require('express');

const logger = require('../lib/logger');
const { readProfiles, writeProfiles } = require('../services/profiles');

const router = express.Router();

/** GET /api/profiles — configuraciones guardadas. */
router.get('/profiles', async (req, res, next) => {
  try {
    res.json({ success: true, profiles: await readProfiles() });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/profiles — reemplaza la lista completa.
 *
 * Lo que llega se valida aquí y no solo en el frontend: el servidor no se
 * fía del cliente.
 */
router.put('/profiles', async (req, res, next) => {
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
