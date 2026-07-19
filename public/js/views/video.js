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
  copyIconButton,
  downloadText,
  toast,
} from '../dom.js';
import { extractVideos } from '../api.js';
import { t, texto, atributo, alCambiarIdioma } from '../i18n/index.js';

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
      required: true,
      spellcheck: 'false',
      autocomplete: 'url',
    },
  });
  atributo(urlInput, 'placeholder', 'video.url.placeholder');

  const metadataInput = el('input', { attrs: { type: 'checkbox', id: 'video-metadata' } });
  const jsInput = el('input', { attrs: { type: 'checkbox', id: 'video-js', checked: true } });

  const submitButton = el('button', { className: 'button', attrs: { type: 'submit' } });

  /**
   * El boton alterna entre "Analizar" y "Analizando…", asi que su rotulo se
   * repinta desde una funcion que conoce el estado. Enlazarlo a secas habria
   * devuelto el boton a "Analizar" al cambiar de idioma en mitad del
   * analisis.
   */
  let analizando = false;
  const refrescarBoton = () => {
    setChildren(
      submitButton,
      analizando
        ? [
            el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }),
            t('video.analizando'),
          ]
        : [t('video.analizar')]
    );
  };
  alCambiarIdioma(refrescarBoton);

  const makeSwitch = (input, titleKey, hintKey) =>
    el('label', {
      className: 'switch',
      attrs: { for: input.id },
      children: [
        input,
        el('span', {
          className: 'switch__text',
          children: [
            texto(el('span', { className: 'switch__title' }), titleKey),
            texto(el('span', { className: 'switch__hint' }), hintKey),
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
          texto(
            el('label', { className: 'field__label', attrs: { for: 'video-url' } }),
            'video.url.label'
          ),
          urlInput,
          texto(el('p', { className: 'field__hint' }), 'video.url.hint'),
        ],
      }),
      el('div', {
        className: 'grid grid--2',
        children: [
          makeSwitch(jsInput, 'video.navegador.label', 'video.navegador.hint'),
          makeSwitch(metadataInput, 'video.peso.label', 'video.peso.hint'),
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
          texto(
            el('h2', { className: 'card__title', attrs: { id: 'video-heading' } }),
            'video.titulo'
          ),
          texto(el('p', { className: 'card__hint' }), 'video.subtitulo'),
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
    analizando = busy;
    submitButton.disabled = busy;
    urlInput.disabled = busy;
    metadataInput.disabled = busy;
    jsInput.disabled = busy;
    refrescarBoton();
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

    // Copiar pasa a ser un botón solo-icono pegado a la URL, como en la lista
    // de resultados del Explorador: el pie se queda para "Abrir".
    const actions = [];

    if (/^https?:\/\//i.test(video.url)) {
      actions.push(
        safeLink(video.url, {
          className: 'button button--secondary button--small',
          text: t('video.abrir'),
        })
      );
    }

    return el('div', {
      className: 'video-card',
      children: [
        el('div', { className: 'video-card__head', children: head }),
        el('div', {
          className: 'video-card__link',
          children: [
            // safeLink: la URL viene del sitio analizado
            safeLink(video.url, { className: 'video-card__url' }),
            copyIconButton(video.url),
          ],
        }),
        el('p', {
          className: 'field__hint',
          text: t('video.detectadoPor', { via: video.element || t('video.desconocido') }),
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
        text: t('video.todos', { n: allVideos.length }),
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
        text: t('video.descargar'),
        attrs: { type: 'button', style: 'margin-left:auto' },
        on: {
          click: () => {
            downloadText('urlexplorer-videos.txt', visible.map(v => v.url).join('\n'));
            toast(t('video.descargadas', { n: visible.length }));
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
          title: t('video.sinResultados.titulo'),
          text: t('video.sinResultados.texto'),
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
        title: t('video.vacio.titulo'),
        text: t('video.vacio.texto'),
      })
    );
  }

  form.addEventListener('submit', async submitEvent => {
    submitEvent.preventDefault();
    const url = urlInput.value.trim();

    if (!url) {
      showError(t('error.faltaUrl'), t('video.faltaUrl.body'));
      urlInput.focus();
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      showError(t('error.urlInvalida'), t('error.urlInvalida.body'));
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
            stat(allVideos.length, t('video.stats.videos')),
            stat(new Set(allVideos.map(v => v.type)).size, t('video.stats.formatos')),
            stat(methods.length, t('video.stats.vias')),
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
      showError(t('video.fallo'), error.message);
      renderInitialEmpty();
    } finally {
      setBusy(false);
    }
  });

  renderInitialEmpty();

  // Las tarjetas, las estadisticas y los filtros se construyen con datos, asi
  // que se rehacen enteros al cambiar de idioma. Si hay resultados se
  // repintan; si no, el estado vacio.
  alCambiarIdioma(() => {
    if (allVideos.length > 0) renderResults();
    else renderInitialEmpty();
  });

  return {
    focus() {
      urlInput.focus();
    },
    teardown() {},
  };
}
