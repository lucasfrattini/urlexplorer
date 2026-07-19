'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Formatos de exportación.
 *
 * El escapado de CSV es lo que de verdad se prueba aquí: una URL con una coma
 * parte la fila y el fichero se lee mal SIN dar ningún error. La hoja de
 * cálculo se abre tan contenta, con las columnas corridas, y nadie se entera
 * hasta que los datos ya se usaron.
 */
const MODULO = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'exportFormats.js')).href;

let ex;
test.before(async () => {
  ex = await import(MODULO);
});

test('escaparCSV entrecomilla lo que rompería la fila', () => {
  const { escaparCSV } = ex;

  // Sin caracteres conflictivos: se deja tal cual
  assert.strictEqual(escaparCSV('https://ejemplo.com/v/1.mp4'), 'https://ejemplo.com/v/1.mp4');

  // LA COMA: el caso que parte la fila
  assert.strictEqual(
    escaparCSV('https://ejemplo.com/v/a,b.mp4'),
    '"https://ejemplo.com/v/a,b.mp4"'
  );

  // La comilla se duplica y el valor se entrecomilla
  assert.strictEqual(escaparCSV('dice "hola"'), '"dice ""hola"""');

  // Saltos de línea
  assert.strictEqual(escaparCSV('una\ndos'), '"una\ndos"');
  assert.strictEqual(escaparCSV('una\r\ndos'), '"una\r\ndos"');

  // Vacíos
  assert.strictEqual(escaparCSV(null), '');
  assert.strictEqual(escaparCSV(undefined), '');
  assert.strictEqual(escaparCSV(''), '');
  assert.strictEqual(escaparCSV(0), '0');
});

test('escaparCSV neutraliza fórmulas: los datos vienen de terceros', () => {
  const { escaparCSV } = ex;

  // Excel y LibreOffice interpretan esto como fórmula, no como texto
  assert.strictEqual(escaparCSV('=HYPERLINK("http://malo")'), '"\'=HYPERLINK(""http://malo"")"');
  assert.strictEqual(escaparCSV('+1+1'), "'+1+1");
  assert.strictEqual(escaparCSV('-2+3'), "'-2+3");
  assert.strictEqual(escaparCSV('@SUM(A1)'), "'@SUM(A1)");

  // Una URL normal no se toca
  assert.strictEqual(escaparCSV('https://ejemplo.com/a'), 'https://ejemplo.com/a');
});

test('una URL con coma NO corre las columnas', () => {
  const { aCSV, COLUMNAS_CSV } = ex;

  const csv = aCSV([
    { numero: 1, url: 'https://ejemplo.com/a,b,c.mp4', duracion: '1:00', peso: '1.0 MB' },
  ]);

  const lineas = csv.split('\r\n');
  assert.strictEqual(lineas.length, 2, 'cabecera + una fila');

  // Se parsea la fila respetando las comillas, como haría una hoja de cálculo
  const celdas = parsearLineaCSV(lineas[1]);
  assert.strictEqual(
    celdas.length,
    COLUMNAS_CSV.length,
    `la fila tiene ${celdas.length} celdas y debería tener ${COLUMNAS_CSV.length}`
  );
  assert.strictEqual(celdas[1], 'https://ejemplo.com/a,b,c.mp4', 'la URL llegó partida');
});

/** Parser mínimo de una línea CSV, para comprobar que lo escrito se relee. */
function parsearLineaCSV(linea) {
  const celdas = [];
  let actual = '';
  let dentroDeComillas = false;

  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (dentroDeComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else if (c === '"') {
        dentroDeComillas = false;
      } else {
        actual += c;
      }
    } else if (c === '"') {
      dentroDeComillas = true;
    } else if (c === ',') {
      celdas.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  celdas.push(actual);
  return celdas;
}

test('el CSV lleva cabecera y todas las columnas pedidas', () => {
  const { aCSV, COLUMNAS_CSV } = ex;
  const csv = aCSV([]);
  const cabecera = csv.split('\r\n')[0].split(',');

  assert.deepStrictEqual(
    cabecera,
    COLUMNAS_CSV.map(c => c.titulo)
  );
  // Lo que el encargo pedía explícitamente
  for (const obligatoria of [
    'url',
    'duracion',
    'peso',
    'pagina_origen',
    'verificado',
    'grupo_duplicados',
  ]) {
    assert.ok(cabecera.includes(obligatoria), `falta la columna ${obligatoria}`);
  }
});

test('construirFilas vuelca duración, peso, origen, estado y grupo', () => {
  const { construirFilas } = ex;

  const meta = new Map([
    [
      'https://ejemplo.com/a.mp4',
      {
        duration: '12:30',
        durationSeconds: 750,
        size: '700 MB',
        sizeBytes: 734003200,
        sizeApproximate: true,
        sourceUrl: 'https://ejemplo.com/ficha/1',
        suspect: false,
      },
    ],
    [
      'https://ejemplo.com/b.mp4',
      { suspect: true, suspectReason: 'puede ser una vista previa', sourceUrl: 'https://e.com/2' },
    ],
  ]);

  const grupos = new Map([
    [
      'https://ejemplo.com/a.mp4',
      {
        representante: 'https://ejemplo.com/a.mp4',
        miembros: ['https://ejemplo.com/a.mp4', 'https://ejemplo.com/otro.mp4'],
      },
    ],
  ]);

  const filas = construirFilas([...meta.keys()], {
    info: url => meta.get(url),
    grupoDe: url => grupos.get(url),
  });

  assert.strictEqual(filas[0].duracion, '12:30');
  assert.strictEqual(filas[0].duracionSegundos, 750);
  assert.strictEqual(filas[0].pesoBytes, 734003200);
  assert.strictEqual(filas[0].pesoAproximado, 'si');
  assert.strictEqual(filas[0].paginaOrigen, 'https://ejemplo.com/ficha/1');
  assert.strictEqual(filas[0].verificado, 'si');
  assert.strictEqual(filas[0].duplicadosAgrupados, 1);

  // El estado "sin verificar" se exporta: quien abra el CSV tiene que poder
  // distinguirlo igual que lo distingue en pantalla.
  assert.strictEqual(filas[1].verificado, 'no');
  assert.strictEqual(filas[1].motivoSinVerificar, 'puede ser una vista previa');
  assert.strictEqual(filas[1].duracion, '', 'sin dato debe ir vacío, no "undefined"');
});

test('el JSON es válido y lleva la estructura completa', () => {
  const { aJSON, construirFilas } = ex;

  const filas = construirFilas(['https://ejemplo.com/a.mp4'], {
    info: () => ({ duration: '1:00', durationSeconds: 60 }),
  });
  const objeto = JSON.parse(aJSON(filas, { filtrado: true, exportadoEn: '2026-01-01' }));

  assert.strictEqual(objeto.total, 1);
  assert.strictEqual(objeto.filtrado, true);
  assert.strictEqual(objeto.resultados[0].url, 'https://ejemplo.com/a.mp4');
  assert.strictEqual(objeto.resultados[0].duracionSegundos, 60);
});

test('la lista de descarga es solo URLs, sin cabecera ni comentarios', () => {
  const { aListaDeDescarga, construirFilas } = ex;

  const urls = ['https://ejemplo.com/a.mp4', 'https://ejemplo.com/b,c.mp4'];
  const lista = aListaDeDescarga(construirFilas(urls, {}));

  assert.deepStrictEqual(lista.split('\n'), urls);
  // Ni una línea que no sea una URL: un gestor de descargas se las traga
  // todas y una línea de más acaba como una descarga fallida.
  for (const linea of lista.split('\n')) {
    assert.match(linea, /^https?:\/\//);
  }
});
