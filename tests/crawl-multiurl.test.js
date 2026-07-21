'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Igual que crawl.integration: se desactiva la SSRF (el servidor vive en
// 127.0.0.1) y el navegador ANTES de cargar la configuración.
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';

const {
  crawlMany,
  normalizeCrawlParamsList,
  resolverSearchUrls,
} = require('../src/services/scraper');

/**
 * Multi-URL: varias direcciones con la MISMA configuración se recorren juntas
 * y los duplicados se agrupan UNA sola vez sobre la fusión.
 *
 * El caso que fija el test es justo el que se rompería si la agrupación
 * corriera por dirección: dos ficheros con URLs distintas pero misma duración
 * y mismo tamaño, cada uno hallado en una dirección diferente. Agrupando por
 * dirección jamás se compararían; agrupando sobre la fusión forman un grupo.
 */
function crearSitioMulti() {
  // Todas las fichas cuelgan del MISMO patrón (/v/), porque la configuración
  // es compartida: no puede haber un patrón de enlace por dirección.
  const fichas = {
    '/v/a1': { dur: 'PT10M0S', size: '100 MB', file: '/media/a1.mp4' },
    '/v/a2': { dur: 'PT5M0S', size: '50 MB', file: '/media/a2.mp4' },
    // b9 comparte duración (600s) y tamaño (100 MB) con a1, pero su URL y su
    // nombre normalizado son distintos: la única forma de agruparlos es
    // haberlos fundido antes.
    '/v/b9': { dur: 'PT10M0S', size: '100 MB', file: '/media/b9.mp4' },
  };

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const page = Number(url.searchParams.get('page') || '1');

    if (url.pathname === '/searchA') {
      const items = page === 1 ? ['/v/a1', '/v/a2'] : [];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<html><body>${items.map(h => `<a href="${h}">ficha</a>`).join('')}</body></html>`
      );
    }

    if (url.pathname === '/searchB') {
      const items = page === 1 ? ['/v/b9'] : [];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<html><body>${items.map(h => `<a href="${h}">ficha</a>`).join('')}</body></html>`
      );
    }

    if (fichas[url.pathname]) {
      const f = fichas[url.pathname];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<html><body>
          <meta itemprop="duration" content="${f.dur}">
          <div class="video-size">${f.size}</div>
          <video src="${f.file}"></video>
        </body></html>`
      );
    }

    res.writeHead(404);
    res.end('no');
  });
}

test('crawlMany — varias direcciones, agrupación única sobre la fusión', async t => {
  const server = crearSitioMulti();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));

  const compartida = {
    linkPattern: '/v/',
    pageParam: 'page',
    startPage: 1,
    endPage: 3,
    concurrency: 2,
    useJavaScript: false,
    withSizes: true,
  };

  const listaParams = normalizeCrawlParamsList({
    ...compartida,
    searchUrls: [`${base}/searchA?q=x`, `${base}/searchB?q=x`],
    fileExtensions: '.mp4',
  }).map(p => ({ ...p, extensions: ['mp4'] }));

  await t.test('funde los ficheros de las dos direcciones', async () => {
    const r = await crawlMany({ listaParams, extensions: ['mp4'] });
    // a1, a2 y b9: tres ficheros únicos entre las dos direcciones.
    assert.equal(r.totalFiles, 3, `esperaba 3 ficheros, hubo ${r.totalFiles}`);
    assert.equal(r.direccionesAnalizadas, 2);
    assert.equal(r.direccionesTotal, 2);
    assert.equal(r.failures.length, 0, `hubo fallos: ${JSON.stringify(r.failures)}`);
  });

  await t.test('agrupa como duplicados los que solo se cruzan entre direcciones', async () => {
    const r = await crawlMany({ listaParams, extensions: ['mp4'] });
    // a1 (de searchA) y b9 (de searchB) comparten duración y tamaño: si la
    // agrupación corriera por dirección, nunca se verían. Debe salir UN grupo.
    assert.equal(r.duplicateGroups.length, 1, 'debe haber exactamente un grupo de duplicados');
    const grupo = r.duplicateGroups[0];
    assert.equal(grupo.miembros.length, 2, 'el grupo debe tener dos miembros');
    const nombres = grupo.miembros.map(u => u.split('/').pop()).sort();
    assert.deepEqual(nombres, ['a1.mp4', 'b9.mp4']);
  });
});

test('resolverSearchUrls — acepta todas las formas de entrada', () => {
  // array directo (POST con cuerpo JSON)
  assert.deepEqual(resolverSearchUrls({ searchUrls: ['https://a.com', 'https://b.com'] }), [
    'https://a.com',
    'https://b.com',
  ]);
  // string JSON (GET del SSE)
  assert.deepEqual(resolverSearchUrls({ searchUrls: '["https://a.com","https://b.com"]' }), [
    'https://a.com',
    'https://b.com',
  ]);
  // searchUrl repetido, que Express entrega como array
  assert.deepEqual(resolverSearchUrls({ searchUrl: ['https://a.com', 'https://b.com'] }), [
    'https://a.com',
    'https://b.com',
  ]);
  // searchUrl string único: retrocompatible con enlaces y perfiles
  assert.deepEqual(resolverSearchUrls({ searchUrl: 'https://a.com' }), ['https://a.com']);
  // recorta, descarta vacíos y repetidos, conserva el orden
  assert.deepEqual(
    resolverSearchUrls({ searchUrls: [' https://a.com ', '', 'https://a.com', 'https://b.com'] }),
    ['https://a.com', 'https://b.com']
  );
  // JSON inválido cae a searchUrl
  assert.deepEqual(resolverSearchUrls({ searchUrls: '{no es', searchUrl: 'https://a.com' }), [
    'https://a.com',
  ]);
});

test('normalizeCrawlParamsList — comparte config y respeta los topes', () => {
  const base = { linkPattern: '/v/', startPage: 1, endPage: 2 };

  // una sola dirección: un único elemento, la config compartida aplicada
  const uno = normalizeCrawlParamsList({ ...base, searchUrl: 'https://a.com/s?q=x' });
  assert.equal(uno.length, 1);
  assert.equal(uno[0].linkPattern, '/v/');

  // varias: la MISMA config en cada una, distinta searchUrl
  const varias = normalizeCrawlParamsList({
    ...base,
    searchUrls: ['https://a.com/s', 'https://b.com/s'],
  });
  assert.equal(varias.length, 2);
  assert.equal(varias[0].searchUrl, 'https://a.com/s');
  assert.equal(varias[1].searchUrl, 'https://b.com/s');
  assert.equal(varias[1].linkPattern, '/v/');

  // sin ninguna URL: error de cliente, no lista vacía silenciosa
  assert.throws(
    () => normalizeCrawlParamsList({ linkPattern: '/v/' }),
    /SEARCH_URL_REQUIRED|requiere/
  );

  // por encima del tope: error explícito, no truncado en silencio
  const demasiadas = Array.from({ length: 50 }, (_, i) => `https://s${i}.com`);
  assert.throws(() => normalizeCrawlParamsList({ searchUrls: demasiadas }), /máximo|TOO_MANY_URLS/);
});
