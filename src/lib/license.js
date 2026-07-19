'use strict';

const { asDocument, esDocumento } = require('./document');

/**
 * Detección de licencia declarada en una página.
 *
 * Criterio: solo se considera utilizable lo que el publicador declara de
 * forma explícita como abierto. La AUSENCIA de licencia no significa "libre":
 * por defecto una obra nace con todos los derechos reservados, así que sin
 * declaración se asume cerrado.
 */

/** Patrones de URL de licencias abiertas conocidas. */
const OPEN_LICENSE_URLS = [
  /creativecommons\.org\/licenses\/(by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\//i,
  /creativecommons\.org\/publicdomain\/(zero|mark)\//i,
  /opensource\.org\/licenses\//i,
  /spdx\.org\/licenses\//i,
  /gnu\.org\/licenses\//i,
];

/** Nombres de licencia abierta cuando se declaran como texto. */
const OPEN_LICENSE_NAMES = [
  /\bCC0\b/i,
  /\bCC[ -]BY(?:[ -](?:SA|ND|NC(?:[ -](?:SA|ND))?))?\b/i,
  /\bcreative\s+commons\b/i,
  /\bpublic\s+domain\b/i,
  /\bdominio\s+p[úu]blico\b/i,
  /\b(MIT|Apache|BSD|GPL|LGPL|MPL)\b/,
];

/** Licencias abiertas pero con cláusula de no comercial / no derivadas. */
const RESTRICTED_CLAUSE = /(nc|nd)(?:-|\/|$)/i;

function looksOpen(value) {
  if (!value) return false;
  if (OPEN_LICENSE_URLS.some(pattern => pattern.test(value))) return true;
  return OPEN_LICENSE_NAMES.some(pattern => pattern.test(value));
}

/** Recorre el JSON-LD buscando un campo `license` a cualquier profundidad. */
function findLicenseInJsonLd($) {
  const found = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    let data;
    try {
      data = JSON.parse($(element).contents().text());
    } catch {
      return;
    }

    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (/^licen[sc]e$/i.test(key)) {
          if (typeof value === 'string') found.push(value);
          else if (value && typeof value === 'object' && typeof value.url === 'string') {
            found.push(value.url);
          }
        } else if (typeof value === 'object') {
          walk(value);
        }
      }
    };

    walk(data);
  });

  return found;
}

/**
 * Extrae la licencia declarada de un HTML.
 *
 * @returns {{declared: boolean, isOpen: boolean, value: string|null,
 *            source: string|null, restricted: boolean}}
 */
function detectLicense(html) {
  // Acepta HTML sin parsear o un documento ya cargado; ver lib/document.js
  if (!esDocumento(html) && (typeof html !== 'string' || html.trim() === '')) {
    return { declared: false, isOpen: false, value: null, source: null, restricted: false };
  }

  const $ = asDocument(html);
  const candidates = [];

  const relLicense = $('link[rel="license"]').attr('href');
  if (relLicense) candidates.push({ value: relLicense, source: 'link[rel=license]' });

  const metaLicense =
    $('meta[name="license"]').attr('content') || $('meta[property="og:license"]').attr('content');
  if (metaLicense) candidates.push({ value: metaLicense, source: 'meta[license]' });

  const dcRights = $('meta[name="dc.rights"], meta[name="DC.rights"]').attr('content');
  if (dcRights) candidates.push({ value: dcRights, source: 'meta[dc.rights]' });

  for (const value of findLicenseInJsonLd($)) {
    candidates.push({ value, source: 'json-ld' });
  }

  // Enlace visible a Creative Commons: es como lo marcan Wikimedia, Flickr y
  // buena parte de los repositorios de material abierto.
  const ccAnchor = $(
    'a[href*="creativecommons.org/licenses"], a[href*="creativecommons.org/publicdomain"]'
  )
    .first()
    .attr('href');
  if (ccAnchor) candidates.push({ value: ccAnchor, source: 'enlace CC' });

  const open = candidates.find(candidate => looksOpen(candidate.value));
  if (open) {
    return {
      declared: true,
      isOpen: true,
      value: open.value,
      source: open.source,
      restricted: RESTRICTED_CLAUSE.test(open.value),
    };
  }

  if (candidates.length > 0) {
    // Hay declaración, pero no reconocida como abierta: se trata como cerrada
    return {
      declared: true,
      isOpen: false,
      value: candidates[0].value,
      source: candidates[0].source,
      restricted: false,
    };
  }

  return { declared: false, isOpen: false, value: null, source: null, restricted: false };
}

module.exports = { detectLicense, looksOpen };
