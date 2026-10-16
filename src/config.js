// Zentrale Einstellungen, die vor dem Deployment angepasst werden.

// Kauf-Seite bei Lemon Squeezy (Checkout-Link des Produkts hier eintragen).
export const UPGRADE_URL = 'https://lemonsqueezy.com/';

// Preis nur zur Anzeige im UI.
export const PRICE_LABEL = 'ca. 5 CHF einmalig';

// Zentraler Premium-Schalter. Solange false, sind Premium-Bereich, Schlüsselfeld, Upgrade-Button und
// Schloss-Symbole im öffentlichen Auftritt unsichtbar und alle Premium-Funktionen gesperrt.
// Der Premium-Code bleibt vollständig erhalten: zum Livegang hier auf true setzen.
export const PREMIUM_ENABLED = false;

// Versteckter Testweg, wirkt nur im eigenen Browser (localStorage):
//   Seite mit ?premium-test=1 öffnen -> Premium sichtbar, ?premium-test=0 -> wieder aus.
const TEST_KEY = 'formacheck:premium-test';

/** Liest den URL-Parameter und merkt ihn im Browser. Beim Start einmal aufrufen. */
export function applyPremiumTestParam() {
  try {
    const v = new URLSearchParams(location.search).get('premium-test');
    if (v === '1') localStorage.setItem(TEST_KEY, '1');
    if (v === '0') localStorage.removeItem(TEST_KEY);
  } catch { /* Speicher gesperrt: Testmodus nicht verfügbar */ }
}

export function isPremiumTestMode() {
  try { return localStorage.getItem(TEST_KEY) === '1'; } catch { return false; }
}

/** true, wenn Premium (Bereich, Sperren, Funktionen) angeboten wird. */
export const premiumAvailable = () => PREMIUM_ENABLED || isPremiumTestMode();
