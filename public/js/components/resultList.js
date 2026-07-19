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
    children: [counter, hiddenBadge, search, exclude, sortSelect, copyButton, downloadButton],
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

    hiddenCount = items.length - filtered.length;
    render();
  }

  render();

  return {
    root,
    setItems(newItems) {
      items = [...new Set(newItems)];
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
      search.value = '';
      exclude.value = '';
      sortSelect.value = 'orden';
      sortBy = 'orden';
      applyFilter();
    },
  };
}
