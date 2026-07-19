'use strict';

const cheerio = require('cheerio');

/**
 * Extracción de duración desde el HTML de una página de detalle.
 *
 * Se hace aquí y no con una petición aparte porque la fase 2 ya descarga esa
 * página para buscar los ficheros: la duración sale gratis del mismo HTML.
 * Una cabecera HTTP no la trae, así que sin esto habría que abrir cada vídeo.
 */

/** Convierte una duración ISO 8601 (PT1H2M3S) a segundos. */
function parseIsoDuration(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/i);
  if (!match) return null;
  const [, h, m, s] = match;
  const total = (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
  return total > 0 ? Math.round(total) : null;
}

/** Convierte "12:34" o "1:02:03" a segundos. */
function parseClockDuration(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, h, m, s] = match;
  const total = (Number(h) || 0) * 3600 + Number(m) * 60 + Number(s);
  return total > 0 ? total : null;
}

/** Segundos → "12:34" o "1:02:03". */
function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const seconds = Math.round(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = v => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Recorre el JSON-LD buscando un campo `duration`. */
function durationFromJsonLd($) {
  let found = null;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (found) return;
    let data;
    try {
      data = JSON.parse($(element).contents().text());
    } catch {
      return;
    }

    const walk = node => {
      if (found || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (found) return;
        if (/^duration$/i.test(key) && typeof value === 'string') {
          found = parseIsoDuration(value) ?? parseClockDuration(value);
        } else if (typeof value === 'object') {
          walk(value);
        }
      }
    };

    walk(data);
  });

  return found;
}

/**
 * Duración de la página, en segundos, o null.
 * Se prueban las formas habituales, de la más fiable a la más frágil.
 */
function extractDurationSeconds(html) {
  if (typeof html !== 'string' || html.trim() === '') return null;

  const $ = cheerio.load(html);

  // 1. Metadatos declarados: lo más fiable
  const metaSeconds =
    $('meta[property="video:duration"]').attr('content') ||
    $('meta[itemprop="duration"]').attr('content') ||
    $('meta[property="og:video:duration"]').attr('content');
  if (metaSeconds) {
    const asNumber = Number(metaSeconds);
    if (Number.isFinite(asNumber) && asNumber > 0) return Math.round(asNumber);
    const iso = parseIsoDuration(metaSeconds);
    if (iso) return iso;
  }

  // 2. JSON-LD
  const jsonLd = durationFromJsonLd($);
  if (jsonLd) return jsonLd;

  // 3. itemprop en cualquier elemento
  const itemprop = $('[itemprop="duration"]').attr('datetime') || $('[itemprop="duration"]').text();
  if (itemprop) {
    const parsed = parseIsoDuration(itemprop) ?? parseClockDuration(itemprop);
    if (parsed) return parsed;
  }

  // 4. Texto de los elementos que suelen mostrarla en el reproductor
  const selectors = '.duration, .video-duration, [class*="duration"], [class*="length"]';
  let fromText = null;
  $(selectors).each((_, element) => {
    if (fromText) return;
    fromText = parseClockDuration($(element).text());
  });
  if (fromText) return fromText;

  return null;
}

/** Igual que la anterior pero ya formateada. */
function extractDuration(html) {
  return formatDuration(extractDurationSeconds(html));
}

/**
 * Formatea bytes.
 * `if (!bytes)` devolvía null para 0, que es un tamaño válido, y Math.log de
 * valores menores que 1 daba un índice de unidad negativo.
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

module.exports = {
  extractDuration,
  extractDurationSeconds,
  formatDuration,
  formatFileSize,
  parseIsoDuration,
  parseClockDuration,
};
