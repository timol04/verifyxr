// UI: Upload, Vorgaben-Formular, Ergebnis-Darstellung. Alles läuft lokal im Browser.
import './style.css';
import { parseDocx } from './lib/docx-parser.js';
import { checkDocument } from './lib/checker.js';
import { PRESETS, DEFAULT_PRESET } from './lib/presets.js';

const $ = (sel) => document.querySelector(sel);
const LABEL = { ok: 'Erfüllt', warn: 'Kleine Abweichung', fail: 'Abweichung', skip: 'Nicht geprüft' };
// Statussymbole als SVG (kein Emoji), Farbe kommt aus CSS (currentColor)
const GLYPH = {
  ok: '<circle cx="14" cy="14" r="12" fill="currentColor"/><path d="M8.5 14.5l4 4 7-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M14 2.5l12.5 22h-25z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 11v6.5M14 21v.1" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  fail: '<circle cx="14" cy="14" r="12" fill="currentColor"/><path d="M9.5 9.5l9 9m0-9l-9 9" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  skip: '<circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 14h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};
const glyph = (status) => `<svg class="mark" viewBox="0 0 28 28" aria-hidden="true">${GLYPH[status]}</svg>`;
const MAX_FINDINGS = 25; // Liste pro Kriterium kürzen, damit lange Arbeiten lesbar bleiben
const STORAGE_KEY = 'abgabe-checker:rules';

// ---------- Formular <-> Rules ----------
const num = (id) => {
  const v = $(`#${id}`).value.trim().replace(',', '.');
  return v === '' || Number.isNaN(Number(v)) ? null : Number(v);
};

function readRules() {
  return {
    font: $('#font').value.trim() || 'Times New Roman',
    size: num('size') ?? 12,
    lineSpacing: num('lineSpacing') ?? 1.5,
    marginsCm: { top: num('mTop'), bottom: num('mBottom'), left: num('mLeft'), right: num('mRight') },
    minWords: num('minWords'), maxWords: num('maxWords'),
    minPages: num('minPages'), maxPages: num('maxPages'),
    ignoreSpecial: $('#ignoreSpecial').checked,
  };
}

function writeRules(r) {
  $('#font').value = r.font;
  $('#size').value = r.size;
  $('#lineSpacing').value = r.lineSpacing;
  $('#mTop').value = r.marginsCm.top; $('#mBottom').value = r.marginsCm.bottom;
  $('#mLeft').value = r.marginsCm.left; $('#mRight').value = r.marginsCm.right;
  for (const k of ['minWords', 'maxWords', 'minPages', 'maxPages']) $(`#${k}`).value = r[k] ?? '';
  if (r.ignoreSpecial !== undefined) $('#ignoreSpecial').checked = r.ignoreSpecial;
}

// localStorage kann fehlen oder werfen (privater Modus): immer abfangen.
const saveRules = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readRules())); } catch { /* egal */ } };
const loadRules = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } };

// ---------- Rendering ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const SEVERITY = { error: 'Fehler', hint: 'Hinweis' };

function renderResult(fileName, doc, result) {
  const { criteria, counts, findingCount } = result;
  const items = criteria.map((c) => {
    const shown = c.findings.slice(0, MAX_FINDINGS);
    const more = c.findings.length - shown.length;
    const hint = c.findings.find((f) => f.hint)?.hint;
    const list = shown.length
      ? `<details${shown.length <= 3 ? ' open' : ''}><summary>${plural(c.findings.length, 'Fundstelle', 'Fundstellen')}</summary>
         <ul class="findings">${shown.map((f) => `<li class="sev-${f.severity}">
           <span class="sev">${SEVERITY[f.severity]}</span> <strong>${esc(f.where)}</strong>
           <span class="vals">Erwartet: ${esc(f.expected ?? '–')} · Gefunden: ${esc(f.found ?? '–')}</span></li>`).join('')}${more > 0 ? `<li class="more">… und ${more} weitere</li>` : ''}</ul>
         ${hint ? `<p class="fix"><strong>So behebst du es:</strong> ${esc(hint)}</p>` : ''}</details>`
      : '';
    return `<li class="item ${c.status}">${glyph(c.status)}
      <h3>${esc(c.label)}<span class="status">${LABEL[c.status]}</span></h3>
      <p>${esc(c.summary)}</p>${list}</li>`;
  }).join('');

  const tile = (cls, n, label) => `<div class="tile ${cls}"><strong>${n}</strong><span>${label}</span></div>`;
  $('#result').innerHTML = `
    <div class="report-head" aria-live="polite">
      <p class="file">${esc(fileName)} · ${doc.wordCount} Wörter · ${doc.pages} Seiten${doc.pagesSource === 'explicit' ? ' (geschätzt)' : ''}</p>
      <div class="tiles">
        ${tile('ok', counts.ok, 'Kriterien bestanden')}
        ${tile('warn', counts.warn, 'Kriterien mit Hinweis')}
        ${tile('fail', counts.fail, 'Kriterien mit Fehler')}
      </div>
      <p class="verdict">${counts.fail + counts.warn === 0 ? 'Alle geprüften Kriterien stimmen mit den Vorgaben überein.' : `${plural(findingCount.error, 'Fehler', 'Fehler')} und ${plural(findingCount.hint, 'Hinweis', 'Hinweise')} an einzelnen Stellen gefunden. Nicht jede Abweichung ist ein Fehler: Hinweise sind unsicher oder knapp.`}</p>
    </div>
    <h3 class="cat">Ergebnisse nach Kategorie</h3>
    <ul class="protocol">${items}</ul>`;
  $('#result').hidden = false;
  $('#placeholder').hidden = true;
  $('#step3').classList.add('done');
}

function showError(message) {
  $('#result').innerHTML = `<div class="report-head error" role="alert"><h3>Datei konnte nicht gelesen werden</h3><p>${esc(message)}</p></div>`;
  $('#result').hidden = false;
  $('#placeholder').hidden = true;
}

// Kurzfassung der Vorgaben unter dem Profil
function updateSummary() {
  const r = readRules();
  const m = r.marginsCm;
  const same = m.top === m.bottom && m.bottom === m.left && m.left === m.right;
  $('#profileSummary').textContent = `${r.font} · ${r.size} pt · ${r.lineSpacing}-fach · Ränder ${same ? `${m.top} cm` : `${m.top}/${m.bottom}/${m.left}/${m.right} cm`}`;
}

// ---------- Ablauf ----------
let lastFile = null; // Datei merken, damit Vorgaben-Änderung erneut prüfen kann

async function runCheck() {
  if (!lastFile) return;
  try {
    const doc = await parseDocx(await lastFile.arrayBuffer());
    renderResult(lastFile.name, doc, checkDocument(doc, readRules()));
  } catch (err) {
    console.error(err);
    showError(err.message?.includes('zip') || err.message?.includes('Corrupted')
      ? 'Das ist keine gültige .docx-Datei (alte .doc-Dateien bitte in Word als .docx speichern).'
      : err.message);
  }
}

function handleFile(file) {
  if (!file) return;
  if (!/\.docx$/i.test(file.name)) { showError('Bitte eine .docx-Datei wählen.'); return; }
  lastFile = file;
  $('#fileName').textContent = file.name;
  $('#run').disabled = false;
  runCheck().then(() => $('#step3').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function init() {
  const select = $('#preset');
  select.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')
    + '<option value="custom">Eigene Vorgaben</option>';
  const saved = loadRules();
  if (saved) { writeRules(saved); select.value = 'custom'; } else { select.value = DEFAULT_PRESET; writeRules({ ...PRESETS[DEFAULT_PRESET].rules, ignoreSpecial: true }); }

  updateSummary();
  select.addEventListener('change', () => {
    if (PRESETS[select.value]) { writeRules({ ...PRESETS[select.value].rules, ignoreSpecial: $('#ignoreSpecial').checked }); saveRules(); updateSummary(); runCheck(); }
  });
  $('#rules').addEventListener('input', () => { select.value = 'custom'; saveRules(); updateSummary(); });
  $('#run').addEventListener('click', () => { runCheck(); $('#step3').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#rules').addEventListener('change', runCheck);
  $('#rules').addEventListener('submit', (e) => e.preventDefault());

  $('#file').addEventListener('change', (e) => handleFile(e.target.files[0]));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
}

init();
