/**
 * Formatos de exportación.
 *
 * Lógica pura, sin DOM: todo el dato ya está en el cliente cuando se pulsa
 * exportar, así que no hace falta ninguna ruta nueva. Vive aparte para poder
 * probarlo, porque el escapado de CSV es de esas cosas que fallan en silencio
 * y solo se notan al abrir el fichero en otro programa.
 */

/** Columnas del CSV, en orden. `campo` es la clave de la fila. */
export const COLUMNAS_CSV = [
  { campo: 'numero', titulo: 'n' },
  { campo: 'url', titulo: 'url' },
  { campo: 'duracion', titulo: 'duracion' },
  { campo: 'duracionSegundos', titulo: 'duracion_segundos' },
  { campo: 'peso', titulo: 'peso' },
  { campo: 'pesoBytes', titulo: 'peso_bytes' },
  { campo: 'pesoAproximado', titulo: 'peso_aproximado' },
  { campo: 'paginaOrigen', titulo: 'pagina_origen' },
  { campo: 'verificado', titulo: 'verificado' },
  { campo: 'motivoSinVerificar', titulo: 'motivo_sin_verificar' },
  { campo: 'grupoDuplicados', titulo: 'grupo_duplicados' },
  { campo: 'duplicadosAgrupados', titulo: 'duplicados_agrupados' },
];

/**
 * Escapa un valor para CSV. **Esto es lo crítico del módulo.**
 *
 * Una URL con una coma parte la fila y el fichero se lee mal SIN dar ningún
 * error: la hoja de cálculo se abre tan contenta con las columnas corridas.
 * Regla de RFC 4180: si el valor lleva coma, comilla o salto de línea, se
 * envuelve en comillas y las comillas internas se duplican.
 *
 * ── Y además, inyección de fórmulas ───────────────────────────────────
 *
 * Estos datos vienen de páginas de terceros. Un valor que empiece por `=`,
 * `+`, `-` o `@` lo interpretan Excel y LibreOffice como FÓRMULA, no como
 * texto, así que una URL preparada puede ejecutar algo al abrir el fichero.
 * Se neutraliza anteponiendo un apóstrofo, que es lo que recomienda OWASP y
 * lo que hacen las hojas de cálculo para forzar texto.
 */
export function escaparCSV(valor) {
  if (valor === null || valor === undefined) return '';

  let texto = String(valor);

  // Neutraliza la fórmula ANTES de decidir si hace falta entrecomillar
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;

  if (/[",\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/** Filas → texto CSV con cabecera. */
export function aCSV(filas) {
  const cabecera = COLUMNAS_CSV.map(c => escaparCSV(c.titulo)).join(',');
  const cuerpo = filas.map(fila =>
    COLUMNAS_CSV.map(columna => escaparCSV(fila[columna.campo])).join(',')
  );
  // CRLF: es lo que dice el RFC y lo que menos sorpresas da en Excel
  return [cabecera, ...cuerpo].join('\r\n');
}

/** Estructura completa, con metadatos de la exportación. */
export function aJSON(filas, meta = {}) {
  return JSON.stringify(
    {
      exportadoEn: meta.exportadoEn ?? null,
      total: filas.length,
      filtrado: meta.filtrado ?? null,
      resultados: filas,
    },
    null,
    2
  );
}

/**
 * Lista plana para gestores de descargas: una URL por línea y nada más.
 *
 * Ni cabecera ni comentarios: los gestores de descargas tragan el fichero
 * entero y una línea que no sea una URL acaba como una descarga fallida.
 */
export function aListaDeDescarga(filas) {
  return filas.map(fila => fila.url).join('\n');
}

/**
 * Construye las filas exportables a partir de lo que la lista ya tiene.
 *
 * `urls` son las visibles (ya filtradas). `info(url)` devuelve los metadatos
 * y `grupoDe(url)` el grupo de duplicados si lo hay.
 */
export function construirFilas(urls, { info, grupoDe } = {}) {
  return urls.map((url, indice) => {
    const datos = info?.(url) || null;
    const grupo = grupoDe?.(url) || null;

    return {
      numero: indice + 1,
      url,
      duracion: datos?.duration ?? '',
      duracionSegundos: Number.isFinite(datos?.durationSeconds) ? datos.durationSeconds : '',
      peso: datos?.size ?? '',
      pesoBytes: Number.isFinite(datos?.sizeBytes) ? datos.sizeBytes : '',
      pesoAproximado: datos?.size ? (datos.sizeApproximate === true ? 'si' : 'no') : '',
      paginaOrigen: datos?.sourceUrl ?? '',
      // Se exporta el estado, no solo el dato: un fichero sin verificar puede
      // ser un anuncio o una vista previa, y quien abra el CSV tiene que
      // poder distinguirlo igual que lo distingue en pantalla.
      verificado: datos?.suspect === true ? 'no' : 'si',
      motivoSinVerificar: datos?.suspectReason ?? '',
      grupoDuplicados: grupo?.representante ?? '',
      duplicadosAgrupados: grupo ? Math.max(0, grupo.miembros.length - 1) : '',
    };
  });
}
