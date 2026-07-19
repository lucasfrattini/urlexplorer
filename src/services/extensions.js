'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('../lib/logger');

/**
 * Cargador de extensiones por sitio.
 *
 * ── LA REGLA DE SEGURIDAD, QUE ES LO PRIMERO ──────────────────────────
 *
 * Una extensión es CÓDIGO, así que cargarla es ejecutarlo. Todo el diseño de
 * este módulo existe para que no haya ningún camino entre un dato no confiable
 * y un `require`:
 *
 *   - El directorio es FIJO y se resuelve desde __dirname. No es
 *     configurable por entorno: una variable de entorno la controla quien
 *     despliega, pero convertirla en superficie de ataque no aporta nada a
 *     cambio de un riesgo real.
 *   - Se ENUMERA el directorio; nunca se construye un nombre de fichero a
 *     partir de una petición. Aunque alguien enviara "../../etc/passwd" como
 *     nombre de sitio, no hay ningún punto donde eso llegue a un require.
 *   - Se valida el nombre contra una lista blanca de caracteres, así que un
 *     fichero con un nombre raro se ignora en vez de intentar cargarse.
 *   - Se carga UNA vez al arrancar. No hay recarga en caliente, que sería la
 *     forma natural de que un fichero escrito después acabara ejecutándose.
 *
 * Añadir una extensión es añadir código revisado al repositorio, con su
 * commit. No hay carga desde el frontend, ni desde la API, ni desde `data/`.
 * Ver `src/extensions/README.md`.
 */

/** Directorio fijo. NO configurable, a propósito. */
const EXTENSIONS_DIR = path.join(__dirname, '..', 'extensions');

/** Nombres de fichero aceptables: nada de rutas, ni puntos, ni raros. */
const NOMBRE_VALIDO = /^[a-z0-9][a-z0-9-]{0,48}\.js$/;

/** @type {Array<object>} */
let cargadas = [];
let yaCargado = false;

/** Comprueba que un módulo cumple el contrato mínimo. */
function esValida(modulo, fichero) {
  if (!modulo || typeof modulo !== 'object') {
    logger.warn(`Extensión ${fichero} ignorada: no exporta un objeto`);
    return false;
  }

  if (typeof modulo.name !== 'string' || modulo.name.trim() === '') {
    logger.warn(`Extensión ${fichero} ignorada: le falta "name"`);
    return false;
  }

  if (typeof modulo.match !== 'function') {
    logger.warn(`Extensión ${modulo.name} ignorada: le falta "match"`);
    return false;
  }

  // Una extensión que no hace nada solo añade una comprobación por URL
  if (typeof modulo.listar !== 'function' && typeof modulo.extraerFicheros !== 'function') {
    logger.warn(`Extensión ${modulo.name} ignorada: no implementa listar ni extraerFicheros`);
    return false;
  }

  return true;
}

/** Carga las extensiones del directorio fijo. Idempotente. */
function loadExtensions({ force = false } = {}) {
  if (yaCargado && !force) return cargadas;

  cargadas = [];
  yaCargado = true;

  let ficheros;
  try {
    ficheros = fs.readdirSync(EXTENSIONS_DIR);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('No se pudo leer el directorio de extensiones', error.message);
    }
    return cargadas;
  }

  for (const fichero of ficheros.sort()) {
    if (!NOMBRE_VALIDO.test(fichero)) continue;

    try {
      // El nombre viene de leer el directorio y ya ha pasado NOMBRE_VALIDO:
      // no hay forma de que un dato de una petición llegue hasta aquí.
      const modulo = require(path.join(EXTENSIONS_DIR, fichero));
      if (!esValida(modulo, fichero)) continue;
      cargadas.push(modulo);
      logger.info(`Extensión cargada: ${modulo.name}`);
    } catch (error) {
      // Una extensión rota no puede tumbar la aplicación: el motor genérico
      // sigue funcionando sin ella.
      logger.error(`Extensión ${fichero} falló al cargarse`, error.message);
    }
  }

  return cargadas;
}

/**
 * Devuelve la extensión que aplica a una URL, o null.
 *
 * Si `match` revienta, la extensión se descarta para esa URL en vez de
 * romper la exploración entera.
 */
function findExtension(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  for (const extension of loadExtensions()) {
    try {
      if (extension.match(url)) return extension;
    } catch (error) {
      logger.warn(`El match de la extensión ${extension.name} falló`, error.message);
    }
  }

  return null;
}

/**
 * Inventario de lo cargado, para los tests y para el log de arranque.
 *
 * NO se expone por la API: el nombre de una extensión es el del sitio al que
 * sirve, y publicarlo en /api/health delataría exactamente lo que se sacó del
 * repositorio al mover los perfiles a `data/`.
 */
function listExtensions() {
  return loadExtensions().map(e => ({
    name: e.name,
    description: e.description || '',
    capacidades: [
      typeof e.listar === 'function' ? 'listar' : null,
      typeof e.extraerFicheros === 'function' ? 'extraerFicheros' : null,
    ].filter(Boolean),
  }));
}

module.exports = {
  loadExtensions,
  findExtension,
  listExtensions,
  EXTENSIONS_DIR,
  NOMBRE_VALIDO,
};
