'use strict';

const test = require('node:test');
const assert = require('node:assert');

const config = require('../src/config');
const { HostThrottle } = require('../src/lib/throttle');

/**
 * Límites por dominio.
 *
 * No había test de este módulo, y sin embargo pasa por aquí CADA petición
 * saliente de la aplicación. Es lo único que impide que una exploración caiga
 * en tromba sobre el sitio de destino, que es la forma más rápida de que
 * bloqueen a la herramienta.
 */

/** Corre `n` tareas por el throttle y devuelve el pico real de simultáneas. */
async function picoDeSimultaneas(throttle, host, tareas) {
  let simultaneas = 0;
  let pico = 0;

  const lanzar = ms =>
    throttle.run(host, async () => {
      simultaneas += 1;
      pico = Math.max(pico, simultaneas);
      await new Promise(r => setTimeout(r, ms));
      simultaneas -= 1;
    });

  await Promise.all(tareas.map(lanzar));
  return pico;
}

test('no se supera el máximo de peticiones simultáneas por host', async () => {
  const throttle = new HostThrottle({ minIntervalMs: 0, maxConcurrentPerHost: 2 });
  const pico = await picoDeSimultaneas(throttle, 'https://ejemplo.com/x', [30, 30, 30, 30, 30, 30]);

  assert.ok(pico <= 2, `llegaron a correr ${pico} a la vez y el máximo es 2`);
});

test('el hueco se traspasa al que espera, sin dejar que se cuele un tercero', async () => {
  /**
   * REGRESIÓN de una carrera real, reproducida antes de arreglarla.
   *
   * `release` decrementaba el contador, despertaba al que esperaba y, si en
   * ese instante la cola quedaba vacía y el contador en cero, BORRABA el
   * estado del host. El despertado seguía vivo y sumaba su +1 sobre un objeto
   * ya huérfano, así que la siguiente petición creaba un estado nuevo con el
   * contador a cero y entraba sin esperar.
   *
   * Reproducido con maxConcurrentPerHost=1: dos tareas corriendo a la vez.
   * El sitio de destino recibía más peticiones simultáneas de las
   * configuradas, que es justo lo que este módulo existe para evitar, y sin
   * ningún error que lo delatara.
   */
  const throttle = new HostThrottle({ minIntervalMs: 0, maxConcurrentPerHost: 1 });

  let simultaneas = 0;
  let pico = 0;
  const lanzar = ms =>
    throttle.run('https://ejemplo.com/x', async () => {
      simultaneas += 1;
      pico = Math.max(pico, simultaneas);
      await new Promise(r => setTimeout(r, ms));
      simultaneas -= 1;
    });

  const a = lanzar(30); // corre
  const b = lanzar(60); // espera; al acabar `a` la cola queda vacía
  await new Promise(r => setTimeout(r, 45)); // aquí se borraba el estado
  const c = lanzar(30); // llegaba con el estado recién creado y no esperaba

  await Promise.all([a, b, c]);

  assert.strictEqual(pico, 1, `corrieron ${pico} a la vez con el máximo en 1`);
});

test('se respeta el intervalo mínimo entre peticiones al mismo host', async () => {
  const throttle = new HostThrottle({ minIntervalMs: 60, maxConcurrentPerHost: 4 });

  const inicios = [];
  await Promise.all(
    [0, 0, 0].map(() =>
      throttle.run('https://ejemplo.com/x', async () => {
        inicios.push(Date.now());
      })
    )
  );

  inicios.sort((a, b) => a - b);
  for (let i = 1; i < inicios.length; i += 1) {
    const hueco = inicios[i] - inicios[i - 1];
    // Margen de holgura: los timers de Node no son exactos
    assert.ok(hueco >= 45, `solo pasaron ${hueco} ms entre dos peticiones al mismo host`);
  }
});

test('hosts distintos no se bloquean entre sí', async () => {
  const throttle = new HostThrottle({ minIntervalMs: 0, maxConcurrentPerHost: 1 });

  let simultaneas = 0;
  let pico = 0;
  const lanzar = host =>
    throttle.run(host, async () => {
      simultaneas += 1;
      pico = Math.max(pico, simultaneas);
      await new Promise(r => setTimeout(r, 30));
      simultaneas -= 1;
    });

  await Promise.all([lanzar('https://uno.example/x'), lanzar('https://dos.example/x')]);

  assert.strictEqual(pico, 2, 'el límite es POR host: dos hosts deben poder ir a la vez');
});

/**
 * Freno reactivo al 429 (circuit breaker por host).
 *
 * El intervalo mínimo es fijo y no sabe nada de cómo está respondiendo el
 * sitio: sin esto, un host que ya devuelve 429 seguía recibiendo peticiones al
 * mismo ritmo. Los tests miden el HUECO REAL entre inicios, no que el método
 * no lance: si el freno no llegara a aplicarse (por ejemplo porque el estado
 * del host se borra al liberarlo), no habría ningún error que lo delatara.
 */

const INTERVALO = 20;
const PENALIZADO = Math.min(
  INTERVALO * config.throttle.circuitBreakerFactor,
  config.throttle.circuitBreakerMaxMs
);

/** Mide los huecos reales entre los inicios de `n` peticiones al mismo host. */
async function huecosEntrePeticiones(throttle, url, n) {
  const inicios = [];
  await Promise.all(
    Array.from({ length: n }, () =>
      throttle.run(url, async () => {
        inicios.push(Date.now());
      })
    )
  );

  inicios.sort((a, b) => a - b);
  return inicios.slice(1).map((t, i) => t - inicios[i]);
}

/**
 * Reporta `n` respuestas 429 seguidas para ese host.
 *
 * El resultado se reporta DENTRO de la tarea, igual que hace fetchHtml: es lo
 * único que garantiza que el estado del host siga vivo cuando se anota.
 */
async function reportarBloqueos(throttle, url, n) {
  for (let i = 0; i < n; i += 1) {
    await throttle.run(url, async () => {
      throttle.reportOutcome(url, { blocked: true });
    });
  }
}

test('una racha de 429 que llega al umbral separa las peticiones a ese host', async () => {
  const throttle = new HostThrottle({ minIntervalMs: INTERVALO, maxConcurrentPerHost: 4 });
  const url = 'https://ejemplo.com/x';

  await reportarBloqueos(throttle, url, config.throttle.circuitBreakerThreshold);

  const huecos = await huecosEntrePeticiones(throttle, url, 3);
  for (const hueco of huecos) {
    // Margen de holgura: los timers de Node no son exactos
    assert.ok(
      hueco >= PENALIZADO * 0.8,
      `con el host penalizado solo pasaron ${hueco} ms entre peticiones (se esperaban ~${PENALIZADO})`
    );
  }
});

test('la penalización de un host no afecta a los demás', async () => {
  const throttle = new HostThrottle({ minIntervalMs: INTERVALO, maxConcurrentPerHost: 4 });

  await reportarBloqueos(
    throttle,
    'https://uno.example/x',
    config.throttle.circuitBreakerThreshold
  );

  const huecos = await huecosEntrePeticiones(throttle, 'https://dos.example/x', 3);
  for (const hueco of huecos) {
    assert.ok(
      hueco < PENALIZADO * 0.8,
      `un host sano esperó ${hueco} ms: se está frenando por culpa de otro host`
    );
  }
});

test('una racha por debajo del umbral no penaliza nada', async () => {
  const throttle = new HostThrottle({ minIntervalMs: INTERVALO, maxConcurrentPerHost: 4 });
  const url = 'https://ejemplo.com/x';

  await reportarBloqueos(throttle, url, config.throttle.circuitBreakerThreshold - 1);

  const huecos = await huecosEntrePeticiones(throttle, url, 3);
  for (const hueco of huecos) {
    assert.ok(hueco < PENALIZADO * 0.8, `se penalizó con ${hueco} ms sin llegar al umbral`);
  }
});

test('una respuesta buena corta la racha, pero NO levanta una penalización activa', async () => {
  const url = 'https://ejemplo.com/x';
  const umbral = config.throttle.circuitBreakerThreshold;

  // 1. Cortar la racha antes del umbral evita la penalización...
  const sinPenalizar = new HostThrottle({ minIntervalMs: INTERVALO, maxConcurrentPerHost: 4 });
  await reportarBloqueos(sinPenalizar, url, umbral - 1);
  await sinPenalizar.run(url, async () => {
    sinPenalizar.reportOutcome(url, { blocked: false });
  });
  await reportarBloqueos(sinPenalizar, url, umbral - 1);

  for (const hueco of await huecosEntrePeticiones(sinPenalizar, url, 3)) {
    assert.ok(hueco < PENALIZADO * 0.8, `la racha no se reinició: se penalizó con ${hueco} ms`);
  }

  /**
   * 2. ...pero una vez penalizado, la primera respuesta buena NO lo levanta.
   * El bloqueo por volumen dura minutos: que una petición se cuele no
   * significa que haya terminado, y volver al ritmo anterior lo reactivaría.
   */
  const penalizado = new HostThrottle({ minIntervalMs: INTERVALO, maxConcurrentPerHost: 4 });
  await reportarBloqueos(penalizado, url, umbral);
  await penalizado.run(url, async () => {
    penalizado.reportOutcome(url, { blocked: false });
  });

  for (const hueco of await huecosEntrePeticiones(penalizado, url, 3)) {
    assert.ok(
      hueco >= PENALIZADO * 0.8,
      `una sola respuesta buena canceló la penalización: ${hueco} ms entre peticiones`
    );
  }
});

test('el mapa de hosts no crece sin límite', async () => {
  const throttle = new HostThrottle({ minIntervalMs: 0, maxConcurrentPerHost: 2 });

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      throttle.run(`https://sitio${i}.example/x`, async () => {})
    )
  );

  assert.strictEqual(throttle.hosts.size, 0, 'los hosts inactivos deben liberarse');
});
