// Lizenzschlüssel erzeugen oder prüfen.
//   npm run license              -> 1 neuer Schlüssel
//   npm run license -- 10        -> 10 neue Schlüssel
//   npm run license -- check KEY -> Schlüssel prüfen
import { randomInt } from 'node:crypto';
import { generateKey, validateKey } from '../src/lib/license.js';

const [arg, key] = process.argv.slice(2);
if (arg === 'check') {
  const valid = validateKey(key);
  console.log(valid ? `gültig: ${valid}` : 'ungültig');
  process.exit(valid ? 0 : 1);
}
const count = Math.max(1, Number.parseInt(arg ?? '1', 10) || 1);
for (let i = 0; i < count; i++) console.log(generateKey(randomInt));
