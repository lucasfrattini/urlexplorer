'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectarPaginacion,
  detectarPatron,
  detectarExtensiones,
  parametroQueCambia,
  plantillaDeRuta,
  extraerEnlaces,
} = require('../src/services/detector');

const BASE = 'https://ejemplo.com/buscar?q=gatos';

/** Envuelve un cuerpo en un documento mínimo. */
function doc(body) {
  return `<!doctype html><html><body>${body}</body></html>`;
}

test('parametroQueCambia', async t => {
  await t.test('encuentra el único parámetro numérico distinto', () => {
    assert.equal(
      parametroQueCambia('https://ejemplo.com/b?q=x&page=1', 'https://ejemplo.com/b?q=x&page=2'),
      'page'
    );
  });

  // Si cambian dos cosas a la vez no se puede saber cuál es la página, y
  // adivinar aquí produciría una configuración que pagina sobre el campo
  // equivocado: siempre la misma página, sin ningún error.
  await t.test('no adivina si cambia más de uno', () => {
    assert.equal(
      parametroQueCambia('https://ejemplo.com/b?q=x&page=1', 'https://ejemplo.com/b?q=y&page=2'),
      null
    );
  });

  await t.test('exige que el valor sea numérico', () => {
    assert.equal(
      parametroQueCambia('https://ejemplo.com/b?orden=a', 'https://ejemplo.com/b?orden=z'),
      null
    );
  });

  await t.test('descarta si cambia el host o la ruta', () => {
    assert.equal(
      parametroQueCambia('https://ejemplo.com/b?page=1', 'https://otro.com/b?page=2'),
      null
    );
    assert.equal(
      parametroQueCambia('https://ejemplo.com/b?page=1', 'https://ejemplo.com/c?page=2'),
      null
    );
  });
});

test('plantillaDeRuta', async t => {
  await t.test('sustituye el número de la ruta por {page}', () => {
    assert.equal(
      plantillaDeRuta('https://ejemplo.com/buscar/page/2'),
      'https://ejemplo.com/buscar/page/{page}'
    );
  });

  await t.test('devuelve null si la ruta no lleva número', () => {
    assert.equal(plantillaDeRuta('https://ejemplo.com/buscar'), null);
  });
});

test('detectarPaginacion', async t => {
  await t.test('prefiere rel="next", que lo declara el propio sitio', () => {
    const html = doc('<a rel="next" href="/buscar?q=gatos&page=2">siguiente</a>');
    const enlaces = extraerEnlaces(html, BASE);
    const resultado = detectarPaginacion(html, BASE, enlaces);

    assert.equal(resultado.modo, 'parametro');
    assert.equal(resultado.pageParam, 'page');
    assert.equal(resultado.confianza, 'alta');
  });

  await t.test('si no, mira la botonera de números', () => {
    const html = doc(`
      <a href="/buscar?q=gatos&p=1">1</a>
      <a href="/buscar?q=gatos&p=2">2</a>
      <a href="/buscar?q=gatos&p=3">3</a>
    `);
    const enlaces = extraerEnlaces(html, BASE);
    const resultado = detectarPaginacion(html, BASE, enlaces);

    assert.equal(resultado.modo, 'parametro');
    assert.equal(resultado.pageParam, 'p');
  });

  await t.test('reconoce el número dentro de la ruta', () => {
    const html = doc(`
      <a href="/buscar/page/2">2</a>
      <a href="/buscar/page/3">3</a>
    `);
    const enlaces = extraerEnlaces(html, BASE);
    const resultado = detectarPaginacion(html, BASE, enlaces);

    assert.equal(resultado.modo, 'plantilla');
    assert.match(resultado.searchUrl, /\{page\}/);
  });

  // Es el caso del scroll infinito, y decirlo importa: sin botonera el
  // usuario no sabría por qué "Desde/Hasta" no hace nada.
  await t.test('admite que no hay paginación y sugiere el scroll', () => {
    const html = doc('<a href="/videos/1">un vídeo</a>');
    const enlaces = extraerEnlaces(html, BASE);
    const resultado = detectarPaginacion(html, BASE, enlaces);

    assert.equal(resultado.modo, 'ninguno');
    assert.equal(resultado.confianza, 'baja');
    assert.match(resultado.motivo, /scroll/i);
  });
});

test('detectarPatron', async t => {
  await t.test('propone la ruta más repetida entre las fichas', () => {
    const html = doc(`
      <a href="/videos/1001">a</a>
      <a href="/videos/1002">b</a>
      <a href="/videos/1003">c</a>
      <a href="/videos/1004">d</a>
      <a href="/videos/1005">e</a>
    `);
    const resultado = detectarPatron(extraerEnlaces(html, BASE));
    // Casi todas acaban en número, así que propone la expresión regular
    assert.match(resultado.linkPattern, /videos/);
    assert.equal(resultado.alternativa, '/videos/');
  });

  // El caso que motivó QW-2: fichas y páginas de miembros compartiendo
  // prefijo. La regex numérica es justo lo que las separa.
  await t.test('propone regex cuando las fichas acaban en número', () => {
    const html = doc(`
      <a href="/videos/1001">a</a>
      <a href="/videos/1002">b</a>
      <a href="/videos/1003">c</a>
      <a href="/videos/1004">d</a>
    `);
    const resultado = detectarPatron(extraerEnlaces(html, BASE));
    assert.equal(resultado.linkPattern, '/\\/videos\\/\\d+/');
  });

  // Sin este filtro, un menú de categorías repetido en toda la página gana
  // por goleada al contenido de verdad.
  await t.test('ignora las rutas de servicio aunque se repitan', () => {
    const html = doc(`
      <a href="/category/comedia-larga">1</a>
      <a href="/category/terror-clasico">2</a>
      <a href="/category/drama-moderno">3</a>
      <a href="/category/accion-directa">4</a>
      <a href="/clips/98765">real</a>
      <a href="/clips/98766">real</a>
    `);
    const resultado = detectarPatron(extraerEnlaces(html, BASE));
    assert.equal(resultado.linkPattern.includes('category'), false);
    assert.match(resultado.linkPattern, /clips/);
  });

  await t.test('admite que no ha encontrado nada', () => {
    const resultado = detectarPatron(extraerEnlaces(doc('<a href="/">inicio</a>'), BASE));
    assert.equal(resultado.linkPattern, '');
    assert.equal(resultado.confianza, 'baja');
  });
});

test('detectarExtensiones', async t => {
  await t.test('encuentra las que aparecen', () => {
    const encontradas = detectarExtensiones('<video src="/a/x.mp4"><img src="/b/y.jpg">');
    assert.ok(encontradas.includes('.mp4'));
    assert.ok(encontradas.includes('.jpg'));
  });

  // Mismo fallo que ya se corrigió en hasExtension: sin exigir delimitador,
  // "/app.ts.backup" contaba como ".ts".
  await t.test('no cuenta una extensión en medio del nombre', () => {
    assert.equal(detectarExtensiones('<a href="/x.mp4.html">').includes('.mp4'), false);
  });

  await t.test('devuelve lista vacía si no hay ninguna', () => {
    assert.deepEqual(detectarExtensiones('<a href="/videos/1">nada</a>'), []);
  });
});

test('extraerEnlaces', async t => {
  // Los enlaces salientes son publicidad o redes sociales: contarlos
  // falsearía el patrón más repetido.
  await t.test('descarta los enlaces a otros hosts', () => {
    const html = doc(`
      <a href="/videos/1">propio</a>
      <a href="https://otro.com/videos/1">ajeno</a>
    `);
    const enlaces = extraerEnlaces(html, BASE);
    assert.equal(enlaces.length, 1);
    assert.equal(enlaces[0].absolute, 'https://ejemplo.com/videos/1');
  });
});
