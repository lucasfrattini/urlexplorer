'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Formato de la hora del pie.
 *
 * El criterio es literalmente `HH:MM:SS`, hora local y 24 h. Estos tests
 * existen sobre todo para que fallen si alguien "simplifica" el formateo con
 * `toLocaleTimeString`, que en inglés devuelve `7:03:09 AM` y en otras
 * configuraciones ni siquiera lleva ceros a la izquierda.
 */
const url = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'lastSearch.js')).href;

let formatHora;

test.before(async () => {
  ({ formatHora } = await import(url));
});

test('rellena con ceros a la izquierda', () => {
  assert.strictEqual(formatHora(new Date(2026, 0, 1, 7, 3, 9)), '07:03:09');
});

test('medianoche es 00:00:00, no 12:00:00 AM', () => {
  assert.strictEqual(formatHora(new Date(2026, 0, 1, 0, 0, 0)), '00:00:00');
});

test('el ultimo segundo del dia es 23:59:59, en 24 horas', () => {
  assert.strictEqual(formatHora(new Date(2026, 0, 1, 23, 59, 59)), '23:59:59');
});

test('la tarde va en 24 horas, sin sufijo AM/PM', () => {
  const hora = formatHora(new Date(2026, 6, 20, 19, 45, 5));
  assert.strictEqual(hora, '19:45:05');
  assert.ok(!/[ap]\.?m\.?/i.test(hora), 'no debe llevar AM/PM');
});

test('siempre son ocho caracteres con dos puntos', () => {
  for (const fecha of [
    new Date(2026, 0, 1, 0, 0, 0),
    new Date(2026, 5, 15, 9, 8, 7),
    new Date(2026, 11, 31, 23, 59, 59),
  ]) {
    assert.match(formatHora(fecha), /^\d{2}:\d{2}:\d{2}$/);
  }
});

test('usa la hora LOCAL, no UTC', () => {
  // Se construye con componentes locales, así que leerlos de vuelta tiene que
  // devolver exactamente lo mismo con independencia de la zona horaria en la
  // que corran los tests.
  const fecha = new Date(2026, 2, 3, 4, 5, 6);
  assert.strictEqual(formatHora(fecha), '04:05:06');
});
