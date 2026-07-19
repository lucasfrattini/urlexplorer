'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { asDocument, esDocumento } = require('../src/lib/document');
const media = require('../src/lib/media');
const { detectLicense } = require('../src/lib/license');
const { extractFilesFromHtml, extractMatchingLinks } = require('../src/services/scraper');

/**
 * Un solo parseo de HTML por ficha.
 *
 * De cada página de detalle salen cuatro datos (ficheros, licencia, duración,
 * tamaño) y cada extractor hacía su propio `cheerio.load()` del MISMO
 * documento. El refactor consiste en cargarlo una vez y repartirlo.
 *
 * Lo que estos tests protegen NO es la velocidad, es que el resultado sea
 * EXACTAMENTE el mismo por los dos caminos: un refactor de eficiencia que
 * cambie un dato en silencio sería mucho peor que el trabajo que ahorra.
 */

const FICHAS = {
  'json-ld': `<html><head><script type="application/ld+json">
      {"@type":"VideoObject","duration":"PT1H2M3S","contentSize":"734003200",
       "license":"https://creativecommons.org/licenses/by/4.0/"}
    </script></head><body><video src="/v/1.mp4"></video></body></html>`,

  'meta tags': `<html><head>
      <meta itemprop="duration" content="PT12M30S">
      <meta property="og:video:duration" content="750">
      </head><body><a href="/f/a.mp4">a</a>
      <span class="duration">12:30</span><span class="size">700 MB</span></body></html>`,

  'texto suelto': `<html><body><div class="video-duration">1:02:03</div>
      <div class="filesize">1.4 GB</div>
      <a href="https://cdn.ejemplo.com/x/clip.mp4">clip</a>
      <p>Licencia: dominio publico</p></body></html>`,

  atributos: `<html><body><video data-duration="185" src="/v/2.webm"></video>
      <a rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>
      </body></html>`,

  'sin nada': '<html><body><p>nada</p></body></html>',
};

test('los extractores dan lo MISMO con HTML crudo que con documento cargado', () => {
  for (const [nombre, html] of Object.entries(FICHAS)) {
    const doc = asDocument(html);

    assert.deepStrictEqual(
      media.extractDurationSeconds(doc),
      media.extractDurationSeconds(html),
      `${nombre}: la duración en segundos difiere`
    );
    assert.deepStrictEqual(
      media.extractDuration(doc),
      media.extractDuration(html),
      `${nombre}: la duración formateada difiere`
    );
    assert.deepStrictEqual(
      media.extractSizeBytes(doc),
      media.extractSizeBytes(html),
      `${nombre}: el tamaño difiere`
    );
    assert.deepStrictEqual(
      detectLicense(doc),
      detectLicense(html),
      `${nombre}: la licencia difiere`
    );
    assert.deepStrictEqual(
      extractFilesFromHtml(doc, 'https://ejemplo.com/ficha/1', ['.mp4', '.webm']),
      extractFilesFromHtml(html, 'https://ejemplo.com/ficha/1', ['.mp4', '.webm']),
      `${nombre}: los ficheros difieren`
    );
    assert.deepStrictEqual(
      extractMatchingLinks(doc, 'https://ejemplo.com/ficha/1', ''),
      extractMatchingLinks(html, 'https://ejemplo.com/ficha/1', ''),
      `${nombre}: los enlaces difieren`
    );
  }
});

test('un documento se puede reutilizar: leerlo no lo consume', () => {
  // Si un extractor mutara el documento, el siguiente vería otra cosa. Es el
  // riesgo real de compartirlo, así que se comprueba explícitamente.
  const doc = asDocument(FICHAS['json-ld']);

  const primera = {
    duracion: media.extractDurationSeconds(doc),
    tamano: media.extractSizeBytes(doc),
    licencia: detectLicense(doc),
    ficheros: extractFilesFromHtml(doc, 'https://ejemplo.com/f', ['.mp4']),
  };

  // Segunda pasada en distinto orden, sobre el MISMO documento
  const segunda = {
    ficheros: extractFilesFromHtml(doc, 'https://ejemplo.com/f', ['.mp4']),
    licencia: detectLicense(doc),
    tamano: media.extractSizeBytes(doc),
    duracion: media.extractDurationSeconds(doc),
  };

  assert.deepStrictEqual(segunda, primera, 'el documento se degrada al leerlo');
});

test('asDocument reutiliza el documento en vez de volver a parsear', () => {
  const doc = asDocument('<html><body><p>x</p></body></html>');
  assert.strictEqual(asDocument(doc), doc, 'debería devolver el mismo objeto, no uno nuevo');
});

test('esDocumento distingue un documento de cualquier otra cosa', () => {
  assert.ok(esDocumento(asDocument('<p>x</p>')));

  for (const valor of ['<p>x</p>', '', null, undefined, 42, {}, [], () => {}]) {
    assert.strictEqual(esDocumento(valor), false, `no es un documento: ${String(valor)}`);
  }
});

test('entrada vacía o no válida sigue dando el mismo resultado que antes', () => {
  for (const valor of ['', '   ', null, undefined, 42]) {
    assert.strictEqual(media.extractDurationSeconds(valor), null);
    assert.strictEqual(media.extractSizeBytes(valor), null);
    assert.strictEqual(detectLicense(valor).declared, false);
  }
});
