/**
 * Traducción de la interfaz. Módulo propio, sin librería.
 *
 * ── Por qué no una librería de i18n ───────────────────────────────────
 *
 * El frontend se sirve sin empaquetador para poder mantener una CSP estricta
 * sin `unsafe-inline`. Meter una librería significaría o un bundler o un
 * script de un CDN, y la CSP no permite hosts remotos. Con dos idiomas y un
 * diccionario plano, un módulo de cien líneas hace lo mismo.
 *
 * ── Cómo se refresca la interfaz sin recargar ─────────────────────────
 *
 * Las vistas se construyen por DOM, así que un cambio de idioma tiene que
 * reescribir nodos que ya existen. Hay dos mecanismos, y la diferencia
 * importa:
 *
 *   texto(nodo, clave)      para un texto FIJO: se enlaza una vez y se
 *   atributo(nodo, a, clave) reescribe solo al cambiar el idioma.
 *
 *   alCambiarIdioma(fn)     para texto CALCULADO en tiempo de ejecución
 *                           («3 de 5 páginas»): el componente registra su
 *                           propia función de repintado.
 *
 * Sin el segundo, los textos dinámicos se quedarían en el idioma anterior
 * hasta el siguiente evento, que es justo el tipo de resultado a medias que
 * no da ningún error.
 */

import { es } from './es.js';
import { en } from './en.js';

const DICCIONARIOS = { es, en };

/** Idiomas que existen de verdad. Cualquier otro cae en INGLÉS. */
export const IDIOMAS = ['es', 'en'];
export const IDIOMA_POR_DEFECTO = 'en';

const STORAGE_KEY = 'urlexplorer:lang';

/**
 * Idioma a partir de las preferencias del navegador.
 *
 * Se recorren EN ORDEN y gana el primero que sepamos hablar: con
 * ['fr', 'es'] la persona prefiere francés, que no tenemos, pero entre lo
 * que hay entiende español mejor que inglés. Si no hay ninguno conocido,
 * inglés, que es lo pedido y además el reparto más probable.
 *
 * Función pura y con el listado por parámetro para poder probarla sin
 * navegador.
 */
export function detectarIdioma(idiomasDelNavegador) {
  const lista = Array.isArray(idiomasDelNavegador)
    ? idiomasDelNavegador
    : [idiomasDelNavegador].filter(Boolean);

  for (const entrada of lista) {
    // "es-AR" -> "es"; una etiqueta vacía o rara simplemente no casa
    const base = String(entrada || '')
      .trim()
      .toLowerCase()
      .split('-')[0];
    if (IDIOMAS.includes(base)) return base;
  }

  return IDIOMA_POR_DEFECTO;
}

/** Preferencias del navegador, tolerando entornos sin `navigator`. */
function idiomasDelNavegador() {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

/**
 * Idioma inicial.
 *
 * La elección manual manda sobre la detección, pero solo dentro de la
 * sesión: va en `sessionStorage`, nunca en `localStorage` ni en una cookie,
 * igual que el token de admin y el formulario recordado. Varias personas
 * comparten este ordenador; al cerrar la pestaña se vuelve a detectar.
 */
function idiomaInicial() {
  try {
    const guardado = sessionStorage.getItem(STORAGE_KEY);
    if (guardado && IDIOMAS.includes(guardado)) return guardado;
  } catch {
    // Almacenamiento bloqueado: se detecta y ya está
  }
  return detectarIdioma(idiomasDelNavegador());
}

let idioma = idiomaInicial();

const suscriptores = new Set();

export function idiomaActual() {
  return idioma;
}

/**
 * Traduce una clave. `params` rellena los huecos `{nombre}`.
 *
 * Una clave que no existe se devuelve tal cual y se avisa por consola: es
 * preferible ver `explorer.paso1.titulo` en pantalla, que salta a la vista y
 * dice exactamente qué falta, a devolver cadena vacía y dejar un hueco mudo.
 * El test de paridad de claves existe para que esto no llegue nunca a pasar.
 */
export function t(clave, params) {
  const diccionario = DICCIONARIOS[idioma] || DICCIONARIOS[IDIOMA_POR_DEFECTO];
  let plantilla = diccionario[clave];

  if (plantilla === undefined) {
    // Respaldo al idioma por defecto antes de rendirse: más vale la frase en
    // inglés que la clave cruda delante del usuario.
    plantilla = DICCIONARIOS[IDIOMA_POR_DEFECTO][clave];
    if (plantilla === undefined) {
      console.warn(`[i18n] falta la clave "${clave}" en "${idioma}"`);
      return clave;
    }
  }

  if (!params) return plantilla;

  return plantilla.replace(/\{(\w+)\}/g, (crudo, nombre) =>
    Object.prototype.hasOwnProperty.call(params, nombre) ? String(params[nombre]) : crudo
  );
}

/**
 * Traduce eligiendo singular o plural según `n`.
 *
 * Busca `clave.uno` o `clave.varios`. El español y el inglés coinciden en
 * tener solo estas dos formas; un idioma con más (ruso, polaco) obligaría a
 * cambiar esto, y por eso está en un único sitio.
 */
export function tp(clave, n, params) {
  return t(`${clave}.${n === 1 ? 'uno' : 'varios'}`, { n, ...params });
}

/**
 * Cambia el idioma y repinta todo lo enlazado.
 *
 * No recarga la página: la exploración en curso, los resultados y lo escrito
 * en el formulario siguen donde estaban.
 */
export function cambiarIdioma(nuevo) {
  if (!IDIOMAS.includes(nuevo) || nuevo === idioma) return;
  idioma = nuevo;

  try {
    sessionStorage.setItem(STORAGE_KEY, idioma);
  } catch {
    // Sin almacenamiento el idioma no sobrevive a una recarga; no es crítico
  }

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', idioma);
  }

  for (const fn of suscriptores) fn(idioma);
}

/**
 * Registra una función de repintado. Se llama YA y en cada cambio.
 *
 * Devuelve la función para desuscribirse. En la práctica las vistas viven
 * toda la sesión y nadie se desuscribe, pero un componente que se destruya
 * y no lo haga dejaría un nodo muerto en la lista.
 */
export function alCambiarIdioma(fn) {
  suscriptores.add(fn);
  fn(idioma);
  return () => suscriptores.delete(fn);
}

/** Enlaza el texto fijo de un nodo a una clave. */
export function texto(nodo, clave, params) {
  alCambiarIdioma(() => {
    nodo.textContent = t(clave, params);
  });
  return nodo;
}

/** Enlaza un atributo fijo (placeholder, title, aria-label…) a una clave. */
export function atributo(nodo, nombre, clave, params) {
  alCambiarIdioma(() => {
    nodo.setAttribute(nombre, t(clave, params));
  });
  return nodo;
}

/**
 * Traduce el HTML estático marcado con `data-i18n`.
 *
 * Solo para `index.html`, que no se construye con `el()`. El atributo dice
 * la clave; `data-i18n-attr="title,aria-label"` traduce atributos en vez del
 * contenido.
 */
export function traducirDocumento(raiz = document) {
  alCambiarIdioma(() => {
    for (const nodo of raiz.querySelectorAll('[data-i18n]')) {
      const clave = nodo.dataset.i18n;
      const atributos = nodo.dataset.i18nAttr;

      if (atributos) {
        for (const nombre of atributos.split(',')) nodo.setAttribute(nombre.trim(), t(clave));
      } else {
        nodo.textContent = t(clave);
      }
    }
    document.documentElement.setAttribute('lang', idiomaActual());
  });
}
