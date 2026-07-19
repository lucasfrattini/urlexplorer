'use strict';

/**
 * Utilidades de URL.
 *
 * En la versión anterior la lógica de absolutizar URLs estaba copiada seis
 * veces con la heurística `href.startsWith('http')`, que clasificaba mal
 * valores como "httpfoo/bar". Aquí hay una sola implementación basada en el
 * parser WHATWG que trae Node.
 */

/** Convierte un href/src relativo o absoluto en URL absoluta. */
function toAbsoluteUrl(href, baseUrl) {
  if (typeof href !== 'string' || href.trim() === '') return null;

  const trimmed = href.trim();
  // Descartar esquemas que nunca representan un recurso navegable
  if (/^(javascript|data|mailto|tel|blob|about):/i.test(trimmed)) return null;
  if (trimmed.startsWith('#')) return null;

  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Marcador del término de búsqueda: {q}, {query} o {termino}.
 *
 * Separa QUÉ se busca de DÓNDE se busca, que es lo que hace reutilizable una
 * configuración guardada: el sitio se guarda una vez con {q} en su sitio y
 * después solo se cambia la palabra.
 *   https://sitio.com/search/{q}/
 *   https://sitio.com/buscar?q={q}&page={page}
 */
const SEARCH_TEMPLATE = /\{(?:q|query|termino|término)\}/gi;

/** ¿La URL espera un término de búsqueda? */
function hasSearchTemplate(url) {
  if (typeof url !== 'string') return false;
  SEARCH_TEMPLATE.lastIndex = 0;
  return SEARCH_TEMPLATE.test(url);
}

/**
 * Sustituye {q} por el término, codificado.
 * Codificar es también lo seguro: un término con "/" o "?" no puede alterar
 * la estructura de la URL.
 */
function applySearchTerm(url, term) {
  if (typeof url !== 'string') return url;
  const encoded = encodeURIComponent(String(term ?? '').trim());
  return url.replace(SEARCH_TEMPLATE, encoded);
}

/**
 * Marcador de plantilla: {page} o {page:03} para rellenar con ceros.
 * Permite expresar cualquier formato de paginación, no solo "?param=N":
 *   https://sitio.com/buscar/gatos/page/{page}
 *   https://sitio.com/buscar?q=gatos&page={page}
 *   https://sitio.com/lista/{page:02}.html      → 01, 02, 03…
 */
const PAGE_TEMPLATE = /\{page(?::(\d+))?\}/gi;

/** ¿La URL trae un marcador de plantilla? */
function hasPageTemplate(url) {
  if (typeof url !== 'string') return false;
  PAGE_TEMPLATE.lastIndex = 0;
  return PAGE_TEMPLATE.test(url);
}

/** Sustituye {page} / {page:0N} por el número, con relleno de ceros. */
function applyPageTemplate(template, pageNumber) {
  return template.replace(PAGE_TEMPLATE, (_match, width) => {
    const digits = Number.parseInt(width, 10);
    return Number.isFinite(digits) && digits > 0
      ? String(pageNumber).padStart(digits, '0')
      : String(pageNumber);
  });
}

/**
 * Construye la URL de la página N.
 *
 * Dos modos:
 *   1. Plantilla — si searchUrl trae {page}, se sustituye. Cubre paginación
 *      por ruta (/page/2), por número con ceros (/lista/01.html) o por
 *      cualquier formato raro, incluida la primera página.
 *   2. Parámetro — comportamiento clásico: se añade o reemplaza ?param=N
 *      usando el parser de URL, no concatenando strings.
 */
// _startPage se mantiene en la firma por compatibilidad con las llamadas
// existentes, pero ya no decide nada: solo la página 1 va sin parámetro.
function buildPageUrl(searchUrl, pageParam, pageNumber, _startPage) {
  // Modo plantilla: sustituye SIEMPRE, también en la primera página, porque
  // si no la URL saldría con el literal "{page}" dentro.
  if (hasPageTemplate(searchUrl)) {
    return applyPageTemplate(searchUrl, pageNumber);
  }

  const name = normalizePageParam(pageParam);
  if (name === '') return searchUrl;

  // Solo la página 1 va sin parámetro, porque la URL canónica de un buscador
  // suele no llevarlo. Con `pageNumber === startPage` un startPage=3 pedía la
  // URL pelada y devolvía la página 1, así que arrancar por la mitad no
  // funcionaba y encima parecía que el sitio no paginaba.
  if (pageNumber <= 1) return searchUrl;

  try {
    const url = new URL(searchUrl);
    url.searchParams.set(name, String(pageNumber));
    return url.href;
  } catch {
    const separator = searchUrl.includes('?') ? '&' : '?';
    return `${searchUrl}${separator}${encodeURIComponent(name)}=${pageNumber}`;
  }
}

/**
 * Limpia el nombre del parámetro de página.
 *
 * Es natural copiarlo de la barra de direcciones como "&page", "?page" o
 * "page=". Sin limpiarlo, searchParams.set lo tomaba como parte del NOMBRE y
 * lo escapaba: "&page" acababa como "&%26page=2", que el sitio ignora.
 */
function normalizePageParam(pageParam) {
  if (typeof pageParam !== 'string') return '';
  return pageParam
    .trim()
    .replace(/^[?&]+/, '')
    .replace(/=+$/, '')
    .trim();
}

/** Normaliza ".MP4", "mp4" o " .mp4 " a "mp4". */
function normalizeExtension(ext) {
  if (typeof ext !== 'string') return '';
  return ext.trim().toLowerCase().replace(/^\.+/, '');
}

/** Convierte ".mp4, webm" en ["mp4", "webm"]. */
function parseExtensionList(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(normalizeExtension).filter(Boolean))];
  }
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return [...new Set(raw.split(',').map(normalizeExtension).filter(Boolean))];
}

/**
 * Comprueba la extensión REAL sobre el pathname de la URL.
 *
 * Sustituye a `url.toLowerCase().includes('.ts')`, que daba falsos positivos
 * con "/scripts/app.ts.backup" o con cualquier ".ts" dentro de la query string.
 */
function hasExtension(fileUrl, extensions) {
  if (!Array.isArray(extensions) || extensions.length === 0) return false;

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(fileUrl).pathname).toLowerCase();
  } catch {
    try {
      pathname = new URL(fileUrl).pathname.toLowerCase();
    } catch {
      return false;
    }
  }

  // Barras finales: muchos CDN sirven el fichero como ".../video.mp4/" y
  // endsWith('.mp4') daba falso, así que se descartaban ficheros válidos.
  pathname = pathname.replace(/\/+$/, '');

  return extensions.some(ext => {
    const normalized = normalizeExtension(ext);
    return normalized !== '' && pathname.endsWith(`.${normalized}`);
  });
}

/** Devuelve la extensión del pathname, sin punto, o cadena vacía. */
function getExtension(fileUrl) {
  let pathname;
  try {
    pathname = new URL(fileUrl).pathname.toLowerCase();
  } catch {
    return '';
  }
  const lastSegment = pathname.split('/').pop() || '';
  const dotIndex = lastSegment.lastIndexOf('.');
  return dotIndex === -1 ? '' : lastSegment.slice(dotIndex + 1);
}

/** Hostname en minúsculas, o null si la URL no parsea. */
function getHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

module.exports = {
  toAbsoluteUrl,
  buildPageUrl,
  hasPageTemplate,
  applyPageTemplate,
  hasSearchTemplate,
  applySearchTerm,
  normalizePageParam,
  normalizeExtension,
  parseExtensionList,
  hasExtension,
  getExtension,
  getHostname,
};
