// Sicherung der lokalen Daten (Lizenz + Profile) als JSON-Datei, damit sie bei gelöschten
// Website-Daten, Privatmodus oder Gerätewechsel nicht verloren gehen. Alles bleibt lokal.
import { getStoredKey, validateKey } from './license.js';
import { listProfiles } from './profiles.js';

const APP = 'formacheck';
const VERSION = 1;

/** Backup-Objekt aus dem aktuellen Browser-Speicher. */
export function createBackup() {
  return { app: APP, version: VERSION, exportedAt: new Date().toISOString(), license: getStoredKey(), profiles: listProfiles() };
}

export const backupFileName = () => `formacheck-sicherung-${new Date().toISOString().slice(0, 10)}.json`;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => (isNum(v) ? v : null);

/** Übernimmt nur bekannte Felder mit passendem Typ; gibt null zurück, wenn die Pflichtfelder fehlen. */
export function sanitizeRules(r) {
  if (!r || typeof r !== 'object' || typeof r.font !== 'string' || !isNum(r.size) || !isNum(r.lineSpacing) || !r.marginsCm || typeof r.marginsCm !== 'object') return null;
  const m = r.marginsCm;
  return {
    font: r.font.slice(0, 80), size: r.size, lineSpacing: r.lineSpacing,
    marginsCm: { top: numOrNull(m.top), bottom: numOrNull(m.bottom), left: numOrNull(m.left), right: numOrNull(m.right) },
    minWords: numOrNull(r.minWords), maxWords: numOrNull(r.maxWords), minPages: numOrNull(r.minPages), maxPages: numOrNull(r.maxPages),
    ignoreSpecial: r.ignoreSpecial !== false,
  };
}

/**
 * Liest den Text einer Sicherungsdatei. Wirft Error mit verständlicher Meldung bei ungültigem Inhalt.
 * @returns {{ license: string|null, profiles: {name:string, rules:object}[], skipped: number }}
 */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Die Datei ist keine gültige Sicherung (kein JSON).'); }
  if (!data || data.app !== APP) throw new Error('Das ist keine FormaCheck-Sicherung.');
  if (data.version !== VERSION) throw new Error(`Unbekannte Sicherungsversion (${data.version}).`);
  // Die Lizenz wird beim Import neu geprüft, die Datei allein schaltet nichts frei.
  const license = data.license ? validateKey(data.license) : null;
  const profiles = [];
  let skipped = 0;
  for (const p of Array.isArray(data.profiles) ? data.profiles : []) {
    const rules = sanitizeRules(p?.rules);
    if (typeof p?.name === 'string' && p.name.trim() && rules) profiles.push({ name: p.name.trim().slice(0, 60), rules });
    else skipped++;
  }
  if (data.license && !license) skipped++;
  return { license, profiles, skipped };
}
