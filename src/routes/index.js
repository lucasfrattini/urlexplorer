'use strict';

const express = require('express');

const config = require('../config');
const scrapeRoutes = require('./scrape');
const videoRoutes = require('./video');
const profileRoutes = require('./profiles');

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
router.use(profileRoutes);

module.exports = router;
