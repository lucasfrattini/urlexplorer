'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';

const { crawl } = require('../src/services/scraper');
const { fetchContentLength } = require('../src/lib/http');

/**
 * Protección de hotlinking y el peso de los ficheros.
 *
 * Este test existe por un caso real: la casilla "Obtener el tamaño" tardaba
 * siete veces más y devolvía CERO pesos en 193 ficheros. El motivo era que
 * el CDN respondía 403 a cualquier petición sin `Referer` —protección de
 * hotlinking, muy común— y `fetchContentLength` se tragaba ese 403 en
 * silencio devolviendo null.
 *
 * El servidor de abajo reproduce exactamente eso: 403 sin Referer, 200 con
 * él. Sin el arreglo, todos los pesos vienen vacíos.
 */
function crearSitioConHotlinkProtection() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/search') {
      const page = Number(url.searchParams.get('page') || '1');
      const fichas = page === 1 ? [11001, 11002] : [];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<html><body>${fichas.map(n => `<a href="/v/${n}">f</a>`).join('')}</body></html>`
      );
    }

    if (url.pathname.startsWith('/v/')) {
      const id = url.pathname.split('/').pop();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<html><body><meta itemprop="duration" content="PT10M">
         <video src="/media/${id}/${id}.mp4"></video></body></html>`
      );
    }

    if (url.pathname.startsWith('/media/')) {
      // Aquí está el comportamiento que rompía la funcionalidad
      if (!req.headers.referer) {
        res.writeHead(403);
        return res.end();
      }
      res.writeHead(200, { 'Content-Length': '5667930', 'Content-Type': 'video/mp4' });
      return res.end();
    }

    res.writeHead(404);
    res.end();
  });
}

test('el peso se obtiene aunque el CDN exija Referer', async t => {
  const server = crearSitioConHotlinkProtection();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(r => server.close(r)));

  await t.test('un HEAD sin Referer no consigue el peso', async () => {
    assert.equal(await fetchContentLength(`${base}/media/11001/11001.mp4`), null);
  });

  await t.test('con Referer sí lo consigue', async () => {
    assert.equal(
      await fetchContentLength(`${base}/media/11001/11001.mp4`, { referer: `${base}/v/11001` }),
      5667930
    );
  });

  // La comprobación de punta a punta: es la que fallaba en la práctica.
  await t.test('el crawl completo devuelve los ficheros CON su peso', async () => {
    const resultado = await crawl({
      searchUrl: `${base}/search?q=x`,
      pageParam: 'page',
      linkPattern: '/v/',
      startPage: 1,
      endPage: 1,
      extensions: ['mp4'],
      concurrency: 2,
      useJavaScript: false,
      withSizes: true,
    });

    assert.equal(resultado.totalFiles, 2);
    const conPeso = resultado.fileDetails.filter(d => Number.isFinite(d.sizeBytes));
    assert.equal(conPeso.length, 2, 'los dos ficheros deben traer peso');
    assert.equal(conPeso[0].sizeBytes, 5667930);
    // Viene del servidor, así que es exacto, no aproximado
    assert.equal(conPeso[0].sizeApproximate, false);
  });

  /**
   * La regla que no puede volver a romperse: el peso es un dato OPCIONAL.
   * Que no se pueda obtener nunca debe eliminar el resultado, solo dejar el
   * campo vacío.
   */
  await t.test('si el peso no se puede obtener, el fichero se devuelve igual', async () => {
    const servidorSinPeso = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/search') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><body><a href="/v/22001">f</a></body></html>');
      }
      if (url.pathname.startsWith('/v/')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><body><video src="/media/22001/22001.mp4"></video></body></html>');
      }
      // Ni con Referer ni sin él: el peso es inalcanzable
      res.writeHead(403);
      res.end();
    });
    await new Promise(r => servidorSinPeso.listen(0, '127.0.0.1', r));
    const b2 = `http://127.0.0.1:${servidorSinPeso.address().port}`;

    try {
      const resultado = await crawl({
        searchUrl: `${b2}/search?q=x`,
        linkPattern: '/v/',
        startPage: 1,
        endPage: 1,
        extensions: ['mp4'],
        concurrency: 1,
        useJavaScript: false,
        withSizes: true,
      });

      assert.equal(resultado.totalFiles, 1, 'el fichero NO puede desaparecer por no tener peso');
      assert.equal(resultado.failures.length, 0);
      assert.equal(resultado.fileDetails[0].sizeBytes, undefined);
    } finally {
      await new Promise(r => servidorSinPeso.close(r));
    }
  });
});
