'use strict';

process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { crawl } = require('../src/services/scraper');
const { RegistroDeTrabajos } = require('../src/services/jobs');

/**
 * Frenar y continuar.
 *
 * Frenar NO es cancelar: la fase 2 deja de coger enlaces nuevos, los que ya
 * estaban en vuelo terminan, y el crawl cierra normalmente —agrupando
 * duplicados incluido— con lo que lleve. Lo que falta se guarda para seguir.
 */

async function sitioConFichas(n) {
  const pedidas = [];
  const server = http.createServer((req, res) => {
    pedidas.push(req.url);

    if (req.url.startsWith('/ficha/')) {
      const id = req.url.split('/').pop();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<html><head><meta itemprop="duration" content="PT10M"></head>
         <body><a href="/media/v${id}.mp4">v</a></body></html>`
      );
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      `<html><body>${Array.from({ length: n }, (_, i) => `<a href="/ficha/${i}">f${i}</a>`).join(
        ''
      )}</body></html>`
    );
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    pedidas,
    cerrar: () => new Promise(r => server.close(r)),
  };
}

test('frenar deja pendientes y AGRUPA lo encontrado hasta ahi', async t => {
  const sitio = await sitioConFichas(12);
  t.after(() => sitio.cerrar());

  // La bandera de pausa se levanta en cuanto empieza la fase 2
  const pausa = { pausado: false };

  const resultado = await crawl(
    {
      searchUrl: sitio.url,
      linkPattern: '/ficha/',
      extensions: ['.mp4'],
      concurrency: 1,
      endPage: 1,
    },
    {
      pausa,
      emit: evento => {
        if (evento.type === 'phase2_progress' && evento.current >= 3) pausa.pausado = true;
      },
    }
  );

  assert.strictEqual(resultado.paused, true, 'deberia venir marcado como frenado');
  assert.ok(resultado.pendientes.length > 0, 'deberian quedar enlaces por mirar');
  assert.ok(resultado.files.length > 0, 'deberia devolver lo encontrado hasta frenar');

  // Lo que se pide: al frenar SE AGRUPAN los duplicados de lo que haya
  assert.ok(Array.isArray(resultado.duplicateGroups), 'la agrupacion debe haberse ejecutado');
  assert.strictEqual(typeof resultado.totalDuplicados, 'number');

  // No se miraron todas las fichas
  const fichasPedidas = sitio.pedidas.filter(u => u.startsWith('/ficha/')).length;
  assert.ok(fichasPedidas < 12, `se pidieron ${fichasPedidas} de 12: no se freno`);
});

test('continuar NO repite la fase 1 ni las fichas ya miradas', async t => {
  const sitio = await sitioConFichas(10);
  t.after(() => sitio.cerrar());

  const pausa = { pausado: false };
  const primera = await crawl(
    {
      searchUrl: sitio.url,
      linkPattern: '/ficha/',
      extensions: ['.mp4'],
      concurrency: 1,
      endPage: 1,
    },
    {
      pausa,
      emit: evento => {
        if (evento.type === 'phase2_progress' && evento.current >= 2) pausa.pausado = true;
      },
    }
  );

  const listadosAntes = sitio.pedidas.filter(u => u === '/').length;
  const fichasAntes = sitio.pedidas.filter(u => u.startsWith('/ficha/')).length;

  // Continuar: se le pasan SOLO los pendientes y lo ya encontrado
  const segunda = await crawl(
    { searchUrl: sitio.url, linkPattern: '/ficha/', extensions: ['.mp4'], concurrency: 1 },
    { linksPrevios: primera.pendientes, detallesPrevios: primera.fileDetails }
  );

  const listadosDespues = sitio.pedidas.filter(u => u === '/').length;
  assert.strictEqual(
    listadosDespues,
    listadosAntes,
    'al continuar no debe volver a recorrerse el listado (fase 1)'
  );

  const fichasTotales = sitio.pedidas.filter(u => u.startsWith('/ficha/')).length;
  assert.ok(
    fichasTotales <= 10,
    `se pidieron ${fichasTotales} fichas de 10: alguna se miro dos veces`
  );
  assert.ok(fichasTotales > fichasAntes, 'al continuar deberia mirar las que faltaban');

  assert.strictEqual(segunda.paused, false);
  assert.strictEqual(segunda.pendientes.length, 0, 'al terminar no debe quedar nada pendiente');
});

test('continuar funde lo de antes con lo nuevo antes de agrupar', async () => {
  /**
   * Si cada tanda se agrupara por su cuenta, dos copias del mismo video
   * encontradas en tandas distintas no se verian nunca como duplicadas. El
   * usuario freno y siguio; para el es UNA exploracion, no dos.
   */
  const previos = [
    { url: 'https://a.com/peli_720p.mp4', durationSeconds: 600, sizeBytes: 400_000_000 },
  ];

  const resultado = await crawl(
    { searchUrl: 'https://ejemplo.com/', extensions: [] },
    { linksPrevios: [], detallesPrevios: previos }
  );

  assert.ok(
    resultado.fileDetails.some(d => d.url === 'https://a.com/peli_720p.mp4'),
    'lo encontrado antes de frenar no puede perderse al continuar'
  );
});

/* ── El registro en memoria ────────────────────────────────────────── */

test('el registro caduca los trabajos que nadie continua', () => {
  const registro = new RegistroDeTrabajos({ ttlMs: 20, maxTrabajos: 10 });
  const id = registro.crear({ pendientes: ['a'] });

  assert.ok(registro.obtener(id), 'recien creado debe estar');

  // Se envejece a mano en vez de esperar: los tests no deben dormir
  registro.trabajos.get(id).tocadoEn = Date.now() - 1000;
  assert.strictEqual(registro.obtener(id), null, 'pasado el TTL debe desaparecer');
});

test('el registro no crece sin limite: tira el mas viejo', () => {
  const registro = new RegistroDeTrabajos({ ttlMs: 60000, maxTrabajos: 3 });
  const ids = Array.from({ length: 5 }, () => registro.crear({}));

  assert.strictEqual(registro.tamano, 3);
  assert.strictEqual(registro.obtener(ids[0]), null, 'el primero deberia haberse tirado');
  assert.ok(registro.obtener(ids[4]), 'el ultimo debe seguir');
});

test('pausar un trabajo que no existe no revienta', () => {
  const registro = new RegistroDeTrabajos({ ttlMs: 60000, maxTrabajos: 3 });
  assert.strictEqual(registro.pausar('no-existe'), false);
});

test('pausar levanta la bandera que mira el crawl', () => {
  const registro = new RegistroDeTrabajos({ ttlMs: 60000, maxTrabajos: 3 });
  const id = registro.crear({});

  assert.strictEqual(registro.obtener(id).pausado, false);
  assert.strictEqual(registro.pausar(id), true);
  assert.strictEqual(registro.obtener(id).pausado, true);
});
