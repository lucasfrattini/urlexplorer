'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../lib/logger');
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

/**
 * Direcciones del stream: un STRING JSON de un array en `?urls=`.
 *
 * Mismo criterio que `resolverSearchUrls` del Explorador, y por la misma
 * razón: el único cliente de un SSE es un `EventSource`, que solo sabe hacer
 * GET, y una lista de direcciones no cabe limpia en parámetros repetidos.
 *
 * Un JSON inválido se trata como lista vacía a propósito: así lo rechaza
 * `extractVideosBatch` con su `URL_REQUIRED` de siempre, y el motivo llega al
 * cliente como evento `error` (un 400 no lo vería: EventSource no expone ni
 * el estado ni el cuerpo).
 */
function parsearUrls(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/video/stream — el mismo análisis con progreso en tiempo real (SSE).
 *
 * Réplica del esqueleto de `GET /api/scrape/stream` (cabeceras, heartbeat y
 * cancelación al cerrar el cliente): es el mecanismo de progreso ya
 * establecido en el proyecto y no hay motivo para inventar otro. `POST
 * /api/video/extract` se queda igual para quien no necesite progreso.
 *
 * Aquí no hay frenar/continuar: el análisis de una dirección no tiene una
 * fase 2 con miles de enlaces pendientes que guardar.
 */
router.get('/video/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const controller = new AbortController();
  let clientGone = false;

  const send = payload => {
    if (clientGone || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Comentario SSE periódico para que proxies no cierren la conexión
  const heartbeat = setInterval(() => {
    if (!clientGone && !res.writableEnded) res.write(': keepalive\n\n');
  }, config.sse.heartbeatMs);
  heartbeat.unref?.();

  req.on('close', () => {
    clientGone = true;
    controller.abort();
    clearInterval(heartbeat);
    logger.info('Cliente desconectado: análisis de vídeo abortado');
  });

  try {
    const result = await extractVideosBatch(parsearUrls(req.query.urls), {
      // En una query todo llega como texto: 'false' es truthy, así que se
      // compara contra 'true' explícitamente (el mismo fallo que hacía que
      // Puppeteer se lanzara SIEMPRE en el código original).
      getMetadata: req.query.getMetadata === 'true',
      getThumbnails: req.query.getThumbnails === 'true',
      useJavaScript: req.query.useJavaScript === 'true',
      signal: controller.signal,
      // El progreso viaja por el mismo canal que el resultado
      emit: send,
    });

    send({ type: 'complete', ...result });
  } catch (error) {
    logger.warn(`Error en el stream de vídeo: ${error.message}`);
    send({
      type: 'error',
      message: error.message,
      code: error.code || 'INTERNAL_ERROR',
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
