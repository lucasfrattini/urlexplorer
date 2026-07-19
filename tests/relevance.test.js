'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectRelevantFiles,
  extractPageTokens,
  looksLikeSample,
  sharesIdentity,
  sizeLooksInconsistent,
} = require('../src/lib/relevance');

/**
 * Los casos de abajo reproducen, con dominios ficticios, las cuatro
 * estructuras reales que motivaron este módulo:
 *
 *   A) ficha con id numérico y el fichero bajo ese mismo id, más un anuncio
 *      de un dominio ajeno colado en el reproductor;
 *   B) página sin id en la URL de la que solo cuelgan clips de vista previa
 *      de OTROS vídeos;
 *   C) ficha con id opaco alfanumérico y varios ficheros legítimos suyos;
 *   D) ficha con id numérico y su fichero con el id repetido.
 */

test('extractPageTokens', async t => {
  await t.test('coge los ids numéricos largos de la ruta', () => {
    const t1 = extractPageTokens('https://ejemplo.com/video/111165/titulo-del-video/');
    assert.equal(t1.has('111165'), true);
  });

  await t.test('coge los ids opacos alfanuméricos', () => {
    const t2 = extractPageTokens('https://ejemplo.com/a/EJ73kA9i');
    assert.equal(t2.has('EJ73kA9i'), true);
  });

  // Sin esto, "videos" o "search" contarían como identificador y cualquier
  // fichero del sitio pasaría por bueno.
  await t.test('descarta las palabras corrientes de la ruta', () => {
    const t3 = extractPageTokens('https://ejemplo.com/videos/search/titulo/');
    assert.equal(t3.has('videos'), false);
    assert.equal(t3.has('search'), false);
    assert.equal(t3.has('titulo'), false);
  });

  await t.test('una URL sin id no da ningún token', () => {
    assert.equal(extractPageTokens('https://ejemplo.com/').size, 0);
    assert.equal(extractPageTokens('no-es-una-url').size, 0);
  });
});

test('looksLikeSample', async t => {
  await t.test('reconoce las marcas de vista previa', () => {
    assert.equal(looksLikeSample('https://ejemplo.com/f/111165_preview.mp4'), true);
    assert.equal(looksLikeSample('https://ejemplo.com/f/360P_360K_44167_fb.mp4'), true);
    assert.equal(looksLikeSample('https://ejemplo.com/sample/x.mp4'), true);
    assert.equal(looksLikeSample('https://ejemplo.com/f/trailer-x.mp4'), true);
  });

  await t.test('no marca un fichero normal', () => {
    assert.equal(looksLikeSample('https://ejemplo.com/f/111165.mp4'), false);
    assert.equal(looksLikeSample('https://cdn.ejemplo.com/8571/EJ73kA9i/PJug5_720p.mp4'), false);
  });
});

test('sharesIdentity', () => {
  const tokens = extractPageTokens('https://ejemplo.com/video/111165/titulo/');
  assert.equal(sharesIdentity('https://ejemplo.com/get/111000/111165/111165.mp4', tokens), true);
  assert.equal(sharesIdentity('https://cdn-ajeno.com/abc123.mp4', tokens), false);
});

test('selectRelevantFiles — caso A: fichero real junto a un anuncio', async t => {
  const ficha = 'https://ejemplo.com/video/111165/titulo-del-video/';
  const candidatos = [
    'https://ejemplo.com/get_file/3/hash/111000/111165/111165.mp4/?token=abc',
    'https://cdn-publicidad.example.net/7860680a39e8_360p.mp4',
  ];

  await t.test('se queda con el fichero de la ficha y descarta el anuncio', () => {
    const { files, discarded } = selectRelevantFiles(candidatos, ficha);
    assert.equal(files.length, 1);
    assert.equal(files[0].url.includes('111165.mp4'), true);
    assert.equal(files[0].suspect, false);
    assert.equal(discarded.length, 1);
    assert.match(discarded[0].reason, /anuncio|relacionado/);
  });
});

test('selectRelevantFiles — caso B: solo vistas previas ajenas', async t => {
  // Es el caso que entregaba un clip de cinco segundos etiquetado "18:53".
  const pagina = 'https://ejemplo.com/';
  const candidatos = ['https://cdn.ejemplo.com/videos/2023/441678691/360P_360K_441678691_fb.mp4'];

  await t.test('NO los da por buenos: los devuelve marcados', () => {
    const { files } = selectRelevantFiles(candidatos, pagina);
    assert.equal(files.length, 1);
    assert.equal(files[0].suspect, true, 'debe venir marcado como dudoso');
    assert.ok(files[0].reason);
  });

  // Devolver cero dejaría al usuario sin resultados y sin saber por qué;
  // devolverlos como buenos sería mentir. Marcarlos es lo único honesto.
  await t.test('tampoco los descarta en silencio', () => {
    const { files, discarded } = selectRelevantFiles(candidatos, pagina);
    assert.equal(files.length, 1);
    assert.equal(discarded.length, 0);
  });
});

test('selectRelevantFiles — caso C: varios ficheros legítimos de la misma ficha', () => {
  const ficha = 'https://ejemplo.com/a/EJ73kA9i';
  const candidatos = [
    'https://v19.ejemplo.com/8571/EJ73kA9i/PJug53LQ_720p.mp4',
    'https://v19.ejemplo.com/8571/EJ73kA9i/LK0rByUW_720p.mp4',
    'https://v19.ejemplo.com/8571/EJ73kA9i/1VTEp7YA_720p.mp4',
  ];

  const { files, discarded } = selectRelevantFiles(candidatos, ficha);
  assert.equal(files.length, 3, 'un álbum legítimo no debe perder ficheros');
  assert.equal(
    files.every(f => f.suspect === false),
    true
  );
  assert.equal(discarded.length, 0);
});

test('selectRelevantFiles — caso D: preview del PROPIO vídeo', () => {
  // Comparte identificador, así que la identidad sola no basta: hace falta
  // además la marca de muestra para demotarlo.
  const ficha = 'https://ejemplo.com/video/111165/titulo/';
  const { files } = selectRelevantFiles(
    [
      'https://ejemplo.com/get/111000/111165/111165.mp4',
      'https://ejemplo.com/get/111000/111165/111165_preview.mp4',
    ],
    ficha
  );

  assert.equal(files.length, 1);
  assert.equal(files[0].url.endsWith('111165.mp4'), true);
});

// Sin identificador con el que comparar, marcar TODO como dudoso sería
// pasarse: hay fichas que cuelgan de rutas cortas y cuyos ficheros son
// legítimos. Se prefiere dejar pasar un intruso a marcar como sospechosos
// los resultados buenos de un sitio entero.
test('selectRelevantFiles — ficha sin identificador extraíble', async t => {
  await t.test('confía en los ficheros sin marca de muestra', () => {
    const { files } = selectRelevantFiles(
      ['https://ejemplo.com/media/video-1.mp4'],
      'https://ejemplo.com/a/1'
    );
    assert.equal(files.length, 1);
    assert.equal(files[0].suspect, false);
  });

  await t.test('pero sigue marcando las vistas previas', () => {
    const { files } = selectRelevantFiles(
      ['https://ejemplo.com/media/video-1_preview.mp4'],
      'https://ejemplo.com/a/1'
    );
    assert.equal(files[0].suspect, true);
  });
});

test('selectRelevantFiles — sin candidatos no inventa nada', () => {
  const { files, discarded } = selectRelevantFiles([], 'https://ejemplo.com/video/1/');
  assert.deepEqual(files, []);
  assert.deepEqual(discarded, []);
});

test('sizeLooksInconsistent', async t => {
  const MB = 1024 ** 2;

  // 20 minutos que pesan 300 KB no son un vídeo de 20 minutos.
  await t.test('detecta el clip disfrazado de vídeo largo', () => {
    assert.equal(sizeLooksInconsistent(1209, 300 * 1024), true);
  });

  await t.test('acepta un vídeo largo de peso normal', () => {
    assert.equal(sizeLooksInconsistent(1209, 250 * MB), false);
  });

  // El umbral va bajo a propósito: un vídeo legítimo de mala calidad no debe
  // marcarse. 10 min a ~130 kbps son unos 10 MB y deben pasar.
  await t.test('no marca un vídeo legítimo de baja calidad', () => {
    assert.equal(sizeLooksInconsistent(600, 10 * MB), false);
  });

  await t.test('no opina de los vídeos cortos ni sin datos', () => {
    assert.equal(sizeLooksInconsistent(30, 1024), false);
    assert.equal(sizeLooksInconsistent(null, 1024), false);
    assert.equal(sizeLooksInconsistent(600, null), false);
  });
});
