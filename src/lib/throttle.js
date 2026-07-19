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
      state = { active: 0, lastStart: 0, queue: [] };
      this.hosts.set(hostname, state);
    }
    return state;
  }

  async acquire(hostname) {
    const state = this.stateFor(hostname);

    if (state.active >= this.maxConcurrentPerHost) {
      await new Promise(resolve => state.queue.push(resolve));
    }

    const elapsed = Date.now() - state.lastStart;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }

    state.active += 1;
    state.lastStart = Date.now();
  }

  release(hostname) {
    const state = this.hosts.get(hostname);
    if (!state) return;
    state.active = Math.max(0, state.active - 1);
    const next = state.queue.shift();
    if (next) next();
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
