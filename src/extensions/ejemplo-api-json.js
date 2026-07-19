'use strict';

/**
 * Extensión de EJEMPLO — sitio ficticio `galeria.ejemplo.com`.
 *
 * Existe para demostrar el patrón y para que los tests tengan algo real que
 * cargar. El dominio es ficticio a propósito: los sitios de verdad se
 * configuran con perfiles en `data/profiles.json`, que no se versiona.
 *
 * ── El problema que resolvería ────────────────────────────────────────
 *
 * Un sitio cuyo listado NO está en el HTML: la página trae un contenedor
 * vacío y el JavaScript pide los resultados a `/api/v1/search`. El motor
 * genérico ve cero enlaces, incluso con navegador, porque el contenido llega
 * como JSON y se pinta en elementos sin `<a href>`.
 *
 * Pedir el JSON directamente es además MUCHO más barato que renderizar: una
 * petición HTTP en vez de una pestaña de Chromium por página.
 *
 * ── Cuándo NO haría falta una extensión ───────────────────────────────
 *
 * Si el listado estuviera en el HTML pero con enlaces mezclados, bastaría un
 * patrón con expresión regular. Si llegara por JavaScript pero pintando
 * `<a href>` de verdad, bastaría activar el navegador. Una extensión es la
 * última opción: ver `src/extensions/README.md`.
 */

const HOST = 'galeria.ejemplo.com';

module.exports = {
  name: 'ejemplo-api-json',

  description:
    'Sitio de ejemplo cuyo listado se sirve por una API JSON en vez de en el HTML. ' +
    'Demuestra el patrón de extensión; el dominio es ficticio.',

  /** Se compara el hostname exacto o un subdominio suyo. */
  match(url) {
    return url.hostname === HOST || url.hostname.endsWith(`.${HOST}`);
  },

  /**
   * Pide la página del listado a la API y devuelve los enlaces de ficha.
   *
   * Se usa el `fetchPage` del contexto en vez de un cliente propio: así la
   * extensión hereda los timeouts, los reintentos, el throttling por dominio
   * y la validación SSRF del motor. Una extensión no debe abrir sus propias
   * conexiones ni saltarse esos controles.
   */
  async listar(pageUrl, ctx) {
    const url = new URL(pageUrl);
    const termino = url.searchParams.get('q') || '';
    const pagina = url.searchParams.get('page') || '1';

    const apiUrl = `https://${HOST}/api/v1/search?q=${encodeURIComponent(termino)}&page=${encodeURIComponent(pagina)}`;

    const cuerpo = await ctx.fetchPage(apiUrl);
    if (!cuerpo) return [];

    let datos;
    try {
      datos = JSON.parse(cuerpo);
    } catch {
      // La API ha devuelto algo que no es JSON (un error, un captcha). Se
      // devuelve vacío en vez de reventar: el motor lo trata como "esta
      // página no dio resultados" y para la paginación.
      return [];
    }

    const resultados = Array.isArray(datos?.results) ? datos.results : [];

    return resultados
      .map(item =>
        typeof item?.id === 'string' || typeof item?.id === 'number'
          ? `https://${HOST}/v/${item.id}`
          : null
      )
      .filter(Boolean);
  },

  /**
   * Saca el fichero de la ficha.
   *
   * En este sitio la URL del vídeo vive en un atributo `data-source` del
   * reproductor, no en un `<video src>` ni en un enlace, así que la
   * extracción genérica por extensión no la encuentra.
   */
  extraerFicheros(html, ctx) {
    const encontrados = [];

    // Primero lo genérico, por si además hay enlaces normales
    encontrados.push(...ctx.extractFilesFromHtml(html, ctx.baseUrl, ctx.extensions));

    for (const match of html.matchAll(/data-source=["']([^"']+)["']/g)) {
      const candidato = match[1];
      if (candidato.startsWith('http')) encontrados.push(candidato);
    }

    return [...new Set(encontrados)];
  },
};
