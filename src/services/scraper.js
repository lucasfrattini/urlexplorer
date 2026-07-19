'use strict';

const cheerio = require('cheerio');

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { renderPage } = require('../lib/browser');
const { fetchHtmlWithRetry, tryFetchHtml } = require('../lib/http');
const { sleep } = require('../lib/throttle');
const { assertUrlIsSafe, isUrlSafe } = require('../lib/ssrf');
const {
  toAbsoluteUrl,
  buildPageUrl,
  hasExtension,
  hasPageTemplate,
  hasSearchTemplate,
  applySearchTerm,
} = require('../lib/url');
const { detectLicense } = require('../lib/license');
const { extractDuration, extractSizeBytes, formatFileSize } = require('../lib/media');
const { fetchContentLength } = require('../lib/http');

/** Selectores donde puede aparecer una referencia a un fichero. */
const FILE_SELECTORS =
  'a[href], img[src], video[src], audio[src], source[src], embed[src], object[data]';

/**
 * Extrae los links de un HTML que coinciden con `pattern`.
 *
 * Modos de `pattern`, según cómo empiece:
 *   - vacío        → todos los links
 *   - "/..."       → se compara contra el href ORIGINAL del documento
 *   - "http..."    → se compara con startsWith sobre la URL absoluta
 *   - otra cosa    → se compara con includes sobre la URL absoluta
 */
function extractMatchingLinks(html, baseUrl, pattern) {
  const $ = cheerio.load(html);
  const links = new Set();
  const hasPattern = typeof pattern === 'string' && pattern.trim() !== '';

  $('a[href]').each((_, element) => {
    const rawHref = $(element).attr('href');
    const absolute = toAbsoluteUrl(rawHref, baseUrl);
    if (!absolute) return;

    if (!hasPattern) {
      links.add(absolute);
      return;
    }

    let matches;
    if (pattern.startsWith('/')) {
      matches = rawHref.includes(pattern);
    } else if (/^https?:\/\//i.test(pattern)) {
      matches = absolute.startsWith(pattern);
    } else {
      matches = absolute.includes(pattern);
    }

    if (matches) links.add(absolute);
  });

  return [...links];
}

/** Busca en un HTML las URLs cuya extensión real esté en `extensions`. */
function extractFilesFromHtml(html, baseUrl, extensions) {
  const $ = cheerio.load(html);
  const files = new Set();

  $(FILE_SELECTORS).each((_, element) => {
    const $el = $(element);
    const raw = $el.attr('href') || $el.attr('src') || $el.attr('data');
    const absolute = toAbsoluteUrl(raw, baseUrl);
    if (absolute && hasExtension(absolute, extensions)) {
      files.add(absolute);
    }
  });

  return [...files];
}

/**
 * Renderiza con navegador y, si falla, reintenta por HTTP plano.
 *
 * A diferencia de fetchPage, aquí el error del HTTP se propaga: en la fase 2
 * cada URL tiene su registro de fallo, y tragarse el motivo dejaba al usuario
 * sin saber por qué una página no dio ficheros.
 */
async function renderPageOrFallback(url, { signal }) {
  try {
    return await renderPage(url);
  } catch (error) {
    logger.warn(`Navegador falló en ${url}, se reintenta por HTTP`, error.message);
    return fetchHtmlWithRetry(url, { signal, timeout: config.http.fileScanTimeoutMs });
  }
}

/** Descarga una página con el motor elegido. */
async function fetchPage(url, { useJavaScript, signal }) {
  if (useJavaScript) {
    try {
      return await renderPage(url);
    } catch (error) {
      logger.warn(`Puppeteer falló en ${url}, usando HTTP directo`, error.message);
      return tryFetchHtml(url, { signal });
    }
  }
  return tryFetchHtml(url, { signal });
}

/**
 * FASE 1 — recorre la paginación y acumula links.
 * Corta si: se acaban las páginas, una página no devuelve links, se supera el
 * tope de links, o el cliente cancela.
 */
async function collectLinks(options) {
  const {
    searchUrl,
    pageParam,
    linkPattern,
    startPage,
    endPage,
    useJavaScript,
    signal,
    onProgress,
  } = options;

  const links = new Set();
  // Hay paginación si se dio un parámetro O si la URL trae una plantilla {page}
  const usePagination = hasPageTemplate(searchUrl) || Boolean(pageParam && pageParam.trim() !== '');
  let pagesScraped = 0;
  let truncated = false;

  if (!usePagination) {
    const html = await fetchPage(searchUrl, { useJavaScript, signal });
    if (html) {
      pagesScraped = 1;
      for (const link of extractMatchingLinks(html, searchUrl, linkPattern)) {
        if (links.size >= config.crawl.maxLinks) {
          truncated = true;
          break;
        }
        links.add(link);
      }
      onProgress?.({ currentPage: 1, totalPages: 1, linksFound: links.size });
    }
    return { links: [...links], pagesScraped, truncated };
  }

  for (let page = startPage; page <= endPage; page += 1) {
    if (signal?.aborted) break;

    const pageUrl = buildPageUrl(searchUrl, pageParam, page, startPage);
    const html = await fetchPage(pageUrl, { useJavaScript, signal });

    if (!html) {
      logger.warn(`Sin contenido en la página ${page}, se detiene la paginación`);
      break;
    }

    pagesScraped += 1;
    const pageLinks = extractMatchingLinks(html, pageUrl, linkPattern);

    for (const link of pageLinks) {
      if (links.size >= config.crawl.maxLinks) {
        truncated = true;
        break;
      }
      links.add(link);
    }

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
 * FASE 2 — visita cada link y busca ficheros por extensión.
 *
 * Sustituye al esquema de lotes secuenciales anterior por un pool de workers
 * real: en cuanto un worker termina una URL coge la siguiente, sin esperar a
 * que el resto del lote acabe.
 */
async function findFiles(urls, options) {
  const {
    extensions,
    concurrency,
    useJavaScript,
    licenseFilter,
    signal,
    onProgress,
    onFilesFound,
  } = options;

  const files = new Set();
  // Metadatos por fichero. La duracion sale del HTML que ya se descargo para
  // buscar los ficheros, asi que no cuesta ninguna peticion extra.
  const details = new Map();
  const failures = [];
  const skippedByLicense = [];
  let processed = 0;
  let truncated = false;

  let limit = Math.min(
    Math.max(1, concurrency ?? config.crawl.defaultConcurrency),
    config.crawl.maxConcurrency
  );

  // Con navegador, la concurrencia real la marca el pool de pestañas: lanzar
  // 12 workers contra un pool de 2 solo genera cola. Se ajusta el límite para
  // que el progreso que ve el usuario refleje lo que de verdad ocurre.
  if (useJavaScript) {
    limit = Math.min(limit, config.browser.poolSize);
  }

  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      if (signal?.aborted || truncated) return;

      const index = cursor;
      cursor += 1;
      const url = urls[index];

      onProgress?.({ current: index + 1, total: urls.length, url });

      // Los links vienen de HTML de terceros: revalidar antes de pedirlos
      if (!(await isUrlSafe(url))) {
        failures.push({ url, error: 'Destino bloqueado por política de seguridad' });
        processed += 1;
        continue;
      }

      try {
        // La fase 2 iba SIEMPRE por HTTP plano, así que en sitios que sirven
        // el reproductor con JavaScript encontraba los enlaces pero ningún
        // fichero, y en los que bloquean clientes sin navegador fallaba entera.
        const html = useJavaScript
          ? await renderPageOrFallback(url, { signal })
          : await fetchHtmlWithRetry(url, { signal, timeout: config.http.fileScanTimeoutMs });

        // Filtro de licencia: solo se conserva lo que el publicador declara
        // explícitamente como abierto. Sin declaración se asume cerrado,
        // porque por defecto una obra nace con todos los derechos reservados.
        if (licenseFilter === 'open-only') {
          const license = detectLicense(html);
          if (!license.isOpen) {
            skippedByLicense.push({
              url,
              reason: license.declared
                ? `licencia no abierta (${license.value})`
                : 'sin licencia declarada',
            });
            processed += 1;
            continue;
          }
        }

        const found = extractFilesFromHtml(html, url, extensions);

        if (found.length > 0) {
          // Una pagina de detalle suele ser un solo video, asi que su
          // duracion vale para los ficheros que salen de ella.
          const duration = extractDuration(html);
          // Del mismo HTML sale también el tamaño que el sitio muestra en
          // pantalla. Se calcula una sola vez por ficha, aunque de ella
          // salgan varios ficheros.
          const declaredSize = withSizes ? extractSizeBytes(html) : null;
          const added = [];

          for (const file of found) {
            if (files.size >= config.crawl.maxFiles) {
              truncated = true;
              break;
            }
            if (!files.has(file)) {
              files.add(file);
              added.push(file);
              details.set(file, { url: file, duration, sourceUrl: url });
            }
          }

          if (withSizes) {
            for (const file of added) {
              if (signal?.aborted) break;

              // El HEAD es la fuente exacta, pero muchas URLs de fichero
              // redirigen a una dirección con token que no devuelve
              // content-length y vuelve null.
              const bytes = await fetchContentLength(file, { signal });
              const meta = details.get(file);
              if (!meta) continue;

              if (bytes !== null) {
                meta.sizeBytes = bytes;
                meta.size = formatFileSize(bytes);
                meta.sizeApproximate = false;
              } else if (declaredSize !== null) {
                // Respaldo: lo que el sitio dice en la ficha. Va marcado
                // como aproximado porque viene redondeado de origen, y
                // ademas la ficha describe el video, no necesariamente
                // este fichero concreto.
                meta.sizeBytes = declaredSize;
                meta.size = formatFileSize(declaredSize);
                meta.sizeApproximate = true;
              }
            }
          }

          if (added.length > 0) {
            onFilesFound?.({ url, files: added, details: added.map(f => details.get(f)) });
          }
        }
      } catch (error) {
        failures.push({ url, error: error.message });
      } finally {
        processed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, () => worker()));

  return {
    files: [...files],
    details: [...details.values()],
    processed,
    failures,
    truncated,
    skippedByLicense,
  };
}

/**
 * Crawl completo: fase 1 (+ fase 2 si hay extensiones).
 * `emit` recibe los eventos de progreso; es lo que alimenta el SSE.
 */
async function crawl(params, { signal, emit = () => {} } = {}) {
  const {
    searchUrl,
    pageParam = '',
    linkPattern = '',
    startPage = 1,
    endPage = 10,
    useJavaScript = false,
    extensions = [],
    concurrency,
    licenseFilter = 'off',
    withSizes = false,
  } = params;

  await assertUrlIsSafe(searchUrl);

  const startedAt = Date.now();

  // Señal compuesta: aborta si el cliente se desconecta O si el crawl supera
  // su duración máxima. Debe ser un AbortSignal real: axios llama a
  // signal.addEventListener, así que un objeto con un getter `aborted` no vale.
  const timeoutSignal = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(config.crawl.maxDurationMs),
  ]);

  emit({ type: 'phase1_start' });

  const {
    links,
    pagesScraped,
    truncated: linksTruncated,
  } = await collectLinks({
    searchUrl,
    pageParam,
    linkPattern,
    startPage,
    endPage,
    useJavaScript,
    signal: timeoutSignal,
    onProgress: progress => emit({ type: 'phase1_progress', ...progress }),
  });

  emit({
    type: 'phase1_complete',
    totalLinks: links.length,
    pagesScraped,
    truncated: linksTruncated,
    pattern: linkPattern || null,
  });

  let files = [];
  let fileDetails = [];
  let failures = [];
  let filesTruncated = false;
  let skippedByLicense = [];

  if (extensions.length > 0 && links.length > 0 && !timeoutSignal.aborted) {
    emit({ type: 'phase2_start', totalPages: links.length });

    const result = await findFiles(links, {
      extensions,
      concurrency,
      useJavaScript,
      licenseFilter,
      withSizes,
      signal: timeoutSignal,
      onProgress: progress => emit({ type: 'phase2_progress', ...progress }),
      onFilesFound: payload => emit({ type: 'files_found', ...payload }),
    });

    files = result.files;
    fileDetails = result.details ?? [];
    failures = result.failures;
    filesTruncated = result.truncated;
    skippedByLicense = result.skippedByLicense ?? [];
  }

  // Distinguir "lo canceló el usuario" de "se agotó el tiempo máximo": con
  // navegador en la fase 2 lo segundo es fácil de alcanzar, y decir
  // aborted:false ocultaba que el resultado estaba incompleto.
  const cancelled = Boolean(signal?.aborted);
  const timedOut = timeoutSignal.aborted && !cancelled;

  return {
    links,
    files,
    fileDetails,
    failures,
    pagesScraped,
    totalLinks: links.length,
    totalFiles: files.length,
    extensions,
    truncated: linksTruncated || filesTruncated,
    licenseFilter,
    skippedByLicense: skippedByLicense.length,
    aborted: cancelled,
    timedOut,
    maxDurationMs: config.crawl.maxDurationMs,
    durationMs: Date.now() - startedAt,
  };
}

/** Valida y normaliza los parámetros de crawl que llegan por la API. */
function normalizeCrawlParams(input) {
  const rawUrl = typeof input.searchUrl === 'string' ? input.searchUrl.trim() : '';
  if (!rawUrl) {
    throw new AppError('Se requiere searchUrl', 400, 'SEARCH_URL_REQUIRED');
  }

  const searchTerm = typeof input.searchTerm === 'string' ? input.searchTerm.trim() : '';

  // El término se sustituye antes que nada, para que el resto del flujo
  // (incluida la validación SSRF) trabaje ya con la URL definitiva.
  if (hasSearchTemplate(rawUrl) && searchTerm === '') {
    throw new AppError(
      'La URL usa {q} pero no se indicó ningún término de búsqueda',
      400,
      'SEARCH_TERM_REQUIRED'
    );
  }
  const searchUrl = applySearchTerm(rawUrl, searchTerm);

  const startPage = Math.max(1, Number.parseInt(input.startPage, 10) || 1);
  const requestedEnd = Number.parseInt(input.endPage, 10) || 10;
  const endPage = Math.max(startPage, requestedEnd);

  const pageParam = typeof input.pageParam === 'string' ? input.pageParam.trim() : '';
  const usePagination = hasPageTemplate(searchUrl) || pageParam !== '';

  // El tope solo tiene sentido si de verdad se van a recorrer páginas. Sin
  // pageParam se descarga UNA sola, así que rechazar endPage=51 era gratuito:
  // devolvía un 400 por un rango que nunca se iba a usar.
  if (usePagination && endPage - startPage + 1 > config.crawl.maxPages) {
    throw new AppError(
      `El rango pedido es de ${endPage - startPage + 1} páginas y el máximo es ${config.crawl.maxPages}`,
      400,
      'PAGE_RANGE_TOO_LARGE'
    );
  }

  const rawConcurrency = Number.parseInt(input.concurrency, 10);
  const concurrency = Number.isFinite(rawConcurrency)
    ? Math.min(Math.max(1, rawConcurrency), config.crawl.maxConcurrency)
    : config.crawl.defaultConcurrency;

  return {
    searchUrl,
    searchTerm,
    pageParam,
    linkPattern: typeof input.linkPattern === 'string' ? input.linkPattern.trim() : '',
    startPage,
    // Sin paginación solo se pide una página; normalizar endPage evita que el
    // resumen diga "1 a 51" cuando en realidad se recorrió una.
    endPage: usePagination ? endPage : startPage,
    useJavaScript: input.useJavaScript === true || input.useJavaScript === 'true',
    concurrency,
    // Solo dos valores: 'off' (todo) y 'open-only' (solo licencia abierta)
    licenseFilter: input.licenseFilter === 'open-only' ? 'open-only' : 'off',
    withSizes: input.withSizes === true || input.withSizes === 'true',
  };
}

module.exports = {
  crawl,
  collectLinks,
  findFiles,
  extractMatchingLinks,
  extractFilesFromHtml,
  normalizeCrawlParams,
};
