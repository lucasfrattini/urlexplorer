'use strict';

/**
 * Agrupación de resultados duplicados DENTRO de una misma exploración.
 *
 * Caso de uso: una búsqueda devuelve 50 vídeos y dos de ellos son el mismo,
 * servido desde dos URLs distintas (dos CDN, dos calidades del mismo fichero,
 * la misma ficha enlazada dos veces). Entregar los dos obliga a filtrar a
 * mano.
 *
 * ── Lo que este módulo NO hace ────────────────────────────────────────
 *
 * No compara entre sitios ni entre exploraciones distintas. Eso exigiría
 * huellas del contenido real (descargarlo) y guardar estado entre búsquedas.
 * Aquí solo se comparan resultados de la misma exploración, donde las
 * senales disponibles ya se han recogido de paso.
 *
 * ── Por qué agrupar y nunca descartar ─────────────────────────────────
 *
 * Un falso positivo es MUCHO peor que un duplicado. Dos vídeos distintos que
 * duran lo mismo son un caso común, no una rareza: capítulos de una serie,
 * clips cortados a medida fija, dos tomas del mismo evento. Si se descartara
 * en silencio, el usuario perdería un resultado legítimo sin enterarse nunca
 * y sin forma de recuperarlo.
 *
 * Por eso el resultado es una AGRUPACIÓN: se devuelven todos los elementos,
 * marcados con el grupo al que pertenecen, y la interfaz muestra un
 * representante por grupo con la opción de desplegarlo. Nada desaparece.
 *
 * ── Por qué hacen falta DOS senales coincidentes ─────────────────────
 *
 * Ninguna señal aislada basta:
 *   - Solo duración: agrupa capítulos distintos de igual duración.
 *   - Solo tamaño: dos ficheros de 245 MB pueden no tener nada que ver, y
 *     además el tamaño puede venir aproximado del HTML.
 *   - Solo nombre: "video.mp4" es un nombre habitual en sitios distintos.
 *
 * Dos senales coincidiendo a la vez ya es mucha casualidad. Se exige eso
 * como mínimo, salvo que el nombre normalizado sea largo y específico, que
 * por sí solo ya identifica.
 */

/** Longitud a partir de la cual un nombre de fichero identifica por sí solo. */
const NOMBRE_ESPECIFICO_MIN = 12;

/** Tolerancia del tamaño: el aproximado del HTML viene redondeado. */
const TOLERANCIA_TAMANO = 0.02;

/**
 * A partir de cuántas repeticiones una miniatura deja de identificar.
 *
 * Compartir miniatura es una señal FUERTE: dos vídeos distintos casi nunca
 * declaran la misma imagen de vista previa. La excepción son los
 * marcadores de posición —el logo del sitio, un "sin vista previa"— que
 * aparecen en muchísimas fichas y no dicen nada.
 *
 * Se distinguen por lo que son: si la misma imagen sale en más de la mitad
 * de los resultados que traen miniatura, no es la portada de un vídeo, es el
 * relleno del sitio. Se pide además un mínimo de repeticiones para no
 * descartar la señal en listas diminutas, donde "la mitad" son dos.
 */
const MINIATURA_FRACCION_RELLENO = 0.5;
const MINIATURA_MIN_PARA_RELLENO = 5;

/**
 * Normaliza el nombre de fichero de una URL.
 *
 * Se quitan la extensión, los sufijos de calidad y resolución, los
 * identificadores de CDN y los separadores, porque el mismo vídeo se sirve
 * como "gatos-monos_720p.mp4" y "gatos_monos-1080p.mp4".
 */
function normalizeName(url) {
  if (typeof url !== 'string' || url === '') return '';

  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }

  const base = path.split('/').filter(Boolean).pop() || '';

  return (
    base
      .toLowerCase()
      // extensión
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      // Resolución y calidad: _720p, -1080p, .hd, _4k
      //
      // El separador es OBLIGATORIO, no opcional, y no vale \b para
      // delimitar por la izquierda: en "monos_720p" el guion bajo es un
      // carácter de palabra, así que entre "_" y "7" no hay frontera y la
      // expresión no llegaba a casar nunca.
      .replace(/[._-](?:\d{3,4}p|\d{3,4}x\d{3,4}|hd|sd|fhd|uhd|4k|hq|lq)(?![a-z0-9])/g, '')
      // Tasa de bits y sufijos de CDN: _1500k, -v2, _enc
      .replace(/[._-](?:\d+k|v\d+|enc|out|dl|stream)(?![a-z0-9])/g, '')
      // hashes largos que cambian entre CDN
      .replace(/[._-]?[a-f0-9]{16,}/g, '')
      // cualquier separador
      .replace(/[^a-z0-9]/g, '')
  );
}

/** ¿Dos tamaños son el mismo, admitiendo el redondeo del aproximado? */
function sameSize(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  const mayor = Math.max(a, b);
  return Math.abs(a - b) / mayor <= TOLERANCIA_TAMANO;
}

/**
 * Senales que comparten dos elementos.
 *
 * `nombreA`/`nombreB` se pueden pasar ya calculados. No es un capricho de
 * micro-optimización: esta función se llama dentro de un doble bucle, y
 * `normalizeName` parsea la URL y aplica cinco reemplazos, así que sin
 * precalcular se recomputaba el nombre del MISMO elemento una vez por cada
 * elemento de la lista. Ver `groupDuplicates`.
 */
function senalesComunes(a, b, nombreAPrecalculado, nombreBPrecalculado, miniaturasDeRelleno) {
  const senales = [];

  /**
   * Misma miniatura declarada.
   *
   * Es la señal más fuerte de las cuatro, porque la miniatura la elige el
   * sitio para representar ESE vídeo: dos vídeos distintos casi nunca
   * declaran la misma. Por eso agrupa ella sola, igual que un nombre largo.
   *
   * Salvo que sea un marcador de posición, claro: ahí no identifica nada y
   * agruparía media lista. Ver MINIATURA_FRACCION_RELLENO.
   */
  if (a.thumbnail && b.thumbnail && a.thumbnail === b.thumbnail) {
    if (!miniaturasDeRelleno?.has(a.thumbnail)) {
      senales.push({ tipo: 'miniatura', valor: a.thumbnail, especifica: true });
    }
  }

  const nombreA = nombreAPrecalculado ?? normalizeName(a.url);
  const nombreB = nombreBPrecalculado ?? normalizeName(b.url);
  if (nombreA !== '' && nombreA === nombreB) {
    senales.push({
      tipo: 'nombre',
      valor: nombreA,
      especifica: nombreA.length >= NOMBRE_ESPECIFICO_MIN,
    });
  }

  // La duración se compara EXACTA: viene en segundos enteros de la ficha, y
  // aflojarla haría que capítulos consecutivos empezaran a agruparse.
  if (a.durationSeconds && b.durationSeconds && a.durationSeconds === b.durationSeconds) {
    senales.push({ tipo: 'duracion', valor: a.durationSeconds });
  }

  if (sameSize(a.sizeBytes, b.sizeBytes)) {
    senales.push({ tipo: 'tamano', valor: a.sizeBytes });
  }

  return senales;
}

/**
 * ¿Bastan estas senales para agrupar?
 *
 * Por defecto hacen falta DOS senales, o un nombre normalizado largo y
 * especifico que ya identifica por si solo.
 *
 * ── Por que la duracion sola NO basta por defecto ─────────────────────
 *
 * La duracion no es un identificador. Dos videos genuinamente distintos
 * pueden durar exactamente lo mismo, y con listas grandes eso no es raro:
 * es lo normal. Medido sobre duraciones repartidas entre 1 y 30 minutos:
 *
 *   n=  100  ->    3 colisiones entre videos DISTINTOS  ( 3% de la lista)
 *   n= 1000  ->  225 colisiones                         (23% de la lista)
 *   n= 2000  ->  807 colisiones                         (40% de la lista)
 *
 * Agrupar solo por duracion en una lista de mil resultados escondería uno de
 * cada cuatro videos buenos detras de otro que no tiene nada que ver. Por eso
 * `soloDuracion` existe pero es una eleccion explicita del usuario, avisada,
 * y nunca el comportamiento por defecto.
 */
function bastan(senales, { soloDuracion = false } = {}) {
  if (senales.length >= 2) return true;
  if (senales.length !== 1) return false;

  // Un nombre normalizado largo, o una miniatura que no sea relleno, ya
  // identifican por sí solos.
  if (senales[0].especifica === true) {
    if (senales[0].tipo === 'nombre' || senales[0].tipo === 'miniatura') return true;
  }

  // Modo agresivo: la duracion sola agrupa. Solo si se pide expresamente.
  return soloDuracion && senales[0].tipo === 'duracion';
}

/** Texto legible del motivo de la agrupación, para enseñárselo al usuario. */
function describir(senales) {
  const nombres = {
    nombre: 'mismo nombre de fichero',
    duracion: 'misma duración',
    tamano: 'mismo tamaño',
    miniatura: 'misma miniatura',
  };
  return senales.map(s => nombres[s.tipo]).join(' y ');
}

/** Miniaturas demasiado repetidas para servir de identificador. */
function detectarMiniaturasDeRelleno(items) {
  const cuenta = new Map();
  let conMiniatura = 0;

  for (const item of items) {
    if (!item?.thumbnail) continue;
    conMiniatura += 1;
    cuenta.set(item.thumbnail, (cuenta.get(item.thumbnail) || 0) + 1);
  }

  const relleno = new Set();
  for (const [miniatura, veces] of cuenta) {
    if (veces >= MINIATURA_MIN_PARA_RELLENO && veces > conMiniatura * MINIATURA_FRACCION_RELLENO) {
      relleno.add(miniatura);
    }
  }
  return relleno;
}

/**
 * Agrupa los elementos equivalentes.
 *
 * Devuelve SIEMPRE todos los elementos: los grupos son una capa encima, no
 * un filtro. `items` son los detalles de fichero tal como los produce la
 * fase 2: { url, duration, durationSeconds, sizeBytes, sourceUrl }.
 *
 * @returns {{grupos: Array, totalDuplicados: number}}
 */
function groupDuplicates(items, opciones = {}) {
  const { soloDuracion = false } = opciones;

  if (!Array.isArray(items) || items.length === 0) {
    return { grupos: [], totalDuplicados: 0 };
  }

  const grupos = [];
  // índice del grupo al que ya se asignó cada elemento
  const asignado = new Map();

  /**
   * Nombres normalizados, UNA vez cada uno.
   *
   * Antes se calculaban dentro del bucle interno, así que el nombre del
   * elemento `i` se recomputaba n veces —parseo de URL y cinco regex— para
   * dar siempre el mismo resultado. Con los topes de la aplicación (miles de
   * ficheros) eso son millones de reemplazos regex y segundos de CPU
   * bloqueando el proceso justo al final de una exploración.
   *
   * La comparación sigue siendo la misma y sigue siendo O(n²): lo que cambia
   * es lo que cuesta cada comparación. No se agrupa por clave porque la
   * tolerancia de tamaño no es una relación de equivalencia, y bucketizar
   * cambiaría qué elementos acaban juntos.
   */
  const nombres = items.map(item => normalizeName(item.url));

  /**
   * Miniaturas que se repiten tanto que ya no identifican a nadie.
   *
   * El logo del sitio o un "sin vista previa" aparecen en casi todas las
   * fichas. Sin este filtro, la señal de miniatura agruparía media lista en
   * un solo grupo, que es exactamente el falso positivo que este módulo
   * existe para evitar.
   */
  const miniaturasDeRelleno = detectarMiniaturasDeRelleno(items);

  for (let i = 0; i < items.length; i += 1) {
    if (asignado.has(i)) continue;

    const grupo = {
      representante: items[i],
      miembros: [items[i]],
      motivos: [],
    };
    asignado.set(i, grupos.length);

    for (let j = i + 1; j < items.length; j += 1) {
      if (asignado.has(j)) continue;

      // Se compara contra el REPRESENTANTE, no contra cualquier miembro del
      // grupo. Encadenar (A~B, B~C ⇒ A,B,C juntos) arrastra elementos que no
      // se parecen entre sí, y es como una agrupación por duración acaba
      // tragándose media lista.
      const senales = senalesComunes(
        items[i],
        items[j],
        nombres[i],
        nombres[j],
        miniaturasDeRelleno
      );
      if (!bastan(senales, { soloDuracion })) continue;

      grupo.miembros.push(items[j]);
      grupo.motivos.push({
        url: items[j].url,
        senales: senales.map(s => s.tipo),
        texto: describir(senales),
      });
      asignado.set(j, grupos.length);
    }

    grupos.push(grupo);
  }

  const totalDuplicados = grupos.reduce((suma, g) => suma + (g.miembros.length - 1), 0);

  return { grupos, totalDuplicados };
}

module.exports = {
  groupDuplicates,
  normalizeName,
  sameSize,
  senalesComunes,
  bastan,
  detectarMiniaturasDeRelleno,
  NOMBRE_ESPECIFICO_MIN,
  TOLERANCIA_TAMANO,
};
