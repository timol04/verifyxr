// APA-7-Konsistenzprüfung (Premium). Arbeitet auf dem Ergebnis von parseDocx().
//
// Ablauf:
//   1. Dokument am Literaturverzeichnis-Titel teilen (Text davor = Fliesstext, danach = Einträge)
//   2. In-Text-Zitationen per Regex finden (parenthetisch und narrativ)
//   3. Einträge in Autor*innen + Jahr zerlegen und Zitationen abgleichen (Autor + Jahr exakt)
//   4. Formatierung der Einträge prüfen (Zeitschriftentitel kursiv, Titel-Schreibweise, DOI)
//
// Regex-Erkennung ist eine Näherung: Findings, bei denen die Erkennung unsicher ist, sind
// als 'hint' markiert, eindeutige Inkonsistenzen als 'error'.
import { where } from './checker.js';

// ---------- Muster ----------
// Nachname mit optionalen Namenszusätzen (von, van der, de ...), z.B. "van der Berg", "Müller-Lyer".
const NAME = String.raw`(?:(?:van|von|de|der|den|di|da|le|la|zu|ter|ten)\s+)*\p{Lu}[\p{L}'’\-]*`;
// Ein Autor, zwei/mehrere mit &/und oder "et al."
const AUTH = String.raw`${NAME}(?:(?:\s*,\s*${NAME})*\s*,?\s*(?:&|und|and)\s*${NAME}|\s+et\s+al\.)?`;
const YEAR = String.raw`(?:(?:19|20)\d{2}[a-z]?|n\.\s?d\.|o\.\s?J\.)`;
const YEARS = String.raw`${YEAR}(?:\s*,\s*${YEAR})*`;
const PAGES = String.raw`(?:S\.|p\.|pp\.|Kap\.|ch\.)`;

// Ein Segment innerhalb einer Klammer, z.B. "vgl. Meier & Huber, 2020, S. 4"
const SEGMENT = new RegExp(
  String.raw`^\s*(?:(?:vgl\.|siehe|see|cf\.|e\.\s?g\.|z\.\s?B\.)\s*)?(${AUTH}),?\s+(${YEARS})(?:\s*,\s*${PAGES}\s*[^;]*)?\s*$`, 'u');
// Fliesstext: "Meier (2020) zeigt ...", "Meier und Huber (2020, S. 3)"
const NARRATIVE = new RegExp(
  String.raw`(?<![\p{L}\-])(${AUTH})\s*\(\s*(${YEARS})(?:\s*,\s*${PAGES}\s*[^)]*)?\)`, 'gu');

const REF_HEADING = /^\s*(literaturverzeichnis|literatur|quellenverzeichnis|quellen|references|reference list|bibliography)\s*$/i;

// ---------- Zerlegen ----------
const norm = (s) => s.toLowerCase().normalize('NFC');

/** "Meier und Huber" / "Meier, Huber & Müller" / "Meier et al." -> { surnames, etAl } */
function parseAuthors(str) {
  const etAl = /\bet\s+al\./.test(str);
  const surnames = str.replace(/\bet\s+al\./, '').split(/\s*(?:,|&|\bund\b|\band\b)\s*/).map((s) => s.trim()).filter(Boolean);
  return { surnames, etAl };
}

/** "2020a, 2021" -> [{ year:'2020', suffix:'a' }, { year:'2021', suffix:'' }] */
function parseYears(str) {
  return str.split(',').map((y) => y.trim()).filter(Boolean).map((y) => {
    const m = /^((?:19|20)\d{2})([a-z]?)$/.exec(y);
    return m ? { year: m[1], suffix: m[2] } : { year: y.replace(/\s/g, ''), suffix: '' }; // n.d. / o.J.
  });
}

const display = (c) => `${c.surnames.join(c.surnames.length === 2 ? ' & ' : ', ')}${c.etAl ? ' et al.' : ''}, ${c.year}${c.suffix}`;

/** Alle In-Text-Zitationen eines Absatztextes. */
export function extractCitations(text) {
  const found = [];
  const push = (authStr, yearsStr, kind) => {
    const authors = parseAuthors(authStr);
    for (const y of parseYears(yearsStr)) found.push({ ...authors, ...y, kind, raw: `${authStr} ${yearsStr}` });
  };
  // 1) Klammern (ohne verschachtelte Klammern); Mehrfachzitation mit ";" getrennt
  for (const m of text.matchAll(/\(([^()]*)\)/g)) {
    for (const seg of m[1].split(';')) {
      const s = SEGMENT.exec(seg);
      if (s) push(s[1], s[2], 'parenthetical');
    }
  }
  // 2) Narrativ: Autor*in steht vor der Klammer mit dem Jahr
  for (const m of text.matchAll(NARRATIVE)) push(m[1], m[2], 'narrative');
  return found;
}

/** Literaturverzeichnis-Einträge: Autor*innen vor "(Jahr)". Gibt null zurück, wenn der Absatz kein Eintrag ist. */
export function parseReference(text) {
  const m = /^(.+?)\s*\(\s*((?:19|20)\d{2}[a-z]?|n\.\s?d\.|o\.\s?J\.)(?:\s*,[^)]*)?\)/u.exec(text);
  if (!m) return null;
  const authorPart = m[1];
  // "Meier, A. B." -> Nachname vor Komma gefolgt von Initialen
  const surnames = [...authorPart.matchAll(new RegExp(String.raw`(${NAME})\s*,\s*(?:\p{Lu}\.[\s\-]*)+`, 'gu'))].map((x) => x[1]);
  const { year, suffix } = parseYears(m[2])[0];
  return {
    // Ohne Initialen (z.B. Organisation): ganzer Autorenteil als ein Name
    surnames: surnames.length ? surnames : [authorPart.replace(/[.\s]+$/, '')],
    year, suffix,
    yearEnd: m.index + m[0].length, // Position hinter "(Jahr)" für die Formatprüfung
  };
}

/** Teilt das Dokument in Fliesstext-Absätze und Literaturverzeichnis-Absätze. */
export function splitDocument(doc) {
  const headingIdx = doc.paragraphs.findIndex((p) => !p.inTable && REF_HEADING.test(p.text));
  if (headingIdx === -1) return { body: doc.paragraphs.filter((p) => !p.inTable && !p.special), refParas: null, headingIdx };
  const after = doc.paragraphs.slice(headingIdx + 1);
  // Verzeichnis endet an der nächsten Überschrift (z.B. Anhang)
  const endRel = after.findIndex((p) => p.special && p.words > 0);
  const refParas = (endRel === -1 ? after : after.slice(0, endRel)).filter((p) => p.words > 0 && !p.inTable);
  return { body: doc.paragraphs.slice(0, headingIdx).filter((p) => !p.inTable && !p.special), refParas, headingIdx };
}

// ---------- Abgleich ----------
const same = (a, b) => norm(a) === norm(b);

function matchCitation(c, refs) {
  const sameAuthor = refs.filter((r) => same(r.surnames[0], c.surnames[0]));
  const exact = sameAuthor.filter((r) => r.year === c.year && r.suffix === c.suffix);
  if (exact.length === 0) {
    if (sameAuthor.length === 0) return { problem: { severity: 'error', message: `Kein Eintrag im Literaturverzeichnis für ${display(c)}`, expected: 'Eintrag mit gleichem Autor und Jahr', found: 'kein Eintrag', hint: 'Eintrag ergänzen oder die Zitation korrigieren. Autor*in und Jahr müssen exakt übereinstimmen.' } };
    const sameYear = sameAuthor.find((r) => r.year === c.year);
    const listed = sameAuthor.map((r) => `${r.year}${r.suffix}`).join(', ');
    return {
      problem: {
        severity: 'error',
        message: sameYear ? `Jahreszusatz passt nicht: ${display(c)}` : `Jahr passt nicht: ${display(c)}`,
        expected: `Eintrag ${c.surnames[0]} (${c.year}${c.suffix})`, found: `Im Verzeichnis: ${c.surnames[0]} ${listed}`,
        hint: 'Jahr (und bei mehreren Werken im selben Jahr der Zusatz a, b, c) in Text und Literaturverzeichnis angleichen.',
      },
    };
  }
  // Autor*innen-Anzahl: APA 7 nennt ab 3 Autor*innen nur den ersten + "et al."
  const ref = exact.find((r) => c.surnames.length < 2 || (r.surnames[1] && same(r.surnames[1], c.surnames[1]))) ?? exact[0];
  const n = ref.surnames.length;
  let problem = null;
  if (c.etAl && n < 3) {
    problem = { severity: 'hint', message: `«et al.» bei nur ${n} Autor*in${n === 1 ? '' : 'nen'}: ${display(c)}`, expected: 'Alle Namen (et al. erst ab 3 Autor*innen)', found: 'et al.', hint: 'Bei ein bis zwei Autor*innen alle Namen nennen.' };
  } else if (!c.etAl && c.surnames.length === 1 && n >= 2) {
    problem = { severity: 'error', message: `Zitation nennt nur eine*n von ${n} Autor*innen: ${display(c)}`, expected: n >= 3 ? `${ref.surnames[0]} et al.` : `${ref.surnames[0]} & ${ref.surnames[1]}`, found: c.surnames[0], hint: 'Die Autor*innen in der Zitation wie im Literaturverzeichnis angeben.' };
  } else if (!c.etAl && c.surnames.length >= 2 && n >= 2 && !same(ref.surnames[1], c.surnames[1])) {
    problem = { severity: 'error', message: `Zweite*r Autor*in passt nicht: ${display(c)}`, expected: ref.surnames[1], found: c.surnames[1], hint: 'Namen mit dem Literaturverzeichnis abgleichen.' };
  } else if (!c.etAl && c.surnames.length === 2 && n >= 3) {
    problem = { severity: 'hint', message: `Ab 3 Autor*innen «et al.» verwenden: ${display(c)}`, expected: `${ref.surnames[0]} et al.`, found: display(c), hint: 'APA 7 kürzt ab drei Autor*innen immer auf den ersten Namen plus «et al.».' };
  }
  return { ref, problem };
}

// ---------- Formatprüfung der Einträge ----------
const GERMAN = /[äöüß]|\b(und|der|die|das|von|für|mit|im|ein|eine|zur|zum|bei|auf|über|nach|zu)\b/i;

/** Kursiv-Anteil (Buchstaben) im Bereich [start, end) des Absatztextes. */
function italicShare(para, start, end) {
  let pos = 0; let letters = 0; let italics = 0;
  for (const item of para.items) {
    if (item.text === undefined) continue;
    for (const ch of item.text) {
      if (pos >= start && pos < end && /\p{L}/u.test(ch)) { letters++; if (item.italic) italics++; }
      pos += ch.length;
    }
  }
  return letters === 0 ? 1 : italics / letters;
}

function checkReferenceFormat(p, ref) {
  const out = [];
  const text = p.text;
  const after = text.slice(ref.yearEnd);
  const lead = after.length - after.replace(/^[\s.]+/, '').length;
  const body = after.slice(lead);
  const bodyStart = ref.yearEnd + lead;

  // Titel = bis zum ersten Satzende, danach Quelle (Zeitschrift, Band(Heft), Seiten)
  const titleEnd = body.search(/[.?!]\s/);
  const title = titleEnd === -1 ? '' : body.slice(0, titleEnd + 1);
  const rest = titleEnd === -1 ? '' : body.slice(titleEnd + 2);
  const restStart = bodyStart + (titleEnd === -1 ? 0 : titleEnd + 2);
  const journal = /^([^,]+?),\s*(\d+)(?:\(\s*[^)]*\))?\s*,\s*[\w\-–]+/.exec(rest);

  // 1) Zeitschriftentitel kursiv
  if (journal) {
    const share = italicShare(p, restStart, restStart + journal[1].length);
    if (share < 0.8) {
      out.push({ severity: 'error', message: `Zeitschriftentitel nicht kursiv: «${journal[1].trim()}»`, expected: 'Zeitschriftentitel kursiv', found: 'nicht kursiv', hint: 'Zeitschriftentitel (und Bandnummer) markieren und mit Strg+I kursiv setzen.' });
    }
  }

  // 2) Titel-Schreibweise: APA 7 setzt Artikeltitel in Satzschreibweise (nur erstes Wort und Eigennamen gross).
  //    Deutsche Titel werden nicht geprüft: Substantive sind dort ohnehin gross.
  if (journal && title && !GERMAN.test(title)) {
    const words = title.replace(/[.?!]$/, '').split(/\s+/);
    const considered = words.filter((w, i) => i > 0 && w.length > 3 && !/:$/.test(words[i - 1]) && !/^[\p{Lu}\d\-]+$/u.test(w) && /^\p{L}/u.test(w));
    const caps = considered.filter((w) => /^\p{Lu}/u.test(w)).length;
    if (considered.length >= 3 && caps / considered.length >= 0.5) {
      out.push({ severity: 'hint', message: `Titel scheint in Title Case geschrieben: «${title.slice(0, 50)}${title.length > 50 ? '…' : ''}»`, expected: 'Satzschreibweise (nur 1. Wort und Eigennamen gross)', found: 'mehrere Wörter gross', hint: 'Nur das erste Wort, das erste Wort nach einem Doppelpunkt und Eigennamen gross schreiben. Eigennamen kann das Tool nicht erkennen, daher nur ein Hinweis.' });
    }
  }

  // 3) DOI-Format: https://doi.org/10.xxxx/yyyy (ohne "doi:", ohne dx., ohne Schlusspunkt)
  const goodDoi = /https:\/\/doi\.org\/10\.\d{4,9}\/\S+/i.exec(text);
  const anyDoi = /(?:\bdoi:?\s*|https?:\/\/(?:dx\.)?doi\.org\/|\b)(10\.\d{4,9}\/\S+)/i.exec(text);
  if (anyDoi && !goodDoi) {
    out.push({ severity: 'error', message: 'DOI nicht im APA-7-Format', expected: `https://doi.org/${anyDoi[1].replace(/[.,;]$/, '')}`, found: anyDoi[0].trim(), hint: 'DOI als Link schreiben: https://doi.org/10.xxxx/yyyy (ohne «doi:» davor).' });
  } else if (goodDoi && /\.$/.test(text.trimEnd())) {
    out.push({ severity: 'hint', message: 'Punkt nach dem DOI-Link', expected: 'kein Punkt am Ende', found: 'endet mit Punkt', hint: 'In APA 7 steht nach DOI oder URL kein Schlusspunkt.' });
  } else if (journal && !anyDoi && !/https?:\/\//i.test(text)) {
    out.push({ severity: 'hint', message: 'Kein DOI und keine URL angegeben', expected: 'DOI (falls vorhanden)', found: 'fehlt', hint: 'Falls der Artikel eine DOI hat, als https://doi.org/… ergänzen.' });
  }
  return out;
}

// ---------- Hauptfunktion ----------
const statusOf = (findings) => (findings.some((f) => f.severity === 'error') ? 'fail' : findings.length ? 'warn' : 'ok');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Gibt Kriterien im selben Format wie checkDocument() zurück (für gemeinsame Darstellung). */
export function checkApa(doc) {
  const { body, refParas, headingIdx } = splitDocument(doc);

  const citations = [];
  for (const p of body) for (const c of extractCitations(p.text)) citations.push({ ...c, para: p });

  const skip = (summary) => ['citations', 'unused', 'format'].map((k) => ({ id: `apa-${k}`, label: APA_LABELS[k], status: 'skip', summary, findings: [] }));
  if (citations.length === 0 && headingIdx === -1) return skip('Keine Zitationen und kein Literaturverzeichnis erkannt.');

  // Einträge zerlegen
  const refs = [];
  const unparsed = [];
  for (const p of refParas ?? []) {
    const r = parseReference(p.text);
    if (r) refs.push({ ...r, para: p, used: false });
    else unparsed.push(p);
  }

  // Zitationen abgleichen; gleiche Meldung nur einmal, mit Anzahl
  const cFindings = new Map();
  for (const c of citations) {
    const { ref, problem } = headingIdx === -1 ? { problem: null } : matchCitation(c, refs);
    if (ref) ref.used = true;
    if (problem) {
      const prev = cFindings.get(problem.message);
      if (prev) prev.count++;
      else cFindings.set(problem.message, { ...problem, where: where(c.para), count: 1 });
    }
  }
  const citationFindings = [...cFindings.values()].map((f) => (f.count > 1 ? { ...f, where: `${f.where} (und ${f.count - 1} weitere Stelle${f.count === 2 ? '' : 'n'})` } : f));
  if (headingIdx === -1) {
    citationFindings.push({ where: 'Dokument', severity: 'error', message: 'Kein Literaturverzeichnis gefunden', expected: 'Überschrift «Literaturverzeichnis» (oder Quellenverzeichnis, References)', found: 'keine passende Überschrift', hint: 'Das Verzeichnis mit einer dieser Überschriften beginnen, damit FormaCheck es erkennt.' });
  }

  const unusedFindings = refs.filter((r) => !r.used).map((r) => ({
    where: where(r.para), severity: 'hint', message: `Eintrag wird im Text nicht zitiert: ${r.surnames[0]} (${r.year}${r.suffix})`,
    expected: 'Jeder Eintrag wird im Text zitiert', found: 'keine Zitation gefunden',
    hint: 'Eintrag entfernen oder im Text zitieren. Falls die Zitation anders geschrieben ist (z.B. mit Seitenzahl in eigener Klammer), kann sie übersehen worden sein.',
  }));

  const formatFindings = refs.flatMap((r) => checkReferenceFormat(r.para, r).map((f) => ({ ...f, where: where(r.para) })));
  for (const p of unparsed) {
    formatFindings.push({ where: where(p), severity: 'hint', message: 'Eintrag nicht erkannt (Autor*in und Jahr in Klammern fehlen)', expected: 'Autor, A. (Jahr). Titel.', found: p.text.slice(0, 40), hint: 'Format «Nachname, V. (Jahr).» an den Anfang des Eintrags setzen.' });
  }

  const noRefs = headingIdx !== -1 && refs.length === 0;
  return [
    { id: 'apa-citations', label: APA_LABELS.citations, status: statusOf(citationFindings), findings: citationFindings,
      summary: citationFindings.length ? `${plural(citations.length, 'Zitation', 'Zitationen')} erkannt, ${plural(citationFindings.length, 'Problem', 'Probleme')}.` : `${plural(citations.length, 'Zitation', 'Zitationen')} erkannt, alle mit passendem Eintrag.` },
    { id: 'apa-unused', label: APA_LABELS.unused, status: noRefs ? 'skip' : statusOf(unusedFindings), findings: unusedFindings,
      summary: noRefs ? 'Keine Einträge erkannt.' : unusedFindings.length ? `${plural(unusedFindings.length, 'Eintrag wird', 'Einträge werden')} im Text nicht zitiert.` : `Alle ${refs.length} Einträge werden zitiert.` },
    { id: 'apa-format', label: APA_LABELS.format, status: noRefs ? 'skip' : statusOf(formatFindings), findings: formatFindings,
      summary: noRefs ? 'Keine Einträge erkannt.' : formatFindings.length ? `${plural(formatFindings.length, 'Abweichung', 'Abweichungen')} in ${plural(refs.length, 'Eintrag', 'Einträgen')}.` : `${plural(refs.length, 'Eintrag', 'Einträge')} ohne erkennbare Formatabweichung.` },
  ];
}

const APA_LABELS = { citations: 'Zitationen und Verzeichnis', unused: 'Ungenutzte Einträge', format: 'Verzeichnis-Formatierung' };
