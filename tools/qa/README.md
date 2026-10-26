# Testy celej appky (Playwright)

Spusti `node tools/fake-provider.js <priečinok s médiami>` (port 9001) a `npm run build && node server/server.js` (port 8080), potom:

* `node tools/qa/phone.js` – mobil na výšku aj na šírku: zoom programu dvoma prstami, panely zdola, prehrávač, potiahnutia, otočenie
* `node tools/qa/tv.js` – Android TV iba ovládačom (1920×1080 a 1280×720): sprievodca, menu, prehrávač, panely, program, nastavenia

Každý riadok je `ok` alebo `FAIL`, na konci `ALL OK`.
