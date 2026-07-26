/** Cliente de la API de URL Explorer. */

import { getAdminToken } from './admin.js';
import { t } from './i18n/index.js';

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
    // Un abort deliberado (AbortController, ver `extractVideos`) no es un
    // fallo de red: se relanza tal cual para que quien llamó lo distinga con
    // `error.name === 'AbortError'`. Envolverlo en un ApiError genérico lo
    // haría indistinguible de una caída real de la conexión.
    if (error.name === 'AbortError') throw error;
    throw new ApiError(t('api.sinConexion', { mensaje: error.message }), 'NETWORK', 0);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error || t('api.errorHttp', { status: response.status }),
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

/**
 * `signal` es el de un `AbortController` propio de la vista: "Cancelar" hace
 * `controller.abort()`, que corta el `fetch` en curso. El backend, a su vez,
 * aborta el análisis al detectar el cierre de la conexión (`res.on('close')`
 * en `routes/video.js`), así que cancelar de verdad detiene el trabajo, no
 * solo la espera del cliente.
 */
export function extractVideos(params, { signal } = {}) {
  return request('/video/extract', { method: 'POST', body: JSON.stringify(params), signal });
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
/** Frena una exploración en curso. El stream sigue abierto y cierra solo. */
export function pauseScrape(jobId) {
  return request('/scrape/pause', { method: 'POST', body: JSON.stringify({ jobId }) });
}

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
      message: t('api.sseCaida'),
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

/**
 * Abre el stream SSE del análisis de vídeo (mismo mecanismo que
 * `openScrapeStream`, calcado a propósito: es el único ya establecido en el
 * proyecto para progreso en tiempo real).
 *
 * Diferencias con `openScrapeStream`, por cómo lo espera `GET
 * /api/video/stream` (ver `parsearUrls` en `src/routes/video.js`):
 *   - `urls` viaja como un STRING JSON de un array, no como valor suelto: una
 *     lista de direcciones no cabe limpia en un solo parámetro de query.
 *   - `getMetadata`/`getThumbnails`/`useJavaScript` viajan SIEMPRE como
 *     'true'/'false' explícitos. El servidor compara contra la cadena
 *     'true' exacta, así que omitirlos equivale a mandar 'false' — a
 *     diferencia de `POST /video/extract`, donde `useJavaScript` por
 *     defecto es `true`. Aquí no hay valor por defecto que valga: hay que
 *     decir siempre lo que el formulario tiene marcado.
 */
export function openVideoStream(params, handlers = {}) {
  const query = new URLSearchParams();
  query.set('urls', JSON.stringify(params.urls || []));
  query.set('getMetadata', String(Boolean(params.getMetadata)));
  query.set('getThumbnails', String(Boolean(params.getThumbnails)));
  query.set('useJavaScript', String(Boolean(params.useJavaScript)));

  const source = new EventSource(`${BASE}/video/stream?${query.toString()}`);
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
      message: t('api.sseCaida'),
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
