/** Cliente de la API de URL Explorer. */

import { getAdminToken } from './admin.js';

const BASE = '/api';

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    // Las cabeceras se fusionan aparte: con un spread plano, un options.headers
    // (el token de admin) borraría el Content-Type y el body dejaría de
    // llegar como JSON.
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch (error) {
    throw new ApiError(`No se pudo contactar con el servidor: ${error.message}`, 'NETWORK', 0);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error || `Error ${response.status}`,
      payload?.code || 'HTTP_ERROR',
      response.status
    );
  }

  return payload;
}

export function getHealth() {
  return request('/health');
}

export function scrape(params) {
  return request('/scrape', { method: 'POST', body: JSON.stringify(params) });
}

/** Propone una configuración para una URL. Cuesta una carga con navegador. */
export function detectConfig(searchUrl) {
  return request('/scrape/detect', { method: 'POST', body: JSON.stringify({ searchUrl }) });
}

export function extractVideos(params) {
  return request('/video/extract', { method: 'POST', body: JSON.stringify(params) });
}

/* ── Administración ──────────────────────────────────────────────────
 *
 * El token viaja en la cabecera X-Admin-Token, nunca en la query string:
 * una query acaba en los logs del servidor y en el historial del navegador.
 */

function adminHeaders() {
  const token = getAdminToken();
  return token ? { 'X-Admin-Token': token } : {};
}

/** Valida una contraseña contra el servidor. No guarda nada por su cuenta. */
export function adminUnlock(token) {
  return request('/admin/unlock', { method: 'POST', body: JSON.stringify({ token }) });
}

export function getAdminProfiles() {
  return request('/admin/profiles', { headers: adminHeaders() });
}

export function saveAdminProfiles(profiles) {
  return request('/admin/profiles', {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ profiles }),
  });
}

/**
 * Abre el stream SSE del crawl.
 * Devuelve un objeto con `close()` para que la UI pueda cancelar: al cerrar el
 * EventSource, el servidor recibe el 'close' y aborta el trabajo.
 */
export function openScrapeStream(params, handlers = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }

  const source = new EventSource(`${BASE}/scrape/stream?${query.toString()}`);
  let finished = false;

  source.onmessage = event => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === 'complete' || payload.type === 'error') {
      finished = true;
      source.close();
    }

    handlers.onEvent?.(payload);
  };

  source.onerror = () => {
    // Un cierre limpio tras 'complete' también dispara onerror
    if (finished) return;
    source.close();
    handlers.onEvent?.({
      type: 'error',
      message: 'Se perdió la conexión con el servidor durante la búsqueda.',
      code: 'STREAM_DISCONNECTED',
    });
  };

  return {
    close() {
      finished = true;
      source.close();
    },
  };
}

export { ApiError };
