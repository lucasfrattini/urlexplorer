'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateUrlShape,
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6,
} = require('../src/lib/ssrf');

/** Comprueba que validar `url` lanza con el código esperado. */
function assertBlocked(url, expectedCode) {
  assert.throws(
    () => validateUrlShape(url),
    error => {
      assert.equal(error.code, expectedCode, `código inesperado para ${url}: ${error.code}`);
      return true;
    },
    `${url} debería estar bloqueada`
  );
}

test('isPrivateIPv4', async t => {
  await t.test('bloquea los rangos privados y especiales', () => {
    const blocked = [
      '127.0.0.1', // loopback
      '127.1.1.1',
      '10.0.0.1', // privada
      '10.255.255.255',
      '172.16.0.1', // privada
      '172.31.255.255',
      '192.168.1.1', // privada
      '169.254.169.254', // link-local: metadatos de cloud
      '0.0.0.0',
      '100.64.0.1', // CGNAT
      '224.0.0.1', // multicast
      '255.255.255.255',
      '198.18.0.1', // benchmarking
    ];
    for (const ip of blocked) {
      assert.equal(isPrivateIPv4(ip), true, `${ip} debería bloquearse`);
    }
  });

  await t.test('permite direcciones públicas', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.0.1']) {
      assert.equal(isPrivateIPv4(ip), false, `${ip} debería permitirse`);
    }
  });

  await t.test('bloquea entradas malformadas', () => {
    assert.equal(isPrivateIPv4('999.1.1.1'), true);
    assert.equal(isPrivateIPv4('1.2.3'), true);
  });
});

test('isPrivateIPv6', async t => {
  await t.test('bloquea loopback, ULA, link-local y multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      assert.equal(isPrivateIPv6(ip), true, `${ip} debería bloquearse`);
    }
  });

  await t.test('bloquea IPv4 mapeadas a direcciones privadas', () => {
    assert.equal(isPrivateIPv6('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIPv6('::ffff:169.254.169.254'), true);
  });

  await t.test('permite direcciones públicas', () => {
    assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false);
  });
});

test('isPrivateAddress rechaza lo que no es una IP', () => {
  assert.equal(isPrivateAddress('no-soy-una-ip'), true);
  assert.equal(isPrivateAddress(''), true);
});

test('validateUrlShape', async t => {
  await t.test('acepta URLs públicas http y https', () => {
    assert.equal(validateUrlShape('https://ejemplo.com/a').hostname, 'ejemplo.com');
    assert.equal(validateUrlShape('http://ejemplo.com/a').hostname, 'ejemplo.com');
  });

  await t.test('bloquea protocolos que no son http(s)', () => {
    assertBlocked('file:///etc/passwd', 'PROTOCOL_NOT_ALLOWED');
    assertBlocked('ftp://sitio.com/x', 'PROTOCOL_NOT_ALLOWED');
    assertBlocked('gopher://sitio.com/x', 'PROTOCOL_NOT_ALLOWED');
  });

  await t.test('bloquea nombres locales', () => {
    assertBlocked('http://localhost:8080/', 'PRIVATE_ADDRESS_BLOCKED');
    assertBlocked('http://algo.localhost/', 'PRIVATE_ADDRESS_BLOCKED');
    assertBlocked('http://impresora.local/', 'PRIVATE_ADDRESS_BLOCKED');
  });

  await t.test('bloquea IPs literales privadas', () => {
    assertBlocked('http://127.0.0.1:3001/admin', 'PRIVATE_ADDRESS_BLOCKED');
    assertBlocked('http://10.0.0.5/', 'PRIVATE_ADDRESS_BLOCKED');
    assertBlocked('http://192.168.1.1/', 'PRIVATE_ADDRESS_BLOCKED');
    // El caso clásico: metadatos de instancia en AWS/GCP
    assertBlocked('http://169.254.169.254/latest/meta-data/', 'PRIVATE_ADDRESS_BLOCKED');
    assertBlocked('http://[::1]/', 'PRIVATE_ADDRESS_BLOCKED');
  });

  await t.test('rechaza entradas vacías o inválidas', () => {
    assertBlocked('', 'URL_REQUIRED');
    assertBlocked('   ', 'URL_REQUIRED');
    assertBlocked('no-es-una-url', 'URL_INVALID');
    assertBlocked(`https://ejemplo.com/${'a'.repeat(3000)}`, 'URL_TOO_LONG');
  });
});
