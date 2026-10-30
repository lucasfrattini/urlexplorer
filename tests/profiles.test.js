'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// El entorno se fija ANTES de cargar la configuración: `src/config` lee
// process.env una sola vez, al requerirse.
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'urlexplorer-profiles-'));
process.env.PROFILES_PATH = path.join(TEMP_DIR, 'profiles.json');

const { readProfiles, writeProfiles, sanitizeProfile } = require('../src/services/profiles');

test('sanitizeProfile', async t => {
  await t.test('descarta los perfiles sin nombre', () => {
    assert.equal(sanitizeProfile(null), null);
    assert.equal(sanitizeProfile({}), null);
    assert.equal(sanitizeProfile({ name: '   ' }), null);
  });

  // Lo que llega del cliente no se guarda tal cual: solo los campos conocidos.
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
  const target = process.env.PROFILES_PATH;

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
