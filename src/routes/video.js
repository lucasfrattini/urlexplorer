'use strict';

const express = require('express');

const { AppError } = require('../lib/errors');
const { extractVideos } = require('../services/video');

const router = express.Router();

/** POST /api/video/extract — detecta los videos de una única URL. */
router.post('/video/extract', async (req, res, next) => {
  try {
    const { url, getMetadata = false, useJavaScript = true } = req.body || {};

    if (typeof url !== 'string' || url.trim() === '') {
      throw new AppError('Se requiere una URL', 400, 'URL_REQUIRED');
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const result = await extractVideos(url, {
      getMetadata: getMetadata === true || getMetadata === 'true',
      useJavaScript: useJavaScript !== false && useJavaScript !== 'false',
      signal: controller.signal,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
