import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../src/lib/backup.js';
import { generateKey } from '../src/lib/license.js';
import { PRESETS } from '../src/lib/presets.js';

const rules = { ...PRESETS.standard.rules, ignoreSpecial: true };
const make = (o) => JSON.stringify({ app: 'formacheck', version: 1, ...o });

test('Gültige Sicherung wird gelesen', () => {
  const key = generateKey();
  const r = parseBackup(make({ license: key, profiles: [{ name: ' Uni Basel ', rules }] }));
  assert.equal(r.license, key);
  assert.deepEqual(r.profiles.map((p) => p.name), ['Uni Basel']);
  assert.equal(r.skipped, 0);
});

test('Ungültige Lizenz und kaputte Profile werden übersprungen, nicht übernommen', () => {
  const r = parseBackup(make({ license: 'FMCK-AAAA-BBBB-CCCC', profiles: [{ name: 'x', rules: { font: 1 } }, { rules }, null] }));
  assert.equal(r.license, null);
  assert.equal(r.profiles.length, 0);
  assert.equal(r.skipped, 4);
});

test('Fremde oder defekte Dateien werfen verständliche Fehler', () => {
  assert.throws(() => parseBackup('kein json'), /kein JSON/);
  assert.throws(() => parseBackup('{"app":"anderes"}'), /keine FormaCheck-Sicherung/);
  assert.throws(() => parseBackup(make({ version: 9 })), /Sicherungsversion/);
});
