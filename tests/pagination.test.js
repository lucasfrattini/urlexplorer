'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveMode, ESTRATEGIAS } = require('../src/services/pagination');

/** Contexto mínimo con páginas simuladas: url -> lista de enlaces. */
function contexto(paginas, extra = {}) {
  const pedidas = [];
  return {
    pedidas,
    ctx: {
      searchUrl: 'https://ejemplo.com/buscar',
      pageParam: '',
      startPage: 1,
      endPage: 3,
      fetchPage: async url => {
        pedidas.push(url);
        return paginas[url] === undefined ? null : '<html></html>';
      },
      extract: (_html, baseUrl) => paginas[baseUrl] || [],
      ...extra,
    },
  };
}

test('resolveMode', async t => {
  await t.test('scroll manda sobre todo lo demás', () => {
    assert.equal(
      resolveMode({ paginationMode: 'scroll', searchUrl: 'https://e.com/{page}', pageParam: 'p' }),
      'scroll'
    );
  });

  // Si están las dos, la plantilla es lo que el usuario escribió a propósito
  // dentro de la URL; el parámetro puede ser un resto de otra configuración.
  await t.test('la plantilla manda sobre el parámetro', () => {
    assert.equal(
      resolveMode({ searchUrl: 'https://e.com/p/{page}', pageParam: 'page' }),
      'plantilla'
    );
  });

  await t.test('el parámetro cuando no hay plantilla', () => {
    assert.equal(resolveMode({ searchUrl: 'https://e.com/b', pageParam: 'page' }), 'parametro');
  });

  await t.test('sin nada, una sola página', () => {
    assert.equal(resolveMode({ searchUrl: 'https://e.com/b', pageParam: '' }), 'unica');
    assert.equal(resolveMode({ searchUrl: 'https://e.com/b', pageParam: '   ' }), 'unica');
  });
});

test('estrategia única', async t => {
  await t.test('descarga una sola página', async () => {
    const { ctx, pedidas } = contexto({
      'https://ejemplo.com/buscar': ['https://ejemplo.com/v/1', 'https://ejemplo.com/v/2'],
    });

    const resultado = await ESTRATEGIAS.unica(ctx);

    assert.equal(pedidas.length, 1);
    assert.equal(resultado.pagesScraped, 1);
    assert.deepEqual(resultado.links, ['https://ejemplo.com/v/1', 'https://ejemplo.com/v/2']);
  });

  await t.test('una página que no responde no cuenta como recorrida', async () => {
    const { ctx } = contexto({});
    const resultado = await ESTRATEGIAS.unica(ctx);
    assert.equal(resultado.pagesScraped, 0);
    assert.deepEqual(resultado.links, []);
  });
});

test('estrategia por URL', async t => {
  await t.test('recorre el rango y acumula sin repetir', async () => {
    const { ctx, pedidas } = contexto(
      {
        'https://ejemplo.com/buscar': ['https://ejemplo.com/v/1'],
        'https://ejemplo.com/buscar?page=2': ['https://ejemplo.com/v/2'],
        'https://ejemplo.com/buscar?page=3': ['https://ejemplo.com/v/2', 'https://ejemplo.com/v/3'],
      },
      { pageParam: 'page' }
    );

    const resultado = await ESTRATEGIAS.parametro(ctx);

    assert.equal(pedidas.length, 3);
    assert.equal(resultado.pagesScraped, 3);
    // /v/2 sale en dos páginas y aparece una sola vez
    assert.deepEqual(resultado.links, [
      'https://ejemplo.com/v/1',
      'https://ejemplo.com/v/2',
      'https://ejemplo.com/v/3',
    ]);
  });

  // Es la condición de parada que hace que el recorrido sea secuencial: no se
  // puede saber si hay página 3 sin haber visto la 2.
  await t.test('una página sin resultados corta la paginación', async () => {
    const { ctx, pedidas } = contexto(
      {
        'https://ejemplo.com/buscar': ['https://ejemplo.com/v/1'],
        'https://ejemplo.com/buscar?page=2': [],
        'https://ejemplo.com/buscar?page=3': ['https://ejemplo.com/v/3'],
      },
      { pageParam: 'page' }
    );

    const resultado = await ESTRATEGIAS.parametro(ctx);

    assert.equal(pedidas.length, 2, 'no debería haber pedido la página 3');
    assert.deepEqual(resultado.links, ['https://ejemplo.com/v/1']);
  });

  await t.test('respeta la cancelación', async () => {
    const controller = new AbortController();
    controller.abort();
    const { ctx, pedidas } = contexto(
      { 'https://ejemplo.com/buscar': ['https://ejemplo.com/v/1'] },
      { pageParam: 'page', signal: controller.signal }
    );

    const resultado = await ESTRATEGIAS.parametro(ctx);
    assert.equal(pedidas.length, 0);
    assert.deepEqual(resultado.links, []);
  });

  await t.test('informa del progreso página a página', async () => {
    const progreso = [];
    const { ctx } = contexto(
      {
        'https://ejemplo.com/buscar': ['https://ejemplo.com/v/1'],
        'https://ejemplo.com/buscar?page=2': ['https://ejemplo.com/v/2'],
      },
      { pageParam: 'page', endPage: 2, onProgress: p => progreso.push(p) }
    );

    await ESTRATEGIAS.parametro(ctx);

    assert.equal(progreso.length, 2);
    assert.equal(progreso[0].currentPage, 1);
    assert.equal(progreso[1].totalLinks, 2);
  });
});
