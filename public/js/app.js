import { getHealth, adminUnlock } from './api.js';
import { createExplorerView } from './views/explorer.js';
import { createVideoView } from './views/video.js';
import { attachSecretGesture, setAdminToken, clearAdminToken, isUnlocked } from './admin.js';
import { toast } from './dom.js';
import { promptDialog } from './components/dialog.js';
import {
  t,
  IDIOMAS,
  idiomaActual,
  cambiarIdioma,
  alCambiarIdioma,
  traducirDocumento,
} from './i18n/index.js';

const THEME_KEY = 'urlexplorer:theme';

const DEFAULT_LIMITS = {
  maxPages: 50,
  maxLinks: 5000,
  maxFiles: 5000,
  maxConcurrency: 12,
  defaultConcurrency: 4,
};

/* ── Tema ──────────────────────────────────────────────────────────── */

function initTheme() {
  const toggle = document.getElementById('theme-toggle');

  const apply = theme => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  };

  let current = 'system';
  try {
    current = localStorage.getItem(THEME_KEY) || 'system';
  } catch {
    current = 'system';
  }
  apply(current);

  // El título dice el tema vigente, así que se rehace también al cambiar de
  // idioma: si no, se quedaría "Tema: oscuro" con la interfaz ya en inglés.
  const refrescarTitulo = () => {
    if (toggle) toggle.title = t('tema.actual', { modo: t(`tema.modo.${current}`) });
  };
  alCambiarIdioma(refrescarTitulo);

  toggle?.addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    current = order[(order.indexOf(current) + 1) % order.length];
    apply(current);
    refrescarTitulo();
    try {
      localStorage.setItem(THEME_KEY, current);
    } catch {
      // sin almacenamiento: el tema no persiste, no es crítico
    }
  });
}

/* ── Idioma ────────────────────────────────────────────────────────── */

/**
 * Selector de idioma de la cabecera.
 *
 * El tema vive en `localStorage` y el idioma en `sessionStorage`, y no es un
 * descuido: el tema es una preferencia de la persona que usa el ordenador,
 * mientras que aquí varias personas comparten la máquina y la sesión tiene
 * que empezar limpia, detectando de nuevo el idioma del navegador.
 */
function initLanguage() {
  const botones = [...document.querySelectorAll('.langswitch__option')];

  for (const boton of botones) {
    boton.addEventListener('click', () => {
      cambiarIdioma(boton.dataset.lang);
      toast(t('idioma.cambiado'));
    });
  }

  // El estado marcado se recalcula al cambiar el idioma, venga del clic o de
  // la detección inicial.
  alCambiarIdioma(actual => {
    for (const boton of botones) {
      const activo = boton.dataset.lang === actual;
      boton.setAttribute('aria-pressed', String(activo));
      boton.setAttribute('title', t(`idioma.${boton.dataset.lang}`));
    }
  });

  if (!IDIOMAS.includes(idiomaActual())) cambiarIdioma('en');
}

/* ── Navegación entre vistas ───────────────────────────────────────── */

function initRouter(views) {
  const tabs = [...document.querySelectorAll('.tab')];
  const sections = {
    explorer: document.getElementById('view-explorer'),
    video: document.getElementById('view-video'),
  };

  function activate(name, { updateHash = true } = {}) {
    if (!sections[name]) name = 'explorer';

    for (const tab of tabs) {
      const isActive = tab.dataset.view === name;
      if (isActive) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }

    for (const [key, section] of Object.entries(sections)) {
      section.hidden = key !== name;
    }

    if (updateHash) {
      const hash = `#/${name}`;
      if (window.location.hash !== hash) {
        window.history.replaceState(null, '', hash);
      }
    }

    views[name]?.focus?.();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.view));
  }

  window.addEventListener('hashchange', () => {
    activate(window.location.hash.replace('#/', '') || 'explorer', { updateHash: false });
  });

  const initial = window.location.hash.replace('#/', '') || 'explorer';
  activate(initial);
}

/* ── Desbloqueo de administración ──────────────────────────────────── */

/**
 * Gesto oculto: cinco pulsaciones sobre el logo en menos de dos segundos.
 *
 * Nada en el HTML lo insinúa, así que inspeccionar la página no lo revela.
 * Estando ya desbloqueada la sesión, el mismo gesto vuelve a bloquearla: es
 * la forma de dejar la herramienta en blanco antes de levantarse del sitio
 * sin tener que cerrar la pestaña.
 */
function initAdminGesture() {
  const logo = document.querySelector('.topbar__mark');

  attachSecretGesture(logo, async () => {
    if (isUnlocked()) {
      clearAdminToken();
      toast(t('admin.bloqueadas'));
      return;
    }

    const password = await promptDialog({
      titleKey: 'admin.desbloquear.titulo',
      labelKey: 'admin.contrasena',
      inputType: 'password',
    });
    if (password === null || password.trim() === '') return;

    try {
      await adminUnlock(password);
      // Solo se guarda DESPUÉS de que el servidor lo valide: así en
      // sessionStorage nunca queda un token que no sirve.
      setAdminToken(password);
      toast(t('admin.desbloqueadas'));
    } catch (error) {
      // Un 404 significa que no hay ADMIN_TOKEN configurado. Se responde lo
      // mismo que ante una contraseña incorrecta para no confirmar si la
      // funcionalidad existe siquiera.
      toast(t(error.status === 429 ? 'admin.demasiados' : 'admin.incorrecta'), 'error');
    }
  });
}

/* ── Estado del servicio ───────────────────────────────────────────── */

async function initHealth() {
  const dot = document.getElementById('health-indicator');
  const text = document.getElementById('health-text');

  /** Último estado conocido, para poder repintarlo en el otro idioma. */
  let estado = null;

  const pintar = () => {
    if (!estado) return;
    text.textContent = estado.ok
      ? t('salud.activo', {
          estado: t(
            estado.browserEnabled ? 'salud.navegador.disponible' : 'salud.navegador.desactivado'
          ),
          paginas: estado.maxPages,
        })
      : t('salud.error');
  };
  alCambiarIdioma(pintar);

  /**
   * A partir de aquí el texto lo gobierna `pintar()`, así que se le quita el
   * `data-i18n` del HTML. Si se dejara, el traductor del documento lo
   * devolvería a «Comprobando servicio…» en cada cambio de idioma, pisando
   * el estado real.
   */
  const tomarElControl = () => text.removeAttribute('data-i18n');

  try {
    const health = await getHealth();
    dot.className = 'status-dot status-dot--ok';
    tomarElControl();
    estado = { ok: true, browserEnabled: health.browserEnabled, maxPages: health.limits.maxPages };
    pintar();
    return health.limits;
  } catch {
    dot.className = 'status-dot status-dot--error';
    tomarElControl();
    estado = { ok: false };
    pintar();
    return DEFAULT_LIMITS;
  }
}

/* ── Arranque ──────────────────────────────────────────────────────── */

async function main() {
  // El idioma va PRIMERO: todo lo que se construya después ya nace traducido
  // y no hay un parpadeo en español antes de pasar a inglés.
  traducirDocumento();
  initLanguage();
  initTheme();
  initAdminGesture();

  const limits = { ...DEFAULT_LIMITS, ...(await initHealth()) };

  const views = {
    explorer: createExplorerView(document.getElementById('view-explorer'), { limits }),
    video: createVideoView(document.getElementById('view-video')),
  };

  initRouter(views);

  // Abortar los streams en curso al cerrar la pestaña, para que el servidor
  // no siga scrapeando en vano.
  window.addEventListener('beforeunload', () => {
    for (const view of Object.values(views)) view.teardown?.();
  });
}

main();
