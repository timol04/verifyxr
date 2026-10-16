// Test-Script (Schritt 2): entpackt eine .docx und gibt die rohen OOXML-Werte aus,
// inkl. Auflösung der Stil-Vererbung. Dient nur zur Verifikation der Struktur,
// nicht als Check-Logik. Aufruf: npm run inspect -- fixtures/beispiel.docx
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

const file = process.argv[2] ?? 'fixtures/beispiel.docx';
const zip = await JSZip.loadAsync(await readFile(file));

// Namespace-Präfix "w:" bleibt erhalten, Attribute bekommen "@_"-Präfix.
// Elemente, die mehrfach vorkommen können, immer als Array liefern.
const ARRAYS = new Set(['w:p', 'w:r', 'w:style', 'w:sectPr', 'w:t', 'w:tbl', 'w:tr', 'w:tc']);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ARRAYS.has(name),
});
const readXml = async (path) => {
  const f = zip.file(path);
  return f ? parser.parse(await f.async('string')) : null;
};

const doc = await readXml('word/document.xml');
const styles = await readXml('word/styles.xml');
const theme = await readXml('word/theme/theme1.xml'); // nur für Theme-Schriften (asciiTheme)

// ---------- Hilfen ----------
const twipToCm = (t) => +(t / 567).toFixed(2);
const halfPtToPt = (v) => v / 2;

/** Zeilenabstand: lineRule "auto" => line/240 = Vielfaches; "exact"/"atLeast" => line/20 = pt. */
function describeSpacing(sp) {
  if (!sp || sp['@_w:line'] === undefined) return undefined;
  const line = Number(sp['@_w:line']);
  const rule = sp['@_w:lineRule'] ?? 'auto'; // Default laut Spec: auto
  return rule === 'auto' ? `${line / 240}-fach (auto, line=${line})` : `${line / 20}pt (${rule}, line=${line})`;
}

// Stil-Lookup: styleId -> style-Objekt
const styleList = styles['w:styles']['w:style'];
const styleById = new Map(styleList.map((s) => [s['@_w:styleId'], s]));
const defaultParaStyle = styleList.find((s) => s['@_w:type'] === 'paragraph' && s['@_w:default'] === '1');

/** Kette Stil -> basedOn -> ... (am speziellsten zuerst). */
function styleChain(id) {
  const chain = [];
  const seen = new Set();
  for (let s = styleById.get(id); s && !seen.has(s['@_w:styleId']); s = styleById.get(s['w:basedOn']?.['@_w:val'])) {
    seen.add(s['@_w:styleId']);
    chain.push(s);
  }
  return chain;
}

/** Erster definierter Wert entlang einer Liste von Quellen { label, obj } (spezifischste zuerst). */
function firstDefined(sources, getter) {
  for (const { label, obj } of sources) {
    const v = obj && getter(obj);
    if (v !== undefined && v !== null) return { value: v, from: label };
  }
  return { value: undefined, from: '(nicht gesetzt)' };
}

// Theme-Schriften (z.B. majorHAnsi) stehen in word/theme/theme1.xml. Laut Spec überschreibt
// ein *Theme-Attribut das explizite w:ascii im selben rFonts-Element.
const themeFonts = theme?.['a:theme']?.['a:themeElements']?.['a:fontScheme'];
const themeFont = (name) => {
  const group = name.startsWith('major') ? themeFonts?.['a:majorFont'] : themeFonts?.['a:minorFont'];
  return group?.['a:latin']?.['@_typeface'];
};
const fontOf = (rPr) => {
  const f = rPr?.['w:rFonts'];
  if (!f) return undefined;
  if (f['@_w:asciiTheme']) return `${themeFont(f['@_w:asciiTheme'])} (Theme ${f['@_w:asciiTheme']}, überschreibt ascii="${f['@_w:ascii'] ?? '-'}")`;
  return f['@_w:ascii'];
};
const sizeOf = (rPr) => (rPr?.['w:sz'] ? halfPtToPt(Number(rPr['w:sz']['@_w:val'])) : undefined);

// ---------- Ausgabe ----------
console.log(`# Datei: ${file}`);
console.log('# ZIP-Inhalt:', Object.keys(zip.files).filter((n) => !zip.files[n].dir).join(', '));
console.log('\n## docDefaults (styles.xml)');
const dd = styles['w:styles']['w:docDefaults'];
const ddR = dd?.['w:rPrDefault']?.['w:rPr'];
const ddP = dd?.['w:pPrDefault']?.['w:pPr'];
console.log('  Schrift:', fontOf(ddR), '| Grösse:', sizeOf(ddR), 'pt | Zeilenabstand:', describeSpacing(ddP?.['w:spacing']));
console.log('  Default-Absatzstil:', defaultParaStyle?.['@_w:styleId']);
console.log('  Theme-Datei vorhanden:', !!theme);

console.log('\n## Relevante Stile (roh)');
for (const id of ['Normal', 'Heading1', 'Fliesstext']) {
  const s = styleById.get(id);
  if (!s) continue;
  console.log(`  ${id}: basedOn=${s['w:basedOn']?.['@_w:val'] ?? '-'}`,
    '| rPr:', JSON.stringify(s['w:rPr'] ?? null), '| pPr:', JSON.stringify(s['w:pPr'] ?? null));
}

console.log('\n## Absätze mit aufgelösten Werten');
const body = doc['w:document']['w:body'];
const paras = body['w:p'] ?? [];
paras.forEach((p, i) => {
  const pPr = p['w:pPr'];
  const text = (p['w:r'] ?? []).map((r) => (r['w:t'] ?? []).map((t) => (typeof t === 'object' ? t['#text'] : t)).join('')).join('');
  if (!text && !pPr?.['w:sectPr']) return;
  const styleId = pPr?.['w:pStyle']?.['@_w:val'] ?? defaultParaStyle?.['@_w:styleId'];
  const chain = styleChain(styleId);
  const pSources = [
    { label: 'direkt (pPr)', obj: pPr },
    ...chain.map((s) => ({ label: `Stil ${s['@_w:styleId']}`, obj: s['w:pPr'] })),
    { label: 'docDefaults', obj: ddP },
  ];
  const spacing = firstDefined(pSources, (o) => describeSpacing(o['w:spacing']));
  console.log(`\n[Absatz ${i}] "${text.slice(0, 60)}"  Stil=${styleId} (Kette: ${chain.map((s) => s['@_w:styleId']).join(' <- ')})`);
  if (pPr?.['w:sectPr']) console.log('  (enthält sectPr => Abschnittsende)');
  if (text) console.log(`  Zeilenabstand: ${spacing.value}  <- ${spacing.from}`);
  for (const r of p['w:r'] ?? []) {
    const rPr = r['w:rPr'];
    const rText = (r['w:t'] ?? []).map((t) => (typeof t === 'object' ? t['#text'] : t)).join('');
    if (!rText) continue;
    const rSources = [
      { label: 'direkt (rPr)', obj: rPr },
      ...chain.map((s) => ({ label: `Stil ${s['@_w:styleId']}`, obj: s['w:rPr'] })),
      { label: 'docDefaults', obj: ddR },
    ];
    const font = firstDefined(rSources, (o) => fontOf(o));
    const size = firstDefined(rSources, (o) => sizeOf(o));
    console.log(`  Run "${rText.slice(0, 30)}": Schrift=${font.value} <- ${font.from} | Grösse=${size.value}pt <- ${size.from}`);
  }
});

console.log('\n## Abschnitte / Seitenränder (w:sectPr)');
// Zwischen-Abschnitte stehen in w:p/w:pPr/w:sectPr, der letzte als Kind von w:body.
const sects = [
  ...paras.filter((p) => p['w:pPr']?.['w:sectPr']).map((p) => p['w:pPr']['w:sectPr']),
  ...(body['w:sectPr'] ?? []),
].flat();
sects.forEach((s, i) => {
  const m = s['w:pgMar'];
  const sz = s['w:pgSz'];
  console.log(`  Abschnitt ${i + 1}: oben=${twipToCm(m['@_w:top'])}cm unten=${twipToCm(m['@_w:bottom'])}cm links=${twipToCm(m['@_w:left'])}cm rechts=${twipToCm(m['@_w:right'])}cm`
    + ` | Seite ${sz ? `${twipToCm(sz['@_w:w'])}x${twipToCm(sz['@_w:h'])}cm` : '(pgSz fehlt)'} | roh:`, JSON.stringify(m));
});
