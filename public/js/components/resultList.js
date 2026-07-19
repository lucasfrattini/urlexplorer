import {
  el,
  safeLink,
  setChildren,
  emptyState,
  copyToClipboard,
  copyIconButton,
  downloadText,
  toast,
} from '../dom.js';
import { createRangeFilter, formatDuration, formatBytes } from './rangeSlider.js';

/**
 * Lista de resultados con filtros y exportación.
 *
 * Todas las URLs se pintan con safeLink(): texto por textContent y esquema
 * filtrado, porque provienen de HTML de terceros.
 *
 * ── Organización ──────────────────────────────────────────────────────
 *
 * Todo lo que hay dentro de esta tarjeta actúa sobre los resultados YA
 * cargados y filtra en el cliente: nada de aquí vuelve a pedir nada al
 * servidor. Por eso los filtros viven dentro de la tarjeta de resultados y
 * no junto al formulario de exploración, que es lo que decide qué se
 * descarga. Mezclar las dos cosas hacía imposible saber qué actuaba sobre
 * qué.
 */

/** Segundos de un resultado, o null si no se conocen. */
function segundosDe(info) {
  if (Number.isFinite(info?.durationSeconds)) return info.durationSeconds;
  // Respaldo para los detalles antiguos, que solo traían el texto "12:34"
  if (!info?.duration) return null;
  const partes = info.duration.split(':').map(Number);
  if (partes.some(n => !Number.isFinite(n))) return null;
  return partes.reduce((total, n) => total * 60 + n, 0);
}

/** Bytes de un resultado, o null. */
function bytesDe(info) {
  return Number.isFinite(info?.sizeBytes) ? info.sizeBytes : null;
}

export function createResultList({ emptyTitle, emptyText, filename = 'urlexplorer.txt' }) {
  let items = [];
  let filtered = [];
  // url -> { duration, durationSeconds, size, sizeBytes, sizeApproximate }
  let meta = new Map();
  let sortBy = 'orden';

  /**
   * Agrupación de duplicados: `duplicadoDe` mapea cada URL plegada a su
   * representante. NADA se borra de `items`; plegar es solo una vista.
   */
  let duplicadoDe = new Map();
  let grupos = new Map();
  let plegarDuplicados = true;

  /* ── Cabecera: conteo y acciones ─────────────────────────────────── */

  const contador = el('span', { className: 'results__count', text: '0 resultados' });

  const copyButton = el('button', {
    className: 'button button--secondary button--small',
    text: 'Copiar',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const ok = await copyToClipboard(filtered.join('\n'));
        toast(
          ok ? `${filtered.length} enlaces copiados` : 'No se pudo copiar al portapapeles',
          ok ? 'success' : 'error'
        );
      },
    },
  });

  const downloadButton = el('button', {
    className: 'button button--secondary button--small',
    text: 'Descargar .txt',
    attrs: { type: 'button' },
    on: {
      click: () => {
        downloadText(filename, filtered.join('\n'));
        toast(`${filtered.length} enlaces descargados`);
      },
    },
  });

  /* ── Filtros de texto ────────────────────────────────────────────── */

  const search = el('input', {
    className: 'input',
    attrs: {
      type: 'search',
      placeholder: 'Filtrar resultados…',
      'aria-label': 'Filtrar resultados',
    },
    on: { input: () => applyFilter() },
  });

  // En listas grandes suele ser más rápido decir qué NO quieres (240p,
  // sample, preview…) que acertar con un término que incluya justo lo bueno.
  const exclude = el('input', {
    className: 'input',
    attrs: {
      type: 'search',
      placeholder: 'Ocultar los que contengan… (240p, sample)',
      'aria-label': 'Ocultar resultados que contengan estos textos',
      title: 'Separa varios textos con comas',
    },
    on: { input: () => applyFilter() },
  });

  const sortSelect = el('select', {
    className: 'input',
    attrs: { 'aria-label': 'Ordenar resultados' },
    on: {
      change: () => {
        sortBy = sortSelect.value;
        applyFilter();
      },
    },
  });
  sortSelect.replaceChildren(
    el('option', { text: 'Orden de aparición', attrs: { value: 'orden' } }),
    el('option', { text: 'Más largos primero', attrs: { value: 'duracion' } }),
    el('option', { text: 'Más pesados primero', attrs: { value: 'tamano' } })
  );

  /* ── Filtros de rango ────────────────────────────────────────────── */

  const filtroDuracion = createRangeFilter({
    label: 'Duración',
    format: formatDuration,
    onChange: () => applyFilter(),
  });

  const filtroPeso = createRangeFilter({
    label: 'Peso',
    format: formatBytes,
    onChange: () => applyFilter(),
  });

  /* ── Interruptores ───────────────────────────────────────────────── */

  function crearToggle(id, textoInicial, titulo, alCambiar) {
    const input = el('input', {
      attrs: { type: 'checkbox', id },
      on: { change: () => alCambiar(input.checked) },
    });
    const texto = el('span', { className: 'toggle__text', text: textoInicial });
    const root = el('label', {
      className: 'toggle',
      attrs: { for: id, title: titulo },
      children: [input, texto],
    });
    return { root, input, texto };
  }

  let ocultarSinDuracion = false;
  let ocultarSinPeso = false;

  const toggleSinDuracion = crearToggle(
    'hide-no-duration',
    'Ocultar sin duración',
    'Quita los resultados de los que no se pudo averiguar la duración. El filtro de rango por sí solo NO los quita.',
    v => {
      ocultarSinDuracion = v;
      applyFilter();
    }
  );

  const toggleSinPeso = crearToggle(
    'hide-no-size',
    'Ocultar sin peso',
    'Quita los resultados de los que no se pudo averiguar el peso. El filtro de rango por sí solo NO los quita.',
    v => {
      ocultarSinPeso = v;
      applyFilter();
    }
  );

  const dupeToggle = crearToggle(
    'dupe-toggle',
    '',
    'Agrupa los resultados que parecen el mismo contenido. Desactívalo para verlos todos.',
    v => {
      plegarDuplicados = v;
      applyFilter();
    }
  );
  dupeToggle.input.checked = true;
  dupeToggle.root.hidden = true;

  /**
   * Nota que explica la regla menos evidente de todo el panel.
   *
   * Un resultado del que no se conoce la duración NO desaparece al mover el
   * slider de duración: filtrar por un dato que no se tiene solo puede
   * equivocarse. Los rangos ordenan entre los que SÍ tienen el dato, y los
   * interruptores deciden qué pasa con el resto. Sin decirlo, el usuario
   * mueve una manija, ve que el número no baja, y cree que está roto.
   */
  const nota = el('p', {
    className: 'filters__note',
    text: 'Los rangos solo recortan entre los resultados que tienen el dato. A los que no lo tienen no los toca: para quitarlos, usa los interruptores.',
  });

  const avisoSinPeso = el('p', { className: 'filters__note filters__note--warn' });
  avisoSinPeso.hidden = true;

  /* ── Montaje ─────────────────────────────────────────────────────── */

  const filtros = el('div', {
    className: 'filters',
    children: [
      el('div', {
        className: 'filters__row filters__row--text',
        children: [search, exclude, sortSelect],
      }),
      el('div', {
        className: 'filters__row filters__row--ranges',
        children: [filtroDuracion.root, filtroPeso.root],
      }),
      el('div', {
        className: 'filters__row filters__row--flags',
        children: [toggleSinDuracion.root, toggleSinPeso.root, dupeToggle.root],
      }),
      nota,
      avisoSinPeso,
    ],
  });

  const cabecera = el('div', {
    className: 'results__head',
    children: [
      el('h3', { className: 'card__title', text: 'Resultados' }),
      contador,
      el('div', { className: 'results__actions', children: [copyButton, downloadButton] }),
    ],
  });

  // Fila de títulos de columna: es lo que hace que la lista se lea como una
  // tabla sin serlo. Comparte el mismo grid que cada fila.
  const columnas = el('div', {
    className: 'result-head',
    children: [
      el('span', { className: 'result-head__index', text: '#' }),
      el('span', { text: 'Enlace' }),
      el('span', { className: 'result-head__col', text: 'Duración' }),
      el('span', { className: 'result-head__col', text: 'Peso' }),
    ],
  });

  const list = el('ul', { className: 'result-list' });

  const root = el('div', {
    className: 'card results',
    children: [cabecera, filtros, columnas, list],
  });

  /* ── Render ──────────────────────────────────────────────────────── */

  /**
   * Celda de una columna de dato.
   *
   * El guion explícito importa: un hueco en blanco se lee como "cero" o como
   * un fallo de la interfaz, y aquí significa "no se pudo obtener el dato".
   * `data-label` lo usa el CSS en móvil, donde las columnas se apilan y
   * necesitan decir de qué son.
   */
  function celda(valor, etiqueta, extra = {}) {
    if (valor === null) {
      return el('span', {
        className: 'result-item__col result-item__col--empty',
        text: '—',
        attrs: { title: `No se pudo obtener ${etiqueta.toLowerCase()}`, 'data-label': etiqueta },
      });
    }
    return el('span', {
      className: 'result-item__col',
      text: valor,
      attrs: { 'data-label': etiqueta, ...extra },
    });
  }

  function render() {
    const hayResultados = filtered.length > 0;
    copyButton.disabled = !hayResultados;
    downloadButton.disabled = !hayResultados;
    columnas.hidden = !hayResultados;

    if (!hayResultados) {
      const estabaFiltrado = items.length > 0;
      setChildren(
        list,
        el('li', {
          className: 'result-item result-item--empty',
          children: [
            emptyState({
              icon: estabaFiltrado ? '🔍' : '○',
              title: estabaFiltrado ? 'Sin coincidencias' : emptyTitle,
              text: estabaFiltrado
                ? 'Ningún resultado pasa los filtros actuales. Prueba a ampliar los rangos o a desactivar los interruptores.'
                : emptyText,
            }),
          ],
        })
      );
      return;
    }

    // Se limita el render inicial: listas de miles de nodos bloquean el hilo
    const visible = filtered.slice(0, 1000);
    const nodes = visible.map((url, index) => {
      const info = meta.get(url);

      // Aviso de fichero no verificado. Va junto al enlace y no como una
      // columna más porque es una advertencia sobre el resultado entero, no
      // un dato suyo: puede ser un anuncio o una vista previa.
      const marcaDudoso = info?.suspect
        ? el('span', {
            className: 'badge badge--danger result-item__suspect',
            text: '⚠ sin verificar',
            attrs: {
              title: info.suspectReason
                ? `${info.suspectReason}. Su duración no se muestra porque la de la ficha pertenece a otro vídeo.`
                : 'No se pudo comprobar que este fichero sea el de la página.',
            },
          })
        : null;

      const grupo = plegarDuplicados ? grupos.get(url) : null;
      const marcaGrupo =
        grupo && grupo.miembros.length > 1
          ? el('span', {
              className: 'badge badge--warning result-item__dupe',
              text: `+${grupo.miembros.length - 1}`,
              attrs: {
                title: `Se han agrupado ${grupo.miembros.length - 1} resultado(s) más por ${
                  grupo.motivos?.[0]?.texto || 'señales coincidentes'
                }: ${grupo.miembros.slice(1).join(', ')}`,
              },
            })
          : null;

      // El tamaño sacado del HTML de la ficha se marca con "~": viene
      // redondeado de origen y describe el vídeo, no necesariamente este
      // fichero. Confundirlo con el exacto del HEAD llevaría a descartar un
      // clip de vista previa creyendo que es el vídeo completo.
      const aproximado = info?.sizeApproximate === true;
      const celdaPeso = info?.size
        ? celda(aproximado ? `~${info.size}` : info.size, 'Peso', {
            title: aproximado
              ? 'Peso aproximado, tomado de la ficha del sitio'
              : 'Peso exacto, informado por el servidor',
          })
        : celda(null, 'Peso');

      return el('li', {
        className: 'result-item',
        children: [
          el('span', { className: 'result-item__index', text: String(index + 1) }),
          el('span', {
            className: 'result-item__main',
            children: [
              safeLink(url, { className: 'result-item__link' }),
              marcaDudoso,
              marcaGrupo,
              // Copiar una sola línea. Los botones globales copian la lista
              // filtrada entera, que no sirve cuando solo quieres esta URL.
              copyIconButton(url, { label: 'Copiar esta URL' }),
            ],
          }),
          celda(info?.duration || null, 'Duración'),
          celdaPeso,
        ],
      });
    });

    if (filtered.length > visible.length) {
      nodes.push(
        el('li', {
          className: 'result-item result-item--note',
          children: [
            el('span', {
              className: 'field__hint',
              text: `Se muestran los primeros ${visible.length} de ${filtered.length}. Descarga el .txt para verlos todos.`,
            }),
          ],
        })
      );
    }

    setChildren(list, nodes);
  }

  /* ── Filtrado ────────────────────────────────────────────────────── */

  function applyFilter() {
    const needle = search.value.trim().toLowerCase();
    const blocked = exclude.value
      .split(',')
      .map(term => term.trim().toLowerCase())
      .filter(Boolean);

    const rangoDuracion = filtroDuracion.getRange();
    const rangoPeso = filtroPeso.getRange();

    filtered = items.filter(url => {
      // Los duplicados se pliegan bajo su representante, no se descartan:
      // siguen en `items` y el interruptor los devuelve a la lista.
      if (plegarDuplicados && duplicadoDe.has(url)) return false;

      const lower = url.toLowerCase();
      if (needle !== '' && !lower.includes(needle)) return false;
      if (blocked.some(term => lower.includes(term))) return false;

      const info = meta.get(url);

      // REGLA CENTRAL: un dato que no se conoce no lo recorta el rango.
      // Filtrar por lo que no se sabe solo puede quitar cosas buenas, así que
      // esa decisión es del interruptor, no del slider.
      const segundos = segundosDe(info);
      if (segundos === null) {
        if (ocultarSinDuracion) return false;
      } else if (rangoDuracion && (segundos < rangoDuracion.min || segundos > rangoDuracion.max)) {
        return false;
      }

      const bytes = bytesDe(info);
      if (bytes === null) {
        if (ocultarSinPeso) return false;
      } else if (rangoPeso && (bytes < rangoPeso.min || bytes > rangoPeso.max)) {
        return false;
      }

      return true;
    });

    if (sortBy === 'duracion') {
      filtered = [...filtered].sort(
        (a, b) => (segundosDe(meta.get(b)) ?? -1) - (segundosDe(meta.get(a)) ?? -1)
      );
    } else if (sortBy === 'tamano') {
      filtered = [...filtered].sort(
        (a, b) => (bytesDe(meta.get(b)) ?? -1) - (bytesDe(meta.get(a)) ?? -1)
      );
    }

    actualizarContador();
    render();
  }

  /** "Mostrando X de Y", para que se entienda qué está recortando. */
  function actualizarContador() {
    const total = items.length;
    const plegados = plegarDuplicados ? items.filter(url => duplicadoDe.has(url)).length : 0;

    if (total === 0) {
      contador.textContent = '0 resultados';
    } else if (filtered.length === total) {
      contador.textContent = `${total} resultado${total === 1 ? '' : 's'}`;
    } else {
      contador.textContent = `mostrando ${filtered.length} de ${total}`;
    }

    contador.classList.toggle('results__count--filtrado', filtered.length !== total);

    dupeToggle.root.hidden = duplicadoDe.size === 0;
    dupeToggle.texto.textContent = `Agrupar ${duplicadoDe.size} duplicado${
      duplicadoDe.size === 1 ? '' : 's'
    }`;

    const conPeso = items.filter(url => bytesDe(meta.get(url)) !== null).length;
    const sinNingunPeso = total > 0 && conPeso === 0;
    avisoSinPeso.hidden = !sinNingunPeso;
    if (sinNingunPeso) {
      avisoSinPeso.textContent =
        'Ningún resultado trae el peso. Se obtiene activando «Averiguar cuánto pesa cada archivo» en los ajustes avanzados, antes de explorar.';
    }

    // Los plegados tienen su propio interruptor y su propio recuento
    if (plegados > 0) contador.title = `${plegados} plegados por duplicado`;
    else contador.removeAttribute('title');
  }

  /** Recalcula los extremos de los rangos con los datos que hay ahora. */
  function recalcularRangos() {
    filtroDuracion.setValues(items.map(url => segundosDe(meta.get(url))).filter(v => v !== null));
    filtroPeso.setValues(items.map(url => bytesDe(meta.get(url))).filter(v => v !== null));
  }

  render();
  actualizarContador();

  return {
    root,

    setItems(newItems) {
      items = [...new Set(newItems)];
      recalcularRangos();
      applyFilter();
    },

    /** Añade duración y peso de los ficheros ya conocidos. */
    setDetails(details) {
      for (const info of details || []) {
        if (info?.url) meta.set(info.url, info);
      }
      recalcularRangos();
      applyFilter();
    },

    /**
     * Grupos de duplicados calculados en el servidor.
     * No borra nada: solo marca qué se pliega bajo qué.
     */
    setDuplicateGroups(groups) {
      duplicadoDe = new Map();
      grupos = new Map();

      for (const grupo of groups || []) {
        if (!grupo?.representante || !Array.isArray(grupo.miembros)) continue;
        grupos.set(grupo.representante, grupo);
        for (const miembro of grupo.miembros) {
          if (miembro !== grupo.representante) duplicadoDe.set(miembro, grupo.representante);
        }
      }

      applyFilter();
    },

    clear() {
      items = [];
      meta = new Map();
      duplicadoDe = new Map();
      grupos = new Map();
      search.value = '';
      exclude.value = '';
      sortSelect.value = 'orden';
      sortBy = 'orden';
      ocultarSinDuracion = false;
      ocultarSinPeso = false;
      toggleSinDuracion.input.checked = false;
      toggleSinPeso.input.checked = false;
      recalcularRangos();
      applyFilter();
    },
  };
}
