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
 * Segundos de un vídeo, o null si no se conocen.
 *
 * Mismo criterio EXACTO que en `components/resultList.js`: se prefiere
 * `durationSeconds` si es un número finito, y si no se intenta parsear
 * `duration` como cadena de reloj ("H:MM:SS" / "MM:SS"). Un vídeo del backend
 * solo trae este segundo formato (ver `src/services/video.js`), así que en la
 * práctica siempre cae en el respaldo — pero el criterio es el mismo para
 * poder compartir después el mismo dato con `durationSeconds` si el backend
 * llegara a mandarlo.
 */
export function segundosDe(info) {
  if (Number.isFinite(info?.durationSeconds)) return info.durationSeconds;
  if (!info?.duration) return null;
  const partes = info.duration.split(':').map(Number);
  if (partes.some(n => !Number.isFinite(n))) return null;
  return partes.reduce((total, n) => total * 60 + n, 0);
}

/** Bytes de un vídeo, o null. Mismo criterio que en `resultList.js`. */
export function bytesDe(info) {
  return Number.isFinite(info?.sizeBytes) ? info.sizeBytes : null;
}

/**
 * Ordena una lista de vídeos por el campo y sentido indicados.
 *
 * Pura: devuelve un array nuevo, nunca muta `videos`. Con `campo === 'orden'`
 * no reordena: se respeta el orden en el que llegaron del servidor.
 *
 * Con cualquier otro campo, los vídeos SIN el dato van siempre al final, sea
 * cual sea la dirección — la misma regla que rige los filtros de rango:
 * colarlos arriba llenaría la primera pantalla de guiones.
 */
export function ordenarVideos(videos, { campo = 'orden', direccion = 'asc' } = {}) {
  const lista = videos || [];
  if (campo === 'orden') return [...lista];

  const signo = direccion === 'asc' ? 1 : -1;
  const valorDe = video => {
    if (campo === 'duracion') return segundosDe(video);
    if (campo === 'peso') return bytesDe(video);
    return video.url.toLowerCase();
  };

  return [...lista].sort((a, b) => {
    const va = valorDe(a);
    const vb = valorDe(b);

    // Sin dato, siempre al final
    const faltaA = va === null || va === undefined;
    const faltaB = vb === null || vb === undefined;
    if (faltaA && faltaB) return 0;
    if (faltaA) return 1;
    if (faltaB) return -1;

    if (typeof va === 'string') return signo * va.localeCompare(vb);
    return signo * (va - vb);
  });
}

/**
 * Progreso en vivo del análisis (stream SSE de `GET /api/video/stream`).
 *
 * Puro y sin DOM, por la misma razón que el resto de este fichero: es la
 * parte que puede equivocarse EN SILENCIO —una vía que se queda "pendiente"
 * para siempre, o un contador que no se reinicia entre direcciones— así que
 * conviene poder probarla sin construir ningún nodo.
 *
 * Las cuatro vías SIEMPRE llegan en este orden para cada dirección (ver
 * `extractVideos` en `src/services/video.js`), así que el estado avanza de
 * "pendiente" a "en curso" siguiendo ese mismo orden.
 */
export const VIAS_VIDEO = ['puppeteer', 'cheerio', 'knownPlayers', 'scriptAnalysis'];

function viasEnEspera() {
  return VIAS_VIDEO.map((via, indice) => ({
    via,
    estado: indice === 0 ? 'curso' : 'pendiente',
    encontrados: null,
  }));
}

/** Estado inicial del panel: sin dirección todavía, las cuatro vías en espera. */
export function estadoInicialProgreso() {
  return { direccion: null, vias: viasEnEspera() };
}

/**
 * Aplica UN evento del stream al estado del panel y devuelve un estado
 * NUEVO (nunca muta el que recibe), para que quien pinte pueda decidir con
 * un simple `!==` si hace falta repintar.
 *
 * `url_complete`, `complete` y `error` no tocan aquí: el hueco entre
 * direcciones lo cierra el próximo `url_start`, y los otros dos disparan el
 * pintado final desde quien reciba el evento, no desde este panel.
 */
export function aplicarEventoProgreso(estado, event) {
  if (event?.type === 'url_start') {
    return {
      direccion: { actual: event.urlActual, total: event.urlTotal, url: event.url },
      vias: viasEnEspera(),
    };
  }

  if (event?.type === 'method_result') {
    const indice = VIAS_VIDEO.indexOf(event.method);
    if (indice === -1) return estado;

    return {
      ...estado,
      vias: estado.vias.map((via, i) => {
        if (i === indice) return { ...via, estado: 'resuelto', encontrados: event.encontrados };
        // Solo se adelanta la SIGUIENTE vía pendiente: si ya estaba resuelta
        // (evento repetido o fuera de orden) no se retrocede su estado.
        if (i === indice + 1 && via.estado === 'pendiente') return { ...via, estado: 'curso' };
        return via;
      }),
    };
  }

  return estado;
}

/**
 * Filtra la lista de vídeos visibles: ocultados a mano, plegados bajo un
 * representante, tipo de archivo, término de búsqueda y rangos de
 * duración/peso. Pura y sin estado propio para poder probarla sin construir
 * ningún DOM.
 *
 * REGLA CENTRAL, la misma que en `resultList.js`: un vídeo sin el dato
 * (duración o peso desconocidos) NUNCA lo recorta el rango — solo lo puede
 * sacar el interruptor "Ocultar sin duración/peso" correspondiente. Filtrar
 * por un dato que no se tiene solo puede descartar vídeos buenos.
 */
export function filtrarVideos(
  videos,
  {
    ocultos,
    duplicadoDe,
    desagrupados,
    plegarDuplicados = true,
    activeType = 'all',
    needle = '',
    rangoDuracion = null,
    rangoPeso = null,
    ocultarSinDuracion = false,
    ocultarSinPeso = false,
  }
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

    const segundos = segundosDe(video);
    if (segundos === null) {
      if (ocultarSinDuracion) return false;
    } else if (rangoDuracion && (segundos < rangoDuracion.min || segundos > rangoDuracion.max)) {
      return false;
    }

    const bytes = bytesDe(video);
    if (bytes === null) {
      if (ocultarSinPeso) return false;
    } else if (rangoPeso && (bytes < rangoPeso.min || bytes > rangoPeso.max)) {
      return false;
    }

    return true;
  });
}
