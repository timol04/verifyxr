// Tests für das APA-Modul gegen fixtures/apa.docx (scripts/make-fixture-apa.py) und reine Regex-Fälle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDocx } from '../src/lib/docx-parser.js';
import { checkApa, extractCitations, parseReference } from '../src/lib/apa.js';

const cite = (t) => extractCitations(t).map((c) => `${c.surnames.join('+')}${c.etAl ? '*' : ''}|${c.year}${c.suffix}|${c.kind[0]}`);

test('Alle geforderten Zitationsformen werden erkannt', () => {
  assert.deepEqual(cite('(Meier, 2020)'), ['Meier|2020|p']);
  assert.deepEqual(cite('(Meier & Huber, 2020)'), ['Meier+Huber|2020|p']);
  assert.deepEqual(cite('(Meier, Huber & Müller, 2020)'), ['Meier+Huber+Müller|2020|p']);
  assert.deepEqual(cite('(Meier et al., 2020)'), ['Meier*|2020|p']);
  assert.deepEqual(cite('(Meier, 2020; Huber, 2021)'), ['Meier|2020|p', 'Huber|2021|p']);
  assert.deepEqual(cite('Meier (2020) zeigt, dass'), ['Meier|2020|n']);
  assert.deepEqual(cite('(Meier, 2020a)'), ['Meier|2020a|p']);
  assert.deepEqual(cite('Meier und Huber (2020) zeigen'), ['Meier+Huber|2020|n']);
  assert.deepEqual(cite('(vgl. Meier, 2020, S. 14)'), ['Meier|2020|p']);
  assert.deepEqual(cite('(Meier, 2020a, 2020b)'), ['Meier|2020a|p', 'Meier|2020b|p']);
  assert.deepEqual(cite('(van der Berg, 2019)'), ['van der Berg|2019|p']);
});

test('Keine Zitationen in gewöhnlichen Klammern', () => {
  assert.deepEqual(cite('Das war (siehe Abbildung 1) und (n = 20) sowie (2020).'), []);
});

test('Literaturverzeichnis-Einträge werden zerlegt', () => {
  const r = parseReference('Müller, C., Schmid, D., & Keller, E. (2019). Stress and coping.');
  assert.deepEqual([r.surnames, r.year], [['Müller', 'Schmid', 'Keller'], '2019']);
  assert.equal(parseReference('Meier, A. (2020a). Titel.').suffix, 'a');
});

const doc = await parseDocx(await readFile(new URL('../fixtures/apa.docx', import.meta.url)));
const apa = checkApa(doc);
const by = (id) => apa.find((c) => c.id === id);

test('Zitationen ohne passenden Eintrag', () => {
  const msgs = by('apa-citations').findings.map((f) => f.message);
  assert.equal(by('apa-citations').status, 'fail');
  assert.ok(msgs.some((m) => m.includes('Kein Eintrag') && m.includes('Schulz')));
  assert.ok(msgs.some((m) => m.includes('Jahr passt nicht') && m.includes('Keller')));
  assert.ok(msgs.some((m) => m.includes('Jahreszusatz') && m.includes('2020b')));
  assert.equal(msgs.length, 3);
});

test('Ungenutzte Einträge', () => {
  const f = by('apa-unused').findings;
  assert.equal(f.length, 1);
  assert.ok(f[0].message.includes('Huber (2022)'));
});

test('Verzeichnis-Formatierung: kursiv, DOI, Title Case', () => {
  const msgs = by('apa-format').findings.map((f) => f.message);
  assert.ok(msgs.some((m) => m.includes('nicht kursiv') && m.includes('Psychology Today')));
  assert.ok(msgs.some((m) => m.includes('DOI nicht im APA-7-Format')));
  assert.ok(msgs.some((m) => m.includes('Title Case')));
  assert.equal(msgs.length, 3, msgs.join(' | ')); // korrekte Einträge und deutsches Buch ohne Befund
});
