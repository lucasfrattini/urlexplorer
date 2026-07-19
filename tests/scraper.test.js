'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractMatchingLinks,
  extractFilesFromHtml,
  normalizeCrawlParams,
} = require('../src/services/scraper');

const BASE = 'https://sitio.com/galeria/index.html';

const HTML = `
  <html><body>
    <a href="/videos/gato1">Gato 1</a>
    <a href="/videos/gato2">Gato 2</a>
    <a href="/fotos/perro1">Perro</a>
    <a href="detalle.html">Relativo</a>
    <a href="https://externo.com/videos/otro">Externo</a>
    <a href="javascript:alert(1)">Malicioso</a>
    <a href="/videos/gato1">Duplicado</a>
  </body></html>
`;

test('extractMatchingLinks', async t => {
  await t.test('sin patrón devuelve todos los links absolutos y deduplicados', () => {
    const links = extractMatchingLinks(HTML, BASE, '');
    assert.equal(links.length, 5, 'javascript: descartado y duplicado eliminado');
    assert.ok(links.includes('https://sitio.com/videos/gato1'));
    assert.ok(links.includes('https://sitio.com/galeria/detalle.html'));
    assert.ok(!links.some(link => link.startsWith('javascript:')));
  });

  await t.test('patrón que empieza por "/" compara contra el href original', () => {
    const links = extractMatchingLinks(HTML, BASE, '/videos/');
    assert.ok(links.includes('https://sitio.com/videos/gato1'));
    assert.ok(links.includes('https://sitio.com/videos/gato2'));
    // El href del enlace externo es absoluto y también contiene "/videos/",
    // así que entra: el modo "/" filtra por subcadena del href tal cual está
    // escrito en el documento, no por ruta del mismo host.
    assert.ok(links.includes('https://externo.com/videos/otro'));
    assert.ok(!links.includes('https://sitio.com/fotos/perro1'));
  });

  await t.test('el modo "/" NO matchea un href relativo sin esa ruta', () => {
    const html = '<a href="detalle.html">x</a><a href="/videos/a">y</a>';
    const links = extractMatchingLinks(html, BASE, '/videos/');
    assert.deepEqual(links, ['https://sitio.com/videos/a']);
  });

  await t.test('patrón http compara con startsWith sobre la URL absoluta', () => {
    const links = extractMatchingLinks(HTML, BASE, 'https://externo.com');
    assert.deepEqual(links, ['https://externo.com/videos/otro']);
  });

  await t.test('patrón parcial compara con includes sobre la URL absoluta', () => {
    const links = extractMatchingLinks(HTML, BASE, 'videos');
    assert.equal(links.length, 3, 'incluye también el externo');
    assert.ok(links.includes('https://externo.com/videos/otro'));
  });

  await t.test('devuelve [] cuando nada coincide', () => {
    assert.deepEqual(extractMatchingLinks(HTML, BASE, '/no-existe/'), []);
  });

  await t.test('no revienta con HTML vacío o sin enlaces', () => {
    assert.deepEqual(extractMatchingLinks('', BASE, ''), []);
    assert.deepEqual(extractMatchingLinks('<html><body>hola</body></html>', BASE, ''), []);
  });
});

test('extractFilesFromHtml', async t => {
  const FILES_HTML = `
    <html><body>
      <a href="/media/clip.mp4">descarga</a>
      <a href="/scripts/app.ts.backup">no es un .ts</a>
      <a href="/pagina?ref=otro.mp4">falso positivo en la query</a>
      <video src="/media/muestra.webm"></video>
      <source src="/media/pista.MP4">
      <img src="/img/portada.jpg">
      <object data="/media/viejo.avi"></object>
    </body></html>
  `;

  await t.test('recoge solo los ficheros con la extensión real buscada', () => {
    const files = extractFilesFromHtml(FILES_HTML, BASE, ['mp4', 'webm']);
    assert.ok(files.includes('https://sitio.com/media/clip.mp4'));
    assert.ok(files.includes('https://sitio.com/media/muestra.webm'));
    assert.ok(files.includes('https://sitio.com/media/pista.MP4'), 'mayúsculas incluidas');
    assert.equal(files.length, 3);
  });

  await t.test('no cuela ".ts" dentro de otro nombre', () => {
    assert.deepEqual(extractFilesFromHtml(FILES_HTML, BASE, ['ts']), []);
  });

  await t.test('no cuela una extensión que solo está en la query string', () => {
    const files = extractFilesFromHtml(FILES_HTML, BASE, ['mp4']);
    assert.ok(!files.some(file => file.includes('ref=otro.mp4')));
  });

  await t.test('mira también src y data, no solo href', () => {
    assert.deepEqual(extractFilesFromHtml(FILES_HTML, BASE, ['avi']), [
      'https://sitio.com/media/viejo.avi',
    ]);
  });

  await t.test('sin extensiones no devuelve nada', () => {
    assert.deepEqual(extractFilesFromHtml(FILES_HTML, BASE, []), []);
  });
});

test('normalizeCrawlParams', async t => {
  await t.test('exige searchUrl', () => {
    assert.throws(() => normalizeCrawlParams({}), /searchUrl/);
    assert.throws(() => normalizeCrawlParams({ searchUrl: '   ' }), /searchUrl/);
  });

  await t.test('coerce las páginas que llegan como string', () => {
    // El endpoint antiguo comparaba "3" > 10 lexicográficamente
    const params = normalizeCrawlParams({
      searchUrl: 'https://sitio.com/',
      pageParam: 'page',
      startPage: '3',
      endPage: '7',
    });
    assert.equal(params.startPage, 3);
    assert.equal(params.endPage, 7);
  });

  await t.test('corrige un rango invertido en vez de romper', () => {
    const params = normalizeCrawlParams({
      searchUrl: 'https://sitio.com/',
      pageParam: 'page',
      startPage: 5,
      endPage: 2,
    });
    assert.equal(params.startPage, 5);
    assert.equal(params.endPage, 5);
  });

  await t.test('rechaza rangos que superan el tope CUANDO hay paginación', () => {
    assert.throws(
      () =>
        normalizeCrawlParams({
          searchUrl: 'https://sitio.com/',
          pageParam: 'page',
          startPage: 1,
          endPage: 500,
        }),
      /máximo es/i
    );
  });

  // Sin pageParam se descarga UNA sola página, así que rechazar endPage=51
  // era un 400 por un rango que nunca se iba a recorrer.
  await t.test('sin pageParam no aplica el tope y normaliza endPage', () => {
    const params = normalizeCrawlParams({
      searchUrl: 'https://sitio.com/',
      startPage: 1,
      endPage: 51,
    });
    assert.equal(params.endPage, 1, 'endPage se ajusta a la única página que se pide');
    assert.equal(params.pageParam, '');
  });

  await t.test('el tope permite exactamente el máximo', () => {
    const params = normalizeCrawlParams({
      searchUrl: 'https://sitio.com/',
      pageParam: 'page',
      startPage: 1,
      endPage: 50,
    });
    assert.equal(params.endPage, 50);
  });

  await t.test('limita concurrency al máximo configurado', () => {
    const params = normalizeCrawlParams({ searchUrl: 'https://sitio.com/', concurrency: 999 });
    assert.ok(params.concurrency <= 12);
    assert.ok(params.concurrency >= 1);
  });

  // useJavaScript se propaga a la fase 2: antes solo afectaba a la fase 1 y
  // entrar en cada enlace iba siempre por HTTP plano.
  await t.test('useJavaScript llega a los parámetros normalizados', () => {
    const params = normalizeCrawlParams({
      searchUrl: 'https://sitio.com/',
      useJavaScript: 'true',
    });
    assert.equal(params.useJavaScript, true);
  });

  await t.test('acepta useJavaScript como booleano y como string', () => {
    const base = { searchUrl: 'https://sitio.com/' };
    assert.equal(normalizeCrawlParams({ ...base, useJavaScript: true }).useJavaScript, true);
    assert.equal(normalizeCrawlParams({ ...base, useJavaScript: 'true' }).useJavaScript, true);
    // El bug original: el string 'false' es truthy, así que Puppeteer se
    // lanzaba siempre aunque el usuario no lo hubiera pedido.
    assert.equal(normalizeCrawlParams({ ...base, useJavaScript: 'false' }).useJavaScript, false);
    assert.equal(normalizeCrawlParams(base).useJavaScript, false);
  });
});
