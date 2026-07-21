/**
 * Lógica pura de la vista Vídeo (multi-URL, duplicados, filtros).
 *
 * Igual que `explorerOptions.js`, no toca el DOM a propósito: es la parte que
 * puede equivocarse EN SILENCIO —plegar un vídeo bajo el representante que no
 * es, dejar fuera un resultado que sí debería verse— así que vive aparte y
 * tiene test.
 */

/** Limpia una lista de direcciones: recorta, descarta vacías, admite un string suelto. */
export function limpiarUrls(urls) {
  return (Array.isArray(urls) ? urls : [urls]).map(u => String(u ?? '').trim()).filter(Boolean);
}

/**
 * Arma los parámetros que viajan a `/api/video/extract`.
 *
 * SIEMPRE como `urls` (array), aunque sea una sola dirección: es el shape que
 * ya agrupa duplicados en el servidor (`groups`), a diferencia del viejo
 * `{ url }` de una sola dirección que sigue existiendo solo por
 * retrocompatibilidad con otros llamadores.
 */
export function construirParamsVideo(
  urls,
  { getMetadata = false, getThumbnails = false, useJavaScript = true } = {}
) {
  return {
    urls: limpiarUrls(urls),
    getMetadata: Boolean(getMetadata),
    getThumbnails: Boolean(getThumbnails),
    useJavaScript: Boolean(useJavaScript),
  };
}

/**
 * Traduce los `groups` que manda el servidor (mismo shape que el Explorador:
 * `{ representante, miembros, motivos }`) a los dos mapas que la vista
 * necesita para plegar.
 *
 * `grupos`: representante -> grupo entero (para el panel de miembros).
 * `duplicadoDe`: miembro -> representante (para saber qué se pliega).
 */
export function indexarGrupos(groups) {
  const grupos = new Map();
  const duplicadoDe = new Map();

  for (const grupo of groups || []) {
    if (!grupo?.representante || !Array.isArray(grupo.miembros)) continue;
    grupos.set(grupo.representante, grupo);
    for (const miembro of grupo.miembros) {
      if (miembro !== grupo.representante) duplicadoDe.set(miembro, grupo.representante);
    }
  }

  return { grupos, duplicadoDe };
}

/**
 * Miembros de un grupo que siguen plegados bajo su representante: todos menos
 * el propio representante y los que el usuario ya sacó a mano
 * ("No es duplicado", que pesa más que el algoritmo y no se recalcula solo).
 */
export function miembrosPlegados(grupos, representante, desagrupados) {
  const grupo = grupos.get(representante);
  if (!grupo) return [];
  return grupo.miembros.filter(m => m !== representante && !(desagrupados?.has(m) ?? false));
}

/**
 * Filtra la lista de vídeos visibles: ocultados a mano, plegados bajo un
 * representante, tipo de archivo y término de búsqueda. Pura y sin estado
 * propio para poder probarla sin construir ningún DOM.
 */
export function filtrarVideos(
  videos,
  { ocultos, duplicadoDe, desagrupados, plegarDuplicados = true, activeType = 'all', needle = '' }
) {
  const term = String(needle ?? '')
    .trim()
    .toLowerCase();

  return (videos || []).filter(video => {
    if (ocultos?.has(video.url)) return false;

    // Lo que el usuario marcó como "no es duplicado" vuelve a la lista
    if (
      plegarDuplicados &&
      duplicadoDe?.has(video.url) &&
      !(desagrupados?.has(video.url) ?? false)
    ) {
      return false;
    }

    if (activeType !== 'all' && video.type !== activeType) return false;
    if (term && !video.url.toLowerCase().includes(term)) return false;

    return true;
  });
}
