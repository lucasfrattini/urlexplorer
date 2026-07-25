'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
// Los tres valores de abajo son los que miden los tests: el backoff del 429
// tiene que distinguirse claramente del lineal genérico sin tardar minutos.
process.env.HTTP_RETRY_BASE_DELAY_MS = '20';
process.env.HTTP_RETRY_429_BASE_DELAY_MS = '400';
process.env.HTTP_RETRY_429_MAX_DELAY_MS = '1200';

const config = require('../src/config');
const { fetchHtmlWithRetry } = require('../src/lib/http');

/**
 * Reintentos ante un rate-limit del sitio de destino.
 *
 * Un sitio que empieza a devolver 429 por volumen tarda MINUTOS en levantar el
 * bloqueo (medido: unos dos). El backoff lineal genérico (1s/2s/3s) reintenta
 * dentro de esa ventana y lo único que consigue es sumar peticiones al
 * contador que provocó el bloqueo, sin que nada lo delate: los reintentos
 * fallan igual y el fallo se atribuye al sitio.
 *
 * Estos tests miden el TIEMPO REAL transcurrido contra un servidor local que
 * responde 429; comprobar que "no lanza" no distinguiría un backoff del otro.
 */

/**
 * Servidor que devuelve 429 en las primeras `veces` peticiones de cada ruta y
 * 200 a partir de ahí. `cabeceras` permite añadir el Retry-After.
 */
function crearSitioQueBloquea() {
  const vistas = new Map();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const veces = Number(url.searchParams.get('bloqueos') || '0');
    const retryAfter = url.searchParams.get('retryAfter');
    const estadoFallo = Number(url.searchParams.get('estado') || '429');

    const previas = vistas.get(req.url) || 0;
    vistas.set(req.url, previas + 1);

    if (previas < veces) {
      const cabeceras = retryAfter ? { 'Retry-After': retryAfter } : {};
      res.writeHead(estadoFallo, cabeceras);
      return res.end();
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>ok</body></html>');
  });

  return { server, vistas };
}

test('el 429 tiene su propio backoff', async t => {
  const { server, vistas } = crearSitioQueBloquea();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(r => server.close(r)));

  await t.test('espera bastante más que el backoff lineal genérico', async () => {
    const inicio = Date.now();
    const html = await fetchHtmlWithRetry(`${base}/a?bloqueos=2`);
    const transcurrido = Date.now() - inicio;

    assert.match(html, /ok/, 'la tercera petición devuelve 200 y ese es el HTML que vuelve');
    assert.equal(vistas.get('/a?bloqueos=2'), 3);

    const esperado = config.http.retry429BaseDelayMs * 2;
    assert.ok(
      transcurrido >= esperado * 0.8,
      `dos reintentos tras un 429 tardaron ${transcurrido} ms; con el backoff propio serían ~${esperado}`
    );
  });

  await t.test('si el sitio manda Retry-After en segundos, manda esa cabecera', async () => {
    const inicio = Date.now();
    await fetchHtmlWithRetry(`${base}/b?bloqueos=1&retryAfter=1`);
    const transcurrido = Date.now() - inicio;

    // 1 s pedido por el sitio, frente a los 400 ms del backoff propio
    assert.ok(
      transcurrido >= 900,
      `solo esperó ${transcurrido} ms: se ignoró el Retry-After del sitio`
    );
  });

  await t.test('Retry-After también se entiende como fecha HTTP', async () => {
    const fecha = new Date(Date.now() + 2000).toUTCString();
    const inicio = Date.now();
    await fetchHtmlWithRetry(`${base}/c?bloqueos=1&retryAfter=${encodeURIComponent(fecha)}`);
    const transcurrido = Date.now() - inicio;

    /**
     * La fecha pide ~2 s y el tope de este test son 1200 ms, así que se espera
     * el tope. Lo que se descarta es que la fecha no se entienda: en ese caso
     * caería al backoff propio (400 ms) sin dar ningún error.
     */
    assert.ok(
      transcurrido >= 800,
      `esperó ${transcurrido} ms: la fecha HTTP no se interpretó como Retry-After`
    );
  });

  await t.test('un Retry-After absurdo se recorta al tope', { timeout: 10000 }, async () => {
    const inicio = Date.now();
    await fetchHtmlWithRetry(`${base}/d?bloqueos=1&retryAfter=3600`);
    const transcurrido = Date.now() - inicio;

    assert.ok(
      transcurrido <= config.http.retry429MaxDelayMs + 800,
      `esperó ${transcurrido} ms: una hora pedida por el sitio colgaría el crawl entero`
    );
    // Y sigue siendo el tope, no el backoff base: el sitio pidió más
    assert.ok(
      transcurrido >= config.http.retry429MaxDelayMs * 0.8,
      `esperó ${transcurrido} ms: no se aplicó el tope sino el backoff base`
    );
  });

  await t.test('lo que NO es un 429 conserva el backoff lineal de siempre', async () => {
    const inicio = Date.now();
    await fetchHtmlWithRetry(`${base}/e?bloqueos=2&estado=500`);
    const transcurrido = Date.now() - inicio;

    // 20 + 40 ms, muy por debajo de los 400 del 429
    assert.ok(
      transcurrido < config.http.retry429BaseDelayMs,
      `un 500 esperó ${transcurrido} ms: se le está aplicando el backoff del rate-limit`
    );
  });
});
