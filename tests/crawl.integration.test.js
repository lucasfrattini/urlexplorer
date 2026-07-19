'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Se desactiva la protección SSRF ANTES de cargar la configuración: el
// servidor de pruebas vive en 127.0.0.1, que es justo lo que bloquea. También
// el navegador, para que estos tests no dependan de Chromium.
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';

const { crawl } = require('../src/services/scraper');

/**
 * Test de integración de las DOS fases contra un servidor real.
 *
 * Existe por un fallo concreto: `findFiles` usaba `withSizes` sin haberlo
 * sacado de `options`, así que lanzaba ReferenceError en cada URL de la fase
 * 2. El `try/catch` por URL lo convertía en "esta página falló" en vez de en
 * un error visible, y el resultado era una exploración que encontraba los
 * enlaces y devolvía CERO ficheros.
 *
 * Ningún test unitario lo veía, porque el fallo estaba en el cableado entre
 * `crawl` y `findFiles`, no dentro de una función. Solo se caza recorriendo
 * las dos fases de verdad.
 */

/** Listado con 3 fichas + páginas de detalle con un .mp4 cada una. */
function crearSitio() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/search') {
      const page = Number(url.searchParams.get('page') || '1');
      // La página 2 va vacía: es la condición de parada de la paginación
      const fichas = page === 1 ? [1, 2, 3] : [];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><body>
          ${fichas.map(n => `<a href="/a/${n}">ficha ${n}</a>`).join('')}
          <a href="/ayuda">no es una ficha</a>
        </body></html>`
      );
      return;
    }

    if (url.pathname.startsWith('/a/')) {
      const n = url.pathname.split('/').pop();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><body>
          <meta itemprop="duration" content="PT10M30S">
          <div class="video-size">245 MB</div>
          <video src="/media/video-${n}.mp4"></video>
        </body></html>`
      );
      return;
    }

    res.writeHead(404);
    res.end('no');
  });

  return server;
}

test('crawl completo — las dos fases contra un servidor real', async t => {
  const server = crearSitio();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(() => new Promise(resolve => server.close(resolve)));

  const params = {
    searchUrl: `${base}/search?q=gatos`,
    pageParam: 'page',
    linkPattern: '/a/',
    startPage: 1,
    endPage: 3,
    extensions: ['mp4'],
    concurrency: 2,
    useJavaScript: false,
  };

  await t.test('encuentra enlaces Y ficheros', async () => {
    const resultado = await crawl(params);

    assert.equal(resultado.totalLinks, 3, 'la fase 1 debe traer las 3 fichas');
    assert.equal(resultado.totalFiles, 3, 'la fase 2 debe traer los 3 ficheros');
    assert.equal(
      resultado.failures.length,
      0,
      `hubo fallos: ${JSON.stringify(resultado.failures)}`
    );
  });

  // ESTE es el caso que estaba roto. Con withSizes en true se ejecutaban las
  // dos líneas que referencian la variable que faltaba.
  await t.test('con withSizes activado sigue devolviendo ficheros', async () => {
    const resultado = await crawl({ ...params, withSizes: true });

    assert.equal(
      resultado.failures.length,
      0,
      `withSizes provocó fallos: ${JSON.stringify(resultado.failures.slice(0, 2))}`
    );
    assert.equal(resultado.totalFiles, 3, 'withSizes no puede hacer desaparecer los ficheros');
  });

  await t.test('el patrón de enlace filtra lo que no es una ficha', async () => {
    const resultado = await crawl(params);
    assert.equal(
      resultado.links.some(l => l.includes('/ayuda')),
      false
    );
  });

  await t.test('saca duración y tamaño del HTML de la ficha', async () => {
    const resultado = await crawl({ ...params, withSizes: true });
    const detalle = resultado.fileDetails[0];

    assert.equal(detalle.duration, '10:30');
    assert.equal(detalle.durationSeconds, 630);
    // El HEAD del servidor de pruebas no da content-length, así que cae al
    // respaldo del HTML y debe venir marcado como aproximado.
    assert.equal(detalle.sizeApproximate, true);
    assert.equal(detalle.sizeBytes, 245 * 1024 ** 2);
  });

  await t.test('para al llegar a una página sin resultados', async () => {
    const resultado = await crawl(params);
    assert.equal(resultado.pagesScraped, 2, 'debe parar en la página 2, que va vacía');
  });
});
