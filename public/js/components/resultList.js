import {
  el,
  safeLink,
  setChildren,
  emptyState,
  copyToClipboard,
  copyIconButton,
  downloadText,
  toast,
} from '../dom.js';
import { createRangeFilter, formatDuration, formatBytes } from './rangeSlider.js';
import { t, tp, texto, atributo, alCambiarIdioma } from '../i18n/index.js';
import { aCSV, aJSON, aListaDeDescarga, construirFilas } from '../exportFormats.js';

/**
 * Lista de resultados con filtros y exportación.
 *
 * Todas las URLs se pintan con safeLink(): texto por textContent y esquema
 * filtrado, porque provienen de HTML de terceros.
 *
 * ── Organización ──────────────────────────────────────────────────────
 *
 * Todo lo que hay dentro de esta tarjeta actúa sobre los resultados YA
 * cargados y filtra en el cliente: nada de aquí vuelve a pedir nada al
 * servidor. Por eso los filtros viven dentro de la tarjeta de resultados y
 * no junto al formulario de exploración, que es lo que decide qué se
 * descarga. Mezclar las dos cosas hacía imposible saber qué actuaba sobre
 * qué.
 */

/** Segundos de un resultado, o null si no se conocen. */
function segundosDe(info) {
  if (Number.isFinite(info?.durationSeconds)) return info.durationSeconds;
  // Respaldo para los detalles antiguos, que solo traían el texto "12:34"
  if (!info?.duration) return null;
  const partes = info.duration.split(':').map(Number);
  if (partes.some(n => !Number.isFinite(n))) return null;
  return partes.reduce((total, n) => total * 60 + n, 0);
}

/** Bytes de un resultado, o null. */
function bytesDe(info) {
  return Number.isFinite(info?.sizeBytes) ? info.sizeBytes : null;
}

export function createResultList({ emptyTitleKey, emptyTextKey, filename = 'urlexplorer.txt' }) {
  let items = [];
  let filtered = [];
  // url -> { duration, durationSeconds, size, sizeBytes, sizeApproximate }
  let meta = new Map();
  /**
   * Orden actual: qué columna y en qué sentido.
   *
   * Sustituye al desplegable "ordenar por", que solo sabía ordenar
   * descendente y estaba lejos de los datos que ordenaba. Ahora se pulsa la
   * cabecera de la columna, como en cualquier tabla.
   */
  let orden = { campo: 'orden', direccion: 'asc' };

  /**
   * Resultados quitados a mano, y en qué tandas.
   *
   * `ocultos` es el conjunto de lo que no se ve. `tandas` guarda cada
   * borrado por separado para poder deshacer SOLO el último, que es lo que
   * se espera de un "deshacer": no vaciar todo el historial de golpe.
   *
   * No se borra nada de `items`: quitar es una vista, igual que plegar
   * duplicados. Por eso se puede restaurar entero.
   */
  let ocultos = new Set();
  const tandas = [];

  /**
   * Grupos desplegados, y lo que el usuario ha sacado de ellos a mano.
   *
   * `expandidos` es solo vista: qué grupos muestran sus miembros debajo.
   *
   * `desagrupados` es una CORRECCIÓN del usuario y pesa más que el algoritmo:
   * si dice que algo no es duplicado, deja de plegarse aunque las señales
   * digan lo contrario, y sigue así aunque se recalculen los grupos al
   * cambiar de modo. La máquina agrupa por indicios; la persona sabe.
   */
  const expandidos = new Set();
  const desagrupados = new Set();

  /** Miembros de un grupo que siguen plegados bajo su representante. */
  function miembrosPlegados(representante) {
    const grupo = grupos.get(representante);
    if (!grupo) return [];
    return grupo.miembros.filter(m => m !== representante && !desagrupados.has(m));
  }

  /**
   * Agrupación de duplicados: `duplicadoDe` mapea cada URL plegada a su
   * representante. NADA se borra de `items`; plegar es solo una vista.
   */
  let duplicadoDe = new Map();
  let grupos = new Map();
  let plegarDuplicados = true;

  /**
   * Las DOS agrupaciones que manda el servidor, y cuál se está usando.
   *
   * `seguro` exige dos señales coincidentes (nombre + duración/tamaño).
   * `duracion` es el modo agresivo: la duración sola basta. Se guardan las
   * dos para poder cambiar de modo sin volver a explorar.
   */
  let gruposPorModo = { seguro: [], duracion: [] };
  let modoDuplicados = 'seguro';

  /* ── Cabecera: conteo y acciones ─────────────────────────────────── */

  const contador = el('span', { className: 'results__count' });

  const copyButton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const ok = await copyToClipboard(filtered.join('\n'));
        toast(
          ok ? t('resultados.copiados', { n: filtered.length }) : t('resultados.noCopiado'),
          ok ? 'success' : 'error'
        );
      },
    },
  });
  texto(copyButton, 'resultados.copiar');

  const downloadButton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: {
      click: () => {
        downloadText(filename, filtered.join('\n'));
        toast(t('resultados.descargados', { n: filtered.length }));
      },
    },
  });
  texto(downloadButton, 'resultados.descargar');

  /**
   * Deshacer y restaurar.
   *
   * Quitar un resultado NO pide confirmación —es reversible, así que
   * preguntar solo estorba— pero por eso mismo hacen falta las dos salidas:
   * deshacer la última tanda, y devolverlo todo.
   */
  const undoButton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: {
      click: () => {
        const ultima = tandas.pop();
        if (!ultima) return;
        for (const url of ultima) ocultos.delete(url);
        applyFilter();
      },
    },
  });
  texto(undoButton, 'resultados.deshacer');
  atributo(undoButton, 'title', 'resultados.deshacer.title');

  const restoreButton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: {
      click: () => {
        ocultos = new Set();
        tandas.length = 0;
        applyFilter();
      },
    },
  });
  atributo(restoreButton, 'title', 'resultados.restaurar.title');

  /** Quita un resultado. Sin confirmación: es reversible. */
  function ocultar(url) {
    if (ocultos.has(url)) return;
    ocultos.add(url);
    tandas.push([url]);
    applyFilter();
  }

  /**
   * Exportar en los otros tres formatos.
   *
   * Todo el dato ya está aquí: no hace falta ninguna ruta nueva. Se exporta
   * lo VISIBLE (`filtered`), no todo, porque es lo que el usuario tiene
   * delante y ha filtrado a propósito.
   */
  function filasExportables() {
    return construirFilas(filtered, {
      info: url => meta.get(url),
      grupoDe: url => (plegarDuplicados ? grupos.get(url) : null),
    });
  }

  const crearBotonExportar = (claveTexto, extension, formato, construir, tipo) => {
    const boton = el('button', {
      className: 'button button--secondary button--small',
      attrs: { type: 'button' },
      on: {
        click: () => {
          const filas = filasExportables();
          downloadText(filename.replace(/\.txt$/, extension), construir(filas), tipo);
          toast(t('resultados.exportados', { n: filas.length, formato }));
        },
      },
    });
    texto(boton, claveTexto);
    return boton;
  };

  const csvButton = crearBotonExportar('resultados.csv', '.csv', 'CSV', aCSV, 'text/csv');
  const jsonButton = crearBotonExportar(
    'resultados.json',
    '.json',
    'JSON',
    filas => aJSON(filas, { filtrado: filtered.length !== items.length }),
    'application/json'
  );
  const listaButton = crearBotonExportar(
    'resultados.lista',
    '-lista.txt',
    'lista',
    aListaDeDescarga
  );
  atributo(listaButton, 'title', 'resultados.lista.title');

  /* ── Filtros de texto ────────────────────────────────────────────── */

  const search = el('input', {
    className: 'input',
    attrs: { type: 'search' },
    on: { input: () => applyFilter() },
  });
  atributo(search, 'placeholder', 'filtros.buscar');
  atributo(search, 'aria-label', 'filtros.buscar.aria');

  // En listas grandes suele ser más rápido decir qué NO quieres (240p,
  // sample, preview…) que acertar con un término que incluya justo lo bueno.
  const exclude = el('input', {
    className: 'input',
    attrs: { type: 'search' },
    on: { input: () => applyFilter() },
  });
  atributo(exclude, 'placeholder', 'filtros.excluir');
  atributo(exclude, 'aria-label', 'filtros.excluir.aria');
  atributo(exclude, 'title', 'filtros.excluir.title');

  /* ── Filtros de rango ────────────────────────────────────────────── */

  const filtroDuracion = createRangeFilter({
    labelKey: 'columnas.duracion',
    format: formatDuration,
    onChange: () => applyFilter(),
  });

  const filtroPeso = createRangeFilter({
    labelKey: 'columnas.peso',
    format: formatBytes,
    onChange: () => applyFilter(),
  });

  /* ── Interruptores ───────────────────────────────────────────────── */

  function crearToggle(id, etiquetaKey, tituloKey, alCambiar) {
    const input = el('input', {
      attrs: { type: 'checkbox', id },
      on: { change: () => alCambiar(input.checked) },
    });
    // OJO: la etiqueta se llama `etiqueta` y no `texto` porque `texto` es el
    // helper de i18n importado arriba, y una local con ese nombre lo taparia.
    const etiqueta = el('span', { className: 'toggle__text' });
    if (etiquetaKey) texto(etiqueta, etiquetaKey);

    const root = el('label', {
      className: 'toggle',
      attrs: { for: id },
      children: [input, etiqueta],
    });
    atributo(root, 'title', tituloKey);

    return { root, input, texto: etiqueta };
  }

  let ocultarSinDuracion = false;
  let ocultarSinPeso = false;

  const toggleSinDuracion = crearToggle(
    'hide-no-duration',
    'filtros.ocultarSinDuracion',
    'filtros.ocultarSinDuracion.title',
    v => {
      ocultarSinDuracion = v;
      applyFilter();
    }
  );

  const toggleSinPeso = crearToggle(
    'hide-no-size',
    'filtros.ocultarSinPeso',
    'filtros.ocultarSinPeso.title',
    v => {
      ocultarSinPeso = v;
      applyFilter();
    }
  );

  /**
   * Interruptor del modo agresivo de duplicados.
   *
   * Va con los demás flags y no en un desplegable aparte: es una decisión de
   * sí o no, y escondida en un menú no se encontraba.
   *
   * NO está activo por defecto y el motivo está medido: con mil resultados,
   * agrupar solo por duración esconde uno de cada cuatro vídeos buenos detrás
   * de otro que no tiene nada que ver. Ver lib/dedupe.js.
   *
   * Sigue siendo AGRUPACIÓN reversible: nada se borra, el representante lleva
   * su insignia "+N" y desmarcar esto los devuelve a todos.
   */
  const dupDuracionToggle = crearToggle(
    'dup-solo-duracion',
    'filtros.modoDup.duracion',
    'filtros.modoDup.aviso',
    valor => {
      modoDuplicados = valor ? 'duracion' : 'seguro';
      aplicarGruposDelModo();
      applyFilter();
    }
  );

  // Aviso del modo agresivo: solo se ve cuando está activo
  const avisoModoDup = el('p', { className: 'filters__note filters__note--warn' });
  avisoModoDup.hidden = true;

  const dupeToggle = crearToggle('dupe-toggle', null, 'filtros.agrupar.title', v => {
    plegarDuplicados = v;
    applyFilter();
  });
  dupeToggle.input.checked = true;
  dupeToggle.root.hidden = true;

  /**
   * Nota que explica la regla menos evidente de todo el panel.
   *
   * Un resultado del que no se conoce la duración NO desaparece al mover el
   * slider de duración: filtrar por un dato que no se tiene solo puede
   * equivocarse. Los rangos ordenan entre los que SÍ tienen el dato, y los
   * interruptores deciden qué pasa con el resto. Sin decirlo, el usuario
   * mueve una manija, ve que el número no baja, y cree que está roto.
   */
  const nota = texto(el('p', { className: 'filters__note' }), 'filtros.nota');

  const avisoSinPeso = el('p', { className: 'filters__note filters__note--warn' });
  avisoSinPeso.hidden = true;

  /* ── Montaje ─────────────────────────────────────────────────────── */

  const filtros = el('div', {
    className: 'filters',
    children: [
      el('div', {
        className: 'filters__row filters__row--text',
        children: [search, exclude],
      }),
      el('div', {
        className: 'filters__row filters__row--ranges',
        children: [filtroDuracion.root, filtroPeso.root],
      }),
      el('div', {
        className: 'filters__row filters__row--flags',
        children: [
          toggleSinDuracion.root,
          toggleSinPeso.root,
          dupeToggle.root,
          dupDuracionToggle.root,
        ],
      }),
      nota,
      avisoModoDup,
      avisoSinPeso,
    ],
  });

  const cabecera = el('div', {
    className: 'results__head',
    children: [
      texto(el('h3', { className: 'card__title' }), 'resultados.titulo'),
      contador,
      el('div', {
        className: 'results__actions',
        children: [
          copyButton,
          downloadButton,
          csvButton,
          jsonButton,
          listaButton,
          undoButton,
          restoreButton,
        ],
      }),
    ],
  });

  // Fila de títulos de columna: es lo que hace que la lista se lea como una
  // tabla sin serlo. Comparte el mismo grid que cada fila.
  /**
   * Cabecera con columnas ordenables.
   *
   * Cada título es un botón: pulsarlo ordena por esa columna y volver a
   * pulsarlo invierte el sentido. `aria-sort` es lo que hace que un lector de
   * pantalla anuncie por dónde está ordenada la tabla; sin él la flecha es
   * decoración que solo existe para quien ve.
   */
  const COLUMNAS = [
    { campo: 'orden', claveTexto: null, texto: '#', clase: 'result-head__index' },
    { campo: 'url', claveTexto: 'columnas.enlace', clase: '' },
    { campo: 'duracion', claveTexto: 'columnas.duracion', clase: 'result-head__col' },
    { campo: 'peso', claveTexto: 'columnas.peso', clase: 'result-head__col' },
  ];

  const celdasCabecera = COLUMNAS.map(columna => {
    const etiqueta = el('span', { className: 'result-head__etiqueta' });
    if (columna.claveTexto) texto(etiqueta, columna.claveTexto);
    else etiqueta.textContent = columna.texto;

    const flecha = el('span', {
      className: 'result-head__flecha',
      attrs: { 'aria-hidden': 'true' },
    });

    const boton = el('button', {
      className: 'result-head__sort',
      attrs: { type: 'button' },
      children: [etiqueta, flecha],
      on: {
        click: () => {
          // Misma columna: se invierte. Columna nueva: se empieza por el
          // sentido más útil de cada dato (ver `direccionInicial`).
          orden =
            orden.campo === columna.campo
              ? { campo: columna.campo, direccion: orden.direccion === 'asc' ? 'desc' : 'asc' }
              : { campo: columna.campo, direccion: direccionInicial(columna.campo) };
          applyFilter();
        },
      },
    });

    const celda = el('div', {
      className: `result-head__celda ${columna.clase}`.trim(),
      children: [boton],
    });

    return { ...columna, celda, boton, flecha };
  });

  /**
   * Sentido con el que se empieza al pulsar una columna nueva.
   *
   * Lo que se quiere ver primero no es lo mismo en cada columna: de duración
   * y peso interesa lo más grande, del orden de aparición y del enlace lo
   * primero alfabéticamente.
   */
  function direccionInicial(campo) {
    return campo === 'duracion' || campo === 'peso' ? 'desc' : 'asc';
  }

  function pintarCabecera() {
    for (const columna of celdasCabecera) {
      const activa = orden.campo === columna.campo;
      columna.celda.setAttribute(
        'aria-sort',
        activa ? (orden.direccion === 'asc' ? 'ascending' : 'descending') : 'none'
      );
      columna.boton.classList.toggle('result-head__sort--activa', activa);
      columna.flecha.textContent = activa ? (orden.direccion === 'asc' ? '▲' : '▼') : '';
    }
  }

  const columnas = el('div', {
    className: 'result-head',
    attrs: { role: 'row' },
    children: celdasCabecera.map(c => c.celda),
  });

  const list = el('ul', { className: 'result-list' });

  const root = el('div', {
    className: 'card results',
    children: [cabecera, filtros, columnas, list],
  });

  /* ── Render ──────────────────────────────────────────────────────── */

  /**
   * Celda de una columna de dato.
   *
   * El guion explícito importa: un hueco en blanco se lee como "cero" o como
   * un fallo de la interfaz, y aquí significa "no se pudo obtener el dato".
   * `data-label` lo usa el CSS en móvil, donde las columnas se apilan y
   * necesitan decir de qué son.
   */
  function celda(valor, etiquetaKey, extra = {}) {
    const etiqueta = t(etiquetaKey);
    if (valor === null) {
      return el('span', {
        className: 'result-item__col result-item__col--empty',
        text: '—',
        attrs: {
          title: t('resultados.noObtenido', { dato: etiqueta.toLowerCase() }),
          'data-label': etiqueta,
        },
      });
    }
    return el('span', {
      className: 'result-item__col',
      text: valor,
      attrs: { 'data-label': etiqueta, ...extra },
    });
  }

  function render() {
    const hayResultados = filtered.length > 0;
    copyButton.disabled = !hayResultados;
    downloadButton.disabled = !hayResultados;
    for (const boton of [csvButton, jsonButton, listaButton]) boton.disabled = !hayResultados;
    columnas.hidden = !hayResultados;

    // Con miniaturas cada fila lleva una columna más al principio: la
    // cabecera tiene que declarar la misma rejilla o los títulos quedan
    // corridos respecto a los datos.
    const conMiniaturas = filtered.some(url => meta.get(url)?.thumbnail);
    columnas.classList.toggle('result-head--con-miniatura', conMiniaturas);

    if (!hayResultados) {
      const estabaFiltrado = items.length > 0;
      setChildren(
        list,
        el('li', {
          className: 'result-item result-item--empty',
          children: [
            emptyState({
              icon: estabaFiltrado ? '🔍' : '○',
              title: t(estabaFiltrado ? 'resultados.sinCoincidencias' : emptyTitleKey),
              text: t(estabaFiltrado ? 'resultados.sinCoincidencias.texto' : emptyTextKey),
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

      // Aviso de fichero no verificado. Va junto al enlace y no como una
      // columna más porque es una advertencia sobre el resultado entero, no
      // un dato suyo: puede ser un anuncio o una vista previa.
      const marcaDudoso = info?.suspect
        ? el('span', {
            className: 'badge badge--danger result-item__suspect',
            text: t('resultados.dudoso'),
            attrs: {
              // El motivo lo redacta el servidor y se inserta tal cual
              title: info.suspectReason
                ? t('resultados.dudoso.titleMotivo', { motivo: info.suspectReason })
                : t('resultados.dudoso.title'),
            },
          })
        : null;

      /**
       * Insignia "+N": ahora es un BOTÓN que despliega el grupo.
       *
       * Antes solo decía cuántos había escondidos y los listaba en un `title`
       * que nadie lee. Pudiendo verlos con su miniatura, su duración y su
       * peso, la decisión de si son o no el mismo vídeo se puede tomar
       * mirando, que es lo único que la hace fiable.
       */
      const plegadosAqui = plegarDuplicados ? miembrosPlegados(url) : [];
      const estaExpandido = expandidos.has(url);

      const marcaGrupo =
        plegadosAqui.length > 0
          ? el('button', {
              className: 'badge badge--warning result-item__dupe',
              text: `+${plegadosAqui.length}${estaExpandido ? ' ▾' : ' ▸'}`,
              attrs: {
                type: 'button',
                'aria-expanded': String(estaExpandido),
                title: t(estaExpandido ? 'resultados.grupo.plegar' : 'resultados.grupo.desplegar', {
                  n: plegadosAqui.length,
                }),
              },
              on: {
                click: clickEvent => {
                  clickEvent.preventDefault();
                  clickEvent.stopPropagation();
                  alternarGrupo(url);
                },
              },
            })
          : null;

      // El tamaño sacado del HTML de la ficha se marca con "~": viene
      // redondeado de origen y describe el vídeo, no necesariamente este
      // fichero. Confundirlo con el exacto del HEAD llevaría a descartar un
      // clip de vista previa creyendo que es el vídeo completo.
      const aproximado = info?.sizeApproximate === true;
      const celdaPeso = info?.size
        ? celda(aproximado ? `~${info.size}` : info.size, 'columnas.peso', {
            title: t(aproximado ? 'resultados.pesoAprox' : 'resultados.pesoExacto'),
          })
        : celda(null, 'columnas.peso');

      /**
       * Miniatura, si la ficha traía una y el usuario las pidió.
       *
       * El `src` apunta a NUESTRO servidor, nunca al CDN del sitio: es lo que
       * mantiene la IP del usuario fuera de los sitios explorados y permite
       * que la CSP siga siendo `img-src 'self' data:`. Ver
       * src/services/thumbnails.js.
       *
       * `loading=lazy` porque una lista puede traer cientos: sin esto se
       * pedirían todas de golpe al pintar.
       */
      const miniatura = info?.thumbnail
        ? el('img', {
            className: 'result-item__thumb',
            attrs: {
              src: `/api/thumbnail?url=${encodeURIComponent(info.thumbnail)}`,
              alt: '',
              loading: 'lazy',
              decoding: 'async',
              width: '64',
              height: '36',
            },
          })
        : null;

      const clases = ['result-item'];
      if (miniatura) clases.push('result-item--con-miniatura');
      if (plegadosAqui.length > 0) clases.push('result-item--grupo');
      if (estaExpandido) clases.push('result-item--expandido');

      const fila = el('li', {
        className: clases.join(' '),
        on:
          plegadosAqui.length > 0
            ? {
                // Toda la fila despliega, salvo cuando se pulsa algo que ya
                // hace lo suyo: el enlace, copiar, quitar.
                click: clickEvent => {
                  if (clickEvent.target.closest('a, button')) return;
                  alternarGrupo(url);
                },
              }
            : undefined,
        children: [
          miniatura,
          el('span', { className: 'result-item__index', text: String(index + 1) }),
          el('span', {
            className: 'result-item__main',
            children: [
              safeLink(url, { className: 'result-item__link' }),
              marcaDudoso,
              marcaGrupo,
              // Copiar una sola línea. Los botones globales copian la lista
              // filtrada entera, que no sirve cuando solo quieres esta URL.
              copyIconButton(url),
              // Quitar: sin confirmación, porque es reversible. Deshacer y
              // "restaurar ocultos" son las dos salidas.
              el('button', {
                className: 'button button--secondary button--icon result-item__quitar',
                text: '✕',
                attrs: { type: 'button', 'aria-label': t('resultados.ocultar') },
                on: {
                  click: clickEvent => {
                    clickEvent.preventDefault();
                    clickEvent.stopPropagation();
                    ocultar(url);
                  },
                },
              }),
            ],
          }),
          celda(info?.duration || null, 'columnas.duracion'),
          celdaPeso,
        ],
      });

      // Sin desplegar, la fila va sola. Desplegada, arrastra a los suyos.
      if (!estaExpandido || plegadosAqui.length === 0) return fila;
      return [fila, panelDeMiembros(url, plegadosAqui)];
    });

    if (filtered.length > visible.length) {
      nodes.push(
        el('li', {
          className: 'result-item result-item--note',
          children: [
            el('span', {
              className: 'field__hint',
              text: t('resultados.primeros', { n: visible.length, total: filtered.length }),
            }),
          ],
        })
      );
    }

    setChildren(list, nodes.flat());
  }

  /** Vuelca al estado los grupos del modo elegido. */
  function aplicarGruposDelModo() {
    duplicadoDe = new Map();
    grupos = new Map();

    for (const grupo of gruposPorModo[modoDuplicados] || []) {
      if (!grupo?.representante || !Array.isArray(grupo.miembros)) continue;
      grupos.set(grupo.representante, grupo);
      for (const miembro of grupo.miembros) {
        if (miembro !== grupo.representante) duplicadoDe.set(miembro, grupo.representante);
      }
    }

    // El aviso solo se ve con el modo agresivo puesto: es donde hace falta.
    const agresivo = modoDuplicados === 'duracion';
    avisoModoDup.hidden = !agresivo;
    if (agresivo) avisoModoDup.textContent = t('filtros.modoDup.aviso');
  }

  /** Despliega o pliega los miembros de un grupo. */
  function alternarGrupo(representante) {
    if (expandidos.has(representante)) expandidos.delete(representante);
    else expandidos.add(representante);
    render();
  }

  /**
   * Saca un resultado de su grupo y lo devuelve a la lista principal.
   *
   * Es una corrección del usuario y pesa más que el algoritmo: las señales
   * dijeron que era el mismo vídeo y la persona, mirándolo, dice que no. A
   * partir de aquí deja de plegarse, y sigue así aunque se recalculen los
   * grupos al cambiar de modo.
   */
  function sacarDelGrupo(url) {
    desagrupados.add(url);
    toast(t('resultados.grupo.sacado'));
    applyFilter();
  }

  /**
   * Panel con los miembros plegados de un grupo.
   *
   * Cada uno con su miniatura, su duración y su peso: son exactamente los
   * tres datos con los que se decide si dos resultados son el mismo vídeo, y
   * hasta ahora estaban escondidos en un `title`.
   */
  function panelDeMiembros(representante, miembros) {
    const grupo = grupos.get(representante);
    const motivo = grupo?.motivos?.[0]?.texto || t('resultados.duplicados.motivoPorDefecto');

    const filas = miembros.map(miembroUrl => {
      const info = meta.get(miembroUrl);

      const mini = info?.thumbnail
        ? el('img', {
            className: 'miembro__thumb',
            attrs: {
              src: `/api/thumbnail?url=${encodeURIComponent(info.thumbnail)}`,
              alt: '',
              loading: 'lazy',
              decoding: 'async',
              width: '64',
              height: '36',
            },
          })
        : el('span', { className: 'miembro__thumb miembro__thumb--vacia' });

      const aprox = info?.sizeApproximate === true;

      return el('div', {
        className: 'miembro',
        children: [
          mini,
          el('div', {
            className: 'miembro__datos',
            children: [
              safeLink(miembroUrl, { className: 'miembro__url' }),
              el('div', {
                className: 'miembro__meta',
                children: [
                  el('span', {
                    className: 'miembro__dato',
                    text: info?.duration || '—',
                    attrs: { 'data-label': t('columnas.duracion') },
                  }),
                  el('span', {
                    className: 'miembro__dato',
                    text: info?.size ? (aprox ? `~${info.size}` : info.size) : '—',
                    attrs: { 'data-label': t('columnas.peso') },
                  }),
                ],
              }),
            ],
          }),
          el('div', {
            className: 'miembro__acciones',
            children: [
              copyIconButton(miembroUrl),
              el('button', {
                className: 'button button--secondary button--small miembro__sacar',
                text: t('resultados.grupo.noEsDuplicado'),
                attrs: { type: 'button', title: t('resultados.grupo.noEsDuplicado.title') },
                on: {
                  click: clickEvent => {
                    clickEvent.preventDefault();
                    clickEvent.stopPropagation();
                    sacarDelGrupo(miembroUrl);
                  },
                },
              }),
            ],
          }),
        ],
      });
    });

    return el('li', {
      className: 'result-item result-item--miembros',
      children: [
        el('div', {
          className: 'miembros',
          children: [
            el('p', {
              className: 'miembros__motivo',
              text: t('resultados.grupo.agrupadoPor', { motivo }),
            }),
            ...filas,
          ],
        }),
      ],
    });
  }

  /* ── Filtrado ────────────────────────────────────────────────────── */

  function applyFilter() {
    const needle = search.value.trim().toLowerCase();
    const blocked = exclude.value
      .split(',')
      .map(term => term.trim().toLowerCase())
      .filter(Boolean);

    const rangoDuracion = filtroDuracion.getRange();
    const rangoPeso = filtroPeso.getRange();

    filtered = items.filter(url => {
      // Los duplicados se pliegan bajo su representante, no se descartan:
      // siguen en `items` y el interruptor los devuelve a la lista.
      // Quitados a mano: siguen en `items`, solo no se muestran
      if (ocultos.has(url)) return false;

      // Lo que el usuario marcó como "no es duplicado" vuelve a la lista
      if (plegarDuplicados && duplicadoDe.has(url) && !desagrupados.has(url)) return false;

      const lower = url.toLowerCase();
      if (needle !== '' && !lower.includes(needle)) return false;
      if (blocked.some(term => lower.includes(term))) return false;

      const info = meta.get(url);

      // REGLA CENTRAL: un dato que no se conoce no lo recorta el rango.
      // Filtrar por lo que no se sabe solo puede quitar cosas buenas, así que
      // esa decisión es del interruptor, no del slider.
      const segundos = segundosDe(info);
      if (segundos === null) {
        if (ocultarSinDuracion) return false;
      } else if (rangoDuracion && (segundos < rangoDuracion.min || segundos > rangoDuracion.max)) {
        return false;
      }

      const bytes = bytesDe(info);
      if (bytes === null) {
        if (ocultarSinPeso) return false;
      } else if (rangoPeso && (bytes < rangoPeso.min || bytes > rangoPeso.max)) {
        return false;
      }

      return true;
    });

    /**
     * Orden por la columna elegida.
     *
     * Los resultados SIN dato van siempre al final, ordene como ordene: es la
     * misma regla que rige los filtros de rango. Colarlos arriba al ordenar
     * ascendente llenaría la primera pantalla de guiones justo cuando el
     * usuario está buscando el valor más pequeño.
     */
    if (orden.campo !== 'orden') {
      const signo = orden.direccion === 'asc' ? 1 : -1;

      const valorDe = url => {
        const info = meta.get(url);
        if (orden.campo === 'duracion') return segundosDe(info);
        if (orden.campo === 'peso') return bytesDe(info);
        return url.toLowerCase();
      };

      filtered = [...filtered].sort((a, b) => {
        const va = valorDe(a);
        const vb = valorDe(b);

        // Sin dato, siempre al final
        const faltaA = va === null || va === undefined;
        const faltaB = vb === null || vb === undefined;
        if (faltaA && faltaB) return 0;
        if (faltaA) return 1;
        if (faltaB) return -1;

        if (typeof va === 'string') return signo * va.localeCompare(vb);
        return signo * (va - vb);
      });
    }

    pintarCabecera();
    actualizarContador();
    render();
  }

  /** "Mostrando X de Y", para que se entienda qué está recortando. */
  function actualizarContador() {
    const total = items.length;
    const plegados = plegarDuplicados
      ? items.filter(url => duplicadoDe.has(url) && !desagrupados.has(url)).length
      : 0;

    if (total === 0) {
      contador.textContent = t('resultados.cero');
    } else if (filtered.length === total) {
      contador.textContent = tp('resultados.total', total);
    } else {
      contador.textContent = t('resultados.mostrando', { visibles: filtered.length, total });
    }

    contador.classList.toggle('results__count--filtrado', filtered.length !== total);

    // Deshacer solo tiene sentido si hay algo que deshacer
    undoButton.disabled = tandas.length === 0;
    restoreButton.disabled = ocultos.size === 0;
    restoreButton.hidden = ocultos.size === 0;
    undoButton.hidden = tandas.length === 0;
    if (ocultos.size > 0) {
      restoreButton.textContent = t('resultados.restaurar', { n: ocultos.size });
    }

    const aunPlegados = [...duplicadoDe.keys()].filter(u => !desagrupados.has(u)).length;
    dupeToggle.root.hidden = aunPlegados === 0;
    dupeToggle.texto.textContent = tp('filtros.agrupar', aunPlegados);

    const conPeso = items.filter(url => bytesDe(meta.get(url)) !== null).length;
    const sinNingunPeso = total > 0 && conPeso === 0;
    avisoSinPeso.hidden = !sinNingunPeso;
    if (sinNingunPeso) avisoSinPeso.textContent = t('filtros.sinPeso');

    // Los plegados tienen su propio interruptor y su propio recuento
    if (plegados > 0) contador.title = t('resultados.plegados', { n: plegados });
    else contador.removeAttribute('title');
  }

  /** Recalcula los extremos de los rangos con los datos que hay ahora. */
  function recalcularRangos() {
    filtroDuracion.setValues(items.map(url => segundosDe(meta.get(url))).filter(v => v !== null));
    filtroPeso.setValues(items.map(url => bytesDe(meta.get(url))).filter(v => v !== null));
  }

  render();
  actualizarContador();

  // Las filas y el contador se construyen con datos, no con texto fijo, asi
  // que hay que rehacerlos enteros al cambiar de idioma. Sin esto, la lista
  // se quedaria con las columnas y los avisos en el idioma anterior hasta la
  // siguiente busqueda.
  alCambiarIdioma(() => {
    aplicarGruposDelModo();
    actualizarContador();
    pintarCabecera();
    render();
  });

  return {
    root,

    setItems(newItems) {
      items = [...new Set(newItems)];
      recalcularRangos();
      applyFilter();
    },

    /** Añade duración y peso de los ficheros ya conocidos. */
    setDetails(details) {
      for (const info of details || []) {
        if (info?.url) meta.set(info.url, info);
      }
      recalcularRangos();
      applyFilter();
    },

    /**
     * Grupos de duplicados calculados en el servidor.
     * No borra nada: solo marca qué se pliega bajo qué.
     */
    setDuplicateGroups(groups, groupsPorDuracion) {
      gruposPorModo = {
        seguro: groups || [],
        // Si el servidor no manda la agresiva, el modo agresivo se queda con
        // la conservadora: mejor agrupar de menos que inventar grupos.
        duracion: groupsPorDuracion || groups || [],
      };
      aplicarGruposDelModo();
      applyFilter();
    },

    clear() {
      items = [];
      meta = new Map();
      duplicadoDe = new Map();
      grupos = new Map();
      ocultos = new Set();
      tandas.length = 0;
      expandidos.clear();
      desagrupados.clear();
      gruposPorModo = { seguro: [], duracion: [] };
      modoDuplicados = 'seguro';
      dupDuracionToggle.input.checked = false;
      avisoModoDup.hidden = true;
      search.value = '';
      exclude.value = '';
      orden = { campo: 'orden', direccion: 'asc' };
      ocultarSinDuracion = false;
      ocultarSinPeso = false;
      toggleSinDuracion.input.checked = false;
      toggleSinPeso.input.checked = false;
      recalcularRangos();
      applyFilter();
    },
  };
}
