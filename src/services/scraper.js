'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { renderPage } = require('../lib/browser');
const { fetchHtml, fetchHtmlWithRetry, fetchContentLength } = require('../lib/http');
const { assertUrlIsSafe, isUrlSafe } = require('../lib/ssrf');
const {
  toAbsoluteUrl,
  hasExtension,
  hasPageTemplate,
  hasSearchTemplate,
  applySearchTerm,
} = require('../lib/url');
const { detectLicense } = require('../lib/license');
const {
  extractDurationSeconds,
  extractSizeBytes,
  extractThumbnail,
  extractFileThumbnails,
  extractFileDurations,
  formatDuration,
  formatFileSize,
} = require('../lib/media');
const { groupDuplicates } = require('../lib/dedupe');
const { asDocument } = require('../lib/document');
const { analizarRespuesta, analizarError, combinar } = require('../lib/blocking');
const { findExtension } = require('./extensions');
const { selectRelevantFiles, sizeLooksInconsistent } = require('../lib/relevance');
const { createLinkMatcher } = require('../lib/pattern');
const { resolveMode, ESTRATEGIAS, MODOS } = require('./pagination');

/** Selectores donde puede aparecer una referencia a un fichero. */
const FILE_SELECTORS =
  'a[href], img[src], video[src], audio[src], source[src], embed[src], object[data]';

/**
 * Extrae los links de un HTML que coinciden con `pattern`.
 *
 * Modos de `pattern`, según cómo esté escrito:
 *   - vacío             → todos los links
 *   - "/^\/videos\/\d+/" → expresión regular (barras + algún metacarácter)
 *   - "/..."            → se compara contra el href ORIGINAL del documento
 *   - "http..."         → se compara con startsWith sobre la URL absoluta
 *   - otra cosa         → se compara con includes sobre la URL absoluta
 *
 * Acepta un matcher ya compilado como tercer argumento. Compilar una vez por
 * exploración y no una por enlace no es solo cuestión de velocidad: es parte
 * de la defensa contra ReDoS, porque el presupuesto de tiempo se acumula en
 * el propio matcher a lo largo de toda la exploración.
 */
function extractMatchingLinks(html, baseUrl, pattern, diagnostico = null) {
  const $ = asDocument(html);
  const links = new Set();
  // Compatible con las llamadas que aún pasan la cadena del patrón
  const matcher =
    typeof pattern === 'object' && pattern !== null ? pattern : createLinkMatcher(pattern);

  $('a[href]').each((_, element) => {
    const rawHref = $(element).attr('href');
    const absolute = toAbsoluteUrl(rawHref, baseUrl);
    if (!absolute) return;

    // DIAGNÓSTICO (QW-D): se cuenta TODO enlace resoluble, case o no. Es lo
    // que luego permite decir "había 240 enlaces y ninguno casaba", en vez
    // de devolver una lista vacía sin explicación. No cambia lo que se
    // descarga ni lo que se devuelve: solo se apunta.
    if (diagnostico) {
      diagnostico.enlacesVistos += 1;
      anotarPrefijo(diagnostico, absolute);
    }

    if (matcher.test(rawHref, absolute)) links.add(absolute);
  });

  return [...links];
}

/**
 * Apunta el primer segmento de la ruta de un enlace.
 *
 * Sirve para proponer pistas cuando el patrón no casa con nada: los prefijos
 * más repetidos de la página son, casi siempre, el patrón que el usuario
 * buscaba. Se guarda solo el primer segmento porque es lo que se parece a un
 * patrón escribible ("/videos/"), no la ruta entera.
 */
function anotarPrefijo(diagnostico, absolute) {
  try {
    const { pathname } = new URL(absolute);
    const segmento = pathname.split('/').filter(Boolean)[0];
    if (!segmento) return;
    const prefijo = `/${segmento}/`;
    diagnostico.prefijos.set(prefijo, (diagnostico.prefijos.get(prefijo) || 0) + 1);
  } catch {
    // Una URL que no se puede parsear no aporta pista
  }
}

/** Estructura vacía de diagnóstico de la fase 1. */
function nuevoDiagnostico() {
  return {
    enlacesVistos: 0,
    prefijos: new Map(),
    bloqueo: { sospechoso: false, motivos: [] },
  };
}

/** Los `n` prefijos más frecuentes, como pista para el usuario. */
function prefijosMasFrecuentes(diagnostico, n = 3) {
  return [...diagnostico.prefijos.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([prefijo, veces]) => ({ prefijo, veces }));
}

/** Busca en un HTML las URLs cuya extensión real esté en `extensions`. */
function extractFilesFromHtml(html, baseUrl, extensions) {
  const $ = asDocument(html);
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

/**
 * Descarga una página con el motor elegido, observando señales de bloqueo.
 *
 * El cliente HTTP rechaza los 4xx, así que un bloqueo por código de estado
 * llega dentro del error y nunca por el camino normal: hay que mirar las dos
 * vías. Lo que se observa es SOSPECHA, no diagnóstico; ver lib/blocking.js.
 */
async function fetchPage(url, { useJavaScript, signal, diagnostico = null }) {
  const anotar = observacion => {
    if (diagnostico && observacion?.sospechoso) {
      diagnostico.bloqueo = combinar([diagnostico.bloqueo, observacion]);
    }
  };

  if (useJavaScript) {
    try {
      const html = await renderPage(url);
      // Un challenge devuelto con 200 se ve igual de bien en el navegador:
      // hay que mirar el contenido, no solo el estado.
      anotar(analizarRespuesta({ html }));
      return html;
    } catch (error) {
      logger.warn(`Puppeteer falló en ${url}, usando HTTP directo`, error.message);
    }
  }

  try {
    const html = await fetchHtml(url, { signal });
    anotar(analizarRespuesta({ html }));
    return html;
  } catch (error) {
    anotar(analizarError(error));
    logger.warn(`No se pudo descargar ${url}`, error.message);
    return null;
  }
}

/**
 * FASE 1 — recorre el listado y acumula links.
 *
 * El recorrido en sí vive en `services/pagination.js`, una función por modo.
 * Aquí se resuelve lo que comparten todas: qué motor descarga, qué patrón
 * filtra y qué topes se aplican.
 *
 * Corta si: se acaban las páginas, una página no devuelve links, se supera el
 * tope de links, o el cliente cancela.
 */
async function collectLinks(options) {
  const {
    searchUrl,
    pageParam,
    linkPattern,
    paginationMode,
    startPage,
    endPage,
    useJavaScript,
    signal,
    onProgress,
  } = options;

  // El patrón se compila UNA vez para toda la exploración: si fuese una vez
  // por página, cada una empezaría con el presupuesto de tiempo a cero y la
  // protección contra ReDoS no serviría de nada.
  const matcher = createLinkMatcher(linkPattern);

  // Diagnóstico de la fase 1: cuántos enlaces se vieron, qué prefijos son los
  // más frecuentes y si el sitio parece estar bloqueando. No influye en lo
  // que se descarga; sirve para poder explicar un resultado vacío.
  const diagnostico = nuevoDiagnostico();

  const modo = resolveMode({ paginationMode, searchUrl, pageParam });
  const estrategia = ESTRATEGIAS[modo];

  // Extensión por sitio, si alguna reclama esta URL. Sustituye solo al "de
  // dónde salen los enlaces de una página": el recorrido lo sigue llevando
  // la estrategia del modo, sin duplicar el bucle ni los topes.
  const extension = findExtension(searchUrl);
  if (extension?.listar) {
    logger.info(`Usando la extensión "${extension.name}" para listar ${searchUrl}`);
  }

  const resultado = await estrategia({
    searchUrl,
    pageParam,
    startPage,
    endPage,
    signal,
    onProgress,
    fetchPage: url => fetchPage(url, { useJavaScript, signal, diagnostico }),
    extract: (html, baseUrl) => extractMatchingLinks(html, baseUrl, matcher, diagnostico),
    listar: extension?.listar ? extension.listar.bind(extension) : null,
  });

  return {
    ...resultado,
    paginationMode: modo,
    extension: extension?.name || null,
    diagnostico: {
      enlacesVistos: diagnostico.enlacesVistos,
      prefijos: prefijosMasFrecuentes(diagnostico),
      bloqueo: diagnostico.bloqueo,
    },
  };
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
    // Faltaba en este destructuring aunque `crawl` sí lo pasaba, así que las
    // dos líneas que lo usan lanzaban ReferenceError en CADA URL de la fase 2.
    // El try/catch de abajo lo convertía en un fallo por URL en vez de en un
    // error visible, que es lo que lo mantuvo escondido.
    withSizes = false,
    // Miniaturas: NUNCA por defecto. Son peticiones extra a los sitios
    // explorados, así que solo si el usuario las pide.
    withThumbnails = false,
    licenseFilter,
    signal,
    /**
     * Objeto con `.pausado`. Cuando se pone a true, los workers dejan de
     * COGER trabajo nuevo pero los que ya están en vuelo terminan: frenar no
     * es abortar, y tirar a medias una página ya descargada sería perder
     * trabajo hecho por nada.
     */
    pausa = null,
    onProgress,
    onFilesFound,
  } = options;

  const files = new Set();
  // Metadatos por fichero. La duracion sale del HTML que ya se descargo para
  // buscar los ficheros, asi que no cuesta ninguna peticion extra.
  const details = new Map();
  const failures = [];

  /**
   * Sospecha de bloqueo observada en ESTA fase.
   *
   * La fase 1 ya la acumulaba y la fase 2 no miraba nada: un sitio que empieza
   * a responder 429 a mitad del recorrido dejaba sus fallos enterrados en
   * `failures`, sin motivo, indistinguibles de "esa ficha no tenía nada".
   * Es SOSPECHA, no diagnóstico (ver lib/blocking.js), y no cambia lo que se
   * descarga ni lo que se devuelve: solo se apunta.
   *
   * Lo comparten todos los workers, que corren concurrentes sobre el mismo
   * cursor; `combinar` funde sin repetir motivos.
   */
  let bloqueo = { sospechoso: false, motivos: [] };
  const anotarBloqueo = observacion => {
    if (observacion?.sospechoso) bloqueo = combinar([bloqueo, observacion]);
  };

  const skippedByLicense = [];
  let processed = 0;
  let truncated = false;
  // Ficheros de la página que NO eran de la página (anuncios, previews de
  // los relacionados). Se cuentan para que la omisión no sea silenciosa.
  let descartados = 0;

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
      // Frenado: no se coge nada más. `cursor` queda justo en el primer
      // pendiente, que es lo que se guarda para poder continuar.
      if (pausa?.pausado) return;

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

        // Un challenge servido con 200 llega por el camino bueno y se ve igual
        // de bien que una ficha: hay que mirar el contenido, no solo el estado.
        anotarBloqueo(analizarRespuesta({ html }));

        /**
         * UN solo parseo por ficha, repartido entre los cuatro extractores.
         *
         * De cada página de detalle se sacan los ficheros, la licencia, la
         * duración y el tamaño, y cada uno hacía su propio `cheerio.load()`
         * del MISMO documento: hasta cuatro parseos completos para leer
         * cuatro datos.
         *
         * Se declara AQUÍ, antes del filtro de licencia, porque ese filtro es
         * el primero que lo usa. Declararlo más abajo lo dejaba en zona
         * muerta temporal, que en este proyecto ya tumbó una barra entera.
         *
         * A las extensiones por sitio se les sigue pasando el HTML en crudo:
         * su contrato es público y puede que no usen cheerio.
         */
        const doc = asDocument(html);

        // Filtro de licencia: solo se conserva lo que el publicador declara
        // explícitamente como abierto. Sin declaración se asume cerrado,
        // porque por defecto una obra nace con todos los derechos reservados.
        if (licenseFilter === 'open-only') {
          const license = detectLicense(doc);
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

        // Si una extensión reclama esta ficha, extrae ella. Lo que devuelva
        // pasa por las mismas validaciones que el resto: la comprobación
        // SSRF de arriba y los topes de abajo. Una extensión no se salta los
        // límites del motor, solo sabe dónde mirar.
        const extension = findExtension(url);
        const candidatos = extension?.extraerFicheros
          ? extension.extraerFicheros(html, { baseUrl: url, extensions, extractFilesFromHtml })
          : extractFilesFromHtml(doc, url, extensions);

        // Una ficha no contiene solo su vídeo: también los clips de vista
        // previa de los relacionados y los anuncios de terceros. Se separa
        // el grano de la paja ANTES de estampar nada.
        const { files: clasificados, discarded } = selectRelevantFiles(candidatos, url);
        if (discarded.length > 0) {
          descartados += discarded.length;
          logger.debug(`Descartados ${discarded.length} ficheros ajenos en ${url}`);
        }

        const found = clasificados.map(f => f.url);
        const porUrl = new Map(clasificados.map(f => [f.url, f]));

        if (found.length > 0) {
          // Una ficha con UN solo fichero: su duración de página vale para
          // él. Con VARIOS —un álbum— cada uno tiene la suya, y estampar la
          // misma a todos es el mismo fallo que arregló relevance.js con la
          // duración de ficheros dudosos, aplicado esta vez a álbumes en vez
          // de a clips ajenos: un dato real, pero del vídeo equivocado. Por
          // eso el dato de página solo se usa cuando no hay ambigüedad
          // posible; con varios ficheros se intenta primero el dato POR
          // FICHERO (ver extractFileDurations/extractFileThumbnails), que
          // asocia cada `<video poster>`/insignia de duración con su propio
          // `<source>` en vez de repartir un único valor de página.
          const esFicheroUnico = found.length === 1;

          // Se extraen los segundos UNA vez y se formatean, en vez de llamar
          // a extractDuration() y extractDurationSeconds() por separado:
          // extractDuration es literalmente formatDuration(extractDurationSeconds(html)),
          // asi que pedir las dos parseaba el mismo HTML con cheerio dos
          // veces para acabar con el mismo numero. En la fase 2 eso es un
          // parseo completo de mas por CADA pagina de detalle.
          //
          // Se guardan los segundos ademas de la cadena porque la agrupacion
          // de duplicados compara la duracion EXACTA, y "12:34" ya ha perdido
          // precision.
          const paginaDurationSeconds = esFicheroUnico ? extractDurationSeconds(doc) : null;
          const duracionesPorFichero = extractFileDurations(doc, url);
          // Del mismo HTML sale también el tamaño que el sitio muestra en
          // pantalla. Se calcula una sola vez por ficha, aunque de ella
          // salgan varios ficheros.
          const declaredSize = withSizes ? extractSizeBytes(doc) : null;
          // Del MISMO documento ya parseado: no cuesta ni petición ni parseo
          const paginaThumbnail =
            withThumbnails && esFicheroUnico ? extractThumbnail(doc, url) : null;
          const miniaturasPorFichero = withThumbnails ? extractFileThumbnails(doc, url) : new Map();
          const added = [];

          for (const file of found) {
            if (files.size >= config.crawl.maxFiles) {
              truncated = true;
              break;
            }
            if (!files.has(file)) {
              files.add(file);
              added.push(file);

              // A un fichero que no se ha podido verificar NO se le pone
              // ninguna duración. Es justo lo que convertía un clip de cinco
              // segundos en "20:09": el dato era real, pero de otro vídeo.
              // Sin duración, el usuario ve que no se sabe.
              const info = porUrl.get(file);
              const durationSeconds = info?.suspect
                ? null
                : (duracionesPorFichero.get(file) ?? paginaDurationSeconds);
              details.set(file, {
                url: file,
                duration: formatDuration(durationSeconds),
                durationSeconds,
                suspect: info?.suspect === true,
                suspectReason: info?.reason || null,
                sourceUrl: url,
                thumbnail: miniaturasPorFichero.get(file) ?? paginaThumbnail,
              });
            }
          }

          if (withSizes) {
            for (const file of added) {
              if (signal?.aborted) break;

              // El HEAD es la fuente exacta, pero muchas URLs de fichero
              // redirigen a una dirección con token que no devuelve
              // content-length y vuelve null.
              // Se envía la ficha como Referer: sin ella los CDN con
              // protección de hotlinking devuelven 403 y el peso se pierde.
              const bytes = await fetchContentLength(file, { signal, referer: url });
              const meta = details.get(file);
              if (!meta) continue;

              if (bytes !== null) {
                meta.sizeBytes = bytes;
                meta.size = formatFileSize(bytes);
                meta.sizeApproximate = false;
                // Coherencia: una ficha que anuncia minutos y un fichero
                // que pesa como un clip no pueden ser el mismo vídeo. Se
                // marca en vez de descartar, porque el raro podría ser el
                // dato de la ficha.
                if (sizeLooksInconsistent(meta.durationSeconds, bytes)) {
                  meta.suspect = true;
                  meta.suspectReason =
                    'el peso no cuadra con la duración anunciada: puede ser una vista previa';
                  meta.duration = null;
                  meta.durationSeconds = null;
                }
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
        // El cliente HTTP rechaza los 4xx, así que un bloqueo por código de
        // estado llega SIEMPRE por aquí y nunca por el camino normal. Sin el
        // log y sin el análisis, una racha de 429 quedaba solo como una lista
        // de `failures` sin motivo, que es lo que hacía imposible distinguir
        // "me están cerrando la puerta" de "esas fichas no tenían nada".
        logger.warn(`No se pudo procesar la ficha ${url}`, error.message);
        anotarBloqueo(analizarError(error));
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
    discardedFiles: descartados,
    skippedByLicense,
    // Interno, para que `crawl` lo funda en el `diagnostico` que ya viaja al
    // cliente: NO es un campo nuevo de la respuesta pública.
    bloqueo,
    // Lo que faltaba por mirar cuando se frenó
    pendientes: pausa?.pausado ? urls.slice(cursor) : [],
    paused: Boolean(pausa?.pausado),
  };
}

/**
 * Da forma de salida a los grupos de duplicados: solo los que tienen más de
 * un miembro y con las URLs en vez de los objetos completos. Es la forma que
 * espera el cliente, y la usan por igual `crawl` y `crawlMany`.
 */
function mapearGrupos(grupos) {
  return grupos
    .filter(g => g.miembros.length > 1)
    .map(g => ({
      representante: g.representante.url,
      miembros: g.miembros.map(m => m.url),
      motivos: g.motivos,
    }));
}

/**
 * Crawl completo: fase 1 (+ fase 2 si hay extensiones).
 * `emit` recibe los eventos de progreso; es lo que alimenta el SSE.
 */
async function crawl(params, opciones = {}) {
  const {
    signal,
    emit = () => {},
    pausa = null,
    /** Enlaces ya obtenidos: al continuar, la fase 1 no se repite. */
    linksPrevios = null,
    /** Ficheros ya encontrados antes de frenar, para fundirlos al final. */
    detallesPrevios = [],
    /**
     * Agrupar duplicados aquí mismo (por defecto). Se pone a `false` cuando
     * este crawl es UNA de varias direcciones de un lote multi-URL: entonces
     * la agrupación NO puede correr por dirección, porque dos copias del mismo
     * vídeo halladas en direcciones distintas no se verían nunca como
     * duplicadas. La hace `crawlMany` UNA sola vez sobre la fusión de todas.
     */
    group = true,
  } = opciones;
  const {
    searchUrl,
    pageParam = '',
    paginationMode = 'auto',
    linkPattern = '',
    startPage = 1,
    endPage = 10,
    useJavaScript = false,
    extensions = [],
    concurrency,
    licenseFilter = 'off',
    withSizes = false,
    withThumbnails = false,
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

  /**
   * Al CONTINUAR no se repite la fase 1.
   *
   * Los enlaces ya se recorrieron antes de frenar; volver a pedirlos sería
   * machacar el sitio para llegar exactamente a la misma lista.
   */
  let links = linksPrevios;
  let pagesScraped = 0;
  let linksTruncated = false;
  let scrollInfo = null;
  let modoUsado = paginationMode;
  let diagnostico = null;

  if (links === null) {
    emit({ type: 'phase1_start' });

    const fase1 = await collectLinks({
      searchUrl,
      pageParam,
      paginationMode,
      linkPattern,
      startPage,
      endPage,
      useJavaScript,
      signal: timeoutSignal,
      onProgress: progress => emit({ type: 'phase1_progress', ...progress }),
    });

    links = fase1.links;
    pagesScraped = fase1.pagesScraped;
    linksTruncated = fase1.truncated;
    scrollInfo = fase1.scroll;
    modoUsado = fase1.paginationMode;
    diagnostico = fase1.diagnostico;

    emit({
      type: 'phase1_complete',
      totalLinks: links.length,
      pagesScraped,
      truncated: linksTruncated,
      pattern: linkPattern || null,
      paginationMode: modoUsado,
      scroll: scrollInfo || null,
      diagnostico,
    });
  }

  let files = [];
  let fileDetails = [];
  let failures = [];
  let filesTruncated = false;
  let skippedByLicense = [];
  let discardedFiles = 0;
  let pendientes = [];
  let paused = false;

  if (extensions.length > 0 && links.length > 0 && !timeoutSignal.aborted) {
    emit({ type: 'phase2_start', totalPages: links.length });

    const result = await findFiles(links, {
      extensions,
      concurrency,
      useJavaScript,
      licenseFilter,
      withSizes,
      withThumbnails,
      pausa,
      signal: timeoutSignal,
      onProgress: progress => emit({ type: 'phase2_progress', ...progress }),
      onFilesFound: payload => emit({ type: 'files_found', ...payload }),
    });

    files = result.files;
    fileDetails = result.details ?? [];
    pendientes = result.pendientes ?? [];
    paused = result.paused === true;
    failures = result.failures;
    filesTruncated = result.truncated;
    skippedByLicense = result.skippedByLicense ?? [];
    discardedFiles = result.discardedFiles ?? 0;

    /**
     * La sospecha de bloqueo de la fase 2 va al MISMO campo que la de la fase
     * 1: el cliente ya lee `diagnostico.bloqueo` y lo enseña. Un campo aparte
     * sería un aviso que nadie muestra.
     */
    if (diagnostico) {
      diagnostico.bloqueo = combinar([diagnostico.bloqueo, result.bloqueo]);
    } else if (result.bloqueo?.sospechoso) {
      // Al CONTINUAR un trabajo frenado no se repite la fase 1, así que no hay
      // diagnóstico previo que rellenar. Se crea con la forma que el cliente
      // ya espera, y solo si hay algo que decir: un objeto con todo a cero no
      // aportaría nada.
      diagnostico = { enlacesVistos: 0, prefijos: [], bloqueo: result.bloqueo };
    }
  }

  // Distinguir "lo canceló el usuario" de "se agotó el tiempo máximo": con
  // navegador en la fase 2 lo segundo es fácil de alcanzar, y decir
  // aborted:false ocultaba que el resultado estaba incompleto.
  const cancelled = Boolean(signal?.aborted);
  const timedOut = timeoutSignal.aborted && !cancelled;

  // Agrupación de duplicados. NO filtra nada: se devuelven todos los ficheros
  // igual que antes, y los grupos van aparte para que la interfaz pueda
  // plegarlos y el usuario deshacerlo. Descartar en silencio le haría perder
  // resultados legítimos sin enterarse.
  /**
   * Al continuar, lo de antes y lo nuevo son UNA sola lista.
   *
   * Se funden ANTES de agrupar duplicados: si se agrupara cada tanda por su
   * cuenta, dos copias del mismo vídeo encontradas en tandas distintas no se
   * verían nunca como duplicadas. El usuario frenó y siguió; para él es una
   * exploración, no dos.
   */
  if (detallesPrevios.length > 0) {
    const porUrl = new Map(detallesPrevios.map(d => [d.url, d]));
    for (const detalle of fileDetails) porUrl.set(detalle.url, detalle);
    fileDetails = [...porUrl.values()];
    files = [...new Set([...detallesPrevios.map(d => d.url), ...files])];
  }

  // En un lote multi-URL la agrupación NO corre aquí: `crawlMany` la hace una
  // sola vez sobre la fusión de todas las direcciones. Agrupar por dirección
  // dejaría escapar los duplicados que están repartidos entre ellas.
  const { grupos, totalDuplicados } = group
    ? groupDuplicates(fileDetails)
    : { grupos: [], totalDuplicados: 0 };

  /**
   * Segunda agrupacion, mas agresiva: la duracion sola basta.
   *
   * Se calcula aqui y se manda junto a la conservadora para que el usuario
   * pueda cambiar de modo sin volver a explorar. Cuesta otra pasada, pero la
   * agrupacion son ~33 ms con 2000 ficheros.
   *
   * NO es el modo por defecto, y el motivo esta medido: ver lib/dedupe.js.
   * Con mil resultados, agrupar solo por duracion esconde uno de cada cuatro
   * videos buenos detras de otro que no tiene nada que ver.
   */
  const porDuracion = group
    ? groupDuplicates(fileDetails, { soloDuracion: true })
    : { grupos: [], totalDuplicados: 0 };

  return {
    links,
    files,
    fileDetails,
    duplicateGroups: mapearGrupos(grupos),
    totalDuplicados,
    duplicateGroupsPorDuracion: mapearGrupos(porDuracion.grupos),
    totalDuplicadosPorDuracion: porDuracion.totalDuplicados,
    failures,
    pagesScraped,
    totalLinks: links.length,
    totalFiles: files.length,
    extensions,
    truncated: linksTruncated || filesTruncated,
    licenseFilter,
    skippedByLicense: skippedByLicense.length,
    // Ficheros que estaban en la página pero no eran suyos
    discardedFiles,
    suspectFiles: fileDetails.filter(d => d.suspect).length,
    /**
     * Por qué el resultado puede estar vacío.
     *
     * `enlacesVistos` cuenta TODOS los enlaces de las páginas recorridas,
     * casen o no con el patrón: comparado con `totalLinks` dice si el patrón
     * se lo llevó todo por delante. `prefijos` son las rutas más repetidas,
     * como pista de qué patrón querría el usuario. `bloqueo` es una SOSPECHA
     * de que el sitio esté rechazando peticiones automáticas.
     */
    diagnostico,
    /**
     * Frenado a medias: quedan enlaces por mirar y se pueden continuar.
     * `pendientes` NO va al cliente —son miles de URLs— sino que lo guarda
     * el registro de trabajos; ver routes/scrape.js.
     */
    paused,
    pendientes,
    aborted: cancelled,
    timedOut,
    maxDurationMs: config.crawl.maxDurationMs,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Funde los diagnósticos de fase 1 de varias direcciones en uno solo.
 *
 * `enlacesVistos` se suma, los prefijos se acumulan y se quedan los tres más
 * repetidos del conjunto, y la sospecha de bloqueo se combina sin repetir
 * motivos. Con una sola dirección se devuelve tal cual, para que el lote de
 * una URL no cambie la forma que ya conoce el cliente.
 */
function fusionarDiagnosticos(diagnosticos) {
  if (!Array.isArray(diagnosticos) || diagnosticos.length === 0) return null;
  if (diagnosticos.length === 1) return diagnosticos[0];

  let enlacesVistos = 0;
  const prefijos = new Map();
  const bloqueos = [];
  for (const d of diagnosticos) {
    enlacesVistos += d.enlacesVistos || 0;
    for (const { prefijo, veces } of d.prefijos || []) {
      prefijos.set(prefijo, (prefijos.get(prefijo) || 0) + veces);
    }
    if (d.bloqueo) bloqueos.push(d.bloqueo);
  }
  const prefijosTop = [...prefijos.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([prefijo, veces]) => ({ prefijo, veces }));

  return { enlacesVistos, prefijos: prefijosTop, bloqueo: combinar(bloqueos) };
}

/**
 * Explora VARIAS direcciones con la MISMA configuración y agrupa los
 * duplicados UNA sola vez sobre la fusión de todas.
 *
 * Por qué existe: si cada dirección se agrupara por su cuenta, dos copias del
 * mismo vídeo halladas en direcciones distintas no se verían nunca como
 * duplicadas. Es la misma razón por la que continuar una exploración funde
 * antes de agrupar. Cada dirección se recorre con `crawl(..., { group:false })`
 * —reutilizando fase 1, fase 2, SSRF, topes y throttle tal cual, sin abrir
 * conexiones nuevas— y aquí solo se fusiona y se agrupa.
 *
 * Frenar y continuar operan A NIVEL DE LOTE: la dirección en curso se frena
 * como siempre (deja de coger enlaces de fase 2, termina lo que tiene en
 * vuelo) y las direcciones que faltan no se arrancan. Al continuar se sigue
 * por la dirección interrumpida —sin repetir su fase 1— y después por las
 * pendientes. El estado para continuar viaja en `estadoReanudar`, que guarda
 * el registro de trabajos; el cliente solo lleva el id.
 *
 * @param {{listaParams: object[], extensions?: string[]}} entrada
 */
async function crawlMany(entrada, opciones = {}) {
  const { listaParams, extensions = [] } = entrada;
  const { signal, emit = () => {}, pausa = null, reanudar = null } = opciones;

  if (!Array.isArray(listaParams) || listaParams.length === 0) {
    throw new AppError('Se requiere al menos una searchUrl', 400, 'SEARCH_URL_REQUIRED');
  }

  const total = listaParams.length;
  const startedAt = Date.now();

  // Fusión de detalles por URL de fichero. La última descripción gana, igual
  // que al continuar: dos direcciones pueden traer el mismo fichero.
  const detallesFusion = new Map();
  for (const d of reanudar?.detallesPrevios ?? []) detallesFusion.set(d.url, d);

  const linksTotales = new Set();
  const failures = [];
  const diagnosticos = [];
  let pagesScraped = 0;
  let truncated = false;
  let skippedByLicense = 0;
  let discardedFiles = 0;
  let aborted = false;
  let timedOut = false;

  let direccionesAnalizadas = reanudar?.direccionesPrevias ?? 0;
  const indiceInicio = reanudar?.indice ?? 0;

  let pausadoEnLote = false;
  let estadoReanudar = null;

  for (let i = indiceInicio; i < total; i += 1) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    // Frenado ENTRE direcciones: no se arranca la siguiente. Lo que falta es
    // esta dirección entera (aún sin empezar) y las que vengan detrás.
    if (pausa?.pausado) {
      pausadoEnLote = true;
      estadoReanudar = {
        indice: i,
        detallesPrevios: [...detallesFusion.values()],
        linksPendientes: [],
        direccionesPrevias: direccionesAnalizadas,
      };
      break;
    }

    const pUrl = listaParams[i];

    // Solo la dirección interrumpida arranca con sus enlaces pendientes: su
    // fase 1 ya se recorrió antes de frenar. Las demás empiezan de cero.
    const continuaInterrumpida =
      Boolean(reanudar) && i === indiceInicio && (reanudar.linksPendientes?.length ?? 0) > 0;

    emit({ type: 'url_start', urlActual: i + 1, urlTotal: total, searchUrl: pUrl.searchUrl });
    // Cada evento de progreso lleva en qué dirección va el lote, para que el
    // cliente pueda decir "dirección i de N".
    const emitUrl = evento => emit({ ...evento, urlActual: i + 1, urlTotal: total });

    const res = await crawl(
      { ...pUrl, extensions },
      {
        signal,
        emit: emitUrl,
        pausa,
        group: false,
        linksPrevios: continuaInterrumpida ? reanudar.linksPendientes : null,
        detallesPrevios: [],
      }
    );

    for (const d of res.fileDetails) detallesFusion.set(d.url, d);
    for (const l of res.links) linksTotales.add(l);
    failures.push(...res.failures);
    pagesScraped += res.pagesScraped;
    truncated = truncated || res.truncated;
    skippedByLicense += res.skippedByLicense;
    discardedFiles += res.discardedFiles;
    if (res.diagnostico) diagnosticos.push(res.diagnostico);
    if (res.timedOut) timedOut = true;

    if (res.aborted) {
      aborted = true;
      break;
    }

    // Frenado A MEDIAS de esta dirección: su fase 2 dejó enlaces sin mirar.
    // Se continúa POR ELLA, no por la siguiente.
    if (res.paused) {
      pausadoEnLote = true;
      estadoReanudar = {
        indice: i,
        detallesPrevios: [...detallesFusion.values()],
        linksPendientes: res.pendientes,
        direccionesPrevias: direccionesAnalizadas,
      };
      break;
    }

    // La dirección se recorrió entera y con éxito.
    direccionesAnalizadas += 1;

    if (timedOut) break;
  }

  const fileDetails = [...detallesFusion.values()];
  const files = fileDetails.map(d => d.url);

  // La agrupación corre UNA vez sobre la fusión: es la razón de ser de este
  // orquestador. Igual que en `crawl`, no filtra nada, solo agrupa.
  const { grupos, totalDuplicados } = groupDuplicates(fileDetails);
  const porDuracion = groupDuplicates(fileDetails, { soloDuracion: true });

  const cancelled = Boolean(signal?.aborted) || aborted;

  return {
    links: [...linksTotales],
    files,
    fileDetails,
    duplicateGroups: mapearGrupos(grupos),
    totalDuplicados,
    duplicateGroupsPorDuracion: mapearGrupos(porDuracion.grupos),
    totalDuplicadosPorDuracion: porDuracion.totalDuplicados,
    failures,
    pagesScraped,
    totalLinks: linksTotales.size,
    totalFiles: files.length,
    extensions,
    truncated,
    licenseFilter: listaParams[0].licenseFilter,
    skippedByLicense,
    discardedFiles,
    suspectFiles: fileDetails.filter(d => d.suspect).length,
    diagnostico: fusionarDiagnosticos(diagnosticos),
    // Detalle por dirección: el `diagnostico` fundido es para el resumen; este
    // permite que el cliente explique un vacío dirección por dirección.
    diagnosticoPorUrl: diagnosticos,
    // Cuántas direcciones se recorrieron con éxito, de cuántas se pidieron.
    direccionesAnalizadas,
    direccionesTotal: total,
    /**
     * Frenado a medias del lote. `estadoReanudar` NO viaja al cliente —lleva
     * miles de URLs pendientes— sino que lo guarda el registro de trabajos.
     * `pendientesTotal` es solo el número, para avisar sin descarte silencioso.
     */
    paused: pausadoEnLote,
    pendientes: pausadoEnLote ? estadoReanudar.linksPendientes : [],
    pendientesTotal: pausadoEnLote ? estadoReanudar.linksPendientes.length : 0,
    estadoReanudar,
    aborted: cancelled,
    timedOut,
    maxDurationMs: config.crawl.maxDurationMs,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Resuelve la lista de direcciones a explorar a partir de la entrada cruda.
 *
 * Acepta, en este orden, las formas con las que puede llegar:
 *   - `searchUrls` como array (POST con cuerpo JSON).
 *   - `searchUrls` como string JSON de un array (GET del SSE).
 *   - `searchUrl` repetido, que Express entrega como array (GET del SSE).
 *   - `searchUrl` como string único: retrocompatible con los enlaces
 *     compartidos y los perfiles guardados, que siguen mandando `searchUrl`.
 *
 * Devuelve strings sin espacios, sin vacíos y sin repetidos, en el orden en
 * que llegaron.
 */
function resolverSearchUrls(input = {}) {
  let candidatos = [];

  if (Array.isArray(input.searchUrls)) {
    candidatos = input.searchUrls;
  } else if (typeof input.searchUrls === 'string' && input.searchUrls.trim() !== '') {
    try {
      const parsed = JSON.parse(input.searchUrls);
      if (Array.isArray(parsed)) candidatos = parsed;
    } catch {
      // Un JSON inválido no es una lista: se cae a `searchUrl` más abajo.
    }
  }

  if (candidatos.length === 0) {
    if (Array.isArray(input.searchUrl)) candidatos = input.searchUrl;
    else if (typeof input.searchUrl === 'string') candidatos = [input.searchUrl];
  }

  const vistas = new Set();
  const urls = [];
  for (const item of candidatos) {
    if (typeof item !== 'string') continue;
    const limpio = item.trim();
    if (limpio === '' || vistas.has(limpio)) continue;
    vistas.add(limpio);
    urls.push(limpio);
  }
  return urls;
}

/**
 * Normaliza los parámetros de un lote de una o varias direcciones.
 *
 * La configuración (patrón, extensiones, paginación, rango…) es COMPARTIDA:
 * cada dirección pasa por `normalizeCrawlParams` con esa misma configuración,
 * reutilizando toda la validación de una sola URL (término de búsqueda, tope
 * de páginas) sin duplicarla. Devuelve un array de parámetros por URL; con una
 * sola dirección, ese único elemento es idéntico a `normalizeCrawlParams`.
 */
function normalizeCrawlParamsList(input = {}) {
  const urls = resolverSearchUrls(input);
  if (urls.length === 0) {
    throw new AppError('Se requiere searchUrl', 400, 'SEARCH_URL_REQUIRED');
  }
  if (urls.length > config.crawl.maxUrls) {
    throw new AppError(
      `Se pidieron ${urls.length} direcciones y el máximo es ${config.crawl.maxUrls}`,
      400,
      'TOO_MANY_URLS'
    );
  }
  return urls.map(url => normalizeCrawlParams({ ...input, searchUrl: url }));
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

  const paginationMode = MODOS.includes(input.paginationMode) ? input.paginationMode : 'auto';

  // En modo scroll no hay URLs por página: "Hasta" pasa a ser el número de
  // cargas, y el tope de páginas no aplica.
  const usePagination =
    paginationMode !== 'scroll' && (hasPageTemplate(searchUrl) || pageParam !== '');

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
    paginationMode,
    linkPattern: typeof input.linkPattern === 'string' ? input.linkPattern.trim() : '',
    startPage,
    // Sin paginación solo se pide una página; normalizar endPage evita que el
    // resumen diga "1 a 51" cuando en realidad se recorrió una.
    endPage: usePagination || paginationMode === 'scroll' ? endPage : startPage,
    useJavaScript: input.useJavaScript === true || input.useJavaScript === 'true',
    concurrency,
    // Solo dos valores: 'off' (todo) y 'open-only' (solo licencia abierta)
    licenseFilter: input.licenseFilter === 'open-only' ? 'open-only' : 'off',
    withSizes: input.withSizes === true || input.withSizes === 'true',
    withThumbnails: input.withThumbnails === true || input.withThumbnails === 'true',
  };
}

module.exports = {
  crawl,
  crawlMany,
  collectLinks,
  findFiles,
  extractMatchingLinks,
  extractFilesFromHtml,
  normalizeCrawlParams,
  normalizeCrawlParamsList,
  resolverSearchUrls,
};
