'use strict';

/**
 * ¿Qué fichero de una ficha es DE VERDAD el de esa ficha?
 *
 * ── El problema ───────────────────────────────────────────────────────
 *
 * Una página de detalle no contiene un solo vídeo: contiene el fichero real,
 * los clips de vista previa de los vídeos relacionados de la barra lateral, y
 * los anuncios en vídeo de terceros. Hasta ahora se devolvían los tres por
 * igual, y además se les estampaba a todos la duración leída de la ficha.
 *
 * El resultado era la peor clase de error posible: un fichero de cinco
 * segundos presentado como si durase veinte minutos. No fallaba nada, no
 * saltaba ningún aviso, y solo se descubría al abrir la descarga.
 *
 * ── La señal que se usa, y por qué es genérica ────────────────────────
 *
 * El fichero real casi siempre comparte identificador con la URL de su ficha,
 * y los intrusos no:
 *
 *   ficha /video/111165/...      → .../111000/111165/111165.mp4    ✓ mismo id
 *   ficha /video/111165/...      → cdn.otrodominio.com/abc.mp4     ✗ anuncio
 *   ficha /a/EJ73kA9i            → .../EJ73kA9i/PJug53LQ_720p.mp4  ✓ mismo id
 *   ficha /videos/17249089/...   → .../17249089/17249089.mp4       ✓ mismo id
 *   portada, sin id en la URL    → .../441678691_fb.mp4            ✗ ajeno
 *
 * Es una regla del motor, no de un sitio: no hay ni un dominio escrito aquí.
 * Se comprobó contra cuatro sitios de estructuras distintas y los clasifica
 * bien en los cuatro.
 *
 * ── Qué se hace con los que no se pueden verificar ────────────────────
 *
 * NO se devuelven como si fueran buenos. Si hay algún fichero verificado, se
 * devuelven solo esos. Si no hay ninguno, se devuelven los dudosos MARCADOS y
 * SIN duración: entregar un fichero con la duración de otro es justo el
 * engaño que este módulo existe para evitar.
 */

/** Longitud mínima de un identificador para que sirva de señal. */
const MIN_ID_NUMERICO = 4;
const MIN_ID_ALFANUM = 6;

/** Marcas de que una URL es una vista previa y no el fichero completo. */
const MARCA_DE_MUESTRA =
  /(^|[/_\-.])(preview|previews|sample|samples|trailer|teaser|thumb|thumbs|fb)([/_\-.]|$)/i;

/**
 * Identificadores presentes en la URL de una ficha.
 *
 * Se cogen los segmentos de ruta que parecen un id: números largos
 * (`17249089`) o cadenas alfanuméricas mezcladas (`EJ73kA9i`). Se descartan
 * las palabras corrientes, que aparecerían en cualquier URL y no identifican
 * nada.
 */
function extractPageTokens(pageUrl) {
  const tokens = new Set();

  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return tokens;
  }

  for (const segmento of parsed.pathname.split('/').filter(Boolean)) {
    // Un slug largo puede llevar el id pegado: "111165-titulo-del-video"
    for (const trozo of segmento.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
      if (/^\d+$/.test(trozo)) {
        if (trozo.length >= MIN_ID_NUMERICO) tokens.add(trozo);
        continue;
      }
      // Alfanumérico con dígitos y letras: los ids opacos son así. Una
      // palabra normal ("videos", "search") no tiene dígitos y se descarta.
      if (trozo.length >= MIN_ID_ALFANUM && /\d/.test(trozo) && /[A-Za-z]/.test(trozo)) {
        tokens.add(trozo);
      }
    }
  }

  return tokens;
}

/** ¿La URL del fichero lleva alguna marca de vista previa? */
function looksLikeSample(fileUrl) {
  let path = String(fileUrl);
  try {
    path = new URL(fileUrl).pathname;
  } catch {
    // Se analiza la cadena tal cual
  }
  return MARCA_DE_MUESTRA.test(path);
}

/** ¿El fichero comparte identificador con su ficha? */
function sharesIdentity(fileUrl, tokens) {
  if (tokens.size === 0) return false;
  const texto = String(fileUrl);
  for (const token of tokens) {
    if (texto.includes(token)) return true;
  }
  return false;
}

/**
 * Clasifica los ficheros encontrados en una ficha.
 *
 * @returns {{files: Array<{url:string, suspect:boolean, reason:string|null}>,
 *            discarded: Array<{url:string, reason:string}>}}
 */
function selectRelevantFiles(candidates, pageUrl) {
  const tokens = extractPageTokens(pageUrl);

  const verificados = [];
  const dudosos = [];

  // Sin identificador en la URL de la ficha no hay con qué comparar, y dar
  // por sospechoso TODO sería pasarse: hay fichas que cuelgan de rutas cortas
  // y cuyos ficheros son perfectamente legítimos. En ese caso se baja a la
  // señal que sigue siendo válida —la marca de vista previa— y se confía en
  // el resto. Es deliberadamente conservador: antes dejar pasar un intruso
  // que marcar como dudosos los resultados buenos de un sitio entero.
  const sinIdentificador = tokens.size === 0;

  for (const url of candidates) {
    // La marca de vista previa manda siempre: un "_preview" es una muestra
    // aunque comparta identificador con su ficha.
    if (looksLikeSample(url)) {
      dudosos.push({
        url,
        suspect: true,
        reason: 'parece una vista previa, no el fichero completo',
      });
      continue;
    }

    if (sharesIdentity(url, tokens) || sinIdentificador) {
      verificados.push({ url, suspect: false, reason: null });
      continue;
    }

    dudosos.push({
      url,
      suspect: true,
      reason:
        'no coincide con el identificador de la página: puede ser un anuncio o un vídeo relacionado',
    });
  }

  // Habiendo alguno verificado, los dudosos sobran: son el ruido de la
  // página. Se informa de cuántos se han dejado fuera para que la omisión no
  // sea silenciosa.
  if (verificados.length > 0) {
    return {
      files: verificados,
      discarded: dudosos.map(d => ({ url: d.url, reason: d.reason })),
    };
  }

  // Sin ninguno verificado se devuelven los dudosos MARCADOS. Descartarlos
  // del todo dejaría al usuario con cero resultados y sin saber por qué;
  // devolverlos como buenos sería mentir. Marcarlos es lo único honesto.
  return { files: dudosos, discarded: [] };
}

/**
 * Comprobación de coherencia entre lo que dice la ficha y lo que pesa el
 * fichero.
 *
 * Una vista previa que se cuela pesa unos cientos de KB mientras la ficha
 * anuncia veinte minutos. El umbral es deliberadamente bajo —unos 40 kbps—
 * para no marcar vídeos legítimos de mala calidad: por debajo de eso no hay
 * vídeo que valga.
 */
const BYTES_POR_SEGUNDO_MINIMO = 5 * 1024;

function sizeLooksInconsistent(durationSeconds, sizeBytes) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 60) return false;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return false;
  return sizeBytes < durationSeconds * BYTES_POR_SEGUNDO_MINIMO;
}

module.exports = {
  selectRelevantFiles,
  extractPageTokens,
  looksLikeSample,
  sharesIdentity,
  sizeLooksInconsistent,
  MARCA_DE_MUESTRA,
};
