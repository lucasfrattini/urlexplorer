'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLinkMatcher, looksLikeRegex, MAX_PATTERN_LENGTH } = require('../src/lib/pattern');

/** Atajo: ¿casa este patrón con este enlace? */
function matches(pattern, rawHref, absolute = `https://ejemplo.com${rawHref}`) {
  return createLinkMatcher(pattern).test(rawHref, absolute);
}

test('looksLikeRegex', async t => {
  await t.test('reconoce las expresiones regulares de verdad', () => {
    assert.equal(looksLikeRegex('/^\\/videos\\/\\d+/'), true);
    assert.equal(looksLikeRegex('/video-\\d+/'), true);
    assert.equal(looksLikeRegex('/(gatos|perros)/'), true);
    assert.equal(looksLikeRegex('/\\.mp4$/i'), true);
  });

  // ESTO es lo que evita romper las configuraciones ya guardadas. Los
  // patrones literales más usados empiezan y acaban por barra, y tomarlos
  // por regex cambiaría su significado sin dar ningún error: seguirían
  // devolviendo resultados, solo que los equivocados.
  await t.test('un literal entre barras SIGUE siendo un literal', () => {
    assert.equal(looksLikeRegex('/videos/'), false);
    assert.equal(looksLikeRegex('/video/'), false);
    assert.equal(looksLikeRegex('/a/'), false);
    assert.equal(looksLikeRegex('/out'), false);
  });
});

test('modos literales — se comportan como antes', async t => {
  await t.test('vacío acepta todo', () => {
    assert.equal(matches('', '/lo-que-sea'), true);
    assert.equal(matches('   ', '/lo-que-sea'), true);
  });

  await t.test('"/ruta/" busca en el href original', () => {
    assert.equal(matches('/videos/', '/videos/123'), true);
    assert.equal(matches('/videos/', '/miembros/perfil'), false);
  });

  await t.test('"http…" compara desde el principio', () => {
    assert.equal(matches('https://ejemplo.com/v/', '/v/1', 'https://ejemplo.com/v/1'), true);
    assert.equal(matches('https://ejemplo.com/v/', '/otro/1', 'https://otro.com/v/1'), false);
  });

  await t.test('cualquier otra cosa se busca dentro de la URL absoluta', () => {
    assert.equal(matches('gatos', '/x', 'https://ejemplo.com/gatos/1'), true);
    assert.equal(matches('gatos', '/x', 'https://ejemplo.com/perros/1'), false);
  });
});

test('modo expresión regular', async t => {
  // El caso que motivaba la funcionalidad: distinguir fichas de vídeo de
  // páginas de miembros, imposible con includes().
  await t.test('permite "/videos/ seguido de un número"', () => {
    const pattern = '/\\/videos\\/\\d+/';
    assert.equal(matches(pattern, '/videos/12345', 'https://ejemplo.com/videos/12345'), true);
    assert.equal(
      matches(pattern, '/videos/miembros', 'https://ejemplo.com/videos/miembros'),
      false
    );
  });

  await t.test('respeta las banderas', () => {
    assert.equal(matches('/\\.MP4$/i', '/a.mp4', 'https://ejemplo.com/a.mp4'), true);
    assert.equal(matches('/\\.MP4$/', '/a.mp4', 'https://ejemplo.com/a.mp4'), false);
  });

  // Con la bandera 'g' el RegExp conserva lastIndex entre llamadas, así que
  // el mismo patrón daría un resultado distinto según el enlace anterior:
  // la mitad de los enlaces se perderían sin ningún error visible.
  await t.test('ignora la bandera g, que daría resultados alternos', () => {
    const matcher = createLinkMatcher('/videos\\/\\d/g');
    const url = 'https://ejemplo.com/videos/1';
    assert.equal(matcher.test('/videos/1', url), true);
    assert.equal(matcher.test('/videos/1', url), true);
    assert.equal(matcher.test('/videos/1', url), true);
  });

  await t.test('rechaza una expresión mal escrita', () => {
    assert.throws(() => createLinkMatcher('/(sin cerrar/'), /no es una expresión regular válida/);
  });
});

test('protección contra ReDoS', async t => {
  // El patrón clásico de backtracking catastrófico. Sin este rechazo, una
  // entrada de 30 caracteres que casi casa tumba el proceso durante minutos,
  // y aquí se evalúa contra miles de enlaces.
  await t.test('rechaza los cuantificadores anidados antes de compilar', () => {
    assert.throws(() => createLinkMatcher('/(a+)+$/'), /cuantificador anidado/);
    assert.throws(() => createLinkMatcher('/(a*)*$/'), /cuantificador anidado/);
    assert.throws(() => createLinkMatcher('/(\\d+)*$/'), /cuantificador anidado/);
  });

  await t.test('rechaza la alternancia dentro de un grupo repetido', () => {
    assert.throws(() => createLinkMatcher('/(a|aa)+$/'), /cuantificador anidado|backtracking/i);
  });

  await t.test('limita la longitud del patrón', () => {
    const largo = `/${'a'.repeat(MAX_PATTERN_LENGTH + 10)}\\d/`;
    assert.throws(() => createLinkMatcher(largo), /demasiado largo/);
  });

  // LA PRUEBA QUE IMPORTA.
  //
  // El filtro estático busca cuantificadores dentro de un grupo entre
  // paréntesis, así que NO ve este patrón: repite clases de caracteres sin
  // agrupar. Es un ReDoS real y perfectamente aceptado en la compilación.
  // Contra una entrada larga que no casa, el motor prueba todas las formas
  // de repartir los caracteres entre los cinco tramos.
  //
  // Para esto existe el presupuesto de tiempo: es la red que recoge lo que
  // el análisis estático no puede ver. Sin él, una exploración con este
  // patrón dejaría el proceso clavado sobre miles de enlaces.
  await t.test('un patrón malicioso agota el presupuesto en vez de colgarse', () => {
    // ~30 ms por evaluación: con el presupuesto de 2 s, salta hacia la
    // evaluación 70. Sin presupuesto, 5000 enlaces serían dos minutos y
    // medio de proceso bloqueado.
    const matcher = createLinkMatcher('/[a-z]+[a-z]+[a-z]+[a-z]+[a-z]+!$/');
    const cebo = `https://ejemplo.com/${'a'.repeat(40)}`;

    const started = Date.now();
    let evaluados = 0;
    let corto = false;

    try {
      for (let i = 0; i < 500; i += 1) {
        matcher.test('/a', cebo);
        evaluados += 1;
      }
    } catch (error) {
      corto = true;
      assert.match(error.message, /tardando demasiado/);
      assert.equal(error.code, 'PATTERN_TIMEOUT');
    }

    const elapsed = Date.now() - started;
    assert.ok(evaluados > 0, 'no llegó a evaluar nada');
    assert.ok(corto, 'el presupuesto de tiempo no llegó a saltar');
    // Se corta poco después de agotar el presupuesto, no minutos más tarde
    assert.ok(elapsed < 20000, `tardó ${elapsed}ms, demasiado`);
  });

  await t.test('la entrada se recorta al máximo de URL configurado', () => {
    const matcher = createLinkMatcher('/x/');
    // Una URL absurdamente larga no debe hacer explotar la evaluación
    const enorme = `https://ejemplo.com/${'a'.repeat(100000)}`;
    const started = Date.now();
    matcher.test('/a', enorme);
    assert.ok(Date.now() - started < 1000);
  });
});
