'use strict';

const express = require('express');

const { AppError } = require('../lib/errors');
const { extractVideos, extractVideosBatch } = require('../services/video');

const router = express.Router();

/**
 * POST /api/video/extract — detecta los videos de una o varias URLs.
 *
 * Retrocompatible: con `url` (string) devuelve el mismo shape de siempre
 * ({ success, url, videos, methods, total }). Con `urls` (array) analiza el
 * lote y agrupa los duplicados UNA vez sobre la fusión de todas, como el
 * Explorador ({ success, videos, groups, methods, direccionesAnalizadas,
 * direccionesTotal }).
 */
router.post('/video/extract', async (req, res, next) => {
  try {
    const {
      url,
      urls,
      getMetadata = false,
      getThumbnails = false,
      useJavaScript = true,
    } = req.body || {};

    // Cancelación (punto 14): cerrar el POST aborta el análisis en curso, sin
    // endpoint de cancelación aparte. El signal se propaga hasta cada fetch.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const opciones = {
      getMetadata: getMetadata === true || getMetadata === 'true',
      getThumbnails: getThumbnails === true || getThumbnails === 'true',
      useJavaScript: useJavaScript !== false && useJavaScript !== 'false',
      signal: controller.signal,
    };

    // Modo lote: solo si llega un array con al menos una dirección. Un `urls`
    // vacío cae al `url` de siempre, que es la retrocompatibilidad.
    if (Array.isArray(urls) && urls.length > 0) {
      const result = await extractVideosBatch(urls, opciones);
      res.json({ success: true, ...result });
      return;
    }

    if (typeof url !== 'string' || url.trim() === '') {
      throw new AppError('Se requiere una URL', 400, 'URL_REQUIRED');
    }

    const result = await extractVideos(url, opciones);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
