# Verifyxr

Abgabe-Checker für wissenschaftliche Arbeiten (client-seitig, .docx). Setup folgt im PR.

## Entwicklung

```
npm install
npm run dev       # lokaler Dev-Server
npm run build     # statischer Build nach dist/
npm run inspect -- fixtures/beispiel.docx   # rohe OOXML-Werte + aufgelöste Stil-Vererbung
npm run make-fixture                        # Beispiel-.docx neu erzeugen (python-docx)
```
