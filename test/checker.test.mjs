// Tests gegen fixtures/beispiel.docx (erzeugt mit scripts/make-fixture.py). Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDocx } from '../src/lib/docx-parser.js';
import { checkDocument } from '../src/lib/checker.js';
import { PRESETS } from '../src/lib/presets.js';

const doc = await parseDocx(await readFile(new URL('../fixtures/beispiel.docx', import.meta.url)));
const rules = { ...PRESETS.standard.rules, ignoreSpecial: true };
const byId = (r, id) => r.criteria.find((c) => c.id === id);

test('Parser löst Vererbung auf', () => {
  const p = (t) => doc.paragraphs.find((x) => x.text.startsWith(t));
  assert.deepEqual(p('Absatz im Stil Normal').lineSpacing, { kind: 'multiple', value: 1.5 });
  assert.deepEqual(p('Absatz im Stil Fliesstext').lineSpacing, { kind: 'multiple', value: 2 });
  assert.deepEqual(p('Absatz mit direkter').lineSpacing, { kind: 'multiple', value: 1 });
  assert.deepEqual(p('Absatz mit exaktem').lineSpacing, { kind: 'exact', value: 18 });
  assert.equal(p('Absatz mit direkter').items[0].font, 'Courier New');
  assert.equal(p('Absatz mit direkter').items[0].size, 10);
  assert.equal(p('Absatz im Stil Normal').items[0].font, 'Times New Roman');
  assert.equal(doc.paragraphs[0].special, true); // Heading 1
});

test('Abschnitte und Ränder', () => {
  assert.equal(doc.sections.length, 2);
  assert.deepEqual(doc.sections[0].margins, { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 });
  assert.equal(doc.sections[1].margins.left, 3);
  assert.equal(doc.paragraphs.at(-1).sectionIndex, 1);
});

test('Mehrere Runs im selben Absatz bleiben getrennt (Leerzeichen erhalten)', () => {
  const p = doc.paragraphs.find((x) => x.text.startsWith('Gemischt'));
  assert.equal(p.text, 'Gemischt: normal, gross (14pt) und wieder normal.');
  assert.deepEqual(p.items.map((i) => i.size), [12, 14, 12]);
});

test('Checker meldet erwartete Abweichungen', () => {
  const r = checkDocument(doc, rules);
  assert.notEqual(byId(r, 'font').status, 'ok');
  assert.ok(byId(r, 'font').findings.some((f) => f.message.includes('Courier New')));
  assert.ok(byId(r, 'size').findings.some((f) => f.message.includes('10 pt')));
  assert.ok(byId(r, 'size').findings.some((f) => f.message.includes('14 pt')));
  assert.equal(byId(r, 'spacing').findings.length, 3); // 2-fach, 1-fach, exakt 18pt
  assert.equal(byId(r, 'margins').findings.length, 2); // Abschnitt 2: links + rechts
  assert.equal(byId(r, 'words').status, 'skip');
});

test('Wortzahl-Grenzen und Seitenzahl', () => {
  const r = checkDocument(doc, { ...rules, maxWords: 10, minPages: 1 });
  assert.equal(byId(r, 'words').status, 'fail');
  assert.equal(doc.pages, 2);
  assert.equal(byId(r, 'pages').status, 'ok');
});

test('Passendes Dokument wird grün', () => {
  const r = checkDocument(doc, { ...rules, font: 'Times New Roman', marginsCm: { top: 2.5, bottom: 2.5, left: null, right: null } });
  assert.equal(byId(r, 'margins').status, 'ok');
});
