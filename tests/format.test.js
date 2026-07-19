'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { formatDuration, formatFileSize } = require('../src/lib/format');
const media = require('../src/lib/media');
const video = require('../src/services/video');

/**
 * Formateadores compartidos.
 *
 * Existían por duplicado en `lib/media.js` y `services/video.js` y ya habían
 * divergido: para el mismo dato daban resultados distintos según qué pantalla
 * lo pintara. Estos tests fijan el contrato único y, sobre todo, que no
 * vuelva a haber dos.
 */

test('formatDuration formatea minutos, horas y redondea', () => {
  assert.strictEqual(formatDuration(65), '1:05');
  assert.strictEqual(formatDuration(600), '10:00');
  assert.strictEqual(formatDuration(3661), '1:01:01');
  assert.strictEqual(formatDuration(3599), '59:59');
  assert.strictEqual(formatDuration(3600), '1:00:00');

  // Se REDONDEA, no se trunca: la duración de un <video> del DOM llega con
  // decimales y 59,6 s está mucho más cerca de "1:00" que de "0:59".
  assert.strictEqual(formatDuration(59.6), '1:00');
  assert.strictEqual(formatDuration(59.2), '0:59');
});

test('duración cero es "no se sabe", tamaño cero es un dato válido', () => {
  /**
   * La asimetría es deliberada y es el corazón de la unificación:
   *   - Un vídeo de cero segundos NO existe: un 0 significa que no se sabe,
   *     y pintar "0:00" afirmaría que sí. Sale el guion "—".
   *   - Un fichero de cero bytes SÍ existe. Ya se corrigió una vez un
   *     `if (!bytes) return null` justo por esto.
   */
  assert.strictEqual(formatDuration(0), null);
  assert.strictEqual(formatFileSize(0), '0 Bytes');
});

test('formatDuration rechaza lo que no es una duración', () => {
  for (const valor of [null, undefined, NaN, Infinity, -5, 'hola', {}]) {
    assert.strictEqual(formatDuration(valor), null, `deberia ser null: ${String(valor)}`);
  }
});

test('formatFileSize formatea cada unidad', () => {
  assert.strictEqual(formatFileSize(512), '512 Bytes');
  assert.strictEqual(formatFileSize(1024), '1.0 KB');
  assert.strictEqual(formatFileSize(1536), '1.5 KB');
  assert.strictEqual(formatFileSize(1048576), '1.0 MB');
  assert.strictEqual(formatFileSize(1073741824), '1.0 GB');
  assert.strictEqual(formatFileSize(1099511627776), '1.0 TB');
});

test('formatFileSize rechaza lo que no es un tamaño', () => {
  for (const valor of [null, undefined, NaN, Infinity, -100]) {
    assert.strictEqual(formatFileSize(valor), null, `deberia ser null: ${String(valor)}`);
  }
  // Math.log de un valor < 1 producía un índice de unidad negativo
  const medio = formatFileSize(0.5);
  assert.ok(medio === null || medio.includes('Bytes'), `resultado inesperado: ${medio}`);
});

test('NO vuelve a haber dos implementaciones: media y video dan lo MISMO', () => {
  /**
   * Este es el test que importa. Si alguien vuelve a copiar el formateador en
   * uno de los dos módulos, aquí salta — y no en producción, con dos
   * pantallas mostrando cifras distintas para el mismo vídeo.
   */
  const duraciones = [0, 1, 59, 59.6, 60, 65, 3599, 3600, 3661, -1, NaN, null];
  for (const valor of duraciones) {
    assert.strictEqual(
      media.formatDuration(valor),
      video.formatDuration(valor),
      `formatDuration(${String(valor)}) difiere entre media.js y video.js`
    );
  }

  const tamanos = [0, 1, 999, 1024, 1536, 1048576, 1073741824, -5, NaN, null, undefined];
  for (const valor of tamanos) {
    assert.strictEqual(
      media.formatFileSize(valor),
      video.formatFileSize(valor),
      `formatFileSize(${String(valor)}) difiere entre media.js y video.js`
    );
  }
});
