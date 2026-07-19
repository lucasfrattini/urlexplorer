'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../lib/logger');
const { parseExtensionList } = require('../lib/url');
const { crawl, normalizeCrawlParams } = require('../services/scraper');

const router = express.Router();

/**
 * POST /api/scrape — crawl completo con respuesta JSON única.
 *
 * A diferencia de la versión anterior, este endpoint SÍ ejecuta la fase 2 si
 * se pasan extensiones: antes /scrape solo hacía la mitad del trabajo y había
 * que usar el stream para lo demás.
 */
router.post('/scrape', async (req, res, next) => {
  try {
    const params = normalizeCrawlParams(req.body || {});
    const extensions = parseExtensionList(req.body?.fileExtensions);

    // Si el cliente corta la conexión, se aborta el crawl
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const result = await crawl({ ...params, extensions }, { signal: controller.signal });

    res.json({
      success: true,
      ...result,
      searchUrl: params.searchUrl,
      pageParam: params.pageParam || null,
      linkPattern: params.linkPattern || null,
      startPage: params.startPage,
      endPage: params.endPage,
      usePagination: Boolean(params.pageParam),
      usePattern: Boolean(params.linkPattern),
      deepSearch: extensions.length > 0,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scrape/stream — mismo crawl con progreso en tiempo real (SSE).
 *
 * Cancelación: antes, si el usuario cerraba la pestaña, el servidor seguía
 * scrapeando hasta el final. Ahora req.on('close') aborta el trabajo.
 */
router.get('/scrape/stream', async (req, res) => {
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
  }, 15000);
  heartbeat.unref?.();

  req.on('close', () => {
    clientGone = true;
    controller.abort();
    clearInterval(heartbeat);
    logger.info('Cliente desconectado: crawl abortado');
  });

  try {
    // La validación se hace DENTRO del stream, no antes.
    //
    // Devolvía un 400 con el motivo en el cuerpo, pero el único cliente de
    // este endpoint es un EventSource, y EventSource no expone ni el código
    // de estado ni el cuerpo: solo dispara onerror sin detalle. El usuario
    // veía "se perdió la conexión" en vez de "el rango es demasiado grande".
    // Emitiéndolo como evento 'error' el motivo real llega a la interfaz.
    const params = normalizeCrawlParams(req.query || {});
    const extensions = parseExtensionList(req.query.fileExtensions);

    const result = await crawl(
      { ...params, extensions },
      { signal: controller.signal, emit: send }
    );

    send({
      type: 'complete',
      ...result,
      startPage: params.startPage,
      endPage: params.endPage,
      usePagination: Boolean(params.pageParam),
      usePattern: Boolean(params.linkPattern),
      limits: {
        maxLinks: config.crawl.maxLinks,
        maxFiles: config.crawl.maxFiles,
      },
    });
  } catch (error) {
    logger.warn(`Error en el stream de scraping: ${error.message}`);
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
