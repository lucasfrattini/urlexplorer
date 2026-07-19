'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const config = require('../config');
const { AppError } = require('./errors');

/**
 * Protección contra SSRF.
 *
 * Los endpoints aceptan una URL arbitraria del cliente y el servidor la pide.
 * Sin esto, cualquiera puede usar la app como proxy hacia la red interna:
 * http://169.254.169.254/ (metadatos de cloud), http://localhost:8080/,
 * http://10.0.0.1/, file:///etc/passwd...
 *
 * La validación es en dos pasos porque una sola no basta:
 *   1. Forma de la URL (protocolo, longitud, host literal, allowlist).
 *   2. Resolución DNS del host y comprobación de CADA IP devuelta, para que
 *      un dominio público que apunta a 127.0.0.1 no se cuele.
 */

/** Rangos IPv4 que nunca deben alcanzarse desde el scraper. */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformada: se bloquea por defecto
  }
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // privada
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (metadatos cloud)
  if (a === 172 && b >= 16 && b <= 31) return true; // privada
  if (a === 192 && b === 168) return true; // privada
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reservada + broadcast

  return false;
}

/** Rangos IPv6 equivalentes, incluidas las direcciones IPv4 mapeadas. */
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');

  if (normalized === '::' || normalized === '::1') return true; // unspecified / loopback

  // ::ffff:127.0.0.1 y compañía: se valida la parte IPv4 embebida
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (/^::ffff:/.test(normalized)) return true;

  if (/^f[cd]/.test(normalized)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 link-local
  if (/^ff/.test(normalized)) return true; // multicast
  if (/^2002:/.test(normalized)) return true; // 6to4
  if (/^64:ff9b:/.test(normalized)) return true; // NAT64

  return false;
}

function isPrivateAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // no es una IP: se bloquea
}

function hostMatchesAllowlist(hostname, allowedHosts) {
  return allowedHosts.some(entry => {
    const allowed = entry.toLowerCase().trim();
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1); // ".ejemplo.com"
      return hostname === allowed.slice(2) || hostname.endsWith(suffix);
    }
    return hostname === allowed;
  });
}

/** Validación sincrónica de forma. No hace red. */
function validateUrlShape(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new AppError('Se requiere una URL', 400, 'URL_REQUIRED');
  }
  if (rawUrl.length > config.security.maxUrlLength) {
    throw new AppError(
      `La URL excede el máximo de ${config.security.maxUrlLength} caracteres`,
      400,
      'URL_TOO_LONG'
    );
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AppError('La URL no tiene un formato válido', 400, 'URL_INVALID');
  }

  if (!config.security.allowedProtocols.includes(url.protocol)) {
    throw new AppError(
      `Protocolo no permitido: ${url.protocol} (solo ${config.security.allowedProtocols.join(', ')})`,
      400,
      'PROTOCOL_NOT_ALLOWED'
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new AppError('La URL no tiene host', 400, 'URL_NO_HOST');
  }

  const { allowedHosts } = config.security;
  if (allowedHosts.length > 0 && !hostMatchesAllowlist(hostname, allowedHosts)) {
    throw new AppError(`Host no permitido por la allowlist: ${hostname}`, 403, 'HOST_NOT_ALLOWED');
  }

  if (config.security.blockPrivateAddresses) {
    // Nombres locales que no llegan a resolverse como IP
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      throw new AppError('Acceso a direcciones locales bloqueado', 403, 'PRIVATE_ADDRESS_BLOCKED');
    }
    // Host que ya es una IP literal
    if (
      net.isIP(hostname.replace(/^\[|\]$/g, '')) &&
      isPrivateAddress(hostname.replace(/^\[|\]$/g, ''))
    ) {
      throw new AppError('Acceso a direcciones privadas bloqueado', 403, 'PRIVATE_ADDRESS_BLOCKED');
    }
  }

  return url;
}

/**
 * Validación completa: forma + resolución DNS.
 * Úsala antes de cualquier petición saliente.
 */
async function assertUrlIsSafe(rawUrl) {
  const url = validateUrlShape(rawUrl);

  if (!config.security.blockPrivateAddresses) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) return url; // ya validada como literal

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new AppError(`No se pudo resolver el host: ${hostname}`, 400, 'DNS_LOOKUP_FAILED');
  }

  if (addresses.length === 0) {
    throw new AppError(
      `El host no resolvió a ninguna dirección: ${hostname}`,
      400,
      'DNS_NO_ADDRESS'
    );
  }

  // Basta con que UNA de las IPs sea privada para rechazar: si no, un dominio
  // con registros mixtos permitiría alcanzar la red interna.
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new AppError(
        `El host ${hostname} resuelve a una dirección privada (${address})`,
        403,
        'PRIVATE_ADDRESS_BLOCKED'
      );
    }
  }

  return url;
}

/** Variante booleana, para filtrar listas de URLs sin romper el flujo. */
async function isUrlSafe(rawUrl) {
  try {
    await assertUrlIsSafe(rawUrl);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  assertUrlIsSafe,
  isUrlSafe,
  validateUrlShape,
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6,
};
