'use strict';

const puppeteer = require('puppeteer');

const config = require('../config');
const logger = require('./logger');
const { AppError } = require('./errors');
const { assertUrlIsSafe } = require('./ssrf');

/**
 * Pool de Puppeteer.
 *
 * La versión anterior hacía puppeteer.launch() + browser.close() por CADA
 * página: arrancar Chromium cuesta ~1s y bastante RAM, así que un crawl de 20
 * páginas lanzaba 20 navegadores en serie. Aquí se mantiene un único navegador
 * con un pool de pestañas, y se cierra solo tras un rato sin uso.
 */

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  // Con el sistema de ficheros en solo lectura (Docker con read_only: true),
  // Chromium no puede crear la base de datos de crashpad en su HOME y se cae
  // con "chrome_crashpad_handler: --database is required". Estas dos opciones
  // lo mandan todo a un directorio escribible y desactivan el reporte de
  // fallos, que en un scraper no aporta nada.
  `--user-data-dir=${config.browser.userDataDir}`,
  '--disable-breakpad',
];

class BrowserPool {
  constructor(options = {}) {
    this.size = options.size ?? config.browser.poolSize;
    this.idleShutdownMs = options.idleShutdownMs ?? config.browser.idleShutdownMs;
    this.browser = null;
    this.launching = null;
    this.available = this.size;
    this.queue = [];
    this.idleTimer = null;
    this.closed = false;
  }

  async getBrowser() {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.launching) return this.launching;

    this.launching = puppeteer
      .launch({
        headless: true,
        args: LAUNCH_ARGS,
        protocolTimeout: config.browser.protocolTimeoutMs,
        // undefined = Chromium propio de Puppeteer; en Docker apunta al de apt
        executablePath: config.browser.executablePath,
      })
      .then(browser => {
        this.browser = browser;
        this.launching = null;
        browser.on('disconnected', () => {
          if (this.browser === browser) this.browser = null;
        });
        logger.info('Navegador Puppeteer iniciado');
        return browser;
      })
      .catch(error => {
        this.launching = null;
        throw new AppError(
          `No se pudo iniciar el navegador: ${error.message}`,
          503,
          'BROWSER_UNAVAILABLE'
        );
      });

    return this.launching;
  }

  async acquireSlot() {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise(resolve => this.queue.push(resolve));
    this.available -= 1;
  }

  releaseSlot() {
    this.available += 1;
    const next = this.queue.shift();
    if (next) next();
    this.scheduleIdleShutdown();
  }

  scheduleIdleShutdown() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.available < this.size) return; // aún hay trabajo en curso
    this.idleTimer = setTimeout(() => {
      this.close().catch(error => logger.warn('Error cerrando el navegador', error.message));
    }, this.idleShutdownMs);
    this.idleTimer.unref?.();
  }

  /** Ejecuta `task(page)` con una pestaña del pool y la cierra siempre. */
  async withPage(task) {
    if (!config.browser.enabled) {
      throw new AppError(
        'El navegador está desactivado por configuración',
        503,
        'BROWSER_DISABLED'
      );
    }

    await this.acquireSlot();
    let page = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      );
      page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);
      return await task(page);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      this.releaseSlot();
    }
  }

  async close() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const browser = this.browser;
    this.browser = null;
    if (browser) {
      await browser.close().catch(() => {});
      logger.info('Navegador Puppeteer cerrado');
    }
  }
}

const pool = new BrowserPool();

/**
 * Scroll incremental para disparar la carga diferida.
 *
 * Va con tope propio: en páginas con scripts pesados el evaluate puede no
 * volver nunca, y como el scroll es un extra (no la razón de la visita), es
 * preferible seguir sin él que bloquear la pestaña y agotar el pool.
 */
async function autoScroll(page) {
  const { scrollStepPx, maxScrollPx, scrollTimeoutMs } = config.browser;
  const scrolling = page.evaluate(
    async (step, max) => {
      await new Promise(resolve => {
        let total = 0;
        const timer = setInterval(() => {
          const { scrollHeight } = document.body;
          window.scrollBy(0, step);
          total += step;
          if (total >= scrollHeight || total > max) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    },
    scrollStepPx,
    maxScrollPx
  );

  await Promise.race([
    scrolling,
    new Promise(resolve => setTimeout(resolve, scrollTimeoutMs)),
  ]).catch(() => {});
}

/** Renderiza una URL con JS y devuelve el HTML final. */
async function renderPage(url, { scroll = true } = {}) {
  await assertUrlIsSafe(url);

  return pool.withPage(async page => {
    await page.goto(url, {
      waitUntil: config.browser.waitUntil,
      timeout: config.browser.navigationTimeoutMs,
    });

    if (scroll) {
      await autoScroll(page);
      // NOTA: page.waitForTimeout fue eliminado en Puppeteer v22.
      await new Promise(resolve => setTimeout(resolve, config.browser.settleMs));
    }

    return page.content();
  });
}

/**
 * Renderiza una página que carga más resultados al bajar (scroll infinito).
 *
 * A diferencia de `autoScroll`, que baja a ciegas una cantidad fija, esta
 * OBSERVA: tras cada scroll cuenta los enlaces y sigue solo mientras aparezcan
 * nuevos. Así se adapta a sitios que cargan lotes de tamaños distintos.
 *
 * ── Por qué cada ronda es un evaluate corto ──────────────────────────
 * Sería más directo meter el bucle entero dentro de un solo page.evaluate,
 * pero entonces una página que bloquea el hilo dejaría esa llamada sin
 * volver, y con ella la pestaña colgada hasta agotar el protocolTimeout. Con
 * una orden corta por ronda, el control vuelve a Node entre medias y los
 * topes se comprueban de verdad.
 *
 * ── Los topes son obligatorios ───────────────────────────────────────
 * Esta función ocupa UNA pestaña del pool durante toda la fase 1, y el pool
 * tiene dos. Un sitio con scroll sin fin bloquearía la aplicación para todo
 * el mundo. Se corta por lo que llegue primero: rondas, tiempo, número de
 * enlaces, o varias rondas seguidas sin nada nuevo.
 */
async function renderPageWithInfiniteScroll(url, options = {}) {
  await assertUrlIsSafe(url);

  const {
    maxRounds = config.scroll.maxRounds,
    maxDurationMs = config.scroll.maxDurationMs,
    maxElements = config.scroll.maxElements,
    settleMs = config.scroll.settleMs,
    stableRounds = config.scroll.stableRounds,
    signal,
    onRound,
  } = options;

  return pool.withPage(async page => {
    await page.goto(url, {
      waitUntil: config.browser.waitUntil,
      timeout: config.browser.navigationTimeoutMs,
    });

    const startedAt = Date.now();
    let previousCount = 0;
    let sinCambios = 0;
    let rounds = 0;
    let motivo = 'sin-contenido-nuevo';

    // Una ronda: bajar del todo y devolver cuántos enlaces hay ahora
    const scrollOnce = () =>
      page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        return document.querySelectorAll('a[href]').length;
      });

    // Recuento inicial, antes de tocar nada
    previousCount = await scrollOnce().catch(() => 0);

    while (rounds < maxRounds) {
      if (signal?.aborted) {
        motivo = 'cancelado';
        break;
      }
      if (Date.now() - startedAt > maxDurationMs) {
        motivo = 'tiempo-agotado';
        break;
      }
      if (previousCount >= maxElements) {
        motivo = 'tope-de-elementos';
        break;
      }

      await new Promise(resolve => setTimeout(resolve, settleMs));

      let count;
      try {
        count = await scrollOnce();
      } catch (error) {
        // La pestaña dejó de responder: se para y se aprovecha lo que haya
        logger.warn(`Scroll interrumpido en ${url}`, error.message);
        motivo = 'error-de-navegador';
        break;
      }

      rounds += 1;
      const nuevos = count - previousCount;
      previousCount = count;

      onRound?.({ round: rounds, totalElements: count, nuevos });

      if (nuevos <= 0) {
        sinCambios += 1;
        // Un solo lote lento cortaría la exploración antes de tiempo, así
        // que hacen falta varias rondas seguidas en blanco para creerse
        // que ya no queda nada.
        if (sinCambios >= stableRounds) {
          motivo = 'sin-contenido-nuevo';
          break;
        }
      } else {
        sinCambios = 0;
      }

      if (rounds >= maxRounds) motivo = 'tope-de-rondas';
    }

    return {
      html: await page.content(),
      rounds,
      totalElements: previousCount,
      motivo,
      durationMs: Date.now() - startedAt,
    };
  });
}

/**
 * Renderiza y además captura las peticiones de red de tipo media, que es como
 * se cazan los videos que nunca aparecen en el HTML.
 */
async function renderPageWithMedia(url, { isMediaUrl } = {}) {
  await assertUrlIsSafe(url);

  return pool.withPage(async page => {
    const mediaRequests = [];

    await page.setRequestInterception(true);
    page.on('request', request => {
      try {
        const requestUrl = request.url();
        const isMedia = request.resourceType() === 'media';
        if (isMedia || isMediaUrl?.(requestUrl)) {
          mediaRequests.push({ url: requestUrl, resourceType: request.resourceType() });
        }
      } catch {
        // no bloquear la navegación por un fallo al inspeccionar
      }
      if (!request.isInterceptResolutionHandled?.()) {
        request.continue().catch(() => {});
      }
    });

    await page.goto(url, {
      waitUntil: config.browser.waitUntil,
      timeout: config.browser.navigationTimeoutMs,
    });

    await autoScroll(page);
    await new Promise(resolve => setTimeout(resolve, config.browser.settleMs));

    const domVideos = await page.evaluate(() => {
      const found = [];
      document.querySelectorAll('video, source').forEach(el => {
        const src = el.src || el.getAttribute('data-src') || el.getAttribute('data-video-src');
        if (src) {
          found.push({
            url: src,
            element: el.tagName.toLowerCase(),
            duration: Number.isFinite(el.duration) ? el.duration : null,
            width: el.videoWidth || el.getAttribute('width') || null,
            height: el.videoHeight || el.getAttribute('height') || null,
            poster: el.poster || null,
          });
        }
      });
      document.querySelectorAll('[data-video], [data-src], [data-video-url]').forEach(el => {
        const src =
          el.getAttribute('data-video') ||
          el.getAttribute('data-src') ||
          el.getAttribute('data-video-url');
        if (src) {
          found.push({ url: src, element: 'data-attribute', duration: null });
        }
      });
      return found;
    });

    const html = await page.content();
    return { html, domVideos, mediaRequests };
  });
}

module.exports = {
  pool,
  renderPage,
  renderPageWithMedia,
  renderPageWithInfiniteScroll,
  BrowserPool,
};
