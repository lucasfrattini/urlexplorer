'use strict';

/**
 * Recorrer una lista con un tope de tareas en vuelo.
 *
 * No hace falta añadir esperas entre tareas: el cliente HTTP ya pasa por
 * `HostThrottle`, que garantiza por hostname un intervalo mínimo y un máximo
 * de peticiones simultáneas. Meter además un `sleep` fijo penaliza también a
 * las URLs de hosts DISTINTOS, que es justo donde no hace falta esperar.
 *
 * Devuelve los resultados en el ORDEN de entrada, no en el de finalización:
 * quien llama suele emparejar cada resultado con su elemento por posición, y
 * un orden distinto convierte eso en un fallo silencioso de los caros.
 */
async function mapLimit(items, limit, tarea) {
  const lista = Array.from(items);
  const resultados = new Array(lista.length);
  const activos = Math.max(1, Math.min(limit, lista.length));

  let cursor = 0;

  async function worker() {
    while (cursor < lista.length) {
      const indice = cursor;
      cursor += 1;
      resultados[indice] = await tarea(lista[indice], indice);
    }
  }

  await Promise.all(Array.from({ length: activos }, () => worker()));
  return resultados;
}

module.exports = { mapLimit };
