'use strict';

const cheerio = require('cheerio');

const config = require('../config');
const { mapLimit } = require('../lib/concurrency');
const { formatDuration, formatFileSize } = require('../lib/format');
const { extractThumbnail, parseClockDuration, parseSizeText } = require('../lib/media');
const { groupDuplicates } = require('../lib/dedupe');
const { AppError } = require('../lib/errors');
const logger = require('../lib/logger');
const { renderPageWithMedia } = require('../lib/browser');
const { fetchHtml, fetchContentLength } = require('../lib/http');
const { assertUrlIsSafe } = require('../lib/ssrf');
const { toAbsoluteUrl, getExtension } = require('../lib/url');
const { escapeRegExp } = require('../lib/pattern');

/**
 * Extracción de videos de una única URL, por cuatro vías complementarias:
 *   1. Puppeteer: DOM renderizado + peticiones de red de tipo media.
 *   2. Cheerio sobre el HTML: <video>, <source> y enlaces directos.
 *   3. Players conocidos (YouTube, Vimeo, Twitch, Dailymotion).
 *   4. Regex sobre el HTML crudo, para URLs embebidas en JS/JSON.
 */

/** Extensión → etiqueta legible. Se compara la extensión real, no includes(). */
const VIDEO_TYPES = {
  mp4: 'MP4',
  avi: 'AVI',
  mkv: 'MKV',
  mov: 'MOV',
  wmv: 'WMV',
  flv: 'FLV',
  webm: 'WebM',
  m4v: 'M4V',
  '3gp': '3GP',
  ts: 'TS',
  m3u8: 'HLS (M3U8)',
  mpd: 'DASH (MPD)',
};

const VIDEO_EXTENSIONS = Object.keys(VIDEO_TYPES);

/**
 * Devuelve el tipo de video de una URL, o null.
 * La versión anterior usaba includes('.ts'), que marcaba como video cualquier
 * URL con ".ts" en medio (por ejemplo "/assets/app.tsx?v=1").
 */
function getVideoType(url) {
  const extension = getExtension(url);
  if (VIDEO_TYPES[extension]) return VIDEO_TYPES[extension];

  // Los manifiestos de streaming suelen llevar query string tras la extensión
  try {
    const { pathname } = new URL(url);
    const lower = pathname.toLowerCase();
    if (lower.endsWith('.m3u8')) return VIDEO_TYPES.m3u8;
    if (lower.endsWith('.mpd')) return VIDEO_TYPES.mpd;
  } catch {
    return null;
  }
  return null;
}

function isVideoUrl(url) {
  return getVideoType(url) !== null;
}

/** Deduce la calidad a partir de marcadores en la URL. */
function extractQualityFromUrl(url) {
  const lower = url.toLowerCase();
  if (/(^|\D)(2160|4k)(\D|$)/.test(lower)) return '4K';
  if (/(^|\D)(1080|1920)(\D|$)/.test(lower)) return '1080p';
  if (/(^|\D)(720|1280)(\D|$)/.test(lower)) return '720p';
  if (/(^|\D)(480|640)(\D|$)/.test(lower)) return '480p';
  if (/(^|\D)360(\D|$)/.test(lower)) return '360p';
  if (/(^|\D)240(\D|$)/.test(lower)) return '240p';
  return null;
}

/** Busca una duración declarada en el HTML cerca de la URL del video. */
function findDurationNear(html, videoUrl) {
  if (typeof html !== 'string' || html === '') return null;

  let fileName;
  try {
    fileName = new URL(videoUrl).pathname.split('/').pop();
  } catch {
    fileName = videoUrl.split('/').pop();
  }
  if (!fileName) return null;

  const escaped = escapeRegExp(fileName.split('?')[0]);
  const patterns = [
    new RegExp(`${escaped}[^}]{0,200}?duration["']?\\s*[:=]\\s*["']?(\\d+)`, 'i'),
    new RegExp(
      `"url"\\s*:\\s*"[^"]*${escaped}[^"]*"[^}]{0,200}?"duration"\\s*:\\s*"?(\\d+)"?`,
      'i'
    ),
    new RegExp(`data-duration\\s*=\\s*["'](\\d+)["'][^>]{0,200}?${escaped}`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return formatDuration(Number.parseInt(match[1], 10));
  }
  return null;
}

/** MÉTODO 3 — players embebidos de plataformas conocidas. */
function detectKnownPlayers(html) {
  if (typeof html !== 'string') return [];
  const players = [];
  const seen = new Set();

  const add = player => {
    const key = `${player.platform}:${player.videoId}`;
    if (seen.has(key)) return;
    seen.add(key);
    players.push(player);
  };

  for (const match of html.matchAll(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{6,})/g)) {
    const videoId = match[1];
    add({
      type: 'YouTube',
      platform: 'youtube',
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    });
  }

  for (const match of html.matchAll(/vimeo\.com\/(?:video\/)?(\d+)/g)) {
    const videoId = match[1];
    add({
      type: 'Vimeo',
      platform: 'vimeo',
      videoId,
      embedUrl: `https://player.vimeo.com/video/${videoId}`,
      watchUrl: `https://vimeo.com/${videoId}`,
    });
  }

  for (const match of html.matchAll(/twitch\.tv\/videos\/(\d+)/g)) {
    const videoId = match[1];
    add({
      type: 'Twitch',
      platform: 'twitch',
      videoId,
      watchUrl: `https://www.twitch.tv/videos/${videoId}`,
    });
  }

  for (const match of html.matchAll(
    /dailymotion\.com\/(?:video\/|embed\/video\/)([a-zA-Z0-9]+)/g
  )) {
    const videoId = match[1];
    add({
      type: 'Dailymotion',
      platform: 'dailymotion',
      videoId,
      embedUrl: `https://www.dailymotion.com/embed/video/${videoId}`,
      watchUrl: `https://www.dailymotion.com/video/${videoId}`,
    });
  }

  return players;
}

/** MÉTODO 4 — URLs de video embebidas en scripts o JSON. */
function extractVideoUrlsFromContent(html) {
  if (typeof html !== 'string') return [];
  const videos = [];
  const seen = new Set();

  for (const match of html.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) {
    const cleaned = match[0].replace(/[.,;'")\]]+$/, '');
    if (seen.has(cleaned)) continue;
    const type = getVideoType(cleaned);
    if (!type) continue;
    seen.add(cleaned);
    videos.push({
      url: cleaned,
      type,
      quality: extractQualityFromUrl(cleaned),
      element: 'script-content',
    });
  }

  return videos;
}

/**
 * Duración de UN vídeo concreto, buscada en su contenedor inmediato.
 *
 * Muchos sitios muestran la duración como una insignia de texto HERMANA del
 * `<video>` (mismo contenedor, no dentro de él), no como un atributo. Se
 * busca solo en el PADRE directo del vídeo —su propio contenedor— y no más
 * arriba: subir más niveles arriesga cazar la insignia de un vídeo vecino en
 * una lista, que es el mismo fallo que esto corrige para la miniatura.
 */
function buscarDuracionEnContenedor($video) {
  const contenedor = $video.parent();
  if (contenedor.length === 0) return null;
  const texto = contenedor.find('[class*="duration"], [class*="length"]').first().text();
  return formatDuration(parseClockDuration(texto));
}

/**
 * MÉTODO 2 — <video>, <source> y enlaces directos vía Cheerio.
 *
 * El `poster` y la `duration` de un vídeo van en el `<video>` que lo
 * envuelve, no en el `<source>` hijo que trae la URL real del fichero.
 * Recorrer `video, source` como una lista plana —la versión anterior— pierde
 * esa relación: el `<source>` no tiene ningún `poster` propio que leer, y el
 * `<video>` sin `src` directo (todo en el `<source>`) no producía ninguna
 * fila. El resultado eran vídeos con `poster: null`, que aguas abajo cae al
 * `og:image` de TODA la página para cada uno de ellos: un álbum de 30 vídeos
 * distintos acababa con la misma miniatura en los 30, y de ahí el falso
 * positivo de duplicados.
 *
 * Aquí se recorren los `<video>` uno a uno; su `poster` y su `data-duration`
 * se aplican a SU PROPIO `src` y al de cada `<source>` hijo —son la misma
 * fuente en varias calidades, no vídeos distintos—. Solo un `<source>` sin
 * `<video>` padre (poco habitual, pero posible) se procesa suelto, sin
 * poster ni duración que heredar.
 */
function extractVideosFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const videos = [];

  $('video').each((_, videoEl) => {
    const $video = $(videoEl);
    const poster = toAbsoluteUrl($video.attr('poster'), baseUrl);
    const duration = $video.attr('data-duration')
      ? formatDuration(Number.parseInt($video.attr('data-duration'), 10))
      : buscarDuracionEnContenedor($video);

    const fuentes = [
      {
        el: videoEl,
        raw: $video.attr('src') || $video.attr('data-src') || $video.attr('data-video-src'),
        quality: $video.attr('data-quality'),
      },
    ];
    $video.find('source').each((_, sourceEl) => {
      const $source = $(sourceEl);
      fuentes.push({
        el: sourceEl,
        raw: $source.attr('src') || $source.attr('data-src') || $source.attr('data-video-src'),
        quality: $source.attr('data-quality'),
      });
    });

    for (const fuente of fuentes) {
      const url = toAbsoluteUrl(fuente.raw, baseUrl);
      if (!url) continue;
      const type = getVideoType(url);
      if (!type) continue;

      videos.push({
        url,
        type,
        quality: fuente.quality || extractQualityFromUrl(url),
        duration,
        element: `cheerio-${fuente.el.tagName}`,
        poster,
      });
    }
  });

  // <source> huérfano, sin <video> padre que reconocer: no hay de quién
  // heredar poster ni duración.
  $('source').each((_, element) => {
    const $el = $(element);
    if ($el.parent().is('video')) return;
    const raw = $el.attr('src') || $el.attr('data-src') || $el.attr('data-video-src');
    const url = toAbsoluteUrl(raw, baseUrl);
    if (!url) return;
    const type = getVideoType(url);
    if (!type) return;

    videos.push({
      url,
      type,
      quality: $el.attr('data-quality') || extractQualityFromUrl(url),
      duration: $el.attr('data-duration')
        ? formatDuration(Number.parseInt($el.attr('data-duration'), 10))
        : null,
      element: `cheerio-${element.tagName}`,
      poster: null,
    });
  });

  $('a[href]').each((_, element) => {
    const url = toAbsoluteUrl($(element).attr('href'), baseUrl);
    if (!url) return;
    const type = getVideoType(url);
    if (!type) return;

    videos.push({
      url,
      type,
      quality: extractQualityFromUrl(url),
      duration: null,
      element: 'cheerio-link',
    });
  });

  return videos;
}

/** Deduplica por URL conservando el registro con más información. */
function dedupeVideos(videos) {
  const byUrl = new Map();

  for (const video of videos) {
    const existing = byUrl.get(video.url);
    if (!existing) {
      byUrl.set(video.url, video);
      continue;
    }
    byUrl.set(video.url, {
      ...existing,
      ...Object.fromEntries(
        Object.entries(video).filter(([, value]) => value !== null && value !== undefined)
      ),
    });
  }

  return [...byUrl.values()];
}

/** Orquesta los cuatro métodos y devuelve la lista final. */
async function extractVideos(
  rawUrl,
  { getMetadata = false, getThumbnails = false, useJavaScript = true, signal } = {}
) {
  await assertUrlIsSafe(rawUrl);

  const url = rawUrl.trim();
  const methods = { puppeteer: false, cheerio: false, knownPlayers: false, scriptAnalysis: false };
  let html = '';
  const videos = [];

  // MÉTODO 1 — Puppeteer
  if (useJavaScript && config.browser.enabled) {
    try {
      const rendered = await renderPageWithMedia(url, { isMediaUrl: isVideoUrl });
      html = rendered.html;
      methods.puppeteer = true;

      for (const domVideo of rendered.domVideos) {
        const absolute = toAbsoluteUrl(domVideo.url, url);
        if (!absolute) continue;
        const type = getVideoType(absolute);
        if (!type) continue;

        videos.push({
          url: absolute,
          type,
          quality: extractQualityFromUrl(absolute),
          duration: formatDuration(domVideo.duration),
          element: `puppeteer-${domVideo.element}`,
          width: domVideo.width || null,
          height: domVideo.height || null,
          poster: toAbsoluteUrl(domVideo.poster, url),
        });
      }

      for (const request of rendered.mediaRequests) {
        const type = getVideoType(request.url);
        if (!type) continue;
        videos.push({
          url: request.url,
          type,
          quality: extractQualityFromUrl(request.url),
          duration: null,
          element: 'network-request',
        });
      }

      logger.info(`Puppeteer encontró ${videos.length} candidatos en ${url}`);
    } catch (error) {
      // useAdvanced antes nunca se ponía a false y methods.puppeteer mentía
      methods.puppeteer = false;
      logger.warn(`Puppeteer falló en ${url}, se usa el método tradicional`, error.message);
    }
  }

  // MÉTODO 2 — Cheerio. Se ejecuta si Puppeteer no dio HTML o no encontró nada.
  if (!html || videos.length === 0) {
    try {
      if (!html) html = await fetchHtml(url, { signal });
      videos.push(...extractVideosFromHtml(html, url));
      methods.cheerio = true;
    } catch (error) {
      logger.warn(`No se pudo analizar el HTML de ${url}`, error.message);
      if (!html) throw error;
    }
  }

  // MÉTODO 3 — players conocidos
  const players = detectKnownPlayers(html);
  methods.knownPlayers = players.length > 0;
  for (const player of players) {
    videos.push({
      url: player.embedUrl || player.watchUrl,
      type: player.type,
      quality: null,
      duration: null,
      element: `${player.platform}-player`,
      platform: player.platform,
      videoId: player.videoId,
      watchUrl: player.watchUrl,
      thumbnailUrl: player.thumbnailUrl || null,
    });
  }

  // MÉTODO 4 — regex sobre el HTML
  const scriptVideos = extractVideoUrlsFromContent(html);
  methods.scriptAnalysis = scriptVideos.length > 0;
  videos.push(...scriptVideos);

  let unique = dedupeVideos(videos).slice(0, config.video.maxResults);

  // Duración deducida del HTML para los que aún no la tienen
  unique = unique.map(video =>
    video.duration ? video : { ...video, duration: findDurationNear(html, video.url) }
  );

  if (getThumbnails) {
    /**
     * Miniatura declarada por la ficha para los vídeos que aún no la traen.
     *
     * Los reproductores conocidos (YouTube y compañía) ya llegan con su
     * thumbnailUrl, así que no se les toca. Para el resto se prefiere el
     * `poster` del propio <video> —es la imagen de ESE vídeo—, que ahora
     * `extractVideosFromHtml` asocia bien incluso cuando el fichero real
     * cuelga de un `<source>` hijo (ver el comentario de esa función).
     *
     * La miniatura de la PÁGINA (og:image / twitter:image / JSON-LD) solo se
     * usa de respaldo cuando hay UN único vídeo: con varios, la página solo
     * puede declarar una imagen para representarlos a todos, y estampársela
     * al que no trae la suya propia es el mismo fallo que ya tenía la
     * duración —un dato real, pero de otro vídeo—. Con una lista larga era
     * lo que convertía docenas de vídeos distintos en "duplicados".
     *
     * Es una URL DECLARADA por el sitio: se devuelve para servirla luego vía
     * /api/thumbnail, NUNCA se descarga aquí (privacidad y CSP; ver
     * services/thumbnails.js). Solo http(s), igual que extractThumbnail.
     */
    const soloUnVideo = unique.length === 1;
    const paginaThumb = soloUnVideo ? extractThumbnail(html, url) : null;
    for (const video of unique) {
      if (video.thumbnailUrl) continue;
      const propia = typeof video.poster === 'string' && /^https?:\/\//i.test(video.poster);
      const elegida = propia ? video.poster : paginaThumb;
      if (elegida) video.thumbnailUrl = elegida;
    }
  }

  if (getMetadata) {
    /**
     * Pesos en paralelo acotado, no de uno en uno.
     *
     * Antes era un bucle estrictamente secuencial con un `sleep` fijo entre
     * peticiones: con los topes por defecto (100 búsquedas, 300 ms) eran 100
     * viajes de ida y vuelta en serie MÁS 30 segundos de espera pura, todo
     * dentro de la misma petición HTTP del usuario.
     *
     * El `sleep` sobraba: `fetchContentLength` ya pasa por `HostThrottle`,
     * que impone por hostname un intervalo mínimo y un tope de peticiones
     * simultáneas. La espera fija no añadía cortesía donde hacía falta —el
     * throttle ya la garantiza— y sí penalizaba a los vídeos servidos por
     * CDN distintos, que es justo donde no había motivo para esperar.
     */
    const lookups = unique.slice(0, config.video.maxMetadataLookups);

    await mapLimit(lookups, config.video.metadataConcurrency, async video => {
      if (signal?.aborted) return;

      // Un reproductor incrustado no tiene fichero que pesar
      if (video.platform) {
        video.size = 'Stream/Embed';
        return;
      }

      const bytes = await fetchContentLength(video.url, { signal });
      video.sizeBytes = bytes;
      video.size = formatFileSize(bytes);
    });
  }

  return { url, videos: unique, methods, total: unique.length };
}

/**
 * Adapta un vídeo a los campos que `groupDuplicates` compara.
 *
 * La agrupación es la MISMA que usa el Explorador (lib/dedupe.js), y espera
 * `url`, `thumbnail`, `durationSeconds` y `sizeBytes`. Un vídeo, en cambio,
 * lleva `thumbnailUrl`, `duration` como cadena de reloj ("10:30") y `size`
 * como texto. Aquí solo se traduce para alimentar el comparador: el shape que
 * el frontend ve de cada vídeo NO se toca.
 *
 * Un dato ausente queda a null, que es exactamente lo que la deduplicación ya
 * ignora: sin dato no se puede afirmar una coincidencia.
 */
function adaptarParaDedupe(video) {
  const durationSeconds =
    typeof video.duration === 'string' ? parseClockDuration(video.duration) : null;
  const sizeBytes = Number.isFinite(video.sizeBytes)
    ? video.sizeBytes
    : typeof video.size === 'string'
      ? parseSizeText(video.size)
      : null;

  return {
    url: video.url,
    thumbnail: video.thumbnailUrl || null,
    durationSeconds,
    sizeBytes,
  };
}

/**
 * Da forma de salida a los grupos: solo los de 2+ miembros y con las URLs en
 * vez de los objetos completos. Es el MISMO shape que `duplicateGroups` del
 * Explorador (ver `mapearGrupos` en services/scraper.js), para que vídeo y
 * explorador hablen igual con el frontend.
 */
function mapearGruposVideo(grupos) {
  return grupos
    .filter(g => g.miembros.length > 1)
    .map(g => ({
      representante: g.representante.url,
      miembros: g.miembros.map(m => m.url),
      motivos: g.motivos,
    }));
}

/**
 * Analiza VARIAS direcciones juntas y agrupa los duplicados UNA sola vez sobre
 * la fusión de todas.
 *
 * Es la misma razón por la que `crawlMany` agrupa al final y no por dirección:
 * dos copias del mismo vídeo halladas en direcciones distintas no se verían
 * nunca como duplicadas si cada dirección se agrupara por su cuenta. Para el
 * usuario es UN análisis, no varios.
 *
 * Cancelación (punto 14): el batch corre bajo el `signal` que arma la ruta con
 * `res.on('close')`. Si el cliente cierra el fetch, el signal se propaga a cada
 * `extractVideos` y el bucle deja de arrancar direcciones nuevas: cortar
 * limpio, sin endpoint de cancelación aparte.
 */
async function extractVideosBatch(rawUrls, opciones = {}) {
  const { getMetadata = false, getThumbnails = false, useJavaScript = true, signal } = opciones;

  // Direcciones limpias, sin vacíos ni repetidas, conservando el orden. Una
  // dirección repetida analizada dos veces solo duplicaría trabajo.
  const urls = [];
  const vistas = new Set();
  for (const item of Array.isArray(rawUrls) ? rawUrls : []) {
    if (typeof item !== 'string') continue;
    const limpio = item.trim();
    if (limpio === '' || vistas.has(limpio)) continue;
    vistas.add(limpio);
    urls.push(limpio);
  }

  if (urls.length === 0) {
    throw new AppError('Se requiere al menos una URL', 400, 'URL_REQUIRED');
  }
  // Mismo tope que el lote del Explorador: cada dirección es un análisis
  // completo, así que el máximo acota el trabajo de una sola petición.
  if (urls.length > config.crawl.maxUrls) {
    throw new AppError(
      `Se pidieron ${urls.length} direcciones y el máximo es ${config.crawl.maxUrls}`,
      400,
      'TOO_MANY_URLS'
    );
  }

  const methods = { puppeteer: false, cheerio: false, knownPlayers: false, scriptAnalysis: false };
  const todos = [];
  let direccionesAnalizadas = 0;

  for (const url of urls) {
    if (signal?.aborted) break;

    try {
      const res = await extractVideos(url, { getMetadata, getThumbnails, useJavaScript, signal });
      // Unión de los métodos: basta que UNA dirección lo usara.
      for (const clave of Object.keys(methods)) {
        methods[clave] = methods[clave] || res.methods[clave];
      }
      todos.push(...res.videos);
      direccionesAnalizadas += 1;
    } catch (error) {
      // Una dirección que falla no tumba el lote: se registra y se sigue. El
      // hueco entre `direccionesAnalizadas` y `direccionesTotal` es la señal
      // visible de que algo no se pudo analizar (nada de descartes mudos).
      logger.warn(`No se pudo analizar ${url} en el lote`, error.message);
    }
  }

  // Fusión: se funden por URL las apariciones del MISMO vídeo en direcciones
  // distintas, igual que dentro de una sola. La agrupación de duplicados corre
  // UNA vez sobre esa fusión.
  const videos = dedupeVideos(todos).slice(0, config.video.maxResults);
  const { grupos } = groupDuplicates(videos.map(adaptarParaDedupe));

  return {
    videos,
    groups: mapearGruposVideo(grupos),
    methods,
    direccionesAnalizadas,
    direccionesTotal: urls.length,
  };
}

module.exports = {
  extractVideos,
  extractVideosBatch,
  adaptarParaDedupe,
  getVideoType,
  isVideoUrl,
  extractQualityFromUrl,
  formatFileSize,
  formatDuration,
  detectKnownPlayers,
  extractVideoUrlsFromContent,
  extractVideosFromHtml,
  dedupeVideos,
  findDurationNear,
  VIDEO_EXTENSIONS,
  VIDEO_TYPES,
};
