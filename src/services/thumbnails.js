'use strict';

const axios = require('axios');

const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { assertUrlIsSafe } = require('../lib/ssrf');
const { buildHeaders, agentesSeguros } = require('../lib/http');

/**
 * Miniaturas servidas por el BACKEND, nunca por el navegador del usuario.
 *
 * ── POR QUÉ NO SE PONE LA URL DE TERCEROS EN EL <img> ─────────────────
 *
 * Sería una línea de código: `<img src="https://cdn-de-un-sitio/…">`. Y sería
 * un error, por dos motivos que no se arreglan después:
 *
 * 1. PRIVACIDAD. Cada miniatura sería una petición del navegador del usuario
 *    al CDN del sitio explorado, con su IP, su User-Agent y el Referer de
 *    esta aplicación. Explorar un listado de cien fichas se convertiría en
 *    cien avisos a terceros de quién está mirando qué. Toda la aplicación
 *    está construida para que el único que habla con los sitios sea el
 *    servidor.
 *
 * 2. LA CSP. `img-src` es hoy `'self' data:`. Cargar imágenes remotas
 *    obligaría a abrirla a hosts arbitrarios, que es justo la cabecera que
 *    protege contra la exfiltración si algún día se cuela una inyección.
 *
 * Sirviéndolas desde aquí, el navegador solo habla con nuestro origen, la CSP
 * no se toca y el sitio explorado solo ve al servidor, que ya le hablaba.
 *
 * ── El caché es EN MEMORIA, a propósito ───────────────────────────────
 *
 * Nada de disco: no hay que limpiar nada, no sobrevive al reinicio y no deja
 * en la máquina un rastro de qué se ha explorado. Muere con el proceso, igual
 * que el resto del estado de esta aplicación.
 */

/** Tipos que se aceptan servir. Cualquier otro se rechaza. */
const TIPOS_PERMITIDOS = /^image\/(jpeg|png|webp|gif|avif)$/i;

class CacheDeMiniaturas {
  constructor({ maxEntradas, maxBytes } = {}) {
    this.maxEntradas = maxEntradas ?? config.thumbnails.cacheMaxEntries;
    this.maxBytes = maxBytes ?? config.thumbnails.cacheMaxBytes;
    /** @type {Map<string, {buffer: Buffer, contentType: string}>} */
    this.entradas = new Map();
    this.bytes = 0;
  }

  get(url) {
    const entrada = this.entradas.get(url);
    if (!entrada) return null;
    // LRU: al usarla vuelve al final, así lo que se desaloja es lo más viejo
    this.entradas.delete(url);
    this.entradas.set(url, entrada);
    return entrada;
  }

  set(url, entrada) {
    if (this.entradas.has(url)) {
      this.bytes -= this.entradas.get(url).buffer.length;
      this.entradas.delete(url);
    }

    this.entradas.set(url, entrada);
    this.bytes += entrada.buffer.length;

    while (this.entradas.size > this.maxEntradas || this.bytes > this.maxBytes) {
      const masVieja = this.entradas.keys().next().value;
      if (masVieja === undefined) break;
      this.bytes -= this.entradas.get(masVieja).buffer.length;
      this.entradas.delete(masVieja);
    }
  }

  get tamano() {
    return this.entradas.size;
  }
}

const cache = new CacheDeMiniaturas();

/**
 * Descarga (o recupera de caché) una miniatura.
 *
 * Pasa por las mismas validaciones que cualquier otra petición saliente:
 * SSRF antes de pedir y agentes con validación de IP al conectar.
 */
async function obtenerMiniatura(url, { signal } = {}) {
  const enCache = cache.get(url);
  if (enCache) return { ...enCache, deCache: true };

  await assertUrlIsSafe(url);

  const respuesta = await axios.get(url, {
    headers: buildHeaders({ Accept: 'image/avif,image/webp,image/png,image/*;q=0.8' }),
    timeout: config.thumbnails.timeoutMs,
    maxRedirects: config.http.maxRedirects,
    maxContentLength: config.thumbnails.maxBytes,
    maxBodyLength: config.thumbnails.maxBytes,
    responseType: 'arraybuffer',
    signal,
    ...agentesSeguros(),
  });

  const contentType = String(respuesta.headers['content-type'] || '')
    .split(';')[0]
    .trim();

  // No se sirve lo que no sea una imagen: sin esto, este endpoint sería un
  // proxy genérico para cualquier contenido.
  if (!TIPOS_PERMITIDOS.test(contentType)) {
    throw new AppError(`El destino no devolvió una imagen (${contentType})`, 415, 'NOT_AN_IMAGE');
  }

  const entrada = { buffer: Buffer.from(respuesta.data), contentType };
  cache.set(url, entrada);
  logger.debug(`Miniatura cacheada (${cache.tamano} en memoria): ${url}`);

  return { ...entrada, deCache: false };
}

module.exports = { obtenerMiniatura, cache, CacheDeMiniaturas, TIPOS_PERMITIDOS };
