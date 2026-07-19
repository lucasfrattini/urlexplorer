'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Lógica pura del formulario por pasos.
 *
 * El resto del frontend no tiene test porque exigiría un DOM, pero esto sí:
 * es la traducción entre lo que se ve (tarjetas, chips, radios) y lo que se
 * envía, y equivocarse aquí no da ningún error. Se vería como una interfaz
 * que enseña una configuración distinta de la que ejecuta, que es justo el
 * tipo de fallo silencioso que más caro ha salido en este proyecto.
 *
 * El módulo es ESM y los tests son CommonJS: se carga con import() dinámico.
 */
const MODULO = pathToFileURL(
  path.join(__dirname, '..', 'public', 'js', 'views', 'explorerOptions.js')
).href;

let opciones;

test.before(async () => {
  opciones = await import(MODULO);
});

test('normalizarExtensiones deja una forma comparable', () => {
  const { normalizarExtensiones } = opciones;

  assert.strictEqual(normalizarExtensiones('.mp4, .webm'), '.mp4,.webm');
  assert.strictEqual(normalizarExtensiones('.MP4,.WEBM'), '.mp4,.webm');
  // El orden no distingue una elección de otra
  assert.strictEqual(normalizarExtensiones('.webm, .mp4'), '.mp4,.webm');
  // Comas sueltas y espacios no cuentan como extensiones
  assert.strictEqual(normalizarExtensiones(' , .mp4 ,, '), '.mp4');
  assert.strictEqual(normalizarExtensiones(''), '');
  assert.strictEqual(normalizarExtensiones(null), '');
  assert.strictEqual(normalizarExtensiones(undefined), '');
});

test('presetDe reconoce los chips sin importar el orden ni las mayúsculas', () => {
  const { presetDe } = opciones;

  assert.strictEqual(presetDe('.mp4, .webm'), 'video');
  assert.strictEqual(presetDe('.webm,.MP4'), 'video');
  assert.strictEqual(presetDe('.mp3'), 'audio');
  assert.strictEqual(presetDe('.jpg, .png'), 'imagen');
});

test('presetDe llama "otro" a lo que no es ningún preset, y null a lo vacío', () => {
  const { presetDe } = opciones;

  assert.strictEqual(presetDe('.pdf'), 'otro');
  // Un preset con una extensión de más YA no es ese preset: si dijera
  // "video", el chip encendido mentiría sobre lo que se va a buscar.
  assert.strictEqual(presetDe('.mp4, .webm, .mkv'), 'otro');
  assert.strictEqual(presetDe(''), null);
  assert.strictEqual(presetDe('   '), null);
});

test('objetivoDe aplica la misma regla que el backend: sin extensiones no hay fase 2', () => {
  const { objetivoDe } = opciones;

  assert.strictEqual(objetivoDe(''), 'enlaces');
  assert.strictEqual(objetivoDe('  ,  '), 'enlaces');
  assert.strictEqual(objetivoDe('.mp4'), 'ficheros');
});

test('modoAvanzadoDe deduce la vista a partir de los campos', () => {
  const { modoAvanzadoDe } = opciones;

  assert.strictEqual(modoAvanzadoDe({ paginationMode: 'auto' }), 'auto');
  assert.strictEqual(modoAvanzadoDe({}), 'auto');

  // Scroll manda sobre todo lo demás
  assert.strictEqual(
    modoAvanzadoDe({ paginationMode: 'scroll', linkPattern: '/videos/' }),
    'scroll'
  );

  // Con patrones puestos se enseña el modo a mano: si no, estarían actuando
  // sin verse, que es indistinguible de un sitio que no devuelve nada.
  assert.strictEqual(modoAvanzadoDe({ paginationMode: 'auto', linkPattern: '/videos/' }), 'manual');
  assert.strictEqual(modoAvanzadoDe({ paginationMode: 'auto', pageParam: 'page' }), 'manual');

  // Espacios en blanco no son un patrón
  assert.strictEqual(modoAvanzadoDe({ paginationMode: 'auto', linkPattern: '   ' }), 'auto');
});

test('paginationModeDe solo devuelve los dos modos que entiende el servidor', () => {
  const { paginationModeDe } = opciones;

  assert.strictEqual(paginationModeDe('auto'), 'auto');
  // "manual" es una vista, no un modo: al servidor va como automático
  assert.strictEqual(paginationModeDe('manual'), 'auto');
  assert.strictEqual(paginationModeDe('scroll'), 'scroll');
});

test('los presets declaran extensiones con punto y separadas por comas', () => {
  const { PRESETS_EXTENSION, presetDe } = opciones;

  for (const preset of PRESETS_EXTENSION) {
    assert.ok(preset.id && preset.etiqueta, `preset incompleto: ${JSON.stringify(preset)}`);
    for (const ext of preset.extensiones.split(',')) {
      assert.match(ext.trim(), /^\.[a-z0-9]+$/, `extensión inválida en ${preset.id}: ${ext}`);
    }
    // Ida y vuelta: el valor que escribe el chip vuelve a encender ese chip
    assert.strictEqual(presetDe(preset.extensiones), preset.id);
  }
});
