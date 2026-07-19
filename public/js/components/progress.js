import { el, clear } from '../dom.js';

/**
 * Panel de progreso del crawl.
 *
 * El SSE es el centro de la experiencia, así que el progreso tiene que leerse
 * de un vistazo: dos fases con estado propio, una barra con porcentaje real
 * cuando se conoce el total, y una consola con los hallazgos según aparecen.
 */
export function createProgressPanel() {
  const phase1Detail = el('p', { className: 'phase__detail', text: 'En espera' });
  const phase2Detail = el('p', { className: 'phase__detail', text: 'En espera' });

  const phase1 = el('div', {
    className: 'phase',
    attrs: { 'data-state': 'idle' },
    children: [
      el('div', {
        className: 'phase__label',
        children: [el('span', { text: '1 · Recorrer páginas' })],
      }),
      phase1Detail,
    ],
  });

  const phase2 = el('div', {
    className: 'phase',
    attrs: { 'data-state': 'idle' },
    children: [
      el('div', {
        className: 'phase__label',
        children: [el('span', { text: '2 · Buscar ficheros' })],
      }),
      phase2Detail,
    ],
  });

  const barFill = el('div', { className: 'bar__fill' });
  barFill.style.width = '0%';
  const bar = el('div', { className: 'bar', children: [barFill] });

  const feed = el('div', {
    className: 'live-feed',
    attrs: { 'aria-live': 'polite', 'aria-label': 'Ficheros encontrados' },
  });
  feed.hidden = true;

  const cancelButton = el('button', {
    className: 'button button--secondary button--small',
    text: 'Cancelar',
    attrs: { type: 'button' },
  });

  const summary = el('p', { className: 'field__hint', text: '' });

  const root = el('div', {
    className: 'progress',
    children: [
      el('div', { className: 'progress__phases', children: [phase1, phase2] }),
      bar,
      el('div', {
        className: 'button-row',
        children: [cancelButton, summary],
      }),
      feed,
    ],
  });

  let feedCount = 0;

  function setPhase(node, detailNode, state, detail) {
    node.setAttribute('data-state', state);
    if (detail !== undefined) detailNode.textContent = detail;

    const label = node.querySelector('.phase__label');
    const existingSpinner = label.querySelector('.spinner');
    if (state === 'active' && !existingSpinner) {
      label.prepend(el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }));
    } else if (state !== 'active' && existingSpinner) {
      existingSpinner.remove();
    }
  }

  function setProgress(ratio) {
    if (ratio === null) {
      bar.classList.add('bar--indeterminate');
      barFill.style.width = '35%';
      return;
    }
    bar.classList.remove('bar--indeterminate');
    barFill.style.width = `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%`;
  }

  return {
    root,
    onCancel(handler) {
      cancelButton.addEventListener('click', handler);
    },

    reset() {
      feedCount = 0;
      clear(feed);
      feed.hidden = true;
      cancelButton.disabled = false;
      summary.textContent = '';
      setPhase(phase1, phase1Detail, 'idle', 'En espera');
      setPhase(phase2, phase2Detail, 'idle', 'En espera');
      setProgress(0);
    },

    startPhase1() {
      setPhase(phase1, phase1Detail, 'active', 'Descargando la primera página…');
      setProgress(null);
    },

    updatePhase1({ currentPage, totalPages, linksFound, totalLinks }) {
      const found = totalLinks ?? linksFound ?? 0;
      setPhase(
        phase1,
        phase1Detail,
        'active',
        `Página ${currentPage} de ${totalPages} · ${found} enlaces`
      );
      if (totalPages > 0) setProgress(currentPage / totalPages);
    },

    completePhase1({ totalLinks, pagesScraped, truncated }) {
      const suffix = truncated ? ' (tope alcanzado)' : '';
      setPhase(
        phase1,
        phase1Detail,
        'done',
        `${totalLinks} enlaces en ${pagesScraped} página${pagesScraped === 1 ? '' : 's'}${suffix}`
      );
      setProgress(1);
    },

    startPhase2({ totalPages }) {
      feed.hidden = false;
      setPhase(phase2, phase2Detail, 'active', `Analizando ${totalPages} páginas…`);
      setProgress(0);
    },

    updatePhase2({ current, total, url }) {
      setPhase(phase2, phase2Detail, 'active', `${current} de ${total} · ${url}`);
      if (total > 0) setProgress(current / total);
    },

    addFiles(files) {
      for (const file of files) {
        feedCount += 1;
        // textContent: estas URLs vienen de páginas de terceros
        feed.append(el('div', { className: 'live-feed__item', text: file }));
      }
      feed.scrollTop = feed.scrollHeight;
      summary.textContent = `${feedCount} fichero${feedCount === 1 ? '' : 's'} encontrado${
        feedCount === 1 ? '' : 's'
      }`;
    },

    finish({ aborted } = {}) {
      cancelButton.disabled = true;
      setProgress(1);
      if (phase1.getAttribute('data-state') === 'active') {
        setPhase(phase1, phase1Detail, 'done');
      }
      if (phase2.getAttribute('data-state') === 'active') {
        setPhase(phase2, phase2Detail, 'done');
      }
      if (aborted) summary.textContent = 'Búsqueda cancelada';
    },
  };
}
