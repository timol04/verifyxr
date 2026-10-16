import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKey, validateKey } from '../src/lib/license.js';

test('Erzeugte Schlüssel sind gültig und normalisieren Eingaben', () => {
  for (let i = 0; i < 200; i++) {
    const k = generateKey();
    assert.match(k, /^FMCK-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(validateKey(k), k);
    assert.equal(validateKey(` ${k.toLowerCase().replaceAll('-', '')} `), k);
  }
});

test('Ungültige Schlüssel werden abgelehnt', () => {
  const k = generateKey();
  const flipped = k.slice(0, -1) + (k.endsWith('A') ? 'B' : 'A'); // Prüfsumme kaputt
  assert.equal(validateKey(flipped), null);
  for (const bad of ['', null, 'FMCK-AAAA-BBBB-CCCC', 'XXXX-AAAA-BBBB-CCCC', 'FMCK-1111-0000-OOOO']) assert.equal(validateKey(bad), null);
});
