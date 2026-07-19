'use strict';

process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { CacheDeMiniaturas, obtenerMiniatura, cache } = require('../src/services/thumbnails');
const { extractThumbnail } = require('../src/lib/media');
const { createApp } = require('../src/app');

/**
 * Miniaturas servidas por el backend.
 *
 * Lo que se protege aquí no es la funcionalidad, es la DECISIÓN: que la
 * imagen la descargue el servidor y no el navegador del usuario. Poner la URL
 * de terceros en el `src` sería una línea más corta y filtraría la IP del
 * usuario a cada CDN de los sitios explorados.
 */

/* ── Extracción ────────────────────────────────────────────────────── */

test('extractThumbnail busca en orden de fiabilidad', () => {
  const base = 'https://ejemplo.com/ficha/1';

  assert.strictEqual(
    extractThumbnail(
      '<html><head><meta property="og:image" content="/img/a.jpg"></head></html>',
      base
    ),
    'https://ejemplo.com/img/a.jpg',
    'debe resolver la URL relativa contra la ficha'
  );

  assert.strictEqual(
    extractThumbnail(
      '<html><body><video poster="https://cdn.ejemplo.com/p.jpg"></video></body></html>',
      base
    ),
    'https://cdn.ejemplo.com/p.jpg'
  );

  assert.strictEqual(
    extractThumbnail(
      `<html><head><script type="application/ld+json">
        {"@type":"VideoObject","thumbnailUrl":"https://cdn.ejemplo.com/t.jpg"}
      </script></head></html>`,
      base
    ),
    'https://cdn.ejemplo.com/t.jpg'
  );

  assert.strictEqual(extractThumbnail('<html><body><p>x</p></body></html>', base), null);
});

test('extractThumbnail descarta lo que no sea http(s)', () => {
  // Un data: URI puede ser enorme y además no hay nada que descargar
  assert.strictEqual(
    extractThumbnail(
      '<html><head><meta property="og:image" content="data:image/png;base64,AAA"></head></html>',
      'https://ejemplo.com/f/1'
    ),
    null
  );
});

/* ── Caché ─────────────────────────────────────────────────────────── */

test('la caché desaloja por número de entradas', () => {
  const c = new CacheDeMiniaturas({ maxEntradas: 2, maxBytes: 1e9 });
  const entrada = n => ({ buffer: Buffer.alloc(10), contentType: `image/png#${n}` });

  c.set('a', entrada(1));
  c.set('b', entrada(2));
  c.set('c', entrada(3));

  assert.strictEqual(c.tamano, 2);
  assert.strictEqual(c.get('a'), null, 'la más vieja debe haberse desalojado');
  assert.ok(c.get('c'));
});

test('la caché desaloja por bytes', () => {
  const c = new CacheDeMiniaturas({ maxEntradas: 100, maxBytes: 100 });

  c.set('a', { buffer: Buffer.alloc(60), contentType: 'image/png' });
  c.set('b', { buffer: Buffer.alloc(60), contentType: 'image/png' });

  assert.strictEqual(c.tamano, 1, '120 bytes no caben en un tope de 100');
  assert.ok(c.bytes <= 100);
});

test('la caché es LRU: usar una entrada la salva del desalojo', () => {
  const c = new CacheDeMiniaturas({ maxEntradas: 2, maxBytes: 1e9 });
  const entrada = () => ({ buffer: Buffer.alloc(10), contentType: 'image/png' });

  c.set('a', entrada());
  c.set('b', entrada());
  c.get('a'); // se usa 'a', así que la vieja pasa a ser 'b'
  c.set('c', entrada());

  assert.ok(c.get('a'), '"a" se usó hace poco y no debería desalojarse');
  assert.strictEqual(c.get('b'), null);
});

/* ── El proxy ──────────────────────────────────────────────────────── */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function servidor(handler) {
  const s = http.createServer(handler);
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  return { puerto: s.address().port, cerrar: () => new Promise(r => s.close(r)) };
}

test('solo se sirve lo que de verdad es una imagen', async t => {
  const { puerto, cerrar } = await servidor((req, res) => {
    if (req.url === '/imagen.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG);
    }
    // Un HTML disfrazado de miniatura: sin el filtro, este endpoint sería un
    // proxy genérico para cualquier contenido.
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>no soy una imagen</html>');
  });
  t.after(() => cerrar());

  const ok = await obtenerMiniatura(`http://127.0.0.1:${puerto}/imagen.png`);
  assert.strictEqual(ok.contentType, 'image/png');
  assert.ok(Buffer.isBuffer(ok.buffer));

  await assert.rejects(
    () => obtenerMiniatura(`http://127.0.0.1:${puerto}/pagina.html`),
    error => {
      assert.strictEqual(error.code, 'NOT_AN_IMAGE');
      return true;
    }
  );
});

test('la segunda petición sale de la caché, sin volver a pedirla', async t => {
  let pedidas = 0;
  const { puerto, cerrar } = await servidor((req, res) => {
    pedidas += 1;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
  });
  t.after(() => cerrar());

  const url = `http://127.0.0.1:${puerto}/una.png`;
  const primera = await obtenerMiniatura(url);
  const segunda = await obtenerMiniatura(url);

  assert.strictEqual(primera.deCache, false);
  assert.strictEqual(segunda.deCache, true);
  assert.strictEqual(pedidas, 1, 'la segunda no debería haber salido a la red');
});

test('el endpoint sirve la imagen desde nuestro origen', async t => {
  const origen = await servidor((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
  });
  t.after(() => origen.cerrar());

  const app = createApp();
  const nuestro = await servidor(app);
  t.after(() => nuestro.cerrar());

  cache.entradas.clear();

  const destino = encodeURIComponent(`http://127.0.0.1:${origen.puerto}/x.png`);
  const res = await fetch(`http://127.0.0.1:${nuestro.puerto}/api/thumbnail?url=${destino}`);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(Number(res.headers.get('content-length')) > 0);
});

test('sin url, el endpoint responde 400', async t => {
  const app = createApp();
  const nuestro = await servidor(app);
  t.after(() => nuestro.cerrar());

  const res = await fetch(`http://127.0.0.1:${nuestro.puerto}/api/thumbnail`);
  assert.strictEqual(res.status, 400);
});
