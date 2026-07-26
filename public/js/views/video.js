import {
  el,
  setChildren,
  clear,
  alertBox,
  emptyState,
  badge,
  safeLink,
  show,
  copyIconButton,
  copyToClipboard,
  downloadText,
  toast,
} from '../dom.js';
import { extractVideos } from '../api.js';
import { t, tp, texto, atributo, alCambiarIdioma } from '../i18n/index.js';
import { createRangeFilter, formatDuration, formatBytes } from '../components/rangeSlider.js';
import { aCSV, aJSON, aListaDeDescarga, construirFilas } from '../exportFormats.js';
import {
  construirParamsVideo,
  indexarGrupos,
  miembrosPlegados,
  filtrarVideos,
  ordenarVideos,
  segundosDe,
  bytesDe,
} from './videoOptions.js';

/**
 * Vista Vídeo: analiza una o varias direcciones y lista los videos
 * detectados, agrupando los duplicados igual que el Explorador.
 *
 * ── Sobre esta vista ───────────────────────────────────────────────────
 *
 * `urlInput` (la primera dirección) + `filasUrlExtra` (el resto) siguen el
 * MISMO patrón multi-URL de `views/explorer.js`: una fila fija y filas
 * adicionales que son solo interfaz. Se manda siempre `urls` (array) al
 * backend, aunque sea una sola dirección: es el shape que ya trae `groups`
 * calculados sobre la fusión de todas.
 *
 * Los duplicados (grupos, expandir, "Elegido", "No es duplicado", ocultar /
 * deshacer / restaurar) replican el patrón de `components/resultList.js`
 * (el Explorador), con la misma micro-copia (mismas claves `resultados.*` y
 * `filtros.agrupar.*`): son el mismo concepto, así que es la misma frase.
 */
export function createVideoView(container) {
  // ── Estado ────────────────────────────────────────────────────────────
  let meta = new Map(); // url -> vídeo tal como lo manda el servidor
  let order = []; // urls en el orden recibido, sin repetidos
  let methodsUsados = {};
  let direccionesAnalizadas = 0;
  let direccionesTotal = 0;
  let huboResultado = false;
  let ultimosVisibles = [];

  // Quitados a mano: NADA se borra de `meta`/`order`, quitar es solo una
  // vista, igual que en el Explorador. `tandas` guarda cada borrado por
  // separado para que "Deshacer" devuelva solo el último.
  let ocultos = new Set();
  const tandas = [];

  // Duplicados calculados por el servidor sobre la fusión de todas las
  // direcciones. `desagrupados` es una CORRECCIÓN del usuario y pesa más que
  // el algoritmo: una vez sacado de su grupo, no vuelve a plegarse.
  let grupos = new Map();
  let duplicadoDe = new Map();
  const desagrupados = new Set();
  const expandidos = new Set();
  let plegarDuplicados = true;

  let activeType = 'all';
  let viewMode = 'grid';
  let analizando = false;
  let controllerActual = null;

  /**
   * Orden actual de la lista: qué columna y en qué sentido. Se aplica en las
   * DOS vistas (cajas y lista), aunque el control clicable de cabecera solo
   * exista en la vista de lista — mismo patrón que `resultList.js`.
   */
  let orden = { campo: 'orden', direccion: 'asc' };

  // Filtros de rango: un vídeo SIN el dato nunca lo recorta el rango, solo
  // lo saca el interruptor correspondiente (misma regla central que en el
  // Explorador, ver components/resultList.js).
  let ocultarSinDuracion = false;
  let ocultarSinPeso = false;

  // ── Direcciones a analizar (multi-URL) ────────────────────────────────

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

  let contadorFilaUrl = 0;
  /** @type {Array<{ id: string, input: HTMLInputElement }>} */
  let filasUrlExtra = [];

  function crearInputUrlExtra(valor = '') {
    const input = el('input', {
      className: 'input',
      attrs: { type: 'url', autocomplete: 'url', spellcheck: 'false', value: valor },
    });
    atributo(input, 'aria-label', 'video.urls.extra.aria');
    atributo(input, 'placeholder', 'video.url.placeholder');
    return input;
  }

  function crearBotonQuitarFila(onClick) {
    const boton = el('button', {
      className: 'button button--secondary button--icon',
      text: '✕',
      attrs: { type: 'button' },
      on: { click: onClick },
    });
    atributo(boton, 'aria-label', 'video.urls.quitar');
    atributo(boton, 'title', 'video.urls.quitar');
    return boton;
  }

  const listaFilasExtra = el('div', { className: 'url-list' });

  function pintarFilasUrl() {
    quitarPrimeraBtn.disabled = filasUrlExtra.length === 0;
    setChildren(
      listaFilasExtra,
      filasUrlExtra.map(fila =>
        el('div', {
          className: 'url-row',
          children: [
            fila.input,
            crearBotonQuitarFila(() => {
              filasUrlExtra = filasUrlExtra.filter(f => f.id !== fila.id);
              pintarFilasUrl();
            }),
          ],
        })
      )
    );
  }

  function agregarFilaExtra(valor = '') {
    const id = `video-url-extra-${contadorFilaUrl++}`;
    filasUrlExtra = [...filasUrlExtra, { id, input: crearInputUrlExtra(valor) }];
    pintarFilasUrl();
  }

  // Quitar la primera fila promueve la siguiente: `urlInput` sigue siendo EL
  // campo de la primera fila, no se destruye.
  const quitarPrimeraBtn = crearBotonQuitarFila(() => {
    if (filasUrlExtra.length === 0) return;
    const [primera, ...resto] = filasUrlExtra;
    urlInput.value = primera.input.value;
    filasUrlExtra = resto;
    pintarFilasUrl();
  });

  const filaPrincipal = el('div', {
    className: 'url-row',
    children: [urlInput, quitarPrimeraBtn],
  });

  const agregarUrlBtn = el('button', {
    className: 'link-toggle',
    attrs: { type: 'button' },
    on: { click: () => agregarFilaExtra() },
  });
  texto(agregarUrlBtn, 'video.urls.agregar');

  function readUrls() {
    return [urlInput.value, ...filasUrlExtra.map(f => f.input.value)]
      .map(u => u.trim())
      .filter(Boolean);
  }

  pintarFilasUrl(); // Estado inicial: sin filas extra, "quitar" deshabilitado.

  // ── Interruptores ──────────────────────────────────────────────────────

  const jsInput = el('input', { attrs: { type: 'checkbox', id: 'video-js' } });
  // Arranca destildado: usar el navegador es más lento y no todos los sitios
  // lo necesitan, así que no debe activarse solo sin que el usuario lo pida.
  const metadataInput = el('input', { attrs: { type: 'checkbox', id: 'video-metadata' } });
  // Interruptor SEPARADO del de peso/duración: pedir miniaturas es otra
  // llamada de red por vídeo y otra decisión de privacidad, así que se elige
  // aparte. Desactivado por defecto, igual que el resto de lo opcional.
  const thumbInput = el('input', { attrs: { type: 'checkbox', id: 'video-thumb' } });

  const submitButton = el('button', {
    className: 'button button--large',
    attrs: { type: 'submit' },
  });
  const cancelButton = el('button', {
    className: 'button button--secondary',
    attrs: { type: 'button' },
  });
  texto(cancelButton, 'video.cancelar');
  show(cancelButton, false);

  /**
   * El botón alterna entre "Analizar" y "Analizando…", así que su rótulo se
   * repinta desde una función que conoce el estado. Enlazarlo a secas habría
   * devuelto el botón a "Analizar" al cambiar de idioma en mitad del
   * análisis.
   */
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
          el('div', { className: 'url-list', children: [filaPrincipal, listaFilasExtra] }),
          agregarUrlBtn,
          texto(el('p', { className: 'field__hint' }), 'video.url.hint'),
        ],
      }),
      el('div', {
        className: 'grid grid--3',
        children: [
          makeSwitch(jsInput, 'video.navegador.label', 'video.navegador.hint'),
          makeSwitch(metadataInput, 'video.peso.label', 'video.peso.hint'),
          makeSwitch(thumbInput, 'video.miniatura.label', 'video.miniatura.hint'),
        ],
      }),
      el('div', { className: 'button-row', children: [submitButton, cancelButton] }),
    ],
  });

  // ── Alerta (clave + params, nunca nodo ya construido) ──────────────────

  const alertSlot = el('div');
  show(alertSlot, false);
  let ultimaAlerta = null;

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
      alertSlot,
    ],
  });

  function pintarAlerta() {
    if (!ultimaAlerta) return;
    const { variant, tituloKey, bodyKey, bodyTexto, params } = ultimaAlerta;
    setChildren(
      alertSlot,
      alertBox({
        variant,
        title: t(tituloKey, params),
        body: bodyTexto ?? (bodyKey ? t(bodyKey, params) : undefined),
      })
    );
    show(alertSlot, true);
  }
  alCambiarIdioma(pintarAlerta);

  function mostrarAviso(variant, tituloKey, bodyKey, params, bodyTexto) {
    ultimaAlerta = { variant, tituloKey, bodyKey, bodyTexto, params };
    pintarAlerta();
  }
  function showError(tituloKey, bodyKey, params, bodyTexto) {
    mostrarAviso('error', tituloKey, bodyKey, params, bodyTexto);
  }
  function clearAlert() {
    ultimaAlerta = null;
    clear(alertSlot);
    show(alertSlot, false);
  }

  // ── Cifras (KPI) ────────────────────────────────────────────────────────

  const statsSlot = el('div', { className: 'card__body' });
  const statsCard = el('div', { className: 'card', children: [statsSlot] });
  show(statsCard, false);

  function kpiCard(valor, etiqueta, { acento = false, advertencia = false } = {}) {
    const clases = ['kpi'];
    if (acento) clases.push('kpi--acento');
    if (advertencia) clases.push('kpi--advertencia');
    return el('div', {
      className: clases.join(' '),
      children: [
        el('div', { className: 'kpi__valor', text: valor }),
        el('div', { className: 'kpi__etiqueta', text: etiqueta }),
      ],
    });
  }

  function renderStats() {
    const formatos = new Set(order.map(u => meta.get(u)?.type).filter(Boolean)).size;
    const vias = Object.values(methodsUsados).filter(Boolean).length;
    setChildren(
      statsSlot,
      el('div', {
        className: 'kpi-grid',
        children: [
          kpiCard(order.length, t('video.stats.videos'), { acento: true }),
          kpiCard(formatos, t('video.stats.formatos')),
          kpiCard(vias, t('video.stats.vias')),
        ],
      })
    );
  }

  // ── Cabecera de resultados: acciones ────────────────────────────────────

  const contador = el('span', { className: 'results__count' });

  const undoButton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: {
      click: () => {
        const ultima = tandas.pop();
        if (!ultima) return;
        for (const url of ultima) ocultos.delete(url);
        renderResults();
      },
    },
  });
  texto(undoButton, 'resultados.deshacer');
  atributo(undoButton, 'title', 'resultados.deshacer.title');
  undoButton.hidden = true;

  const restoreButton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: {
      click: () => {
        ocultos = new Set();
        tandas.length = 0;
        renderResults();
      },
    },
  });
  atributo(restoreButton, 'title', 'resultados.restaurar.title');
  restoreButton.hidden = true;

  function crearToggle(id, etiquetaKey, tituloKey) {
    const input = el('input', { attrs: { type: 'checkbox', id } });
    // `texto` es el helper importado: una variable local con ese nombre lo
    // taparía (ya pasó una vez en resultList.js), por eso esta se llama
    // `etiqueta`.
    const etiqueta = el('span', { className: 'toggle__text' });
    if (etiquetaKey) texto(etiqueta, etiquetaKey);
    const root = el('label', {
      className: 'toggle',
      attrs: { for: id },
      children: [input, etiqueta],
    });
    if (tituloKey) atributo(root, 'title', tituloKey);
    return { root, input, etiqueta };
  }

  const agruparToggle = crearToggle('video-agrupar', null, 'filtros.agrupar.title');
  agruparToggle.input.checked = true;
  agruparToggle.input.addEventListener('change', () => {
    plegarDuplicados = agruparToggle.input.checked;
    renderResults();
  });
  agruparToggle.root.hidden = true;

  // Mismas claves i18n que el Explorador: es el mismo concepto ("un vídeo sin
  // este dato no lo recorta el rango, solo lo saca este interruptor").
  const toggleSinDuracion = crearToggle(
    'video-hide-no-duration',
    'filtros.ocultarSinDuracion',
    'filtros.ocultarSinDuracion.title'
  );
  toggleSinDuracion.input.addEventListener('change', () => {
    ocultarSinDuracion = toggleSinDuracion.input.checked;
    renderResults();
  });

  const toggleSinPeso = crearToggle(
    'video-hide-no-size',
    'filtros.ocultarSinPeso',
    'filtros.ocultarSinPeso.title'
  );
  toggleSinPeso.input.addEventListener('change', () => {
    ocultarSinPeso = toggleSinPeso.input.checked;
    renderResults();
  });

  const viewGridBtn = el('button', {
    className: 'view-toggle__btn',
    text: '▦',
    attrs: { type: 'button' },
    on: {
      click: () => {
        viewMode = 'grid';
        renderResults();
      },
    },
  });
  atributo(viewGridBtn, 'title', 'video.vista.cajas');
  atributo(viewGridBtn, 'aria-label', 'video.vista.cajas');

  const viewListBtn = el('button', {
    className: 'view-toggle__btn',
    text: '☰',
    attrs: { type: 'button' },
    on: {
      click: () => {
        viewMode = 'list';
        renderResults();
      },
    },
  });
  atributo(viewListBtn, 'title', 'video.vista.lista');
  atributo(viewListBtn, 'aria-label', 'video.vista.lista');

  const viewToggleGroup = el('div', {
    className: 'view-toggle',
    attrs: { role: 'group' },
    children: [viewGridBtn, viewListBtn],
  });

  /**
   * "Exportar ▾": agrupa .txt/.csv/.json/lista en un menú compacto, mismo
   * patrón EXACTO que `resultList.js` (el Explorador). Siempre exporta lo
   * VISIBLE actual (`ultimosVisibles`), nunca `order`/`meta` completos, para
   * respetar los filtros activos.
   */
  function filasExportables() {
    return construirFilas(
      ultimosVisibles.map(v => v.url),
      {
        info: url => meta.get(url),
        grupoDe: url => (plegarDuplicados ? grupos.get(url) : null),
      }
    );
  }

  const downloadMenuItem = el('button', {
    className: 'export-menu__item',
    attrs: { type: 'button', role: 'menuitem' },
    on: {
      click: () => {
        downloadText('urlexplorer-videos.txt', ultimosVisibles.map(v => v.url).join('\n'));
        toast(t('resultados.descargados', { n: ultimosVisibles.length }));
        alternarMenuExportar(false);
      },
    },
  });
  texto(downloadMenuItem, 'resultados.descargar');

  const crearItemExportar = (claveTexto, extension, formato, construir, tipo) => {
    const boton = el('button', {
      className: 'export-menu__item',
      attrs: { type: 'button', role: 'menuitem' },
      on: {
        click: () => {
          const filas = filasExportables();
          downloadText(`urlexplorer-videos${extension}`, construir(filas), tipo);
          toast(t('resultados.exportados', { n: filas.length, formato }));
          alternarMenuExportar(false);
        },
      },
    });
    texto(boton, claveTexto);
    return boton;
  };

  const csvMenuItem = crearItemExportar('resultados.csv', '.csv', 'CSV', aCSV, 'text/csv');
  const jsonMenuItem = crearItemExportar(
    'resultados.json',
    '.json',
    'JSON',
    filas => aJSON(filas, { filtrado: ultimosVisibles.length !== order.length }),
    'application/json'
  );
  const listaMenuItem = crearItemExportar(
    'resultados.lista',
    '-lista.txt',
    'lista',
    aListaDeDescarga
  );
  atributo(listaMenuItem, 'title', 'resultados.lista.title');

  const exportMenu = el('div', {
    className: 'export-menu',
    attrs: { role: 'menu' },
    children: [downloadMenuItem, csvMenuItem, jsonMenuItem, listaMenuItem],
  });
  exportMenu.hidden = true;

  const exportToggleButton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    on: {
      click: clickEvent => {
        clickEvent.stopPropagation();
        alternarMenuExportar();
      },
    },
  });
  texto(exportToggleButton, 'resultados.exportar');
  exportToggleButton.disabled = true;

  /** Abre o cierra el menú. Sin argumento, invierte el estado actual. */
  function alternarMenuExportar(forzarAbierto) {
    const abrir = forzarAbierto ?? exportMenu.hidden;
    exportMenu.hidden = !abrir;
    exportToggleButton.setAttribute('aria-expanded', String(abrir));
  }

  const exportDropdown = el('div', {
    className: 'export-dropdown',
    children: [exportToggleButton, exportMenu],
  });

  // Cerrar al hacer click fuera: un menú que solo se cierra pulsando el mismo
  // botón que lo abrió se queda abierto estorbando el resto de la tarjeta.
  document.addEventListener('click', clickEvent => {
    if (exportMenu.hidden) return;
    if (exportDropdown.contains(clickEvent.target)) return;
    alternarMenuExportar(false);
  });

  const copyAllButton = el('button', {
    className: 'button button--small',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const ok = await copyToClipboard(ultimosVisibles.map(v => v.url).join('\n'));
        toast(
          ok ? t('resultados.copiados', { n: ultimosVisibles.length }) : t('resultados.noCopiado'),
          ok ? 'success' : 'error'
        );
      },
    },
  });
  texto(copyAllButton, 'resultados.copiar');
  copyAllButton.disabled = true;

  const cabeceraResultados = el('div', {
    className: 'results__head',
    children: [
      texto(el('h3', { className: 'card__title' }), 'resultados.titulo'),
      contador,
      el('div', {
        className: 'results__actions',
        children: [
          undoButton,
          restoreButton,
          agruparToggle.root,
          viewToggleGroup,
          exportDropdown,
          copyAllButton,
        ],
      }),
    ],
  });

  // ── Filtros: búsqueda + tipo de archivo ────────────────────────────────

  const searchInput = el('input', {
    className: 'input',
    attrs: { type: 'search' },
    on: { input: () => renderResults() },
  });
  atributo(searchInput, 'placeholder', 'filtros.buscar');
  atributo(searchInput, 'aria-label', 'filtros.buscar.aria');

  const typeFilterBar = el('div', { className: 'filters__row' });

  // Filtros de rango: MISMOS componente y criterio que el Explorador
  // (components/rangeSlider.js). Los extremos se recalculan con TODOS los
  // vídeos recibidos, nunca solo los visibles, en `recalcularRangos()`.
  const filtroDuracion = createRangeFilter({
    labelKey: 'columnas.duracion',
    format: formatDuration,
    onChange: () => renderResults(),
  });

  const filtroPeso = createRangeFilter({
    labelKey: 'columnas.peso',
    format: formatBytes,
    onChange: () => renderResults(),
  });

  /**
   * Nota que explica la regla menos evidente del panel: un vídeo sin el dato
   * NO desaparece al mover el slider, solo lo saca el interruptor. Misma
   * clave que el Explorador: es la misma frase para el mismo concepto.
   */
  const nota = texto(el('p', { className: 'filters__note' }), 'filtros.nota');

  const filtros = el('div', {
    className: 'filters',
    children: [
      el('div', { className: 'filters__row filters__row--text', children: [searchInput] }),
      typeFilterBar,
      el('div', {
        className: 'filters__row filters__row--ranges',
        children: [filtroDuracion.root, filtroPeso.root],
      }),
      el('div', {
        className: 'filters__row filters__row--flags',
        children: [toggleSinDuracion.root, toggleSinPeso.root],
      }),
      nota,
    ],
  });

  function renderTypeFilterBar(base) {
    const types = [...new Set(base.map(v => v.type))].sort();

    const botones = [
      el('button', {
        className: `button button--small ${activeType === 'all' ? '' : 'button--secondary'}`,
        text: t('video.todos', { n: base.length }),
        attrs: { type: 'button' },
        on: {
          click: () => {
            activeType = 'all';
            renderResults();
          },
        },
      }),
      ...types.map(type => {
        const count = base.filter(v => v.type === type).length;
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

    setChildren(typeFilterBar, botones);
  }

  // ── Cuerpo de resultados: cajas o lista ─────────────────────────────────

  const grid = el('div', { className: 'video-grid' });
  const listHead = el('div', { className: 'result-head video-list-head', attrs: { role: 'row' } });
  const list = el('ul', { className: 'result-list' });
  const listWrap = el('div', { children: [listHead, list] });
  show(listWrap, false);
  const emptySlot = el('div');
  show(emptySlot, false);

  const resultsCard = el('div', {
    className: 'card results',
    children: [cabeceraResultados, filtros, grid, listWrap, emptySlot],
  });

  setChildren(container, [formCard, statsCard, resultsCard]);

  /** Quita un resultado. Sin confirmación: es reversible (deshacer/restaurar). */
  function ocultar(url) {
    if (ocultos.has(url)) return;
    ocultos.add(url);
    tandas.push([url]);
    renderResults();
  }

  /** Despliega o pliega los miembros plegados de un vídeo representante. */
  function alternarGrupo(url) {
    if (expandidos.has(url)) expandidos.delete(url);
    else expandidos.add(url);
    renderResults();
  }

  /**
   * Saca un vídeo de su grupo y lo devuelve a la lista principal. Pesa más
   * que el algoritmo: sigue así aunque se recalculen los grupos.
   */
  function sacarDelGrupo(url) {
    desagrupados.add(url);
    toast(t('resultados.grupo.sacado'));
    renderResults();
  }

  /** Celda de miniatura: imagen si hay, si no un hueco del mismo tamaño para no desalinear la fila. */
  function miniaturaCelda(video) {
    if (!video.thumbnailUrl) {
      return el('span', { className: 'result-item__thumb miembro__thumb--vacia' });
    }
    // El `src` apunta SIEMPRE a nuestro propio servidor, nunca al CDN del
    // sitio: es lo que mantiene la IP del usuario fuera de los sitios
    // explorados y permite que la CSP siga siendo `img-src 'self' data:`.
    return el('img', {
      className: 'result-item__thumb',
      attrs: {
        src: `/api/thumbnail?url=${encodeURIComponent(video.thumbnailUrl)}`,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
        width: '64',
        height: '36',
      },
    });
  }

  /**
   * Panel de miembros plegados de un grupo: el representante va primero,
   * marcado como "elegido", y cada miembro lleva miniatura, duración y peso
   * — los tres datos con los que se decide si de verdad es el mismo vídeo.
   */
  function construirMiembrosBlock(representante, miembros) {
    const grupo = grupos.get(representante);
    const motivo = grupo?.motivos?.[0]?.texto || t('resultados.duplicados.motivoPorDefecto');

    const filas = [representante, ...miembros].map(url => {
      const esElegido = url === representante;
      const video = meta.get(url);

      return el('div', {
        className: esElegido ? 'miembro miembro--elegido' : 'miembro',
        children: [
          video
            ? miniaturaCelda(video)
            : el('span', { className: 'miembro__thumb miembro__thumb--vacia' }),
          el('div', {
            className: 'miembro__datos',
            children: [
              el('div', {
                className: 'miembro__cabecera',
                children: [
                  safeLink(url, { className: 'miembro__url' }),
                  esElegido
                    ? el('span', {
                        className: 'badge badge--success miembro__elegido',
                        text: t('resultados.grupo.elegido'),
                        attrs: { title: t('resultados.grupo.elegido.title') },
                      })
                    : null,
                ],
              }),
              el('div', {
                className: 'miembro__meta',
                children: [
                  el('span', {
                    className: 'miembro__dato',
                    text: video?.duration || '—',
                    attrs: { 'data-label': t('columnas.duracion') },
                  }),
                  el('span', {
                    className: 'miembro__dato',
                    text: video?.size || '—',
                    attrs: { 'data-label': t('columnas.peso') },
                  }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'miembro__acciones',
            children: [
              copyIconButton(url),
              esElegido
                ? null
                : el('button', {
                    className: 'button button--secondary button--small miembro__sacar',
                    text: t('resultados.grupo.noEsDuplicado'),
                    attrs: { type: 'button', title: t('resultados.grupo.noEsDuplicado.title') },
                    on: {
                      click: clickEvent => {
                        clickEvent.preventDefault();
                        clickEvent.stopPropagation();
                        sacarDelGrupo(url);
                      },
                    },
                  }),
            ],
          }),
        ],
      });
    });

    return el('div', {
      className: 'miembros',
      children: [
        el('p', {
          className: 'miembros__motivo',
          text: t('resultados.grupo.agrupadoPor', { motivo }),
        }),
        ...filas,
      ],
    });
  }

  function marcaGrupoBadge(video, plegados, estaExpandido) {
    if (plegados.length === 0) return null;
    return el('button', {
      className: 'badge badge--warning result-item__dupe',
      text: `+${plegados.length}${estaExpandido ? ' ▾' : ' ▸'}`,
      attrs: {
        type: 'button',
        'aria-expanded': String(estaExpandido),
        title: t(estaExpandido ? 'resultados.grupo.plegar' : 'resultados.grupo.desplegar', {
          n: plegados.length,
        }),
      },
      on: {
        click: clickEvent => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          alternarGrupo(video.url);
        },
      },
    });
  }

  function videoCard(video, { plegados = [], estaExpandido = false } = {}) {
    const head = [badge(video.type, 'accent')];
    if (video.quality) head.push(badge(video.quality));
    if (video.duration) head.push(badge(video.duration));
    if (video.size) head.push(badge(video.size, 'success'));
    if (video.platform) head.push(badge(video.platform, 'warning'));
    const marcaGrupo = marcaGrupoBadge(video, plegados, estaExpandido);
    if (marcaGrupo) head.push(marcaGrupo);

    const miniatura = video.thumbnailUrl ? miniaturaCelda(video) : null;

    const actions = [];
    if (/^https?:\/\//i.test(video.url)) {
      actions.push(
        safeLink(video.url, {
          className: 'button button--secondary button--small',
          text: t('video.abrir'),
        })
      );
    }
    actions.push(
      el('button', {
        className: 'button button--secondary button--icon',
        text: '✕',
        attrs: {
          type: 'button',
          'aria-label': t('resultados.ocultar'),
          title: t('resultados.ocultar'),
        },
        on: { click: () => ocultar(video.url) },
      })
    );

    const clases = ['video-card'];
    if (plegados.length > 0) clases.push('result-item--grupo');
    if (estaExpandido) clases.push('result-item--expandido');

    return el('div', {
      className: clases.join(' '),
      on:
        plegados.length > 0
          ? {
              click: clickEvent => {
                if (clickEvent.target.closest('a, button')) return;
                alternarGrupo(video.url);
              },
            }
          : undefined,
      children: [
        miniatura,
        el('div', { className: 'video-card__head', children: head }),
        el('div', {
          className: 'video-card__link',
          children: [
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

  function videoListRow(
    video,
    { plegados = [], estaExpandido = false, conMiniaturas = false } = {}
  ) {
    const marcaGrupo = marcaGrupoBadge(video, plegados, estaExpandido);
    const miniatura = conMiniaturas ? miniaturaCelda(video) : null;

    const clases = ['result-item', 'video-list-row'];
    if (conMiniaturas) clases.push('video-list-row--con-miniatura');
    if (plegados.length > 0) clases.push('result-item--grupo');
    if (estaExpandido) clases.push('result-item--expandido');

    return el('li', {
      className: clases.join(' '),
      attrs: { role: 'row' },
      on:
        plegados.length > 0
          ? {
              click: clickEvent => {
                if (clickEvent.target.closest('a, button')) return;
                alternarGrupo(video.url);
              },
            }
          : undefined,
      children: [
        miniatura,
        el('span', { className: 'badge badge--accent', text: video.type }),
        el('span', {
          className: 'result-item__main',
          children: [
            safeLink(video.url, { className: 'result-item__link' }),
            marcaGrupo,
            copyIconButton(video.url),
            el('button', {
              className: 'button button--secondary button--icon result-item__quitar',
              text: '✕',
              attrs: { type: 'button', 'aria-label': t('resultados.ocultar') },
              on: {
                click: clickEvent => {
                  clickEvent.preventDefault();
                  clickEvent.stopPropagation();
                  ocultar(video.url);
                },
              },
            }),
          ],
        }),
        el('span', { className: 'result-item__col', text: video.duration || '—' }),
        el('span', { className: 'result-item__col', text: video.size || '—' }),
        el('span', { className: 'field__hint', text: video.element || t('video.desconocido') }),
      ],
    });
  }

  /**
   * Sentido con el que se empieza al pulsar una columna nueva: de duración y
   * peso interesa primero lo más grande, del enlace lo primero alfabético.
   * Misma regla que `direccionInicial()` en resultList.js.
   */
  function direccionInicialVideo(campo) {
    return campo === 'duracion' || campo === 'peso' ? 'desc' : 'asc';
  }

  /**
   * Celda de cabecera ordenable: pulsarla ordena por esa columna, volver a
   * pulsarla invierte el sentido. Se reconstruye en cada `renderListHead()`
   * (llamado desde `renderResults()`), así que SIEMPRE refleja el `orden`
   * actual sin necesitar un repintado aparte — y de paso evita enlazar el
   * texto con `texto()` dentro de una función que se llama en cada repintado
   * (eso dejaría una suscripción nueva de i18n cada vez, sin liberar nunca la
   * anterior).
   */
  function celdaOrdenable(campo, claveTexto) {
    const activa = orden.campo === campo;
    const etiqueta = el('span', { className: 'result-head__etiqueta', text: t(claveTexto) });
    const flecha = el('span', {
      className: 'result-head__flecha',
      text: activa ? (orden.direccion === 'asc' ? '▲' : '▼') : '',
      attrs: { 'aria-hidden': 'true' },
    });
    const boton = el('button', {
      className: `result-head__sort${activa ? ' result-head__sort--activa' : ''}`,
      attrs: { type: 'button' },
      children: [etiqueta, flecha],
      on: {
        click: () => {
          orden =
            orden.campo === campo
              ? { campo, direccion: orden.direccion === 'asc' ? 'desc' : 'asc' }
              : { campo, direccion: direccionInicialVideo(campo) };
          renderResults();
        },
      },
    });
    return el('div', {
      className: 'result-head__celda',
      attrs: {
        'aria-sort': activa ? (orden.direccion === 'asc' ? 'ascending' : 'descending') : 'none',
      },
      children: [boton],
    });
  }

  function renderListHead(conMiniaturas) {
    listHead.classList.toggle('video-list-head--con-miniatura', conMiniaturas);
    setChildren(listHead, [
      conMiniaturas ? el('span', {}) : null,
      el('span', { className: 'result-head__etiqueta', text: t('video.columnas.tipo') }),
      celdaOrdenable('url', 'columnas.enlace'),
      celdaOrdenable('duracion', 'columnas.duracion'),
      celdaOrdenable('peso', 'columnas.peso'),
      el('span', { className: 'result-head__etiqueta', text: t('video.columnas.detectado') }),
    ]);
  }

  function fillGrid(visibles) {
    const nodes = visibles.map(video => {
      const plegados = plegarDuplicados ? miembrosPlegados(grupos, video.url, desagrupados) : [];
      const estaExpandido = expandidos.has(video.url);
      const tarjeta = videoCard(video, { plegados, estaExpandido });
      if (!estaExpandido || plegados.length === 0) return tarjeta;
      return [
        tarjeta,
        el('div', {
          className: 'video-grid__grupo-panel',
          children: [construirMiembrosBlock(video.url, plegados)],
        }),
      ];
    });
    setChildren(grid, nodes.flat());
  }

  function fillList(visibles) {
    const conMiniaturas = visibles.some(v => v.thumbnailUrl);
    renderListHead(conMiniaturas);

    const nodes = visibles.map(video => {
      const plegados = plegarDuplicados ? miembrosPlegados(grupos, video.url, desagrupados) : [];
      const estaExpandido = expandidos.has(video.url);
      const fila = videoListRow(video, { plegados, estaExpandido, conMiniaturas });
      if (!estaExpandido || plegados.length === 0) return fila;
      return [
        fila,
        el('li', {
          className: 'result-item result-item--miembros',
          children: [construirMiembrosBlock(video.url, plegados)],
        }),
      ];
    });
    setChildren(list, nodes.flat());
  }

  function renderSkeleton() {
    show(emptySlot, false);
    show(listWrap, false);
    show(grid, true);
    clear(typeFilterBar);
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
  }

  function renderInitialEmpty() {
    clear(typeFilterBar);
    contador.textContent = '';
    undoButton.hidden = true;
    restoreButton.hidden = true;
    agruparToggle.root.hidden = true;
    copyAllButton.disabled = true;
    exportToggleButton.disabled = true;
    show(grid, false);
    show(listWrap, false);
    show(emptySlot, true);
    setChildren(
      emptySlot,
      emptyState({ icon: '🎬', title: t('video.vacio.titulo'), text: t('video.vacio.texto') })
    );
  }

  /**
   * Recalcula los extremos de los dos rangos con TODOS los vídeos recibidos
   * (nunca solo los visibles), para que estrechar cualquier otro filtro no
   * encoja también el propio rango. Mismo criterio que `recalcularRangos()`
   * en `components/resultList.js`.
   */
  function recalcularRangos() {
    const videos = order.map(u => meta.get(u)).filter(Boolean);
    filtroDuracion.setValues(videos.map(segundosDe).filter(v => v !== null));
    filtroPeso.setValues(videos.map(bytesDe).filter(v => v !== null));
  }

  /**
   * Repinta toda la tarjeta de resultados a partir del estado. Se llama tras
   * CUALQUIER cambio (búsqueda, filtro de tipo, ocultar, deshacer, expandir
   * un grupo, sacar un miembro, cambiar de vista, cambiar de idioma…), igual
   * que `applyFilter()` en resultList.js: más simple y más difícil de dejar
   * un rincón desincronizado que actualizar cada trozo por separado.
   */
  function renderResults() {
    if (!huboResultado) {
      renderInitialEmpty();
      return;
    }

    const base = order.map(u => meta.get(u)).filter(Boolean);
    const rangoDuracion = filtroDuracion.getRange();
    const rangoPeso = filtroPeso.getRange();
    const sinTipoNiTexto = filtrarVideos(base, {
      ocultos,
      duplicadoDe,
      desagrupados,
      plegarDuplicados,
      activeType: 'all',
      needle: '',
      rangoDuracion,
      rangoPeso,
      ocultarSinDuracion,
      ocultarSinPeso,
    });
    const visiblesSinOrdenar = filtrarVideos(base, {
      ocultos,
      duplicadoDe,
      desagrupados,
      plegarDuplicados,
      activeType,
      needle: searchInput.value,
      rangoDuracion,
      rangoPeso,
      ocultarSinDuracion,
      ocultarSinPeso,
    });
    // El orden se respeta en LAS DOS vistas (cajas y lista), aunque el
    // control clicable de cabecera solo exista en la de lista.
    const visibles = ordenarVideos(visiblesSinOrdenar, orden);
    ultimosVisibles = visibles;

    renderTypeFilterBar(sinTipoNiTexto);

    const total = order.length;
    if (total === 0) contador.textContent = t('resultados.cero');
    else if (visibles.length === total) contador.textContent = tp('resultados.total', total);
    else contador.textContent = t('resultados.mostrando', { visibles: visibles.length, total });
    contador.classList.toggle('results__count--filtrado', visibles.length !== total);

    undoButton.hidden = tandas.length === 0;
    restoreButton.hidden = ocultos.size === 0;
    if (ocultos.size > 0) {
      restoreButton.textContent = t('resultados.restaurar', { n: ocultos.size });
    }

    const totalPlegados = order.filter(u => duplicadoDe.has(u) && !desagrupados.has(u)).length;
    agruparToggle.root.hidden = totalPlegados === 0;
    agruparToggle.etiqueta.textContent = tp('filtros.agrupar', totalPlegados);

    copyAllButton.disabled = visibles.length === 0;
    exportToggleButton.disabled = visibles.length === 0;

    viewGridBtn.classList.toggle('view-toggle__btn--activa', viewMode === 'grid');
    viewGridBtn.setAttribute('aria-pressed', String(viewMode === 'grid'));
    viewListBtn.classList.toggle('view-toggle__btn--activa', viewMode === 'list');
    viewListBtn.setAttribute('aria-pressed', String(viewMode === 'list'));

    if (visibles.length === 0) {
      show(grid, false);
      show(listWrap, false);
      show(emptySlot, true);
      const estabaFiltrado = order.length > 0;
      setChildren(
        emptySlot,
        emptyState({
          icon: estabaFiltrado ? '🔍' : '🎬',
          title: t(estabaFiltrado ? 'resultados.sinCoincidencias' : 'video.sinResultados.titulo'),
          text: t(
            estabaFiltrado ? 'resultados.sinCoincidencias.texto' : 'video.sinResultados.texto'
          ),
        })
      );
      return;
    }

    show(emptySlot, false);
    show(grid, viewMode === 'grid');
    show(listWrap, viewMode === 'list');

    if (viewMode === 'grid') fillGrid(visibles);
    else fillList(visibles);
  }

  // ── Estado ocupado / cancelar ──────────────────────────────────────────

  function setBusy(busy) {
    analizando = busy;
    submitButton.disabled = busy;
    urlInput.disabled = busy;
    metadataInput.disabled = busy;
    jsInput.disabled = busy;
    thumbInput.disabled = busy;
    agregarUrlBtn.disabled = busy;
    quitarPrimeraBtn.disabled = busy || filasUrlExtra.length === 0;
    for (const nodo of listaFilasExtra.querySelectorAll('input, button')) nodo.disabled = busy;
    show(cancelButton, busy);
    refrescarBoton();
  }

  cancelButton.addEventListener('click', () => {
    controllerActual?.abort();
  });

  // ── Envío ───────────────────────────────────────────────────────────────

  form.addEventListener('submit', async submitEvent => {
    submitEvent.preventDefault();
    const urls = readUrls();

    if (urls.length === 0) {
      showError('error.faltaUrl', 'video.faltaUrl.body');
      urlInput.focus();
      return;
    }

    // Basta con que UNA dirección esté mal escrita: se señala y se enfoca su
    // fila, sea la principal o una extra.
    const invalida = urls.find(u => !/^https?:\/\//i.test(u));
    if (invalida) {
      showError('error.urlInvalida', 'error.urlInvalida.body');
      const filaInvalida = filasUrlExtra.find(f => f.input.value.trim() === invalida);
      (filaInvalida ? filaInvalida.input : urlInput).focus();
      return;
    }

    clearAlert();
    setBusy(true);
    renderSkeleton();

    const controller = new AbortController();
    controllerActual = controller;

    try {
      const params = construirParamsVideo(urls, {
        getMetadata: metadataInput.checked,
        getThumbnails: thumbInput.checked,
        useJavaScript: jsInput.checked,
      });
      const result = await extractVideos(params, { signal: controller.signal });

      meta = new Map();
      order = [];
      for (const video of result.videos || []) {
        if (!video?.url) continue;
        if (!meta.has(video.url)) order.push(video.url);
        meta.set(video.url, video);
      }

      const indexado = indexarGrupos(result.groups);
      grupos = indexado.grupos;
      duplicadoDe = indexado.duplicadoDe;
      desagrupados.clear();
      expandidos.clear();
      ocultos = new Set();
      tandas.length = 0;
      activeType = 'all';
      plegarDuplicados = true;
      agruparToggle.input.checked = true;
      methodsUsados = result.methods || {};
      direccionesAnalizadas = result.direccionesAnalizadas ?? urls.length;
      direccionesTotal = result.direccionesTotal ?? urls.length;
      huboResultado = true;

      recalcularRangos();
      renderStats();
      show(statsCard, true);

      // "El navegador no se pudo usar" manda sobre el aviso de fallo
      // parcial: sin navegador es la explicación más probable de que falten
      // vídeos, y mostrar los dos a la vez sería redundante.
      if (!methodsUsados.puppeteer && jsInput.checked) {
        mostrarAviso('warning', 'video.sinNavegador', 'video.sinNavegador.body');
      } else if (direccionesAnalizadas < direccionesTotal) {
        // Fallo PARCIAL, nunca silencioso: el hueco entre analizadas y total
        // es la señal de que alguna dirección no se pudo analizar.
        mostrarAviso('warning', 'video.aviso.parcial', 'video.aviso.parcial.body', {
          analizadas: direccionesAnalizadas,
          total: direccionesTotal,
        });
      }

      renderResults();
    } catch (error) {
      // Un abort deliberado (botón "Cancelar") NO es un error: se avisa con
      // un toast y la interfaz vuelve al último estado usable (el de antes
      // de lanzar este análisis), sin alerta de fallo.
      if (error.name === 'AbortError') {
        toast(t('video.cancelado'));
      } else {
        showError('video.fallo', null, undefined, error.message);
      }
      renderResults();
    } finally {
      controllerActual = null;
      setBusy(false);
    }
  });

  renderInitialEmpty();

  // Las tarjetas, las cifras y los filtros se construyen con datos, así que
  // se rehacen enteros al cambiar de idioma.
  alCambiarIdioma(() => {
    if (huboResultado) renderStats();
    renderResults();
  });

  return {
    focus() {
      urlInput.focus();
    },
    teardown() {
      controllerActual?.abort();
    },
  };
}
