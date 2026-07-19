'use strict';

const cheerio = require('cheerio');

const config = require('../config');
const { mapLimit } = require('../lib/concurrency');
const logger = require('../lib/logger');
const { renderPageWithMedia } = require('../lib/browser');
const { fetchHtml, fetchContentLength } = require('../lib/http');
const { assertUrlIsSafe } = require('../lib/ssrf');
const { toAbsoluteUrl, getExtension } = require('../lib/url');

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

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = value => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * Formatea bytes.
 * `if (!bytes)` devolvía null para 0 (un fichero vacío es un dato válido) y
 * Math.log de valores < 1 producía un índice de unidad negativo.
 */
function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined) return null;
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes === 0) return '0 Bytes';

  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0),
    units.length - 1
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** MÉTODO 2 — <video>, <source> y enlaces directos vía Cheerio. */
function extractVideosFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const videos = [];

  $('video, source').each((_, element) => {
    const $el = $(element);
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
      poster: toAbsoluteUrl($el.attr('poster'), baseUrl),
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
async function extractVideos(rawUrl, { getMetadata = false, useJavaScript = true, signal } = {}) {
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

module.exports = {
  extractVideos,
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
