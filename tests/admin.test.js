'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// El entorno se fija ANTES de cargar la configuración: `src/config` lee
// process.env una sola vez, al requerirse.
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'urlexplorer-admin-'));
process.env.ADMIN_TOKEN = 'token-de-pruebas';
process.env.ADMIN_PROFILES_PATH = path.join(TEMP_DIR, 'profiles.json');

const {
  safeEqual,
  hasValidToken,
  isAdminEnabled,
  requireAdmin,
} = require('../src/middleware/adminAuth');
const { readProfiles, writeProfiles, sanitizeProfile } = require('../src/services/profiles');

/** Petición falsa con las cabeceras indicadas. */
function fakeRequest(headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: name => lower[name.toLowerCase()] };
}

test('safeEqual', async t => {
  await t.test('acepta la cadena correcta y rechaza el resto', () => {
    assert.equal(safeEqual('secreto', 'secreto'), true);
    assert.equal(safeEqual('secreto', 'secretO'), false);
    assert.equal(safeEqual('', ''), true);
  });

  // El hash previo existe para esto: timingSafeEqual exige buffers del mismo
  // tamaño, y comprobar la longitud antes filtraría cuántos caracteres tiene
  // el token. Con longitudes distintas debe devolver false, no reventar.
  await t.test('no lanza con longitudes distintas', () => {
    assert.equal(safeEqual('a', 'una-clave-mucho-mas-larga'), false);
    assert.equal(safeEqual('una-clave-mucho-mas-larga', 'a'), false);
  });
});

test('hasValidToken', async t => {
  await t.test('exige la cabecera exacta', () => {
    assert.equal(hasValidToken(fakeRequest({ 'X-Admin-Token': 'token-de-pruebas' })), true);
    assert.equal(hasValidToken(fakeRequest({ 'x-admin-token': 'token-de-pruebas' })), true);
    assert.equal(hasValidToken(fakeRequest({ 'X-Admin-Token': 'otro' })), false);
    assert.equal(hasValidToken(fakeRequest({})), false);
    assert.equal(hasValidToken(fakeRequest({ 'X-Admin-Token': '' })), false);
  });

  await t.test('el modo está habilitado porque hay token configurado', () => {
    assert.equal(isAdminEnabled(), true);
  });
});

test('requireAdmin', async t => {
  /** Ejecuta el middleware y devuelve el error que pasa a next(), o null. */
  function run(headers) {
    let captured = null;
    requireAdmin(fakeRequest(headers), {}, error => {
      captured = error || null;
    });
    return captured;
  }

  await t.test('deja pasar con el token correcto', () => {
    assert.equal(run({ 'X-Admin-Token': 'token-de-pruebas' }), null);
  });

  await t.test('401 sin token o con token equivocado', () => {
    assert.equal(run({}).statusCode, 401);
    assert.equal(run({ 'X-Admin-Token': 'no' }).statusCode, 401);
    assert.equal(run({}).code, 'ADMIN_UNAUTHORIZED');
  });
});

test('sanitizeProfile', async t => {
  await t.test('descarta los perfiles sin nombre', () => {
    assert.equal(sanitizeProfile(null), null);
    assert.equal(sanitizeProfile({}), null);
    assert.equal(sanitizeProfile({ name: '   ' }), null);
  });

  // Lo que llega del cliente no se guarda tal cual: solo los campos conocidos.
  // Ocultar el botón de guardar en el frontend no es la defensa.
  await t.test('se queda solo con los campos conocidos', () => {
    const clean = sanitizeProfile({
      name: '  Sitio  ',
      config: { searchUrl: 'https://ejemplo.com', maligno: 'x', useJavaScript: true },
    });

    assert.equal(clean.name, 'Sitio');
    assert.deepEqual(clean.config, { searchUrl: 'https://ejemplo.com', useJavaScript: true });
    assert.equal('maligno' in clean.config, false);
  });

  await t.test('conserva los booleanos como booleanos', () => {
    const clean = sanitizeProfile({
      name: 'x',
      config: { useJavaScript: false, openLicenseOnly: true },
    });
    assert.equal(clean.config.useJavaScript, false);
    assert.equal(clean.config.openLicenseOnly, true);
  });
});

test('readProfiles / writeProfiles', async t => {
  const target = process.env.ADMIN_PROFILES_PATH;

  await t.test('un fichero que no existe son cero perfiles, no un error', async () => {
    fs.rmSync(target, { force: true });
    assert.deepEqual(await readProfiles(), []);
  });

  await t.test('guarda y vuelve a leer', async () => {
    await writeProfiles([
      { name: 'Uno', note: 'nota', config: { searchUrl: 'https://ejemplo.com' } },
      { name: 'Dos', config: { linkPattern: '/videos/' } },
    ]);

    const saved = await readProfiles();
    assert.equal(saved.length, 2);
    assert.equal(saved[0].name, 'Uno');
    assert.equal(saved[0].note, 'nota');
    assert.equal(saved[1].config.linkPattern, '/videos/');
  });

  await t.test('descarta las entradas inválidas al guardar', async () => {
    await writeProfiles([{ name: 'Bueno', config: {} }, null, { name: '' }, 'texto suelto']);
    const saved = await readProfiles();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Bueno');
  });

  await t.test('rechaza lo que no sea una lista', async () => {
    await assert.rejects(() => writeProfiles({ name: 'x' }), /lista de perfiles/);
  });

  // Un fichero corrupto NO puede pasar por "no hay perfiles": si se devolviera
  // una lista vacía, el siguiente guardado sobreescribiría en silencio unos
  // perfiles que sí existían.
  await t.test('un JSON corrupto falla en vez de fingir que está vacío', async () => {
    fs.writeFileSync(target, '{esto no es json');
    await assert.rejects(() => readProfiles(), /corrupto/);
    fs.rmSync(target, { force: true });
  });
});

test.after(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));
