'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { sleep } = require('../lib/throttle');
const { buildPageUrl, hasPageTemplate } = require('../lib/url');
const { renderPageWithInfiniteScroll } = require('../lib/browser');

/**
 * Estrategias de paginación.
 *
 * Hay tres formas de recorrer un listado, y antes vivían todas dentro de un
 * `collectLinks` con condicionales anidados. Con el tercero (scroll) eso se
 * convertía en un nudo, así que cada modo es ahora una función con la misma
 * forma: recibe el mismo contexto y devuelve `{ links, pagesScraped,
 * truncated }`.
 *
 *   - unica     — no hay paginación: una sola página.
 *   - parametro — el número va en la query (?page=N).
 *   - plantilla — el número va dentro de la URL ({page} o {page:02}).
 *   - scroll    — no hay URL por página: se baja hasta que deje de cargar.
 *
 * El contexto que reciben trae ya resuelto lo que comparten (descargar una
 * página, extraer los enlaces que casan), así que ninguna estrategia sabe
 * cómo se descarga ni cómo se filtra.
 */

/** Modos válidos, tal como los envía el cliente. */
const MODOS = ['auto', 'parametro', 'plantilla', 'scroll'];

/**
 * Decide qué estrategia toca.
 *
 * En 'auto' se deduce igual que antes del refactor, para que las
 * configuraciones ya guardadas sigan comportándose exactamente igual.
 */
function resolveMode({ paginationMode = 'auto', searchUrl = '', pageParam = '' }) {
  if (paginationMode === 'scroll') return 'scroll';

  // Una plantilla dentro de la URL manda sobre el parámetro: si están las
  // dos, la plantilla es la que el usuario escribió a propósito.
  if (hasPageTemplate(searchUrl)) return 'plantilla';
  if (pageParam && pageParam.trim() !== '') return 'parametro';

  return 'unica';
}

/** Añade enlaces respetando el tope global. Devuelve si se truncó. */
function acumular(links, nuevos) {
  for (const link of nuevos) {
    if (links.size >= config.crawl.maxLinks) return true;
    links.add(link);
  }
  return false;
}

/** Una sola página: no hay nada que recorrer. */
async function estrategiaUnica(ctx) {
  const { searchUrl, fetchPage, extract, onProgress } = ctx;

  const links = new Set();
  const html = await fetchPage(searchUrl);
  if (!html) return { links: [], pagesScraped: 0, truncated: false };

  const truncated = acumular(links, extract(html, searchUrl));
  onProgress?.({ currentPage: 1, totalPages: 1, linksFound: links.size, totalLinks: links.size });

  return { links: [...links], pagesScraped: 1, truncated };
}

/**
 * Recorrido por URL, común a "parametro" y "plantilla".
 *
 * Es secuencial por diseño: la condición de parada depende de la página
 * anterior (una página sin resultados significa que se acabó el listado), así
 * que pedirlas en paralelo descargaría de más sin saberlo.
 */
async function estrategiaPorUrl(ctx) {
  const { searchUrl, pageParam, startPage, endPage, fetchPage, extract, onProgress, signal } = ctx;

  const links = new Set();
  let pagesScraped = 0;
  let truncated = false;

  for (let page = startPage; page <= endPage; page += 1) {
    if (signal?.aborted) break;

    const pageUrl = buildPageUrl(searchUrl, pageParam, page, startPage);
    const html = await fetchPage(pageUrl);

    if (!html) {
      logger.warn(`Sin contenido en la página ${page}, se detiene la paginación`);
      break;
    }

    pagesScraped += 1;
    const pageLinks = extract(html, pageUrl);
    truncated = acumular(links, pageLinks);

    onProgress?.({
      currentPage: page,
      totalPages: endPage,
      linksFound: pageLinks.length,
      totalLinks: links.size,
    });

    // Una página sin resultados se interpreta como fin de la paginación
    if (pageLinks.length === 0 || truncated) break;

    if (page < endPage) await sleep(config.crawl.pageDelayMs);
  }

  return { links: [...links], pagesScraped, truncated };
}

/**
 * Scroll infinito: una sola URL que va cargando al bajar.
 *
 * Aquí "páginas" son cargas, no URLs. El número que el usuario pide en
 * "Hasta" se usa como número máximo de cargas, siempre acotado por el tope
 * duro de configuración.
 */
async function estrategiaScroll(ctx) {
  const { searchUrl, endPage, extract, onProgress, signal } = ctx;

  if (!config.browser.enabled) {
    throw new AppError(
      'El modo scroll necesita el navegador, y está desactivado por configuración.',
      503,
      'BROWSER_DISABLED'
    );
  }

  // El tope de configuración manda: el usuario puede pedir menos cargas,
  // nunca más.
  const maxRounds = Math.min(Math.max(1, endPage || 1), config.scroll.maxRounds);

  const resultado = await renderPageWithInfiniteScroll(searchUrl, {
    maxRounds,
    signal,
    onRound: ({ round, totalElements }) =>
      onProgress?.({
        currentPage: round,
        totalPages: maxRounds,
        linksFound: totalElements,
        totalLinks: totalElements,
      }),
  });

  const links = new Set();
  const truncated = acumular(links, extract(resultado.html, searchUrl));

  logger.info(
    `Scroll terminado en ${searchUrl}: ${resultado.rounds} cargas, ` +
      `${resultado.totalElements} enlaces en el DOM, motivo "${resultado.motivo}"`
  );

  return {
    links: [...links],
    // Las cargas hacen aquí el papel de páginas recorridas
    pagesScraped: resultado.rounds,
    truncated,
    scroll: {
      rounds: resultado.rounds,
      motivo: resultado.motivo,
      durationMs: resultado.durationMs,
      totalElements: resultado.totalElements,
    },
  };
}

const ESTRATEGIAS = {
  unica: estrategiaUnica,
  parametro: estrategiaPorUrl,
  plantilla: estrategiaPorUrl,
  scroll: estrategiaScroll,
};

module.exports = { resolveMode, ESTRATEGIAS, MODOS };
