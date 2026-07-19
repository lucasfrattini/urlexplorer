import { el, toast, copyToClipboard, show } from '../dom.js';
import { getAdminProfiles, saveAdminProfiles } from '../api.js';
import { isUnlocked, onAdminChange } from '../admin.js';
import { t, texto, atributo, alCambiarIdioma } from '../i18n/index.js';

/**
 * Barra de configuraciones guardadas.
 *
 * Este módulo NO contiene ningún sitio. Antes llevaba una constante con los
 * perfiles preconfigurados, lo que significaba servírselos a cualquiera que
 * abriese la aplicación y, peor, tenerlos en el repositorio. Ahora viven en el
 * servidor (`data/profiles.json`, fuera del control de versiones) y solo se
 * piden cuando la sesión está desbloqueada.
 *
 * Con la sesión bloqueada la barra entera está oculta: sin desplegable y sin
 * botón de guardar. Es el estado por defecto.
 */

/** Campos que forman parte de una configuración compartible. */
export const CONFIG_KEYS = [
  'searchUrl',
  'searchTerm',
  'linkPattern',
  'fileExtensions',
  'pageParam',
  'startPage',
  'endPage',
  'concurrency',
  'useJavaScript',
  'openLicenseOnly',
];

/**
 * Lee una configuración de la query string de la página.
 *
 * Permite abrir la app con todo relleno desde un enlace, que es lo que hace
 * que una configuración se pueda guardar en marcadores o compartir. Funciona
 * con la sesión bloqueada: el enlace lo trae quien lo abre, no revela nada
 * que estuviera guardado en el servidor.
 */
export function configFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const config = {};
  let found = false;

  for (const key of CONFIG_KEYS) {
    if (!params.has(key)) continue;
    const value = params.get(key);
    config[key] = value === 'true' ? true : value === 'false' ? false : value;
    found = true;
  }

  return found ? config : null;
}

/** Construye el enlace que reproduce una configuración. */
export function configToUrl(config) {
  const params = new URLSearchParams();
  for (const key of CONFIG_KEYS) {
    const value = config[key];
    if (value === undefined || value === null || value === '' || value === false) continue;
    params.set(key, String(value));
  }
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?${params.toString()}#/explorer`;
}

export function createProfileBar({ getConfig, applyConfig }) {
  /** @type {Array<{name: string, note?: string, config: object}>} */
  let profiles = [];

  const select = el('select', {
    className: 'input',
    on: {
      change: () => {
        const profile = profiles.find(item => item.name === select.value);
        if (!profile) return;
        applyConfig(profile.config);
        toast(t('perfiles.cargada', { nombre: profile.name }));
        updateButtons();
      },
    },
  });

  atributo(select, 'aria-label', 'perfiles.aria');

  const saveButton = texto(
    el('button', {
      className: 'button button--secondary button--small',
      attrs: { type: 'button' },
      on: { click: () => saveCurrent() },
    }),
    'perfiles.guardar'
  );

  const deleteButton = texto(
    el('button', {
      className: 'button button--secondary button--small',
      attrs: { type: 'button' },
      on: { click: () => deleteCurrent() },
    }),
    'perfiles.borrar'
  );

  const linkButton = el('button', {
    className: 'button button--secondary button--small',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const url = configToUrl(getConfig());
        const ok = await copyToClipboard(url);
        toast(t(ok ? 'perfiles.enlaceCopiado' : 'copiar.fallo'), ok ? 'success' : 'error');
      },
    },
  });

  texto(linkButton, 'perfiles.copiarEnlace');
  atributo(linkButton, 'title', 'perfiles.copiarEnlace.title');

  // Debe declararse antes de cualquier función que lo use en tiempo de
  // ejecución: con const, usarlo antes de esta línea es un error de zona
  // muerta y se rompe el dibujado de la barra entera.
  const note = el('p', { className: 'profiles__note' });
  note.hidden = true;

  function updateButtons() {
    const selected = select.value;
    const profile = profiles.find(item => item.name === selected);
    deleteButton.disabled = !profile;
    note.textContent = profile?.note || '';
    note.hidden = !profile?.note;
  }

  function refreshSelect(selected = select.value) {
    const children = [el('option', { text: t('perfiles.elige'), attrs: { value: '' } })];

    for (const profile of profiles) {
      children.push(el('option', { text: profile.name, attrs: { value: profile.name } }));
    }

    select.replaceChildren(...children);
    select.value = profiles.some(item => item.name === selected) ? selected : '';
    updateButtons();
  }

  /** Persiste la lista completa. El servidor revalida lo que llega. */
  async function persist(next) {
    try {
      const result = await saveAdminProfiles(next);
      profiles = result.profiles || [];
      return true;
    } catch (error) {
      toast(t('perfiles.noGuardado', { mensaje: error.message }), 'error');
      return false;
    }
  }

  async function saveCurrent() {
    const suggested = select.value || '';
    const name = window.prompt(t('perfiles.nombrePrompt'), suggested);
    if (name === null) return;

    const clean = name.trim();
    if (clean === '') {
      toast(t('perfiles.nombreVacio'), 'error');
      return;
    }

    const entry = { name: clean, config: getConfig() };
    const existing = profiles.findIndex(item => item.name === clean);
    const next = [...profiles];
    if (existing >= 0) next[existing] = { ...next[existing], ...entry };
    else next.push(entry);

    if (await persist(next)) {
      refreshSelect(clean);
      toast(t('perfiles.guardado', { nombre: clean }));
    }
  }

  async function deleteCurrent() {
    const name = select.value;
    if (!name) return;
    if (!window.confirm(t('perfiles.confirmarBorrado', { nombre: name }))) return;

    if (await persist(profiles.filter(item => item.name !== name))) {
      refreshSelect('');
      toast(t('perfiles.borrado', { nombre: name }));
    }
  }

  async function load() {
    if (!isUnlocked()) {
      profiles = [];
      refreshSelect('');
      return;
    }

    try {
      const result = await getAdminProfiles();
      profiles = result.profiles || [];
    } catch (error) {
      profiles = [];
      toast(t('perfiles.noCargadas', { mensaje: error.message }), 'error');
    }
    refreshSelect();
  }

  // Lo que solo tiene sentido con la sesión desbloqueada. "Copiar enlace" se
  // queda fuera a propósito: comparte la configuración que el usuario tiene
  // delante y no revela nada de lo guardado en el servidor, así que sirve
  // igual con la sesión bloqueada.
  const adminControls = el('div', {
    className: 'profiles__admin',
    children: [
      texto(el('span', { className: 'profiles__label' }), 'perfiles.etiqueta'),
      select,
      saveButton,
      deleteButton,
    ],
  });

  const root = el('div', {
    className: 'profiles',
    children: [adminControls, linkButton, note],
  });

  // Estado por defecto: bloqueado. Solo el desbloqueo lo hace aparecer.
  show(adminControls, false);

  // La opcion "elige una" del desplegable es texto traducido dentro de una
  // lista que se reconstruye: se rehace entera al cambiar de idioma.
  alCambiarIdioma(() => refreshSelect());

  onAdminChange(unlocked => {
    show(adminControls, unlocked);
    if (!unlocked) {
      note.hidden = true;
      note.textContent = '';
    }
    load();
  });

  return { root, refresh: load };
}
