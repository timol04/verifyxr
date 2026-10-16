// HTML-Darstellung der Prüfberichte (reine Funktionen, keine DOM-Zugriffe ausser Strings).
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const MAX_FINDINGS = 25; // Liste pro Kriterium kürzen, damit lange Arbeiten lesbar bleiben
const LABEL = { ok: 'Erfüllt', warn: 'Hinweis', fail: 'Abweichung', skip: 'Nicht geprüft' };
const SEVERITY = { error: 'Fehler', hint: 'Hinweis' };

// Statussymbole als SVG (kein Emoji), Farbe kommt aus CSS (currentColor)
const GLYPH = {
  ok: '<circle cx="14" cy="14" r="12" fill="currentColor"/><path d="M8.5 14.5l4 4 7-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M14 2.5l12.5 22h-25z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 11v6.5M14 21v.1" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  fail: '<circle cx="14" cy="14" r="12" fill="currentColor"/><path d="M9.5 9.5l9 9m0-9l-9 9" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  skip: '<circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 14h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};
const glyph = (status) => `<svg class="mark" viewBox="0 0 28 28" aria-hidden="true">${GLYPH[status]}</svg>`;

export const LOCK_ICON = '<svg class="lock" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** Zählt Kriterien nach Status (ohne "skip"). */
export function countStatuses(criteria) {
  const checked = criteria.filter((c) => c.status !== 'skip');
  return {
    ok: checked.filter((c) => c.status === 'ok').length,
    warn: checked.filter((c) => c.status === 'warn').length,
    fail: checked.filter((c) => c.status === 'fail').length,
    total: checked.length,
  };
}

// Meldung plus Erwartet/Gefunden; die Meldung entfällt, wenn sie nur beides wiederholt.
const valsHtml = (f) => {
  const structured = f.expected !== undefined || f.found !== undefined;
  const repeats = structured && f.message.includes(String(f.found)) && f.message.includes(String(f.expected));
  return `<span class="vals">${repeats ? '' : `${esc(f.message)}${structured ? '<br>' : ''}`}${structured ? `Erwartet: ${esc(f.expected ?? '–')} · Gefunden: ${esc(f.found ?? '–')}` : ''}</span>`;
};

const criterionHtml = (c) => {
  const shown = c.findings.slice(0, MAX_FINDINGS);
  const more = c.findings.length - shown.length;
  const hint = c.findings.find((f) => f.hint)?.hint;
  const list = shown.length
    ? `<details${shown.length <= 3 ? ' open' : ''}><summary>${plural(c.findings.length, 'Fundstelle', 'Fundstellen')}</summary>
       <ul class="findings">${shown.map((f) => `<li class="sev-${f.severity}">
         <span class="sev">${SEVERITY[f.severity]}</span> <strong>${esc(f.where)}</strong>
         ${valsHtml(f)}</li>`).join('')}${more > 0 ? `<li class="more">… und ${more} weitere</li>` : ''}</ul>
       ${hint ? `<p class="fix"><strong>So behebst du es:</strong> ${esc(hint)}</p>` : ''}</details>`
    : '';
  return `<li class="item ${c.status}">${glyph(c.status)}
    <h3>${esc(c.label)}<span class="status">${LABEL[c.status]}</span></h3>
    <p>${esc(c.summary)}</p>${list}</li>`;
};

const tile = (cls, n, label) => `<div class="tile ${cls}"><strong>${n}</strong><span>${label}</span></div>`;

/** Gesperrte Vorschau eines Premium-Bereichs im Bericht. */
export const lockedBlock = (title, text) => `<div class="locked-block"><h3>${LOCK_ICON} ${esc(title)} <span class="pill">Premium</span></h3>
  <p>${esc(text)}</p><a class="link-btn" href="#premium" data-goto-premium>Premium ansehen</a></div>`;

/**
 * Ein vollständiger Bericht für eine Datei.
 * @param entry { name, doc, result, apa|null, error? }
 * @param opts  { premium: boolean }
 */
export function reportHtml(entry, { premium }) {
  if (entry.error) return `<div class="report-head error" role="alert"><h3>${esc(entry.name)}: Datei konnte nicht gelesen werden</h3><p>${esc(entry.error)}</p></div>`;
  const { doc, result, apa } = entry;
  const all = apa ? [...result.criteria, ...apa] : result.criteria;
  const counts = countStatuses(all);
  const findings = all.flatMap((c) => c.findings);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const hints = findings.filter((f) => f.severity === 'hint').length;

  return `
    <div class="report-head" aria-live="polite">
      <p class="file">${esc(entry.name)} · ${doc.wordCount} Wörter · ${doc.pages} Seiten${doc.pagesSource === 'explicit' ? ' (geschätzt)' : ''}</p>
      <div class="tiles">
        ${tile('ok', counts.ok, 'Kriterien bestanden')}
        ${tile('warn', counts.warn, 'Kriterien mit Hinweis')}
        ${tile('fail', counts.fail, 'Kriterien mit Fehler')}
      </div>
      <p class="verdict">${counts.fail + counts.warn === 0 ? 'Alle geprüften Kriterien stimmen mit den Vorgaben überein.' : `${plural(errors, 'Fehler', 'Fehler')} und ${plural(hints, 'Hinweis', 'Hinweise')} an einzelnen Stellen gefunden. Nicht jede Abweichung ist ein Fehler: Hinweise sind unsicher oder knapp.`}</p>
    </div>
    <h3 class="cat">Format und Layout</h3>
    <ul class="protocol">${result.criteria.map(criterionHtml).join('')}</ul>
    <h3 class="cat">Quellen und Zitate (APA 7)</h3>
    ${premium && apa ? `<ul class="protocol">${apa.map(criterionHtml).join('')}</ul>`
      : lockedBlock('APA-7-Zitierkonsistenz', 'Gleicht Zitationen im Text mit dem Literaturverzeichnis ab und prüft DOI, Kursivschrift und Titel-Schreibweise.')}`;
}

/** Mehrere Dateien: Übersichtstabelle plus aufklappbare Einzelberichte. */
export function batchHtml(entries, opts) {
  const rows = entries.map((e) => {
    if (e.error) return `<tr><td>${esc(e.name)}</td><td colspan="3" class="err">${esc(e.error)}</td></tr>`;
    const c = countStatuses(e.apa ? [...e.result.criteria, ...e.apa] : e.result.criteria);
    return `<tr><td>${esc(e.name)}</td><td class="n ok">${c.ok}</td><td class="n warn">${c.warn}</td><td class="n fail">${c.fail}</td></tr>`;
  }).join('');
  const sections = entries.map((e, i) => `<details class="batch-file"${i === 0 ? ' open' : ''}><summary>${esc(e.name)}</summary>${reportHtml(e, opts)}</details>`).join('');
  return `<h3 class="cat">Übersicht (${entries.length} Dateien)</h3>
    <table class="overview"><thead><tr><th>Datei</th><th>Bestanden</th><th>Hinweis</th><th>Fehler</th></tr></thead><tbody>${rows}</tbody></table>
    ${sections}`;
}
