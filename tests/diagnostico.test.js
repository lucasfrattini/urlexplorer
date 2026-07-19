'use strict';

process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { crawl } = require('../src/services/scraper');
const { analizarRespuesta, analizarError } = require('../src/lib/blocking');

/**
 * Por qué salieron cero resultados (QW-D y QW-E).
 *
 * La causa número uno de frustración es una lista vacía sin explicación. El
 * usuario no puede distinguir "el sitio no tiene nada" de "mi patrón no casa"
 * o de "me han bloqueado". Estos tests fijan que la aplicación sepa decirlo.
 */

async function servidor(handler) {
  const s = http.createServer(handler);
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${s.address().port}/`,
    cerrar: () => new Promise(r => s.close(r)),
  };
}

/* ── QW-D · el patrón dejó fuera todos los enlaces ─────────────────── */

test('cuenta los enlaces que el patrón descartó, y propone prefijos', async t => {
  const { url, cerrar } = await servidor((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body>
      ${Array.from({ length: 12 }, (_, i) => `<a href="/galeria/${i}">g${i}</a>`).join('')}
      ${Array.from({ length: 5 }, (_, i) => `<a href="/perfil/${i}">p${i}</a>`).join('')}
      <a href="/ayuda/faq">ayuda</a>
    </body></html>`);
  });
  t.after(() => cerrar());

  // Un patrón que no casa con NADA de lo que hay
  const resultado = await crawl({ searchUrl: url, linkPattern: '/videos/' });

  assert.strictEqual(resultado.totalLinks, 0, 'el patrón no debería casar con nada');
  assert.strictEqual(
    resultado.diagnostico.enlacesVistos,
    18,
    'debe haber contado TODOS los enlaces, casen o no'
  );

  const prefijos = resultado.diagnostico.prefijos.map(p => p.prefijo);
  assert.deepStrictEqual(
    prefijos,
    ['/galeria/', '/perfil/', '/ayuda/'],
    'los prefijos deben venir ordenados por frecuencia'
  );
  assert.strictEqual(resultado.diagnostico.prefijos[0].veces, 12);
});

test('con el patrón acertado no hay nada que diagnosticar', async t => {
  const { url, cerrar } = await servidor((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><a href="/galeria/1">a</a><a href="/galeria/2">b</a></body></html>');
  });
  t.after(() => cerrar());

  const resultado = await crawl({ searchUrl: url, linkPattern: '/galeria/' });

  assert.strictEqual(resultado.totalLinks, 2);
  assert.strictEqual(resultado.diagnostico.enlacesVistos, 2);
  assert.strictEqual(resultado.diagnostico.bloqueo.sospechoso, false);
});

/* ── QW-E · el sitio parece estar bloqueando ───────────────────────── */

test('reconoce una página de challenge devuelta con 200', async t => {
  // El caso más traicionero: estado 200, así que nada falla, pero lo que
  // llega es una página de espera y no el contenido.
  const { url, cerrar } = await servidor((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><head><title>Just a moment...</title></head>
      <body><div id="cf-wrapper">Checking your browser before accessing.
      <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>
      </div></body></html>`);
  });
  t.after(() => cerrar());

  const resultado = await crawl({ searchUrl: url, linkPattern: '' });

  assert.strictEqual(resultado.diagnostico.bloqueo.sospechoso, true);
  assert.ok(
    resultado.diagnostico.bloqueo.motivos.length > 0,
    'debe decir en qué se basa la sospecha'
  );
});

test('reconoce un bloqueo por código de estado', async t => {
  const { url, cerrar } = await servidor((req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<html><body>Access Denied</body></html>');
  });
  t.after(() => cerrar());

  const resultado = await crawl({ searchUrl: url, linkPattern: '' });

  assert.strictEqual(resultado.diagnostico.bloqueo.sospechoso, true);
  assert.ok(resultado.diagnostico.bloqueo.motivos.some(m => m.includes('403')));
});

test('una página normal NO se marca como bloqueada', async t => {
  // Falsos positivos: el aviso pierde todo su valor si salta siempre.
  const { url, cerrar } = await servidor((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body><h1>Galería</h1>
      <p>Bienvenido. Usa el buscador para encontrar contenido.</p>
      <a href="/galeria/1">uno</a></body></html>`);
  });
  t.after(() => cerrar());

  const resultado = await crawl({ searchUrl: url, linkPattern: '' });
  assert.strictEqual(resultado.diagnostico.bloqueo.sospechoso, false);
});

/* ── El analizador por dentro ──────────────────────────────────────── */

test('analizarRespuesta: señales de cuerpo y de estado', () => {
  assert.strictEqual(analizarRespuesta({ html: '<p>hola</p>' }).sospechoso, false);
  assert.strictEqual(analizarRespuesta({ status: 200, html: '<p>hola</p>' }).sospechoso, false);

  assert.ok(analizarRespuesta({ status: 429 }).sospechoso);
  assert.ok(analizarRespuesta({ html: '<div>Just a moment...</div>' }).sospechoso);
  assert.ok(analizarRespuesta({ html: '<div class="g-recaptcha"></div>' }).sospechoso);
  assert.ok(analizarRespuesta({ html: 'Incapsula incident ID: 1234' }).sospechoso);

  // Entrada vacía no inventa señales
  assert.strictEqual(analizarRespuesta({}).sospechoso, false);
  assert.strictEqual(analizarRespuesta({ html: null, status: null }).sospechoso, false);
});

test('no se repiten motivos aunque coincidan varias marcas', () => {
  // "just a moment" y "checking your browser" comparten motivo
  const r = analizarRespuesta({
    html: '<p>Just a moment... Checking your browser before accessing</p>',
  });
  assert.strictEqual(new Set(r.motivos).size, r.motivos.length, 'hay motivos duplicados');
});

test('analizarError lee el cuerpo que viene dentro del error', () => {
  const error = { response: { status: 403, data: '<html>Access denied</html>' } };
  const r = analizarError(error);

  assert.ok(r.sospechoso);
  assert.ok(r.motivos.some(m => m.includes('403')));

  // Un error sin respuesta (DNS, timeout) no es señal de bloqueo
  assert.strictEqual(analizarError(new Error('timeout')).sospechoso, false);
  assert.strictEqual(analizarError(undefined).sospechoso, false);
});
