# Verifyxr

Abgabe-Checker für wissenschaftliche Arbeiten (client-seitig, .docx). Alles läuft lokal im Browser, es gibt kein Backend.

## Entwicklung

```
npm install
npm run dev       # lokaler Dev-Server
npm run build     # statischer Build nach dist/
npm test          # Tests für Parser und Checker
npm run inspect -- fixtures/beispiel.docx   # rohe OOXML-Werte + aufgelöste Stil-Vererbung
npm run make-fixture                        # Beispiel-.docx neu erzeugen (python-docx)
```

## Deployment

Jeder Push auf `main` baut die Seite und veröffentlicht sie per GitHub Actions auf GitHub Pages
(`.github/workflows/deploy.yml`). In den Repo-Einstellungen muss unter *Settings → Pages* die
Quelle auf *GitHub Actions* stehen. `vite.config.js` nutzt `base: './'`, deshalb läuft der Build
auch unter dem Repo-Unterpfad.

## Struktur

- `src/lib/docx-parser.js`: .docx entpacken, Stile auflösen, Absätze/Abschnitte/Seiten
- `src/lib/checker.js`: Vorgaben gegen Dokument prüfen
- `src/lib/presets.js`: Vorgaben-Presets
- `src/main.js`: UI
