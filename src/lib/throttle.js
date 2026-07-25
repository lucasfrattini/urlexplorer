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
    /**
     * @type {Map<string, {active: number, nextStart: number, queue: Array<() => void>,
     *   consecutiveBlocked: number, penaltyUntil: number}>}
     */
    this.hosts = new Map();
  }

  stateFor(hostname) {
    let state = this.hosts.get(hostname);
    if (!state) {
      // `nextStart` es el instante en que puede arrancar la SIGUIENTE
      // petición. Se reserva por adelantado; ver acquire().
      // `consecutiveBlocked` y `penaltyUntil` son el freno reactivo: ver
      // reportOutcome().
      state = { active: 0, nextStart: 0, queue: [], consecutiveBlocked: 0, penaltyUntil: 0 };
      this.hosts.set(hostname, state);
    }
    return state;
  }

  /**
   * Intervalo mínimo VIGENTE para este host.
   *
   * Fuera de la ventana de penalización es exactamente el de siempre; dentro,
   * se separa a las peticiones para dejar de golpear a un sitio que ya está
   * respondiendo 429.
   */
  intervalFor(state) {
    if (Date.now() >= state.penaltyUntil) return this.minIntervalMs;
    return Math.min(
      this.minIntervalMs * config.throttle.circuitBreakerFactor,
      config.throttle.circuitBreakerMaxMs
    );
  }

  /**
   * Resultado de una petición, para frenar al host que nos está bloqueando.
   *
   * Solo el 429 cuenta como `blocked`: es el sitio diciendo explícitamente
   * "demasiadas peticiones". Un timeout o un 500 no significan eso y meterlos
   * aquí penalizaría por ruido.
   *
   * Un resultado bueno corta la racha pero NO levanta una penalización ya
   * activa: el bloqueo por volumen dura minutos, y la primera respuesta buena
   * que se cuele no significa que haya terminado. Levantarla ahí volvería al
   * ritmo que provocó el bloqueo.
   */
  reportOutcome(url, { blocked = false } = {}) {
    const hostname = getHostname(url) || 'unknown';

    // Un host sano del que no queda estado no necesita que se le cree uno:
    // sería dejarlo en el mapa fuera del ciclo acquire/release.
    if (!blocked && !this.hosts.has(hostname)) return;

    const state = this.stateFor(hostname);

    if (!blocked) {
      state.consecutiveBlocked = 0;
      return;
    }

    state.consecutiveBlocked += 1;
    if (state.consecutiveBlocked >= config.throttle.circuitBreakerThreshold) {
      state.penaltyUntil = Date.now() + config.throttle.circuitBreakerCooldownMs;
      // Se reinicia la racha para no reescalar en cadena: mientras dure la
      // penalización los 429 que sigan llegando vuelven a contar desde cero.
      state.consecutiveBlocked = 0;
    }
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
    state.nextStart = turno + this.intervalFor(state);

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

    /**
     * Liberar memoria de hosts inactivos, PERO no si el host está penalizado
     * o lleva una racha de 429 a medias.
     *
     * Borrarlo sin más haría que la penalización no existiera en la práctica:
     * `reportOutcome` se llama dentro de la tarea y el release inmediato
     * posterior tiraría el estado, así que la petición siguiente crearía uno
     * limpio y volvería al ritmo normal. Sin ningún error: el freno
     * simplemente no frenaría nada.
     *
     * El estado que se conserva está acotado a los hosts que están
     * respondiendo mal ahora mismo, y se recoge en cuanto expira.
     */
    const penalizado = Date.now() < state.penaltyUntil;
    const enRacha = state.consecutiveBlocked > 0;
    if (state.active === 0 && state.queue.length === 0 && !penalizado && !enRacha) {
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
