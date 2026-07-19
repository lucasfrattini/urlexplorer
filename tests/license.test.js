'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectLicense, looksOpen } = require('../src/lib/license');

test('looksOpen', async t => {
  await t.test('reconoce URLs de licencias abiertas', () => {
    assert.equal(looksOpen('https://creativecommons.org/licenses/by/4.0/'), true);
    assert.equal(looksOpen('https://creativecommons.org/publicdomain/zero/1.0/'), true);
    assert.equal(looksOpen('https://opensource.org/licenses/MIT'), true);
  });

  await t.test('reconoce nombres de licencia en texto', () => {
    assert.equal(looksOpen('CC BY-SA 4.0'), true);
    assert.equal(looksOpen('CC0'), true);
    assert.equal(looksOpen('Public Domain'), true);
    assert.equal(looksOpen('Dominio público'), true);
  });

  await t.test('no confunde un aviso de copyright con una licencia abierta', () => {
    assert.equal(looksOpen('© 2026 Ejemplo S.L. Todos los derechos reservados'), false);
    assert.equal(looksOpen('All rights reserved'), false);
    assert.equal(looksOpen(''), false);
    assert.equal(looksOpen(null), false);
  });
});

test('detectLicense', async t => {
  await t.test('detecta link rel=license', () => {
    const html =
      '<html><head><link rel="license" href="https://creativecommons.org/licenses/by/4.0/"></head><body></body></html>';
    const result = detectLicense(html);
    assert.equal(result.declared, true);
    assert.equal(result.isOpen, true);
    assert.equal(result.source, 'link[rel=license]');
  });

  await t.test('detecta meta name=license', () => {
    const html =
      '<html><head><meta name="license" content="CC BY-SA 4.0"></head><body></body></html>';
    const result = detectLicense(html);
    assert.equal(result.isOpen, true);
  });

  await t.test('detecta licencia dentro de JSON-LD', () => {
    const html = `<html><head><script type="application/ld+json">
      {"@type":"VideoObject","license":"https://creativecommons.org/licenses/by/3.0/"}
    </script></head><body></body></html>`;
    const result = detectLicense(html);
    assert.equal(result.isOpen, true);
    assert.equal(result.source, 'json-ld');
  });

  await t.test('detecta el enlace visible a Creative Commons', () => {
    const html =
      '<html><body><a href="https://creativecommons.org/licenses/by-sa/4.0/">Licencia</a></body></html>';
    assert.equal(detectLicense(html).isOpen, true);
  });

  // El punto central del filtro: sin declaración NO es libre.
  await t.test('sin licencia declarada NO cuenta como abierta', () => {
    const html = '<html><body><video src="/v.mp4"></video></body></html>';
    const result = detectLicense(html);
    assert.equal(result.declared, false);
    assert.equal(result.isOpen, false);
  });

  await t.test('una licencia declarada pero no abierta tampoco pasa', () => {
    const html =
      '<html><head><meta name="license" content="Propietaria, todos los derechos reservados"></head><body></body></html>';
    const result = detectLicense(html);
    assert.equal(result.declared, true);
    assert.equal(result.isOpen, false);
  });

  await t.test('marca las cláusulas NC y ND como restringidas', () => {
    const nc = detectLicense(
      '<link rel="license" href="https://creativecommons.org/licenses/by-nc/4.0/">'
    );
    assert.equal(nc.isOpen, true);
    assert.equal(nc.restricted, true);

    const by = detectLicense(
      '<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">'
    );
    assert.equal(by.restricted, false);
  });

  await t.test('tolera HTML vacío o JSON-LD corrupto', () => {
    assert.equal(detectLicense('').isOpen, false);
    assert.equal(detectLicense(null).isOpen, false);
    assert.equal(detectLicense('<script type="application/ld+json">{roto</script>').isOpen, false);
  });
});
