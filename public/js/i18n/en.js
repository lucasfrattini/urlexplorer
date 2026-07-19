/**
 * English dictionary.
 *
 * Must contain EXACTLY the same keys as `es.js` — there is a test that fails
 * otherwise, because a forgotten translation raises no error at runtime: the
 * string simply shows up in the other language and the selector looks broken.
 *
 * Note: some strings deliberately contain `{q}` and `{page}`. Those are the
 * URL templates the user types, not interpolation slots, and they survive
 * because `t()` leaves unknown placeholders untouched. There is a test.
 */
export const en = {
  /* ── Header and navigation ─────────────────────────────────────── */
  'app.subtitulo': "Explore a site's links and resources",
  'app.saltar': 'Skip to content',
  'nav.aria': 'Tools',
  'nav.explorador': 'Explorer',
  'nav.videos': 'Videos',
  'tema.cambiar': 'Switch theme',
  'tema.actual': 'Theme: {modo}',
  'tema.modo.system': 'system',
  'tema.modo.light': 'light',
  'tema.modo.dark': 'dark',
  'idioma.aria': 'Language',
  'idioma.es': 'Spanish',
  'idioma.en': 'English',
  'idioma.cambiado': 'Language: English',

  /* ── Service status ────────────────────────────────────────────── */
  'salud.comprobando': 'Checking service…',
  'salud.activo': 'Service up · browser {estado} · max. {paginas} pages per search',
  'salud.navegador.disponible': 'available',
  'salud.navegador.desactivado': 'disabled',
  'salud.error': 'Could not reach the server. Falling back to the default limits.',

  /* ── Network errors ────────────────────────────────────────────── */
  'api.sinConexion': 'Could not reach the server: {mensaje}',
  'api.errorHttp': 'Error {status}',
  'api.sseCaida': 'Lost the connection to the server during the search.',

  /* ── Clipboard ─────────────────────────────────────────────────── */
  'copiar.estaUrl': 'Copy this URL',
  'copiar.urlCopiada': 'URL copied',
  'copiar.fallo': 'Could not copy',

  /* ── Admin mode ────────────────────────────────────────────────── */
  'admin.contrasena': 'Password:',
  'admin.desbloqueadas': 'Saved setups unlocked',
  'admin.bloqueadas': 'Saved setups locked',
  'admin.incorrecta': 'Wrong password',
  'admin.demasiados': 'Too many attempts. Wait a minute.',

  /* ── Saved setups bar ──────────────────────────────────────────── */
  'perfiles.etiqueta': 'Setup',
  'perfiles.aria': 'Saved setups',
  'perfiles.elige': '— Pick a saved setup —',
  'perfiles.guardar': 'Save',
  'perfiles.borrar': 'Delete',
  'perfiles.copiarEnlace': 'Copy link',
  'perfiles.copiarEnlace.title': 'Copies a link that opens the app with this setup',
  'perfiles.enlaceCopiado': 'Link copied to the clipboard',
  'perfiles.cargada': 'Setup “{nombre}” loaded',
  'perfiles.nombrePrompt': 'Name for this setup:',
  'perfiles.nombreVacio': 'The name cannot be empty',
  'perfiles.guardado': '“{nombre}” saved',
  'perfiles.confirmarBorrado': 'Delete the setup “{nombre}”?',
  'perfiles.borrado': '“{nombre}” deleted',
  'perfiles.noGuardado': 'Could not save: {mensaje}',
  'perfiles.noCargadas': 'Could not load the saved setups: {mensaje}',

  /* ── Progress ──────────────────────────────────────────────────── */
  'progreso.fase1': '1 · Walk the pages',
  'progreso.fase2': '2 · Look for files',
  'progreso.enEspera': 'Waiting',
  'progreso.cancelar': 'Cancel',
  'progreso.ficherosAria': 'Files found',
  'progreso.descargando': 'Downloading the first page…',
  'progreso.paginaDe': 'Page {actual} of {total} · {enlaces} links',
  'progreso.topeAlcanzado': ' (limit reached)',
  'progreso.resumenFase1.uno': '{enlaces} links across {n} page{sufijo}',
  'progreso.resumenFase1.varios': '{enlaces} links across {n} pages{sufijo}',
  'progreso.analizando': 'Scanning {total} pages…',
  'progreso.deTotal': '{actual} of {total} · {url}',
  'progreso.hallados.uno': '{n} file found',
  'progreso.hallados.varios': '{n} files found',
  'progreso.cancelada': 'Search cancelled',

  /* ── Range filters ─────────────────────────────────────────────── */
  'rango.minimo': '{label}, minimum',
  'rango.maximo': '{label}, maximum',
  'rango.sinDatos': 'no data',

  /* ── Result list ───────────────────────────────────────────────── */
  'resultados.titulo': 'Results',
  'resultados.cero': '0 results',
  'resultados.total.uno': '{n} result',
  'resultados.total.varios': '{n} results',
  'resultados.mostrando': 'showing {visibles} of {total}',
  'resultados.plegados': '{n} collapsed as duplicates',
  'resultados.copiar': 'Copy',
  'resultados.descargar': 'Download .txt',
  'resultados.copiados': '{n} links copied',
  'resultados.noCopiado': 'Could not copy to the clipboard',
  'resultados.descargados': '{n} links downloaded',
  'resultados.csv': 'CSV',
  'resultados.json': 'JSON',
  'resultados.lista': 'List',
  'resultados.lista.title': 'One URL per line, to paste into a download manager',
  'resultados.exportados': '{n} results exported as {formato}',
  'resultados.ocultar': 'Remove this result',
  'resultados.deshacer': 'Undo',
  'resultados.deshacer.title': 'Brings back the last ones you removed',
  'resultados.restaurar': 'Restore removed ({n})',
  'resultados.restaurar.title': 'Brings back every result you have removed',
  'resultados.ocultados': '{n} removed',
  'resultados.sinCoincidencias': 'No matches',
  'resultados.sinCoincidencias.texto':
    'No result passes the current filters. Try widening the ranges or turning the switches off.',
  'resultados.noObtenido': 'Could not determine {dato}',
  'resultados.dudoso': '⚠ unverified',
  'resultados.dudoso.title': 'Could not confirm that this file belongs to its page.',
  'resultados.dudoso.titleMotivo':
    '{motivo}. Its duration is hidden because the one on the page belongs to another video.',
  'resultados.duplicados.title': '{n} more result(s) grouped here by {motivo}: {miembros}',
  'resultados.duplicados.motivoPorDefecto': 'matching signals',
  'resultados.pesoAprox': 'Approximate size, taken from the site page',
  'resultados.pesoExacto': 'Exact size, reported by the server',
  'resultados.primeros': 'Showing the first {n} of {total}. Download the .txt to see them all.',

  'columnas.enlace': 'Link',
  'columnas.duracion': 'Length',
  'columnas.peso': 'Size',

  'filtros.buscar': 'Filter results…',
  'filtros.buscar.aria': 'Filter results',
  'filtros.excluir': 'Hide the ones containing… (240p, sample)',
  'filtros.excluir.aria': 'Hide results containing this text',
  'filtros.excluir.title': 'Separate several terms with commas',
  'filtros.ordenar.aria': 'Sort results',
  'filtros.orden.aparicion': 'Order found',
  'filtros.orden.duracion': 'Longest first',
  'filtros.orden.tamano': 'Largest first',
  'filtros.ocultarSinDuracion': 'Hide without length',
  'filtros.ocultarSinDuracion.title':
    'Removes results whose length could not be determined. The range slider on its own does NOT remove them.',
  'filtros.ocultarSinPeso': 'Hide without size',
  'filtros.ocultarSinPeso.title':
    'Removes results whose size could not be determined. The range slider on its own does NOT remove them.',
  'filtros.agrupar.uno': 'Group {n} duplicate',
  'filtros.agrupar.varios': 'Group {n} duplicates',
  'filtros.agrupar.title':
    'Groups results that look like the same content. Turn it off to see them all.',
  'filtros.modoDup.label': 'How to group duplicates',
  'filtros.modoDup.seguro': 'Safe duplicates (two signals)',
  'filtros.modoDup.duracion': 'Aggressive: by length only',
  'filtros.modoDup.aviso':
    'Aggressive mode: it groups EVERYTHING with the same length. Length does not identify a video, so two different videos of equal length will end up together. Nothing is deleted: expand the group or go back to safe mode to see them all.',
  'filtros.nota':
    'The ranges only trim among results that have the data. They leave the ones without it alone: to remove those, use the switches.',
  'filtros.sinPeso':
    'No result carries a size. You get it by turning on “Find out how big each file is” in the advanced settings, before exploring.',

  /* ── Explorer: header ──────────────────────────────────────────── */
  'explorer.titulo': 'Walk a site page by page',
  'explorer.subtitulo':
    'Goes through the pages of a section and returns whatever it finds. Three steps.',
  'explorer.vacio.titulo': 'No results yet',
  'explorer.vacio.texto': 'Fill in the three steps and press “Start exploring”.',

  /* ── Explorer: step 1 ──────────────────────────────────────────── */
  'explorer.paso1.titulo': 'Which page do you want to walk through?',
  'explorer.paso1.ayuda':
    'Go to page 2 on the site and copy that address: that shows how it numbers its pages.',
  'explorer.url.label': 'Which page do you want to walk through?',
  'explorer.url.hint':
    'Paste the address as it is. If you write {q} where the searched word would go and {page} where the page number goes, the site is saved once and you only change the word.',
  'explorer.url.placeholder': 'https://example.com/gallery?q=cats',
  'explorer.termino.label': 'Looking for a particular word? (optional)',
  'explorer.termino.hint':
    'It goes wherever the address has {q}. If the address has no {q}, this field does nothing.',
  'explorer.termino.placeholder': 'cats',

  /* ── Explorer: step 2 ──────────────────────────────────────────── */
  'explorer.paso2.titulo': 'What do you want to get?',
  'explorer.paso2.ayuda':
    'Links are always collected. Files require opening every link, and that takes a while.',
  'explorer.objetivo.enlaces': 'Just the list of links',
  'explorer.objetivo.enlaces.hint':
    'Walks the pages and gives you the addresses it finds. This is the fastest option.',
  'explorer.objetivo.ficheros': 'The files inside',
  'explorer.objetivo.ficheros.hint':
    'Also opens every link and looks for the files inside. Takes considerably longer.',
  'explorer.tipoArchivo': 'What kind of file?',
  'explorer.preset.video': 'Video',
  'explorer.preset.audio': 'Audio',
  'explorer.preset.imagen': 'Images',
  'explorer.preset.otro': '+ Other',
  'explorer.preset.otro.title': 'Type the extensions by hand',
  'explorer.extensiones.label': 'Extensions to look for, comma separated',
  'explorer.extensiones.hint': 'With the leading dot. For example: .pdf, .zip',

  /* ── Explorer: step 3 ──────────────────────────────────────────── */
  'explorer.paso3.titulo': 'All set',
  'explorer.explorar': 'Start exploring',
  'explorer.explorando': 'Exploring…',
  'explorer.detectar': 'Set it up for me',
  'explorer.detectar.title':
    'Opens the address, analyses it and fills in the form. It is always a suggestion: review it.',
  'explorer.analizando': 'Analysing…',
  'explorer.limpiar': 'Clear',

  /* ── Explorer: advanced settings ───────────────────────────────── */
  'explorer.avanzados': 'Advanced settings (optional)',
  'explorer.modo.pregunta': 'How does the site move between pages?',
  'explorer.modo.auto': 'Detect automatically (recommended)',
  'explorer.modo.auto.hint':
    'Works for almost every site: uses whatever the address already carries.',
  'explorer.modo.manual': 'Set the patterns by hand',
  'explorer.modo.manual.hint':
    'To say exactly which links to follow and how the site numbers its pages.',
  'explorer.modo.scroll': 'Infinite scroll',
  'explorer.modo.scroll.hint':
    'For sites with no page buttons that load more results as you scroll down. Here “up to” counts loads, not pages.',
  'explorer.modo.resumen':
    'You are still using {que}. Press “Set the patterns by hand” to see or change them.',
  'explorer.modo.resumen.enlaces': 'links “{valor}”',
  'explorer.modo.resumen.parametro': 'parameter “{valor}”',
  'explorer.modo.resumen.y': ' and ',
  'explorer.patron.label': 'Which links to follow? (link pattern)',
  'explorer.patron.hint':
    'Empty = all of them. “/videos/” keeps the ones containing it. Between slashes and with some symbol it is a regular expression: /\\/videos\\/\\d+/ only takes the numbered pages.',
  'explorer.parametro.label': 'How does it number the pages? (parameter name)',
  'explorer.parametro.hint':
    'Just the name, for example “page”. If the number goes inside the address, leave this empty: write {page} in the starting address instead.',
  'explorer.desde.label': 'From page',
  'explorer.hasta.label': 'Up to which page?',
  'explorer.hasta.hint': 'At most {max} pages at a time.',
  'explorer.rapidez.label': 'How fast? (pages at a time)',
  'explorer.rapidez.hint':
    'Between 1 and {max}. The higher it is, the sooner it finishes and the more it loads the site. Default is {defecto}.',
  'explorer.navegador.label': 'Open with a browser',
  'explorer.navegador.hint':
    'Opens every page the way a real browser would, running its JavaScript. Needed when the site shows nothing without it. Much slower: count several seconds per link.',
  'explorer.peso.label': 'Find out how big each file is',
  'explorer.peso.hint':
    'Asks for the size of every file without downloading it. Lets you sort by size and tell a full video from a preview clip. Slower.',
  'explorer.miniaturas.label': 'Fetch a thumbnail for each result',
  'explorer.miniaturas.hint':
    'Requests a preview image per page. THIS server downloads and serves them, not your browser: the explored sites never see your connection. Slower, and it makes more requests to the site.',
  'explorer.licencia.label': 'Only openly licensed material',
  'explorer.licencia.hint':
    'Keeps only the pages that declare an open licence (Creative Commons, public domain, CC0…). Anything without a declared licence is dropped: by default a work is born with all rights reserved, so the absence of a licence does not mean it is free.',

  /* ── Explorer: pagination examples ─────────────────────────────── */
  'ejemplos.titulo': 'Go to page 2 on the site and look at what changes in its address:',
  'ejemplos.campo.parametro': 'Parameter name',
  'ejemplos.campo.url': 'Starting address',

  /* ── Explorer: stats ───────────────────────────────────────────── */
  'stats.enlaces': 'Links',
  'stats.paginas': 'Pages walked',
  'stats.ficheros': 'Files',
  'stats.duracion': 'Took',
  'stats.fallidas': 'Failed pages',

  /* ── Explorer: suggested setup ─────────────────────────────────── */
  'propuesta.titulo': 'Here is what I suggest',
  'propuesta.hint':
    'It is a suggestion, not the truth: review it and fix whatever does not fit. {conNavegador} links were analysed with a browser and {sinNavegador} without one.',
  'propuesta.campo.patron': 'Which links to follow?',
  'propuesta.campo.paginacion': 'How it moves between pages',
  'propuesta.campo.navegador': 'Open with a browser',
  'propuesta.campo.extensiones': 'What to get',
  'propuesta.campo.alternativo': 'Alternative pattern',
  'propuesta.alternativo.motivo':
    'Broader than the suggested one. Use it if the suggested one leaves out results you did want.',
  'propuesta.vacio': '(empty)',
  'propuesta.si': 'yes',
  'propuesta.no': 'no',
  'propuesta.parametro': 'parameter “{valor}”',
  'propuesta.confianza': '{nivel} confidence',
  'propuesta.aviso': 'Worth knowing',
  'propuesta.lista': 'Suggestion ready: review it before exploring',
  'propuesta.fallo': 'Could not analyse the page',

  /* ── Explorer: validation and alerts ───────────────────────────── */
  'error.faltaUrl': 'The address is missing',
  'error.faltaUrl.detectar': 'In step 1, write the address of the page you want to analyse.',
  'error.faltaUrl.explorar': 'In step 1, write the page you want to start from.',
  'error.urlInvalida': 'Invalid address',
  'error.urlInvalida.body': 'The address must start with http:// or https://',
  'error.faltaTermino': 'The word to search for is missing',
  'error.faltaTermino.body':
    'The starting address contains {q}, so you have to say what to search for in “Looking for a particular word?”.',
  'error.faltaParametro': 'You have not said how it numbers the pages',
  'error.faltaParametro.body':
    'You asked for pages {desde} to {hasta}, but without knowing how the site moves between pages only one will be downloaded. Open “Advanced settings”, pick “Set the patterns by hand” and write the parameter name (for example “page”), or put {page} in the starting address.',
  'error.rangoInvalido': 'Invalid page range',
  'error.rangoInvalido.body': 'The last page cannot be lower than the first one.',
  'error.rangoGrande': 'Page range too large',
  'error.rangoGrande.body':
    'You asked for {pedidas} pages and the maximum per search is {max}. Lower “Up to which page?” to {sugerido} or less.',
  'error.busquedaFallo': 'The search failed',

  'aviso.scrollCortado': 'Scrolling stopped before the listing ran out',
  'aviso.scrollCortado.body':
    'After {cargas} loads, {motivo}. The site very likely had more results: the ones you see are incomplete. Raise “Up to which page?” to ask for more loads, or narrow the link pattern to bring fewer per load.',
  'aviso.tope.rondas': 'the maximum number of loads was reached',
  'aviso.tope.elementos': 'the element limit was reached',
  'aviso.tope.tiempo': 'the scrolling time ran out',
  'aviso.tope.navegador': 'the browser stopped responding',

  'aviso.patronSinCasar': 'The link pattern left every link out',
  'aviso.patronSinCasar.body':
    '{vistos} links were found across the pages walked and NONE match “{patron}”. Try one of the most frequent ones: {pistas}. Or leave it empty to collect them all.',
  'aviso.patronSinCasar.sinPistas':
    '{vistos} links were found across the pages walked and NONE match “{patron}”. Try leaving the pattern empty to see what the page brings.',
  'aviso.bloqueo': 'The site may be blocking automated requests',
  'aviso.bloqueo.body':
    'This is a suspicion, not a certainty: {motivos}. If results come back empty or partial, try turning on “Open with a browser” in the advanced settings, and lowering the speed.',

  'aviso.soloEnlaces': 'Only links were collected, not files',
  'aviso.soloEnlaces.body':
    'Step 2 has “Just the list of links” selected, so no link was opened. Pick “The files inside”, choose the type you are after and explore again.',

  'aviso.sinVerificar': '{n} unverified file(s)',
  'aviso.sinVerificar.body':
    'It could not be confirmed that they belong to their page: they may be ads or previews. They are flagged and shown WITHOUT a length, because the page length belongs to another video. Check them before downloading.',
  'aviso.descartados': '{n} file(s) dropped for not belonging to their page',
  'aviso.descartados.body':
    'They were ads or previews of the related videos. The ones you see do share an identifier with the page they came from.',

  'aviso.truncado': 'Results truncated',
  'aviso.truncado.body':
    'The application limit was reached ({enlaces} links / {ficheros} files). Narrow the link pattern or the page range to get fewer results.',

  'aviso.licencia': '{n} pages dropped over licensing',
  'aviso.licencia.body':
    'They did not declare an open licence, so they were skipped. Remember that the absence of a licence means “all rights reserved”, not “free”.',

  'aviso.tiempoAgotado': 'The time limit ran out',
  'aviso.tiempoAgotado.body':
    'The run went over {minutos} minutes and stopped, so the results are incomplete. With “Open with a browser” every link takes several seconds: reduce the page range or narrow the link pattern to check fewer links.',

  'aviso.sinFicheros': 'Links were found but no files',
  'aviso.sinFicheros.conNavegador':
    '{n} pages were checked with a browser without finding files of that type. The links may not be detail pages (redirects to other sites, for instance) or the file may be requested through an API that leaves no trace in the HTML.',
  'aviso.sinFicheros.sinNavegador':
    '{n} pages were checked without finding files of that type. Try turning on “Open with a browser” in the advanced settings: it now also applies when opening each link.',

  /* ── Video view ────────────────────────────────────────────────── */
  'video.titulo': 'Pull the videos out of a page',
  'video.subtitulo':
    'Paste an address and it tells you what videos are on it and how it found them.',
  'video.url.label': 'Which page do you want to pull videos from?',
  'video.url.hint':
    'A single page is inspected, and in four ways: what shows up after loading it, what it requests over the network, embedded players, and addresses hidden in its code.',
  'video.url.placeholder': 'https://example.com/video/12345',
  'video.faltaUrl.body': 'Paste the address of the page you want to analyse.',
  'video.navegador.label': 'Open with a browser',
  'video.navegador.hint':
    'Opens the page the way a real browser would and watches what it requests. Finds videos that are not written in the page.',
  'video.peso.label': 'Find out how big each file is',
  'video.peso.hint': 'Asks for the size of every video without downloading it. Slower.',
  'video.analizar': 'Analyse',
  'video.analizando': 'Analysing…',
  'video.stats.videos': 'Videos',
  'video.stats.formatos': 'Formats',
  'video.stats.vias': 'Ways with results',
  'video.sinNavegador': 'The browser could not be used',
  'video.sinNavegador.body':
    'Only the HTML was analysed. Videos loaded by JavaScript may not show up.',
  'video.vacio.titulo': 'No videos yet',
  'video.vacio.texto': 'Paste the address of a page and press “Analyse”.',
  'video.sinResultados.titulo': 'No videos found',
  'video.sinResultados.texto':
    'Try turning on “Open with a browser”: many sites do not show the player until the page is really opened.',
  'video.detectadoPor': 'Found via: {via}',
  'video.desconocido': 'unknown',
  'video.todos': 'All ({n})',
  'video.abrir': 'Open',
  'video.descargar': 'Download .txt',
  'video.descargadas': '{n} URLs downloaded',
  'video.fallo': 'Could not analyse the page',
};
