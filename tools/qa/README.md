# Testy celej appky (Playwright)

Spusti `node tools/fake-provider.js <priečinok s médiami>` (port 9001) a `npm run build && node server/server.js` (port 8080), potom:

* `node tools/qa/phone.js` – mobil na výšku aj na šírku: zoom programu dvoma prstami, panely zdola, prehrávač, potiahnutia, otočenie
* `node tools/qa/tv.js` – Android TV iba ovládačom (1920×1080 a 1280×720): sprievodca, menu, prehrávač, panely, program, nastavenia

* `node tools/qa/xfer.js <port>` – prenos kanálov a kategórií PC → mobil (Android appka simulovaná, relay z Relay.java na <port>) → ďalšie zariadenie
* `node tools/qa/lang.js` – angličtina ako predvolený jazyk, jazyk zvuku a titulkov, posun času programu
* `node tools/qa/short.js` – nízky mobil: celá časť pod obrazom sa posúva

Každý riadok je `ok` alebo `FAIL`, na konci `ALL OK`.
