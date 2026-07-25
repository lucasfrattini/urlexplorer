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
// Los reintentos siguen siendo los de siempre; lo que se quita es la espera
// entre ellos, para que el escenario de 429 no tarde varios segundos.
process.env.HTTP_RETRY_BASE_DELAY_MS = '0';
process.env.HTTP_RETRY_429_BASE_DELAY_MS = '0';

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

  // Sin extensiones NO hay fase 2. Es correcto, pero era invisible: se veían
  // enlaces, ningún fichero y ningún error, y no había forma de saber que
  // faltaba rellenar un campo. Ahora la interfaz lo avisa; aquí se fija el
  // comportamiento del motor.
  await t.test('sin extensiones no ejecuta la fase 2', async () => {
    const resultado = await crawl({ ...params, extensions: [] });
    assert.ok(resultado.totalLinks > 0, 'la fase 1 sí debe traer enlaces');
    assert.equal(resultado.totalFiles, 0);
    assert.deepEqual(resultado.extensions, []);
  });

  /**
   * Enlaces que REDIRIGEN a otro sitio, como los de un agregador.
   *
   * Fija dos cosas:
   *  1. La fase 2 sigue el redirect y saca el fichero de la página destino.
   *  2. La comprobación de identidad usa la URL PEDIDA, no la final, así que
   *     tras un redirect no tiene identificador con el que comparar y aplica
   *     su regla permisiva. Es una limitación conocida y asumida: se prefiere
   *     devolver el fichero a marcarlo por algo que el motor no puede
   *     comprobar.
   */
  await t.test('sigue los enlaces que redirigen a otro sitio', async () => {
    const destino = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><video src="/media/real-9931.mp4"></video></body></html>');
    });
    await new Promise(r => destino.listen(0, '127.0.0.1', r));
    const destinoBase = `http://127.0.0.1:${destino.address().port}`;

    const agregador = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/search') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><body><a href="/out/?l=abc123">ir</a></body></html>');
      }
      res.writeHead(302, { Location: `${destinoBase}/v/9931` });
      return res.end();
    });
    await new Promise(r => agregador.listen(0, '127.0.0.1', r));
    const agregadorBase = `http://127.0.0.1:${agregador.address().port}`;

    try {
      const resultado = await crawl({
        searchUrl: `${agregadorBase}/search?q=x`,
        linkPattern: '/out',
        startPage: 1,
        endPage: 1,
        extensions: ['mp4'],
        concurrency: 1,
        useJavaScript: false,
      });

      assert.equal(resultado.totalLinks, 1);
      assert.equal(resultado.totalFiles, 1, 'debe sacar el fichero de la página destino');
    } finally {
      await new Promise(r => agregador.close(r));
      await new Promise(r => destino.close(r));
    }
  });
});

/**
 * Ficha con VARIOS vídeos reales — un álbum, no un vídeo con clips de vista
 * previa. Reproduce el fallo real: cada `<video poster>` lleva su propia
 * imagen y una insignia de duración hermana (`<span class="duration">`), no
 * una compartida. `findFiles` sacaba la miniatura y la duración UNA vez por
 * página (og:image / primer `.duration` del documento) y se las estampaba a
 * los N ficheros por igual: N vídeos distintos con la MISMA miniatura y la
 * MISMA duración, que `groupDuplicates` interpretaba como duplicados.
 */
test('ficha con varios vídeos — cada uno con su propia miniatura y duración', async t => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/search') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><a href="/a/album1">álbum</a></body></html>');
      return;
    }

    if (url.pathname === '/a/album1') {
      // Los ficheros comparten el identificador de la ficha ("album1"), igual
      // que en un sitio real, para que `relevance.js` los marque como
      // verificados y no anule la duración por esa vía: lo que este test
      // fija es el reparto de miniatura/duración, no la verificación de
      // identidad, que ya tiene su propia cobertura.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><head>
          <meta property="og:image" content="/media/portada-album.jpg">
        </head><body>
          <div class="video">
            <video poster="/media/album1/v1.jpg"><source src="/media/album1/v1.mp4"></video>
            <span class="duration">00:27</span>
          </div>
          <div class="video">
            <video poster="/media/album1/v2.jpg"><source src="/media/album1/v2.mp4"></video>
            <span class="duration">00:03</span>
          </div>
          <div class="video">
            <video poster="/media/album1/v3.jpg"><source src="/media/album1/v3.mp4"></video>
            <span class="duration">00:14</span>
          </div>
        </body></html>`
      );
      return;
    }

    res.writeHead(404);
    res.end('no');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));

  const resultado = await crawl({
    searchUrl: `${base}/search?q=x`,
    linkPattern: '/a/',
    startPage: 1,
    endPage: 1,
    extensions: ['mp4'],
    concurrency: 2,
    useJavaScript: false,
    withThumbnails: true,
  });

  assert.equal(resultado.totalFiles, 3, 'los tres vídeos del álbum deben aparecer');

  const porNombre = Object.fromEntries(resultado.fileDetails.map(d => [d.url.split('/').pop(), d]));

  await t.test('cada vídeo lleva SU propia miniatura, no la de la página', () => {
    assert.equal(porNombre['v1.mp4'].thumbnail, `${base}/media/album1/v1.jpg`);
    assert.equal(porNombre['v2.mp4'].thumbnail, `${base}/media/album1/v2.jpg`);
    assert.equal(porNombre['v3.mp4'].thumbnail, `${base}/media/album1/v3.jpg`);
    // Ninguno debe llevar la og:image de la página: sería la miniatura de
    // otro vídeo.
    for (const d of resultado.fileDetails) {
      assert.notEqual(d.thumbnail, `${base}/media/portada-album.jpg`);
    }
  });

  await t.test('cada vídeo lleva SU propia duración, no la del primero', () => {
    assert.equal(porNombre['v1.mp4'].durationSeconds, 27);
    assert.equal(porNombre['v2.mp4'].durationSeconds, 3);
    assert.equal(porNombre['v3.mp4'].durationSeconds, 14);
  });

  await t.test('no se agrupan como duplicados', () => {
    assert.equal(
      resultado.duplicateGroups.length,
      0,
      `no debería haber grupos: ${JSON.stringify(resultado.duplicateGroups)}`
    );
    assert.equal(resultado.totalDuplicados, 0);
  });
});

/**
 * El sitio empieza a devolver 429 A MITAD de la fase 2.
 *
 * Es el caso que estaba mudo: la fase 1 sí observaba el bloqueo, pero la fase
 * 2 solo apuntaba `{url, error}` en `failures`, sin log y sin analizar la
 * respuesta. `diagnostico.bloqueo.sospechoso` se quedaba en `false` aunque el
 * sitio estuviera cerrando la puerta, así que el aviso que la interfaz ya sabe
 * pintar no salía nunca.
 */
test('un 429 en la fase 2 se ve en el diagnóstico, sin perder lo ya encontrado', async t => {
  // Las dos primeras fichas responden bien; de la tercera en adelante, 429.
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/search') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><body>
          ${[1, 2, 3, 4].map(n => `<a href="/a/${n}">ficha ${n}</a>`).join('')}
        </body></html>`
      );
      return;
    }

    if (url.pathname.startsWith('/a/')) {
      const n = Number(url.pathname.split('/').pop());
      if (n >= 3) {
        res.writeHead(429, { 'Content-Type': 'text/html' });
        res.end('<html><body>Too many requests</body></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><video src="/media/video-${n}.mp4"></video></body></html>`);
      return;
    }

    res.writeHead(404);
    res.end('no');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));

  const params = {
    searchUrl: `${base}/search?q=x`,
    linkPattern: '/a/',
    startPage: 1,
    endPage: 1,
    extensions: ['mp4'],
    concurrency: 2,
    useJavaScript: false,
  };

  const resultado = await crawl(params);

  await t.test('la sospecha de bloqueo llega al diagnóstico, con su motivo', () => {
    assert.equal(
      resultado.diagnostico.bloqueo.sospechoso,
      true,
      'una racha de 429 en la fase 2 no puede quedar en silencio'
    );
    assert.ok(
      resultado.diagnostico.bloqueo.motivos.some(m => m.includes('429')),
      `el motivo debe mencionar el 429: ${JSON.stringify(resultado.diagnostico.bloqueo.motivos)}`
    );
  });

  await t.test('`failures` sigue teniendo las fichas que fallaron', () => {
    assert.equal(resultado.failures.length, 2);
    for (const fallo of resultado.failures) {
      assert.ok(typeof fallo.url === 'string' && fallo.url.startsWith(base));
      assert.ok(typeof fallo.error === 'string' && fallo.error !== '');
    }
    // La forma de `failures` no cambia: sigue siendo {url, error} y nada más
    assert.deepEqual(Object.keys(resultado.failures[0]).sort(), ['error', 'url']);
  });

  await t.test('lo encontrado ANTES del bloqueo no se pierde', () => {
    assert.equal(resultado.totalFiles, 2, 'una racha de 429 no borra lo ya hallado');
    assert.equal(resultado.fileDetails.length, 2);
  });

  await t.test('el campo interno `bloqueo` no se cuela suelto en la respuesta', () => {
    assert.equal('bloqueo' in resultado, false);
  });
});

/**
 * Al CONTINUAR un trabajo frenado la fase 1 no se repite, así que no hay
 * diagnóstico de fase 1 donde fundir la sospecha. Si aun así el sitio bloquea,
 * el aviso tiene que llegar igual: es justo la tanda en la que el sitio ya se
 * ha cansado de nosotros.
 */
test('al continuar sin fase 1, el bloqueo de la fase 2 crea el diagnóstico', async t => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/a/1') {
      res.writeHead(429, { 'Content-Type': 'text/html' });
      res.end('<html><body>Too many requests</body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><video src="/media/ok.mp4"></video></body></html>');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));

  const params = {
    searchUrl: `${base}/search`,
    linkPattern: '/a/',
    startPage: 1,
    endPage: 1,
    extensions: ['mp4'],
    concurrency: 1,
    useJavaScript: false,
  };

  await t.test('con bloqueo, se construye el diagnóstico que faltaba', async () => {
    const resultado = await crawl(params, { linksPrevios: [`${base}/a/1`] });

    assert.notEqual(resultado.diagnostico, null, 'debe haber diagnóstico aunque no hubiera fase 1');
    assert.equal(resultado.diagnostico.bloqueo.sospechoso, true);
    assert.ok(resultado.diagnostico.bloqueo.motivos.some(m => m.includes('429')));
    // La forma es la que el cliente ya conoce
    assert.deepEqual(resultado.diagnostico.enlacesVistos, 0);
    assert.deepEqual(resultado.diagnostico.prefijos, []);
  });

  await t.test('sin bloqueo NO se inventa un diagnóstico vacío', async () => {
    const resultado = await crawl(params, { linksPrevios: [`${base}/a/2`] });

    assert.equal(resultado.totalFiles, 1);
    assert.equal(resultado.diagnostico, null, 'un diagnóstico con todo a cero no aporta nada');
  });
});

/**
 * Contraparte: con UN solo vídeo en la ficha no hay ambigüedad, y la
 * miniatura/duración de página siguen sirviendo de respaldo como siempre.
 */
test('ficha con un único vídeo sigue usando la miniatura y duración de página', async t => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/search') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><a href="/a/solo1">ficha</a></body></html>');
      return;
    }

    if (url.pathname === '/a/solo1') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><head>
          <meta property="og:image" content="/media/portada.jpg">
          <meta itemprop="duration" content="PT2M5S">
        </head><body>
          <a href="/media/unico.mp4">descargar</a>
        </body></html>`
      );
      return;
    }

    res.writeHead(404);
    res.end('no');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));

  const resultado = await crawl({
    searchUrl: `${base}/search?q=x`,
    linkPattern: '/a/',
    startPage: 1,
    endPage: 1,
    extensions: ['mp4'],
    concurrency: 1,
    useJavaScript: false,
    withThumbnails: true,
  });

  assert.equal(resultado.totalFiles, 1);
  const detalle = resultado.fileDetails[0];
  assert.equal(detalle.thumbnail, `${base}/media/portada.jpg`);
  assert.equal(detalle.durationSeconds, 125);
});
