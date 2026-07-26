'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Lógica pura de la vista Vídeo (multi-URL, duplicados, filtros).
 *
 * Igual que `explorer-options.test.js`: es la parte que puede equivocarse EN
 * SILENCIO —plegar un vídeo bajo el representante que no es, o dejarlo fuera
 * de la lista visible— así que se prueba aparte del DOM.
 *
 * El módulo es ESM y los tests son CommonJS: se carga con import() dinámico.
 */
const MODULO = pathToFileURL(
  path.join(__dirname, '..', 'public', 'js', 'views', 'videoOptions.js')
).href;

let opciones;

test.before(async () => {
  opciones = await import(MODULO);
});

test('limpiarUrls recorta, descarta vacías y admite un string suelto', () => {
  const { limpiarUrls } = opciones;

  assert.deepStrictEqual(
    limpiarUrls([' https://ejemplo.com/a ', '', '  ', 'https://ejemplo.com/b']),
    ['https://ejemplo.com/a', 'https://ejemplo.com/b']
  );
  assert.deepStrictEqual(limpiarUrls('https://ejemplo.com/x'), ['https://ejemplo.com/x']);
  assert.deepStrictEqual(limpiarUrls([]), []);
  assert.deepStrictEqual(limpiarUrls(null), []);
});

test('construirParamsVideo SIEMPRE manda `urls` como array, incluso con una sola dirección', () => {
  const { construirParamsVideo } = opciones;

  const params = construirParamsVideo(['https://ejemplo.com/a'], {
    getMetadata: true,
    getThumbnails: false,
    useJavaScript: true,
  });

  assert.deepStrictEqual(params, {
    urls: ['https://ejemplo.com/a'],
    getMetadata: true,
    getThumbnails: false,
    useJavaScript: true,
  });
});

test('construirParamsVideo admite varias direcciones y recorta las vacías', () => {
  const { construirParamsVideo } = opciones;

  const params = construirParamsVideo([' https://ejemplo.com/a ', '', 'https://ejemplo.com/b']);
  assert.deepStrictEqual(params.urls, ['https://ejemplo.com/a', 'https://ejemplo.com/b']);
  // Los tres interruptores tienen un valor por defecto sensato
  assert.strictEqual(params.getMetadata, false);
  assert.strictEqual(params.getThumbnails, false);
  assert.strictEqual(params.useJavaScript, true);
});

test('indexarGrupos arma los dos mapas a partir del shape del servidor', () => {
  const { indexarGrupos } = opciones;

  const { grupos, duplicadoDe } = indexarGrupos([
    {
      representante: 'https://ejemplo.com/a.mp4',
      miembros: ['https://ejemplo.com/a.mp4', 'https://mirror.ejemplo.com/a.mp4'],
      motivos: [],
    },
  ]);

  assert.strictEqual(grupos.size, 1);
  assert.strictEqual(
    duplicadoDe.get('https://mirror.ejemplo.com/a.mp4'),
    'https://ejemplo.com/a.mp4'
  );
  // El propio representante NO se mapea a sí mismo: no es "duplicado de" nada
  assert.strictEqual(duplicadoDe.has('https://ejemplo.com/a.mp4'), false);
});

test('indexarGrupos ignora entradas mal formadas sin tirar el resto', () => {
  const { indexarGrupos } = opciones;

  const { grupos, duplicadoDe } = indexarGrupos([
    { representante: null, miembros: ['x'] },
    { representante: 'https://ejemplo.com/b.mp4', miembros: 'no-es-array' },
    {
      representante: 'https://ejemplo.com/c.mp4',
      miembros: ['https://ejemplo.com/c.mp4', 'https://ejemplo.com/d.mp4'],
    },
  ]);

  assert.strictEqual(grupos.size, 1);
  assert.strictEqual(duplicadoDe.get('https://ejemplo.com/d.mp4'), 'https://ejemplo.com/c.mp4');
});

test('indexarGrupos con groups vacío o ausente no falla', () => {
  const { indexarGrupos } = opciones;

  assert.strictEqual(indexarGrupos([]).grupos.size, 0);
  assert.strictEqual(indexarGrupos(undefined).grupos.size, 0);
});

test('miembrosPlegados excluye al representante y a los sacados a mano', () => {
  const { indexarGrupos, miembrosPlegados } = opciones;
  const { grupos } = indexarGrupos([
    {
      representante: 'https://ejemplo.com/a.mp4',
      miembros: [
        'https://ejemplo.com/a.mp4',
        'https://m1.ejemplo.com/a.mp4',
        'https://m2.ejemplo.com/a.mp4',
      ],
    },
  ]);

  const desagrupados = new Set(['https://m2.ejemplo.com/a.mp4']);
  assert.deepStrictEqual(miembrosPlegados(grupos, 'https://ejemplo.com/a.mp4', desagrupados), [
    'https://m1.ejemplo.com/a.mp4',
  ]);
});

test('miembrosPlegados devuelve vacío si el representante no tiene grupo', () => {
  const { indexarGrupos, miembrosPlegados } = opciones;
  const { grupos } = indexarGrupos([]);
  assert.deepStrictEqual(
    miembrosPlegados(grupos, 'https://ejemplo.com/sin-grupo.mp4', new Set()),
    []
  );
});

test('filtrarVideos oculta lo quitado a mano y lo plegado bajo un grupo', () => {
  const { filtrarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/a.mp4', type: 'mp4' },
    { url: 'https://mirror.ejemplo.com/a.mp4', type: 'mp4' },
    { url: 'https://ejemplo.com/b.mp4', type: 'mp4' },
  ];

  const duplicadoDe = new Map([['https://mirror.ejemplo.com/a.mp4', 'https://ejemplo.com/a.mp4']]);
  const ocultos = new Set(['https://ejemplo.com/b.mp4']);

  const visibles = filtrarVideos(videos, {
    ocultos,
    duplicadoDe,
    desagrupados: new Set(),
    plegarDuplicados: true,
  });

  assert.deepStrictEqual(
    visibles.map(v => v.url),
    ['https://ejemplo.com/a.mp4']
  );
});

test('filtrarVideos: "no es duplicado" devuelve el miembro a la lista aunque siga plegando', () => {
  const { filtrarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/a.mp4', type: 'mp4' },
    { url: 'https://mirror.ejemplo.com/a.mp4', type: 'mp4' },
  ];
  const duplicadoDe = new Map([['https://mirror.ejemplo.com/a.mp4', 'https://ejemplo.com/a.mp4']]);

  const visibles = filtrarVideos(videos, {
    ocultos: new Set(),
    duplicadoDe,
    desagrupados: new Set(['https://mirror.ejemplo.com/a.mp4']),
    plegarDuplicados: true,
  });

  assert.deepStrictEqual(visibles.map(v => v.url).sort(), [
    'https://ejemplo.com/a.mp4',
    'https://mirror.ejemplo.com/a.mp4',
  ]);
});

test('filtrarVideos: con el interruptor apagado no se pliega ningún duplicado', () => {
  const { filtrarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/a.mp4', type: 'mp4' },
    { url: 'https://mirror.ejemplo.com/a.mp4', type: 'mp4' },
  ];
  const duplicadoDe = new Map([['https://mirror.ejemplo.com/a.mp4', 'https://ejemplo.com/a.mp4']]);

  const visibles = filtrarVideos(videos, {
    ocultos: new Set(),
    duplicadoDe,
    desagrupados: new Set(),
    plegarDuplicados: false,
  });

  assert.strictEqual(visibles.length, 2);
});

test('filtrarVideos filtra por tipo de archivo', () => {
  const { filtrarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/a.mp4', type: 'mp4' },
    { url: 'https://ejemplo.com/b.m3u8', type: 'hls' },
  ];

  const visibles = filtrarVideos(videos, { ocultos: new Set(), activeType: 'hls' });
  assert.deepStrictEqual(
    visibles.map(v => v.url),
    ['https://ejemplo.com/b.m3u8']
  );
});

test('filtrarVideos filtra por término de búsqueda, sin distinguir mayúsculas', () => {
  const { filtrarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/reportaje.mp4', type: 'mp4' },
    { url: 'https://ejemplo.com/entrevista.mp4', type: 'mp4' },
  ];

  const visibles = filtrarVideos(videos, { ocultos: new Set(), needle: 'REPORTAJE' });
  assert.deepStrictEqual(
    visibles.map(v => v.url),
    ['https://ejemplo.com/reportaje.mp4']
  );
});

test('segundosDe usa durationSeconds si es finito, si no parsea el reloj', () => {
  const { segundosDe } = opciones;

  assert.strictEqual(segundosDe({ durationSeconds: 90, duration: '10:00' }), 90);
  assert.strictEqual(segundosDe({ duration: '1:02:03' }), 3723);
  assert.strictEqual(segundosDe({ duration: '02:03' }), 123);
  assert.strictEqual(segundosDe({ duration: 'no-es-reloj' }), null);
  assert.strictEqual(segundosDe({}), null);
  assert.strictEqual(segundosDe(null), null);
});

test('bytesDe usa sizeBytes si es finito, si no null', () => {
  const { bytesDe } = opciones;

  assert.strictEqual(bytesDe({ sizeBytes: 1024 }), 1024);
  assert.strictEqual(bytesDe({ size: '1 MB' }), null); // no se parsea el texto, solo sizeBytes
  assert.strictEqual(bytesDe({}), null);
  assert.strictEqual(bytesDe(null), null);
});

test('ordenarVideos con campo "orden" respeta el orden de entrada', () => {
  const { ordenarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/c.mp4', duration: '00:03' },
    { url: 'https://ejemplo.com/a.mp4', duration: '00:01' },
    { url: 'https://ejemplo.com/b.mp4', duration: '00:02' },
  ];

  const resultado = ordenarVideos(videos, { campo: 'orden', direccion: 'asc' });
  assert.deepStrictEqual(
    resultado.map(v => v.url),
    videos.map(v => v.url)
  );
  // Pura: no muta el array de entrada
  assert.notStrictEqual(resultado, videos);
});

test('ordenarVideos por url en ambos sentidos, sin distinguir mayúsculas', () => {
  const { ordenarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/B.mp4' },
    { url: 'https://ejemplo.com/a.mp4' },
    { url: 'https://ejemplo.com/c.mp4' },
  ];

  assert.deepStrictEqual(
    ordenarVideos(videos, { campo: 'url', direccion: 'asc' }).map(v => v.url),
    ['https://ejemplo.com/a.mp4', 'https://ejemplo.com/B.mp4', 'https://ejemplo.com/c.mp4']
  );
  assert.deepStrictEqual(
    ordenarVideos(videos, { campo: 'url', direccion: 'desc' }).map(v => v.url),
    ['https://ejemplo.com/c.mp4', 'https://ejemplo.com/B.mp4', 'https://ejemplo.com/a.mp4']
  );
});

test('ordenarVideos por duración y por peso deja SIEMPRE al final los que no tienen el dato', () => {
  const { ordenarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/sin-duracion.mp4', size: '1 MB', sizeBytes: 1_000_000 },
    { url: 'https://ejemplo.com/corto.mp4', duration: '00:10', sizeBytes: 500_000 },
    { url: 'https://ejemplo.com/largo.mp4', duration: '10:00', sizeBytes: 2_000_000 },
  ];

  const asc = ordenarVideos(videos, { campo: 'duracion', direccion: 'asc' });
  assert.deepStrictEqual(
    asc.map(v => v.url),
    [
      'https://ejemplo.com/corto.mp4',
      'https://ejemplo.com/largo.mp4',
      'https://ejemplo.com/sin-duracion.mp4', // sin dato: al final aunque sea ascendente
    ]
  );

  const desc = ordenarVideos(videos, { campo: 'duracion', direccion: 'desc' });
  assert.deepStrictEqual(
    desc.map(v => v.url),
    [
      'https://ejemplo.com/largo.mp4',
      'https://ejemplo.com/corto.mp4',
      'https://ejemplo.com/sin-duracion.mp4', // sin dato: al final aunque sea descendente
    ]
  );

  const porPesoDesc = ordenarVideos(
    [...videos, { url: 'https://ejemplo.com/sin-peso.mp4', duration: '00:05' }],
    { campo: 'peso', direccion: 'desc' }
  );
  assert.strictEqual(porPesoDesc.at(-1).url, 'https://ejemplo.com/sin-peso.mp4');
});

test('filtrarVideos: el rango de duración/peso recorta lo que tiene el dato', () => {
  const { filtrarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/corto.mp4', duration: '00:10' },
    { url: 'https://ejemplo.com/largo.mp4', duration: '10:00' },
  ];

  const visibles = filtrarVideos(videos, {
    ocultos: new Set(),
    rangoDuracion: { min: 0, max: 60 },
  });
  assert.deepStrictEqual(
    visibles.map(v => v.url),
    ['https://ejemplo.com/corto.mp4']
  );
});

test('filtrarVideos: un vídeo sin dato sobrevive al rango, pero lo saca el interruptor', () => {
  const { filtrarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/corto.mp4', duration: '00:10', sizeBytes: 100 },
    { url: 'https://ejemplo.com/sin-duracion.mp4', sizeBytes: 100 },
  ];

  const conRangoSinInterruptor = filtrarVideos(videos, {
    ocultos: new Set(),
    rangoDuracion: { min: 0, max: 60 },
    ocultarSinDuracion: false,
  });
  // El rango NO recorta el que no tiene dato: sigue presente
  assert.deepStrictEqual(conRangoSinInterruptor.map(v => v.url).sort(), [
    'https://ejemplo.com/corto.mp4',
    'https://ejemplo.com/sin-duracion.mp4',
  ]);

  const conInterruptor = filtrarVideos(videos, {
    ocultos: new Set(),
    rangoDuracion: { min: 0, max: 60 },
    ocultarSinDuracion: true,
  });
  // El interruptor sí lo saca
  assert.deepStrictEqual(
    conInterruptor.map(v => v.url),
    ['https://ejemplo.com/corto.mp4']
  );
});

test('filtrarVideos: mismo comportamiento con rango/interruptor de peso', () => {
  const { filtrarVideos } = opciones;

  const videos = [
    { url: 'https://ejemplo.com/liviano.mp4', sizeBytes: 100 },
    { url: 'https://ejemplo.com/sin-peso.mp4', duration: '00:10' },
  ];

  const conRangoSinInterruptor = filtrarVideos(videos, {
    ocultos: new Set(),
    rangoPeso: { min: 0, max: 1000 },
    ocultarSinPeso: false,
  });
  assert.deepStrictEqual(conRangoSinInterruptor.map(v => v.url).sort(), [
    'https://ejemplo.com/liviano.mp4',
    'https://ejemplo.com/sin-peso.mp4',
  ]);

  const conInterruptor = filtrarVideos(videos, {
    ocultos: new Set(),
    rangoPeso: { min: 0, max: 1000 },
    ocultarSinPeso: true,
  });
  assert.deepStrictEqual(
    conInterruptor.map(v => v.url),
    ['https://ejemplo.com/liviano.mp4']
  );
});
