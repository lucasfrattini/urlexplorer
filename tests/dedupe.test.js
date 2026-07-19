'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { groupDuplicates, normalizeName, sameSize, bastan } = require('../src/lib/dedupe');

const MB = 1024 ** 2;

test('normalizeName', async t => {
  await t.test('quita extensión, calidad y separadores', () => {
    assert.equal(
      normalizeName('https://cdn1.com/v/gatos-monos_720p.mp4'),
      normalizeName('https://cdn2.com/x/gatos_monos-1080p.mp4')
    );
  });

  await t.test('quita los hashes largos que cambian entre CDN', () => {
    assert.equal(
      normalizeName('https://a.com/gatos_a1b2c3d4e5f60718.mp4'),
      normalizeName('https://b.com/gatos.mp4')
    );
  });

  await t.test('nombres distintos siguen siendo distintos', () => {
    assert.notEqual(
      normalizeName('https://a.com/gatos.mp4'),
      normalizeName('https://a.com/perros.mp4')
    );
  });

  await t.test('tolera una URL mal formada', () => {
    assert.equal(typeof normalizeName('no-es-una-url.mp4'), 'string');
    assert.equal(normalizeName(''), '');
    assert.equal(normalizeName(null), '');
  });
});

test('sameSize', async t => {
  await t.test('admite el redondeo del tamaño aproximado', () => {
    assert.equal(sameSize(245 * MB, 245 * MB), true);
    // 1 % de diferencia: el aproximado del HTML viene redondeado
    assert.equal(sameSize(100 * MB, 101 * MB), true);
  });

  await t.test('no confunde tamaños de verdad distintos', () => {
    assert.equal(sameSize(100 * MB, 180 * MB), false);
    assert.equal(sameSize(0, 0), false);
    assert.equal(sameSize(null, 100), false);
  });
});

test('bastan — hacen falta dos senales', async t => {
  await t.test('una sola señal débil no basta', () => {
    assert.equal(bastan([{ tipo: 'duracion' }]), false);
    assert.equal(bastan([{ tipo: 'tamano' }]), false);
    assert.equal(bastan([{ tipo: 'nombre', especifica: false }]), false);
  });

  await t.test('dos senales bastan', () => {
    assert.equal(bastan([{ tipo: 'duracion' }, { tipo: 'tamano' }]), true);
  });

  await t.test('un nombre largo y específico basta solo', () => {
    assert.equal(bastan([{ tipo: 'nombre', especifica: true }]), true);
  });
});

test('groupDuplicates', async t => {
  // El caso de uso: 2 de 3 resultados son el mismo vídeo por dos CDN.
  await t.test('agrupa el mismo vídeo servido desde dos sitios', () => {
    const items = [
      {
        url: 'https://cdn1.com/documental-ballenas_720p.mp4',
        durationSeconds: 3600,
        sizeBytes: 500 * MB,
      },
      {
        url: 'https://cdn2.com/documental-ballenas_1080p.mp4',
        durationSeconds: 3600,
        sizeBytes: 500 * MB,
      },
      { url: 'https://cdn1.com/otra-cosa.mp4', durationSeconds: 120, sizeBytes: 20 * MB },
    ];

    const { grupos, totalDuplicados } = groupDuplicates(items);

    assert.equal(grupos.length, 2);
    assert.equal(totalDuplicados, 1);
    assert.equal(grupos[0].miembros.length, 2);
    assert.equal(grupos[1].miembros.length, 1);
  });

  // EL RIESGO PRINCIPAL: dos vídeos distintos que duran lo mismo. Es común
  // (capítulos de una serie), no una rareza. Agruparlos perdería un
  // resultado legítimo.
  await t.test('NO agrupa por duración a secas', () => {
    const items = [
      { url: 'https://a.com/capitulo-uno.mp4', durationSeconds: 1500 },
      { url: 'https://a.com/capitulo-dos.mp4', durationSeconds: 1500 },
      { url: 'https://a.com/capitulo-tres.mp4', durationSeconds: 1500 },
    ];

    const { grupos, totalDuplicados } = groupDuplicates(items);

    assert.equal(grupos.length, 3, 'cada capítulo debe quedar por su cuenta');
    assert.equal(totalDuplicados, 0);
  });

  await t.test('NO agrupa por tamaño a secas', () => {
    const items = [
      { url: 'https://a.com/uno.mp4', sizeBytes: 245 * MB },
      { url: 'https://a.com/dos.mp4', sizeBytes: 245 * MB },
    ];
    assert.equal(groupDuplicates(items).grupos.length, 2);
  });

  // "video.mp4" es un nombre habitual: por sí solo no identifica nada.
  await t.test('NO agrupa por un nombre corto y genérico', () => {
    const items = [
      { url: 'https://a.com/carpeta1/video.mp4' },
      { url: 'https://a.com/carpeta2/video.mp4' },
    ];
    assert.equal(groupDuplicates(items).grupos.length, 2);
  });

  await t.test('SÍ agrupa por un nombre largo y específico', () => {
    const items = [
      { url: 'https://cdn1.com/entrevista-completa-marzo.mp4' },
      { url: 'https://cdn2.com/entrevista_completa_marzo_1080p.mp4' },
    ];
    const { grupos } = groupDuplicates(items);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].miembros.length, 2);
  });

  // NADA se descarta: el total de miembros siempre cuadra con la entrada.
  await t.test('nunca pierde un elemento', () => {
    const items = [
      { url: 'https://a.com/doc-ballenas.mp4', durationSeconds: 100, sizeBytes: 10 * MB },
      { url: 'https://b.com/doc-ballenas.mp4', durationSeconds: 100, sizeBytes: 10 * MB },
      { url: 'https://a.com/x.mp4', durationSeconds: 50 },
      { url: 'https://a.com/y.mp4' },
    ];

    const { grupos } = groupDuplicates(items);
    const total = grupos.reduce((n, g) => n + g.miembros.length, 0);
    assert.equal(total, items.length);
  });

  await t.test('explica por qué ha agrupado', () => {
    const items = [
      { url: 'https://a.com/doc.mp4', durationSeconds: 100, sizeBytes: 10 * MB },
      { url: 'https://b.com/doc.mp4', durationSeconds: 100, sizeBytes: 10 * MB },
    ];
    const { grupos } = groupDuplicates(items);
    assert.match(grupos[0].motivos[0].texto, /duración|tamaño|nombre/);
  });

  await t.test('lista vacía o inválida no rompe', () => {
    assert.deepEqual(groupDuplicates([]).grupos, []);
    assert.deepEqual(groupDuplicates(null).grupos, []);
  });
});
