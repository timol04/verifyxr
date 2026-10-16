// Lokale Lizenzprüfung (kein Server). Format: FMCK-XXXX-XXXX-XXXX
//   - 8 Zeichen Nutzlast (zufällig) + 4 Zeichen Prüfsumme über Nutzlast und SALT
//   - gültig = Format stimmt und Prüfsumme passt
import { premiumAvailable } from '../config.js';

// Bewusst keine echte Piraterie-Sicherung: SALT und Algorithmus stehen im ausgelieferten
// JavaScript. Das ist eine leichte Hürde, kein Kopierschutz.

// Ohne mehrdeutige Zeichen (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'FMCK';
const SALT = 'formacheck-2026-v1';
const STORAGE_KEY = 'formacheck:license';

/** FNV-1a (32 Bit) über SALT + Nutzlast, abgebildet auf 4 Zeichen (20 Bit). */
function checksum(payload) {
  let h = 0x811c9dc5;
  for (const ch of SALT + payload) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let n = h % 32 ** 4;
  let out = '';
  for (let i = 0; i < 4; i++) { out = ALPHABET[n % 32] + out; n = Math.floor(n / 32); }
  return out;
}

const format = (body12) => `${PREFIX}-${body12.slice(0, 4)}-${body12.slice(4, 8)}-${body12.slice(8, 12)}`;

/** Erzeugt einen gültigen Schlüssel. `randomInt(max)` liefert eine ganze Zahl in [0, max). */
export function generateKey(randomInt = (max) => Math.floor(Math.random() * max)) {
  let payload = '';
  for (let i = 0; i < 8; i++) payload += ALPHABET[randomInt(32)];
  return format(payload + checksum(payload));
}

/** Normalisiert Eingaben (Gross-/Kleinschreibung, Leerzeichen, fehlende Bindestriche). Gibt null zurück, wenn ungültig. */
export function validateKey(input) {
  const raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!raw.startsWith(PREFIX)) return null;
  const body = raw.slice(PREFIX.length);
  if (!/^[A-HJ-NP-Z2-9]{12}$/.test(body)) return null;
  return checksum(body.slice(0, 8)) === body.slice(8) ? format(body) : null;
}

// localStorage kann fehlen oder werfen (privater Modus): immer abfangen.
export function getStoredKey() {
  try { return validateKey(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}
// Premium gilt nur, wenn es angeboten wird (Schalter in config.js) und ein gültiger Schlüssel gespeichert ist.
export const isPremium = () => premiumAvailable() && getStoredKey() !== null;

/** Prüft und speichert den Schlüssel. true bei Erfolg. */
export function activate(input) {
  const key = validateKey(input);
  if (!key) return false;
  try { localStorage.setItem(STORAGE_KEY, key); } catch { return false; } // Speicher gesperrt: Freischaltung wäre nicht dauerhaft
  return true;
}
export function deactivate() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* egal */ }
}
