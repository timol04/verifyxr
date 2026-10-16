// Check-Logik: vergleicht das Ergebnis von parseDocx() mit den Vorgaben des Nutzers.
//
// Jedes Kriterium liefert { id, label, status, summary, findings[] }.
//   status: 'ok' (grün) | 'warn' (gelb) | 'fail' (rot) | 'skip' (nicht geprüft)
// Findings sind nach Absatz gruppiert, damit die Liste lesbar bleibt.

export const TOLERANCE = { size: 0.01, spacing: 0.05, marginCm: 0.1 };
// Ab diesem Anteil abweichender Wörter wird aus Gelb Rot.
const WARN_SHARE = 0.1;

/**
 * @param {Awaited<ReturnType<import('./docx-parser.js').parseDocx>>} doc
 * @param {Rules} rules
 *
 * @typedef {Object} Rules
 * @property {string} font            z.B. 'Times New Roman'
 * @property {number} size            Punkt, z.B. 12
 * @property {number} lineSpacing     Vielfaches, z.B. 1.5
 * @property {{top:number,bottom:number,left:number,right:number}} marginsCm
 * @property {number|null} minWords
 * @property {number|null} maxWords
 * @property {number|null} minPages
 * @property {number|null} maxPages
 * @property {boolean} ignoreSpecial  Überschriften/Verzeichnisse/Beschriftungen nicht prüfen
 */
export function checkDocument(doc, rules) {
  const criteria = [
    checkFont(doc, rules),
    checkSize(doc, rules),
    checkSpacing(doc, rules),
    checkMargins(doc, rules),
    checkWordCount(doc, rules),
    checkPageCount(doc, rules),
  ];
  const checked = criteria.filter((c) => c.status !== 'skip');
  const passed = checked.filter((c) => c.status === 'ok').length;
  const findings = criteria.flatMap((c) => c.findings);
  return {
    criteria,
    counts: { ok: passed, warn: checked.filter((c) => c.status === 'warn').length, fail: checked.filter((c) => c.status === 'fail').length },
    findingCount: { error: findings.filter((f) => f.severity === 'error').length, hint: findings.filter((f) => f.severity === 'hint').length },
    passed,
    total: checked.length,
    // Gesamtampel: rot, sobald ein Kriterium rot ist; gelb bei mind. einem gelben.
    status: checked.some((c) => c.status === 'fail') ? 'fail' : checked.some((c) => c.status === 'warn') ? 'warn' : 'ok',
  };
}

// ---------- Format-Kriterien (Schrift, Grösse, Zeilenabstand) ----------
const sameFont = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const fmt = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Absätze, die als Fliesstext geprüft werden (ohne Tabellen, optional ohne Sonderstile, ohne Leertext). */
const bodyParagraphs = (doc, rules) =>
  doc.paragraphs.filter((p) => p.words > 0 && !p.inTable && !(rules.ignoreSpecial && p.special));

/**
 * Generischer Run-/Absatz-Check. `probe(item, para)` liefert eine Abweichung
 * { message, expected, found, hint, severity? } oder null. Findings werden je Absatz zusammengefasst.
 */
function checkByRuns({ id, label, okText, doc, rules, probe, perParagraph = false }) {
  const paras = bodyParagraphs(doc, rules);
  const total = paras.reduce((s, p) => s + p.words, 0);
  if (total === 0) return { id, label, status: 'skip', summary: 'Kein Fliesstext gefunden.', findings: [] };

  let badWords = 0;
  const findings = [];
  for (const p of paras) {
    const problems = new Map(); // message -> { d, words }
    const add = (d, w) => problems.set(d.message, { d, words: (problems.get(d.message)?.words ?? 0) + w });
    if (perParagraph) {
      const d = probe(null, p);
      if (d) add(d, p.words);
    } else {
      for (const item of p.items) {
        if (item.text === undefined || !item.text.trim()) continue;
        const d = probe(item, p);
        if (d) add(d, countWords(item.text));
      }
    }
    for (const { d, words } of problems.values()) {
      badWords += words;
      findings.push({ severity: 'error', ...d, where: where(p), words });
    }
  }
  // Wörter an Run-Grenzen können doppelt gezählt werden: Anteil auf 100 % begrenzen.
  const share = Math.min(1, badWords / total);
  const status = badWords === 0 ? 'ok' : share <= WARN_SHARE ? 'warn' : 'fail';
  const summary = badWords === 0
    ? okText
    : `${findings.length} Abweichung${findings.length === 1 ? '' : 'en'} (${Math.round(share * 100)} % des Textes).`;
  return { id, label, status, summary, findings };
}

function checkFont(doc, rules) {
  return checkByRuns({
    id: 'font', label: 'Schriftart', doc, rules,
    okText: `Durchgehend ${rules.font}.`,
    probe: (item) => (sameFont(item.font, rules.font) ? null : {
      message: `Schriftart ist ${item.font ?? 'unbekannt'} statt ${rules.font}`,
      expected: rules.font, found: item.font ?? 'unbekannt',
      hint: `Text markieren und in Word unter Start die Schriftart auf ${rules.font} stellen. Dauerhaft geht es über den Stil «Standard» (Rechtsklick → Ändern).`,
    }),
  });
}

function checkSize(doc, rules) {
  return checkByRuns({
    id: 'size', label: 'Schriftgrösse', doc, rules,
    okText: `Durchgehend ${fmt(rules.size)} pt.`,
    probe: (item) => (item.size !== undefined && Math.abs(item.size - rules.size) <= TOLERANCE.size
      ? null
      : {
        message: `Schriftgrösse ist ${item.size === undefined ? 'unbekannt' : `${fmt(item.size)} pt`} statt ${fmt(rules.size)} pt`,
        expected: `${fmt(rules.size)} pt`, found: item.size === undefined ? 'unbekannt' : `${fmt(item.size)} pt`,
        hint: `Text markieren und unter Start die Schriftgrösse auf ${fmt(rules.size)} setzen.`,
      }),
  });
}

function checkSpacing(doc, rules) {
  const spacingHint = `Absatz markieren, unter Start → Absatz → Zeilenabstand den Wert «${fmt(rules.lineSpacing)}» wählen.`;
  return checkByRuns({
    id: 'spacing', label: 'Zeilenabstand', doc, rules, perParagraph: true,
    okText: `Durchgehend ${fmt(rules.lineSpacing)}-fach.`,
    probe: (_, p) => {
      const ls = p.lineSpacing;
      if (ls.kind === 'multiple') {
        return Math.abs(ls.value - rules.lineSpacing) <= TOLERANCE.spacing ? null : {
          message: `Zeilenabstand ist ${fmt(ls.value)} statt ${fmt(rules.lineSpacing)}`,
          expected: `${fmt(rules.lineSpacing)}-fach`, found: `${fmt(ls.value)}-fach`, hint: spacingHint,
        };
      }
      // Fester Abstand (genau/mindestens) in pt lässt sich nicht verlässlich in ein Vielfaches umrechnen:
      // deshalb nur ein Hinweis, kein sicherer Fehler.
      return {
        message: `Zeilenabstand ist fest auf ${fmt(ls.value)} pt (${ls.kind === 'exact' ? 'genau' : 'mindestens'}) statt ${fmt(rules.lineSpacing)}-fach`,
        expected: `${fmt(rules.lineSpacing)}-fach`, found: `${fmt(ls.value)} pt (${ls.kind === 'exact' ? 'genau' : 'mindestens'})`,
        severity: 'hint',
        hint: `Ein fester Abstand lässt sich nicht sicher in «${fmt(rules.lineSpacing)}-fach» umrechnen. ${spacingHint}`,
      };
    },
  });
}

// ---------- Seitenränder ----------
const SIDES = [['top', 'oben'], ['bottom', 'unten'], ['left', 'links'], ['right', 'rechts']];

function checkMargins(doc, rules) {
  const findings = [];
  let worst = 0;
  doc.sections.forEach((sec, i) => {
    const firstPara = doc.paragraphs.find((p) => p.sectionIndex === i);
    const label = doc.sections.length > 1 ? `Abschnitt ${i + 1}${firstPara ? ` (ab Seite ${firstPara.page})` : ''}` : 'Dokument';
    for (const [key, name] of SIDES) {
      const actual = sec.margins[key];
      const expected = rules.marginsCm[key];
      if (actual === undefined || expected === null || expected === undefined) continue;
      const diff = Math.abs(actual - expected);
      if (diff > TOLERANCE.marginCm) {
        worst = Math.max(worst, diff);
        findings.push({
          where: label, severity: diff <= 0.5 ? 'hint' : 'error',
          message: `Rand ${name} ist ${fmt(actual)} cm statt ${fmt(expected)} cm`,
          expected: `${fmt(expected)} cm`, found: `${fmt(actual)} cm`,
          hint: 'In Word unter Layout → Seitenränder → Benutzerdefinierte Seitenränder öffnen und den Wert anpassen; bei mehreren Abschnitten «Anwenden auf: Gesamtes Dokument» wählen.',
        });
      }
    }
  });
  const status = findings.length === 0 ? 'ok' : worst <= 0.5 ? 'warn' : 'fail';
  return {
    id: 'margins', label: 'Seitenränder', status, findings,
    summary: findings.length === 0 ? 'Alle Ränder stimmen.' : `${findings.length} Rand-Abweichung${findings.length === 1 ? '' : 'en'}.`,
  };
}

// ---------- Umfang ----------
function checkWordCount(doc, rules) {
  const { minWords, maxWords } = rules;
  if (minWords == null && maxWords == null) {
    return { id: 'words', label: 'Wortzahl', status: 'skip', summary: 'Keine Grenzen gesetzt.', findings: [] };
  }
  const n = doc.wordCount;
  const bad = (minWords != null && n < minWords) ? `Nur ${n} Wörter, mindestens ${minWords} verlangt`
    : (maxWords != null && n > maxWords) ? `${n} Wörter, höchstens ${maxWords} erlaubt` : null;
  return {
    id: 'words', label: 'Wortzahl', status: bad ? 'fail' : 'ok',
    summary: bad ?? `${n} Wörter, innerhalb der Grenzen.`,
    findings: bad ? [{
      where: 'Dokument', severity: 'error', message: bad,
      expected: [minWords != null ? `mind. ${minWords}` : '', maxWords != null ? `höchstens ${maxWords}` : ''].filter(Boolean).join(', '),
      found: `${n} Wörter`,
      hint: n < (minWords ?? 0) ? 'Die Arbeit ist zu kurz: Inhalte ergänzen oder vertiefen.' : 'Die Arbeit ist zu lang: kürzen oder Inhalte straffen. Prüfe, ob Verzeichnisse oder Anhang mitgezählt werden dürfen.',
    }] : [],
  };
}

function checkPageCount(doc, rules) {
  const { minPages, maxPages } = rules;
  if (minPages == null && maxPages == null) {
    return { id: 'pages', label: 'Seitenzahl', status: 'skip', summary: 'Keine Grenzen gesetzt.', findings: [] };
  }
  const n = doc.pages;
  // Ohne Layout-Engine ist die Seitenzahl nur dann verlässlich, wenn Word sie gespeichert hat.
  const reliable = doc.pagesSource !== 'explicit';
  const hint = reliable ? '' : ' (Schätzung, nur harte Umbrüche gezählt; in Word speichern verbessert die Genauigkeit)';
  const bad = (minPages != null && n < minPages) ? `${n} Seiten, mindestens ${minPages} verlangt`
    : (maxPages != null && n > maxPages) ? `${n} Seiten, höchstens ${maxPages} erlaubt` : null;
  return {
    id: 'pages', label: 'Seitenzahl',
    status: bad ? (reliable ? 'fail' : 'warn') : 'ok',
    summary: (bad ?? `${n} Seiten, innerhalb der Grenzen.`) + (bad || !reliable ? hint : ''),
    findings: bad ? [{
      where: 'Dokument', severity: reliable ? 'error' : 'hint', message: bad + hint,
      expected: [minPages != null ? `mind. ${minPages}` : '', maxPages != null ? `höchstens ${maxPages}` : ''].filter(Boolean).join(', '),
      found: `${n} Seiten${reliable ? '' : ' (geschätzt)'}`,
      hint: 'Öffne das Dokument in Word, speichere es und prüfe es erneut: Word hinterlegt dabei die Seitenzahl in der Datei.',
    }] : [],
  };
}

// ---------- Hilfen ----------
export const countWords = (t) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const where = (p) => `Seite ${p.page}${p.pageSource === 'explicit' ? ' (ca.)' : ''}, «${p.text.trim().slice(0, 40)}${p.text.trim().length > 40 ? '…' : ''}»`;
