// Vorgaben-Presets. Die Werte sind gängige Beispiele, keine offiziellen Hochschulvorgaben:
// Nutzer:innen passen sie im Formular an die Vorgaben ihrer Dozierenden an.
const margins = (top, bottom, left, right) => ({ top, bottom, left, right });

export const PRESETS = {
  standard: {
    label: 'Standard (Times New Roman 12 pt, 1,5-fach, 2,5 cm)',
    rules: { font: 'Times New Roman', size: 12, lineSpacing: 1.5, marginsCm: margins(2.5, 2.5, 2.5, 2.5), minWords: null, maxWords: null, minPages: null, maxPages: null },
  },
  arial: {
    label: 'Arial 11 pt, 1,5-fach, 2,5 cm',
    rules: { font: 'Arial', size: 11, lineSpacing: 1.5, marginsCm: margins(2.5, 2.5, 2.5, 2.5), minWords: null, maxWords: null, minPages: null, maxPages: null },
  },
  korrektur: {
    label: 'Times New Roman 12 pt, 1,5-fach, links 3 cm / rechts 2 cm',
    rules: { font: 'Times New Roman', size: 12, lineSpacing: 1.5, marginsCm: margins(2.5, 2.5, 3, 2), minWords: null, maxWords: null, minPages: null, maxPages: null },
  },
};
export const DEFAULT_PRESET = 'standard';
