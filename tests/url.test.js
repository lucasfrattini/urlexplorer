'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toAbsoluteUrl,
  buildPageUrl,
  hasExtension,
  hasPageTemplate,
  hasSearchTemplate,
  applySearchTerm,
  normalizePageParam,
  parseExtensionList,
  normalizeExtension,
  getExtension,
} = require('../src/lib/url');

test('toAbsoluteUrl', async t => {
  await t.test('resuelve rutas absolutas del host', () => {
    assert.equal(
      toAbsoluteUrl('/videos/gato', 'https://sitio.com/galeria?page=2'),
      'https://sitio.com/videos/gato'
    );
  });

  await t.test('resuelve rutas relativas al documento', () => {
    assert.equal(
      toAbsoluteUrl('detalle.html', 'https://sitio.com/galeria/index.html'),
      'https://sitio.com/galeria/detalle.html'
    );
  });

  await t.test('deja intactas las URLs ya absolutas', () => {
    assert.equal(toAbsoluteUrl('https://otro.com/x', 'https://sitio.com/'), 'https://otro.com/x');
  });

  // Este era el bug: startsWith('http') daba true para "httpfoo/bar", que en
  // realidad es una ruta relativa, y la URL quedaba sin resolver.
  await t.test('trata "httpfoo/bar" como relativa, no como absoluta', () => {
    assert.equal(
      toAbsoluteUrl('httpfoo/bar', 'https://sitio.com/seccion/'),
      'https://sitio.com/seccion/httpfoo/bar'
    );
  });

  await t.test('reconoce esquemas absolutos en mayúsculas', () => {
    assert.equal(toAbsoluteUrl('HTTPS://sitio.com/x', 'https://otro.com/'), 'https://sitio.com/x');
  });

  await t.test('descarta esquemas no navegables', () => {
    const base = 'https://sitio.com/';
    assert.equal(toAbsoluteUrl('javascript:alert(1)', base), null);
    assert.equal(toAbsoluteUrl('data:text/html,<script>x</script>', base), null);
    assert.equal(toAbsoluteUrl('mailto:a@b.com', base), null);
    assert.equal(toAbsoluteUrl('#seccion', base), null);
  });

  await t.test('devuelve null para entradas vacías o inválidas', () => {
    assert.equal(toAbsoluteUrl('', 'https://sitio.com/'), null);
    assert.equal(toAbsoluteUrl(null, 'https://sitio.com/'), null);
    assert.equal(toAbsoluteUrl(undefined, 'https://sitio.com/'), null);
    assert.equal(toAbsoluteUrl('/x', 'no-es-una-url'), null);
  });
});

test('buildPageUrl', async t => {
  await t.test('la primera página es la URL tal cual', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/galeria?q=gatos', 'page', 1, 1),
      'https://sitio.com/galeria?q=gatos'
    );
  });

  // El bug original: se concatenaba "&page=2", así que una URL sin query
  // string producía "https://sitio.com/gatitos&page=2", que es basura.
  await t.test('añade "?" cuando la URL no tiene query string', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/gatitos', 'page', 2, 1),
      'https://sitio.com/gatitos?page=2'
    );
  });

  await t.test('añade "&" cuando ya hay query string', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/galeria?q=gatos', 'page', 3, 1),
      'https://sitio.com/galeria?q=gatos&page=3'
    );
  });

  await t.test('reemplaza el parámetro si ya existía', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/galeria?page=1&q=x', 'page', 4, 1),
      'https://sitio.com/galeria?page=4&q=x'
    );
  });

  // Solo la pagina 1 va sin parametro. Antes la condicion era
  // `pageNumber === startPage`, asi que empezar en la 3 pedia la URL pelada y
  // devolvia la pagina 1: arrancar por la mitad no funcionaba.
  await t.test('empezar en una pagina distinta de la 1 pide ESA pagina', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/g?q=x', 'page', 3, 3),
      'https://sitio.com/g?q=x&page=3'
    );
    assert.equal(
      buildPageUrl('https://sitio.com/g?q=x', 'page', 4, 3),
      'https://sitio.com/g?q=x&page=4'
    );
  });

  await t.test('la pagina 1 sigue yendo sin parametro', () => {
    assert.equal(buildPageUrl('https://sitio.com/g?q=x', 'page', 1, 1), 'https://sitio.com/g?q=x');
  });

  await t.test('sin pageParam devuelve la URL sin tocar', () => {
    assert.equal(buildPageUrl('https://sitio.com/g', '', 5, 1), 'https://sitio.com/g');
  });
});

test('normalizeExtension y parseExtensionList', async t => {
  await t.test('normaliza puntos, espacios y mayúsculas', () => {
    assert.equal(normalizeExtension('.MP4'), 'mp4');
    assert.equal(normalizeExtension('  .webm '), 'webm');
    assert.equal(normalizeExtension('pdf'), 'pdf');
    assert.equal(normalizeExtension('...ts'), 'ts');
  });

  await t.test('parsea una lista CSV y deduplica', () => {
    assert.deepEqual(parseExtensionList('.mp4, .webm , mp4'), ['mp4', 'webm']);
  });

  await t.test('acepta arrays y devuelve [] para vacío', () => {
    assert.deepEqual(parseExtensionList(['.MP4', 'avi']), ['mp4', 'avi']);
    assert.deepEqual(parseExtensionList(''), []);
    assert.deepEqual(parseExtensionList(null), []);
    assert.deepEqual(parseExtensionList('  ,  , '), []);
  });
});

test('hasExtension', async t => {
  await t.test('acepta la extensión real del pathname', () => {
    assert.equal(hasExtension('https://sitio.com/media/clip.mp4', ['mp4']), true);
    assert.equal(hasExtension('https://sitio.com/media/CLIP.MP4', ['mp4']), true);
    assert.equal(hasExtension('https://sitio.com/media/clip.mp4?token=abc', ['mp4']), true);
    assert.equal(hasExtension('https://sitio.com/media/clip.mp4#t=10', ['mp4']), true);
  });

  // El bug original: includes('.ts') matcheaba cualquier URL con ".ts" dentro.
  await t.test('NO matchea la extensión en medio del nombre', () => {
    assert.equal(hasExtension('https://sitio.com/scripts/app.ts.backup', ['ts']), false);
    assert.equal(hasExtension('https://sitio.com/assets/app.tsx', ['ts']), false);
    assert.equal(hasExtension('https://sitio.com/x.mp4.html', ['mp4']), false);
  });

  await t.test('NO matchea la extensión dentro de la query string', () => {
    assert.equal(hasExtension('https://sitio.com/pagina?ref=video.mp4', ['mp4']), false);
    assert.equal(hasExtension('https://sitio.com/ver?f=.ts', ['ts']), false);
  });

  await t.test('funciona con varias extensiones', () => {
    assert.equal(hasExtension('https://sitio.com/a.webm', ['mp4', 'webm']), true);
    assert.equal(hasExtension('https://sitio.com/a.avi', ['mp4', 'webm']), false);
  });

  await t.test('devuelve false sin extensiones o con URL inválida', () => {
    assert.equal(hasExtension('https://sitio.com/a.mp4', []), false);
    assert.equal(hasExtension('https://sitio.com/a.mp4', null), false);
    assert.equal(hasExtension('no-es-url', ['mp4']), false);
  });

  await t.test('resuelve pathnames codificados', () => {
    assert.equal(hasExtension('https://sitio.com/mi%20video.mp4', ['mp4']), true);
  });
});

test('getExtension', async t => {
  await t.test('extrae la extensión del último segmento', () => {
    assert.equal(getExtension('https://sitio.com/a/b/clip.mp4'), 'mp4');
    assert.equal(getExtension('https://sitio.com/a/b/clip.mp4?x=1'), 'mp4');
    assert.equal(getExtension('https://sitio.com/a/b/sin-extension'), '');
    assert.equal(getExtension('no-es-url'), '');
  });
});

test('buildPageUrl — modo plantilla {page}', async t => {
  // El formato "?param=N" no cubre todos los sitios: hay paginación por ruta
  // (/page/2), por número con ceros (/lista/01) y variantes raras.
  await t.test('sustituye {page} en la ruta', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/buscar/gatos/page/{page}', '', 3, 1),
      'https://sitio.com/buscar/gatos/page/3'
    );
  });

  await t.test('sustituye {page} en la query string', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/buscar?q=gatos&p={page}', '', 4, 1),
      'https://sitio.com/buscar?q=gatos&p=4'
    );
  });

  // En modo plantilla la primera página TAMBIÉN se sustituye: si no, la URL
  // saldría con el literal "{page}" dentro.
  await t.test('sustituye también en la primera página', () => {
    assert.equal(buildPageUrl('https://sitio.com/p/{page}', '', 1, 1), 'https://sitio.com/p/1');
  });

  await t.test('rellena con ceros usando {page:0N}', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/l/{page:02}.html', '', 7, 1),
      'https://sitio.com/l/07.html'
    );
    assert.equal(
      buildPageUrl('https://sitio.com/l/{page:03}.html', '', 7, 1),
      'https://sitio.com/l/007.html'
    );
    assert.equal(
      buildPageUrl('https://sitio.com/l/{page:02}.html', '', 42, 1),
      'https://sitio.com/l/42.html'
    );
  });

  await t.test('sustituye varias apariciones', () => {
    assert.equal(
      buildPageUrl('https://sitio.com/p{page}/lista-{page}.html', '', 2, 1),
      'https://sitio.com/p2/lista-2.html'
    );
  });

  await t.test('la plantilla tiene prioridad sobre pageParam', () => {
    assert.equal(buildPageUrl('https://sitio.com/p/{page}', 'page', 5, 1), 'https://sitio.com/p/5');
  });

  // NO ROMPER lo anterior: sin plantilla, el comportamiento clásico intacto.
  await t.test('sin plantilla mantiene el modo parámetro de siempre', () => {
    assert.equal(buildPageUrl('https://sitio.com/g?q=x', 'page', 1, 1), 'https://sitio.com/g?q=x');
    assert.equal(
      buildPageUrl('https://sitio.com/g?q=x', 'page', 2, 1),
      'https://sitio.com/g?q=x&page=2'
    );
    assert.equal(
      buildPageUrl('https://sitio.com/gatitos', 'page', 2, 1),
      'https://sitio.com/gatitos?page=2'
    );
    assert.equal(buildPageUrl('https://sitio.com/g', '', 5, 1), 'https://sitio.com/g');
  });
});

test('hasPageTemplate', async t => {
  await t.test('reconoce las formas válidas', () => {
    assert.equal(hasPageTemplate('https://s.com/{page}'), true);
    assert.equal(hasPageTemplate('https://s.com/{page:02}'), true);
    assert.equal(hasPageTemplate('https://s.com/{PAGE}'), true);
  });

  await t.test('no confunde otras llaves ni URLs normales', () => {
    assert.equal(hasPageTemplate('https://s.com/?page=2'), false);
    assert.equal(hasPageTemplate('https://s.com/{otro}'), false);
    assert.equal(hasPageTemplate(null), false);
  });
});

test('normalizePageParam', async t => {
  // Es natural copiar el parámetro de la barra de direcciones tal cual.
  // Sin limpiarlo, "&page" acababa como "&%26page=2" y el sitio lo ignoraba.
  await t.test('acepta el nombre pegado con separadores', () => {
    const url = 'https://sitio.com/buscar?q=gatos';
    const esperado = 'https://sitio.com/buscar?q=gatos&page=2';
    for (const variante of ['page', '&page', '?page', 'page=', '&page=', ' page ']) {
      assert.equal(
        buildPageUrl(url, variante, 2, 1),
        esperado,
        `falló con ${JSON.stringify(variante)}`
      );
    }
  });

  await t.test('normaliza el nombre a secas', () => {
    assert.equal(normalizePageParam('&p='), 'p');
    assert.equal(normalizePageParam('  ?offset '), 'offset');
    assert.equal(normalizePageParam(''), '');
    assert.equal(normalizePageParam('&&'), '');
    assert.equal(normalizePageParam(null), '');
  });

  await t.test('no toca nombres que ya son correctos', () => {
    assert.equal(normalizePageParam('page'), 'page');
    assert.equal(normalizePageParam('pagina_num'), 'pagina_num');
  });
});

test('hasExtension — barra final tras la extensión', async t => {
  // Bug real: muchos CDN sirven el fichero como ".../video.mp4/". El
  // endsWith('.mp4') daba falso y se descartaban ficheros perfectamente
  // validos, con la fase 2 devolviendo 0 resultados sin ningun error.
  await t.test('acepta la extensión con barra final', () => {
    assert.equal(
      hasExtension('https://s.com/get_file/141/abc/17204000/17204582/17204582.mp4/', ['mp4']),
      true
    );
    assert.equal(hasExtension('https://s.com/media/clip.mp4//', ['mp4']), true);
  });

  await t.test('sigue rechazando la extensión en medio del nombre', () => {
    assert.equal(hasExtension('https://s.com/x.mp4.html', ['mp4']), false);
    assert.equal(hasExtension('https://s.com/x.mp4.html/', ['mp4']), false);
    assert.equal(hasExtension('https://s.com/app.ts.backup/', ['ts']), false);
  });
});

test('applySearchTerm — marcador {q}', async t => {
  await t.test('sustituye el término en la ruta y en la query', () => {
    // El marcador puede caer en tres sitios distintos de la URL, y cada uno
    // se dio en un sitio real: al final de la ruta, dentro de la query, y en
    // mitad de una ruta con más segmentos detrás.
    assert.equal(
      applySearchTerm('https://ejemplo.com/search/{q}/', 'argentina'),
      'https://ejemplo.com/search/argentina/'
    );
    assert.equal(
      applySearchTerm('https://ejemplo.org/search?q={q}', 'argentina'),
      'https://ejemplo.org/search?q=argentina'
    );
    assert.equal(
      applySearchTerm('https://ejemplo.net/es/search/a/{q}', 'argentina'),
      'https://ejemplo.net/es/search/a/argentina'
    );
  });

  await t.test('acepta los alias {query} y {termino}', () => {
    assert.equal(applySearchTerm('https://s.com/{query}', 'x'), 'https://s.com/x');
    assert.equal(applySearchTerm('https://s.com/{termino}', 'x'), 'https://s.com/x');
  });

  // Codificar no es solo cosmético: un término con "/" o "?" podría alterar
  // la estructura de la URL y apuntar a una ruta distinta de la prevista.
  await t.test('codifica el término', () => {
    assert.equal(
      applySearchTerm('https://s.com/b/{q}/', 'gatos monos'),
      'https://s.com/b/gatos%20monos/'
    );
    assert.equal(
      applySearchTerm('https://s.com/b/{q}/', '../admin'),
      'https://s.com/b/..%2Fadmin/'
    );
    assert.equal(applySearchTerm('https://s.com/b/{q}/', 'a&b=c'), 'https://s.com/b/a%26b%3Dc/');
  });

  await t.test('convive con {page}', () => {
    const url = applySearchTerm('https://s.com/buscar/{q}/page/{page}', 'gatos');
    assert.equal(url, 'https://s.com/buscar/gatos/page/{page}');
    assert.equal(buildPageUrl(url, '', 3, 1), 'https://s.com/buscar/gatos/page/3');
  });

  await t.test('deja la URL intacta si no hay marcador', () => {
    assert.equal(applySearchTerm('https://s.com/fijo', 'x'), 'https://s.com/fijo');
  });
});

test('hasSearchTemplate', () => {
  assert.equal(hasSearchTemplate('https://s.com/{q}'), true);
  assert.equal(hasSearchTemplate('https://s.com/{QUERY}'), true);
  assert.equal(hasSearchTemplate('https://s.com/?q=fijo'), false);
  assert.equal(hasSearchTemplate(null), false);
});
