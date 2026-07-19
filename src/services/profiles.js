'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../config');
const { AppError } = require('../lib/errors');
const logger = require('../lib/logger');

/**
 * Perfiles de sitios guardados en el servidor.
 *
 * Antes vivían como una constante en `public/js/components/profiles.js`, es
 * decir: se servían a cualquiera que abriese la aplicación Y estaban en el
 * repositorio. Ahora viven en un fichero JSON fuera del control de versiones
 * al que solo se llega con el token de admin.
 *
 * El fichero puede no existir: una instalación nueva arranca sin perfiles y
 * eso es el comportamiento correcto, no un error.
 */

/** Campos que forman una configuración. Cualquier otro se descarta al guardar. */
const CONFIG_KEYS = [
  'searchUrl',
  'searchTerm',
  'linkPattern',
  'fileExtensions',
  'pageParam',
  'startPage',
  'endPage',
  'concurrency',
  'useJavaScript',
  'openLicenseOnly',
];

const MAX_NAME_LENGTH = 120;
const MAX_NOTE_LENGTH = 1000;
const MAX_VALUE_LENGTH = 2048;

/**
 * Normaliza un perfil recibido del cliente.
 *
 * Se hace en el servidor a propósito: ocultar el botón de guardar en el
 * frontend no es una defensa, así que lo que llega se valida aquí aunque el
 * cliente ya lo haya filtrado.
 */
function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  if (name === '') return null;

  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, MAX_NOTE_LENGTH) : '';

  // Ojo con el nombre: `config` a secas taparía la configuración global
  // importada arriba.
  const clean = {};
  const source = raw.config && typeof raw.config === 'object' ? raw.config : {};
  for (const key of CONFIG_KEYS) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') clean[key] = value;
    else clean[key] = String(value).slice(0, MAX_VALUE_LENGTH);
  }

  return note ? { name, note, config: clean } : { name, config: clean };
}

/** Lee los perfiles del disco. Fichero ausente ⇒ lista vacía. */
async function readProfiles() {
  let raw;
  try {
    raw = await fs.readFile(config.admin.profilesPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    logger.error('No se pudo leer el fichero de perfiles', { error: error.message });
    throw new AppError('No se pudieron leer los perfiles guardados', 500, 'PROFILES_READ_FAILED');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Un fichero corrupto no debe tumbar la aplicación, pero tampoco pasar
    // por "no hay perfiles": si se devolviera vacío, el siguiente guardado
    // sobreescribiría en silencio unos perfiles que sí existían.
    logger.error('El fichero de perfiles no es JSON válido', {
      path: config.admin.profilesPath,
    });
    throw new AppError(
      'El fichero de perfiles está corrupto. Revísalo o bórralo para empezar de cero.',
      500,
      'PROFILES_CORRUPT'
    );
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.profiles;
  if (!Array.isArray(list)) return [];

  return list.map(sanitizeProfile).filter(Boolean);
}

/**
 * Guarda los perfiles.
 *
 * Escritura atómica: se escribe un temporal y se renombra. Un corte a mitad
 * de escritura dejaría el JSON truncado, y con la lectura de arriba eso
 * bloquearía la aplicación entera hasta arreglarlo a mano.
 */
async function writeProfiles(rawProfiles) {
  if (!Array.isArray(rawProfiles)) {
    throw new AppError('Se esperaba una lista de perfiles', 400, 'INVALID_PROFILES');
  }

  const profiles = rawProfiles.map(sanitizeProfile).filter(Boolean);

  if (profiles.length > config.admin.maxProfiles) {
    throw new AppError(
      `Demasiados perfiles: el máximo es ${config.admin.maxProfiles}`,
      400,
      'TOO_MANY_PROFILES'
    );
  }

  const target = config.admin.profilesPath;
  const payload = JSON.stringify({ version: 1, profiles }, null, 2);

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, `${payload}\n`, 'utf8');
    await fs.rename(temp, target);
  } catch (error) {
    logger.error('No se pudo guardar el fichero de perfiles', { error: error.message });
    throw new AppError('No se pudieron guardar los perfiles', 500, 'PROFILES_WRITE_FAILED');
  }

  return profiles;
}

module.exports = { readProfiles, writeProfiles, sanitizeProfile, CONFIG_KEYS };
