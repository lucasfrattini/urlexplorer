'use strict';

const express = require('express');

const config = require('../config');
const { AppError } = require('../lib/errors');
const { obtenerMiniatura } = require('../services/thumbnails');

const router = express.Router();

/**
 * GET /api/thumbnail?url=… — sirve una miniatura desde NUESTRO origen.
 *
 * El navegador del usuario nunca habla con el CDN del sitio explorado: pide
 * aquí, y es el servidor —que ya hablaba con ese sitio— quien va a buscarla.
 * Así la IP del usuario no se reparte por los CDN de los sitios que explora y
 * la CSP puede seguir con `img-src 'self' data:`.
 *
 * ── Sobre ser un proxy de imágenes ────────────────────────────────────
 *
 * Sí, esto acepta una URL arbitraria y la descarga, igual que el resto de la
 * aplicación. Lo que lo acota:
 *   - la misma validación SSRF que todo lo demás, incluida la comprobación
 *     de IP al conectar;
 *   - solo se devuelve lo que sea de verdad una imagen, por content-type;
 *   - tope de tamaño por imagen y caché con tope global;
 *   - el rate limiting general de /api.
 *
 * No añade alcance: cualquiera que pueda llamar aquí ya podía pedirle al
 * scraper que descargara esa misma URL.
 */
router.get('/thumbnail', async (req, res, next) => {
  try {
    if (!config.thumbnails.enabled) {
      throw new AppError('Las miniaturas están desactivadas', 404, 'THUMBNAILS_DISABLED');
    }

    const { url } = req.query || {};
    if (typeof url !== 'string' || url.trim() === '') {
      throw new AppError('Se requiere una URL', 400, 'URL_REQUIRED');
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const { buffer, contentType, deCache } = await obtenerMiniatura(url.trim(), {
      signal: controller.signal,
    });

    res.set('Content-Type', contentType);
    res.set('Cache-Control', `private, max-age=${config.thumbnails.browserCacheSeconds}`);
    // Que no se reenvíe la URL de origen a ningún sitio
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Thumbnail-Cache', deCache ? 'hit' : 'miss');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
