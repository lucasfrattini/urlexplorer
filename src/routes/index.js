'use strict';

const express = require('express');

const config = require('../config');
const scrapeRoutes = require('./scrape');
const videoRoutes = require('./video');
const adminRoutes = require('./admin');

const router = express.Router();

/** Estado del servicio y límites vigentes (el front los usa para validar). */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    name: 'URL Explorer',
    uptimeSeconds: Math.floor(process.uptime()),
    limits: {
      maxPages: config.crawl.maxPages,
      maxLinks: config.crawl.maxLinks,
      maxFiles: config.crawl.maxFiles,
      maxConcurrency: config.crawl.maxConcurrency,
      defaultConcurrency: config.crawl.defaultConcurrency,
    },
    browserEnabled: config.browser.enabled,
  });
});

router.use(scrapeRoutes);
router.use(videoRoutes);

// /health NO anuncia si el modo admin existe: eso delataría que hay una
// puerta. Con el token sin configurar, sus rutas responden 404.
router.use(adminRoutes);

module.exports = router;
