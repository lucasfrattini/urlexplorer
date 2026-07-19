'use strict';

// Fixtures locales: la protección SSRF se apaga igual que en los demás tests
// de integración, ANTES de cargar nada que lea la config.
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { extractVideos } = require('../src/services/video');

/**
 * Fija el comportamiento de la obtención de metadatos de vídeo ANTES de
 * tocarla.
 *
 * Es una de las zonas que el propio CLAUDE.md señala como verificada solo a
 * mano. El bucle de HEADs se va a paralelizar, así que primero hay que dejar
 * escrito qué tiene que seguir cumpliéndose: que cada vídeo reciba SU peso y
 * no el de otro, que un fallo de peso no borre el vídeo, y que las
 * plataformas incrustadas no generen peticiones.
 */

/** Servidor que responde HEAD con un content-length distinto por ruta. */
async function servidorDePesos() {
  const pedidos = [];

  const server = http.createServer((req, res) => {
    pedidos.push({ metodo: req.method, ruta: req.url });

    if (req.url === '/sin-peso.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      return res.end();
    }
    if (req.url === '/roto.mp4') {
      res.writeHead(403);
      return res.end();
    }

    // El peso se deduce de la ruta: /v/7.mp4 pesa 7000 bytes. Así se puede
    // comprobar que a cada vídeo le toca EL SUYO.
    const match = req.url.match(/\/v\/(\d+)\.mp4/);
    const bytes = match ? Number(match[1]) * 1000 : 1234;
    res.writeHead(200, { 'Content-Length': String(bytes), 'Content-Type': 'video/mp4' });
    res.end();
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  return { base, pedidos, cerrar: () => new Promise(r => server.close(r)) };
}

/** Página con N vídeos apuntando al servidor de pesos. */
function paginaCon(base, rutas) {
  const tags = rutas.map(ruta => `<video src="${base}${ruta}"></video>`).join('\n');
  return `<!doctype html><html><body>${tags}</body></html>`;
}

test('cada vídeo recibe SU propio peso, no el de otro', async t => {
  const { base, cerrar } = await servidorDePesos();
  t.after(() => cerrar());

  const rutas = ['/v/3.mp4', '/v/11.mp4', '/v/42.mp4'];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(paginaCon(base, rutas));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));

  const pagina = `http://127.0.0.1:${server.address().port}/`;
  const { videos } = await extractVideos(pagina, { getMetadata: true, useJavaScript: false });

  const porUrl = new Map(videos.map(v => [v.url, v]));
  for (const ruta of rutas) {
    const esperado = Number(ruta.match(/(\d+)/)[1]) * 1000;
    const video = porUrl.get(`${base}${ruta}`);
    assert.ok(video, `falta el vídeo ${ruta}`);
    assert.strictEqual(
      video.sizeBytes,
      esperado,
      `${ruta} recibió el peso de otro vídeo (${video.sizeBytes} en vez de ${esperado})`
    );
  }
});

test('un peso que no se puede obtener NO borra el vídeo', async t => {
  // El peso es un dato opcional: su fallo nunca debe hacer desaparecer un
  // resultado. Es la misma regla que ya está fijada para la fase 2.
  const { base, cerrar } = await servidorDePesos();
  t.after(() => cerrar());

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(paginaCon(base, ['/v/5.mp4', '/sin-peso.mp4', '/roto.mp4']));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));

  const pagina = `http://127.0.0.1:${server.address().port}/`;
  const { videos } = await extractVideos(pagina, { getMetadata: true, useJavaScript: false });

  const urls = videos.map(v => v.url);
  assert.ok(urls.includes(`${base}/sin-peso.mp4`), 'el vídeo sin content-length desapareció');
  assert.ok(urls.includes(`${base}/roto.mp4`), 'el vídeo cuyo HEAD falló desapareció');

  const conPeso = videos.find(v => v.url === `${base}/v/5.mp4`);
  assert.strictEqual(conPeso.sizeBytes, 5000, 'el que sí tiene peso debe conservarlo');
});

test('sin getMetadata no se pide ningún peso', async t => {
  const { base, pedidos, cerrar } = await servidorDePesos();
  t.after(() => cerrar());

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(paginaCon(base, ['/v/1.mp4', '/v/2.mp4']));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));

  const pagina = `http://127.0.0.1:${server.address().port}/`;
  await extractVideos(pagina, { getMetadata: false, useJavaScript: false });

  assert.strictEqual(
    pedidos.filter(p => p.metodo === 'HEAD').length,
    0,
    'sin getMetadata no debe salir ni un HEAD'
  );
});

test('se respeta el tope de búsquedas de metadatos', async t => {
  const { base, pedidos, cerrar } = await servidorDePesos();
  t.after(() => cerrar());

  const config = require('../src/config');
  const tope = config.video.maxMetadataLookups;

  // Unos cuantos más que el tope, para que el recorte se note
  const rutas = Array.from({ length: tope + 5 }, (_, i) => `/v/${i + 1}.mp4`);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(paginaCon(base, rutas));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));

  const pagina = `http://127.0.0.1:${server.address().port}/`;
  await extractVideos(pagina, { getMetadata: true, useJavaScript: false });

  const heads = pedidos.filter(p => p.metodo === 'HEAD').length;
  assert.ok(heads <= tope, `se hicieron ${heads} HEAD y el tope es ${tope}`);
});
