'use strict';

const config = require('../config');
const { AppError } = require('../lib/errors');

/**
 * Compilación de patrones de enlace.
 *
 * Hay dos formas de escribir un patrón:
 *
 *   - Literal (lo de siempre): "/videos/" busca esa cadena en el href
 *     original; "https://…" compara desde el principio de la URL absoluta;
 *     cualquier otra cosa se busca dentro de la URL absoluta.
 *   - Expresión regular: "/^\/videos\/\d+/" — entre barras, con banderas
 *     opcionales al final. Permite decir "/videos/ seguido de un número",
 *     que con `includes()` era imposible.
 *
 * ── Por qué NO basta con "empieza y acaba por barra" ──────────────────
 *
 * Los patrones literales más habituales YA empiezan y acaban por barra:
 * "/videos/", "/video/", "/a/". Tomarlos por expresiones regulares
 * cambiaría su significado sin avisar: "/videos/" como regex es "videos"
 * en cualquier posición, que además casa con "/miembros/videos-de-x". Las
 * configuraciones guardadas seguirían funcionando, devolverían resultados,
 * y serían los equivocados. Justo el tipo de fallo silencioso que más
 * cuesta ver.
 *
 * Por eso se exige, además de las barras, al menos un metacarácter. Un
 * patrón sin metacaracteres no gana nada siendo regex, así que la regla no
 * quita expresividad y mantiene compatible todo lo ya guardado.
 */

/** Tope de longitud del patrón: acota el coste de compilarlo y ejecutarlo. */
const MAX_PATTERN_LENGTH = 200;

/**
 * Presupuesto de tiempo total del patrón durante una exploración.
 *
 * Una expresión regular en JavaScript es SÍNCRONA y no se puede interrumpir
 * a mitad: no existe un timeout real por evaluación. Lo que sí se puede es
 * acotar el daño, y eso se hace en tres frentes:
 *
 *   1. Longitud máxima del patrón (arriba).
 *   2. Rechazo de las formas que provocan backtracking catastrófico (abajo).
 *   3. Longitud máxima de la entrada, porque el coste explota con ella.
 *   4. Este presupuesto acumulado: si el conjunto de evaluaciones se pasa
 *      de tiempo, se corta con un error en vez de dejar el proceso colgado
 *      sobre miles de enlaces.
 */
const TIME_BUDGET_MS = 2000;

/** Barras delimitadoras con banderas opcionales al final. */
const DELIMITED = /^\/(.+)\/([gimsuy]*)$/s;

/** Caracteres que solo tienen sentido en una expresión regular. */
const METACHARACTERS = /[\\^$.*+?()[\]{}|]/;

/**
 * Formas que producen backtracking catastrófico.
 *
 * El patrón clásico es un cuantificador aplicado a un grupo que ya contiene
 * otro cuantificador: (a+)+, (a*)*, (\d+)*, (a|aa)+. Con una entrada que
 * casi casa, el motor prueba un número exponencial de combinaciones y el
 * proceso se queda clavado. Se rechazan antes de compilar.
 *
 * OJO: este filtro mira paréntesis, así que NO ve las repeticiones de clases
 * de caracteres sin agrupar, que son igual de malas:
 *
 *     [a-z]+[a-z]+[a-z]+[a-z]+[a-z]+!$
 *
 * son 30 ms por enlace, o dos minutos y medio de proceso bloqueado sobre
 * 5000 enlaces, y compila sin problema. Detectarlo estáticamente en el caso
 * general es indecidible, y una heurística más agresiva empezaría a rechazar
 * patrones legítimos. Por eso el análisis estático NO es la defensa
 * principal: lo es el presupuesto de tiempo, que recoge lo que esto no ve.
 */
const NESTED_QUANTIFIER = /\([^)]*[+*{][^)]*\)\s*[+*{]/;

/** Alternancia dentro de un grupo cuantificado: (a|aa)+ */
const QUANTIFIED_ALTERNATION = /\([^)]*\|[^)]*\)\s*[+*]/;

/** ¿El patrón viene escrito como expresión regular? */
function looksLikeRegex(pattern) {
  const match = DELIMITED.exec(pattern);
  if (!match) return false;
  // Sin metacaracteres es un literal que casualmente lleva barras
  return METACHARACTERS.test(match[1]);
}

/**
 * Compila la expresión regular, rechazando lo que puede colgarse.
 * Devuelve el RegExp ya construido: se compila UNA vez por exploración, no
 * una vez por enlace.
 */
function compileRegex(pattern) {
  const match = DELIMITED.exec(pattern);
  const [, body, flags] = match;

  if (NESTED_QUANTIFIER.test(body) || QUANTIFIED_ALTERNATION.test(body)) {
    throw new AppError(
      'El patrón tiene un cuantificador anidado (por ejemplo "(a+)+"), que puede bloquear el ' +
        'servidor durante minutos sobre miles de enlaces. Reescríbelo sin repetir dentro de un ' +
        'grupo ya repetido.',
      400,
      'UNSAFE_PATTERN'
    );
  }

  // La bandera 'g' mantiene lastIndex entre llamadas, así que el mismo
  // patrón daría resultados distintos según el enlace anterior. Se descarta.
  const safeFlags = flags.replace(/g/g, '');

  try {
    return new RegExp(body, safeFlags);
  } catch (error) {
    throw new AppError(
      `El patrón no es una expresión regular válida: ${error.message}`,
      400,
      'INVALID_PATTERN'
    );
  }
}

/**
 * Construye el comprobador de enlaces para un patrón.
 *
 * Se llama una vez por exploración. El objeto devuelto expone `test`, que se
 * aplica a cada enlace.
 */
function createLinkMatcher(pattern) {
  const clean = typeof pattern === 'string' ? pattern.trim() : '';

  // Sin patrón valen todos los enlaces
  if (clean === '') {
    return { kind: 'all', source: '', test: () => true };
  }

  if (clean.length > MAX_PATTERN_LENGTH) {
    throw new AppError(
      `El patrón es demasiado largo (${clean.length} caracteres, máximo ${MAX_PATTERN_LENGTH}).`,
      400,
      'PATTERN_TOO_LONG'
    );
  }

  if (looksLikeRegex(clean)) {
    const regex = compileRegex(clean);
    const maxInput = config.security.maxUrlLength;
    let spentMs = 0;

    return {
      kind: 'regex',
      source: clean,
      test(rawHref, absolute) {
        if (spentMs > TIME_BUDGET_MS) {
          throw new AppError(
            'El patrón está tardando demasiado en evaluarse y se ha detenido la búsqueda. ' +
              'Suele indicar una expresión regular con mucho backtracking: simplifícala.',
            400,
            'PATTERN_TIMEOUT'
          );
        }

        // La entrada se recorta: el coste de una regex crece con ella, así
        // que acotarla acota el peor caso de cada evaluación.
        const target = String(absolute).slice(0, maxInput);

        const started = process.hrtime.bigint();
        const result = regex.test(target);
        spentMs += Number(process.hrtime.bigint() - started) / 1e6;

        return result;
      },
    };
  }

  // ── Literales, tal como funcionaban ──────────────────────────────────
  if (clean.startsWith('/')) {
    // Se compara con el href ORIGINAL: una ruta relativa como "/videos/12"
    // no aparece tal cual en la URL absoluta si el sitio va por subdominio.
    return { kind: 'path', source: clean, test: rawHref => String(rawHref).includes(clean) };
  }

  if (/^https?:\/\//i.test(clean)) {
    return { kind: 'prefix', source: clean, test: (_raw, absolute) => absolute.startsWith(clean) };
  }

  return { kind: 'substring', source: clean, test: (_raw, absolute) => absolute.includes(clean) };
}

/**
 * Escapa un texto para meterlo LITERAL dentro de una expresión regular.
 *
 * Vive aquí porque es la contrapartida de `createLinkMatcher`: uno compila
 * patrones que el usuario escribe a propósito, y este convierte texto que NO
 * es un patrón en algo que solo se representa a sí mismo.
 *
 * El detector escapaba solo las barras, y eso deja pasar dos fallos:
 *   - Silencioso: un prefijo "/media[hd]/" se convierte en una clase de
 *     caracteres y el patrón sugerido casa "/mediah/12", que no era eso.
 *     Comprobado.
 *   - Ruidoso: "/media[hd/" produce una regex inválida, así que la propia
 *     herramienta sugiere un patrón que su propio validador rechaza con
 *     INVALID_PATTERN.
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  createLinkMatcher,
  looksLikeRegex,
  escapeRegExp,
  MAX_PATTERN_LENGTH,
  TIME_BUDGET_MS,
};
