'use strict';

const cheerio = require('cheerio');

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { renderPage } = require('../lib/browser');
const { tryFetchHtml } = require('../lib/http');
const { assertUrlIsSafe } = require('../lib/ssrf');
const { toAbsoluteUrl } = require('../lib/url');

/**
 * Autodetección de la configuración de un sitio.
 *
 * Automatiza lo que hasta ahora se hacía a mano por cada sitio nuevo: abrir
 * devtools, pulsar "página 2", copiar la URL que pide de verdad y deducir qué
 * ruta comparten los enlaces de resultado. Era el mayor coste de entrada de
 * la herramienta.
 *
 * TODO LO QUE DEVUELVE ES UNA SUGERENCIA, y así hay que presentarlo. Acierta
 * la mayoría de las veces, no siempre. Si la interfaz lo diera por bueno sin
 * decirlo, cada fallo se leería como una avería de la herramienta en vez de
 * como lo que es: una propuesta que hay que revisar. Por eso cada campo viaja
 * con el motivo por el que se ha propuesto.
 */

/** Rutas que nunca son resultados de búsqueda, por mucho que se repitan. */
const RUTAS_DE_SERVICIO =
  /^\/(?:login|signin|signup|register|account|profile|user|users|members?|tag|tags|category|categories|search|about|contact|terms|privacy|help|faq|rss|feed|sitemap)(?:\/|$)/i;

/** Extensiones que interesan como resultado. */
const EXTENSIONES_CONOCIDAS = [
  '.mp4',
  '.webm',
  '.mkv',
  '.avi',
  '.mov',
  '.m4v',
  '.mp3',
  '.m4a',
  '.wav',
  '.flac',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.zip',
];

/** Enlaces internos del documento, con su href original y su forma absoluta. */
function extraerEnlaces(html, baseUrl) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const enlaces = [];

  $('a[href]').each((_, element) => {
    const rawHref = $(element).attr('href');
    const absolute = toAbsoluteUrl(rawHref, baseUrl);
    if (!absolute) return;

    let parsed;
    try {
      parsed = new URL(absolute);
    } catch {
      return;
    }

    // Solo el mismo host: los enlaces salientes son publicidad o redes
    // sociales, y meterlos falsearía el patrón más repetido.
    if (parsed.host !== base.host) return;

    enlaces.push({ rawHref, absolute, parsed, texto: $(element).text().trim() });
  });

  return enlaces;
}

/**
 * Detecta el mecanismo de paginación.
 *
 * Por orden de fiabilidad: rel="next" (declarado por el sitio), un parámetro
 * numérico de la query que cambia entre enlaces, y una ruta con número.
 */
function detectarPaginacion(html, baseUrl, enlaces) {
  const $ = cheerio.load(html);

  // 1. rel="next": es el propio sitio diciendo cuál es la siguiente página
  const relNext = $('a[rel~="next"]').attr('href') || $('link[rel~="next"]').attr('href') || null;
  if (relNext) {
    const absolute = toAbsoluteUrl(relNext, baseUrl);
    if (absolute) {
      const param = parametroQueCambia(baseUrl, absolute);
      if (param) {
        return {
          modo: 'parametro',
          pageParam: param,
          motivo: `El sitio declara rel="next" y la diferencia está en el parámetro "${param}".`,
          confianza: 'alta',
        };
      }

      const plantilla = plantillaDeRuta(absolute);
      if (plantilla) {
        return {
          modo: 'plantilla',
          searchUrl: plantilla,
          motivo: 'El sitio declara rel="next" y el número de página va en la ruta.',
          confianza: 'alta',
        };
      }
    }
  }

  // 2. Un parámetro numérico que aparece en los enlaces de paginación.
  //    Se buscan los enlaces cuyo texto es un número: son la botonera.
  const numerados = enlaces.filter(e => /^\d{1,3}$/.test(e.texto));
  const conteo = new Map();

  for (const enlace of numerados) {
    for (const [nombre, valor] of enlace.parsed.searchParams) {
      if (!/^\d+$/.test(valor)) continue;
      conteo.set(nombre, (conteo.get(nombre) || 0) + 1);
    }
  }

  const mejor = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0];
  if (mejor && mejor[1] >= 2) {
    return {
      modo: 'parametro',
      pageParam: mejor[0],
      motivo: `Los enlaces con texto numérico (la botonera de páginas) cambian el parámetro "${mejor[0]}".`,
      confianza: 'media',
    };
  }

  // 3. Número dentro de la ruta: /page/2, /p/2
  const conRuta = numerados.find(e => /\/(?:page|pagina|p)\/\d+/i.test(e.parsed.pathname));
  if (conRuta) {
    const plantilla = plantillaDeRuta(conRuta.absolute);
    if (plantilla) {
      return {
        modo: 'plantilla',
        searchUrl: plantilla,
        motivo: 'La botonera de páginas lleva el número dentro de la ruta.',
        confianza: 'media',
      };
    }
  }

  return {
    modo: 'ninguno',
    motivo:
      'No se ha encontrado botonera de páginas. Puede que el sitio cargue más resultados al hacer scroll: prueba el modo "scroll".',
    confianza: 'baja',
  };
}

/** Nombre del parámetro que cambia entre dos URLs, si es solo uno y es numérico. */
function parametroQueCambia(unaUrl, otraUrl) {
  let a;
  let b;
  try {
    a = new URL(unaUrl);
    b = new URL(otraUrl);
  } catch {
    return null;
  }

  if (a.host !== b.host || a.pathname !== b.pathname) return null;

  const distintos = [];
  const nombres = new Set([...a.searchParams.keys(), ...b.searchParams.keys()]);

  for (const nombre of nombres) {
    if (a.searchParams.get(nombre) !== b.searchParams.get(nombre)) distintos.push(nombre);
  }

  if (distintos.length !== 1) return null;
  const valor = b.searchParams.get(distintos[0]);
  return valor !== null && /^\d+$/.test(valor) ? distintos[0] : null;
}

/** Convierte ".../page/2" en ".../page/{page}". */
function plantillaDeRuta(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const conPlantilla = parsed.pathname.replace(/\/(\d+)(?=\/|$)/, '/{page}');
  if (conPlantilla === parsed.pathname) return null;

  parsed.pathname = conPlantilla;
  return decodeURIComponent(parsed.toString());
}

/**
 * Sugiere el patrón de enlaces.
 *
 * La señal que mejor funciona es el primer segmento de ruta más repetido
 * entre los enlaces que terminan en algo parecido a un identificador. Una
 * ficha de contenido casi siempre vive en /algo/<id>.
 */
function detectarPatron(enlaces) {
  const conteo = new Map();

  for (const enlace of enlaces) {
    const segmentos = enlace.parsed.pathname.split('/').filter(Boolean);
    if (segmentos.length < 2) continue;
    if (RUTAS_DE_SERVICIO.test(enlace.parsed.pathname)) continue;

    const prefijo = `/${segmentos[0]}/`;
    const ultimo = segmentos[segmentos.length - 1];
    // Un identificador: numérico, o un slug largo con guiones
    const pareceFicha = /^\d+$/.test(ultimo) || /^[\w-]{8,}$/.test(ultimo);
    if (!pareceFicha) continue;

    const actual = conteo.get(prefijo) || { total: 0, numericos: 0 };
    actual.total += 1;
    if (/\/\d+(?:\/|$)/.test(enlace.parsed.pathname)) actual.numericos += 1;
    conteo.set(prefijo, actual);
  }

  const ordenados = [...conteo.entries()].sort((a, b) => b[1].total - a[1].total);
  if (ordenados.length === 0) {
    return {
      linkPattern: '',
      motivo:
        'No se ha encontrado una ruta que se repita entre los enlaces. Déjalo vacío para recoger todos y afina después mirando los resultados.',
      confianza: 'baja',
    };
  }

  const [prefijo, datos] = ordenados[0];

  // Si casi todas las fichas de esa ruta acaban en número, una expresión
  // regular deja fuera las páginas de sección que comparten prefijo.
  if (datos.numericos >= 3 && datos.numericos / datos.total > 0.7) {
    const escapado = prefijo.replace(/\//g, '\\/');
    return {
      linkPattern: `/${escapado}\\d+/`,
      motivo: `${datos.total} enlaces cuelgan de "${prefijo}" y ${datos.numericos} acaban en un número. La expresión regular deja fuera las páginas de sección que comparten esa ruta.`,
      confianza: 'media',
      alternativa: prefijo,
    };
  }

  return {
    linkPattern: prefijo,
    motivo: `Es la ruta más repetida entre los enlaces que parecen fichas (${datos.total} enlaces).`,
    confianza: datos.total >= 5 ? 'media' : 'baja',
  };
}

/** Extensiones de fichero que ya aparecen en el HTML. */
function detectarExtensiones(html) {
  const encontradas = new Set();
  const minusculas = html.toLowerCase();

  for (const extension of EXTENSIONES_CONOCIDAS) {
    // Se exige que la extensión vaya seguida de un delimitador: sin esto,
    // "/app.ts.backup" contaría como ".ts".
    if (new RegExp(`\\${extension}(?:["'?#/\\s]|$)`).test(minusculas)) {
      encontradas.add(extension);
    }
  }

  return [...encontradas];
}

/**
 * Analiza una URL y propone una configuración.
 *
 * Descarga la página dos veces, sin navegador y con él, porque comparar las
 * dos es la única forma fiable de saber si el navegador hace falta. Es el
 * coste de la detección: una carga con navegador.
 */
async function detectConfig(searchUrl, { signal } = {}) {
  await assertUrlIsSafe(searchUrl);

  const avisos = [];

  // 1. Sin navegador: rápido, y es lo que se prefiere si basta
  let htmlPlano = null;
  try {
    htmlPlano = await tryFetchHtml(searchUrl, { signal });
  } catch (error) {
    logger.warn(`Detección: fallo al descargar sin navegador ${searchUrl}`, error.message);
  }

  const enlacesPlano = htmlPlano ? extraerEnlaces(htmlPlano, searchUrl) : [];

  // 2. Con navegador
  let htmlNavegador = null;
  if (config.browser.enabled) {
    try {
      htmlNavegador = await renderPage(searchUrl);
    } catch (error) {
      logger.warn(`Detección: fallo al renderizar ${searchUrl}`, error.message);
      avisos.push(
        'No se pudo abrir la página con navegador, así que la propuesta sale solo del HTML plano.'
      );
    }
  } else {
    avisos.push('El navegador está desactivado, así que no se ha podido comprobar si hace falta.');
  }

  const enlacesNavegador = htmlNavegador ? extraerEnlaces(htmlNavegador, searchUrl) : [];

  if (!htmlPlano && !htmlNavegador) {
    throw new AppError(
      'No se pudo descargar la página ni con navegador ni sin él. Comprueba la URL.',
      502,
      'DETECT_FAILED'
    );
  }

  // 3. ¿Hace falta navegador? La señal es que renderizando aparezcan
  //    bastantes más enlaces que sin renderizar.
  let useJavaScript = false;
  let motivoNavegador = 'El HTML plano ya trae los enlaces, así que no hace falta navegador.';

  if (enlacesNavegador.length > 0 && enlacesPlano.length === 0) {
    useJavaScript = true;
    motivoNavegador = 'Sin navegador la página no devuelve ningún enlace.';
  } else if (enlacesNavegador.length > enlacesPlano.length * 1.5 && enlacesNavegador.length > 5) {
    useJavaScript = true;
    motivoNavegador = `Con navegador aparecen ${enlacesNavegador.length} enlaces frente a ${enlacesPlano.length} sin él: el contenido se carga con JavaScript.`;
  }

  // Se analiza el HTML más completo de los dos
  const html = enlacesNavegador.length >= enlacesPlano.length ? htmlNavegador : htmlPlano;
  const enlaces = enlacesNavegador.length >= enlacesPlano.length ? enlacesNavegador : enlacesPlano;

  // ADVERTENCIA IMPORTANTE: esto mide la fase 1. Que los enlaces se vean sin
  // navegador no dice nada sobre si la fase 2 lo necesitará, que es un fallo
  // que ya se cometió una vez: los listados salían en el HTML pero las fichas
  // montaban el reproductor con JavaScript y no aparecía ni un fichero.
  if (!useJavaScript) {
    avisos.push(
      'La comprobación del navegador mira solo el listado. Si luego salen enlaces pero ningún fichero, activa "Renderizar con navegador": las fichas pueden necesitarlo aunque el listado no.'
    );
  }

  const paginacion = detectarPaginacion(html, searchUrl, enlaces);
  const patron = detectarPatron(enlaces);
  const extensiones = detectarExtensiones(html);

  return {
    // Los campos que rellenan el formulario
    sugerencia: {
      searchUrl: paginacion.searchUrl || searchUrl,
      pageParam: paginacion.pageParam || '',
      paginationMode: paginacion.modo === 'ninguno' ? 'parametro' : paginacion.modo,
      linkPattern: patron.linkPattern,
      fileExtensions: extensiones.join(', '),
      useJavaScript,
    },
    // El porqué de cada uno, para que se pueda juzgar la propuesta
    motivos: {
      paginacion: paginacion.motivo,
      patron: patron.motivo,
      navegador: motivoNavegador,
      extensiones:
        extensiones.length > 0
          ? `Encontradas en la página: ${extensiones.join(', ')}. Quita las que no busques.`
          : 'No se ha visto ninguna extensión conocida en el listado. Es normal: los ficheros suelen estar dentro de cada ficha.',
    },
    confianza: {
      paginacion: paginacion.confianza,
      patron: patron.confianza,
    },
    alternativas: patron.alternativa ? { linkPattern: patron.alternativa } : {},
    avisos,
    analizado: {
      enlacesSinNavegador: enlacesPlano.length,
      enlacesConNavegador: enlacesNavegador.length,
    },
  };
}

module.exports = {
  detectConfig,
  detectarPaginacion,
  detectarPatron,
  detectarExtensiones,
  parametroQueCambia,
  plantillaDeRuta,
  extraerEnlaces,
};
