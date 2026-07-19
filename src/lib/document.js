'use strict';

const cheerio = require('cheerio');

/**
 * Un solo parseo de HTML por página.
 *
 * En la fase 2, de CADA página de detalle se sacan cuatro cosas: los ficheros
 * que contiene, su licencia, su duración y su tamaño. Cada extractor hacía su
 * propio `cheerio.load()` del MISMO documento, así que una ficha se parseaba
 * hasta cuatro veces enteras para leer cuatro datos. Multiplicado por cientos
 * o miles de fichas, es trabajo puro tirado.
 *
 * ── Por qué `asDocument` y no cambiar todas las firmas ────────────────
 *
 * Los extractores siguen aceptando una cadena de HTML, porque así los llaman
 * los tests, las extensiones por sitio y el resto del código. Lo que se añade
 * es que TAMBIÉN aceptan un documento ya parseado: quien tenga varios datos
 * que sacar del mismo HTML lo carga una vez y se lo pasa a todos.
 *
 * El precio es esta comprobación de pato. Es contenida y está en un único
 * sitio: `cheerio.load()` devuelve una función con `.root()`, y nada más de
 * lo que se pasa por aquí tiene esa forma.
 */

/** Carga HTML. Si ya viene parseado, lo devuelve tal cual. */
function asDocument(htmlOrDoc) {
  if (esDocumento(htmlOrDoc)) return htmlOrDoc;
  return cheerio.load(typeof htmlOrDoc === 'string' ? htmlOrDoc : '');
}

/** ¿Es esto un documento de cheerio ya cargado? */
function esDocumento(valor) {
  return typeof valor === 'function' && typeof valor.root === 'function';
}

module.exports = { asDocument, esDocumento };
