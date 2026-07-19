import { el, setChildren, clear, alertBox, stat, show, toast } from '../dom.js';
import { openScrapeStream, detectConfig } from '../api.js';
import { createProgressPanel } from '../components/progress.js';
import { createResultList } from '../components/resultList.js';
import { createProfileBar, configFromUrl } from '../components/profiles.js';

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
 */
/**
 * Ejemplos de paginación.
 *
 * Los dos modos (parámetro y plantilla {page}) no son obvios mirando el
 * formulario, así que se muestran casos reales: la URL tal como la ve el
 * usuario en el navegador y qué tiene que rellenar en cada caso.
 */
function paginationExamples() {
  const CASES = [
    { cambio: '?page=2', donde: 'Parámetro de página', valor: 'page' },
    { cambio: '/page/2', donde: 'URL de partida', valor: '…/page/{page}' },
    { cambio: '/01, /02', donde: 'URL de partida', valor: '…/{page:02}' },
  ];

  return el('div', {
    className: 'examples',
    children: [
      el('p', {
        className: 'examples__title',
        text: 'Pasa a la página 2 en el sitio y mira qué cambia en su URL:',
      }),
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
              el('span', { className: 'examples__field', text: item.donde }),
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
  let stream = null;

  const makeField = (name, label, hint, inputAttrs = {}) => {
    const input = el('input', {
      className: 'input',
      attrs: { id: `explorer-${name}`, name, ...inputAttrs },
    });
    fields[name] = input;
    return el('div', {
      className: 'field',
      children: [
        el('label', { className: 'field__label', text: label, attrs: { for: `explorer-${name}` } }),
        input,
        hint ? el('p', { className: 'field__hint', text: hint }) : null,
      ],
    });
  };

  const makeSelect = (name, label, hint, opciones) => {
    const select = el('select', {
      className: 'input',
      attrs: { id: `explorer-${name}`, name },
      children: opciones.map(o => el('option', { text: o.label, attrs: { value: o.value } })),
    });
    fields[name] = select;
    return el('div', {
      className: 'field',
      children: [
        el('label', { className: 'field__label', text: label, attrs: { for: `explorer-${name}` } }),
        select,
        hint ? el('p', { className: 'field__hint', text: hint }) : null,
      ],
    });
  };

  const makeSwitch = (name, title, hint) => {
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
            el('span', { className: 'switch__title', text: title }),
            el('span', { className: 'switch__hint', text: hint }),
          ],
        }),
      ],
    });
  };

  const submitButton = el('button', {
    className: 'button',
    text: 'Explorar',
    attrs: { type: 'submit' },
  });

  const resetButton = el('button', {
    className: 'button button--secondary',
    text: 'Limpiar',
    attrs: { type: 'button' },
  });

  const detectButton = el('button', {
    className: 'button button--secondary',
    text: 'Detectar configuración',
    attrs: {
      type: 'button',
      title: 'Abre la URL y propone una configuración. Siempre es una sugerencia: revísala.',
    },
  });

  /** Panel con la propuesta y el porqué de cada campo. */
  const detectSlot = el('div');
  show(detectSlot, false);

  const form = el('form', {
    className: 'grid',
    attrs: { novalidate: true },
    children: [
      makeField(
        'searchUrl',
        'URL de partida',
        'Admite dos marcadores: {q} para el término a buscar y {page} para paginar. Ejemplo: sitio.com/search/{q}/?page={page}',
        {
          type: 'url',
          placeholder: 'https://ejemplo.com/galeria?q=gatos',
          required: true,
          autocomplete: 'url',
          spellcheck: 'false',
        }
      ),

      makeField(
        'searchTerm',
        'Término a buscar',
        'Lo que quieres buscar. Se inserta donde la URL de partida tenga {q}, así el sitio se guarda una vez y solo cambias esta palabra.',
        { type: 'text', placeholder: 'argentina', spellcheck: 'false' }
      ),

      el('div', {
        className: 'grid grid--2',
        children: [
          makeField(
            'linkPattern',
            'Patrón de enlace',
            'Vacío = todos. "/videos/" busca en el href original; "https://…" compara desde el principio. Entre barras y con algún símbolo es una expresión regular: /\\/videos\\/\\d+/ solo coge las fichas numeradas.',
            { type: 'text', placeholder: '/videos/', spellcheck: 'false' }
          ),
          makeField(
            'fileExtensions',
            'Extensiones a buscar',
            'Vacío = solo se recogen enlaces (sin fase 2). Separadas por comas.',
            { type: 'text', placeholder: '.mp4, .webm', spellcheck: 'false' }
          ),
        ],
      }),

      el('details', {
        className: 'disclosure',
        children: [
          el('summary', {
            className: 'disclosure__summary',
            text: 'Paginación y opciones avanzadas',
          }),
          el('div', {
            className: 'disclosure__content grid',
            children: [
              makeSelect(
                'paginationMode',
                'Cómo pagina el sitio',
                'Automático sirve para casi todo: usa el parámetro de página o la plantilla {page} de la URL. Elige "scroll" solo si el sitio no tiene botonera de páginas y carga más resultados al bajar.',
                [
                  { value: 'auto', label: 'Automático (parámetro o plantilla)' },
                  { value: 'scroll', label: 'Scroll infinito (carga al bajar)' },
                ]
              ),

              el('div', {
                className: 'grid grid--3',
                children: [
                  makeField(
                    'pageParam',
                    'Parámetro de página',
                    'Solo el nombre. Si lo copias como "&page" o "page=" se limpia solo.',
                    { type: 'text', placeholder: 'page', spellcheck: 'false' }
                  ),
                  makeField('startPage', 'Desde', null, {
                    type: 'number',
                    min: '1',
                    value: '1',
                  }),
                  makeField('endPage', 'Hasta', `Máximo ${limits.maxPages} páginas por búsqueda.`, {
                    type: 'number',
                    min: '1',
                    value: '5',
                  }),
                ],
              }),

              paginationExamples(),
              makeField(
                'concurrency',
                'Peticiones simultáneas',
                `Entre 1 y ${limits.maxConcurrency}. Por defecto ${limits.defaultConcurrency}.`,
                {
                  type: 'number',
                  min: '1',
                  max: String(limits.maxConcurrency),
                  value: String(limits.defaultConcurrency),
                }
              ),
              makeSwitch(
                'useJavaScript',
                'Renderizar con navegador',
                'Ejecuta el JavaScript en las dos fases: al recorrer la paginación y al entrar en cada enlace. Necesario si el sitio carga el contenido dinámicamente o bloquea a los clientes sin navegador. Mucho más lento: cuenta varios segundos por enlace.'
              ),
              makeSwitch(
                'withSizes',
                'Obtener el tamaño de cada fichero',
                'Hace una petición extra por fichero para saber cuánto pesa, sin descargarlo. Permite ordenar por tamaño y distinguir un vídeo completo de un clip de vista previa. Va más lento.'
              ),
              makeSwitch(
                'openLicenseOnly',
                'Solo material con licencia abierta',
                'Se queda únicamente con las páginas que declaran una licencia abierta (Creative Commons, dominio público, CC0…). Lo que no declara licencia se descarta: por defecto una obra nace con todos los derechos reservados, así que la ausencia de licencia no significa que sea libre.'
              ),
            ],
          }),
        ],
      }),

      el('div', { className: 'button-row', children: [submitButton, detectButton, resetButton] }),
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
          el('h2', {
            className: 'card__title',
            text: 'Explorar un sitio',
            attrs: { id: 'explorer-heading' },
          }),
          el('p', {
            className: 'card__hint',
            text: 'Recorre las páginas de una sección y extrae los enlaces que coincidan con el patrón.',
          }),
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
    emptyTitle: 'Todavía no hay resultados',
    emptyText: 'Introduce una URL y pulsa Explorar para empezar.',
    filename: 'urlexplorer-resultados.txt',
  });

  setChildren(container, [formCard, alertSlot, progressCard, statsCard, results.root]);

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
    submitButton.disabled = busy;
    submitButton.textContent = busy ? 'Explorando…' : 'Explorar';
    for (const input of Object.values(fields)) input.disabled = busy;
  }

  function showError(title, body) {
    setChildren(alertSlot, alertBox({ variant: 'error', title, body }));
    show(alertSlot, true);
  }

  function clearAlert() {
    clear(alertSlot);
    show(alertSlot, false);
  }

  function renderStats(payload) {
    const cards = [
      stat(payload.totalLinks ?? 0, 'Enlaces'),
      stat(payload.pagesScraped ?? 0, 'Páginas recorridas'),
    ];

    if (payload.extensions?.length > 0) {
      cards.push(stat(payload.totalFiles ?? 0, 'Ficheros'));
    }
    if (payload.durationMs !== undefined) {
      cards.push(stat(`${(payload.durationMs / 1000).toFixed(1)}s`, 'Duración'));
    }
    if (payload.failures?.length > 0) {
      cards.push(stat(payload.failures.length, 'Páginas fallidas'));
    }

    setChildren(statsSlot, el('div', { className: 'stats', children: cards }));
    show(statsCard, true);
  }

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
            el('code', { className: 'propuesta__valor', text: valor || '(vacío)' }),
            confianza
              ? el('span', {
                  className: `badge badge--${confianza === 'alta' ? 'success' : 'accent'}`,
                  text: `confianza ${confianza}`,
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
      filaPropuesta('Patrón de enlace', sugerencia.linkPattern, motivos.patron, confianza.patron),
      filaPropuesta(
        'Paginación',
        sugerencia.pageParam ? `parámetro "${sugerencia.pageParam}"` : sugerencia.searchUrl,
        motivos.paginacion,
        confianza.paginacion
      ),
      filaPropuesta(
        'Renderizar con navegador',
        sugerencia.useJavaScript ? 'sí' : 'no',
        motivos.navegador
      ),
      filaPropuesta('Extensiones', sugerencia.fileExtensions, motivos.extensiones),
    ];

    if (alternativas?.linkPattern) {
      filas.push(
        filaPropuesta(
          'Patrón alternativo',
          alternativas.linkPattern,
          'Más amplio que el propuesto. Úsalo si el sugerido deja fuera resultados que sí querías.'
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
              el('h3', { className: 'card__title', text: 'Propuesta de configuración' }),
              el('p', {
                className: 'card__hint',
                text: `Es una sugerencia, no una verdad: revísala y corrige lo que no encaje. Se han analizado ${analizado.enlacesConNavegador} enlaces con navegador y ${analizado.enlacesSinNavegador} sin él.`,
              }),
            ],
          }),
          el('div', {
            className: 'card__body',
            children: [
              el('ul', { className: 'propuesta__lista', children: filas }),
              ...avisos.map(texto =>
                alertBox({ variant: 'warning', title: 'A tener en cuenta', body: texto })
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
      showError('Falta la URL', 'Escribe la URL de la página de resultados que quieres analizar.');
      fields.searchUrl.focus();
      return;
    }

    detectButton.disabled = true;
    detectButton.textContent = 'Analizando…';
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

      mostrarPropuesta(resultado);
      toast('Propuesta lista: revísala antes de explorar');
    } catch (error) {
      showError('No se pudo analizar la página', error.message);
    } finally {
      detectButton.disabled = false;
      detectButton.textContent = 'Detectar configuración';
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
        renderStats(event);

        // El scroll paró por un tope duro: hay más contenido que no se ha
        // llegado a ver. Decirlo es obligatorio, porque los resultados
        // parecen completos y no lo son.
        const MOTIVOS_DE_TOPE = {
          'tope-de-rondas': 'se alcanzó el número máximo de cargas',
          'tope-de-elementos': 'se alcanzó el tope de elementos',
          'tiempo-agotado': 'se agotó el tiempo máximo de scroll',
          'error-de-navegador': 'el navegador dejó de responder',
        };
        const motivoTope = MOTIVOS_DE_TOPE[collected.scroll?.motivo];

        if (motivoTope) {
          setChildren(
            alertSlot,
            alertBox({
              variant: 'warning',
              title: 'El scroll se detuvo antes de agotar el listado',
              body: `Tras ${collected.scroll.rounds} cargas, ${motivoTope}. Es muy probable que el sitio tuviera más resultados: los que ves están incompletos. Sube "Hasta" para pedir más cargas, o afina el patrón para traer menos por carga.`,
            })
          );
          show(alertSlot, true);
        }

        if (event.truncated) {
          setChildren(
            alertSlot,
            alertBox({
              variant: 'warning',
              title: 'Resultados truncados',
              body: `Se alcanzó el tope de la aplicación (${event.limits?.maxLinks ?? '?'} enlaces / ${
                event.limits?.maxFiles ?? '?'
              } ficheros). Acota el patrón o el rango de páginas para obtener menos resultados.`,
            })
          );
          show(alertSlot, true);
        }

        if (event.licenseFilter === 'open-only' && event.skippedByLicense > 0) {
          setChildren(
            alertSlot,
            alertBox({
              variant: 'warning',
              title: `${event.skippedByLicense} páginas descartadas por licencia`,
              body: 'No declaraban una licencia abierta, así que se han omitido. Recuerda que la ausencia de licencia significa "todos los derechos reservados", no "libre".',
            })
          );
          show(alertSlot, true);
        } else if (event.timedOut) {
          setChildren(
            alertSlot,
            alertBox({
              variant: 'warning',
              title: 'Se agotó el tiempo máximo',
              body: `El recorrido superó los ${Math.round((event.maxDurationMs ?? 0) / 60000)} minutos y se detuvo, así que los resultados están incompletos. Con "Renderizar con navegador" cada enlace tarda varios segundos: reduce el rango de páginas o afina el patrón para revisar menos enlaces.`,
            })
          );
          show(alertSlot, true);
        } else if (deepSearch && event.files.length === 0 && event.links.length > 0) {
          const usedBrowser = readForm().useJavaScript;
          setChildren(
            alertSlot,
            alertBox({
              variant: 'warning',
              title: 'Se encontraron enlaces pero ningún fichero',
              body: usedBrowser
                ? `Se revisaron ${event.links.length} páginas con navegador sin encontrar ficheros con esas extensiones. Puede que los enlaces no sean páginas de detalle (por ejemplo, redirecciones a otros sitios) o que el fichero se pida por una API que no deja rastro en el HTML.`
                : `Se revisaron ${event.links.length} páginas sin encontrar ficheros con esas extensiones. Prueba a activar "Renderizar con navegador": ahora también se aplica al entrar en cada enlace.`,
            })
          );
          show(alertSlot, true);
        }

        stopStream();
        break;
      }

      case 'error':
        showError('La búsqueda falló', event.message);
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
      showError('Falta la URL', 'Introduce la URL desde la que quieres empezar.');
      fields.searchUrl.focus();
      return;
    }

    if (!/^https?:\/\//i.test(params.searchUrl)) {
      showError('URL no válida', 'La URL debe empezar por http:// o https://');
      fields.searchUrl.focus();
      return;
    }

    if (/\{(?:q|query|termino|término)\}/i.test(params.searchUrl) && !params.searchTerm) {
      showError(
        'Falta el término a buscar',
        'La URL de partida usa {q}, así que hay que indicar qué buscar en "Término a buscar".'
      );
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
    const modoScroll = params.paginationMode === 'scroll';

    const paginaPorPlantilla = /\{page(?::\d+)?\}/i.test(params.searchUrl);
    if (
      !modoScroll &&
      !params.pageParam &&
      !paginaPorPlantilla &&
      params.endPage > params.startPage
    ) {
      showError(
        'Falta el parámetro de página',
        `Has pedido de la ${params.startPage} a la ${params.endPage}, pero sin "Parámetro de página" solo se descarga una. Ábrelo en "Paginación y opciones avanzadas" e indica el nombre del parámetro que usa el sitio (por ejemplo "page").`
      );
      return;
    }

    if (params.pageParam && params.endPage < params.startPage) {
      showError('Rango de páginas inválido', 'La página final no puede ser menor que la inicial.');
      return;
    }

    // Antes esta comprobación solo corría si había pageParam, así que un rango
    // inválido llegaba al servidor y volvía como un 400 que el EventSource no
    // sabe leer.
    if (!modoScroll && params.endPage - params.startPage + 1 > limits.maxPages) {
      showError(
        'Rango de páginas demasiado grande',
        `Has pedido ${params.endPage - params.startPage + 1} páginas y el máximo por búsqueda es ${limits.maxPages}. Reduce el valor de "Hasta" a ${params.startPage + limits.maxPages - 1} o menos.`
      );
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
    fields.startPage.value = '1';
    fields.endPage.value = '5';
    fields.concurrency.value = String(limits.defaultConcurrency);
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

  return {
    focus() {
      fields.searchUrl.focus();
    },
    teardown() {
      stopStream();
    },
  };
}
