// Gespeicherte Format-Profile (Premium), lokal im Browser. Ein Profil = Name + Rules-Objekt.
const KEY = 'formacheck:profiles';

// localStorage kann fehlen oder werfen (privater Modus): immer abfangen.
function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list.filter((p) => p && typeof p.name === 'string' && p.rules) : [];
  } catch { return []; }
}
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } };

export const listProfiles = () => read().sort((a, b) => a.name.localeCompare(b.name, 'de'));

/** Speichert (oder überschreibt) ein Profil. Gibt false zurück, wenn der Name leer ist oder der Speicher gesperrt ist. */
export function saveProfile(name, rules) {
  const clean = name.trim().slice(0, 60);
  if (!clean) return false;
  return write([...read().filter((p) => p.name !== clean), { name: clean, rules }]);
}
export const deleteProfile = (name) => write(read().filter((p) => p.name !== name));
export const getProfile = (name) => read().find((p) => p.name === name);
