import { el, setChildren, clear, alertBox, stat, show, toast } from '../dom.js';
import { openScrapeStream, detectConfig } from '../api.js';
import { createProgressPanel } from '../components/progress.js';
import { createResultList } from '../components/resultList.js';
import { createProfileBar, configFromUrl } from '../components/profiles.js';
import {
  PRESETS_EXTENSION,
  presetDe,
  objetivoDe,
  modoAvanzadoDe,
  paginationModeDe,
} from './explorerOptions.js';
import { t, texto, atributo, alCambiarIdioma } from '../i18n/index.js';

/**
 * El último formulario usado se recuerda en `sessionStorage`, no en
 * `localStorage`: varias personas comparten este ordenador y este navegador, y
 * con localStorage la siguiente veía la búsqueda de la anterior. Al cerrar la
 * pestaña, el formulario vuelve a estar vacío.
 */
const STORAGE_KEY = 'urlexplorer:explorer-form';

/**
 * Vista Explorador: fase 1 (recorrer paginación y extraer enlaces) y, si se
 * indican extensiones, fase 2 (buscar ficheros dentro de cada enlace).
 *
 * ── Sobre el formulario en tres pasos ─────────────────────────────────
 *
 * Los pasos son PRESENTACIÓN. Los parámetros que se envían son los mismos de
 * siempre y siguen viviendo en `fields`, que es el contrato con los perfiles,
 * con los enlaces compartidos y con `readForm()`. Las tarjetas, los chips y
 * los radios solo escriben en esos campos; nunca son la fuente de la verdad.
 * Por eso existe `sincronizarUI()`: cuando la verdad llega de fuera (un
 * perfil, un enlace compartido, la detección), la UI se recalcula a partir de
 * los campos y no al revés.
 */

/**
 * Ejemplos de paginación.
 *
 * Los dos modos (parámetro y plantilla {page}) no son obvios mirando el
 * formulario, así que se muestran casos reales: la URL tal como la ve el
 * usuario en el navegador y qué tiene que rellenar en cada caso.
 */
function paginationExamples() {
  // `cambio` y `valor` NO se traducen: son literalmente lo que el usuario ve
  // en la barra del navegador y lo que tiene que escribir. Traducirlos
  // convertiría un ejemplo copiable en uno inservible.
  const CASES = [
    { cambio: '?page=2', campo: 'ejemplos.campo.parametro', valor: 'page' },
    { cambio: '/page/2', campo: 'ejemplos.campo.url', valor: '…/page/{page}' },
    { cambio: '/01, /02', campo: 'ejemplos.campo.url', valor: '…/{page:02}' },
  ];

  return el('div', {
    className: 'examples',
    children: [
      texto(el('p', { className: 'examples__title' }), 'ejemplos.titulo'),
      el('ul', {
        className: 'examples__list',
        children: CASES.map(item =>
          el('li', {
            className: 'examples__item',
            children: [
              el('code', { className: 'examples__url', text: item.cambio }),
              el('span', {
                className: 'examples__arrow',
                text: '→',
                attrs: { 'aria-hidden': 'true' },
              }),
              texto(el('span', { className: 'examples__field' }), item.campo),
              el('code', { className: 'examples__value', text: item.valor }),
            ],
          })
        ),
      }),
    ],
  });
}

export function createExplorerView(container, { limits }) {
  const fields = {};
  // Controles que solo existen en la interfaz: no viajan al servidor, pero sí
  // hay que deshabilitarlos mientras se explora.
  const uiInputs = [];
  let stream = null;
  /**
   * Marca "Otro" a mano, para escribir extensiones que no son ningún preset.
   *
   * Se declara aquí arriba, antes que cualquier manejador que la lea: una
   * `const`/`let` usada antes de su declaración ya tumbó una barra entera de
   * esta aplicación por TDZ.
   */
  let mostrarExtensionesLibres = false;

  /**
   * Los helpers reciben CLAVES de traducción, no texto.
   *
   * Es lo que evita que vuelva a colarse una cadena escrita a mano: si el
   * segundo argumento fuese una frase, escribirla directamente seguiría
   * funcionando y nadie lo notaría hasta cambiar de idioma y ver ese trozo
   * en español.
   *
   * `placeholderKey` va aparte de `inputAttrs` porque también se traduce, y
   * `hintParams` existe para las ayudas con números (los topes vienen del
   * servidor, no del diccionario).
   */
  const makeField = (name, labelKey, hintKey, inputAttrs = {}, opciones = {}) => {
    const { placeholderKey, hintParams } = opciones;
    const input = el('input', {
      className: 'input',
      attrs: { id: `explorer-${name}`, name, ...inputAttrs },
    });
    if (placeholderKey) atributo(input, 'placeholder', placeholderKey);
    fields[name] = input;

    const label = texto(
      el('label', { className: 'field__label', attrs: { for: `explorer-${name}` } }),
      labelKey
    );
    const hint = hintKey ? texto(el('p', { className: 'field__hint' }), hintKey, hintParams) : null;

    return el('div', { className: 'field', children: [label, input, hint] });
  };

  const makeSwitch = (name, titleKey, hintKey) => {
    const input = el('input', { attrs: { type: 'checkbox', id: `explorer-${name}`, name } });
    fields[name] = input;
    return el('label', {
      className: 'switch',
      attrs: { for: `explorer-${name}` },
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
  };

  /** Opción con forma de tarjeta seleccionable (un radio por debajo). */
  const makeChoice = (group, value, titleKey, hintKey, { checked = false } = {}) => {
    const id = `explorer-${group}-${value}`;
    const input = el('input', {
      attrs: { type: 'radio', name: `explorer-${group}`, id, value, checked },
    });
    uiInputs.push(input);

    const root = el('label', {
      className: 'choice',
      attrs: { for: id },
      children: [
        input,
        el('span', {
          className: 'choice__text',
          children: [
            texto(el('span', { className: 'choice__title' }), titleKey),
            texto(el('span', { className: 'choice__hint' }), hintKey),
          ],
        }),
      ],
    });

    return { root, input, value };
  };

  /** Paso numerado. El número es decorativo: el título ya ordena la lectura. */
  const makeStep = (numero, tituloKey, ayudaKey, children) => {
    // El número va delante del título y se recompone al cambiar de idioma:
    // por eso el título se registra en vez de asignarse una sola vez.
    const titulo = el('h3', { className: 'step__title' });
    alCambiarIdioma(() => {
      titulo.textContent = `${numero}. ${t(tituloKey)}`;
    });

    return el('section', {
      className: 'step',
      children: [
        el('div', {
          className: 'step__mark',
          text: String(numero),
          attrs: { 'aria-hidden': 'true' },
        }),
        el('div', {
          className: 'step__body',
          children: [
            titulo,
            ayudaKey ? texto(el('p', { className: 'step__hint' }), ayudaKey) : null,
            el('div', { className: 'step__fields', children }),
          ],
        }),
      ],
    });
  };

  // ── Paso 1: de dónde se parte ──────────────────────────────────────

  const campoUrl = makeField(
    'searchUrl',
    'explorer.url.label',
    'explorer.url.hint',
    { type: 'url', required: true, autocomplete: 'url', spellcheck: 'false' },
    { placeholderKey: 'explorer.url.placeholder' }
  );

  const campoTermino = makeField(
    'searchTerm',
    'explorer.termino.label',
    'explorer.termino.hint',
    { type: 'text', spellcheck: 'false' },
    { placeholderKey: 'explorer.termino.placeholder' }
  );

  // ── Paso 2: qué se quiere obtener ──────────────────────────────────

  /**
   * `fileExtensions` sigue siendo un campo de texto de verdad.
   *
   * Las tarjetas y los chips escriben aquí; este input es el que leen
   * `readForm()`, los perfiles y los enlaces compartidos. Cuando el chip
   * elegido es "Otro" se muestra, y el resto del tiempo se mantiene oculto
   * pero con su valor: así lo que se ve y lo que se envía es lo mismo.
   */
  const campoExtensiones = makeField(
    'fileExtensions',
    'explorer.extensiones.label',
    'explorer.extensiones.hint',
    { type: 'text', placeholder: '.mp4, .webm', spellcheck: 'false' }
  );

  const objetivoEnlaces = makeChoice(
    'objetivo',
    'enlaces',
    'explorer.objetivo.enlaces',
    'explorer.objetivo.enlaces.hint',
    { checked: true }
  );

  const objetivoFicheros = makeChoice(
    'objetivo',
    'ficheros',
    'explorer.objetivo.ficheros',
    'explorer.objetivo.ficheros.hint'
  );

  const opcionesObjetivo = [objetivoEnlaces, objetivoFicheros];

  const chipsSlot = el('div', { className: 'chips' });
  const chipsBloque = el('div', {
    className: 'chips-block',
    children: [
      texto(el('p', { className: 'field__label' }), 'explorer.tipoArchivo'),
      chipsSlot,
      campoExtensiones,
    ],
  });

  /** Chips de tipo: rellenan `fileExtensions` con extensiones reales. */
  const chips = [
    ...PRESETS_EXTENSION.map(preset => {
      const boton = el('button', {
        className: 'chip',
        attrs: { type: 'button', 'aria-pressed': 'false' },
        children: [
          texto(el('span', { className: 'chip__label' }), preset.etiquetaKey),
          el('code', { className: 'chip__ext', text: preset.extensiones }),
        ],
        on: {
          click: () => {
            fields.fileExtensions.value = preset.extensiones;
            mostrarExtensionesLibres = false;
            sincronizarUI();
          },
        },
      });
      uiInputs.push(boton);
      return { id: preset.id, boton };
    }),
  ];

  const chipOtro = el('button', {
    className: 'chip chip--otro',
    attrs: { type: 'button', 'aria-pressed': 'false' },
    on: {
      click: () => {
        mostrarExtensionesLibres = true;
        sincronizarUI();
        fields.fileExtensions.focus();
      },
    },
  });
  texto(chipOtro, 'explorer.preset.otro');
  atributo(chipOtro, 'title', 'explorer.preset.otro.title');
  uiInputs.push(chipOtro);

  setChildren(chipsSlot, [...chips.map(c => c.boton), chipOtro]);

  // ── Ajustes avanzados ──────────────────────────────────────────────

  /**
   * `paginationMode` sigue siendo un campo con los mismos dos valores que
   * entiende el servidor (`auto` / `scroll`). El tercer radio ("a mano") es
   * solo la vista que enseña los patrones, así que no llega aquí.
   */
  fields.paginationMode = el('input', {
    attrs: { type: 'hidden', name: 'paginationMode', value: 'auto' },
  });

  const modoAuto = makeChoice('modo', 'auto', 'explorer.modo.auto', 'explorer.modo.auto.hint', {
    checked: true,
  });

  const modoManual = makeChoice(
    'modo',
    'manual',
    'explorer.modo.manual',
    'explorer.modo.manual.hint'
  );

  const modoScroll = makeChoice(
    'modo',
    'scroll',
    'explorer.modo.scroll',
    'explorer.modo.scroll.hint'
  );

  const opcionesModo = [modoAuto, modoManual, modoScroll];

  const campoPatronEnlace = makeField(
    'linkPattern',
    'explorer.patron.label',
    'explorer.patron.hint',
    { type: 'text', placeholder: '/videos/', spellcheck: 'false' }
  );

  const campoParametro = makeField(
    'pageParam',
    'explorer.parametro.label',
    'explorer.parametro.hint',
    { type: 'text', placeholder: 'page', spellcheck: 'false' }
  );

  const bloqueManual = el('div', {
    className: 'grid',
    children: [campoPatronEnlace, campoParametro, paginationExamples()],
  });

  /**
   * Resumen de lo que sigue activo cuando los patrones están ocultos.
   *
   * Ocultar un campo NO lo vacía: un perfil guardado o un enlace compartido
   * pueden traer patrones, y borrarlos al plegar la vista sería perder datos
   * del usuario. Pero un patrón que actúa sin verse es justo el tipo de
   * estado invisible que aquí se paga caro, así que si hay algo puesto se
   * dice en texto plano.
   */
  const resumenModo = el('p', { className: 'mode-summary' });
  show(resumenModo, false);

  const campoDesde = makeField('startPage', 'explorer.desde.label', null, {
    type: 'number',
    min: '1',
    value: '1',
  });

  const campoHasta = makeField(
    'endPage',
    'explorer.hasta.label',
    'explorer.hasta.hint',
    { type: 'number', min: '1', value: '5' },
    { hintParams: { max: limits.maxPages } }
  );

  const campoRapidez = makeField(
    'concurrency',
    'explorer.rapidez.label',
    'explorer.rapidez.hint',
    {
      type: 'number',
      min: '1',
      max: String(limits.maxConcurrency),
      value: String(limits.defaultConcurrency),
    },
    { hintParams: { max: limits.maxConcurrency, defecto: limits.defaultConcurrency } }
  );

  const advanced = el('details', {
    className: 'disclosure',
    children: [
      texto(el('summary', { className: 'disclosure__summary' }), 'explorer.avanzados'),
      el('div', {
        className: 'disclosure__content grid',
        children: [
          el('div', {
            className: 'field',
            children: [
              // Va dentro del formulario, no suelto: así form.reset() lo
              // devuelve a "auto" como a cualquier otro campo.
              fields.paginationMode,
              texto(el('p', { className: 'field__label' }), 'explorer.modo.pregunta'),
              el('div', {
                className: 'choices choices--stack',
                children: opcionesModo.map(o => o.root),
              }),
              resumenModo,
              bloqueManual,
            ],
          }),

          el('div', {
            className: 'grid grid--3',
            children: [campoDesde, campoHasta, campoRapidez],
          }),

          makeSwitch('useJavaScript', 'explorer.navegador.label', 'explorer.navegador.hint'),
          makeSwitch('withSizes', 'explorer.peso.label', 'explorer.peso.hint'),
          makeSwitch('openLicenseOnly', 'explorer.licencia.label', 'explorer.licencia.hint'),
        ],
      }),
    ],
  });

  // ── Paso 3: lanzar ─────────────────────────────────────────────────

  const submitButton = el('button', { className: 'button', attrs: { type: 'submit' } });
  const detectButton = el('button', {
    className: 'button button--secondary',
    attrs: { type: 'button' },
  });
  const resetButton = el('button', {
    className: 'button button--secondary',
    attrs: { type: 'button' },
  });

  /**
   * Los dos botones que cambian de texto mientras trabajan.
   *
   * No se pueden enlazar con texto() sin más: su rótulo depende del estado
   * («Explorar» / «Explorando…»), así que se repinta desde una función que
   * conoce ese estado y que además se registra para el cambio de idioma. Si
   * se hubieran enlazado a secas, cambiar de idioma en mitad de una
   * exploración habría devuelto el botón a «Explorar» estando ocupado.
   */
  let explorando = false;
  let detectando = false;

  const refrescarBotones = () => {
    submitButton.textContent = t(explorando ? 'explorer.explorando' : 'explorer.explorar');
    detectButton.textContent = t(detectando ? 'explorer.analizando' : 'explorer.detectar');
  };
  alCambiarIdioma(refrescarBotones);
  atributo(detectButton, 'title', 'explorer.detectar.title');
  texto(resetButton, 'explorer.limpiar');

  /** Panel con la propuesta y el porqué de cada campo. */
  const detectSlot = el('div');
  show(detectSlot, false);

  const form = el('form', {
    className: 'steps',
    attrs: { novalidate: true },
    children: [
      makeStep(1, 'explorer.paso1.titulo', 'explorer.paso1.ayuda', [campoUrl, campoTermino]),

      makeStep(2, 'explorer.paso2.titulo', 'explorer.paso2.ayuda', [
        el('div', { className: 'choices', children: opcionesObjetivo.map(o => o.root) }),
        chipsBloque,
      ]),

      advanced,

      makeStep(3, 'explorer.paso3.titulo', null, [
        el('div', { className: 'button-row', children: [submitButton, detectButton, resetButton] }),
      ]),

      detectSlot,
    ],
  });

  const profileBar = createProfileBar({
    getConfig: () => currentConfig(),
    applyConfig: config => applyConfig(config),
  });

  const formCard = el('div', {
    className: 'card',
    children: [
      el('div', {
        className: 'card__header',
        children: [
          texto(
            el('h2', { className: 'card__title', attrs: { id: 'explorer-heading' } }),
            'explorer.titulo'
          ),
          texto(el('p', { className: 'card__hint' }), 'explorer.subtitulo'),
        ],
      }),
      el('div', { className: 'card__body', children: [profileBar.root, form] }),
    ],
  });

  const progress = createProgressPanel();
  const progressCard = el('div', {
    className: 'card',
    children: [el('div', { className: 'card__body', children: [progress.root] })],
  });
  show(progressCard, false);

  const alertSlot = el('div');
  show(alertSlot, false);

  const statsSlot = el('div', { className: 'card__body' });
  const statsCard = el('div', { className: 'card', children: [statsSlot] });
  show(statsCard, false);

  const results = createResultList({
    emptyTitleKey: 'explorer.vacio.titulo',
    emptyTextKey: 'explorer.vacio.texto',
    filename: 'urlexplorer-resultados.txt',
  });

  setChildren(container, [formCard, alertSlot, progressCard, statsCard, results.root]);

  // ── Sincronización de la interfaz con los campos ────────────────────

  const modoActual = () => opcionesModo.find(o => o.input.checked)?.value ?? 'auto';

  /**
   * Recalcula tarjetas, chips y radios a partir de los CAMPOS.
   *
   * Siempre en esta dirección. Los campos son la verdad —son los que se
   * envían, se guardan en los perfiles y viajan en los enlaces compartidos—;
   * si la UI fuese la verdad, abrir un enlace compartido enseñaría una
   * configuración distinta de la que se ejecuta.
   */
  function sincronizarUI() {
    const extensiones = fields.fileExtensions.value;
    const objetivo = objetivoDe(extensiones);
    const preset = presetDe(extensiones);

    for (const opcion of opcionesObjetivo) opcion.input.checked = opcion.value === objetivo;

    show(chipsBloque, objetivo === 'ficheros');

    const libre = mostrarExtensionesLibres || preset === 'otro';
    for (const chip of chips) {
      const activo = !libre && preset === chip.id;
      chip.boton.setAttribute('aria-pressed', String(activo));
      chip.boton.classList.toggle('chip--activo', activo);
    }
    chipOtro.setAttribute('aria-pressed', String(libre));
    chipOtro.classList.toggle('chip--activo', libre);
    show(campoExtensiones, libre);

    const modo = modoAvanzadoDe({
      paginationMode: fields.paginationMode.value,
      linkPattern: fields.linkPattern.value,
      pageParam: fields.pageParam.value,
    });
    for (const opcion of opcionesModo) opcion.input.checked = opcion.value === modo;

    aplicarVistaModo();
  }

  /** Muestra u oculta los patrones según el radio, sin tocar sus valores. */
  function aplicarVistaModo() {
    const modo = modoActual();
    show(bloqueManual, modo === 'manual');

    const puestos = [
      fields.linkPattern.value.trim()
        ? t('explorer.modo.resumen.enlaces', { valor: fields.linkPattern.value.trim() })
        : null,
      fields.pageParam.value.trim()
        ? t('explorer.modo.resumen.parametro', { valor: fields.pageParam.value.trim() })
        : null,
    ].filter(Boolean);

    // Si hay patrones puestos y no se están viendo, se dice: un patrón que
    // filtra sin aparecer en pantalla es indistinguible de un sitio que no
    // devuelve nada.
    const ocultos = modo !== 'manual' && puestos.length > 0;
    show(resumenModo, ocultos);
    if (ocultos) {
      resumenModo.textContent = t('explorer.modo.resumen', {
        que: puestos.join(t('explorer.modo.resumen.y')),
      });
    }
  }

  // El resumen se construye con los valores del formulario, así que hay que
  // rehacerlo al cambiar de idioma: es texto calculado, no fijo.
  alCambiarIdioma(() => aplicarVistaModo());

  for (const opcion of opcionesObjetivo) {
    opcion.input.addEventListener('change', () => {
      if (opcion.value === 'enlaces') {
        // Sin extensiones no hay fase 2: es la misma regla del backend.
        fields.fileExtensions.value = '';
        mostrarExtensionesLibres = false;
      } else if (!fields.fileExtensions.value.trim()) {
        // Elegir "archivos" y no mandar ninguna extensión daría exactamente el
        // mismo resultado que "solo enlaces", sin decir por qué. Se arranca
        // con el primer preset para que la elección signifique algo.
        fields.fileExtensions.value = PRESETS_EXTENSION[0].extensiones;
      }
      sincronizarUI();
    });
  }

  for (const opcion of opcionesModo) {
    opcion.input.addEventListener('change', () => {
      fields.paginationMode.value = paginationModeDe(opcion.value);
      aplicarVistaModo();
    });
  }

  // Escribir a mano en los patrones cambia el resumen del modo
  for (const campo of [fields.linkPattern, fields.pageParam]) {
    campo.addEventListener('input', () => aplicarVistaModo());
  }
  fields.fileExtensions.addEventListener('input', () => {
    mostrarExtensionesLibres = true;
    sincronizarUI();
  });

  // ── Estado del formulario ──────────────────────────────────────────

  function readForm() {
    return {
      searchUrl: fields.searchUrl.value.trim(),
      searchTerm: fields.searchTerm.value.trim(),
      paginationMode: fields.paginationMode.value,
      pageParam: fields.pageParam.value.trim(),
      linkPattern: fields.linkPattern.value.trim(),
      fileExtensions: fields.fileExtensions.value.trim(),
      startPage: Number(fields.startPage.value) || 1,
      endPage: Number(fields.endPage.value) || 1,
      concurrency: Number(fields.concurrency.value) || limits.defaultConcurrency,
      useJavaScript: fields.useJavaScript.checked,
      licenseFilter: fields.openLicenseOnly.checked ? 'open-only' : 'off',
      withSizes: fields.withSizes.checked,
    };
  }

  /** Vuelca una configuración guardada o venida por URL en el formulario. */
  function applyConfig(config) {
    if (!config) return;
    for (const [key, value] of Object.entries(config)) {
      const input = fields[key];
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = value === true || value === 'true';
      else input.value = value;
    }
    // La configuración manda sobre lo que hubiera marcado a mano
    mostrarExtensionesLibres = false;
    sincronizarUI();
  }

  /** Configuración actual, para guardarla o convertirla en enlace. */
  function currentConfig() {
    const config = {};
    for (const [name, input] of Object.entries(fields)) {
      config[name] = input.type === 'checkbox' ? input.checked : input.value;
    }
    return config;
  }

  function restoreForm() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
      for (const [key, value] of Object.entries(saved)) {
        if (!fields[key]) continue;
        if (fields[key].type === 'checkbox') fields[key].checked = Boolean(value);
        else fields[key].value = value;
      }
    } catch {
      // preferencias corruptas: se ignoran
    }
  }

  function persistForm() {
    try {
      const state = {};
      for (const [name, input] of Object.entries(fields)) {
        state[name] = input.type === 'checkbox' ? input.checked : input.value;
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // almacenamiento lleno o bloqueado: no es crítico
    }
  }

  function setBusy(busy) {
    explorando = busy;
    submitButton.disabled = busy;
    refrescarBotones();
    for (const input of Object.values(fields)) input.disabled = busy;
    for (const input of uiInputs) input.disabled = busy;
  }

  /**
   * La alerta visible se guarda en CLAVES, no como texto ya pintado.
   *
   * Es lo que permite repintarla al cambiar de idioma. Guardar el nodo ya
   * construido dejaría el aviso más importante de la pantalla —el que
   * explica por qué no hay resultados— congelado en el idioma anterior.
   *
   * `bodyTexto` es la excepción: los mensajes que vienen del servidor llegan
   * ya redactados y se muestran tal cual. Ver la limitación anotada en
   * CLAUDE.md.
   */
  let ultimaAlerta = null;

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

  /** Último `complete`, para poder repintar las cifras en el otro idioma. */
  let ultimasStats = null;

  function renderStats(payload) {
    if (payload) ultimasStats = payload;
    if (!ultimasStats) return;

    const datos = ultimasStats;
    const cards = [
      stat(datos.totalLinks ?? 0, t('stats.enlaces')),
      stat(datos.pagesScraped ?? 0, t('stats.paginas')),
    ];

    if (datos.extensions?.length > 0) {
      cards.push(stat(datos.totalFiles ?? 0, t('stats.ficheros')));
    }
    if (datos.durationMs !== undefined) {
      cards.push(stat(`${(datos.durationMs / 1000).toFixed(1)}s`, t('stats.duracion')));
    }
    if (datos.failures?.length > 0) {
      cards.push(stat(datos.failures.length, t('stats.fallidas')));
    }

    setChildren(statsSlot, el('div', { className: 'stats', children: cards }));
    show(statsCard, true);
  }

  alCambiarIdioma(() => renderStats(null));

  // ── Detección de configuración ─────────────────────────────────────

  /** Una fila del panel: qué se propone y por qué. */
  function filaPropuesta(campo, valor, motivo, confianza) {
    return el('li', {
      className: 'propuesta__item',
      children: [
        el('div', {
          className: 'propuesta__cabecera',
          children: [
            el('span', { className: 'propuesta__campo', text: campo }),
            el('code', { className: 'propuesta__valor', text: valor || t('propuesta.vacio') }),
            confianza
              ? el('span', {
                  className: `badge badge--${confianza === 'alta' ? 'success' : 'accent'}`,
                  // El nivel lo nombra el servidor ("alta"/"media"): se muestra
                  // tal cual, ver la limitación anotada en CLAUDE.md.
                  text: t('propuesta.confianza', { nivel: confianza }),
                })
              : null,
          ],
        }),
        el('p', { className: 'propuesta__motivo', text: motivo }),
      ],
    });
  }

  /**
   * Muestra la propuesta.
   *
   * El formulario se rellena, pero el panel se queda visible con el motivo de
   * cada campo. Presentarlo como verdad automática sería el error: acierta la
   * mayoría de las veces, no siempre, y si no se dice, cada fallo se lee como
   * una avería en vez de como una propuesta que había que revisar.
   */
  function mostrarPropuesta(resultado) {
    const { sugerencia, motivos, confianza, avisos, analizado, alternativas } = resultado;

    const filas = [
      filaPropuesta(
        t('propuesta.campo.patron'),
        sugerencia.linkPattern,
        motivos.patron,
        confianza.patron
      ),
      filaPropuesta(
        t('propuesta.campo.paginacion'),
        sugerencia.pageParam
          ? t('propuesta.parametro', { valor: sugerencia.pageParam })
          : sugerencia.searchUrl,
        motivos.paginacion,
        confianza.paginacion
      ),
      filaPropuesta(
        t('propuesta.campo.navegador'),
        t(sugerencia.useJavaScript ? 'propuesta.si' : 'propuesta.no'),
        motivos.navegador
      ),
      filaPropuesta(
        t('propuesta.campo.extensiones'),
        sugerencia.fileExtensions,
        motivos.extensiones
      ),
    ];

    if (alternativas?.linkPattern) {
      filas.push(
        filaPropuesta(
          t('propuesta.campo.alternativo'),
          alternativas.linkPattern,
          t('propuesta.alternativo.motivo')
        )
      );
    }

    setChildren(detectSlot, [
      el('div', {
        className: 'card propuesta',
        children: [
          el('div', {
            className: 'card__header',
            children: [
              el('h3', { className: 'card__title', text: t('propuesta.titulo') }),
              el('p', {
                className: 'card__hint',
                text: t('propuesta.hint', {
                  conNavegador: analizado.enlacesConNavegador,
                  sinNavegador: analizado.enlacesSinNavegador,
                }),
              }),
            ],
          }),
          el('div', {
            className: 'card__body',
            children: [
              el('ul', { className: 'propuesta__lista', children: filas }),
              // El cuerpo del aviso lo redacta el servidor y se muestra tal cual
              ...avisos.map(aviso =>
                alertBox({ variant: 'warning', title: t('propuesta.aviso'), body: aviso })
              ),
            ],
          }),
        ],
      }),
    ]);
    show(detectSlot, true);
  }

  detectButton.addEventListener('click', async () => {
    const url = fields.searchUrl.value.trim();

    if (!url || !/^https?:\/\//i.test(url)) {
      showError('error.faltaUrl', 'error.faltaUrl.detectar');
      fields.searchUrl.focus();
      return;
    }

    detectButton.disabled = true;
    detectando = true;
    refrescarBotones();
    clearAlert();

    try {
      const resultado = await detectConfig(url);

      // Se rellena el formulario, pero solo lo que la detección ha resuelto:
      // un campo vacío no debe borrar lo que el usuario ya tenía escrito.
      const { sugerencia } = resultado;
      const aplicar = {};
      if (sugerencia.linkPattern) aplicar.linkPattern = sugerencia.linkPattern;
      if (sugerencia.pageParam) aplicar.pageParam = sugerencia.pageParam;
      if (sugerencia.fileExtensions) aplicar.fileExtensions = sugerencia.fileExtensions;
      if (sugerencia.searchUrl && sugerencia.searchUrl !== url) {
        aplicar.searchUrl = sugerencia.searchUrl;
      }
      if (sugerencia.paginationMode) aplicar.paginationMode = sugerencia.paginationMode;
      aplicar.useJavaScript = sugerencia.useJavaScript;
      // El scroll no funciona sin navegador, así que proponerlo sin activarlo
      // sería proponer una configuración que no puede funcionar.
      if (sugerencia.paginationMode === 'scroll') aplicar.useJavaScript = true;
      applyConfig(aplicar);

      // Si la propuesta trae patrones, se abre el panel y se enseña el modo a
      // mano: la detección acaba de escribir en campos que en "automático"
      // estarían plegados, y hay que poder revisarlos.
      if (aplicar.linkPattern || aplicar.pageParam) advanced.open = true;

      mostrarPropuesta(resultado);
      toast(t('propuesta.lista'));
    } catch (error) {
      showError('propuesta.fallo', null, undefined, error.message);
    } finally {
      detectButton.disabled = false;
      detectando = false;
      refrescarBotones();
    }
  });

  // ── Ejecución ──────────────────────────────────────────────────────

  function stopStream({ aborted = false } = {}) {
    stream?.close();
    stream = null;
    setBusy(false);
    progress.finish({ aborted });
  }

  progress.onCancel(() => stopStream({ aborted: true }));

  function handleEvent(event, collected) {
    switch (event.type) {
      case 'phase1_start':
        progress.startPhase1();
        break;

      case 'phase1_progress':
        progress.updatePhase1(event);
        break;

      case 'phase1_complete':
        progress.completePhase1(event);
        // Se guarda para avisar al final: si el scroll paró por un tope, los
        // resultados están incompletos y callarlo los haría pasar por
        // completos.
        collected.scroll = event.scroll || null;
        break;

      case 'phase2_start':
        progress.startPhase2(event);
        break;

      case 'phase2_progress':
        progress.updatePhase2(event);
        break;

      case 'files_found':
        collected.files.push(...event.files);
        progress.addFiles(event.files);
        results.setItems(collected.files);
        if (event.details) results.setDetails(event.details);
        break;

      case 'complete': {
        // Si hubo fase 2 se muestran los ficheros; si no, los enlaces
        const deepSearch = event.extensions?.length > 0;
        results.setItems(deepSearch ? event.files : event.links);
        if (event.fileDetails) results.setDetails(event.fileDetails);
        // Los duplicados se pliegan, no se descartan: la lista sigue entera y
        // el interruptor de la barra los devuelve.
        if (event.duplicateGroups) results.setDuplicateGroups(event.duplicateGroups);
        renderStats(event);

        // El scroll paró por un tope duro: hay más contenido que no se ha
        // llegado a ver. Decirlo es obligatorio, porque los resultados
        // parecen completos y no lo son.
        const MOTIVOS_DE_TOPE = {
          'tope-de-rondas': 'aviso.tope.rondas',
          'tope-de-elementos': 'aviso.tope.elementos',
          'tiempo-agotado': 'aviso.tope.tiempo',
          'error-de-navegador': 'aviso.tope.navegador',
        };
        const claveTope = MOTIVOS_DE_TOPE[collected.scroll?.motivo];

        if (claveTope) {
          mostrarAviso('warning', 'aviso.scrollCortado', 'aviso.scrollCortado.body', {
            cargas: collected.scroll.rounds,
            motivo: t(claveTope),
          });
        }

        /**
         * POR QUÉ SALIERON CERO RESULTADOS.
         *
         * Son los dos avisos que atacan la causa número uno de frustración:
         * una lista vacía sin explicación. Van ANTES que el resto porque
         * responden a la pregunta que el usuario se está haciendo.
         */
        const diag = event.diagnostico;

        // El patrón se lo llevó todo por delante: hay enlaces, pero ninguno
        // casa. Sin esto es indistinguible de "el sitio no tiene nada".
        if (diag && event.links.length === 0 && diag.enlacesVistos > 0) {
          const pistas = (diag.prefijos || []).map(p => `${p.prefijo} (${p.veces})`).join(', ');
          mostrarAviso(
            'warning',
            'aviso.patronSinCasar',
            pistas ? 'aviso.patronSinCasar.body' : 'aviso.patronSinCasar.sinPistas',
            {
              vistos: diag.enlacesVistos,
              patron: readForm().linkPattern || '',
              pistas,
            }
          );
        }

        // Sospecha de bloqueo. SIEMPRE como sospecha: hay falsos positivos y
        // afirmar una causa que no se puede probar sería peor que callarse.
        if (diag?.bloqueo?.sospechoso) {
          mostrarAviso('warning', 'aviso.bloqueo', 'aviso.bloqueo.body', {
            motivos: diag.bloqueo.motivos.join('; '),
          });
        }

        // Sin extensiones no hay fase 2, y hasta ahora eso no se decía en
        // ninguna parte: el usuario veía una lista de enlaces, ningún
        // fichero y ningún error, y no tenía forma de saber que faltaba
        // rellenar un campo. Es el mismo fallo silencioso de siempre, esta
        // vez por configuración.
        if (!deepSearch && event.links.length > 0) {
          mostrarAviso('warning', 'aviso.soloEnlaces', 'aviso.soloEnlaces.body');
        }

        // Ficheros que estaban en la ficha pero no eran suyos (anuncios,
        // vistas previas de los relacionados), y los que no se pudieron
        // verificar. Callarlo era el problema original: se entregaba un clip
        // de segundos con la duración de un vídeo de veinte minutos.
        if (event.suspectFiles > 0) {
          mostrarAviso('warning', 'aviso.sinVerificar', 'aviso.sinVerificar.body', {
            n: event.suspectFiles,
          });
        } else if (event.discardedFiles > 0) {
          mostrarAviso('warning', 'aviso.descartados', 'aviso.descartados.body', {
            n: event.discardedFiles,
          });
        }

        if (event.truncated) {
          mostrarAviso('warning', 'aviso.truncado', 'aviso.truncado.body', {
            enlaces: event.limits?.maxLinks ?? '?',
            ficheros: event.limits?.maxFiles ?? '?',
          });
        }

        if (event.licenseFilter === 'open-only' && event.skippedByLicense > 0) {
          mostrarAviso('warning', 'aviso.licencia', 'aviso.licencia.body', {
            n: event.skippedByLicense,
          });
        } else if (event.timedOut) {
          mostrarAviso('warning', 'aviso.tiempoAgotado', 'aviso.tiempoAgotado.body', {
            minutos: Math.round((event.maxDurationMs ?? 0) / 60000),
          });
        } else if (deepSearch && event.files.length === 0 && event.links.length > 0) {
          const usedBrowser = readForm().useJavaScript;
          mostrarAviso(
            'warning',
            'aviso.sinFicheros',
            usedBrowser ? 'aviso.sinFicheros.conNavegador' : 'aviso.sinFicheros.sinNavegador',
            { n: event.links.length }
          );
        }

        stopStream();
        break;
      }

      case 'error':
        showError('error.busquedaFallo', null, undefined, event.message);
        stopStream();
        break;

      default:
        break;
    }
  }

  form.addEventListener('submit', submitEvent => {
    submitEvent.preventDefault();
    const params = readForm();

    if (!params.searchUrl) {
      showError('error.faltaUrl', 'error.faltaUrl.explorar');
      fields.searchUrl.focus();
      return;
    }

    if (!/^https?:\/\//i.test(params.searchUrl)) {
      showError('error.urlInvalida', 'error.urlInvalida.body');
      fields.searchUrl.focus();
      return;
    }

    if (/\{(?:q|query|termino|término)\}/i.test(params.searchUrl) && !params.searchTerm) {
      showError('error.faltaTermino', 'error.faltaTermino.body');
      fields.searchTerm.focus();
      return;
    }

    // Trampa fácil de pisar: rellenar "Desde/Hasta" y dejar vacío el parámetro
    // de página. Sin él no hay paginación posible y solo se descarga una
    // página, así que conviene decirlo antes de lanzar la búsqueda.
    //
    // Ojo: hay DOS formas de paginar. Esta comprobación solo miraba el campo
    // "Parámetro de página" e ignoraba la plantilla {page} dentro de la URL,
    // así que rechazaba como inválidas configuraciones correctas: las de los
    // sitios que llevan el número de página dentro de la ruta.
    // En modo scroll no hay URL por página que construir: "Hasta" son cargas,
    // no páginas, así que ni se exige parámetro ni aplica el tope de páginas.
    const esScroll = params.paginationMode === 'scroll';

    const paginaPorPlantilla = /\{page(?::\d+)?\}/i.test(params.searchUrl);
    if (
      !esScroll &&
      !params.pageParam &&
      !paginaPorPlantilla &&
      params.endPage > params.startPage
    ) {
      showError('error.faltaParametro', 'error.faltaParametro.body', {
        desde: params.startPage,
        hasta: params.endPage,
      });
      advanced.open = true;
      return;
    }

    if (params.pageParam && params.endPage < params.startPage) {
      showError('error.rangoInvalido', 'error.rangoInvalido.body');
      return;
    }

    // Antes esta comprobación solo corría si había pageParam, así que un rango
    // inválido llegaba al servidor y volvía como un 400 que el EventSource no
    // sabe leer.
    if (!esScroll && params.endPage - params.startPage + 1 > limits.maxPages) {
      showError('error.rangoGrande', 'error.rangoGrande.body', {
        pedidas: params.endPage - params.startPage + 1,
        max: limits.maxPages,
        sugerido: params.startPage + limits.maxPages - 1,
      });
      return;
    }

    persistForm();
    clearAlert();
    results.clear();
    show(statsCard, false);
    progress.reset();
    show(progressCard, true);
    setBusy(true);

    const collected = { files: [] };
    stream = openScrapeStream(params, {
      onEvent: event => handleEvent(event, collected),
    });
  });

  resetButton.addEventListener('click', () => {
    stopStream();
    form.reset();
    fields.paginationMode.value = 'auto';
    fields.startPage.value = '1';
    fields.endPage.value = '5';
    fields.concurrency.value = String(limits.defaultConcurrency);
    mostrarExtensionesLibres = false;
    sincronizarUI();
    clearAlert();
    results.clear();
    show(statsCard, false);
    show(progressCard, false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sin almacenamiento: nada que limpiar
    }
  });

  restoreForm();

  // Una configuración recibida por enlace tiene prioridad sobre lo último
  // usado: si alguien abre un enlace compartido, espera ver ESA configuración.
  const fromUrl = configFromUrl();
  if (fromUrl) applyConfig(fromUrl);

  // Deja la interfaz acorde con los campos ya restaurados. Sin esto, un
  // formulario recordado con extensiones enseñaría "solo enlaces".
  sincronizarUI();

  return {
    focus() {
      fields.searchUrl.focus();
    },
    teardown() {
      stopStream();
    },
  };
}
