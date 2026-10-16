// FormaCheck UI: Vorgaben, Upload (einzeln oder Batch), Bericht, Premium-Freischaltung.
// Alles läuft lokal im Browser, es werden keine Dateien übertragen.
import './style.css';
import { parseDocx } from './lib/docx-parser.js';
import { checkDocument } from './lib/checker.js';
import { checkApa } from './lib/apa.js';
import { PRESETS, DEFAULT_PRESET } from './lib/presets.js';
import { isPremium, activate, deactivate, getStoredKey } from './lib/license.js';
import { listProfiles, saveProfile, deleteProfile, getProfile } from './lib/profiles.js';
import { createBackup, backupFileName, parseBackup } from './lib/backup.js';
import { UPGRADE_URL, PRICE_LABEL, PREMIUM_ENABLED, premiumAvailable, isPremiumTestMode, applyPremiumTestParam } from './config.js';
import { esc, reportHtml, batchHtml, lockedBlock, LOCK_ICON } from './ui/report.js';

const $ = (sel) => document.querySelector(sel);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
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
  if (!premiumAvailable()) { el.innerHTML = ''; return; }
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

/** Sicherung: Export nur mit Premium, Import immer (um Lizenz und Profile wiederherzustellen). */
function backupHtml(premium) {
  return `<div class="backup">
    <p class="hint"><strong>Deine Daten liegen nur in diesem Browser.</strong> Lizenz und Profile gehen verloren, wenn du Website-Daten löschst, den privaten Modus nutzt oder das Gerät wechselst. ${premium ? 'Sichere sie als Datei und stelle sie bei Bedarf wieder her.' : 'Schon gekauft? Stelle deine Daten aus einer Sicherung wieder her.'}</p>
    <div class="backup-actions">
      ${premium ? '<button id="exportBackup" class="secondary" type="button">Sicherung herunterladen</button>' : ''}
      <label class="secondary file-btn">Sicherung wiederherstellen<input id="importBackup" type="file" accept=".json,application/json" /></label>
    </div>
    <p id="backupMsg" class="license-msg" role="status"></p>
  </div>`;
}

function renderPremium(message = '') {
  const el = $('#premium');
  // Premium ist abgeschaltet (config.js): Bereich komplett ausblenden.
  el.hidden = !premiumAvailable();
  if (el.hidden) { el.innerHTML = ''; return; }
  const testNote = isPremiumTestMode() && !PREMIUM_ENABLED ? '<p class="test-note">Testmodus: Premium ist nur in diesem Browser sichtbar. <a href="?premium-test=0">Testmodus beenden</a></p>' : '';
  if (isPremium()) {
    const key = getStoredKey();
    el.innerHTML = `${testNote}<div class="premium-active">
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="currentColor"/><path d="M8.5 14.5l4 4 7-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div><h2 id="h-premium">Premium ist aktiv</h2><p>Lizenz ${esc(key.slice(0, 9))}…${esc(key.slice(-4))} auf diesem Gerät gespeichert.</p></div>
      <button id="removeLicense" class="secondary" type="button">Lizenz entfernen</button></div>
      ${backupHtml(true)}`;
    return;
  }
  el.innerHTML = `${testNote}<h2 id="h-premium">FormaCheck Premium <span class="pill">${esc(PRICE_LABEL)}</span></h2>
    <ul class="features">${FEATURES.map((f) => `<li>${LOCK_ICON}<span>${esc(f)}</span></li>`).join('')}</ul>
    <div class="premium-actions">
      <a class="primary link" href="${esc(UPGRADE_URL)}" target="_blank" rel="noopener">Premium kaufen</a>
      <form id="licenseForm" class="license-form">
        <label class="field">Lizenzschlüssel <input id="licenseKey" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="FMCK-XXXX-XXXX-XXXX" /></label>
        <button type="submit" class="secondary">Freischalten</button>
      </form>
    </div>
    <p id="licenseMsg" class="license-msg" role="status">${esc(message)}</p>
    <p class="hint">Die Prüfung des Schlüssels läuft lokal im Browser. Es wird nichts übertragen.</p>
    ${backupHtml(false)}`;
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
  const opts = { premium, locks: premiumAvailable() };
  $('#result').innerHTML = checked.length === 1 ? reportHtml(checked[0], opts) : batchHtml(checked, opts);
  $('#result').hidden = false;
  $('#placeholder').hidden = true;
  $('#step3').classList.add('done');
  renderActions(checked.some((e) => e.result));
  $('#printMeta').textContent = `FormaCheck Prüfbericht · ${new Date().toLocaleDateString('de-CH')} · Vorgaben: ${summaryText()}`;
}

/** PDF-Export (Premium): nutzt den Druckdialog des Browsers, Ziel «Als PDF speichern». */
function renderActions(hasResult) {
  const el = $('#reportActions');
  el.hidden = !hasResult || !premiumAvailable();
  el.innerHTML = isPremium()
    ? '<button id="exportPdf" class="secondary" type="button">Als PDF speichern</button><span class="hint">Im Druckdialog «Als PDF speichern» wählen.</span>'
    : `<a class="locked-row" href="#premium" data-goto-premium>${LOCK_ICON}<span>Prüfbericht als PDF speichern</span><span class="pill">Premium</span></a>`;
}

let ignoredFiles = 0; // Gratis: weitere ausgewählte Dateien, die nicht geprüft werden
let selectedFiles = []; // letzte Auswahl, damit nach dem Freischalten alle Dateien geprüft werden können

function updateFileNotice() {
  const notice = $('#fileNotice');
  const show = ignoredFiles > 0 && premiumAvailable() && !isPremium();
  notice.hidden = !show;
  notice.innerHTML = show ? `${LOCK_ICON}<span>Mehrere Dateien gleichzeitig prüfen ist Premium. Geprüft wird nur «${esc(entries[0].name)}».</span> <a href="#premium" data-goto-premium>Premium ansehen</a>` : '';
}

async function handleFiles(fileList) {
  const all = [...fileList];
  if (all.length === 0) return;
  selectedFiles = all;
  // Gratis: nur eine Datei, die übrigen werden mit Hinweis ignoriert.
  const files = isPremium() ? all : all.slice(0, 1);
  ignoredFiles = premiumAvailable() ? all.length - files.length : 0; // ohne Premium-Angebot still nur die erste Datei
  entries = await Promise.all(files.map(parseEntry));
  $('#fileName').textContent = entries.length === 1 ? entries[0].name : `${entries.length} Dateien ausgewählt`;
  $('#run').disabled = false;
  updateFileNotice();
  render();
  $('#step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Start ----------
function init() {
  applyPremiumTestParam();
  $('#file').multiple = premiumAvailable();
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

  // Sicherung herunterladen / wiederherstellen
  $('#premium').addEventListener('click', (e) => {
    if (e.target.id !== 'exportBackup') return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(createBackup(), null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: backupFileName() });
    a.click();
    URL.revokeObjectURL(url);
  });
  $('#premium').addEventListener('change', async (e) => {
    if (e.target.id !== 'importBackup') return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { license, profiles, skipped } = parseBackup(await file.text());
      if (license) activate(license);
      let saved = 0;
      for (const p of profiles) if (saveProfile(p.name, p.rules)) saved++;
      refreshPremiumUi();
      const parts = [license ? 'Lizenz' : null, saved ? plural(saved, 'Profil', 'Profile') : null].filter(Boolean);
      $('#backupMsg').style.color = 'var(--ok)';
      $('#backupMsg').textContent = `${parts.length ? `Wiederhergestellt: ${parts.join(' und ')}.` : 'Die Sicherung enthielt keine nutzbaren Daten.'}${skipped ? ` ${plural(skipped, 'Eintrag', 'Einträge')} übersprungen (ungültig).` : ''}`;
    } catch (err) {
      $('#backupMsg').style.color = 'var(--fail)';
      $('#backupMsg').textContent = err.message;
    }
  });

  // Sprung zum Premium-Bereich aus gesperrten Stellen
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-goto-premium]')) { e.preventDefault(); $('#premium').scrollIntoView({ behavior: 'smooth' }); }
    if (e.target.id === 'exportPdf') window.print();
  });
  // In der Druckansicht müssen aufklappbare Bereiche offen sein.
  window.addEventListener('beforeprint', () => document.querySelectorAll('#result details').forEach((d) => { d.open = true; }));
}

init();
