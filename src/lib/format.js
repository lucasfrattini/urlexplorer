'use strict';

/**
 * Formateo de duración y tamaño. PUNTO ÚNICO.
 *
 * Estas dos funciones existían por duplicado en `lib/media.js` y en
 * `services/video.js`, y ya habían DIVERGIDO: para el mismo dato daban
 * resultados distintos según qué vista lo pintara.
 *
 *   formatDuration(0)     media.js -> null      video.js -> "0:00"
 *   formatDuration(59.6)  media.js -> "1:00"    video.js -> "0:59"
 *
 * Es el fallo silencioso de siempre con otra cara: dos pantallas de la misma
 * aplicación mostrando números diferentes para el mismo vídeo, sin que nada
 * falle.
 *
 * ── Qué criterio gana, y por qué ──────────────────────────────────────
 *
 * DURACIÓN CERO ⇒ null, no "0:00". Un vídeo de cero segundos no existe: si
 * el dato es 0, lo que pasa es que NO se sabe. Devolver "0:00" afirma que
 * sabemos que dura nada, y la interfaz lo pintaría como un dato bueno. Con
 * null sale el guion "—", que es lo que el proyecto usa para "no se pudo
 * obtener".
 *
 * TAMAÑO CERO ⇒ "0 Bytes", que es lo contrario, y también a propósito: un
 * fichero vacío SÍ existe y es un dato válido. Ya se corrigió una vez un
 * `if (!bytes) return null` por esto mismo. La asimetría entre las dos
 * funciones no es un descuido: cero bytes es un hecho, cero segundos es la
 * ausencia de un hecho.
 *
 * SEGUNDOS FRACCIONARIOS ⇒ se redondea, no se trunca. La duración de un
 * `<video>` del DOM llega con decimales, y 59,6 s es "1:00" mucho antes que
 * "0:59".
 */

/** Segundos → "12:34" o "1:02:03". `null` si no hay dato utilizable. */
function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;

  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = value => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** Bytes → "1.2 GB". `null` si no hay dato; "0 Bytes" es un dato válido. */
function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined) return null;
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes === 0) return '0 Bytes';

  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  // Math.log de un valor < 1 daba un índice negativo y una unidad inexistente
  const index = Math.min(
    Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0),
    units.length - 1
  );
  const value = bytes / 1024 ** index;

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

module.exports = { formatDuration, formatFileSize };
