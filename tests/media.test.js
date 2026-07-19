'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractSizeBytes, parseSizeText, formatFileSize } = require('../src/lib/media');

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
