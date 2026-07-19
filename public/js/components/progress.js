import { el, clear } from '../dom.js';
import { t, tp, texto, atributo, alCambiarIdioma } from '../i18n/index.js';

/**
 * Panel de progreso del crawl.
 *
 * El SSE es el centro de la experiencia, así que el progreso tiene que leerse
 * de un vistazo: dos fases con estado propio, una barra con porcentaje real
 * cuando se conoce el total, y una consola con los hallazgos según aparecen.
 */
export function createProgressPanel() {
  const phase1Detail = el('p', { className: 'phase__detail' });
  const phase2Detail = el('p', { className: 'phase__detail' });

  /**
   * El detalle de cada fase se guarda en CLAVE + params, no como texto ya
   * escrito: es lo unico que permite repintarlo si cambian el idioma con una
   * exploracion a medias. Guardar la frase dejaria el progreso congelado en
   * el idioma anterior mientras sigue avanzando.
   */
  const detalle = new Map();

  function ponerDetalle(nodo, clave, params) {
    if (clave === undefined) return;
    detalle.set(nodo, clave === null ? null : { clave, params });
    nodo.textContent = clave === null ? '' : t(clave, params);
  }

  const phase1 = el('div', {
    className: 'phase',
    attrs: { 'data-state': 'idle' },
    children: [
      el('div', {
        className: 'phase__label',
        children: [texto(el('span', {}), 'progreso.fase1')],
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
        children: [texto(el('span', {}), 'progreso.fase2')],
      }),
      phase2Detail,
    ],
  });

  const barFill = el('div', { className: 'bar__fill' });
  barFill.style.width = '0%';
  const bar = el('div', { className: 'bar', children: [barFill] });

  const feed = el('div', {
    className: 'live-feed',
    attrs: { 'aria-live': 'polite' },
  });
  atributo(feed, 'aria-label', 'progreso.ficherosAria');
  feed.hidden = true;

  const cancelButton = texto(
    el('button', {
      className: 'button button--secondary button--small',
      attrs: { type: 'button' },
    }),
    'progreso.cancelar'
  );

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
  /** Clave del resumen del pie, para repintarlo al cambiar de idioma. */
  let resumenClave = null;

  function setPhase(node, detailNode, state, clave, params) {
    node.setAttribute('data-state', state);
    ponerDetalle(detailNode, clave, params);

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

  alCambiarIdioma(() => {
    for (const [nodo, guardado] of detalle) {
      if (guardado) nodo.textContent = t(guardado.clave, guardado.params);
    }
    if (resumenClave === 'progreso.cancelada') summary.textContent = t(resumenClave);
    else if (resumenClave) summary.textContent = tp(resumenClave, feedCount);
  });

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
      resumenClave = null;
      summary.textContent = '';
      setPhase(phase1, phase1Detail, 'idle', 'progreso.enEspera');
      setPhase(phase2, phase2Detail, 'idle', 'progreso.enEspera');
      setProgress(0);
    },

    startPhase1() {
      setPhase(phase1, phase1Detail, 'active', 'progreso.descargando');
      setProgress(null);
    },

    updatePhase1({ currentPage, totalPages, linksFound, totalLinks }) {
      const found = totalLinks ?? linksFound ?? 0;
      setPhase(phase1, phase1Detail, 'active', 'progreso.paginaDe', {
        actual: currentPage,
        total: totalPages,
        enlaces: found,
      });
      if (totalPages > 0) setProgress(currentPage / totalPages);
    },

    completePhase1({ totalLinks, pagesScraped, truncated }) {
      setPhase(
        phase1,
        phase1Detail,
        'done',
        `progreso.resumenFase1.${pagesScraped === 1 ? 'uno' : 'varios'}`,
        {
          enlaces: totalLinks,
          n: pagesScraped,
          sufijo: truncated ? t('progreso.topeAlcanzado') : '',
        }
      );
      setProgress(1);
    },

    startPhase2({ totalPages }) {
      feed.hidden = false;
      setPhase(phase2, phase2Detail, 'active', 'progreso.analizando', { total: totalPages });
      setProgress(0);
    },

    updatePhase2({ current, total, url }) {
      setPhase(phase2, phase2Detail, 'active', 'progreso.deTotal', { actual: current, total, url });
      if (total > 0) setProgress(current / total);
    },

    addFiles(files) {
      for (const file of files) {
        feedCount += 1;
        // textContent: estas URLs vienen de páginas de terceros
        feed.append(el('div', { className: 'live-feed__item', text: file }));
      }
      feed.scrollTop = feed.scrollHeight;
      resumenClave = 'progreso.hallados';
      summary.textContent = tp(resumenClave, feedCount);
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
      if (aborted) {
        resumenClave = 'progreso.cancelada';
        summary.textContent = t(resumenClave);
      }
    },
  };
}
