/**
 * Helpers de DOM.
 *
 * REGLA DEL MÓDULO: nada de innerHTML con datos que vengan del servidor o de
 * páginas scrapeadas. La versión anterior hacía
 *   linksContainer.innerHTML = links.map(l => `<a href="${l}">${l}</a>`)
 * con URLs sacadas de sitios de terceros, así que un href malicioso ejecutaba
 * JavaScript en el navegador del usuario. Todo el texto entra por textContent
 * y todos los atributos por setAttribute.
 */

/** Crea un elemento. `text` siempre se asigna con textContent. */
export function el(tag, { className, text, attrs, children, on } = {}) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  if (on) {
    for (const [event, handler] of Object.entries(on)) {
      node.addEventListener(event, handler);
    }
  }

  if (children) {
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  return node;
}

/**
 * Enlace externo seguro.
 *
 * Además de escapar el texto, filtra el esquema: un href "javascript:..."
 * scrapeado de una página hostil se renderiza como texto plano, no como
 * enlace navegable.
 */
export function safeLink(url, { className, text } = {}) {
  const label = text ?? url;
  const isNavigable = /^https?:\/\//i.test(url);

  if (!isNavigable) {
    return el('span', { className, text: label, attrs: { title: url } });
  }

  return el('a', {
    className,
    text: label,
    attrs: {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
      title: url,
    },
  });
}

export function clear(node) {
  node.replaceChildren();
}

export function setChildren(node, children) {
  node.replaceChildren(...[].concat(children).filter(Boolean));
}

export function show(node, visible = true) {
  node.hidden = !visible;
}

/** Estado vacío reutilizable. */
export function emptyState({ icon = '○', title, text }) {
  return el('div', {
    className: 'empty',
    children: [
      el('div', { className: 'empty__icon', text: icon, attrs: { 'aria-hidden': 'true' } }),
      el('p', { className: 'empty__title', text: title }),
      text ? el('p', { className: 'empty__text', text }) : null,
    ],
  });
}

/** Alerta de error o aviso. */
export function alertBox({ variant = 'error', title, body }) {
  return el('div', {
    className: `alert alert--${variant}`,
    attrs: { role: variant === 'error' ? 'alert' : 'status' },
    children: [
      el('div', {
        children: [
          el('div', { className: 'alert__title', text: title }),
          body ? el('div', { className: 'alert__body', text: body }) : null,
        ],
      }),
    ],
  });
}

/** Tarjeta de estadística. */
export function stat(value, label) {
  return el('div', {
    className: 'stat',
    children: [
      el('div', { className: 'stat__value', text: value }),
      el('div', { className: 'stat__label', text: label }),
    ],
  });
}

export function badge(text, variant) {
  return el('span', {
    className: variant ? `badge badge--${variant}` : 'badge',
    text,
  });
}

/** Notificación efímera. */
export function toast(message, variant = 'success', duration = 2600) {
  const container = document.getElementById('toasts');
  if (!container) return;

  const node = el('div', { className: `toast toast--${variant}`, text: message });
  container.append(node);

  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 180ms';
    setTimeout(() => node.remove(), 200);
  }, duration);
}

/** Copia texto al portapapeles con fallback para contextos no seguros. */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // se intenta el fallback
  }

  const textarea = el('textarea', { attrs: { readonly: true } });
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();

  try {
    const ok = document.execCommand('copy');
    return ok;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/**
 * Botón de copiar de una sola línea, sin texto.
 *
 * Va solo con icono porque se repite en cada fila: con etiqueta robaría el
 * ancho del enlace, que es lo que el usuario está leyendo. Por eso lleva
 * `aria-label` y `title`: un botón sin texto accesible no lo anuncia ningún
 * lector de pantalla.
 */
export function copyIconButton(value, { label = 'Copiar esta URL' } = {}) {
  return el('button', {
    className: 'button button--secondary button--icon',
    text: '⧉',
    attrs: { type: 'button', 'aria-label': label, title: label },
    on: {
      click: async clickEvent => {
        // La fila entera puede ser clicable en el futuro; copiar no navega.
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        const ok = await copyToClipboard(value);
        toast(ok ? 'URL copiada' : 'No se pudo copiar', ok ? 'success' : 'error');
      },
    },
  });
}

/** Descarga un texto como fichero, sin pasar por el servidor. */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { attrs: { href: url, download: filename } });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
