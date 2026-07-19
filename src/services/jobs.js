'use strict';

const crypto = require('node:crypto');

const config = require('../config');
const logger = require('../lib/logger');

/**
 * Exploraciones frenadas a medias, para poder continuarlas.
 *
 * ── En memoria, y a propósito ─────────────────────────────────────────
 *
 * Nada de disco. Un trabajo frenado guarda los enlaces que faltan y lo
 * encontrado hasta ahí, y eso lleva nombres de sitios: persistirlo obligaría
 * a limpiar, a decidir cuánto se conserva y a tratarlo como los perfiles.
 * Viviendo en memoria muere con el proceso, igual que el resto del estado de
 * esta aplicación.
 *
 * LIMITACIÓN ASUMIDA: si el proceso se reinicia entre frenar y continuar, lo
 * pendiente se pierde. Es el precio de no persistir, y está elegido.
 *
 * ── Por qué hace falta estado, si todo lo demás no lo tiene ───────────
 *
 * Continuar exige recordar qué enlaces faltaban. La alternativa —mandarlos
 * de vuelta en la petición— no vale: son miles de URLs y el stream es un GET,
 * así que no caben en la query. Se guarda lo mínimo y con caducidad.
 */

class RegistroDeTrabajos {
  constructor({ ttlMs, maxTrabajos } = {}) {
    this.ttlMs = ttlMs ?? config.jobs.ttlMs;
    this.maxTrabajos = maxTrabajos ?? config.jobs.maxJobs;
    /** @type {Map<string, object>} */
    this.trabajos = new Map();

    // Limpieza periódica: un trabajo que nadie continúa no debe quedarse
    this.limpieza = setInterval(() => this.purgar(), this.ttlMs);
    this.limpieza.unref?.();
  }

  /** Crea un trabajo y devuelve su id. */
  crear(datos = {}) {
    this.purgar();

    // Si se llena, se tira el más viejo: un trabajo abandonado no vale más
    // que uno recién empezado.
    while (this.trabajos.size >= this.maxTrabajos) {
      const masViejo = this.trabajos.keys().next().value;
      if (masViejo === undefined) break;
      this.trabajos.delete(masViejo);
    }

    const id = crypto.randomUUID();
    this.trabajos.set(id, {
      id,
      creadoEn: Date.now(),
      tocadoEn: Date.now(),
      // Bandera que mira el crawl para dejar de coger trabajo nuevo
      pausado: false,
      pendientes: [],
      detalles: [],
      links: [],
      params: null,
      ...datos,
    });
    return id;
  }

  obtener(id) {
    const trabajo = this.trabajos.get(id);
    if (!trabajo) return null;
    if (Date.now() - trabajo.tocadoEn > this.ttlMs) {
      this.trabajos.delete(id);
      return null;
    }
    trabajo.tocadoEn = Date.now();
    return trabajo;
  }

  /** Marca un trabajo para que se frene. Devuelve si existía. */
  pausar(id) {
    const trabajo = this.obtener(id);
    if (!trabajo) return false;
    trabajo.pausado = true;
    logger.info(`Trabajo ${id} marcado para frenar`);
    return true;
  }

  actualizar(id, datos) {
    const trabajo = this.obtener(id);
    if (!trabajo) return null;
    Object.assign(trabajo, datos, { tocadoEn: Date.now() });
    return trabajo;
  }

  borrar(id) {
    return this.trabajos.delete(id);
  }

  purgar() {
    const ahora = Date.now();
    for (const [id, trabajo] of this.trabajos) {
      if (ahora - trabajo.tocadoEn > this.ttlMs) this.trabajos.delete(id);
    }
  }

  get tamano() {
    return this.trabajos.size;
  }
}

const registro = new RegistroDeTrabajos();

module.exports = { registro, RegistroDeTrabajos };
