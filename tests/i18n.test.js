'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Núcleo de traducción.
 *
 * La prueba que de verdad importa es la PARIDAD DE CLAVES: una traducción
 * olvidada no da ningún error en tiempo de ejecución. La frase sale en el
 * otro idioma y parece que el selector está roto, cuando lo que falta es una
 * linea en un diccionario.
 */
const dir = path.join(__dirname, '..', 'public', 'js', 'i18n');
const url = f => pathToFileURL(path.join(dir, f)).href;

let es, en, i18n;

test.before(async () => {
  ({ es } = await import(url('es.js')));
  ({ en } = await import(url('en.js')));
  i18n = await import(url('index.js'));
});

test('los dos diccionarios tienen EXACTAMENTE las mismas claves', () => {
  const clavesEs = Object.keys(es).sort();
  const clavesEn = Object.keys(en).sort();

  const faltanEnIngles = clavesEs.filter(k => !(k in en));
  const faltanEnEspanol = clavesEn.filter(k => !(k in es));

  assert.deepStrictEqual(faltanEnIngles, [], `claves sin traducir al ingles: ${faltanEnIngles}`);
  assert.deepStrictEqual(faltanEnEspanol, [], `claves sin traducir al espanol: ${faltanEnEspanol}`);
  assert.deepStrictEqual(clavesEs, clavesEn);
});

test('ninguna traduccion esta vacia ni es igual a su clave', () => {
  for (const [idioma, dicc] of [
    ['es', es],
    ['en', en],
  ]) {
    for (const [clave, valor] of Object.entries(dicc)) {
      assert.strictEqual(typeof valor, 'string', `${idioma}.${clave} no es una cadena`);
      assert.notStrictEqual(valor.trim(), '', `${idioma}.${clave} esta vacia`);
      assert.notStrictEqual(valor, clave, `${idioma}.${clave} es la clave sin traducir`);
    }
  }
});

test('las dos formas de plural existen siempre juntas', () => {
  // Media clave de plural es peor que ninguna: tp() pediria la que falta y
  // acabaria pintando la clave cruda en pantalla justo en el caso raro.
  for (const clave of Object.keys(es)) {
    if (clave.endsWith('.uno')) {
      const par = `${clave.slice(0, -4)}.varios`;
      assert.ok(par in es, `falta ${par} en es`);
      assert.ok(par in en, `falta ${par} en en`);
    }
  }
});

test('los huecos de cada cadena coinciden entre idiomas', () => {
  // Un {nombre} que existe en un idioma y no en el otro es un dato que
  // desaparece al cambiar de idioma, sin ningun error.
  const huecos = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

  for (const clave of Object.keys(es)) {
    // {q} y {page} son plantillas de URL que el usuario escribe, no huecos:
    // se comprueban aparte, en su propio test.
    if (clave === 'explorer.url.hint') continue;
    if (clave === 'explorer.termino.hint') continue;
    if (clave === 'explorer.parametro.hint') continue;
    if (clave === 'error.faltaTermino.body') continue;
    if (clave === 'error.faltaParametro.body') continue;

    assert.deepStrictEqual(
      huecos(en[clave]),
      huecos(es[clave]),
      `los huecos de "${clave}" no coinciden`
    );
  }
});

test('detectarIdioma: espanol e ingles se reconocen con region', () => {
  const { detectarIdioma } = i18n;

  assert.strictEqual(detectarIdioma(['es']), 'es');
  assert.strictEqual(detectarIdioma(['es-AR']), 'es');
  assert.strictEqual(detectarIdioma(['ES-es']), 'es');
  assert.strictEqual(detectarIdioma(['en']), 'en');
  assert.strictEqual(detectarIdioma(['en-GB']), 'en');
});

test('detectarIdioma: cualquier otro idioma cae en INGLES', () => {
  const { detectarIdioma } = i18n;

  assert.strictEqual(detectarIdioma(['fr-FR']), 'en');
  assert.strictEqual(detectarIdioma(['de']), 'en');
  assert.strictEqual(detectarIdioma(['ja', 'ko']), 'en');
  assert.strictEqual(detectarIdioma([]), 'en');
  assert.strictEqual(detectarIdioma(undefined), 'en');
  assert.strictEqual(detectarIdioma(['']), 'en');
});

test('detectarIdioma: gana el primero que sepamos hablar, en su orden', () => {
  const { detectarIdioma } = i18n;

  // Prefiere frances, que no tenemos; entre lo que hay entiende espanol
  assert.strictEqual(detectarIdioma(['fr', 'es', 'en']), 'es');
  assert.strictEqual(detectarIdioma(['fr', 'en', 'es']), 'en');
  // Una sola cadena, no un array, tambien vale (navigator.language)
  assert.strictEqual(detectarIdioma('es-MX'), 'es');
});

test('t() rellena los huecos y deja intactos los que no se le pasan', () => {
  const { t } = i18n;

  // El idioma inicial en Node (sin navigator) es el por defecto: ingles
  assert.strictEqual(t('resultados.mostrando', { visibles: 3, total: 9 }), 'showing 3 of 9');
  // Sin params, la plantilla tal cual
  assert.match(t('resultados.mostrando'), /\{visibles\}/);
});

test('t() conserva {q} y {page}: son plantillas de URL, no huecos', () => {
  const { t } = i18n;

  // Si la interpolacion se los comiera, la ayuda diria al usuario que escriba
  // una plantilla que no aparece por ninguna parte.
  assert.match(t('explorer.url.hint'), /\{q\}/);
  assert.match(t('explorer.url.hint'), /\{page\}/);
  assert.match(t('error.faltaTermino.body'), /\{q\}/);
  assert.match(t('error.faltaParametro.body'), /\{page\}/);
});

test('una clave inexistente se devuelve tal cual, no como hueco mudo', () => {
  const { t } = i18n;
  assert.strictEqual(t('esta.clave.no.existe'), 'esta.clave.no.existe');
});

test('tp() elige singular o plural y expone {n}', () => {
  const { tp } = i18n;

  assert.strictEqual(tp('resultados.total', 1), '1 result');
  assert.strictEqual(tp('resultados.total', 7), '7 results');
  assert.strictEqual(tp('resultados.total', 0), '0 results');
});

test('IDIOMAS declara exactamente los diccionarios que existen', () => {
  assert.deepStrictEqual([...i18n.IDIOMAS].sort(), ['en', 'es']);
  assert.strictEqual(i18n.IDIOMA_POR_DEFECTO, 'en');
});

test('las claves de los presets de extension existen en los diccionarios', async () => {
  const { PRESETS_EXTENSION } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'views', 'explorerOptions.js')).href
  );

  for (const preset of PRESETS_EXTENSION) {
    assert.ok(preset.etiquetaKey in es, `falta ${preset.etiquetaKey} en es`);
    assert.ok(preset.etiquetaKey in en, `falta ${preset.etiquetaKey} en en`);
  }
});

test('toda clave usada en el frontend existe en los diccionarios', () => {
  // Barrido del codigo real: es lo que convierte un error tipografico en una
  // clave —que en pantalla se veria como texto crudo— en un test en rojo.
  const fs = require('node:fs');
  const raiz = path.join(__dirname, '..', 'public', 'js');

  const ficheros = [];
  (function recorrer(dir) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else if (entrada.name.endsWith('.js') && !completo.includes(`${path.sep}i18n${path.sep}`)) {
        ficheros.push(completo);
      }
    }
  })(raiz);

  const desconocidas = new Set();
  for (const fichero of ficheros) {
    const codigo = fs.readFileSync(fichero, 'utf8');
    // t('clave'), texto(nodo, 'clave'), atributo(nodo, 'attr', 'clave')
    for (const m of codigo.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
      if (!(m[1] in es)) desconocidas.add(`${path.basename(fichero)}: ${m[1]}`);
    }
    for (const m of codigo.matchAll(/\btexto\([^,]+,\s*'([\w.]+)'/g)) {
      if (!(m[1] in es)) desconocidas.add(`${path.basename(fichero)}: ${m[1]}`);
    }
    for (const m of codigo.matchAll(/\batributo\([^,]+,\s*'[^']+',\s*'([\w.]+)'/g)) {
      if (!(m[1] in es)) desconocidas.add(`${path.basename(fichero)}: ${m[1]}`);
    }
  }

  assert.deepStrictEqual([...desconocidas], [], 'claves usadas que no existen');
});

test('el HTML estatico solo referencia claves que existen', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  const faltan = [];
  for (const m of html.matchAll(/data-i18n="([\w.]+)"/g)) {
    if (!(m[1] in es)) faltan.push(m[1]);
  }
  assert.deepStrictEqual(faltan, []);
});
