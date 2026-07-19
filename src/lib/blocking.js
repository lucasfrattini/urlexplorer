'use strict';

/**
 * Detección de bloqueo anti-bot.
 *
 * Según el análisis de `IDEAS.md`, es la causa de fallo más común: cuatro de
 * los ocho sitios estudiados devolvían cero resultados por esto. Hoy el
 * usuario ve una lista vacía y no tiene forma de distinguir "el sitio no
 * tiene nada" de "el sitio me ha cerrado la puerta".
 *
 * ── ESTO ES UNA SOSPECHA, NUNCA UN DIAGNÓSTICO ────────────────────────
 *
 * Todas las señales de aquí son heurísticas y pueden dar falsos positivos:
 * una página legítima puede hablar de captchas, y un 403 puede ser
 * simplemente una URL que no existe para clientes anónimos. Por eso lo que
 * se devuelve son "motivos" en plural y la interfaz lo presenta como algo a
 * comprobar, igual que se hizo con la propuesta de configuración.
 *
 * La regla es la misma de siempre en este proyecto: es mejor decir "esto
 * huele raro, míralo" que callarse, y muchísimo mejor que afirmar una causa
 * que no se puede probar.
 */

/**
 * Marcas en el CUERPO de la respuesta.
 *
 * Se buscan sobre el HTML en minúsculas. Cada una vale por sí sola, pero el
 * resultado nunca pasa de "sospechoso".
 */
const MARCAS_HTML = [
  // Plataformas de challenge conocidas, por su infraestructura
  { patron: 'cdn-cgi/challenge-platform', motivo: 'lleva un challenge de CDN incrustado' },
  { patron: '__cf_chl', motivo: 'lleva un challenge de CDN incrustado' },
  { patron: 'incapsula incident id', motivo: 'la respuesta viene de un WAF' },
  { patron: '/_incapsula_resource', motivo: 'la respuesta viene de un WAF' },
  { patron: 'perimeterx', motivo: 'la respuesta viene de un sistema anti-bot' },
  { patron: 'datadome', motivo: 'la respuesta viene de un sistema anti-bot' },

  // Textos de página de espera / verificación
  { patron: 'just a moment', motivo: 'es una página de espera, no el contenido' },
  { patron: 'checking your browser', motivo: 'es una página de verificación de navegador' },
  { patron: 'verifying you are human', motivo: 'es una página de verificación de navegador' },
  { patron: 'enable javascript and cookies', motivo: 'exige JavaScript y cookies para entrar' },
  { patron: 'attention required', motivo: 'es una página de bloqueo' },
  { patron: 'access denied', motivo: 'es una página de acceso denegado' },
  { patron: 'acceso denegado', motivo: 'es una página de acceso denegado' },

  // Captcha
  { patron: 'g-recaptcha', motivo: 'hay un captcha en la página' },
  { patron: 'h-captcha', motivo: 'hay un captcha en la página' },
  { patron: 'recaptcha/api.js', motivo: 'hay un captcha en la página' },
];

/**
 * Códigos de estado que, en un scraper, suelen significar bloqueo.
 *
 * 403 y 429 son los claros. 503 se incluye porque es lo que devuelven varias
 * plataformas de challenge mientras "comprueban" al visitante, aunque también
 * es un fallo genuino de servidor: por eso su motivo lo dice.
 */
const ESTADOS = {
  401: 'el sitio pide autenticación (401)',
  403: 'el sitio respondió 403, que suele ser un bloqueo',
  429: 'el sitio respondió 429: demasiadas peticiones',
  503: 'el sitio respondió 503, que puede ser un challenge o una caída real',
};

/** Un HTML tan corto no es una página de contenido. */
const HTML_SOSPECHOSAMENTE_CORTO = 512;

/**
 * Analiza una respuesta y devuelve las señales de bloqueo encontradas.
 *
 * @param {{status?: number|null, html?: string|null}} respuesta
 * @returns {{sospechoso: boolean, motivos: string[]}}
 */
function analizarRespuesta({ status = null, html = null } = {}) {
  const motivos = new Set();

  if (status !== null && ESTADOS[status]) {
    motivos.add(ESTADOS[status]);
  }

  if (typeof html === 'string' && html !== '') {
    const texto = html.toLowerCase();
    for (const { patron, motivo } of MARCAS_HTML) {
      if (texto.includes(patron)) motivos.add(motivo);
    }

    // Una respuesta diminuta que además se recarga sola es el patrón clásico
    // de la página intermedia de un challenge.
    if (html.length < HTML_SOSPECHOSAMENTE_CORTO && /http-equiv=["']?refresh/i.test(html)) {
      motivos.add('la respuesta es una redirección automática casi vacía');
    }
  }

  return { sospechoso: motivos.size > 0, motivos: [...motivos] };
}

/**
 * Igual, pero a partir del error de una petición fallida.
 *
 * El cliente HTTP rechaza los 4xx, así que cuando hay bloqueo por código de
 * estado el cuerpo llega dentro del error y no por el camino normal.
 */
function analizarError(error) {
  const status = error?.response?.status ?? null;
  const cuerpo = error?.response?.data;
  const html = typeof cuerpo === 'string' ? cuerpo : null;

  if (status === null && html === null) return { sospechoso: false, motivos: [] };
  return analizarRespuesta({ status, html });
}

/** Funde varias observaciones en una sola, sin repetir motivos. */
function combinar(observaciones) {
  const motivos = new Set();
  for (const obs of observaciones) {
    if (!obs) continue;
    for (const motivo of obs.motivos || []) motivos.add(motivo);
  }
  return { sospechoso: motivos.size > 0, motivos: [...motivos] };
}

module.exports = {
  analizarRespuesta,
  analizarError,
  combinar,
  MARCAS_HTML,
  ESTADOS,
};
