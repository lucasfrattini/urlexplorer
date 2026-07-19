# Extensiones por sitio

Cada sitio con particularidades que el motor genérico no cubre se resuelve con
un módulo aislado en este directorio, en vez de acumular casos particulares
dentro del núcleo. En cuanto una regla sirve a un solo sitio y vive en
`services/scraper.js`, deja de ser una funcionalidad y pasa a ser deuda con
nombre propio.

## ⚠️ Seguridad: una extensión es código, y cargarla es ejecutarlo

Este es el riesgo serio del diseño y condiciona todas las reglas de abajo.

- **Las extensiones son módulos LOCALES de este repositorio.** El cargador solo
  lee de este directorio, resuelto desde `__dirname`. No hay carga desde una
  URL, ni desde un directorio configurable por entorno, ni desde datos que
  vengan del usuario.
- **Añadir una extensión = añadir código revisado al repositorio**, con su
  commit y su revisión. No hay ningún camino desde el frontend, desde la API ni
  desde `data/` para introducir una.
- **Nunca se construye el nombre de un módulo a partir de una petición.** El
  cargador enumera el directorio y valida el nombre contra una lista blanca de
  caracteres; nada que llegue por HTTP decide qué se carga.

Si algún día hiciera falta que un usuario aporte reglas, la respuesta **no** es
relajar esto: sería un formato declarativo (JSON con selectores) interpretado
por el núcleo, no código ejecutable.

## Interfaz

Un módulo exporta un objeto con estos campos. Todos los métodos son opcionales
salvo `match`: una extensión puede resolver solo el listado, solo la extracción
de ficheros, o las dos cosas.

```js
module.exports = {
  // Identificador corto, en kebab-case. Obligatorio.
  name: 'mi-sitio',

  // Para qué sirve y por qué hizo falta. Obligatorio: sin esto, en seis meses
  // nadie sabe si se puede borrar.
  description: 'El listado se sirve por una API JSON, no en el HTML.',

  // ¿Se aplica a esta URL? Obligatorio. Recibe un objeto URL ya parseado.
  match(url) {
    return url.hostname.endsWith('ejemplo.com');
  },

  // Opcional. Devuelve los enlaces de una página del listado.
  // Si no se implementa, se usa el recorrido genérico.
  //   ctx: { fetchPage, extract, signal, page, searchUrl }
  async listar(pageUrl, ctx) {
    return ['https://...'];
  },

  // Opcional. Devuelve las URLs de fichero de una ficha.
  // Si no se implementa, se usa la extracción genérica por extensión.
  //   ctx: { baseUrl, extensions, extractFilesFromHtml }
  extraerFicheros(html, ctx) {
    return ['https://...'];
  },
};
```

Lo que devuelvan `listar` y `extraerFicheros` pasa por las mismas validaciones
que el resto: SSRF, topes de enlaces y de ficheros. Una extensión no puede
saltarse los límites del motor.

## Cómo añadir una

1. Crear `src/extensions/<nombre>.js` con la interfaz de arriba.
2. Escribir un test en `tests/extensions.test.js`.
3. Commit y revisión, como cualquier otro código.

No hay que registrarla en ningún sitio: el cargador enumera el directorio.

## Cuándo NO escribir una extensión

Casi siempre. Antes de escribirla, comprobar que no se resuelve con:

- Un patrón de enlace con expresión regular (`/\/videos\/\d+/`).
- El modo de paginación adecuado (parámetro, plantilla o scroll).
- Activar el navegador.

Una extensión es la última opción, no la primera. El propio análisis que
motivó esto concluía que cinco de ocho sitios encajaban en lo que el motor ya
sabía hacer.
