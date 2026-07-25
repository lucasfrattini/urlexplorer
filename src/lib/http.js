'use strict';

const axios = require('axios');
const http = require('node:http');
const https = require('node:https');

const config = require('../config');
const logger = require('./logger');
const { AppError } = require('./errors');
const { assertUrlIsSafe, validateUrlShape, secureLookup } = require('./ssrf');
const { HostThrottle, sleep } = require('./throttle');

/**
 * Cliente HTTP saliente.
 *
 * Concentra User-Agent rotativo, timeouts, throttling por dominio, validación
 * SSRF (también en cada redirección) y tope de tamaño de respuesta.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

function buildHeaders(extra = {}) {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    'User-Agent': userAgent,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    DNT: '1',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
    ...extra,
  };
}

const throttle = new HostThrottle();

/**
 * Agentes con validación de IP en el momento de conectar.
 *
 * Es la ÚNICA capa que ve todas las conexiones: la primera, cada redirección
 * y la resolución real que abre el socket. `guardRedirect` sigue existiendo
 * porque corta antes y con mejor mensaje, pero es síncrono y por tanto no
 * puede resolver DNS: no basta por sí solo.
 */
const agentOptions = { keepAlive: true, lookup: secureLookup };
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

/**
 * Revalidación de FORMA en cada redirección.
 *
 * Filtra lo evidente (protocolo raro, IP privada literal, localhost) antes de
 * abrir nada. Lo que NO puede hacer es resolver DNS, porque axios llama a
 * esto de forma síncrona: un host público que resuelve a una IP privada pasa
 * este control sin despeinarse. Ese caso lo corta `secureLookup` al conectar.
 */
function guardRedirect(options) {
  const target = `${options.protocol}//${options.host}${options.path || ''}`;
  validateUrlShape(target);
}

/** ¿Este error es el sitio frenándonos a propósito? */
function esRateLimit(error) {
  return error?.response?.status === 429;
}

/**
 * `Retry-After` en milisegundos, o null si no viene o no se entiende.
 *
 * La cabecera admite DOS formas y hay que aceptar las dos: segundos ("30") o
 * una fecha HTTP ("Wed, 21 Oct 2026 07:28:00 GMT"). Quedarse solo con la
 * primera dejaría a los sitios que mandan fecha con el backoff genérico, sin
 * dar ningún error.
 */
function retryAfterMs(raw) {
  if (raw === undefined || raw === null) return null;
  const texto = String(raw).trim();
  if (texto === '') return null;

  const segundos = Number(texto);
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000);

  const fecha = Date.parse(texto);
  if (Number.isNaN(fecha)) return null;
  return Math.max(0, fecha - Date.now());
}

/**
 * Cuánto esperar antes del siguiente intento.
 *
 * Un 429 no es un fallo pasajero: el sitio nos frena por volumen y la
 * recuperación medida es de minutos, así que el backoff lineal genérico
 * (1s/2s/3s) reintenta DENTRO del bloqueo y solo suma al contador que lo
 * provocó. Si el sitio manda `Retry-After`, se le hace caso: es él diciendo
 * cuándo volver. El tope se aplica siempre, también a lo que pida el sitio,
 * porque un `Retry-After` de una hora colgaría el crawl entero.
 *
 * Lo que NO es un 429 sigue con el backoff de siempre.
 */
function retryDelayMs(error, attempt) {
  if (!esRateLimit(error)) return config.http.retryBaseDelayMs * attempt;

  const pedido = retryAfterMs(error.response.headers?.['retry-after']);
  const espera = pedido ?? config.http.retry429BaseDelayMs;
  return Math.min(espera, config.http.retry429MaxDelayMs);
}

/** GET de HTML con throttle, validación SSRF y tope de tamaño. */
async function fetchHtml(url, { timeout, signal } = {}) {
  await assertUrlIsSafe(url);

  return throttle.run(url, async () => {
    try {
      const response = await axios.get(url, {
        headers: buildHeaders(),
        timeout: timeout ?? config.http.pageTimeoutMs,
        maxRedirects: config.http.maxRedirects,
        maxContentLength: config.http.maxResponseBytes,
        maxBodyLength: config.http.maxResponseBytes,
        responseType: 'text',
        signal,
        httpAgent,
        httpsAgent,
        beforeRedirect: guardRedirect,
        validateStatus: status => status >= 200 && status < 400,
      });

      // Este es el ÚNICO punto que ve el resultado real de la petición: lo
      // que pase de aquí lo envuelven los reintentos y ya no distingue un 429
      // del sitio de un fallo cualquiera.
      throttle.reportOutcome(url, { blocked: false });

      if (typeof response.data !== 'string') {
        return String(response.data ?? '');
      }
      return response.data;
    } catch (error) {
      // Solo el 429 alimenta el freno por host: es el sitio diciendo
      // "demasiadas peticiones". Un timeout o un 500 no significan eso.
      throttle.reportOutcome(url, { blocked: esRateLimit(error) });
      throw error;
    }
  });
}

/** Igual que fetchHtml pero devuelve null en vez de lanzar. */
async function tryFetchHtml(url, options = {}) {
  try {
    return await fetchHtml(url, options);
  } catch (error) {
    logger.warn(`No se pudo descargar ${url}`, error.message);
    return null;
  }
}

/** GET con reintentos y backoff lineal (propio para el 429). Lanza el último error. */
async function fetchHtmlWithRetry(url, { retries, signal, timeout } = {}) {
  const attempts = retries ?? config.http.retries;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw new AppError('Operación cancelada', 499, 'ABORTED');
    try {
      return await fetchHtml(url, { signal, timeout });
    } catch (error) {
      lastError = error;
      // Un fallo de validación no mejora reintentando
      if (error instanceof AppError && error.expected) throw error;
      if (attempt < attempts) {
        await sleep(retryDelayMs(error, attempt));
      }
    }
  }

  throw lastError;
}

/**
 * HEAD para obtener content-length. Devuelve null si no se puede.
 *
 * `referer` es la página donde se encontró el fichero, y NO es opcional en la
 * práctica: muchos CDN tienen protección de hotlinking y responden 403 a un
 * HEAD que llega sin Referer. Ese 403 se tragaba aquí en silencio, así que la
 * casilla "Obtener el tamaño" tardaba siete veces más y devolvía cero pesos
 * sin decir por qué. Con el Referer de la ficha, el mismo CDN responde 200 y
 * el content-length correcto.
 *
 * Es además lo que haría un navegador al pedir el vídeo desde esa página, así
 * que no es un truco: es enviar la cabecera que corresponde.
 */
async function fetchContentLength(url, { signal, referer } = {}) {
  try {
    await assertUrlIsSafe(url);
  } catch {
    return null;
  }

  try {
    return await throttle.run(url, async () => {
      const response = await axios.head(url, {
        headers: buildHeaders(
          referer
            ? {
                Referer: referer,
                // Coherentes con "esto lo pide una página, no la barra de
                // direcciones": algunos CDN también miran estas.
                'Sec-Fetch-Dest': 'video',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site',
              }
            : {}
        ),
        timeout: config.http.headTimeoutMs,
        maxRedirects: config.http.maxRedirects,
        signal,
        httpAgent,
        httpsAgent,
        beforeRedirect: guardRedirect,
      });
      const contentLength = response.headers['content-length'];
      if (contentLength === undefined) return null;
      const parsed = Number.parseInt(contentLength, 10);
      return Number.isFinite(parsed) ? parsed : null;
    });
  } catch {
    return null;
  }
}

/** Agentes con validación de IP al conectar, para reutilizarlos fuera. */
function agentesSeguros() {
  return { httpAgent, httpsAgent };
}

module.exports = {
  agentesSeguros,
  buildHeaders,
  fetchHtml,
  tryFetchHtml,
  fetchHtmlWithRetry,
  fetchContentLength,
  USER_AGENTS,
};
