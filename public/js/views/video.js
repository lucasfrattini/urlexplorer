import {
  el,
  setChildren,
  clear,
  alertBox,
  emptyState,
  stat,
  badge,
  safeLink,
  show,
  copyToClipboard,
  downloadText,
  toast,
} from '../dom.js';
import { extractVideos } from '../api.js';

/**
 * Vista Videos: analiza una única URL y lista los videos detectados,
 * indicando por qué método se encontró cada uno.
 */
export function createVideoView(container) {
  let allVideos = [];
  let activeType = 'all';

  const urlInput = el('input', {
    className: 'input',
    attrs: {
      id: 'video-url',
      type: 'url',
      placeholder: 'https://ejemplo.com/video/12345',
      required: true,
      spellcheck: 'false',
      autocomplete: 'url',
    },
  });

  const metadataInput = el('input', { attrs: { type: 'checkbox', id: 'video-metadata' } });
  const jsInput = el('input', { attrs: { type: 'checkbox', id: 'video-js', checked: true } });

  const submitButton = el('button', {
    className: 'button',
    text: 'Analizar',
    attrs: { type: 'submit' },
  });

  const makeSwitch = (input, title, hint) =>
    el('label', {
      className: 'switch',
      attrs: { for: input.id },
      children: [
        input,
        el('span', {
          className: 'switch__text',
          children: [
            el('span', { className: 'switch__title', text: title }),
            el('span', { className: 'switch__hint', text: hint }),
          ],
        }),
      ],
    });

  const form = el('form', {
    className: 'grid',
    attrs: { novalidate: true },
    children: [
      el('div', {
        className: 'field',
        children: [
          el('label', {
            className: 'field__label',
            text: 'URL de la página',
            attrs: { for: 'video-url' },
          }),
          urlInput,
          el('p', {
            className: 'field__hint',
            text: 'Se analiza una sola página: DOM renderizado, peticiones de red, players embebidos y URLs dentro de scripts.',
          }),
        ],
      }),
      el('div', {
        className: 'grid grid--2',
        children: [
          makeSwitch(
            jsInput,
            'Renderizar con navegador',
            'Ejecuta el JavaScript y captura las peticiones de red. Detecta videos que no están en el HTML.'
          ),
          makeSwitch(
            metadataInput,
            'Obtener tamaño de fichero',
            'Hace una petición HEAD por cada video. Más lento.'
          ),
        ],
      }),
      el('div', { className: 'button-row', children: [submitButton] }),
    ],
  });

  const formCard = el('div', {
    className: 'card',
    children: [
      el('div', {
        className: 'card__header',
        children: [
          el('h2', {
            className: 'card__title',
            text: 'Extraer videos',
            attrs: { id: 'video-heading' },
          }),
          el('p', {
            className: 'card__hint',
            text: 'Detecta los videos de una página por cuatro vías complementarias.',
          }),
        ],
      }),
      el('div', { className: 'card__body', children: [form] }),
    ],
  });

  const alertSlot = el('div');
  show(alertSlot, false);

  const statsSlot = el('div', { className: 'card__body' });
  const statsCard = el('div', { className: 'card', children: [statsSlot] });
  show(statsCard, false);

  const filterBar = el('div', { className: 'toolbar' });
  const grid = el('div', { className: 'video-grid' });
  const resultsCard = el('div', { className: 'card', children: [filterBar, grid] });

  setChildren(container, [formCard, alertSlot, statsCard, resultsCard]);

  function setBusy(busy) {
    submitButton.disabled = busy;
    urlInput.disabled = busy;
    metadataInput.disabled = busy;
    jsInput.disabled = busy;
    setChildren(
      submitButton,
      busy
        ? [el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }), 'Analizando…']
        : ['Analizar']
    );
  }

  function showError(title, body) {
    setChildren(alertSlot, alertBox({ variant: 'error', title, body }));
    show(alertSlot, true);
  }

  function renderSkeleton() {
    setChildren(
      grid,
      Array.from({ length: 3 }, () =>
        el('div', {
          className: 'video-card',
          children: [
            el('div', { className: 'skeleton', attrs: { style: 'width: 40%' } }),
            el('div', { className: 'skeleton' }),
            el('div', { className: 'skeleton', attrs: { style: 'width: 70%' } }),
          ],
        })
      )
    );
    clear(filterBar);
  }

  function videoCard(video) {
    const head = [badge(video.type, 'accent')];
    if (video.quality) head.push(badge(video.quality));
    if (video.duration) head.push(badge(video.duration));
    if (video.size) head.push(badge(video.size, 'success'));
    if (video.platform) head.push(badge(video.platform, 'warning'));

    const actions = [
      el('button', {
        className: 'button button--secondary button--small',
        text: 'Copiar URL',
        attrs: { type: 'button' },
        on: {
          click: async () => {
            const ok = await copyToClipboard(video.url);
            toast(ok ? 'URL copiada' : 'No se pudo copiar', ok ? 'success' : 'error');
          },
        },
      }),
    ];

    if (/^https?:\/\//i.test(video.url)) {
      actions.push(
        safeLink(video.url, { className: 'button button--secondary button--small', text: 'Abrir' })
      );
    }

    return el('div', {
      className: 'video-card',
      children: [
        el('div', { className: 'video-card__head', children: head }),
        // safeLink: la URL viene del sitio analizado
        safeLink(video.url, { className: 'video-card__url' }),
        el('p', {
          className: 'field__hint',
          text: `Detectado por: ${video.element || 'desconocido'}`,
        }),
        el('div', { className: 'video-card__foot', children: actions }),
      ],
    });
  }

  function renderFilters() {
    const types = [...new Set(allVideos.map(video => video.type))].sort();

    const buttons = [
      el('button', {
        className: `button button--small ${activeType === 'all' ? '' : 'button--secondary'}`,
        text: `Todos (${allVideos.length})`,
        attrs: { type: 'button' },
        on: {
          click: () => {
            activeType = 'all';
            renderResults();
          },
        },
      }),
      ...types.map(type => {
        const count = allVideos.filter(video => video.type === type).length;
        return el('button', {
          className: `button button--small ${activeType === type ? '' : 'button--secondary'}`,
          text: `${type} (${count})`,
          attrs: { type: 'button' },
          on: {
            click: () => {
              activeType = type;
              renderResults();
            },
          },
        });
      }),
    ];

    const visible = allVideos.filter(v => activeType === 'all' || v.type === activeType);

    buttons.push(
      el('button', {
        className: 'button button--secondary button--small',
        text: 'Descargar .txt',
        attrs: { type: 'button', style: 'margin-left:auto' },
        on: {
          click: () => {
            downloadText('urlexplorer-videos.txt', visible.map(v => v.url).join('\n'));
            toast(`${visible.length} URLs descargadas`);
          },
        },
      })
    );

    setChildren(filterBar, buttons);
  }

  function renderResults() {
    const visible = allVideos.filter(v => activeType === 'all' || v.type === activeType);
    renderFilters();

    if (visible.length === 0) {
      setChildren(
        grid,
        emptyState({
          icon: '🎬',
          title: 'No se encontraron videos',
          text: 'Prueba a activar "Renderizar con navegador": muchos sitios cargan el reproductor con JavaScript.',
        })
      );
      return;
    }

    setChildren(grid, visible.map(videoCard));
  }

  function renderInitialEmpty() {
    clear(filterBar);
    setChildren(
      grid,
      emptyState({
        icon: '🎬',
        title: 'Todavía no hay videos',
        text: 'Introduce la URL de una página y pulsa Analizar.',
      })
    );
  }

  form.addEventListener('submit', async submitEvent => {
    submitEvent.preventDefault();
    const url = urlInput.value.trim();

    if (!url) {
      showError('Falta la URL', 'Introduce la URL de la página que quieres analizar.');
      urlInput.focus();
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      showError('URL no válida', 'La URL debe empezar por http:// o https://');
      urlInput.focus();
      return;
    }

    clear(alertSlot);
    show(alertSlot, false);
    show(statsCard, false);
    setBusy(true);
    renderSkeleton();

    try {
      const result = await extractVideos({
        url,
        getMetadata: metadataInput.checked,
        useJavaScript: jsInput.checked,
      });

      allVideos = result.videos || [];
      activeType = 'all';

      const methods = Object.entries(result.methods || {})
        .filter(([, used]) => used)
        .map(([name]) => name);

      setChildren(
        statsSlot,
        el('div', {
          className: 'stats',
          children: [
            stat(allVideos.length, 'Videos'),
            stat(new Set(allVideos.map(v => v.type)).size, 'Formatos'),
            stat(methods.length, 'Métodos con resultados'),
          ],
        })
      );
      show(statsCard, true);

      if (!result.methods?.puppeteer && jsInput.checked) {
        setChildren(
          alertSlot,
          alertBox({
            variant: 'warning',
            title: 'El navegador no se pudo usar',
            body: 'Se analizó solo el HTML. Los videos cargados por JavaScript pueden no aparecer.',
          })
        );
        show(alertSlot, true);
      }

      renderResults();
    } catch (error) {
      showError('No se pudo analizar la página', error.message);
      renderInitialEmpty();
    } finally {
      setBusy(false);
    }
  });

  renderInitialEmpty();

  return {
    focus() {
      urlInput.focus();
    },
    teardown() {},
  };
}
