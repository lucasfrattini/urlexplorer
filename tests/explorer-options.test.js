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

test('presetCompatibleDe enciende el preset que CONTIENE la lista, marcándola no exacta', () => {
  const { presetCompatibleDe } = opciones;

  // El caso del ticket: un perfil guardado con solo .mp4 es vídeo.
  assert.deepStrictEqual(presetCompatibleDe('.mp4'), { id: 'video', exacto: false });
  assert.deepStrictEqual(presetCompatibleDe('.jpg'), { id: 'imagen', exacto: false });
});

test('presetCompatibleDe marca exacto lo que casa entero, sin importar el orden', () => {
  const { presetCompatibleDe } = opciones;

  assert.deepStrictEqual(presetCompatibleDe('.mp4, .webm'), { id: 'video', exacto: true });
  assert.deepStrictEqual(presetCompatibleDe('.webm, .mp4'), { id: 'video', exacto: true });
  // El preset de audio tiene una sola extensión: contención y exactitud coinciden.
  assert.deepStrictEqual(presetCompatibleDe('.mp3'), { id: 'audio', exacto: true });
});

test('presetCompatibleDe cae en "otro" si no está contenido en ningún preset', () => {
  const { presetCompatibleDe } = opciones;

  assert.deepStrictEqual(presetCompatibleDe('.zip'), { id: 'otro', exacto: true });
  // Basta una extensión ajena para que deje de estar contenido: encender
  // "Vídeo" aquí ocultaría que también se va a buscar .zip.
  assert.deepStrictEqual(presetCompatibleDe('.mp4, .zip'), { id: 'otro', exacto: true });
  assert.deepStrictEqual(presetCompatibleDe('.mp4, .webm, .mkv'), { id: 'otro', exacto: true });
});

test('presetCompatibleDe devuelve null cuando no hay extensiones', () => {
  const { presetCompatibleDe } = opciones;

  assert.strictEqual(presetCompatibleDe(''), null);
  assert.strictEqual(presetCompatibleDe('   '), null);
  assert.strictEqual(presetCompatibleDe(null), null);
  assert.strictEqual(presetCompatibleDe(undefined), null);
});

test('presetDe NO cambia: la contención es cosa de presetCompatibleDe', () => {
  const { presetDe } = opciones;

  // Si esto pasara a 'video', otras partes que comparan la lista exacta
  // empezarían a dar por buena una configuración que no lo es.
  assert.strictEqual(presetDe('.mp4'), 'otro');
  assert.strictEqual(presetDe('.jpg'), 'otro');
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

test('paginasEfectivas devuelve el rango tal cual con el paginado activado', () => {
  const { paginasEfectivas } = opciones;

  assert.deepStrictEqual(paginasEfectivas(true, 1, 1), { startPage: 1, endPage: 1 });
  // Incluso si no es 1-1: el paginado activado no toca nada de lo escrito.
  assert.deepStrictEqual(paginasEfectivas(true, 3, 8), { startPage: 3, endPage: 8 });
});

test('paginasEfectivas fuerza 1-1 con el paginado desactivado, sea cual sea el rango escrito', () => {
  const { paginasEfectivas } = opciones;

  assert.deepStrictEqual(paginasEfectivas(false, 1, 5), { startPage: 1, endPage: 1 });
  assert.deepStrictEqual(paginasEfectivas(false, 7, 12), { startPage: 1, endPage: 1 });
  // Ni con un rango ya "normal": el interruptor manda, no el contenido de los campos.
  assert.deepStrictEqual(paginasEfectivas(false, 1, 1), { startPage: 1, endPage: 1 });
});

test('siguienteRango avanza replicando el tamaño de la ventana', () => {
  const { siguienteRango } = opciones;

  assert.deepStrictEqual(siguienteRango(1, 5, 1), { desde: 6, hasta: 10 });
});

test('siguienteRango preserva el tamaño en varios avances seguidos', () => {
  const { siguienteRango } = opciones;

  let rango = { desde: 1, hasta: 5 };
  const tamanoInicial = rango.hasta - rango.desde + 1;

  for (let i = 0; i < 3; i += 1) {
    rango = siguienteRango(rango.desde, rango.hasta, 1);
    assert.strictEqual(
      rango.hasta - rango.desde + 1,
      tamanoInicial,
      `tamaño cambió en el paso ${i}`
    );
  }

  // 1-5 → 6-10 → 11-15 → 16-20
  assert.deepStrictEqual(rango, { desde: 16, hasta: 20 });
});

test('siguienteRango retrocede sin tocar el piso', () => {
  const { siguienteRango } = opciones;

  assert.deepStrictEqual(siguienteRango(11, 15, -1), { desde: 6, hasta: 10 });
});

test('siguienteRango retrocede en el piso y se queda quieto', () => {
  const { siguienteRango } = opciones;

  assert.deepStrictEqual(siguienteRango(1, 5, -1), { desde: 1, hasta: 5 });
});

test('siguienteRango acota el retroceso con overflow parcial, preservando el tamaño', () => {
  const { siguienteRango } = opciones;

  // tamaño 3: 3-5 retrocedería a 0-2, se acota desplazando toda la ventana
  assert.deepStrictEqual(siguienteRango(3, 5, -1), { desde: 1, hasta: 3 });
});

test('siguienteRango funciona con rangos de tamaño 1', () => {
  const { siguienteRango } = opciones;

  assert.deepStrictEqual(siguienteRango(5, 5, 1), { desde: 6, hasta: 6 });
  assert.deepStrictEqual(siguienteRango(5, 5, -1), { desde: 4, hasta: 4 });
});

test('construirParamsMultiUrl: una sola dirección da la forma de siempre', () => {
  const { construirParamsMultiUrl } = opciones;

  // El caso más común (y el que cubren los tests de integración existentes)
  // no debe cambiar de forma en absoluto: solo `searchUrl`, sin `searchUrls`.
  const params = construirParamsMultiUrl(['https://ejemplo.com/a'], {
    linkPattern: '/videos/',
    startPage: 1,
  });

  assert.deepStrictEqual(params, {
    linkPattern: '/videos/',
    startPage: 1,
    searchUrl: 'https://ejemplo.com/a',
  });
  assert.ok(!('searchUrls' in params), 'no debe llevar searchUrls con una sola dirección');
});

test('construirParamsMultiUrl: con varias, añade searchUrls como JSON y searchUrl es la primera', () => {
  const { construirParamsMultiUrl } = opciones;

  const params = construirParamsMultiUrl(['https://ejemplo.com/a', 'https://ejemplo.com/b'], {
    fileExtensions: '.mp4',
  });

  assert.strictEqual(params.searchUrl, 'https://ejemplo.com/a');
  assert.strictEqual(params.fileExtensions, '.mp4');
  assert.deepStrictEqual(JSON.parse(params.searchUrls), [
    'https://ejemplo.com/a',
    'https://ejemplo.com/b',
  ]);
});

test('construirParamsMultiUrl: recorta, descarta vacías y admite un string suelto', () => {
  const { construirParamsMultiUrl } = opciones;

  const params = construirParamsMultiUrl([' https://ejemplo.com/a ', '', '  '], {});
  assert.strictEqual(params.searchUrl, 'https://ejemplo.com/a');
  assert.ok(!('searchUrls' in params));

  // Una URL suelta (no en array) se trata igual que un array de una sola
  const suelta = construirParamsMultiUrl('https://ejemplo.com/x', {});
  assert.strictEqual(suelta.searchUrl, 'https://ejemplo.com/x');
});

test('los presets declaran extensiones con punto y separadas por comas', () => {
  const { PRESETS_EXTENSION, presetDe } = opciones;

  for (const preset of PRESETS_EXTENSION) {
    assert.ok(preset.id && preset.etiquetaKey, `preset incompleto: ${JSON.stringify(preset)}`);
    for (const ext of preset.extensiones.split(',')) {
      assert.match(ext.trim(), /^\.[a-z0-9]+$/, `extensión inválida en ${preset.id}: ${ext}`);
    }
    // Ida y vuelta: el valor que escribe el chip vuelve a encender ese chip
    assert.strictEqual(presetDe(preset.extensiones), preset.id);
  }
});
