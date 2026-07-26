import { el } from '../dom.js';
import { t, alCambiarIdioma } from '../i18n/index.js';

/**
 * Diálogo modal propio: overlay + caja centrada, con foco atrapado.
 *
 * Sustituye a `window.prompt()`/`window.confirm()`. Esos los dibuja el
 * navegador: no respetan el tema claro/oscuro y los rótulos de sus botones
 * ("Aceptar"/"Cancelar") los pone el navegador, fuera del control de
 * `es.js`/`en.js`. Este componente no sabe nada del dominio (admin, perfiles):
 * recibe claves de i18n y devuelve una promesa, igual que hacía la función
 * nativa a la que reemplaza.
 *
 * No hay ningún otro modal en el proyecto para reutilizar: `.disclosure` es
 * un `<details>` nativo sin foco atrapado, y `.export-menu` es un
 * desplegable posicionado, no bloqueante.
 */

let contadorId = 0;

const SELECTOR_FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Motor común a `promptDialog` y `confirmDialog`.
 *
 * `render({ cuerpo, acciones, cerrar })` arma el contenido propio de cada
 * variante (el campo de texto, o los dos botones de confirmar) y devuelve
 * `{ focoInicial, refrescar }`: `refrescar()` se llama YA y en cada cambio
 * de idioma, para que el texto no se quede congelado si el diálogo sigue
 * abierto cuando alguien cambia de idioma.
 *
 * Se usa una ÚNICA suscripción a `alCambiarIdioma` por diálogo, y se
 * desuscribe al cerrar: los helpers `texto()`/`atributo()` no exponen su
 * función de baja, así que usarlos aquí dejaría un repintador colgado por
 * cada diálogo abierto y cerrado en la sesión.
 */
function abrirDialogo({ role, titleKey, valorCancelar, render }) {
  return new Promise(resolve => {
    const focoPrevio = document.activeElement;
    const tituloId = `dialog-title-${(contadorId += 1)}`;

    const titulo = el('h2', { className: 'dialog__title', attrs: { id: tituloId } });
    const cuerpo = el('div', { className: 'dialog__body' });
    const acciones = el('div', { className: 'dialog__actions' });

    const caja = el('div', {
      className: 'dialog',
      attrs: { role, 'aria-modal': 'true', 'aria-labelledby': tituloId },
      children: [titulo, cuerpo, acciones],
    });

    const overlay = el('div', { className: 'dialog-overlay', children: [caja] });

    function cerrar(valor) {
      unsuscribir();
      overlay.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onOverlayClick);
      overlay.remove();
      // El foco vuelve a quien abrió el diálogo (normalmente el botón que
      // disparó el gesto), no se queda huérfano en un nodo ya desmontado.
      if (focoPrevio && typeof focoPrevio.focus === 'function') focoPrevio.focus();
      resolve(valor);
    }

    function onOverlayClick(evento) {
      // Solo cuenta el clic FUERA de la caja: dentro de ella, el target
      // nunca es el propio overlay.
      if (evento.target === overlay) cerrar(valorCancelar);
    }

    function onKeydown(evento) {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        cerrar(valorCancelar);
        return;
      }
      if (evento.key !== 'Tab') return;

      // Foco atrapado: Tab en el último elemento vuelve al primero, y
      // Mayús+Tab en el primero va al último. Sin esto el teclado se escapa
      // del diálogo hacia el resto de la página, que sigue detrás, oculta.
      const focuseables = [...caja.querySelectorAll(SELECTOR_FOCUSABLE)];
      if (focuseables.length === 0) return;
      const primero = focuseables[0];
      const ultimo = focuseables[focuseables.length - 1];

      if (evento.shiftKey && document.activeElement === primero) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
    }

    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener('keydown', onKeydown);

    const { focoInicial, refrescar } = render({ cuerpo, acciones, cerrar });

    document.body.append(overlay);
    (focoInicial || caja).focus();

    const unsuscribir = alCambiarIdioma(() => {
      titulo.textContent = t(titleKey);
      refrescar?.();
    });
  });
}

/**
 * Pide un texto. `Promise<string|null>`: `null` significa cancelado, igual
 * que devolvía `window.prompt()`.
 */
export function promptDialog({ titleKey, labelKey, defaultValue = '', inputType = 'text' }) {
  return abrirDialogo({
    role: 'dialog',
    titleKey,
    valorCancelar: null,
    render({ cuerpo, acciones, cerrar }) {
      const inputId = `dialog-input-${(contadorId += 1)}`;

      const label = el('label', { className: 'dialog__label', attrs: { for: inputId } });
      const input = el('input', {
        className: 'dialog__input input',
        attrs: {
          id: inputId,
          type: inputType,
          // 'off' evita el listado de valores tecleados en sesiones
          // anteriores (privacidad); 'new-password' es lo único que impide
          // ese mismo listado en el campo de contraseña, donde 'off' no
          // basta en varios navegadores.
          autocomplete: inputType === 'password' ? 'new-password' : 'off',
        },
      });
      input.value = defaultValue;

      // Enter acepta, igual que en el prompt nativo; Escape (manejado por
      // el motor común) cancela.
      input.addEventListener('keydown', evento => {
        if (evento.key === 'Enter') {
          evento.preventDefault();
          cerrar(input.value);
        }
      });

      cuerpo.append(label, input);

      const botonCancelar = el('button', {
        className: 'button button--secondary',
        attrs: { type: 'button' },
        on: { click: () => cerrar(null) },
      });
      const botonAceptar = el('button', {
        className: 'button',
        attrs: { type: 'button' },
        on: { click: () => cerrar(input.value) },
      });
      acciones.append(botonCancelar, botonAceptar);

      return {
        focoInicial: input,
        refrescar() {
          label.textContent = t(labelKey);
          botonCancelar.textContent = t('dialogo.cancelar');
          botonAceptar.textContent = t('dialogo.aceptar');
        },
      };
    },
  });
}

/**
 * Pide confirmar una acción. `Promise<boolean>`.
 *
 * `variant: 'danger'` tiñe el botón de aceptar como acción destructiva
 * (`.button--danger`), igual que el resto de acciones peligrosas de la app.
 */
export function confirmDialog({ titleKey, bodyKey, bodyParams, variant = 'default' }) {
  return abrirDialogo({
    role: 'alertdialog',
    titleKey,
    valorCancelar: false,
    render({ cuerpo, acciones, cerrar }) {
      // Nombrado "mensaje" y no "texto": el helper `texto()` de i18n no se
      // importa en este fichero, pero una variable local con ese nombre ya
      // tapó ese helper una vez en resultList.js. Se evita el nombre aquí
      // aunque hoy no haya colisión, para no repetir la trampa.
      const mensaje = el('p', { className: 'dialog__text' });
      cuerpo.append(mensaje);

      const botonCancelar = el('button', {
        className: 'button button--secondary',
        attrs: { type: 'button' },
        on: { click: () => cerrar(false) },
      });
      const botonAceptar = el('button', {
        className: variant === 'danger' ? 'button button--danger' : 'button',
        attrs: { type: 'button' },
        on: { click: () => cerrar(true) },
      });
      acciones.append(botonCancelar, botonAceptar);

      return {
        focoInicial: botonAceptar,
        refrescar() {
          mensaje.textContent = t(bodyKey, bodyParams);
          botonCancelar.textContent = t('dialogo.cancelar');
          botonAceptar.textContent = t('dialogo.aceptar');
        },
      };
    },
  });
}
