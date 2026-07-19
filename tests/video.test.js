'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getVideoType,
  formatFileSize,
  formatDuration,
  extractQualityFromUrl,
  detectKnownPlayers,
  extractVideoUrlsFromContent,
  dedupeVideos,
} = require('../src/services/video');

test('getVideoType', async t => {
  await t.test('reconoce los formatos por extensión real', () => {
    assert.equal(getVideoType('https://s.com/a.mp4'), 'MP4');
    assert.equal(getVideoType('https://s.com/a.WEBM'), 'WebM');
    assert.equal(getVideoType('https://s.com/playlist.m3u8'), 'HLS (M3U8)');
    assert.equal(getVideoType('https://s.com/manifest.mpd'), 'DASH (MPD)');
    assert.equal(getVideoType('https://s.com/seg.ts'), 'TS');
  });

  // includes('.ts') marcaba como video cualquier URL con ".ts" dentro
  await t.test('no confunde ".ts" dentro de otro nombre', () => {
    assert.equal(getVideoType('https://s.com/assets/app.tsx'), null);
    assert.equal(getVideoType('https://s.com/scripts/app.ts.backup'), null);
    assert.equal(getVideoType('https://s.com/pagina.html'), null);
  });

  await t.test('tolera query string y fragmento', () => {
    assert.equal(getVideoType('https://s.com/a.mp4?token=x'), 'MP4');
    assert.equal(getVideoType('https://s.com/a.mp4#t=10'), 'MP4');
  });

  await t.test('devuelve null para lo que no es URL', () => {
    assert.equal(getVideoType('no-es-url'), null);
  });
});

test('formatFileSize', async t => {
  // `if (!bytes) return null` devolvía null para un fichero vacío, que es un
  // dato perfectamente válido.
  await t.test('0 bytes es un valor válido, no null', () => {
    assert.equal(formatFileSize(0), '0 Bytes');
  });

  await t.test('formatea cada unidad', () => {
    assert.equal(formatFileSize(512), '512 Bytes');
    assert.equal(formatFileSize(1024), '1.0 KB');
    assert.equal(formatFileSize(1048576), '1.0 MB');
    assert.equal(formatFileSize(1073741824), '1.0 GB');
  });

  // Math.log de un valor < 1 daba un índice de unidad negativo
  await t.test('no produce índices negativos con valores menores que 1', () => {
    const result = formatFileSize(0.5);
    assert.ok(result === null || result.includes('Bytes'), `resultado inesperado: ${result}`);
  });

  await t.test('devuelve null para entradas no válidas', () => {
    assert.equal(formatFileSize(null), null);
    assert.equal(formatFileSize(undefined), null);
    assert.equal(formatFileSize(-100), null);
    assert.equal(formatFileSize(NaN), null);
    assert.equal(formatFileSize(Infinity), null);
  });
});

test('formatDuration', async t => {
  await t.test('formatea minutos y segundos', () => {
    assert.equal(formatDuration(65), '1:05');
    assert.equal(formatDuration(600), '10:00');
  });

  // CAMBIO DELIBERADO al unificar los formateadores duplicados. Esta version
  // devolvia '0:00' y la de media.js devolvia null para el mismo dato. Gana
  // null: un video de cero segundos no existe, asi que un 0 significa que NO
  // se sabe, y pintar "0:00" afirma lo contrario. Ver src/lib/format.js.
  await t.test('cero segundos es "no se sabe", no una duracion de cero', () => {
    assert.equal(formatDuration(0), null);
  });

  await t.test('añade horas cuando corresponde', () => {
    assert.equal(formatDuration(3661), '1:01:01');
  });

  await t.test('devuelve null para valores inválidos', () => {
    assert.equal(formatDuration(null), null);
    assert.equal(formatDuration(-5), null);
    assert.equal(formatDuration(NaN), null);
  });
});

test('extractQualityFromUrl', async t => {
  await t.test('deduce la calidad de los marcadores habituales', () => {
    assert.equal(extractQualityFromUrl('https://s.com/v-1080.mp4'), '1080p');
    assert.equal(extractQualityFromUrl('https://s.com/v_720p.mp4'), '720p');
    assert.equal(extractQualityFromUrl('https://s.com/v-4k.mp4'), '4K');
  });

  await t.test('devuelve null si no hay marcador', () => {
    assert.equal(extractQualityFromUrl('https://s.com/video.mp4'), null);
  });
});

test('detectKnownPlayers', async t => {
  await t.test('detecta YouTube, Vimeo, Twitch y Dailymotion', () => {
    const html = `
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
      <iframe src="https://player.vimeo.com/video/123456789"></iframe>
      <a href="https://twitch.tv/videos/987654321">clip</a>
      <iframe src="https://www.dailymotion.com/embed/video/x8abcd"></iframe>
    `;
    const players = detectKnownPlayers(html);
    const platforms = players.map(p => p.platform).sort();
    assert.deepEqual(platforms, ['dailymotion', 'twitch', 'vimeo', 'youtube']);

    const youtube = players.find(p => p.platform === 'youtube');
    assert.equal(youtube.videoId, 'dQw4w9WgXcQ');
    assert.equal(youtube.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  await t.test('deduplica el mismo video repetido', () => {
    const html = `
      <iframe src="https://www.youtube.com/embed/abc123XYZ"></iframe>
      <iframe src="https://www.youtube.com/embed/abc123XYZ"></iframe>
    `;
    assert.equal(detectKnownPlayers(html).length, 1);
  });

  await t.test('devuelve [] sin players y tolera entradas no string', () => {
    assert.deepEqual(detectKnownPlayers('<html><body>nada</body></html>'), []);
    assert.deepEqual(detectKnownPlayers(null), []);
  });
});

test('extractVideoUrlsFromContent', async t => {
  await t.test('encuentra URLs de video dentro de scripts', () => {
    const html = `<script>var c = {"src":"https://cdn.com/v/clip-720.mp4","otro":"https://cdn.com/x.js"};</script>`;
    const videos = extractVideoUrlsFromContent(html);
    assert.equal(videos.length, 1);
    assert.equal(videos[0].url, 'https://cdn.com/v/clip-720.mp4');
    assert.equal(videos[0].quality, '720p');
  });

  await t.test('ignora las URLs que no son de video', () => {
    const html = `<script>var a="https://cdn.com/app.js"; var b="https://cdn.com/style.css";</script>`;
    assert.deepEqual(extractVideoUrlsFromContent(html), []);
  });
});

test('dedupeVideos', async t => {
  await t.test('funde registros de la misma URL conservando lo que aporta cada uno', () => {
    const result = dedupeVideos([
      { url: 'https://s.com/a.mp4', type: 'MP4', quality: null, duration: '1:00' },
      { url: 'https://s.com/a.mp4', type: 'MP4', quality: '720p', duration: null },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].quality, '720p', 'toma la calidad del segundo');
    assert.equal(result[0].duration, '1:00', 'conserva la duración del primero');
  });

  await t.test('mantiene separadas las URLs distintas', () => {
    const result = dedupeVideos([
      { url: 'https://s.com/a.mp4', type: 'MP4' },
      { url: 'https://s.com/b.mp4', type: 'MP4' },
    ]);
    assert.equal(result.length, 2);
  });
});
