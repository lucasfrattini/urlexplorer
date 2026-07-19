'use strict';

const config = require('../config');
const { getHostname } = require('./url');

/**
 * Throttling por dominio.
 *
 * La versión anterior solo pausaba entre lotes, así que cuatro peticiones
 * simultáneas podían caer todas sobre el mismo host. Esto garantiza dos cosas
 * por hostname: un número máximo de peticiones en vuelo y un intervalo mínimo
 * entre el inicio de una y la siguiente.
 */

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class HostThrottle {
  constructor({ minIntervalMs, maxConcurrentPerHost } = {}) {
    this.minIntervalMs = minIntervalMs ?? config.throttle.minIntervalMs;
    this.maxConcurrentPerHost = maxConcurrentPerHost ?? config.throttle.maxConcurrentPerHost;
    /** @type {Map<string, {active: number, lastStart: number, queue: Array<() => void>}>} */
    this.hosts = new Map();
  }

  stateFor(hostname) {
    let state = this.hosts.get(hostname);
    if (!state) {
      // `nextStart` es el instante en que puede arrancar la SIGUIENTE
      // petición. Se reserva por adelantado; ver acquire().
      state = { active: 0, nextStart: 0, queue: [] };
      this.hosts.set(hostname, state);
    }
    return state;
  }

  async acquire(hostname) {
    const state = this.stateFor(hostname);

    if (state.active >= this.maxConcurrentPerHost) {
      await new Promise(resolve => state.queue.push(resolve));
      // Hereda el hueco de quien lo liberó: NO se vuelve a incrementar.
      // Ver release().
    } else {
      state.active += 1;
    }

    /**
     * El turno se RESERVA antes de esperar, no se calcula al empezar.
     *
     * Antes cada tarea leía `lastStart`, decidía cuánto dormir y solo después
     * actualizaba la marca. Con varias peticiones concurrentes al mismo host
     * todas leían el MISMO `lastStart`, todas concluían que no había que
     * esperar y arrancaban a la vez: el intervalo mínimo no se aplicaba nunca
     * salvo en peticiones estrictamente secuenciales. Reproducido con un
     * test: tres peticiones con 60 ms de intervalo salían con 0 ms entre
     * ellas.
     *
     * Reservando el instante en `nextStart` de forma síncrona, cada tarea se
     * lleva su hueco en la cola de salida antes de dormir.
     */
    const ahora = Date.now();
    const turno = Math.max(ahora, state.nextStart);
    state.nextStart = turno + this.minIntervalMs;

    const espera = turno - ahora;
    if (espera > 0) await sleep(espera);
  }

  release(hostname) {
    const state = this.hosts.get(hostname);
    if (!state) return;

    /**
     * Si hay alguien esperando, el hueco SE TRASPASA: no se decrementa.
     *
     * Antes se decrementaba, se despertaba al que esperaba y, si en ese
     * instante la cola quedaba vacía y el contador en cero, se borraba el
     * estado del host. El despertado seguía vivo y sumaba su +1 sobre un
     * objeto ya huérfano, así que la siguiente petición creaba un estado
     * nuevo con el contador a cero y entraba sin esperar. Resultado: más
     * peticiones simultáneas de las configuradas contra el sitio de destino,
     * que es justo lo que este módulo existe para evitar, y sin ningún error
     * que lo delatara. Reproducido con maxConcurrentPerHost=1 y dos tareas
     * corriendo a la vez.
     */
    const next = state.queue.shift();
    if (next) {
      next();
      return;
    }

    state.active = Math.max(0, state.active - 1);

    // Liberar memoria de hosts inactivos
    if (state.active === 0 && state.queue.length === 0) {
      this.hosts.delete(hostname);
    }
  }

  /** Ejecuta `task` respetando los límites del host de `url`. */
  async run(url, task) {
    const hostname = getHostname(url) || 'unknown';
    await this.acquire(hostname);
    try {
      return await task();
    } finally {
      this.release(hostname);
    }
  }
}

module.exports = { HostThrottle, sleep };
