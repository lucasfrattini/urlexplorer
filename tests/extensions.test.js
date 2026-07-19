'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadExtensions,
  findExtension,
  listExtensions,
  EXTENSIONS_DIR,
  NOMBRE_VALIDO,
} = require('../src/services/extensions');

test('el cargador solo lee del directorio fijo del repositorio', async t => {
  // La propiedad de seguridad central: una extensión es código, y cargarla es
  // ejecutarlo. El directorio se resuelve desde __dirname y NO es
  // configurable, para que ninguna variable de entorno ni ningún dato de una
  // petición pueda apuntar el require a otro sitio.
  await t.test('el directorio está dentro de src/extensions', () => {
    assert.equal(path.basename(EXTENSIONS_DIR), 'extensions');
    assert.ok(EXTENSIONS_DIR.includes(`${path.sep}src${path.sep}`));
    assert.ok(path.isAbsolute(EXTENSIONS_DIR));
  });

  // Aunque nada construya nombres desde una petición, la lista blanca es la
  // segunda barrera: un fichero con nombre raro se ignora, no se carga.
  await t.test('la lista blanca de nombres rechaza cualquier ruta', () => {
    assert.equal(NOMBRE_VALIDO.test('mi-sitio.js'), true);
    assert.equal(NOMBRE_VALIDO.test('ejemplo-api-json.js'), true);

    assert.equal(NOMBRE_VALIDO.test('../../../etc/passwd'), false);
    assert.equal(NOMBRE_VALIDO.test('../fuera.js'), false);
    assert.equal(NOMBRE_VALIDO.test('sub/dir.js'), false);
    assert.equal(NOMBRE_VALIDO.test('malo.js.txt'), false);
    assert.equal(NOMBRE_VALIDO.test('.oculto.js'), false);
    assert.equal(NOMBRE_VALIDO.test('README.md'), false);
    assert.equal(NOMBRE_VALIDO.test('MAYUS.js'), false);
  });
});

test('loadExtensions', async t => {
  await t.test('carga la extensión de ejemplo del repositorio', () => {
    const cargadas = loadExtensions();
    assert.ok(Array.isArray(cargadas));
    assert.ok(cargadas.some(e => e.name === 'ejemplo-api-json'));
  });

  await t.test('es idempotente', () => {
    assert.equal(loadExtensions().length, loadExtensions().length);
  });

  await t.test('todas las cargadas cumplen el contrato', () => {
    for (const extension of loadExtensions()) {
      assert.equal(typeof extension.name, 'string');
      assert.equal(typeof extension.match, 'function');
      assert.ok(
        typeof extension.listar === 'function' || typeof extension.extraerFicheros === 'function',
        `${extension.name} no implementa ni listar ni extraerFicheros`
      );
    }
  });

  await t.test('el README no se intenta cargar como extensión', () => {
    assert.equal(
      loadExtensions().some(e => e.name === 'README'),
      false
    );
  });
});

test('findExtension', async t => {
  await t.test('encuentra la del host correspondiente', () => {
    const encontrada = findExtension('https://galeria.ejemplo.com/buscar?q=gatos');
    assert.equal(encontrada?.name, 'ejemplo-api-json');
  });

  await t.test('acepta subdominios del host', () => {
    assert.equal(findExtension('https://cdn.galeria.ejemplo.com/x')?.name, 'ejemplo-api-json');
  });

  // Sin esto, una extensión de "ejemplo.com" se aplicaría a
  // "ejemplo.com.atacante.net", que es un host completamente distinto.
  await t.test('no se aplica a un host que solo contiene el nombre', () => {
    assert.equal(findExtension('https://galeria.ejemplo.com.otro.net/x'), null);
    assert.equal(findExtension('https://nogaleria.ejemplo.com/x'), null);
  });

  await t.test('devuelve null si no aplica ninguna', () => {
    assert.equal(findExtension('https://otro-sitio.com/buscar'), null);
  });

  await t.test('una URL inválida no rompe', () => {
    assert.equal(findExtension('no-es-una-url'), null);
    assert.equal(findExtension(''), null);
    assert.equal(findExtension(null), null);
  });
});

test('la extensión de ejemplo', async t => {
  const extension = findExtension('https://galeria.ejemplo.com/buscar?q=gatos');

  await t.test('lista usando el fetchPage del motor, no un cliente propio', async () => {
    const pedidas = [];
    const ctx = {
      // Hereda timeouts, reintentos, throttling y validación SSRF del motor:
      // una extensión no abre sus propias conexiones.
      fetchPage: async url => {
        pedidas.push(url);
        return JSON.stringify({ results: [{ id: 1 }, { id: 2 }] });
      },
    };

    const links = await extension.listar('https://galeria.ejemplo.com/buscar?q=gatos&page=2', ctx);

    assert.equal(pedidas.length, 1);
    assert.match(pedidas[0], /\/api\/v1\/search/);
    assert.match(pedidas[0], /q=gatos/);
    assert.match(pedidas[0], /page=2/);
    assert.deepEqual(links, ['https://galeria.ejemplo.com/v/1', 'https://galeria.ejemplo.com/v/2']);
  });

  // Un captcha o una página de error devuelven HTML, no JSON. Reventar aquí
  // tumbaría la exploración entera; devolver vacío la corta con elegancia.
  await t.test('una respuesta que no es JSON no revienta', async () => {
    const ctx = { fetchPage: async () => '<html>captcha</html>' };
    assert.deepEqual(await extension.listar('https://galeria.ejemplo.com/b?q=x', ctx), []);
  });

  await t.test('una página sin respuesta devuelve vacío', async () => {
    const ctx = { fetchPage: async () => null };
    assert.deepEqual(await extension.listar('https://galeria.ejemplo.com/b?q=x', ctx), []);
  });

  await t.test('extrae también lo que la vía genérica no ve', () => {
    const html = '<div data-source="https://cdn.ejemplo.com/v/1.mp4"></div>';
    const ficheros = extension.extraerFicheros(html, {
      baseUrl: 'https://galeria.ejemplo.com/v/1',
      extensions: ['mp4'],
      extractFilesFromHtml: () => [],
    });
    assert.deepEqual(ficheros, ['https://cdn.ejemplo.com/v/1.mp4']);
  });

  await t.test('conserva lo que sí encuentra la vía genérica', () => {
    const ficheros = extension.extraerFicheros('<div></div>', {
      baseUrl: 'https://galeria.ejemplo.com/v/1',
      extensions: ['mp4'],
      extractFilesFromHtml: () => ['https://galeria.ejemplo.com/a.mp4'],
    });
    assert.deepEqual(ficheros, ['https://galeria.ejemplo.com/a.mp4']);
  });
});

test('listExtensions describe lo que hay cargado', () => {
  const lista = listExtensions();
  const ejemplo = lista.find(e => e.name === 'ejemplo-api-json');

  assert.ok(ejemplo);
  assert.ok(ejemplo.description.length > 0, 'la descripción es obligatoria');
  assert.deepEqual(ejemplo.capacidades.sort(), ['extraerFicheros', 'listar']);
});
