import { el, setChildren, clear, alertBox, show, toast } from '../dom.js';
import { openScrapeStream, detectConfig, pauseScrape } from '../api.js';
import { createProgressPanel } from '../components/progress.js';
import { createResultList } from '../components/resultList.js';
import { createProfileBar, configFromUrl } from '../components/profiles.js';
import {
  PRESETS_EXTENSION,
  presetCompatibleDe,
  objetivoDe,
  modoAvanzadoDe,
  paginationModeDe,
  siguienteRango,
  construirParamsMultiUrl,
} from './explorerOptions.js';
import { t, tp, texto, atributo, alCambiarIdioma } from '../i18n/index.js';

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
 * ── Sobre la disposición del formulario ───────────────────────────────
 *
 * La disposición es PRESENTACIÓN. Los parámetros que se envían son los mismos
 * de siempre y siguen viviendo en `fields`, que es el contrato con los
 * perfiles, con los enlaces compartidos y con `readForm()`. Los segmentados,
 * los chips y los plegados solo escriben en esos campos; nunca son la fuente
 * de la verdad. Por eso existe `sincronizarUI()`: cuando la verdad llega de
 * fuera (un perfil, un enlace compartido, la detección), la UI se recalcula a
 * partir de los campos y no al revés.
 *
 * Y por eso mismo, plegar NUNCA vacía: la palabra buscada y los patrones se
 * siguen enviando aunque su campo esté oculto, así que ocultarlos obliga a
 * decirlo —el toggle se abre solo si hay valor, el resumen del modo canta los
 * patrones activos—. Un campo que filtra sin verse es indistinguible de un
 * sitio que no devuelve nada.
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
   * Exploración frenada a medias, si la hay.
   *
   * `jobIdActual` es el trabajo en curso, para poder decirle "frena".
   * `jobIdPendiente` es el que quedó a medias y se puede continuar; el
   * servidor guarda sus enlaces pendientes, aquí solo vive el identificador.
   */
  let jobIdActual = null;
  let jobIdPendiente = null;
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

  /**
   * Una opción de un selector segmentado (un radio por debajo).
   *
   * El rótulo visible es la clave `.breve`; la explicación larga va al `title`
   * en vez de debajo. Es lo que permite que tres opciones ocupen una línea en
   * vez de tres tarjetas, sin perder la explicación para quien la busque.
   */
  const makeSegment = (group, value, labelKey, hintKey, { checked = false } = {}) => {
    const id = `explorer-${group}-${value}`;
    const input = el('input', {
      attrs: { type: 'radio', name: `explorer-${group}`, id, value, checked },
    });
    uiInputs.push(input);

    const root = el('label', {
      className: 'segmented__option',
      attrs: { for: id },
      children: [input, texto(el('span', { className: 'segmented__label' }), labelKey)],
    });
    if (hintKey) atributo(root, 'title', hintKey);

    return { root, input, value };
  };

  const makeSegmented = opciones =>
    el('div', {
      className: 'segmented',
      attrs: { role: 'group' },
      children: opciones.map(o => o.root),
    });

  /**
   * Interruptor con forma de chip, para lo que se decide de un vistazo.
   *
   * Mismo `input[type=checkbox]` de siempre —sigue en `fields`, sigue viajando
   * al servidor—; lo único que cambia es que ocupa una línea compartida en vez
   * de un bloque con título y ayuda.
   */
  const makeChipToggle = (name, labelKey, hintKey) => {
    const input = el('input', { attrs: { type: 'checkbox', id: `explorer-${name}`, name } });
    fields[name] = input;

    const root = el('label', {
      className: 'chip chip--toggle',
      attrs: { for: `explorer-${name}` },
      children: [input, texto(el('span', { className: 'chip__label' }), labelKey)],
    });
    atributo(root, 'title', hintKey);
    return root;
  };

  // ── De dónde se parte ──────────────────────────────────────────────

  /**
   * `fields.searchUrl` es la PRIMERA dirección de la lista (multi-URL, ver
   * más abajo). Es la ÚNICA que conoce el contrato con `readForm()`, los
   * perfiles guardados y los enlaces compartidos (`CONFIG_KEYS` en
   * `profiles.js`): ninguno de esos conoce filas adicionales. Se crea aquí,
   * en crudo, y se monta dentro de su fila más abajo, junto al botón de
   * "Configurar por mí" (que también se define más abajo).
   */
  fields.searchUrl = el('input', {
    className: 'input',
    attrs: {
      id: 'explorer-searchUrl',
      name: 'searchUrl',
      type: 'url',
      required: true,
      autocomplete: 'url',
      spellcheck: 'false',
    },
  });
  atributo(fields.searchUrl, 'placeholder', 'explorer.url.placeholder');

  const campoTermino = makeField(
    'searchTerm',
    'explorer.termino.label',
    'explorer.termino.hint',
    { type: 'text', spellcheck: 'false' },
    { placeholderKey: 'explorer.termino.placeholder' }
  );

  /**
   * La palabra buscada empieza plegada.
   *
   * Solo sirve cuando la dirección lleva `{q}`, que es la minoría de los
   * casos, así que enseñarla siempre costaba una fila de formulario a todo el
   * mundo. Se despliega sola si ya trae valor (perfil, enlace compartido o
   * formulario recordado): un campo con contenido que no se ve es justo el
   * estado invisible que aquí se paga caro.
   */
  let terminoVisible = false;

  const terminoToggle = el('button', {
    className: 'link-toggle',
    attrs: { type: 'button', 'aria-expanded': 'false' },
    on: {
      click: () => {
        terminoVisible = !terminoVisible;
        aplicarVistaTermino();
        if (terminoVisible) fields.searchTerm.focus();
      },
    },
  });
  uiInputs.push(terminoToggle);

  function aplicarVistaTermino() {
    // Con valor puesto no se puede plegar: se vería una configuración
    // distinta de la que se ejecuta.
    const abierto = terminoVisible || Boolean(fields.searchTerm.value.trim());
    show(campoTermino, abierto);
    terminoToggle.setAttribute('aria-expanded', String(abierto));
    terminoToggle.textContent = t(
      abierto ? 'explorer.termino.ocultar' : 'explorer.termino.mostrar'
    );
  }
  // Texto calculado a partir del estado: se repinta, no se enlaza.
  alCambiarIdioma(() => aplicarVistaTermino());

  // ── Qué se quiere obtener ──────────────────────────────────────────

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
    {
      type: 'text',
      placeholder: '.mp4, .webm',
      spellcheck: 'false',
      /**
       * Valor POR DEFECTO, no solo marcador de posición.
       *
       * Es lo que hace que el paso 2 arranque con "los archivos de dentro" y
       * el chip de Vídeo marcado: la tarjeta y el chip se deducen de este
       * campo, no al revés (ver sincronizarUI). Va como atributo `value` para
       * que `form.reset()` lo restaure igual que al resto.
       */
      value: PRESETS_EXTENSION[0].extensiones,
    }
  );

  const objetivoEnlaces = makeSegment(
    'objetivo',
    'enlaces',
    'explorer.objetivo.enlaces.breve',
    'explorer.objetivo.enlaces.hint',
    { checked: true }
  );

  const objetivoFicheros = makeSegment(
    'objetivo',
    'ficheros',
    'explorer.objetivo.ficheros.breve',
    'explorer.objetivo.ficheros.hint'
  );

  const opcionesObjetivo = [objetivoEnlaces, objetivoFicheros];

  const bloqueObjetivo = el('div', {
    className: 'field',
    children: [
      texto(el('p', { className: 'field__label' }), 'explorer.objetivo.pregunta'),
      makeSegmented(opcionesObjetivo),
    ],
  });

  /**
   * `chipsSlot` agrupa los chips de tipo de archivo Y los toggles de
   * peso/miniatura: es lo que se oculta entero cuando el objetivo es "solo
   * enlaces" (ver `sincronizarUI`). `display: contents` (en main.css) hace
   * que sus hijos se comporten como ítems directos de `.controls-row` — la
   * misma fila que la píldora de rango — sin dejar de poder ocultarse como
   * grupo.
   */
  const chipsSlot = el('div', { className: 'controls-row__group' });

  /**
   * Peso y miniaturas viven AQUÍ, no en los ajustes avanzados.
   *
   * Los dos son datos DE LOS ARCHIVOS, así que su sitio es justo debajo de
   * "¿qué tipo de archivo?" y no en un panel plegado que hay que saber abrir.
   * Al estar dentro de `chipsSlot` aparecen y desaparecen con la tarjeta de
   * "los archivos de dentro", que es lo correcto: sin fase 2 no hay ni pesos
   * ni miniaturas que traer.
   */
  const chipPeso = makeChipToggle('withSizes', 'explorer.peso.breve', 'explorer.peso.hint');
  const chipMiniaturas = makeChipToggle(
    'withThumbnails',
    'explorer.miniaturas.breve',
    'explorer.miniaturas.hint'
  );

  /**
   * Píldora compacta del rango de páginas Desde/Hasta, con un control
   * [−][+] que avanza o retrocede el rango preservando su tamaño (ver
   * `siguienteRango`, en `explorerOptions.js`).
   *
   * Los inputs son los mismos `startPage`/`endPage` de siempre: cambia la
   * disposición, no el contrato con `readForm()`.
   */
  const inputDesde = el('input', {
    className: 'range-pill__input',
    attrs: { id: 'explorer-startPage', name: 'startPage', type: 'number', min: '1', value: '1' },
  });
  fields.startPage = inputDesde;
  atributo(inputDesde, 'aria-label', 'explorer.desde.label');

  const inputHasta = el('input', {
    className: 'range-pill__input',
    attrs: { id: 'explorer-endPage', name: 'endPage', type: 'number', min: '1', value: '5' },
  });
  fields.endPage = inputHasta;
  atributo(inputHasta, 'aria-label', 'explorer.hasta.label');
  atributo(inputHasta, 'title', 'explorer.hasta.hint', { max: limits.maxPages });

  /** Mueve la ventana Desde/Hasta sin tocar su tamaño. */
  function moverRango(direccion) {
    const desde = Number(fields.startPage.value) || 1;
    const hasta = Number(fields.endPage.value) || desde;
    const { desde: nuevoDesde, hasta: nuevoHasta } = siguienteRango(desde, hasta, direccion);
    fields.startPage.value = String(nuevoDesde);
    fields.endPage.value = String(nuevoHasta);
  }

  const rangoAnteriorBtn = el('button', {
    className: 'range-pill__nav-btn',
    text: '−',
    attrs: { type: 'button' },
    on: { click: () => moverRango(-1) },
  });
  // Solo un símbolo: sin aria-label no lo anuncia ningún lector de pantalla.
  atributo(rangoAnteriorBtn, 'aria-label', 'explorer.rango.anterior');
  uiInputs.push(rangoAnteriorBtn);

  const rangoSiguienteBtn = el('button', {
    className: 'range-pill__nav-btn',
    text: '+',
    attrs: { type: 'button' },
    on: { click: () => moverRango(1) },
  });
  atributo(rangoSiguienteBtn, 'aria-label', 'explorer.rango.siguiente');
  uiInputs.push(rangoSiguienteBtn);

  const rangoPill = el('div', {
    className: 'range-pill',
    attrs: { role: 'group' },
    children: [
      texto(el('span', { className: 'range-pill__label' }), 'explorer.resumen.rango'),
      inputDesde,
      el('span', { className: 'range-pill__sep', text: '–', attrs: { 'aria-hidden': 'true' } }),
      inputHasta,
      el('div', { className: 'range-pill__nav', children: [rangoAnteriorBtn, rangoSiguienteBtn] }),
    ],
  });
  atributo(rangoPill, 'aria-label', 'explorer.rango.titulo');

  const etiquetaTipoArchivo = texto(el('p', { className: 'field__label' }), 'explorer.tipoArchivo');

  /**
   * Fila única de controles: chips de tipo de archivo, toggles de
   * peso/miniatura y la píldora de rango, todos con la misma altura, padding
   * y radio de píldora (ver `.chip`, `.chip--toggle` y `.range-pill` en
   * main.css).
   *
   * OJO: el rango es de la FASE 1 y sigue aplicando aunque "archivos de
   * dentro" (fase 2) esté desmarcado — por eso `rangoPill` NO vive dentro de
   * `chipsSlot`, que es lo único que se oculta con `sincronizarUI()`. Juntar
   * los dos en el mismo `show()` haría desaparecer el rango de páginas al
   * elegir "solo enlaces", sin ningún error visible.
   */
  const controlsRow = el('div', {
    className: 'controls-row',
    children: [chipsSlot, rangoPill],
  });

  const chipsBloque = el('div', {
    className: 'chips-block',
    children: [etiquetaTipoArchivo, controlsRow, campoExtensiones],
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

  setChildren(chipsSlot, [...chips.map(c => c.boton), chipOtro, chipPeso, chipMiniaturas]);

  // ── Ajustes avanzados ──────────────────────────────────────────────

  /**
   * `paginationMode` sigue siendo un campo con los mismos dos valores que
   * entiende el servidor (`auto` / `scroll`). El tercer radio ("a mano") es
   * solo la vista que enseña los patrones, así que no llega aquí.
   */
  fields.paginationMode = el('input', {
    attrs: { type: 'hidden', name: 'paginationMode', value: 'auto' },
  });

  const modoAuto = makeSegment(
    'modo',
    'auto',
    'explorer.modo.auto.breve',
    'explorer.modo.auto.hint',
    { checked: true }
  );

  const modoManual = makeSegment(
    'modo',
    'manual',
    'explorer.modo.manual.breve',
    'explorer.modo.manual.hint'
  );

  const modoScroll = makeSegment(
    'modo',
    'scroll',
    'explorer.modo.scroll.breve',
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
              makeSegmented(opcionesModo),
              resumenModo,
              bloqueManual,
            ],
          }),

          campoRapidez,

          makeSwitch('useJavaScript', 'explorer.navegador.label', 'explorer.navegador.hint'),
          makeSwitch('openLicenseOnly', 'explorer.licencia.label', 'explorer.licencia.hint'),
        ],
      }),
    ],
  });

  // ── Lanzar ─────────────────────────────────────────────────────────

  const submitButton = el('button', {
    className: 'button button--large',
    attrs: { type: 'submit' },
  });
  const detectButton = el('button', {
    className: 'button button--secondary',
    attrs: { type: 'button' },
  });
  const resetButton = el('button', {
    className: 'button button--ghost',
    attrs: { type: 'button' },
  });

  /** Aparece solo cuando hay una exploración frenada que continuar. */
  const continueButton = el('button', {
    className: 'button',
    attrs: { type: 'button' },
  });
  show(continueButton, false);

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
  alCambiarIdioma(() => {
    refrescarBotones();
    if (!continueButton.hidden) continueButton.textContent = t('explorer.continuar');
  });
  atributo(detectButton, 'title', 'explorer.detectar.title');
  texto(resetButton, 'explorer.limpiar');

  /** Panel con la propuesta y el porqué de cada campo. */
  const detectSlot = el('div');
  show(detectSlot, false);

  // ── Direcciones a explorar (multi-URL) ──────────────────────────────
  //
  // La PRIMERA fila es `fields.searchUrl` (creado más arriba): el campo del
  // contrato con `readForm()`, los perfiles y los enlaces compartidos. Las
  // filas siguientes son SOLO interfaz —direcciones adicionales que
  // comparten la misma configuración y se funden en
  // `construirParamsMultiUrl()` al enviar (ver explorerOptions.js)— y viven
  // en `filasUrlExtra`, fuera de `fields`: un perfil guardado o un enlace
  // compartido nunca las conocerá, así que no deben tocar ese contrato.
  //
  // "Configurar por mí" (`detectButton`) solo aparece en la primera fila: es
  // la única que analiza el sitio.

  let contadorFilaUrl = 0;
  /** @type {Array<{ id: string, input: HTMLInputElement }>} */
  let filasUrlExtra = [];

  function crearInputUrlExtra(valor = '') {
    const input = el('input', {
      className: 'input',
      attrs: { type: 'url', autocomplete: 'url', spellcheck: 'false', value: valor },
    });
    atributo(input, 'aria-label', 'explorer.urls.extra.aria');
    atributo(input, 'placeholder', 'explorer.url.placeholder');
    return input;
  }

  function crearBotonQuitarFila(onClick) {
    const boton = el('button', {
      className: 'button button--secondary button--icon',
      text: '✕',
      attrs: { type: 'button' },
      on: { click: onClick },
    });
    atributo(boton, 'aria-label', 'explorer.urls.quitar');
    atributo(boton, 'title', 'explorer.urls.quitar');
    return boton;
  }

  const listaFilasExtra = el('div', { className: 'url-list' });

  /** Repinta las filas extra y el estado de "quitar" de la primera fila. */
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
    const id = `url-extra-${contadorFilaUrl++}`;
    filasUrlExtra = [...filasUrlExtra, { id, input: crearInputUrlExtra(valor) }];
    pintarFilasUrl();
  }

  /** Vacía las filas extra: retrocompat con perfiles y enlaces de una URL. */
  function limpiarFilasExtra() {
    filasUrlExtra = [];
    pintarFilasUrl();
  }

  /**
   * Quitar la primera fila no destruye `fields.searchUrl` (sigue siendo EL
   * campo del contrato): en su lugar, promueve la siguiente fila a primera,
   * copiando su valor y descartándola de `filasUrlExtra`. Deshabilitado
   * cuando es la única dirección: no tiene sentido quitar la última que
   * queda.
   */
  const quitarPrimeraBtn = crearBotonQuitarFila(() => {
    if (filasUrlExtra.length === 0) return;
    const [primera, ...resto] = filasUrlExtra;
    fields.searchUrl.value = primera.input.value;
    filasUrlExtra = resto;
    pintarFilasUrl();
  });

  const filaPrincipal = el('div', {
    className: 'url-row',
    children: [fields.searchUrl, detectButton, quitarPrimeraBtn],
  });

  const agregarUrlBtn = el('button', {
    className: 'link-toggle',
    attrs: { type: 'button' },
    on: { click: () => agregarFilaExtra() },
  });
  texto(agregarUrlBtn, 'explorer.urls.agregar');

  const bloqueDirecciones = el('div', {
    className: 'field',
    children: [
      texto(
        el('label', { className: 'field__label', attrs: { for: 'explorer-searchUrl' } }),
        'explorer.url.label'
      ),
      el('div', { className: 'url-list', children: [filaPrincipal, listaFilasExtra] }),
      agregarUrlBtn,
      texto(el('p', { className: 'field__hint' }), 'explorer.url.hint'),
    ],
  });

  pintarFilasUrl(); // Estado inicial: sin filas extra, "quitar" deshabilitado.

  const form = el('form', {
    className: 'explorer-form',
    attrs: { novalidate: true },
    children: [
      bloqueDirecciones,
      terminoToggle,
      campoTermino,

      el('div', {
        className: 'button-row button-row--principal',
        children: [submitButton, continueButton, resetButton],
      }),

      bloqueObjetivo,
      // El rango de páginas (dentro de `chipsBloque`, en `rangoPill`) es de
      // la FASE 1 y sigue aplicando aunque «solo enlaces» oculte el resto de
      // este bloque: ver la nota junto a `controlsRow` más arriba.
      chipsBloque,

      advanced,
      detectSlot,
    ],
  });

  const profileBar = createProfileBar({
    getConfig: () => currentConfig(),
    applyConfig: config => applyConfig(config),
  });

  // ── Carril de pasos ──────────────────────────────────────────────
  //
  // Tres pasos fijos del recorrido: Configurar → Progreso → Resultados. La
  // fase 1 y la fase 2 del crawl del backend son sub-estados de UN mismo paso
  // ("Progreso"), no pasos distintos del carril.
  //
  // El carril se pinta SOLO desde `actualizarCarril()`, llamada desde los
  // mismos puntos donde ya cambiaba la visibilidad de progressCard/statsCard
  // o se reseteaba el formulario: no hay ciclo de vida nuevo, solo el
  // pintado añadido a los callbacks existentes.
  const ORDEN_PASOS = ['configurar', 'progreso', 'resultados'];

  const crearPaso = (id, numero, labelKey) => {
    const indicador = el('span', {
      className: 'step__indicator',
      text: String(numero),
      attrs: { 'aria-hidden': 'true' },
    });
    const etiqueta = texto(el('span', { className: 'step__label' }), labelKey);
    const root = el('div', {
      className: 'step',
      attrs: { 'data-step': id, 'data-state': 'pendiente' },
      children: [indicador, etiqueta],
    });
    return { id, root };
  };

  const pasosCarril = [
    crearPaso('configurar', 1, 'explorer.pasos.configurar'),
    crearPaso('progreso', 2, 'explorer.pasos.progreso'),
    crearPaso('resultados', 3, 'explorer.pasos.resultados'),
  ];

  const stepsRail = el('nav', {
    className: 'steps-rail',
    children: pasosCarril.map(p => p.root),
  });
  atributo(stepsRail, 'aria-label', 'explorer.pasos.titulo');

  /**
   * Pinta el carril según en qué paso del recorrido está el usuario.
   *
   * Solo el `data-state` cambia (pendiente/activo/completado): no hay texto
   * visible que dependa del estado, así que no necesita registrarse en
   * `alCambiarIdioma()` aparte de las etiquetas fijas, que ya se enlazan con
   * `texto()` al crear cada paso.
   */
  function actualizarCarril(pasoActivo) {
    const idx = ORDEN_PASOS.indexOf(pasoActivo);
    pasosCarril.forEach((paso, i) => {
      const estado = i < idx ? 'completado' : i === idx ? 'activo' : 'pendiente';
      paso.root.setAttribute('data-state', estado);
      if (estado === 'activo') paso.root.setAttribute('aria-current', 'step');
      else paso.root.removeAttribute('aria-current');
    });
  }

  // ── Formulario (`.explorer-panel`) y progreso/cifras, aparte ─────────
  //
  // El formulario es `.card.card--form` (760px, pensado para no obligar a
  // barrer la pantalla de lado a lado en una sola columna). Progreso y
  // cifras NO comparten esa restricción: son datos de la exploración, no de
  // un formulario, y antes de este cambio vivían dentro de `.explorer-panel`
  // como secciones (separadas por un borde interno, ver
  // `.explorer-panel__section`), así que su ancho quedaba atado al del
  // formulario y no al de los resultados que vienen justo debajo. Ahora
  // viven en `progressPanel`, su propia `.card` sin `card--form`, con el
  // mismo ancho que `results.root`. Progreso y cifras siguen ocultándose
  // igual que antes (`show()`), solo que ahora ocultan la sección dentro de
  // esa tarjeta en vez de dentro del formulario.
  const progress = createProgressPanel();
  const progressSection = el('div', {
    className: 'card__body explorer-panel__section',
    children: [progress.root],
  });
  show(progressSection, false);

  const alertSlot = el('div');
  show(alertSlot, false);

  const statsSlot = el('div', { className: 'card__body explorer-panel__section' });
  show(statsSlot, false);

  /**
   * Contenedor propio de progreso y cifras, con el mismo ancho que
   * `results.root` (los dos son `.card` sin `card--form`). Arranca oculto:
   * mientras las dos secciones de dentro están ocultas, la tarjeta no debe
   * dejar un hueco vacío con borde y sombra entre el formulario y los
   * resultados.
   */
  const progressPanel = el('div', {
    className: 'card explorer-progress',
    children: [progressSection, statsSlot],
  });
  show(progressPanel, false);

  /**
   * Bloque de configuración: barra de perfiles + formulario completo.
   *
   * Se le da nombre propio (`configBody`) porque al lanzar una exploración se
   * pliega a `configSummary` (ver más abajo): compite por espacio con el
   * progreso y los resultados justo cuando ya no hace falta verlo entero.
   */
  const configBody = el('div', { className: 'card__body', children: [profileBar.root, form] });

  /**
   * Resumen de una línea, visible mientras `configBody` está plegado.
   *
   * SIEMPRE lee de `fields`/`readForm()` en el momento de pintarse
   * (`pintarResumenConfig`), nunca guarda su propia copia de los valores: es
   * la misma regla que sigue `sincronizarUI()`. Si guardara los suyos, un
   * "Editar" podría reabrir el formulario con datos distintos de los que en
   * realidad se enviaron, sin que nada lo avisara.
   */
  const resumenUrlValor = el('span', { className: 'config-summary__value' });
  const resumenTipoValor = el('span', { className: 'config-summary__value' });
  const resumenRangoValor = el('span', { className: 'config-summary__value' });

  const resumenEditarBtn = el('button', {
    className: 'button button--ghost button--small config-summary__editar',
    attrs: { type: 'button' },
  });
  texto(resumenEditarBtn, 'explorer.resumen.editar');

  /**
   * "↺ Nueva búsqueda": vuelve al paso 1 con el formulario RESETEADO.
   *
   * Distinto de "Editar", que vuelve al paso 1 CONSERVANDO la configuración.
   * Antes había que pulsar "Editar" y luego "Limpiar" para lograr lo mismo;
   * el click handler es el mismo que el de `resetButton` (más abajo,
   * `limpiarFormularioCompleto()`), así que las dos formas de reiniciar se
   * mantienen idénticas por definición.
   */
  const resumenNuevaBtn = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
  });
  texto(resumenNuevaBtn, 'explorer.resumen.nuevaBusqueda');

  const itemResumen = (labelKey, valorNodo) =>
    el('span', {
      className: 'config-summary__item',
      children: [texto(el('span', { className: 'config-summary__label' }), labelKey), valorNodo],
    });

  const configSummary = el('div', {
    className: 'config-summary',
    children: [
      el('div', {
        className: 'config-summary__items',
        children: [
          itemResumen('explorer.resumen.url', resumenUrlValor),
          itemResumen('explorer.resumen.tipo', resumenTipoValor),
          itemResumen('explorer.resumen.rango', resumenRangoValor),
        ],
      }),
      el('div', {
        className: 'config-summary__acciones',
        children: [resumenEditarBtn, resumenNuevaBtn],
      }),
    ],
  });
  show(configSummary, false);

  /**
   * Repinta el resumen a partir de los CAMPOS. Nunca al revés.
   *
   * Se registra en `alCambiarIdioma()` porque es texto calculado (el tipo de
   * archivo y el rango se arman con `t()`), no fijo.
   */
  function pintarResumenConfig() {
    const params = readForm();
    const urls = readUrls();
    // Con una sola dirección se enseña ella misma, como siempre; con varias,
    // el conteo: la línea de resumen no tiene ancho para tres o cuatro URLs.
    resumenUrlValor.textContent =
      urls.length > 1
        ? tp('explorer.resumen.direcciones', urls.length)
        : urls[0] || params.searchUrl;

    if (!params.fileExtensions) {
      resumenTipoValor.textContent = t('explorer.resumen.tipo.soloEnlaces');
    } else {
      const preset = presetCompatibleDe(params.fileExtensions);
      const presetInfo =
        preset && preset.exacto ? PRESETS_EXTENSION.find(p => p.id === preset.id) : null;
      resumenTipoValor.textContent = presetInfo ? t(presetInfo.etiquetaKey) : params.fileExtensions;
    }

    resumenRangoValor.textContent = t('explorer.resumen.rango.valor', {
      desde: params.startPage,
      hasta: params.endPage,
    });
  }
  alCambiarIdioma(() => pintarResumenConfig());

  resumenEditarBtn.addEventListener('click', () => {
    show(configSummary, false);
    show(configBody, true);
    // Los valores YA están en `fields`; esto solo recalcula segmentados y
    // chips para que la interfaz vuelva a ser consistente con ellos (nunca al
    // revés, ver la nota de `sincronizarUI`).
    sincronizarUI();
  });

  const explorerPanel = el('div', {
    className: 'card card--form explorer-panel',
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
      configBody,
      configSummary,
      alertSlot,
    ],
  });

  const results = createResultList({
    emptyTitleKey: 'explorer.vacio.titulo',
    emptyTextKey: 'explorer.vacio.texto',
    filename: 'urlexplorer-resultados.txt',
  });

  const explorerShell = el('div', {
    className: 'explorer-shell',
    children: [
      stepsRail,
      el('div', {
        className: 'explorer-shell__content',
        children: [explorerPanel, progressPanel, results.root],
      }),
    ],
  });

  setChildren(container, explorerShell);
  actualizarCarril('configurar');

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
    const r = presetCompatibleDe(extensiones);

    for (const opcion of opcionesObjetivo) opcion.input.checked = opcion.value === objetivo;

    // `chipsSlot` agrupa los chips de tipo Y los toggles de peso/miniatura:
    // se ocultan juntos, sin extensiones no hay ni fase 2 ni esos datos. La
    // píldora de rango (`rangoPill`) queda FUERA de este grupo a propósito:
    // el rango es de la fase 1 y sigue aplicando con "solo enlaces". Ver la
    // nota junto a `controlsRow`.
    const mostrarFicheros = objetivo === 'ficheros';
    show(etiquetaTipoArchivo, mostrarFicheros);
    show(chipsSlot, mostrarFicheros);

    // "Chip encendido" y "campo de texto visible" NO son lo mismo. Un valor
    // contenido en un preset (`.mp4` dentro de vídeo) enciende su chip, pero
    // el campo se sigue viendo: con el chip solo, el usuario leería "Vídeo" y
    // daría por hecho que también se trae `.webm`. Nada de estado invisible.
    const otro = mostrarExtensionesLibres || r?.id === 'otro';
    for (const chip of chips) {
      const activo = !mostrarExtensionesLibres && r?.id === chip.id;
      chip.boton.setAttribute('aria-pressed', String(activo));
      chip.boton.classList.toggle('chip--activo', activo);
    }
    chipOtro.setAttribute('aria-pressed', String(otro));
    chipOtro.classList.toggle('chip--activo', otro);
    show(campoExtensiones, mostrarFicheros && (otro || (r ? !r.exacto : false)));

    const modo = modoAvanzadoDe({
      paginationMode: fields.paginationMode.value,
      linkPattern: fields.linkPattern.value,
      pageParam: fields.pageParam.value,
    });
    for (const opcion of opcionesModo) opcion.input.checked = opcion.value === modo;

    aplicarVistaModo();
    // Un término que llega de fuera tiene que verse: si el campo se quedara
    // plegado, la palabra viajaría al servidor sin aparecer en pantalla.
    aplicarVistaTermino();
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
      withThumbnails: fields.withThumbnails.checked,
    };
  }

  /**
   * Todas las direcciones NO vacías: la primera (`fields.searchUrl`) y las
   * filas extra. Es lo único que sabe combinarlas; el resto del código pide
   * esta lista y la pasa a `construirParamsMultiUrl()` al enviar.
   */
  function readUrls() {
    return [fields.searchUrl.value, ...filasUrlExtra.map(f => f.input.value)]
      .map(u => u.trim())
      .filter(Boolean);
  }

  /**
   * Vuelca una configuración guardada o venida por URL en el formulario.
   *
   * `resetUrls` por defecto vacía las filas extra: un perfil o un enlace
   * compartido solo conocen una dirección (`CONFIG_KEYS` en profiles.js), así
   * que aplicarlos siempre debe dejar UNA sola fila (retrocompat). La
   * detección ("Configurar por mí") es la excepción: solo corrige la primera
   * dirección y no debe tocar las demás que el usuario ya haya agregado.
   */
  function applyConfig(config, { resetUrls = true } = {}) {
    if (!config) return;
    if (resetUrls) limpiarFilasExtra();
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

  /**
   * Configuración actual, para guardarla o convertirla en enlace.
   *
   * A propósito NO incluye las direcciones extra: los perfiles guardados y
   * los enlaces compartidos son el contrato de `fields`, y ya existen sin
   * conocer ninguna lista de URLs. Añadirles un campo ahora dejaría a los
   * que ya existen sin la información y complicaría leerlos hacia atrás.
   */
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
        if (key === 'urlsExtra' || !fields[key]) continue;
        if (fields[key].type === 'checkbox') fields[key].checked = Boolean(value);
        else fields[key].value = value;
      }
      // Las direcciones extra NO son parte de `fields` (ver `currentConfig`),
      // pero sí conviene recordarlas dentro de esta misma sesión, igual que
      // el resto del formulario recordado.
      if (Array.isArray(saved.urlsExtra)) {
        for (const valor of saved.urlsExtra) {
          if (String(valor ?? '').trim()) agregarFilaExtra(valor);
        }
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
      state.urlsExtra = filasUrlExtra.map(f => f.input.value);
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
    // Las direcciones extra y sus controles no viven en `fields` ni en
    // `uiInputs`: es un bloque que se reconstruye entero cada vez que se
    // agrega o quita una fila (`pintarFilasUrl`), así que se deshabilita
    // recorriendo el DOM en vez de acumular referencias que quedarían
    // huérfanas en cuanto una fila se repinta.
    quitarPrimeraBtn.disabled = busy || filasUrlExtra.length === 0;
    agregarUrlBtn.disabled = busy;
    for (const nodo of listaFilasExtra.querySelectorAll('input, button')) nodo.disabled = busy;
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
  /** Cuántos resultados hay ocultados a mano AHORA MISMO (ver más abajo). */
  let ocultosManualmente = 0;

  /**
   * Tarjeta KPI destacada.
   *
   * `acento` es la que de verdad importa a simple vista (archivos o enlaces
   * encontrados); `advertencia` es para "Ocultados manualmente", que solo
   * aparece si hay alguno y conviene que se note.
   */
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

  /**
   * Repinta las cifras del último `complete` conocido.
   *
   * Reemplaza a la barra `.stats` de antes (enlaces/páginas/ficheros/
   * duración/fallidas, cinco cifras neutras) por CUATRO tarjetas KPI: la
   * destacada (archivos, o enlaces si no hubo fase 2), direcciones
   * analizadas, grupos de duplicados y —solo si hay alguno— ocultados a
   * mano. Lo que antes vivía en la barra (páginas recorridas, duración,
   * fallidas) no desaparece: se resume en una línea aparte, porque perderlo
   * en silencio sería la misma clase de regresión que el resto de este
   * proyecto evita.
   */
  function renderStats(payload) {
    if (payload) ultimasStats = payload;
    if (!ultimasStats) return;

    const datos = ultimasStats;
    const deepSearch = datos.extensions?.length > 0;

    const cards = [
      deepSearch
        ? kpiCard(datos.totalFiles ?? 0, t('kpi.archivos'), { acento: true })
        : kpiCard(datos.totalLinks ?? 0, t('kpi.enlaces'), { acento: true }),
      kpiCard(datos.direccionesAnalizadas ?? 1, t('kpi.direcciones')),
      kpiCard(datos.duplicateGroups?.length ?? 0, t('kpi.duplicados')),
    ];

    if (ocultosManualmente > 0) {
      cards.push(kpiCard(ocultosManualmente, t('kpi.ocultos'), { advertencia: true }));
    }

    const detalle =
      datos.pagesScraped !== undefined && datos.durationMs !== undefined
        ? t('kpi.detalle', {
            paginas: datos.pagesScraped,
            segundos: (datos.durationMs / 1000).toFixed(1),
          }) +
          (datos.failures?.length > 0
            ? t('kpi.detalle.fallidas', { n: datos.failures.length })
            : '')
        : '';

    setChildren(statsSlot, [
      el('div', { className: 'kpi-grid', children: cards }),
      detalle ? el('p', { className: 'field__hint', text: detalle }) : null,
    ]);
    show(statsSlot, true);
    // Cinturón y tirantes: si algo llegara a mostrar las cifras sin haber
    // pasado por el `show(progressPanel, true)` del envío o de "continuar",
    // la tarjeta que las envuelve no debe seguir oculta.
    show(progressPanel, true);
  }

  alCambiarIdioma(() => renderStats(null));

  // "Ocultados manualmente" vive fuera de la tarjeta de resultados (es una
  // cifra del explorador, no un filtro), así que necesita que resultList.js
  // le avise cada vez que cambia en vez de leer su estado interno.
  results.onHiddenChange(count => {
    ocultosManualmente = count;
    renderStats(null);
  });

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
            className: 'card__header card__header--con-cierre',
            children: [
              el('div', {
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
              // Cierre propio del panel: antes solo se ocultaba al volver a
              // pulsar "Configurar por mí" o al limpiar el formulario. El
              // botón de "Limpiar" (`resetButton`) no se toca: esta X es la
              // única forma nueva de cerrar el panel sin vaciar el formulario.
              el('button', {
                className: 'button button--secondary button--small button--icon',
                text: '×',
                attrs: { type: 'button', 'aria-label': t('propuesta.cerrar') },
                on: { click: () => show(detectSlot, false) },
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
      // La detección solo corrige la PRIMERA dirección: no debe vaciar las
      // filas extra que el usuario ya haya agregado (a diferencia de cargar
      // un perfil o un enlace compartido, que sí resetean a una sola fila).
      applyConfig(aplicar, { resetUrls: false });

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
    jobIdActual = null;
    setBusy(false);
    progress.finish({ aborted });
  }

  /**
   * Frenar NO cierra el stream.
   *
   * Se le pide al servidor que pare, y el propio crawl cierra normalmente
   * —agrupando duplicados— con lo que lleve. Cerrar aquí a lo bruto tiraría
   * justo el resumen que se quiere conservar.
   */
  progress.onCancel(async () => {
    if (!jobIdActual) {
      stopStream({ aborted: true });
      return;
    }
    try {
      await pauseScrape(jobIdActual);
    } catch {
      // Si no se pudo avisar, se corta a la antigua: mejor parar que seguir
      stopStream({ aborted: true });
    }
  });

  /** Muestra u oculta "continuar" según haya algo pendiente. */
  function actualizarContinuar(pendientes) {
    const hayPendiente = Boolean(jobIdPendiente) && pendientes > 0;
    show(continueButton, hayPendiente);
    if (hayPendiente) {
      continueButton.textContent = t('explorer.continuar');
      continueButton.setAttribute('title', t('explorer.continuar.title', { n: pendientes }));
    }
  }

  continueButton.addEventListener('click', () => {
    if (!jobIdPendiente) return;

    clearAlert();
    progress.reset();
    show(progressPanel, true);
    show(progressSection, true);
    actualizarCarril('progreso');
    setBusy(true);
    show(continueButton, false);

    // Se reanuda por id: los enlaces que faltan los tiene el servidor
    const collected = { files: [] };
    stream = openScrapeStream(
      { resume: jobIdPendiente },
      { onEvent: event => handleEvent(event, collected) }
    );
  });

  function handleEvent(event, collected) {
    // Exploración de varias direcciones: el servidor añade `urlActual`/
    // `urlTotal` a CADA evento de progreso de la dirección en curso (y manda
    // un `url_start` propio al empezar cada una). Con una sola dirección
    // `urlTotal` es 1 (o no viene) y el panel lo deja oculto: no hay "1 de 1"
    // que anunciar.
    if (event.type !== 'complete' && event.type !== 'error' && event.urlActual && event.urlTotal) {
      progress.startUrl(event);
    }

    switch (event.type) {
      // El servidor manda el id ANTES de empezar: sin él no habría a quién
      // decirle "frena" mientras la exploración corre.
      case 'job':
        jobIdActual = event.jobId;
        break;

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
        /**
         * Frenada a medias: queda por dónde seguir.
         *
         * Los enlaces pendientes NO llegan aquí —son miles— sino que los
         * guarda el servidor. Lo único que se conserva es el identificador.
         */
        jobIdPendiente = event.jobId || null;
        actualizarContinuar(event.pendientesTotal || 0);
        actualizarCarril('resultados');

        // Si hubo fase 2 se muestran los ficheros; si no, los enlaces
        const deepSearch = event.extensions?.length > 0;
        results.setItems(deepSearch ? event.files : event.links);
        if (event.fileDetails) results.setDetails(event.fileDetails);
        // Los duplicados se pliegan, no se descartan: la lista sigue entera y
        // el interruptor de la barra los devuelve.
        if (event.duplicateGroups) {
          results.setDuplicateGroups(event.duplicateGroups, event.duplicateGroupsPorDuracion);
        }
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

        /**
         * El aviso de "frenada" va el último a propósito.
         *
         * Cada aviso reemplaza al anterior, y cuando alguien acaba de pulsar
         * "Frenar" lo que necesita saber es que puede continuar, no que el
         * peso de tres ficheros no se pudo obtener.
         */
        if (event.paused && (event.pendientesTotal || 0) > 0) {
          mostrarAviso('warning', 'aviso.frenada', 'aviso.frenada.body', {
            n: event.pendientesTotal,
          });
        }

        stopStream();
        break;
      }

      case 'error':
        // Un trabajo caducado no es un fallo de la búsqueda: es que lo
        // pendiente vivía en memoria y ya no está. Merece su propio mensaje.
        if (event.code === 'JOB_EXPIRED') {
          jobIdPendiente = null;
          show(continueButton, false);
          showError('error.trabajoCaducado', 'error.trabajoCaducado.body');
        } else {
          showError('error.busquedaFallo', null, undefined, event.message);
        }
        stopStream();
        break;

      default:
        break;
    }
  }

  form.addEventListener('submit', submitEvent => {
    submitEvent.preventDefault();
    const params = readForm();
    const urls = readUrls();

    if (urls.length === 0) {
      showError('error.faltaUrl', 'error.faltaUrl.explorar');
      fields.searchUrl.focus();
      return;
    }

    // Basta con que UNA dirección esté mal escrita: se señala la primera y
    // se enfoca su fila, sea la principal o una extra.
    const invalida = urls.find(u => !/^https?:\/\//i.test(u));
    if (invalida) {
      showError('error.urlInvalida', 'error.urlInvalida.body');
      const filaInvalida = filasUrlExtra.find(f => f.input.value.trim() === invalida);
      (filaInvalida ? filaInvalida.input : fields.searchUrl).focus();
      return;
    }

    if (/\{(?:q|query|termino|término)\}/i.test(urls.join(' ')) && !params.searchTerm) {
      showError('error.faltaTermino', 'error.faltaTermino.body');
      // Se pide una palabra que está en un campo plegado: sin desplegarlo, el
      // aviso señalaría a algo que no se ve.
      terminoVisible = true;
      aplicarVistaTermino();
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

    // Con varias direcciones basta con que UNA lleve la plantilla: la
    // configuración es compartida, así que si alguna la trae, el rango se
    // resuelve por dirección igual que en el caso de una sola.
    const paginaPorPlantilla = urls.some(u => /\{page(?::\d+)?\}/i.test(u));
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
    // Una exploración nueva invalida la frenada anterior: continuar aquella
    // mezclaría resultados de dos búsquedas distintas.
    jobIdPendiente = null;
    show(continueButton, false);
    clearAlert();
    results.clear();
    show(statsSlot, false);
    progress.reset();
    show(progressPanel, true);
    show(progressSection, true);
    actualizarCarril('progreso');
    setBusy(true);

    // El bloque de configuración se pliega a una línea de resumen: ya no hace
    // falta verlo entero mientras corre la exploración, y compite con el
    // progreso y los resultados. "Editar" es la única forma de volver a
    // abrirlo antes de resetear.
    show(configBody, false);
    pintarResumenConfig();
    show(configSummary, true);

    const collected = { files: [] };
    const streamParams = construirParamsMultiUrl(urls, params);
    stream = openScrapeStream(streamParams, {
      onEvent: event => handleEvent(event, collected),
    });
  });

  /**
   * Vuelve al paso 1 con el formulario RESETEADO por completo.
   *
   * La comparten `resetButton` ("Limpiar", siempre visible en el formulario)
   * y `resumenNuevaBtn` ("↺ Nueva búsqueda", visible mientras el resumen
   * está plegado): son la misma acción, solo que accesible desde dos sitios
   * distintos del recorrido. "Editar" es la otra forma de volver al paso 1,
   * pero CONSERVANDO la configuración: no comparte esta función.
   */
  function limpiarFormularioCompleto() {
    stopStream();
    form.reset();
    fields.paginationMode.value = 'auto';
    fields.startPage.value = '1';
    fields.endPage.value = '5';
    fields.concurrency.value = String(limits.defaultConcurrency);
    mostrarExtensionesLibres = false;
    terminoVisible = false;
    // Las direcciones extra son solo interfaz (ver más arriba): "Nueva
    // búsqueda" y "Limpiar" también las vacían, igual que a cualquier otro
    // campo del formulario.
    limpiarFilasExtra();
    jobIdPendiente = null;
    show(continueButton, false);
    sincronizarUI();
    clearAlert();
    results.clear();
    ultimasStats = null;
    ocultosManualmente = 0;
    show(statsSlot, false);
    show(progressSection, false);
    show(progressPanel, false);
    actualizarCarril('configurar');
    // Vuelve a mostrarse el formulario completo y se pliega el resumen: tras
    // "Limpiar" ya no hay nada que resumir.
    show(configBody, true);
    show(configSummary, false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sin almacenamiento: nada que limpiar
    }
  }

  resetButton.addEventListener('click', limpiarFormularioCompleto);
  resumenNuevaBtn.addEventListener('click', limpiarFormularioCompleto);

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
