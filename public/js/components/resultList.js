import {
  el,
  safeLink,
  setChildren,
  emptyState,
  copyToClipboard,
  downloadText,
  toast,
} from '../dom.js';

/**
 * Lista de resultados con filtro, copia y descarga.
 *
 * Todas las URLs se pintan con safeLink(): texto por textContent y esquema
 * filtrado, porque provienen de HTML de terceros.
 */
/** "1:02:03" o "12:34" a segundos, para poder ordenar. */
function segundos(info) {
  if (!info?.duration) return null;
  const partes = info.duration.split(':').map(Number);
  if (partes.some(n => !Number.isFinite(n))) return null;
  return partes.reduce((total, n) => total * 60 + n, 0);
}

export function createResultList({ emptyTitle, emptyText, filename = 'urlexplorer.txt' }) {
  let items = [];
  let filtered = [];
  let hiddenCount = 0;
  // url -> { duration, size, sizeBytes, sizeApproximate }
  let meta = new Map();
  let sortBy = 'orden';

  /**
   * Agrupación de duplicados.
   *
   * `duplicadoDe` mapea cada URL plegada al representante de su grupo, y
   * `grupos` guarda los miembros de cada uno. NADA se borra de `items`:
   * plegar es solo una vista, y el interruptor la deshace. Descartar en
   * silencio haría perder resultados legítimos, porque dos vídeos distintos
   * pueden compartir señales.
   */
  let duplicadoDe = new Map();
  let grupos = new Map();
  let plegarDuplicados = true;

  const counter = el('span', { className: 'badge', text: '0' });
  const hiddenBadge = el('span', { className: 'badge badge--warning', text: '' });
  hiddenBadge.hidden = true;

  const search = el('input', {
    className: 'input toolbar__search',
    attrs: {
      type: 'search',
      placeholder: 'Filtrar resultados…',
      'aria-label': 'Filtrar resultados',
    },
    on: {
      input: () => applyFilter(),
    },
  });

  // Filtro de exclusión: en listas grandes suele ser más rápido decir qué NO
  // quieres (240p, sample, preview…) que acertar con un término que incluya
  // justo lo bueno.
  const exclude = el('input', {
    className: 'input toolbar__search',
    attrs: {
      type: 'search',
      placeholder: 'Ocultar los que contengan… (240p, sample)',
      'aria-label': 'Ocultar resultados que contengan estos textos',
      title: 'Separa varios textos con comas',
    },
    on: {
      input: () => applyFilter(),
    },
  });

  /**
   * Interruptor de agrupación.
   *
   * Existe porque la agrupación puede equivocarse: dos vídeos distintos
   * pueden compartir señales. El usuario tiene que poder deshacerla y ver la
   * lista entera, y por eso también se dice cuántos hay plegados en vez de
   * dejar que desaparezcan sin más.
   */
  const dupeCheckbox = el('input', {
    attrs: { type: 'checkbox', id: 'dupe-toggle', checked: true },
    on: {
      change: () => {
        plegarDuplicados = dupeCheckbox.checked;
        applyFilter();
      },
    },
  });

  const dupeLabel = el('span', { className: 'dupe-toggle__text', text: '' });

  const dupeToggle = el('label', {
    className: 'dupe-toggle',
    attrs: {
      for: 'dupe-toggle',
      title: 'Agrupa los resultados que parecen el mismo contenido. Desactívalo para verlos todos.',
    },
    children: [dupeCheckbox, dupeLabel],
  });
  dupeToggle.hidden = true;

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

  const toolbar = el('div', {
    className: 'toolbar',
    children: [
      counter,
      hiddenBadge,
      dupeToggle,
      search,
      exclude,
      sortSelect,
      copyButton,
      downloadButton,
    ],
  });

  const list = el('ul', { className: 'result-list' });

  const root = el('div', { className: 'card', children: [toolbar, list] });

  function render() {
    counter.textContent = String(filtered.length);
    hiddenBadge.hidden = hiddenCount === 0;
    hiddenBadge.textContent = `${hiddenCount} oculto${hiddenCount === 1 ? '' : 's'}`;
    const hasResults = filtered.length > 0;
    copyButton.disabled = !hasResults;
    downloadButton.disabled = !hasResults;

    if (!hasResults) {
      const isFiltered = items.length > 0;
      setChildren(
        list,
        el('li', {
          children: [
            emptyState({
              icon: isFiltered ? '🔍' : '○',
              title: isFiltered ? 'Sin coincidencias' : emptyTitle,
              text: isFiltered ? 'Ningún resultado coincide con el filtro.' : emptyText,
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
      const badges = [];
      if (info?.duration) {
        badges.push(el('span', { className: 'badge badge--accent', text: info.duration }));
      }
      // Marca de grupo: dice cuántos se han plegado bajo este y por qué, para
      // que el usuario pueda juzgar si la agrupación tiene sentido.
      const grupo = plegarDuplicados ? grupos.get(url) : null;
      if (grupo && grupo.miembros.length > 1) {
        const otros = grupo.miembros.length - 1;
        badges.push(
          el('span', {
            className: 'badge badge--warning',
            text: `+${otros} igual${otros === 1 ? '' : 'es'}`,
            attrs: {
              title: `Se han agrupado ${otros} resultado${otros === 1 ? '' : 's'} más por ${
                grupo.motivos?.[0]?.texto || 'señales coincidentes'
              }: ${grupo.miembros.slice(1).join(', ')}`,
            },
          })
        );
      }

      if (info?.size) {
        // El tamaño sacado del HTML de la ficha se marca con "~": viene
        // redondeado de origen y describe el vídeo, no necesariamente este
        // fichero. Confundirlo con el exacto del HEAD llevaría a descartar
        // un clip de vista previa creyendo que es el vídeo completo.
        const approx = info.sizeApproximate === true;
        badges.push(
          el('span', {
            className: 'badge badge--success',
            text: approx ? `~${info.size}` : info.size,
            attrs: approx
              ? { title: 'Tamaño aproximado, tomado de la ficha del sitio' }
              : { title: 'Tamaño exacto, informado por el servidor' },
          })
        );
      }

      return el('li', {
        className: 'result-item',
        children: [
          el('span', { className: 'badge', text: String(index + 1) }),
          safeLink(url, { className: 'result-item__link' }),
          badges.length ? el('span', { className: 'result-item__meta', children: badges }) : null,
        ],
      });
    });

    if (filtered.length > visible.length) {
      nodes.push(
        el('li', {
          className: 'result-item',
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

  function applyFilter() {
    const needle = search.value.trim().toLowerCase();
    const blocked = exclude.value
      .split(',')
      .map(term => term.trim().toLowerCase())
      .filter(Boolean);

    filtered = items.filter(url => {
      // Los duplicados se pliegan bajo su representante, no se descartan:
      // siguen en `items` y el interruptor los devuelve a la lista.
      if (plegarDuplicados && duplicadoDe.has(url)) return false;
      const lower = url.toLowerCase();
      if (needle !== '' && !lower.includes(needle)) return false;
      return !blocked.some(term => lower.includes(term));
    });

    if (sortBy === 'duracion') {
      filtered = [...filtered].sort(
        (a, b) => (segundos(meta.get(b)) ?? -1) - (segundos(meta.get(a)) ?? -1)
      );
    } else if (sortBy === 'tamano') {
      filtered = [...filtered].sort(
        (a, b) => (meta.get(b)?.sizeBytes ?? -1) - (meta.get(a)?.sizeBytes ?? -1)
      );
    }

    // Los plegados no cuentan como "ocultos por el filtro": tienen su propio
    // aviso y su propio interruptor, y mezclarlos confundiría los dos.
    const plegados = plegarDuplicados ? items.filter(url => duplicadoDe.has(url)).length : 0;
    hiddenCount = items.length - filtered.length - plegados;

    dupeToggle.hidden = duplicadoDe.size === 0;
    dupeLabel.textContent = plegarDuplicados
      ? `${duplicadoDe.size} duplicado${duplicadoDe.size === 1 ? '' : 's'} agrupado${duplicadoDe.size === 1 ? '' : 's'}`
      : `${duplicadoDe.size} duplicado${duplicadoDe.size === 1 ? '' : 's'} desplegado${duplicadoDe.size === 1 ? '' : 's'}`;

    render();
  }

  render();

  return {
    root,
    setItems(newItems) {
      items = [...new Set(newItems)];
      applyFilter();
    },
    /**
     * Recibe los grupos de duplicados calculados en el servidor.
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
    /** Añade duración y tamaño de los ficheros ya conocidos. */
    setDetails(details) {
      for (const info of details || []) {
        if (info?.url) meta.set(info.url, info);
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
      applyFilter();
    },
  };
}
