'use strict';

/**
 * Punto de entrada de URL Explorer.
 *
 * Toda la lógica vive en src/. Este fichero solo arranca el servidor y
 * gestiona el apagado ordenado.
 */

const config = require('./src/config');
const logger = require('./src/lib/logger');
const { createApp } = require('./src/app');
const { pool } = require('./src/lib/browser');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`URL Explorer escuchando en http://localhost:${config.port}`);
});

/** Apagado ordenado: cierra el servidor HTTP y el navegador del pool. */
async function shutdown(signal) {
  logger.info(`Recibido ${signal}, cerrando...`);

  const forceExit = setTimeout(() => {
    logger.warn('Cierre forzado tras el timeout');
    process.exit(1);
  }, 10000);
  forceExit.unref?.();

  server.close(() => logger.info('Servidor HTTP cerrado'));
  await pool.close().catch(error => logger.warn('Error cerrando el navegador', error.message));
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', reason => {
  logger.error('Promesa rechazada sin manejar', reason);
});

module.exports = { app, server };
