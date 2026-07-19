/**
 * Estado del desbloqueo de administración.
 *
 * Punto ÚNICO de verdad sobre si la sesión está desbloqueada. Todo lo que
 * dependa de ello (la barra de perfiles, el botón de guardar) se suscribe
 * aquí en vez de mirar el almacenamiento por su cuenta: si cada componente
 * lo consultara por separado acabarían desincronizados y el botón de guardar
 * quedaría visible sin permiso.
 *
 * El token vive en `sessionStorage` a propósito, nunca en `localStorage` ni
 * en una cookie: al cerrar la pestaña la herramienta vuelve a aparecer en
 * blanco para la siguiente persona que se siente delante.
 */

const TOKEN_KEY = 'urlexplorer:admin-token';

const listeners = new Set();

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    // Almacenamiento bloqueado: se puede usar la app, pero no desbloquearla.
    return '';
  }
}

/** Token actual, o cadena vacía si la sesión está bloqueada. */
export function getAdminToken() {
  return readToken();
}

export function isUnlocked() {
  return readToken() !== '';
}

function notify() {
  for (const listener of listeners) listener(isUnlocked());
}

/** Se suscribe a los cambios de estado. Devuelve la función para desuscribirse. */
export function onAdminChange(listener) {
  listeners.add(listener);
  listener(isUnlocked());
  return () => listeners.delete(listener);
}

export function setAdminToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Sin almacenamiento el desbloqueo no puede persistir entre recargas.
  }
  notify();
}

export function clearAdminToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // nada que limpiar
  }
  notify();
}

/**
 * Gesto oculto de desbloqueo: N pulsaciones sobre un elemento dentro de una
 * ventana de tiempo.
 *
 * Elegido frente a una secuencia de teclas (se dispara sola al escribir en
 * los campos del formulario) y frente a un atajo con Ctrl+Shift (choca con
 * los del navegador y es lo primero que alguien prueba). Sobre el logo no
 * insinúa nada en el HTML y funciona igual con el dedo en un móvil.
 */
export function attachSecretGesture(target, onTrigger, { clicks = 5, windowMs = 2000 } = {}) {
  if (!target) return;

  let hits = [];

  target.addEventListener('click', () => {
    const now = Date.now();
    hits = hits.filter(time => now - time < windowMs);
    hits.push(now);

    if (hits.length >= clicks) {
      hits = [];
      onTrigger();
    }
  });
}
