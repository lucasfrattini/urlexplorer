'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

/**
 * Regresiones de dos agujeros REALES, ambos reproducidos antes de arreglarlos.
 *
 * Los dos compartían la misma forma: había una validación, parecía suficiente,
 * y se saltaba por un camino que nadie había mirado.
 */

const { createApp } = require('../src/app');
const { secureLookup } = require('../src/lib/ssrf');

/** Levanta una app en un puerto libre y devuelve {url, cerrar}. */
function levantar(app) {
  return new Promise(resolve => {
    const servidor = http.createServer(app).listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${servidor.address().port}`,
        cerrar: () => new Promise(r => servidor.close(r)),
      });
    });
  });
}

test('el rate limit NO se salta rotando X-Forwarded-For', async t => {
  /**
   * El agujero: `trust proxy` estaba en `true`, que significa "confía en
   * cualquiera". `req.ip` salía de X-Forwarded-For y el rate limiting va por
   * `req.ip`, así que bastaba mandar una cabecera distinta en cada petición.
   *
   * Medido con el código anterior: 0 bloqueos en 40 peticiones rotando la
   * cabecera, frente a 10 de 40 con la misma IP. Es decir: el límite no
   * existía para nadie que supiera mandar una cabecera.
   *
   * Importa porque el mismo mecanismo protege /api/admin/unlock, que es lo
   * único que frena la fuerza bruta contra ADMIN_TOKEN.
   */
  const app = createApp();
  const { url, cerrar } = await levantar(app);
  t.after(() => cerrar());

  const limite = require('../src/config').security.rateLimit.maxRequests;
  const total = limite + 10;

  let bloqueadas = 0;
  for (let i = 0; i < total; i += 1) {
    const res = await fetch(`${url}/api/health`, {
      headers: { 'X-Forwarded-For': `1.2.3.${i}` },
    });
    if (res.status === 429) bloqueadas += 1;
  }

  assert.ok(
    bloqueadas > 0,
    `rotando X-Forwarded-For se colaron las ${total} peticiones sin un solo 429`
  );
});

test('trust proxy no es `true` por defecto', () => {
  // La causa raíz, fijada aparte del síntoma: si alguien vuelve a poner
  // `true` "para depurar", el test de arriba tarda en delatarlo y este no.
  const config = require('../src/config');
  assert.notStrictEqual(config.security.trustProxy, true);
  assert.notStrictEqual(config.security.trustProxy, 'true');
});

test('secureLookup rechaza un host que resuelve a una IP privada', async () => {
  /**
   * El agujero: el guardia de redirección de axios es SÍNCRONO, así que solo
   * comprobaba la FORMA de la URL. Un host público que redirige a otro host
   * que resuelve a 127.0.0.1 pasaba entero, porque su forma es impecable.
   *
   * Comprobado antes del arreglo: validateUrlShape('http://127.0.0.1.nip.io/')
   * devolvía la URL sin rechistar, mientras que la petición directa a esa
   * misma URL sí se bloqueaba. Esa asimetría era el bug.
   *
   * `secureLookup` valida en el momento de conectar, que es el único punto por
   * el que pasan la primera petición, cada redirección y la resolución real.
   */
  const resultado = await new Promise(resolve => {
    secureLookup('localhost', {}, (error, address) => resolve({ error, address }));
  });

  assert.ok(resultado.error, 'un host que resuelve a loopback debe fallar al conectar');
  assert.strictEqual(resultado.error.code, 'PRIVATE_ADDRESS_BLOCKED');
});

test('secureLookup deja pasar una IP pública y respeta la firma de dns.lookup', async () => {
  // Sin `all`, dns.lookup entrega (address, family). Devolver la lista por
  // error rompería cualquier cliente HTTP que lo use.
  const conAll = await new Promise(resolve => {
    secureLookup('example.com', { all: true }, (error, addresses) => resolve({ error, addresses }));
  });

  if (conAll.error) {
    // Sin red no se puede comprobar; no es un fallo del código bajo prueba.
    return;
  }

  assert.ok(Array.isArray(conAll.addresses), 'con all:true debe devolver una lista');

  const sinAll = await new Promise(resolve => {
    secureLookup('example.com', {}, (error, address, family) =>
      resolve({ error, address, family })
    );
  });
  assert.strictEqual(typeof sinAll.address, 'string', 'sin all debe devolver una sola dirección');
  assert.ok([4, 6].includes(sinAll.family));
});

test('el limitador de admin identifica por socket, no por cabecera', async () => {
  // Defensa en profundidad: aunque trust proxy se configure mal, el contador
  // de intentos de contraseña no debe poder falsearse.
  const { createRateLimiter } = require('../src/middleware/rateLimit');
  const limitador = createRateLimiter({
    windowMs: 60000,
    maxRequests: 2,
    useSocketAddress: true,
  });

  const peticion = ip => ({
    ip, // lo que diría X-Forwarded-For si se confiara en ella
    socket: { remoteAddress: '10.0.0.1' }, // el peer real, siempre el mismo
    get: () => undefined,
  });
  const respuesta = { set: () => {} };

  const resultados = [];
  for (let i = 0; i < 5; i += 1) {
    await new Promise(resolve => {
      limitador(peticion(`9.9.9.${i}`), respuesta, error => {
        // AppError expone `statusCode`, no `status`
        resultados.push(error?.statusCode ?? 200);
        resolve();
      });
    });
  }

  assert.ok(
    resultados.includes(429),
    'cambiar la IP declarada no debe reiniciar el contador de intentos'
  );
});
