import { getHealth, adminUnlock } from './api.js';
import { createExplorerView } from './views/explorer.js';
import { createVideoView } from './views/video.js';
import { attachSecretGesture, setAdminToken, clearAdminToken, isUnlocked } from './admin.js';
import { toast } from './dom.js';

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

  toggle?.addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    current = order[(order.indexOf(current) + 1) % order.length];
    apply(current);
    toggle.title = `Tema: ${current}`;
    try {
      localStorage.setItem(THEME_KEY, current);
    } catch {
      // sin almacenamiento: el tema no persiste, no es crítico
    }
  });
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
      toast('Configuraciones bloqueadas');
      return;
    }

    const password = window.prompt('Contraseña:');
    if (password === null || password.trim() === '') return;

    try {
      await adminUnlock(password);
      // Solo se guarda DESPUÉS de que el servidor lo valide: así en
      // sessionStorage nunca queda un token que no sirve.
      setAdminToken(password);
      toast('Configuraciones desbloqueadas');
    } catch (error) {
      // Un 404 significa que no hay ADMIN_TOKEN configurado. Se responde lo
      // mismo que ante una contraseña incorrecta para no confirmar si la
      // funcionalidad existe siquiera.
      toast(
        error.status === 429 ? 'Demasiados intentos. Espera un minuto.' : 'Contraseña incorrecta',
        'error'
      );
    }
  });
}

/* ── Estado del servicio ───────────────────────────────────────────── */

async function initHealth() {
  const dot = document.getElementById('health-indicator');
  const text = document.getElementById('health-text');

  try {
    const health = await getHealth();
    dot.className = 'status-dot status-dot--ok';
    text.textContent = `Servicio activo · navegador ${
      health.browserEnabled ? 'disponible' : 'desactivado'
    } · máx. ${health.limits.maxPages} páginas por búsqueda`;
    return health.limits;
  } catch {
    dot.className = 'status-dot status-dot--error';
    text.textContent = 'No se pudo contactar con el servidor. Se usan los límites por defecto.';
    return DEFAULT_LIMITS;
  }
}

/* ── Arranque ──────────────────────────────────────────────────────── */

async function main() {
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
