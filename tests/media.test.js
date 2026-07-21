'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractSizeBytes,
  parseSizeText,
  formatFileSize,
  extractFileThumbnails,
  extractFileDurations,
} = require('../src/lib/media');

const KB = 1024;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

test('parseSizeText', async t => {
  await t.test('lee las unidades habituales', () => {
    assert.equal(parseSizeText('245 MB'), 245 * MB);
    assert.equal(parseSizeText('1 GB'), GB);
    assert.equal(parseSizeText('180 KB'), 180 * KB);
    assert.equal(parseSizeText('512 bytes'), 512);
  });

  await t.test('acepta decimales con punto y con coma', () => {
    assert.equal(parseSizeText('1.5 GB'), Math.round(1.5 * GB));
    assert.equal(parseSizeText('1,5 GB'), Math.round(1.5 * GB));
  });

  await t.test('tolera el espacio y las mayúsculas', () => {
    assert.equal(parseSizeText('245MB'), 245 * MB);
    assert.equal(parseSizeText('245 mb'), 245 * MB);
    assert.equal(parseSizeText('245 MiB'), 245 * MB);
  });

  // La unidad es obligatoria: sin ella, cualquier número suelto de la página
  // (una resolución, un contador de visitas) pasaría por un tamaño.
  await t.test('exige unidad y descarta lo que no lo es', () => {
    assert.equal(parseSizeText('1080p'), null);
    assert.equal(parseSizeText('245'), null);
    assert.equal(parseSizeText('sin datos'), null);
    assert.equal(parseSizeText(''), null);
    assert.equal(parseSizeText(null), null);
  });
});

test('extractSizeBytes', async t => {
  await t.test('lee el metadato declarado', () => {
    assert.equal(
      extractSizeBytes('<html><head><meta itemprop="contentSize" content="245 MB"></head></html>'),
      245 * MB
    );
  });

  await t.test('lee el JSON-LD, tanto en bytes como con unidad', () => {
    const enBytes = `<script type="application/ld+json">
      {"@type":"VideoObject","contentSize":123456}
    </script>`;
    assert.equal(extractSizeBytes(enBytes), 123456);

    const conUnidad = `<script type="application/ld+json">
      {"@type":"VideoObject","contentSize":"1.5 GB"}
    </script>`;
    assert.equal(extractSizeBytes(conUnidad), Math.round(1.5 * GB));
  });

  await t.test('lee el elemento que lo muestra en pantalla', () => {
    assert.equal(extractSizeBytes('<div class="video-size">245 MB</div>'), 245 * MB);
    assert.equal(extractSizeBytes('<span class="filesize">1,2 GB</span>'), Math.round(1.2 * GB));
  });

  await t.test('lee una etiqueta explícita en el texto', () => {
    assert.equal(extractSizeBytes('<p>Tamaño: 350 MB</p>'), 350 * MB);
    assert.equal(extractSizeBytes('<p>Size: 350 MB</p>'), 350 * MB);
  });

  // Barrer el texto entero buscando "número + unidad" traería el tamaño de un
  // anuncio o de un banner del pie. Sin marca ni etiqueta, no se adivina.
  await t.test('no se inventa un tamaño de cualquier texto suelto', () => {
    assert.equal(extractSizeBytes('<p>Descarga gratis, hasta 500 MB al mes</p>'), null);
    assert.equal(extractSizeBytes('<html><body><p>Vídeo en 1080p</p></body></html>'), null);
    assert.equal(extractSizeBytes(''), null);
    assert.equal(extractSizeBytes(null), null);
  });

  await t.test('prefiere el metadato al texto de la página', () => {
    const html = `<html><head><meta itemprop="contentSize" content="700 MB"></head>
      <body><div class="size">3 KB</div></body></html>`;
    assert.equal(extractSizeBytes(html), 700 * MB);
  });
});

test('formatFileSize sigue tratando el 0 como un tamaño válido', () => {
  assert.equal(formatFileSize(0), '0 Bytes');
  assert.equal(formatFileSize(null), null);
  assert.equal(formatFileSize(245 * MB), '245.0 MB');
});

/**
 * Estas dos funciones existen por un fallo concreto: una ficha con VARIOS
 * vídeos (un álbum) le estampaba a todos la MISMA miniatura y la MISMA
 * duración —las de la página entera—, y eso los hacía parecer duplicados sin
 * serlo. Aquí se fija que cada `<video poster>` reparte SU dato solo a su
 * propio `src`/`<source>`, nunca al de un vídeo vecino.
 */
test('extractFileThumbnails', async t => {
  const base = 'https://s.example.com/a/x';

  await t.test('asocia el poster de cada <video> con su propio fichero', () => {
    const html = `
      <video poster="/img/uno.jpg"><source src="/media/uno.mp4"></video>
      <video poster="/img/dos.jpg"><source src="/media/dos.mp4"></video>`;
    const mapa = extractFileThumbnails(html, base);
    assert.equal(
      mapa.get('https://s.example.com/media/uno.mp4'),
      'https://s.example.com/img/uno.jpg'
    );
    assert.equal(
      mapa.get('https://s.example.com/media/dos.mp4'),
      'https://s.example.com/img/dos.jpg'
    );
  });

  await t.test('varias calidades del mismo vídeo comparten poster', () => {
    const html = `
      <video poster="/img/uno.jpg">
        <source src="/media/uno_720p.mp4">
        <source src="/media/uno_1080p.mp4">
      </video>`;
    const mapa = extractFileThumbnails(html, base);
    assert.equal(mapa.size, 2);
    assert.ok([...mapa.values()].every(v => v === 'https://s.example.com/img/uno.jpg'));
  });

  await t.test('un fichero sin <video poster> propio no aparece en el mapa', () => {
    const html = `<a href="/media/suelto.mp4">descargar</a>`;
    const mapa = extractFileThumbnails(html, base);
    assert.equal(mapa.size, 0);
  });

  await t.test('sin HTML devuelve un mapa vacío', () => {
    assert.equal(extractFileThumbnails('', base).size, 0);
    assert.equal(extractFileThumbnails(null, base).size, 0);
  });
});

test('extractFileDurations', async t => {
  const base = 'https://s.example.com/a/x';

  await t.test('lee la insignia hermana en el contenedor inmediato de cada vídeo', () => {
    const html = `
      <div class="item">
        <video><source src="/media/uno.mp4"></video>
        <span class="duration">00:27</span>
      </div>
      <div class="item">
        <video><source src="/media/dos.mp4"></video>
        <span class="duration">00:03</span>
      </div>`;
    const mapa = extractFileDurations(html, base);
    assert.equal(mapa.get('https://s.example.com/media/uno.mp4'), 27);
    assert.equal(mapa.get('https://s.example.com/media/dos.mp4'), 3);
  });

  // Subir más de un nivel arriesga cazar la insignia de un vídeo vecino: sin
  // ella en el padre inmediato, mejor sin dato que con el de otro.
  await t.test('no sube más de un nivel a buscar la insignia', () => {
    const html = `
      <div class="lista">
        <span class="duration">00:99</span>
        <div class="item"><video><source src="/media/sola.mp4"></video></div>
      </div>`;
    const mapa = extractFileDurations(html, base);
    assert.equal(mapa.has('https://s.example.com/media/sola.mp4'), false);
  });

  await t.test('sin HTML devuelve un mapa vacío', () => {
    assert.equal(extractFileDurations('', base).size, 0);
    assert.equal(extractFileDurations(null, base).size, 0);
  });
});
