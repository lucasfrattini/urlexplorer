'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Igual que crawl-multiurl: el fixture vive en 127.0.0.1, así que se desactiva
// la SSRF y el navegador ANTES de cargar la configuración.
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';

const { extractVideos, extractVideosBatch, adaptarParaDedupe } = require('../src/services/video');

/**
 * Sitio de prueba con fichas de vídeo.
 *
 * Cada página declara una miniatura (og:image) y uno o varios <video> con su
 * duración. Se usan dominios ficticios (example.com) en los datos, nunca uno
 * real.
 */
function crearSitio() {
  const paginas = {
    // Dos vídeos propios y uno compartido con /p2, para probar la fusión. Cada
    // <video> lleva SU poster: uno.mp4 y b9.mp4 comparten uno (misma-poster),
    // compartido.mp4 lleva otro distinto para que no se agrupe con ellos.
    '/p1': `
      <html><body>
        <video src="/media/uno.mp4" poster="/media/poster-ab.jpg" data-duration="600"></video>
        <video src="/media/compartido.mp4" poster="/media/poster-c.jpg" data-duration="120"></video>
      </body></html>`,
    // b9 comparte miniatura Y duración con uno.mp4 pero su URL y su nombre son
    // distintos: solo se agrupan si se han fundido antes de comparar.
    '/p2': `
      <html><body>
        <video src="/media/b9.mp4" poster="/media/poster-ab.jpg" data-duration="600"></video>
        <video src="/media/compartido.mp4" poster="/media/poster-c.jpg" data-duration="120"></video>
      </body></html>`,
    // Página de UN solo vídeo sin poster propio: la og:image de la página no
    // es ambigua aquí, así que sirve de respaldo.
    '/thumbs-solo': `
      <html><head>
        <meta property="og:image" content="https://cdn.example.com/og.jpg">
      </head><body>
        <video src="/media/sin-poster.mp4"></video>
      </body></html>`,
    // Página con VARIOS vídeos: uno trae poster propio, el otro no. La
    // og:image de la página describe a la ficha, no a un vídeo concreto, así
    // que NO debe estamparse al que le falta el suyo (sería la misma
    // miniatura para dos vídeos distintos: el bug que esto corrige).
    '/thumbs-album': `
      <html><head>
        <meta property="og:image" content="https://cdn.example.com/og.jpg">
      </head><body>
        <video src="/media/sin-poster.mp4"></video>
        <video src="/media/con-poster.mp4" poster="/media/poster.jpg"></video>
      </body></html>`,
    // Página simple para el caso single-URL.
    '/simple': `
      <html><body>
        <video src="/media/solo.mp4" data-duration="300"></video>
      </body></html>`,
    /**
     * Página pensada para el progreso por vías: Cheerio ve DOS vídeos (los dos
     * <video> con src relativo, que la regex no puede ver porque no son
     * absolutos) y la regex sobre el HTML aporta UNO más (el del script, que
     * no está en ningún <video>). Ninguna plataforma conocida.
     */
    '/progreso': `
      <html><body>
        <video src="/media/a1.mp4" data-duration="100"></video>
        <video src="/media/a2.mp4" data-duration="200"></video>
        <script>var fuente = {"file":"https://cdn.example.com/extra.mp4"};</script>
      </body></html>`,
  };

  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    if (paginas[pathname]) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(paginas[pathname]);
    }
    res.writeHead(404);
    res.end('no');
  });
}

test('extractVideosBatch — fusión, agrupación cruzada y miniaturas', async t => {
  const server = crearSitio();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));

  await t.test('funde los vídeos de varias direcciones deduplicando por URL', async () => {
    const r = await extractVideosBatch([`${base}/p1`, `${base}/p2`], {
      useJavaScript: false,
    });
    const nombres = r.videos.map(v => v.url.split('/').pop()).sort();
    // uno, b9 y compartido (una sola vez, aunque salga en las dos páginas).
    assert.deepEqual(nombres, ['b9.mp4', 'compartido.mp4', 'uno.mp4']);
    assert.equal(r.direccionesAnalizadas, 2);
    assert.equal(r.direccionesTotal, 2);
    assert.equal(r.methods.cheerio, true);
  });

  await t.test('agrupa duplicados que solo se cruzan entre direcciones', async () => {
    const r = await extractVideosBatch([`${base}/p1`, `${base}/p2`], {
      useJavaScript: false,
      getThumbnails: true,
    });
    // uno.mp4 (de /p1) y b9.mp4 (de /p2) comparten miniatura y duración: si la
    // agrupación corriera por dirección jamás se compararían. Debe salir UN
    // grupo con esos dos.
    const grupoUnoB9 = r.groups.find(
      g =>
        g.miembros.some(u => u.endsWith('/uno.mp4')) && g.miembros.some(u => u.endsWith('/b9.mp4'))
    );
    assert.ok(grupoUnoB9, 'uno.mp4 y b9.mp4 deben formar un grupo');
    assert.equal(grupoUnoB9.miembros.length, 2);
  });

  await t.test(
    'getThumbnails: un único vídeo sin poster hereda la og:image de la página',
    async () => {
      const conThumbs = await extractVideos(`${base}/thumbs-solo`, {
        useJavaScript: false,
        getThumbnails: true,
      });
      assert.equal(conThumbs.videos[0].thumbnailUrl, 'https://cdn.example.com/og.jpg');

      // Sin el flag no se adjunta ninguna miniatura (regresión del punto 13).
      const sinThumbs = await extractVideos(`${base}/thumbs-solo`, { useJavaScript: false });
      assert.ok(
        sinThumbs.videos.every(v => !v.thumbnailUrl),
        'sin getThumbnails ningún vídeo debe traer thumbnailUrl'
      );
    }
  );

  await t.test(
    'getThumbnails: con varios vídeos, el poster propio manda y la og:image NO se reparte',
    async () => {
      const conThumbs = await extractVideos(`${base}/thumbs-album`, {
        useJavaScript: false,
        getThumbnails: true,
      });
      const sinPoster = conThumbs.videos.find(v => v.url.endsWith('/sin-poster.mp4'));
      const conPoster = conThumbs.videos.find(v => v.url.endsWith('/con-poster.mp4'));
      // Con poster propio: gana el poster del <video>, absolutizado.
      assert.equal(conPoster.thumbnailUrl, `${base}/media/poster.jpg`);
      // Sin poster propio Y con más de un vídeo en la página: la og:image es
      // ambigua (¿de cuál de los dos es?) y NO debe estamparse. Antes de este
      // arreglo, un álbum de N vídeos acababa con los N compartiendo la MISMA
      // miniatura de página, y de ahí salían falsos duplicados.
      assert.equal(
        sinPoster.thumbnailUrl,
        undefined,
        'sin poster propio y con varios vídeos en la página, no debe heredar la og:image'
      );
    }
  );

  await t.test('single-URL conserva el shape de siempre', async () => {
    const r = await extractVideos(`${base}/simple`, { useJavaScript: false });
    assert.deepEqual(Object.keys(r).sort(), ['methods', 'total', 'url', 'videos'].sort());
    assert.equal(r.url, `${base}/simple`);
    assert.equal(r.total, r.videos.length);
    assert.equal(r.videos.length, 1);
    assert.equal(r.videos[0].url, `${base}/media/solo.mp4`);
  });

  await t.test('rechaza más direcciones que el tope, sin truncar en silencio', async () => {
    const muchas = Array.from({ length: 50 }, (_, i) => `${base}/p${i}`);
    await assert.rejects(
      () => extractVideosBatch(muchas, { useJavaScript: false }),
      /máximo|TOO_MANY_URLS/
    );
  });
});

/**
 * Progreso del análisis (LF-100).
 *
 * Lo que fija: `encontrados` es el DELTA de cada vía, no el acumulado. Si
 * alguien manda `videos.length`, el total final sigue siendo correcto y ningún
 * test que solo cuente vídeos lo vería: la única señal es el valor exacto de
 * CADA evento.
 */
test('progreso por vía y por dirección (emit)', async t => {
  const server = crearSitio();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));

  await t.test('cada method_result trae el delta de SU vía, nunca el acumulado', async () => {
    const eventos = [];
    const r = await extractVideos(`${base}/progreso`, {
      useJavaScript: false,
      emit: e => eventos.push(e),
    });

    const vias = eventos.filter(e => e.type === 'method_result');
    // Las cuatro vías se anuncian siempre y en orden, incluso con 0: un hueco
    // en la secuencia parecería un análisis detenido.
    assert.deepEqual(
      vias.map(e => e.method),
      ['puppeteer', 'cheerio', 'knownPlayers', 'scriptAnalysis']
    );

    const porVia = Object.fromEntries(vias.map(e => [e.method, e.encontrados]));
    assert.equal(porVia.cheerio, 2, 'Cheerio aportó dos vídeos');
    assert.equal(porVia.knownPlayers, 0);
    // El acumulado aquí sería 3: si sale 3, se está mandando videos.length.
    assert.equal(porVia.scriptAnalysis, 1, 'la regex aportó UNO más, no el total acumulado');
    // Sin navegador esta vía no aporta nada, y lo dice en vez de callarse.
    assert.equal(porVia.puppeteer, 0);

    // El resultado no cambia por observarlo.
    const sinEmit = await extractVideos(`${base}/progreso`, { useJavaScript: false });
    assert.deepEqual(
      r.videos.map(v => v.url),
      sinEmit.videos.map(v => v.url)
    );
    assert.equal(r.videos.length, 3);
  });

  await t.test('el lote emite url_start/url_complete con el índice 1-based', async () => {
    const eventos = [];
    const r = await extractVideosBatch([`${base}/simple`, `${base}/progreso`], {
      useJavaScript: false,
      emit: e => eventos.push(e),
    });

    const inicios = eventos.filter(e => e.type === 'url_start');
    assert.deepEqual(
      inicios.map(e => e.urlActual),
      [1, 2],
      'la primera dirección es la 1, no la 0'
    );
    assert.ok(inicios.every(e => e.urlTotal === 2));
    assert.equal(inicios[0].url, `${base}/simple`);

    // Cada vía sabe a qué dirección pertenece: sin eso, en un lote no habría
    // forma de atribuir un `method_result`.
    const viasDeProgreso = eventos.filter(
      e => e.type === 'method_result' && e.url === `${base}/progreso`
    );
    assert.equal(viasDeProgreso.find(e => e.method === 'cheerio').encontrados, 2);
    assert.ok(viasDeProgreso.every(e => e.urlActual === 2 && e.urlTotal === 2));

    const fines = eventos.filter(e => e.type === 'url_complete');
    assert.deepEqual(
      fines.map(e => e.encontrados),
      [1, 3]
    );
    assert.equal(r.direccionesAnalizadas, 2);
  });

  await t.test('una dirección que falla no corta el progreso de las siguientes', async () => {
    const eventos = [];
    // La del medio devuelve 404: fetchHtml lanza y extractVideos propaga.
    const r = await extractVideosBatch(
      [`${base}/simple`, `${base}/no-existe`, `${base}/progreso`],
      {
        useJavaScript: false,
        emit: e => eventos.push(e),
      }
    );

    assert.deepEqual(
      eventos.filter(e => e.type === 'url_start').map(e => e.urlActual),
      [1, 2, 3],
      'la tercera dirección debe arrancar aunque la segunda falle'
    );

    const fines = eventos.filter(e => e.type === 'url_complete');
    assert.deepEqual(
      fines.map(e => e.urlActual),
      [1, 2, 3],
      'la dirección que falla también se cierra: un url_start sin cierre parece colgado'
    );
    const fallida = fines.find(e => e.urlActual === 2);
    assert.equal(fallida.fallo, true);
    assert.equal(fallida.encontrados, 0);
    assert.equal(fines.find(e => e.urlActual === 3).encontrados, 3);

    // El hueco sigue siendo la señal visible de que algo no se pudo analizar.
    assert.equal(r.direccionesAnalizadas, 2);
    assert.equal(r.direccionesTotal, 3);
  });

  await t.test('emit es opcional: sin él, el lote se comporta igual', async () => {
    const r = await extractVideosBatch([`${base}/progreso`], { useJavaScript: false });
    assert.equal(r.videos.length, 3);
    assert.equal(r.direccionesAnalizadas, 1);
  });
});

test('adaptarParaDedupe — traduce el vídeo a los campos que compara dedupe', () => {
  const adaptado = adaptarParaDedupe({
    url: 'https://example.com/v.mp4',
    thumbnailUrl: 'https://cdn.example.com/t.jpg',
    duration: '10:30',
    size: '245 MB',
  });
  assert.equal(adaptado.url, 'https://example.com/v.mp4');
  assert.equal(adaptado.thumbnail, 'https://cdn.example.com/t.jpg');
  assert.equal(adaptado.durationSeconds, 630);
  assert.equal(adaptado.sizeBytes, Math.round(245 * 1024 ** 2));

  // sizeBytes numérico ya presente gana sobre el texto; datos ausentes a null.
  const conBytes = adaptarParaDedupe({ url: 'x', sizeBytes: 1000, duration: null });
  assert.equal(conBytes.sizeBytes, 1000);
  assert.equal(conBytes.durationSeconds, null);
  assert.equal(conBytes.thumbnail, null);
});
