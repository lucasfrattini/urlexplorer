'use strict';

// Fixtures locales y sin navegador, ANTES de cargar la config.
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { detectConfig } = require('../src/services/detector');

/**
 * Robustez de /api/scrape/detect.
 *
 * Este endpoint es de los que CLAUDE.md marca como verificados solo a mano.
 * Al probarlo contra la aplicación real devolvió un 500 con traza incluida,
 * así que estos tests fijan que degrade con elegancia en vez de reventar.
 */

async function servidorQueDevuelve(html, { tipo = 'text/html' } = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': tipo });
    res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    cerrar: () => new Promise(r => server.close(r)),
  };
}

test('una página SIN enlaces no revienta la detección', async t => {
  /**
   * REGRESIÓN. Con el navegador caído o desactivado, `htmlNavegador` es null.
   * La elección del HTML a analizar era:
   *
   *   const html = enlacesNavegador.length >= enlacesPlano.length
   *     ? htmlNavegador : htmlPlano;
   *
   * Si la página no tiene enlaces, los dos recuentos son 0, `0 >= 0` es
   * cierto y se elegía el HTML del navegador… que es null. Acto seguido
   * `cheerio.load(null)` lanzaba y el endpoint respondía 500 con la traza.
   *
   * Reproducido contra la app real: POST /api/scrape/detect ->
   * "cheerio.load() expects a string".
   */
  const { url, cerrar } = await servidorQueDevuelve(
    '<!doctype html><html><body><p>sin enlaces</p></body></html>'
  );
  t.after(() => cerrar());

  const propuesta = await detectConfig(url);

  assert.ok(propuesta.sugerencia, 'debe devolver una sugerencia, no lanzar');
  assert.strictEqual(typeof propuesta.sugerencia.searchUrl, 'string');
  assert.ok(Array.isArray(propuesta.avisos));
});

test('una página con enlaces se sigue analizando igual', async t => {
  // Control: el camino normal no cambia.
  const { url, cerrar } = await servidorQueDevuelve(
    `<!doctype html><html><body>
       <a href="/videos/1">uno</a>
       <a href="/videos/2">dos</a>
       <a href="/videos/3">tres</a>
       <a href="/videos/4">cuatro</a>
     </body></html>`
  );
  t.after(() => cerrar());

  const propuesta = await detectConfig(url);

  assert.ok(propuesta.sugerencia.linkPattern, 'debe proponer un patrón de enlace');
  assert.match(propuesta.sugerencia.linkPattern, /videos/);
});

test('un destino que no responde da un error limpio, no un 500 con traza', async () => {
  // Puerto cerrado: ni HTML plano ni navegador.
  await assert.rejects(
    () => detectConfig('http://127.0.0.1:1/'),
    error => {
      assert.strictEqual(error.code, 'DETECT_FAILED');
      // 502: el fallo es del destino, no un bug del servidor
      assert.strictEqual(error.statusCode, 502);
      return true;
    }
  );
});
