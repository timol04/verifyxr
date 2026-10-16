// FormaCheck UI: Vorgaben, Upload (einzeln oder Batch), Bericht, Premium-Freischaltung.
// Alles läuft lokal im Browser, es werden keine Dateien übertragen.
import './style.css';
import { parseDocx } from './lib/docx-parser.js';
import { checkDocument } from './lib/checker.js';
import { checkApa } from './lib/apa.js';
import { PRESETS, DEFAULT_PRESET } from './lib/presets.js';
import { isPremium, activate, deactivate, getStoredKey } from './lib/license.js';
import { listProfiles, saveProfile, deleteProfile, getProfile } from './lib/profiles.js';
import { UPGRADE_URL, PRICE_LABEL } from './config.js';
import { esc, reportHtml, batchHtml, lockedBlock, LOCK_ICON } from './ui/report.js';

const $ = (sel) => document.querySelector(sel);
const RULES_KEY = 'formacheck:rules';

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
const saveRules = () => { try { localStorage.setItem(RULES_KEY, JSON.stringify(readRules())); } catch { /* egal */ } };
const loadRules = () => { try { return JSON.parse(localStorage.getItem(RULES_KEY)); } catch { return null; } };

/** Kurzfassung der Vorgaben, auch im PDF-Kopf verwendet. */
function summaryText() {
  const r = readRules();
  const m = r.marginsCm;
  const same = m.top === m.bottom && m.bottom === m.left && m.left === m.right;
  return `${r.font} · ${r.size} pt · ${r.lineSpacing}-fach · Ränder ${same ? `${m.top} cm` : `${m.top}/${m.bottom}/${m.left}/${m.right} cm`}`;
}
const updateSummary = () => { $('#profileSummary').textContent = summaryText(); };

// ---------- Profil-Auswahl (Vorlagen + gespeicherte Profile) ----------
function renderPresetOptions(selected) {
  const mine = isPremium() ? listProfiles() : [];
  $('#preset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')
    + (mine.length ? `<optgroup label="Meine Profile">${mine.map((p) => `<option value="profile:${esc(p.name)}">${esc(p.name)}</option>`).join('')}</optgroup>` : '')
    + '<option value="custom">Eigene Vorgaben</option>';
  $('#preset').value = selected ?? 'custom';
  if ($('#preset').value !== (selected ?? 'custom')) $('#preset').value = 'custom';
}

/** Profile speichern/löschen: Premium. Für Gratis-Nutzer eine gesperrte Zeile. */
function renderProfileTools() {
  const el = $('#profiles');
  if (!isPremium()) {
    el.innerHTML = `<a class="locked-row" href="#premium" data-goto-premium>${LOCK_ICON}<span>Eigene Profile speichern, z.B. «Uni Basel Bachelorarbeit»</span><span class="pill">Premium</span></a>`;
    return;
  }
  const current = $('#preset').value;
  // Kein <form>: dieser Bereich liegt bereits im Vorgaben-Formular (verschachtelte Formulare sind ungültig).
  el.innerHTML = `<div class="profile-form">
      <label class="field">Aktuelle Vorgaben als Profil speichern <input id="profileName" type="text" maxlength="60" placeholder="z.B. Uni Basel Bachelorarbeit" /></label>
      <button type="button" id="saveProfile" class="secondary">Profil speichern</button>
      ${current.startsWith('profile:') ? '<button type="button" id="deleteProfile" class="secondary danger">Profil löschen</button>' : ''}
    </div>`;
}

// ---------- Premium-Bereich ----------
const FEATURES = ['APA-7-Zitierkonsistenz mit Abgleich zum Literaturverzeichnis', 'Eigene Format-Profile speichern', 'Prüfbericht als PDF speichern', 'Mehrere Dateien auf einmal prüfen'];

function renderPremium(message = '') {
  const el = $('#premium');
  if (isPremium()) {
    const key = getStoredKey();
    el.innerHTML = `<div class="premium-active">
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="currentColor"/><path d="M8.5 14.5l4 4 7-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div><h2 id="h-premium">Premium ist aktiv</h2><p>Lizenz ${esc(key.slice(0, 9))}…${esc(key.slice(-4))} auf diesem Gerät gespeichert.</p></div>
      <button id="removeLicense" class="secondary" type="button">Lizenz entfernen</button></div>`;
    return;
  }
  el.innerHTML = `<h2 id="h-premium">FormaCheck Premium <span class="pill">${esc(PRICE_LABEL)}</span></h2>
    <ul class="features">${FEATURES.map((f) => `<li>${LOCK_ICON}<span>${esc(f)}</span></li>`).join('')}</ul>
    <div class="premium-actions">
      <a class="primary link" href="${esc(UPGRADE_URL)}" target="_blank" rel="noopener">Premium kaufen</a>
      <form id="licenseForm" class="license-form">
        <label class="field">Lizenzschlüssel <input id="licenseKey" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="FMCK-XXXX-XXXX-XXXX" /></label>
        <button type="submit" class="secondary">Freischalten</button>
      </form>
    </div>
    <p id="licenseMsg" class="license-msg" role="status">${esc(message)}</p>
    <p class="hint">Die Prüfung des Schlüssels läuft lokal im Browser. Es wird nichts übertragen.</p>`;
}

/** Nach Aktivierung/Deaktivierung alles neu aufbauen, was vom Premium-Status abhängt. */
function refreshPremiumUi() {
  renderPremium();
  renderPresetOptions($('#preset').value);
  renderProfileTools();
  // Nach dem Freischalten die zuvor ausgewählten Dateien vollständig prüfen (Batch).
  if (ignoredFiles > 0 && isPremium()) { handleFiles(selectedFiles); return; }
  updateFileNotice();
  render();
}

// ---------- Dateien und Prüfung ----------
// entries: [{ name, file, doc?, error? }] – geparst wird einmal, Prüfung läuft bei jeder Vorgaben-Änderung neu.
let entries = [];

async function parseEntry(file) {
  const entry = { name: file.name, file };
  if (!/\.docx$/i.test(file.name)) return { ...entry, error: 'Bitte eine .docx-Datei wählen.' };
  try {
    entry.doc = await parseDocx(await file.arrayBuffer());
  } catch (err) {
    console.error(err);
    entry.error = /zip|corrupt|end of central/i.test(err.message)
      ? 'Das ist keine gültige .docx-Datei (alte .doc-Dateien bitte in Word als .docx speichern).'
      : err.message;
  }
  return entry;
}

function checkEntry(entry) {
  if (!entry.doc) return entry;
  const premium = isPremium();
  return { ...entry, result: checkDocument(entry.doc, readRules()), apa: premium ? checkApa(entry.doc) : null };
}

function render() {
  if (entries.length === 0) return;
  const checked = entries.map(checkEntry);
  const premium = isPremium();
  $('#result').innerHTML = checked.length === 1 ? reportHtml(checked[0], { premium }) : batchHtml(checked, { premium });
  $('#result').hidden = false;
  $('#placeholder').hidden = true;
  $('#step3').classList.add('done');
  renderActions(checked.some((e) => e.result));
  $('#printMeta').textContent = `FormaCheck Prüfbericht · ${new Date().toLocaleDateString('de-CH')} · Vorgaben: ${summaryText()}`;
}

/** PDF-Export (Premium): nutzt den Druckdialog des Browsers, Ziel «Als PDF speichern». */
function renderActions(hasResult) {
  const el = $('#reportActions');
  el.hidden = !hasResult;
  el.innerHTML = isPremium()
    ? '<button id="exportPdf" class="secondary" type="button">Als PDF speichern</button><span class="hint">Im Druckdialog «Als PDF speichern» wählen.</span>'
    : `<a class="locked-row" href="#premium" data-goto-premium>${LOCK_ICON}<span>Prüfbericht als PDF speichern</span><span class="pill">Premium</span></a>`;
}

let ignoredFiles = 0; // Gratis: weitere ausgewählte Dateien, die nicht geprüft werden
let selectedFiles = []; // letzte Auswahl, damit nach dem Freischalten alle Dateien geprüft werden können

function updateFileNotice() {
  const notice = $('#fileNotice');
  const show = ignoredFiles > 0 && !isPremium();
  notice.hidden = !show;
  notice.innerHTML = show ? `${LOCK_ICON}<span>Mehrere Dateien gleichzeitig prüfen ist Premium. Geprüft wird nur «${esc(entries[0].name)}».</span> <a href="#premium" data-goto-premium>Premium ansehen</a>` : '';
}

async function handleFiles(fileList) {
  const all = [...fileList];
  if (all.length === 0) return;
  selectedFiles = all;
  // Gratis: nur eine Datei, die übrigen werden mit Hinweis ignoriert.
  const files = isPremium() ? all : all.slice(0, 1);
  ignoredFiles = all.length - files.length;
  entries = await Promise.all(files.map(parseEntry));
  $('#fileName').textContent = entries.length === 1 ? entries[0].name : `${entries.length} Dateien ausgewählt`;
  $('#run').disabled = false;
  updateFileNotice();
  render();
  $('#step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Start ----------
function init() {
  const select = $('#preset');
  const saved = loadRules();
  if (saved) { writeRules(saved); renderPresetOptions('custom'); } else { writeRules({ ...PRESETS[DEFAULT_PRESET].rules, ignoreSpecial: true }); renderPresetOptions(DEFAULT_PRESET); }
  renderPremium();
  renderProfileTools();
  updateSummary();

  select.addEventListener('change', () => {
    const v = select.value;
    if (PRESETS[v]) writeRules({ ...PRESETS[v].rules, ignoreSpecial: $('#ignoreSpecial').checked });
    else if (v.startsWith('profile:')) { const p = getProfile(v.slice(8)); if (p) writeRules(p.rules); }
    saveRules(); updateSummary(); renderProfileTools(); render();
  });
  $('#rules').addEventListener('input', (e) => {
    if (e.target.id === 'profileName') return;
    renderPresetOptions('custom'); saveRules(); updateSummary();
  });
  $('#rules').addEventListener('change', (e) => { if (e.target.id !== 'profileName') render(); });
  const saveCurrentAsProfile = () => {
    const name = $('#profileName').value.trim().slice(0, 60);
    if (saveProfile(name, readRules())) { renderPresetOptions(`profile:${name}`); renderProfileTools(); }
  };
  // Enter im Namensfeld speichert das Profil statt das Formular abzuschicken.
  $('#rules').addEventListener('submit', (e) => { e.preventDefault(); if (document.activeElement?.id === 'profileName') saveCurrentAsProfile(); });
  $('#rules').addEventListener('click', (e) => {
    if (e.target.id === 'saveProfile') saveCurrentAsProfile();
    if (e.target.id === 'deleteProfile' && deleteProfile(select.value.slice(8))) { renderPresetOptions('custom'); renderProfileTools(); }
  });

  $('#run').addEventListener('click', () => { render(); $('#step3').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  // Wert zurücksetzen, damit dieselbe Auswahl erneut ein change-Ereignis auslöst.
  $('#file').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; handleFiles(files); });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

  // Lizenz eingeben / entfernen (Formular wird neu gerendert, deshalb am Container abfangen)
  $('#premium').addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id !== 'licenseForm') return;
    if (activate($('#licenseKey').value)) refreshPremiumUi();
    else renderPremium('Der Schlüssel ist ungültig. Prüfe ihn auf Tippfehler (Format FMCK-XXXX-XXXX-XXXX) oder ob der Browser das Speichern erlaubt.');
  });
  $('#premium').addEventListener('click', (e) => { if (e.target.id === 'removeLicense') { deactivate(); refreshPremiumUi(); } });

  // Sprung zum Premium-Bereich aus gesperrten Stellen
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-goto-premium]')) { e.preventDefault(); $('#premium').scrollIntoView({ behavior: 'smooth' }); }
    if (e.target.id === 'exportPdf') window.print();
  });
  // In der Druckansicht müssen aufklappbare Bereiche offen sein.
  window.addEventListener('beforeprint', () => document.querySelectorAll('#result details').forEach((d) => { d.open = true; }));
}

init();
