import { el } from '../dom.js';
import { t, alCambiarIdioma } from '../i18n/index.js';

/**
 * Filtro de rango con dos manijas, sin dependencias.
 *
 * ── Por qué el slider recorre ÍNDICES y no valores ────────────────────
 *
 * Los datos que filtra están muy sesgados: los tamaños van de un clip de
 * 180 KB a un vídeo de 2 GB, que son cuatro órdenes de magnitud. Con una
 * escala lineal sobre bytes, el 99 % de los resultados se amontona en el
 * primer 5 % del recorrido y la manija es inservible.
 *
 * Recorriendo los valores ÚNICOS ordenados, cada paso de la manija mueve el
 * corte al siguiente valor que existe de verdad. Se gana que ningún paso sea
 * inútil y que los extremos coincidan exactamente con el mínimo y el máximo
 * presentes. Se pierde que el recorrido sea proporcional al valor, que para
 * este uso no aporta nada.
 *
 * ── Los dos inputs superpuestos ───────────────────────────────────────
 *
 * Es la técnica habitual para no meter una librería: dos `input[type=range]`
 * uno encima del otro. El input entero ignora el puntero y solo la manija lo
 * captura, porque si no el de arriba se comería todos los clics y el de
 * abajo sería inalcanzable.
 */

/** Formatea segundos como "1 h 05 min", "12 min" o "45 s". */
export function formatDuration(segundos) {
  if (!Number.isFinite(segundos)) return '—';
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const min = Math.floor(segundos / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${h} h` : `${h} h ${String(resto).padStart(2, '0')} min`;
}

/** Formatea bytes como "1.2 GB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.max(Math.floor(Math.log(bytes || 1) / Math.log(1024)), 0), 4);
  const valor = bytes / 1024 ** i;
  return `${valor.toFixed(i <= 1 ? 0 : 1)} ${unidades[i]}`;
}

/**
 * @param {object} opciones
 * @param {string} opciones.labelKey   Clave del título del filtro
 * @param {(v:number)=>string} opciones.format  Cómo se lee un valor
 * @param {()=>void} opciones.onChange Se llama en cada movimiento
 */
export function createRangeFilter({ labelKey, format, onChange }) {
  /** Valores únicos ordenados presentes en los resultados. */
  let valores = [];
  let loIndex = 0;
  let hiIndex = 0;

  const lo = el('input', {
    className: 'range__input range__input--lo',
    attrs: {
      type: 'range',
      min: '0',
      max: '0',
      value: '0',
      step: '1',
    },
    on: {
      input: () => {
        // Las manijas no se cruzan: la de abajo nunca pasa de la de arriba.
        loIndex = Math.min(Number(lo.value), hiIndex);
        lo.value = String(loIndex);
        sync();
      },
    },
  });

  const hi = el('input', {
    className: 'range__input range__input--hi',
    attrs: {
      type: 'range',
      min: '0',
      max: '0',
      value: '0',
      step: '1',
    },
    on: {
      input: () => {
        hiIndex = Math.max(Number(hi.value), loIndex);
        hi.value = String(hiIndex);
        sync();
      },
    },
  });

  const salida = el('span', { className: 'range__value', text: '—' });
  const etiqueta = el('span', { className: 'range__label' });
  const relleno = el('span', { className: 'range__fill' });

  const pista = el('span', {
    className: 'range__track',
    children: [el('span', { className: 'range__rail' }), relleno],
  });

  const root = el('div', {
    className: 'range',
    children: [
      el('div', {
        className: 'range__head',
        children: [etiqueta, salida],
      }),
      el('div', { className: 'range__body', children: [pista, lo, hi] }),
    ],
  });

  // El titulo entra en las dos aria-label, asi que las tres se rehacen
  // juntas al cambiar de idioma.
  alCambiarIdioma(() => {
    etiqueta.textContent = t(labelKey);
    lo.setAttribute('aria-label', t('rango.minimo', { label: t(labelKey) }));
    hi.setAttribute('aria-label', t('rango.maximo', { label: t(labelKey) }));
    sync(false);
  });

  /** Refresca el texto, la barra coloreada y avisa a quien filtra. */
  function sync(notificar = true) {
    if (valores.length === 0) {
      salida.textContent = t('rango.sinDatos');
      relleno.style.left = '0%';
      relleno.style.right = '0%';
      if (notificar) onChange?.();
      return;
    }

    const min = valores[loIndex];
    const max = valores[hiIndex];
    salida.textContent = min === max ? format(min) : `${format(min)} – ${format(max)}`;

    const ultimo = Math.max(1, valores.length - 1);
    relleno.style.left = `${(loIndex / ultimo) * 100}%`;
    relleno.style.right = `${100 - (hiIndex / ultimo) * 100}%`;

    if (notificar) onChange?.();
  }

  return {
    root,

    /**
     * Recalcula los extremos a partir de los datos cargados.
     *
     * Los límites NO son fijos: salen de los resultados que hay ahora. Si el
     * usuario tenía un recorte puesto, se intenta conservar el valor elegido
     * y no el índice, porque el índice significa otra cosa con otra lista.
     */
    setValues(nuevos) {
      const anteriorMin = valores[loIndex];
      const anteriorMax = valores[hiIndex];
      const habiaRecorte = valores.length > 0 && (loIndex > 0 || hiIndex < valores.length - 1);

      valores = [...new Set(nuevos.filter(Number.isFinite))].sort((a, b) => a - b);

      const ultimo = Math.max(0, valores.length - 1);
      lo.max = String(ultimo);
      hi.max = String(ultimo);

      if (habiaRecorte && valores.length > 0) {
        loIndex = Math.max(
          0,
          valores.findIndex(v => v >= anteriorMin)
        );
        const encontrado = valores.findIndex(v => v > anteriorMax);
        hiIndex = encontrado === -1 ? ultimo : Math.max(loIndex, encontrado - 1);
      } else {
        loIndex = 0;
        hiIndex = ultimo;
      }

      lo.value = String(loIndex);
      hi.value = String(hiIndex);
      // Con un solo valor distinto no hay nada que recortar
      root.hidden = valores.length < 2;
      sync(false);
    },

    /** Rango elegido. `null` si no hay datos con los que filtrar. */
    getRange() {
      if (valores.length === 0) return null;
      return { min: valores[loIndex], max: valores[hiIndex] };
    },

    /** ¿Está el filtro en sus extremos, es decir, sin recortar nada? */
    isFull() {
      return valores.length === 0 || (loIndex === 0 && hiIndex === valores.length - 1);
    },

    reset() {
      loIndex = 0;
      hiIndex = Math.max(0, valores.length - 1);
      lo.value = String(loIndex);
      hi.value = String(hiIndex);
      sync(false);
    },
  };
}
