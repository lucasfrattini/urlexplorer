/**
 * Lógica pura del formulario de exploración.
 *
 * Traduce entre lo que ve el usuario (tarjetas, chips, radios) y los
 * parámetros que ya se enviaban al backend. No toca el DOM a propósito: es la
 * única parte del rediseño que puede equivocarse EN SILENCIO —elegir el chip
 * que no es, dar por "automático" una configuración que sí lleva patrones—,
 * así que vive aparte y tiene test.
 *
 * Nada de aquí añade parámetros nuevos: la capa de presentación cambia, los
 * campos que viajan al servidor son exactamente los de antes.
 */

/**
 * Presets del paso 2. `extensiones` es lo que acaba en `fileExtensions`.
 *
 * La etiqueta va como CLAVE de traducción, no como texto: este módulo es
 * lógica pura y no debe conocer ningún idioma. Las extensiones, en cambio,
 * son literales y no se traducen nunca.
 */
export const PRESETS_EXTENSION = [
  { id: 'video', etiquetaKey: 'explorer.preset.video', extensiones: '.mp4, .webm' },
  { id: 'audio', etiquetaKey: 'explorer.preset.audio', extensiones: '.mp3' },
  { id: 'imagen', etiquetaKey: 'explorer.preset.imagen', extensiones: '.jpg, .png' },
];

/**
 * Forma canónica de una lista de extensiones, para poder compararlas.
 *
 * Se ordena porque ".webm, .mp4" y ".mp4, .webm" son la misma elección: sin
 * ordenar, un perfil guardado con el orden contrario no encendería su chip y
 * el usuario vería "Otro" sobre un valor que sí es un preset.
 */
export function normalizarExtensiones(valor) {
  return String(valor ?? '')
    .split(',')
    .map(ext => ext.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
}

/**
 * Qué chip corresponde a un valor: el id del preset, `'otro'` si hay
 * extensiones que no son ningún preset, o `null` si no hay ninguna.
 */
export function presetDe(valor) {
  const canon = normalizarExtensiones(valor);
  if (canon === '') return null;

  const preset = PRESETS_EXTENSION.find(p => normalizarExtensiones(p.extensiones) === canon);
  return preset ? preset.id : 'otro';
}

/**
 * Como `presetDe`, pero admitiendo que el valor sea un SUBCONJUNTO de un
 * preset: una configuración guardada con solo `.mp4` es una elección de vídeo,
 * y encender "Otro" hacía creer que no había preset que la representara.
 *
 * Devuelve `null` si no hay extensiones, o `{ id, exacto }`. `exacto` es falso
 * cuando el valor solo está CONTENIDO en el preset; quien lo use tiene que
 * seguir enseñando la lista real, porque el chip por sí solo prometería
 * extensiones que no se piden.
 *
 * La contención exige UN único preset candidato: si encaja en varios no hay
 * forma de saber cuál quiso el usuario, y encender el que no es sería un fallo
 * silencioso. En ese caso, y cuando no encaja en ninguno, `'otro'`.
 */
export function presetCompatibleDe(valor) {
  const canon = normalizarExtensiones(valor);
  if (canon === '') return null;

  const exacto = PRESETS_EXTENSION.find(p => normalizarExtensiones(p.extensiones) === canon);
  if (exacto) return { id: exacto.id, exacto: true };

  const propias = canon.split(',');
  const candidatos = PRESETS_EXTENSION.filter(p => {
    const suyas = normalizarExtensiones(p.extensiones).split(',');
    return propias.every(ext => suyas.includes(ext));
  });

  return candidatos.length === 1
    ? { id: candidatos[0].id, exacto: false }
    : { id: 'otro', exacto: true };
}

/**
 * Tarjeta del paso 2.
 *
 * La regla es la del backend, sin cambios: sin extensiones no hay fase 2. La
 * tarjeta solo pone nombre a esa condición.
 */
export function objetivoDe(valor) {
  return normalizarExtensiones(valor) === '' ? 'enlaces' : 'ficheros';
}

/**
 * Radio de paginación que refleja una configuración.
 *
 * OJO: `'manual'` NO es un modo del backend, es la vista que enseña los
 * campos de patrón. Se DEDUCE de que haya patrones escritos en lugar de
 * guardarse como un campo nuevo, porque un campo nuevo no estaría en los
 * perfiles ya guardados ni en los enlaces ya compartidos: al abrirlos, sus
 * patrones quedarían ocultos aunque se estuvieran enviando.
 */
export function modoAvanzadoDe({ paginationMode, linkPattern, pageParam } = {}) {
  if (paginationMode === 'scroll') return 'scroll';
  if (String(linkPattern ?? '').trim() || String(pageParam ?? '').trim()) return 'manual';
  return 'auto';
}

/** `paginationMode` real a partir del radio elegido. */
export function paginationModeDe(modoAvanzado) {
  return modoAvanzado === 'scroll' ? 'scroll' : 'auto';
}

/**
 * Rango "Desde/Hasta" siguiente o anterior, preservando el tamaño de la
 * ventana actual (1-5 → 6-10 → 11-15, o de 10 en 10 si el rango es de 10).
 *
 * `direccion`: 1 avanza, -1 retrocede. No hay techo superior porque el sitio
 * puede tener cualquier cantidad de páginas, así que avanzar nunca se acota.
 * Al retroceder, "desde" no puede bajar de 1: se acota desplazando la
 * ventana entera (sin encoger el tamaño) para no invadir páginas negativas.
 */
export function siguienteRango(desde, hasta, direccion) {
  const tamano = hasta - desde + 1;
  const nuevoDesde = desde + direccion * tamano;
  const nuevoHasta = hasta + direccion * tamano;

  if (direccion < 0 && nuevoDesde < 1) {
    return { desde: 1, hasta: tamano };
  }

  return { desde: nuevoDesde, hasta: nuevoHasta };
}
