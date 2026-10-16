# FormaCheck

FormaCheck: Format-Prüfung für wissenschaftliche Arbeiten (client-seitig, .docx). Alles läuft lokal im Browser, es gibt kein Backend.

## Lokal starten

```
npm install
npm run dev       # Dev-Server (Adresse steht im Terminal)
npm test          # Tests für Parser, Checker, APA-Modul und Lizenz
```

## Für Deployment bauen

```
npm run build     # statischer Build nach dist/
npm run preview   # Build lokal ansehen
```

`dist/` ist reine Statik und lässt sich auf GitHub Pages, Netlify oder Vercel hosten.
Jeder Push auf `main` baut und veröffentlicht die Seite per GitHub Actions auf GitHub Pages
(`.github/workflows/deploy.yml`). In den Repo-Einstellungen muss unter *Settings → Pages* die
Quelle auf *GitHub Actions* stehen. `vite.config.js` nutzt `base: './'`, deshalb läuft der Build
auch unter einem Repo-Unterpfad.

Vor dem Livegang in `src/config.js` den Lemon-Squeezy-Checkout-Link (`UPGRADE_URL`) eintragen.

## Lizenzschlüssel (Premium)

Premium wird lokal freigeschaltet: Der Schlüssel (`FMCK-XXXX-XXXX-XXXX`) besteht aus 8 zufälligen
Zeichen und einer Prüfsumme (4 Zeichen). Die App prüft nur Format und Prüfsumme und speichert den
gültigen Schlüssel in `localStorage`. Es gibt keinen Server und keine Online-Prüfung.

```
npm run license                      # einen neuen Schlüssel erzeugen
npm run license -- 25                # 25 Schlüssel erzeugen (z.B. als Vorrat für Lemon Squeezy)
npm run license -- check FMCK-....   # einen Schlüssel prüfen
```

Die Schlüssel in Lemon Squeezy als Lizenzschlüssel-Vorrat hinterlegen, so erhalten Käufer:innen
automatisch einen. **Hinweis:** SALT und Algorithmus (`src/lib/license.js`) stehen im ausgelieferten
JavaScript. Wer will, kann Schlüssel nachbauen oder den Check umgehen. Das ist bewusst nur eine
leichte Hürde. Wer den SALT ändert, macht alle bisher erzeugten Schlüssel ungültig.

## Aufbau

- `src/lib/docx-parser.js`: .docx entpacken (jszip), Stile auflösen, Absätze, Abschnitte, Seiten
- `src/lib/checker.js`: Format-Prüfung gegen die Vorgaben (Gratis)
- `src/lib/apa.js`: APA-7-Zitierkonsistenz und Verzeichnis-Format (Premium)
- `src/lib/license.js`, `src/lib/profiles.js`: Lizenz und gespeicherte Profile (localStorage)
- `src/ui/report.js`: HTML des Prüfberichts; `src/main.js`: Verdrahtung der Seite
- `scripts/inspect-docx.mjs`: rohe OOXML-Werte einer Datei ausgeben (`npm run inspect -- datei.docx`)
- `scripts/make-fixture*.py`: erzeugen die Test-Dokumente in `fixtures/` (`npm run make-fixture`)

## Premium-Funktionen

- **APA 7:** erkennt Zitationen (Autor, Zwei Autoren, et al., Mehrfachzitation, Fliesstext, 2020a)
  und gleicht sie mit dem Literaturverzeichnis ab. Das Verzeichnis beginnt bei einer Überschrift
  *Literaturverzeichnis*, *Quellenverzeichnis*, *Literatur*, *References* oder *Bibliography*.
  Eindeutige Inkonsistenzen sind Fehler, unsichere Befunde (Title Case, et al.) sind Hinweise.
- **Profile:** werden im Browser gespeichert (pro Gerät und Browser, nicht synchronisiert).
- **PDF-Export:** öffnet den Druckdialog, dort «Als PDF speichern» wählen. Gedruckt wird nur der Bericht.
- **Batch:** mehrere .docx auswählen, Übersicht plus Einzelberichte.

## Bekannte Grenzen

- Seitenzahlen sind ohne Layout-Engine eine Näherung. Genau sind sie nur, wenn Word sie beim Speichern
  in die Datei geschrieben hat; sonst werden nur harte Seitenumbrüche gezählt.
- Tabellen werden für Wortzahl gezählt, aber nicht auf Fliesstext-Format geprüft.
- Fest eingestellter Zeilenabstand in Punkt wird nur als Hinweis gemeldet.
- APA: Eigennamen in Titeln, komplexe Sonderfälle und Zitationen in Fussnoten werden nicht erkannt.
