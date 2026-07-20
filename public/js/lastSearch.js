import { show } from './dom.js';
import { t, alCambiarIdioma } from './i18n/index.js';

/**
 * Marca de hora de la última exploración terminada, en el pie.
 *
 * Quien vuelve a la pestaña un rato después no sabe si lo que ve es de hace
 * un minuto o de hace media hora. Vive SOLO en memoria: no se guarda en
 * sessionStorage ni en localStorage, así que al recargar desaparece, que es
 * lo correcto —lo que se ve tras recargar ya no es el resultado de ninguna
 * búsqueda—.
 */

/**
 * Hora local en formato `HH:MM:SS`, 24 h y con ceros a la izquierda.
 *
 * A propósito NO se usa `toLocaleTimeString`: en inglés devolvería
 * `7:43:00 AM`, y el formato pedido es el mismo en los dos idiomas. La hora
 * es un dato, no una frase traducible.
 */
export function formatHora(date) {
  const dosDigitos = n => String(n).padStart(2, '0');
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(dosDigitos).join(':');
}

/**
 * Toma el control del nodo del pie y devuelve `marcar(date?)`.
 *
 * El texto es CALCULADO (lleva la hora dentro), así que registra su repintado
 * con `alCambiarIdioma`: enlazarlo con `texto()` lo devolvería a la plantilla
 * sin datos. Y el nodo NO lleva `data-i18n` —se le quita si lo llevara—
 * porque `traducirDocumento()` pisaría la hora en cada cambio de idioma; es
 * el mismo motivo documentado en `initHealth()` de `app.js`.
 *
 * Nada de `?.` sobre `nodo`: si el nodo no existe queremos el error en
 * consola, no un pie que calla para siempre.
 */
export function initUltimaBusqueda(nodo) {
  nodo.removeAttribute('data-i18n');

  /** Última hora marcada; `null` mientras no haya terminado ninguna. */
  let fecha = null;

  const pintar = () => {
    if (!fecha) {
      show(nodo, false);
      return;
    }
    nodo.textContent = t('footer.ultimaBusqueda', { hora: formatHora(fecha) });
    show(nodo, true);
  };
  alCambiarIdioma(pintar);

  return (date = new Date()) => {
    fecha = date;
    pintar();
  };
}
