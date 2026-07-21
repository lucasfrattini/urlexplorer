'use strict';

const { formatDuration, formatFileSize } = require('./format');
const { asDocument, esDocumento } = require('./document');
const { toAbsoluteUrl } = require('./url');

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
  // Acepta HTML sin parsear o un documento ya cargado: en la fase 2 se saca
  // más de un dato de la misma ficha y no tiene sentido parsearla otra vez.
  if (!esDocumento(html) && (typeof html !== 'string' || html.trim() === '')) return null;

  const $ = asDocument(html);

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

/* ── Tamaño ────────────────────────────────────────────────────────────
 *
 * El HEAD que se hace para conocer el tamaño se queda en nada en bastantes
 * sitios: la URL del fichero responde con un 302 hacia una dirección con
 * token que no devuelve content-length. La columna quedaba vacía justo donde
 * más falta hace, que es distinguir un vídeo completo de un clip de vista
 * previa de 180 KB.
 *
 * Muchos sitios muestran el tamaño en la propia ficha ("245 MB"), así que se
 * saca de ahí como respaldo. El dato es ORIENTATIVO: está redondeado en
 * origen, así que quien lo consuma debe marcarlo como aproximado y no
 * mezclarlo con el que devuelve el HEAD, que sí es exacto.
 */

const SIZE_UNITS = {
  byte: 1,
  bytes: 1,
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

// Un número (con coma o punto decimal) pegado a una unidad. La unidad es
// obligatoria: sin ella, cualquier número suelto de la página valdría.
const SIZE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(bytes?|[kmgt]i?b)\b/i;

/**
 * Convierte "245 MB" o "1,5 GB" a bytes.
 *
 * La coma se trata siempre como separador decimal. En español también puede
 * ser de millares ("1.234 MB"), pero un tamaño escrito para leerse casi
 * siempre es decimal, y el dato es aproximado de todas formas.
 */
function parseSizeText(value) {
  if (typeof value !== 'string') return null;

  const match = value.match(SIZE_PATTERN);
  if (!match) return null;

  const amount = Number(match[1].replace(',', '.'));
  const unit = SIZE_UNITS[match[2].toLowerCase()];
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;

  return Math.round(amount * unit);
}

/** Recorre el JSON-LD buscando contentSize o fileSize. */
function sizeFromJsonLd($) {
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
        if (/^(contentSize|fileSize)$/i.test(key)) {
          // Puede venir como número de bytes o como texto con unidad
          if (typeof value === 'number' && value > 0) {
            found = Math.round(value);
          } else if (typeof value === 'string') {
            // "1.5 GB" o un número de bytes en forma de texto
            const asNumber = Number(value);
            found =
              parseSizeText(value) ??
              (Number.isFinite(asNumber) && asNumber > 0 ? Math.round(asNumber) : null);
          }
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
 * Tamaño declarado en el HTML de la ficha, en bytes, o null.
 * De la fuente más fiable a la más frágil, igual que la duración.
 */
function extractSizeBytes(html) {
  // Acepta HTML sin parsear o un documento ya cargado: en la fase 2 se saca
  // más de un dato de la misma ficha y no tiene sentido parsearla otra vez.
  if (!esDocumento(html) && (typeof html !== 'string' || html.trim() === '')) return null;

  const $ = asDocument(html);

  // 1. Metadatos declarados
  const meta =
    $('meta[itemprop="contentSize"]').attr('content') ||
    $('meta[property="video:size"]').attr('content') ||
    $('meta[property="og:video:size"]').attr('content');
  if (meta) {
    const parsed = parseSizeText(meta) ?? (Number(meta) > 0 ? Math.round(Number(meta)) : null);
    if (parsed) return parsed;
  }

  // 2. JSON-LD
  const jsonLd = sizeFromJsonLd($);
  if (jsonLd) return jsonLd;

  // 3. itemprop suelto
  const itemprop =
    $('[itemprop="contentSize"]').attr('content') || $('[itemprop="contentSize"]').text();
  if (itemprop) {
    const parsed = parseSizeText(itemprop);
    if (parsed) return parsed;
  }

  // 4. Elementos que suelen mostrarlo. Se limita a estos en vez de barrer el
  //    texto de la página entera: un "500 MB" en un anuncio o en el pie
  //    acabaría tomándose por el tamaño del vídeo.
  const selectors = '[class*="size"], [class*="filesize"], [class*="peso"], [id*="size"]';
  let fromText = null;
  $(selectors).each((_, element) => {
    if (fromText) return;
    fromText = parseSizeText($(element).text());
  });
  if (fromText) return fromText;

  // 5. Una etiqueta explícita en cualquier parte del texto: "Tamaño: 245 MB"
  const labelled = $.root()
    .text()
    .match(/(?:tama[ñn]o|size|peso)\s*[:：]\s*([^\n]{0,24})/i);
  if (labelled) {
    const parsed = parseSizeText(labelled[1]);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Miniatura declarada por la ficha.
 *
 * Sale del MISMO documento que ya se parseó para los demás datos, así que no
 * cuesta ninguna petición ni ningún parseo extra. Se buscan las fuentes en
 * orden de fiabilidad: og:image es la que el sitio elige para representar la
 * página, y el `poster` del reproductor es la del vídeo concreto.
 */
function extractThumbnail(html, baseUrl) {
  if (!esDocumento(html) && (typeof html !== 'string' || html.trim() === '')) return null;

  const $ = asDocument(html);

  const candidatos = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[itemprop="thumbnailUrl"]').attr('content'),
    $('video[poster]').attr('poster'),
    thumbnailFromJsonLd($),
  ];

  for (const candidato of candidatos) {
    if (!candidato) continue;
    const absoluta = toAbsoluteUrl(String(candidato).trim(), baseUrl);
    // Solo http(s): un data: URI aquí sería enorme y no hay que descargarlo
    if (absoluta && /^https?:\/\//i.test(absoluta)) return absoluta;
  }

  return null;
}

/**
 * Miniatura de CADA vídeo de la página, no de la página entera.
 *
 * `extractThumbnail` da UNA imagen para toda la ficha (og:image…), que vale
 * cuando la ficha describe un solo vídeo. En una ficha con VARIOS vídeos —un
 * álbum— cada uno lleva su propio `poster` en el `<video>` que lo envuelve, y
 * estampar la imagen de la ficha a todos repetiría el fallo de la duración
 * que arregló relevance.js: un dato real, pero del vídeo equivocado. Aquí se
 * asocia el `poster` de cada `<video>` con su propio `src` y el de cada
 * `<source>` hijo: son la MISMA fuente en varias calidades, no vídeos
 * distintos.
 *
 * Devuelve un Map de URL de fichero → URL de miniatura. Un fichero sin
 * `<video poster>` reconocible no aparece en el mapa.
 */
function extractFileThumbnails(html, baseUrl) {
  const mapa = new Map();
  if (!esDocumento(html) && (typeof html !== 'string' || html.trim() === '')) return mapa;

  const $ = asDocument(html);

  $('video[poster]').each((_, element) => {
    const $video = $(element);
    const poster = toAbsoluteUrl(String($video.attr('poster') || '').trim(), baseUrl);
    if (!poster || !/^https?:\/\//i.test(poster)) return;

    const fuentes = [
      $video.attr('src'),
      ...$video
        .find('source[src]')
        .map((_, s) => $(s).attr('src'))
        .get(),
    ];

    for (const fuente of fuentes) {
      if (!fuente) continue;
      const absoluta = toAbsoluteUrl(String(fuente).trim(), baseUrl);
      if (absoluta) mapa.set(absoluta, poster);
    }
  });

  return mapa;
}

/**
 * Duración de CADA vídeo de la página, no de la página entera.
 *
 * Mismo problema que la miniatura: en un álbum, cada vídeo tiene su propia
 * duración, casi siempre en una insignia junto al reproductor (una ficha
 * hallada en producción la marca con `<span class="duration">`, HERMANA del
 * `<video>`, no hija suya). Se busca solo en el PADRE inmediato del
 * `<video>` —el contenedor de ESE vídeo concreto— y no más arriba: subir más
 * niveles arriesga cazar la insignia de un vídeo vecino, que es exactamente
 * el fallo que esto corrige.
 *
 * Devuelve un Map de URL de fichero → segundos. Sin insignia reconocible en
 * el contenedor inmediato, el vídeo no aparece en el mapa: mejor sin dato que
 * con el de otro vídeo.
 */
function extractFileDurations(html, baseUrl) {
  const mapa = new Map();
  if (!esDocumento(html) && (typeof html !== 'string' || html.trim() === '')) return mapa;

  const $ = asDocument(html);

  $('video').each((_, element) => {
    const $video = $(element);
    const fuentes = [
      $video.attr('src'),
      ...$video
        .find('source[src]')
        .map((_, s) => $(s).attr('src'))
        .get(),
    ].filter(Boolean);
    if (fuentes.length === 0) return;

    const contenedor = $video.parent();
    if (contenedor.length === 0) return;

    const texto = contenedor.find('[class*="duration"], [class*="length"]').first().text();
    const segundos = parseClockDuration(texto);
    if (segundos === null) return;

    for (const fuente of fuentes) {
      const absoluta = toAbsoluteUrl(String(fuente).trim(), baseUrl);
      if (absoluta) mapa.set(absoluta, segundos);
    }
  });

  return mapa;
}

/** Busca `thumbnailUrl` en el JSON-LD de la ficha. */
function thumbnailFromJsonLd($) {
  let encontrada = null;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (encontrada) return;
    try {
      const datos = JSON.parse($(element).text());
      const buscar = valor => {
        if (encontrada || !valor) return;
        if (Array.isArray(valor)) return valor.forEach(buscar);
        if (typeof valor !== 'object') return;

        const directa = valor.thumbnailUrl || valor.thumbnail;
        if (typeof directa === 'string') {
          encontrada = directa;
          return;
        }
        if (directa && typeof directa === 'object' && typeof directa.url === 'string') {
          encontrada = directa.url;
          return;
        }
        for (const anidado of Object.values(valor)) buscar(anidado);
      };
      buscar(datos);
    } catch {
      // JSON-LD roto: no es motivo para fallar
    }
  });

  return encontrada;
}

module.exports = {
  extractThumbnail,
  extractFileThumbnails,
  extractFileDurations,
  extractDuration,
  extractDurationSeconds,
  extractSizeBytes,
  formatDuration,
  formatFileSize,
  parseIsoDuration,
  parseClockDuration,
  parseSizeText,
};
