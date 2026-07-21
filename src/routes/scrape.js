'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../lib/logger');
const { parseExtensionList } = require('../lib/url');
const { crawl, crawlMany, normalizeCrawlParamsList } = require('../services/scraper');
const { detectConfig } = require('../services/detector');
const { AppError } = require('../lib/errors');
const { registro } = require('../services/jobs');

const router = express.Router();

/**
 * POST /api/scrape/detect — propone una configuración para una URL.
 *
 * Lo que devuelve es una SUGERENCIA, con el motivo de cada campo y un nivel
 * de confianza. Cuesta una carga con navegador, así que no conviene llamarlo
 * en cada tecla: va detrás de un botón explícito.
 */
router.post('/scrape/detect', async (req, res, next) => {
  try {
    const { searchUrl } = req.body || {};

    if (typeof searchUrl !== 'string' || searchUrl.trim() === '') {
      throw new AppError('Se requiere una URL', 400, 'URL_REQUIRED');
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const propuesta = await detectConfig(searchUrl.trim(), { signal: controller.signal });
    res.json({ success: true, ...propuesta });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scrape — crawl completo con respuesta JSON única.
 *
 * A diferencia de la versión anterior, este endpoint SÍ ejecuta la fase 2 si
 * se pasan extensiones: antes /scrape solo hacía la mitad del trabajo y había
 * que usar el stream para lo demás.
 */
router.post('/scrape', async (req, res, next) => {
  try {
    // Una o varias direcciones con la MISMA configuración. Con una sola, la
    // lista trae un único elemento idéntico al normalizeCrawlParams de antes,
    // así que el caso clásico (searchUrl string) no cambia en nada.
    const lista = normalizeCrawlParamsList(req.body || {});
    const extensions = parseExtensionList(req.body?.fileExtensions);

    // Si el cliente corta la conexión, se aborta el crawl
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    // Campos compartidos que se devuelven como eco: son iguales para todas las
    // direcciones porque la configuración es común.
    const compartida = lista[0];
    const eco = {
      pageParam: compartida.pageParam || null,
      linkPattern: compartida.linkPattern || null,
      startPage: compartida.startPage,
      endPage: compartida.endPage,
      usePagination: Boolean(compartida.pageParam),
      usePattern: Boolean(compartida.linkPattern),
      deepSearch: extensions.length > 0,
    };

    if (lista.length === 1) {
      const result = await crawl({ ...compartida, extensions }, { signal: controller.signal });
      return res.json({
        success: true,
        ...result,
        // Una dirección analizada, salvo que el cliente cancelara a mitad.
        direccionesAnalizadas: result.aborted ? 0 : 1,
        searchUrl: compartida.searchUrl,
        ...eco,
      });
    }

    const result = await crawlMany(
      { listaParams: lista, extensions },
      { signal: controller.signal }
    );
    return res.json({
      success: true,
      ...result,
      // El estado para continuar no viaja al cliente; el POST no tiene pausa.
      estadoReanudar: undefined,
      searchUrls: lista.map(p => p.searchUrl),
      ...eco,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scrape/pause — frena una exploración en curso.
 *
 * Frenar NO es cancelar: el stream sigue abierto, la fase 2 deja de coger
 * enlaces nuevos, los que ya estaban en vuelo terminan, y el crawl cierra
 * normalmente —agrupando duplicados incluido— con lo que lleve. Lo que falta
 * queda guardado para poder continuar.
 *
 * Va por una petición aparte porque un SSE es de una sola dirección: el
 * cliente no puede decirle nada al servidor por el mismo canal.
 */
router.post('/scrape/pause', (req, res, next) => {
  try {
    const { jobId } = req.body || {};
    if (typeof jobId !== 'string' || jobId === '') {
      throw new AppError('Se requiere el identificador del trabajo', 400, 'JOB_ID_REQUIRED');
    }

    // Un trabajo que ya caducó o terminó no es un error del cliente: pudo
    // acabar solo justo antes de pulsar.
    const frenado = registro.pausar(jobId);
    res.json({ success: true, frenado });
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
    /**
     * Continuar una exploración frenada, o empezar una nueva.
     *
     * Al continuar NO se repite la fase 1: los enlaces ya se recorrieron, y
     * volver a pedirlos sería machacar el sitio para llegar a la misma lista.
     */
    const reanudar = typeof req.query.resume === 'string' ? req.query.resume : '';
    const anterior = reanudar ? registro.obtener(reanudar) : null;

    if (reanudar && !anterior) {
      throw new AppError(
        'La exploración frenada ya no está disponible. Vuelve a empezar.',
        410,
        'JOB_EXPIRED'
      );
    }

    // Una exploración nueva puede ser de una dirección o de varias con la MISMA
    // configuración. Al continuar, lo dice el trabajo guardado. El límite común
    // (maxLinks/maxFiles) se envía en ambos casos.
    const limits = { maxLinks: config.crawl.maxLinks, maxFiles: config.crawl.maxFiles };
    const listaNueva = anterior ? null : normalizeCrawlParamsList(req.query || {});
    const esMulti = anterior ? anterior.multi === true : listaNueva.length > 1;

    if (esMulti) {
      const listaParams = anterior ? anterior.listaParams : listaNueva;
      const extensions = anterior
        ? anterior.extensions
        : parseExtensionList(req.query.fileExtensions);

      // El id se manda ANTES de empezar: sin él, el cliente no tendría a quién
      // decirle "frena" mientras el lote corre.
      const jobId = anterior
        ? anterior.id
        : registro.crear({ multi: true, listaParams, extensions, estadoMulti: null });

      if (anterior) registro.actualizar(jobId, { pausado: false });

      send({ type: 'job', jobId });

      const trabajo = registro.obtener(jobId);
      const result = await crawlMany(
        { listaParams, extensions },
        {
          signal: controller.signal,
          emit: send,
          // El propio trabajo hace de bandera: pausar() le pone `pausado`
          pausa: trabajo,
          reanudar: anterior ? anterior.estadoMulti : null,
        }
      );

      /**
       * El estado para continuar (miles de URLs pendientes) se guarda EN EL
       * SERVIDOR, nunca viaja al cliente: es un GET y no cabe en la query.
       */
      if (result.paused && result.estadoReanudar) {
        registro.actualizar(jobId, { estadoMulti: result.estadoReanudar, pausado: false });
      } else {
        registro.borrar(jobId);
      }

      const compartida = listaParams[0];
      send({
        type: 'complete',
        ...result,
        // Ni las URLs pendientes ni el estado interno viajan
        pendientes: undefined,
        estadoReanudar: undefined,
        pendientesTotal: result.pendientesTotal,
        jobId: result.paused && result.estadoReanudar ? jobId : null,
        searchUrls: listaParams.map(p => p.searchUrl),
        startPage: compartida.startPage,
        endPage: compartida.endPage,
        usePagination: Boolean(compartida.pageParam),
        usePattern: Boolean(compartida.linkPattern),
        limits,
      });
      return;
    }

    // ── Flujo de una sola dirección: idéntico al de siempre ──────────────
    const params = anterior ? anterior.params : listaNueva[0];
    const extensions = anterior
      ? anterior.extensions
      : parseExtensionList(req.query.fileExtensions);

    // El id se manda ANTES de empezar: sin él, el cliente no tendría a quién
    // decirle "frena" mientras la exploración corre.
    const jobId = anterior
      ? anterior.id
      : registro.crear({ params, extensions, detalles: [], pendientes: [] });

    if (anterior) registro.actualizar(jobId, { pausado: false });

    send({ type: 'job', jobId });

    const trabajo = registro.obtener(jobId);
    const result = await crawl(
      { ...params, extensions },
      {
        signal: controller.signal,
        emit: send,
        // El propio trabajo hace de bandera: pausar() le pone `pausado`
        pausa: trabajo,
        linksPrevios: anterior ? anterior.pendientes : null,
        detallesPrevios: anterior ? anterior.detalles : [],
      }
    );

    /**
     * Lo pendiente se guarda EN EL SERVIDOR, no se manda al cliente.
     *
     * Son miles de URLs y el stream es un GET: no caben en la query al
     * continuar. El cliente solo necesita el id.
     */
    if (result.paused && result.pendientes.length > 0) {
      registro.actualizar(jobId, {
        pendientes: result.pendientes,
        detalles: result.fileDetails,
        pausado: false,
      });
    } else {
      // Terminada del todo: no hay nada que continuar
      registro.borrar(jobId);
    }

    send({
      type: 'complete',
      ...result,
      // Una sola dirección: analizada salvo que el cliente cancelara
      direccionesAnalizadas: result.aborted ? 0 : 1,
      // Las URLs pendientes NO viajan; solo cuántas y con qué id seguir
      pendientes: undefined,
      pendientesTotal: result.pendientes.length,
      jobId: result.paused && result.pendientes.length > 0 ? jobId : null,
      startPage: params.startPage,
      endPage: params.endPage,
      usePagination: Boolean(params.pageParam),
      usePattern: Boolean(params.linkPattern),
      limits,
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
