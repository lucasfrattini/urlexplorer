'use strict';

const test = require('node:test');
const assert = require('node:assert');

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

test('el mapa de hosts no crece sin límite', async () => {
  const throttle = new HostThrottle({ minIntervalMs: 0, maxConcurrentPerHost: 2 });

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      throttle.run(`https://sitio${i}.example/x`, async () => {})
    )
  );

  assert.strictEqual(throttle.hosts.size, 0, 'los hosts inactivos deben liberarse');
});
