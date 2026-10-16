// .docx-Parser: entpackt das ZIP mit jszip und liest word/document.xml, word/styles.xml,
// word/theme/theme1.xml und docProps/app.xml. Läuft unverändert im Browser und in Node.
//
// Ergebnis (siehe parseDocx): flache Absatzliste mit aufgelösten Formatwerten, Abschnitte
// mit Seitenrändern, Wortzahl und Seitenzahl-Schätzung. Die Check-Logik liegt in checker.js.
//
// OOXML-Vererbung (verifiziert mit scripts/inspect-docx.mjs):
//   Run-Eigenschaften:   direkt (rPr) -> Zeichenstil -> Absatzstil-Kette (basedOn) -> docDefaults
//   Absatz-Eigenschaften: direkt (pPr) -> Absatzstil-Kette (basedOn) -> docDefaults
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

// preserveOrder: Reihenfolge von Absätzen/Tabellen/sectPr bleibt erhalten (wichtig für Abschnitte
// und Seitenumbrüche). trimValues:false, damit Leerzeichen in <w:t> nicht verloren gehen.
// parseTagValue/parseAttributeValue:false, damit z.B. "2020" ein String bleibt.
const xml = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

// ---------- kleine Helfer für das preserveOrder-Format ----------
// Ein Knoten sieht so aus: { 'w:p': [ ...Kinder ], ':@': { attribut: wert } }
const nameOf = (n) => { for (const k in n) if (k !== ':@') return k; };
const kids = (n) => n?.[nameOf(n)] ?? [];
const attrs = (n) => n?.[':@'] ?? {};
const child = (n, name) => kids(n).find((c) => nameOf(c) === name);
const val = (n, name) => attrs(child(n, name))['w:val'];

const TWIP_PER_CM = 567;
const twipsToCm = (t) => (t === undefined || t === '' ? undefined : Math.round((Number(t) / TWIP_PER_CM) * 100) / 100);

// Stile, die typischerweise bewusst anders formatiert sind (Überschriften, Verzeichnisse, Beschriftungen).
const SPECIAL_STYLE = /^(heading|title|subtitle|überschrift|titel|untertitel|toc|verzeichnis|inhaltsverzeichnis|caption|beschriftung|tableofcontents|header|footer|kopfzeile|fusszeile|fußzeile)/i;

export async function parseDocx(data) {
  const zip = await JSZip.loadAsync(data);
  const read = async (path) => {
    const f = zip.file(path);
    return f ? xml.parse(await f.async('string')) : null;
  };
  const [docXml, stylesXml, themeXml, appXml] = await Promise.all([
    read('word/document.xml'),
    read('word/styles.xml'),
    read('word/theme/theme1.xml'),
    zip.file('docProps/app.xml')?.async('string'),
  ]);
  if (!docXml) throw new Error('Keine gültige .docx-Datei (word/document.xml fehlt).');

  const styles = buildStyleResolver(stylesXml, themeXml);
  const body = child(docXml.find((n) => nameOf(n) === 'w:document'), 'w:body');
  if (!body) throw new Error('Das Dokument hat keinen Textkörper (w:body).');

  const paragraphs = [];
  const sections = [];
  collectBlocks(kids(body), { paragraphs, sections, styles, inTable: false });

  assignPages(paragraphs, sections);

  const words = paragraphs.reduce((sum, p) => sum + p.words, 0);
  const computedPages = paragraphs.reduce((m, p) => Math.max(m, p.page), 1);
  const appPages = Number(/<Pages>(\d+)<\/Pages>/.exec(appXml ?? '')?.[1]) || 0;

  return {
    paragraphs,
    sections,
    wordCount: words,
    pages: Math.max(appPages, computedPages),
    // Woher die Seitenzahl stammt, damit die UI Unsicherheit anzeigen kann.
    pagesSource: appPages >= computedPages && appPages > 0 ? 'app.xml' : paragraphs.some((p) => p.pageSource === 'lastRendered') ? 'lastRendered' : 'explicit',
  };
}

// ---------- Stil-Auflösung ----------
function buildStyleResolver(stylesXml, themeXml) {
  const root = stylesXml?.find((n) => nameOf(n) === 'w:styles');
  const list = kids(root).filter((n) => nameOf(n) === 'w:style');
  const byId = new Map(list.map((s) => [attrs(s)['w:styleId'], s]));
  const defaults = child(root, 'w:docDefaults');
  const rDef = child(child(defaults, 'w:rPrDefault'), 'w:rPr');
  const pDef = child(child(defaults, 'w:pPrDefault'), 'w:pPr');
  const defaultPara = list.find((s) => attrs(s)['w:type'] === 'paragraph' && attrs(s)['w:default'] === '1');

  // Theme-Schriften (asciiTheme="majorHAnsi" etc.) stehen in theme1.xml unter a:fontScheme.
  const fontScheme = child(child(themeXml?.find((n) => nameOf(n) === 'a:theme'), 'a:themeElements'), 'a:fontScheme');
  const themeFont = (themeName) => {
    const group = child(fontScheme, themeName.startsWith('major') ? 'a:majorFont' : 'a:minorFont');
    return attrs(child(group, 'a:latin'))['typeface'];
  };

  /** styleId -> [Stil, Basisstil, ...] (spezifischster zuerst, Zyklen abgesichert). */
  const chain = (id) => {
    const out = [];
    const seen = new Set();
    for (let s = byId.get(id); s && !seen.has(attrs(s)['w:styleId']); s = byId.get(val(s, 'w:basedOn'))) {
      seen.add(attrs(s)['w:styleId']);
      out.push(s);
    }
    return out;
  };

  return {
    chain,
    defaultParaStyleId: defaultPara ? attrs(defaultPara)['w:styleId'] : undefined,
    styleName: (id) => val(byId.get(id), 'w:name') ?? id,
    pDef,
    rDef,
    themeFont,
  };
}

/** Erster definierter Wert aus [direkt, Stil..., Defaults]; getter bekommt je ein pPr/rPr. */
const firstOf = (sources, getter) => {
  for (const src of sources) {
    const v = src && getter(src);
    if (v !== undefined) return v;
  }
  return undefined;
};

// ---------- Dokument durchlaufen ----------
function collectBlocks(nodes, ctx) {
  for (const node of nodes) {
    switch (nameOf(node)) {
      case 'w:p':
        ctx.paragraphs.push(readParagraph(node, ctx));
        break;
      case 'w:tbl': // Tabellen: Text zählt für die Wortzahl, wird aber nicht auf Fliesstext-Format geprüft
        for (const tr of kids(node).filter((n) => nameOf(n) === 'w:tr'))
          for (const tc of kids(tr).filter((n) => nameOf(n) === 'w:tc'))
            collectBlocks(kids(tc), { ...ctx, inTable: true });
        break;
      case 'w:sdt': // Inhaltssteuerelemente (z.B. Inhaltsverzeichnis) enthalten w:sdtContent
        collectBlocks(kids(child(node, 'w:sdtContent')), ctx);
        break;
      case 'w:sectPr': // letzter Abschnitt: sectPr direkt unter w:body
        ctx.sections.push(readSection(node, ctx.paragraphs.length));
        break;
    }
  }
}

function readSection(sectPr, endsAfterParagraph) {
  const m = attrs(child(sectPr, 'w:pgMar'));
  return {
    // sectPr beschreibt den Abschnitt, der VOR diesem Element endet; w:type gilt für dessen BEGINN.
    breakType: val(sectPr, 'w:type') ?? 'nextPage',
    endsAfterParagraph, // Index (exklusiv) in paragraphs
    margins: {
      top: twipsToCm(m['w:top']),
      bottom: twipsToCm(m['w:bottom']),
      left: twipsToCm(m['w:left']),
      right: twipsToCm(m['w:right']),
    },
  };
}

function readParagraph(p, ctx) {
  const { styles } = ctx;
  const pPr = child(p, 'w:pPr');
  const styleId = val(pPr, 'w:pStyle') ?? styles.defaultParaStyleId;
  const chain = styles.chain(styleId);
  const styleName = styles.styleName(styleId);

  // Zeilenabstand: line und lineRule werden einzeln vererbt.
  const pSources = [pPr, ...chain.map((s) => child(s, 'w:pPr')), styles.pDef];
  const spacingAttr = (name) => firstOf(pSources, (src) => attrs(child(src, 'w:spacing'))[name]);
  const line = Number(spacingAttr('w:line'));
  const rule = spacingAttr('w:lineRule') ?? 'auto'; // Spec-Default: auto
  const lineSpacing = Number.isFinite(line) && line > 0
    ? (rule === 'auto' ? { kind: 'multiple', value: round2(line / 240) } : { kind: rule, value: round2(line / 20) }) // exact/atLeast in pt
    : { kind: 'multiple', value: 1 }; // nichts definiert => einfach

  const para = {
    index: ctx.paragraphs.length,
    styleId,
    styleName,
    special: SPECIAL_STYLE.test(styleName) || SPECIAL_STYLE.test(styleId ?? '') || child(pPr, 'w:outlineLvl') !== undefined,
    inTable: ctx.inTable,
    pageBreakBefore: child(pPr, 'w:pageBreakBefore') !== undefined && val(pPr, 'w:pageBreakBefore') !== '0',
    lineSpacing,
    items: [], // Reihenfolge: Textsegmente {text,font,size,...} und Marker {marker:'lr'|'br'}
    text: '',
    words: 0,
  };

  // Absatzende-Markierung eines Abschnitts: sectPr steckt in pPr des letzten Absatzes.
  const sectPr = child(pPr, 'w:sectPr');
  collectRuns(kids(p), para, ctx, chain);
  para.text = para.items.map((i) => i.text ?? '').join('');
  para.words = countWords(para.text);
  if (sectPr) ctx.sections.push(readSection(sectPr, ctx.paragraphs.length + 1));
  return para;
}

function collectRuns(nodes, para, ctx, paraChain) {
  for (const n of nodes) {
    const name = nameOf(n);
    if (name === 'w:r') readRun(n, para, ctx, paraChain);
    // Container um Runs. w:del (gelöschter Text im Änderungsmodus) wird bewusst übersprungen.
    else if (['w:hyperlink', 'w:ins', 'w:smartTag', 'w:fldSimple', 'w:sdt', 'w:sdtContent'].includes(name)) collectRuns(kids(n), para, ctx, paraChain);
  }
}

function readRun(r, para, ctx, paraChain) {
  const { styles } = ctx;
  const rPr = child(r, 'w:rPr');
  const charStyleId = val(rPr, 'w:rStyle');
  const sources = [
    rPr,
    ...styles.chain(charStyleId).map((s) => child(s, 'w:rPr')),
    ...paraChain.map((s) => child(s, 'w:rPr')),
    styles.rDef,
  ];
  // rFonts: Theme-Attribut überschreibt laut Spec das explizite ascii-Attribut derselben Ebene.
  const font = firstOf(sources, (src) => {
    const f = attrs(child(src, 'w:rFonts'));
    if (f['w:asciiTheme']) return styles.themeFont(f['w:asciiTheme']) ?? f['w:ascii'];
    return f['w:ascii'];
  });
  const szHalfPt = Number(firstOf(sources, (src) => attrs(child(src, 'w:sz'))['w:val']));
  // <w:i/> ohne Wert (oder val != 0/false/off) bedeutet kursiv; wird wie Schrift/Grösse vererbt.
  const italic = firstOf(sources, (src) => {
    const i = child(src, 'w:i');
    return i ? !['0', 'false', 'off'].includes(attrs(i)['w:val']) : undefined;
  }) ?? false;
  const base = { font, size: Number.isFinite(szHalfPt) ? szHalfPt / 2 : undefined, italic }; // sz: halbe Punkte

  let buf = '';
  const flush = () => {
    if (buf) para.items.push({ ...base, text: buf });
    buf = '';
  };
  for (const c of kids(r)) {
    switch (nameOf(c)) {
      case 'w:t': buf += kids(c).map((t) => t['#text'] ?? '').join(''); break;
      case 'w:tab': buf += ' '; break;
      case 'w:noBreakHyphen': buf += '-'; break;
      case 'w:br':
        if (attrs(c)['w:type'] === 'page') { flush(); para.items.push({ marker: 'br' }); } else buf += ' ';
        break;
      // Word schreibt beim Speichern an jede berechnete Seitengrenze ein lastRenderedPageBreak.
      case 'w:lastRenderedPageBreak': flush(); para.items.push({ marker: 'lr' }); break;
    }
  }
  flush();
}

const countWords = (text) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const round2 = (x) => Math.round(x * 100) / 100;

// ---------- Seiten und Abschnitte zuordnen ----------
// Seitenzahlen sind ohne Layout-Engine nur eine Näherung. Zwei Strategien:
//  - 'lastRendered': Word-Marker aus dem letzten Speichern (gut, falls vorhanden)
//  - 'explicit': nur harte Umbrüche / Abschnittswechsel (unterschätzt die Seitenzahl)
function assignPages(paragraphs, sections) {
  // Abschnitt je Absatz: der erste Abschnitt, dessen Ende hinter dem Absatz liegt.
  const sorted = sections.slice().sort((a, b) => a.endsAfterParagraph - b.endsAfterParagraph);
  sections.length = 0;
  sections.push(...sorted);
  paragraphs.forEach((p) => {
    const idx = sections.findIndex((s) => p.index < s.endsAfterParagraph);
    p.sectionIndex = idx === -1 ? Math.max(sections.length - 1, 0) : idx;
  });

  let lr = 1; let ex = 1; let hasContent = false; let prevSection = 0;
  const hasLR = paragraphs.some((p) => p.items.some((i) => i.marker === 'lr'));
  for (const p of paragraphs) {
    // Abschnittswechsel (ausser "continuous") beginnt eine neue Seite.
    if (p.sectionIndex !== prevSection && sections[p.sectionIndex]?.breakType !== 'continuous') ex++;
    prevSection = p.sectionIndex;
    if (p.pageBreakBefore && hasContent) ex++;
    for (const item of p.items) {
      if (item.marker === 'lr') { if (hasContent) lr++; }
      else if (item.marker === 'br') ex++;
      else { item.pageLR = lr; item.pageEx = ex; if (item.text.trim()) hasContent = true; }
    }
    // Absatz ohne Text (z.B. nur Marker): Seite am aktuellen Stand festmachen.
    const first = p.items.find((i) => i.text !== undefined);
    p.page = hasLR ? (first?.pageLR ?? lr) : (first?.pageEx ?? ex);
    p.pageSource = hasLR ? 'lastRendered' : 'explicit';
    for (const item of p.items) if (item.text !== undefined) item.page = hasLR ? item.pageLR : item.pageEx;
  }
}
