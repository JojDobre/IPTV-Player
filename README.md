# Vysielač

IPTV prehrávač pre TV, PC a mobil. Vložíš M3U odkaz od svojho poskytovateľa a pozeráš živé vysielanie,
program (EPG), archív a prepínaš zvukové stopy a titulky.

Táto verzia beží **na PC v prehliadači** (Chrome alebo Edge). Verzie pre LG TV (webOS) a Android box prídu ďalej
a použijú rovnaký kód.

## Spustenie na PC

1. Nainštaluj **Node.js** (verzia LTS) z <https://nodejs.org>.
2. Spusti:
   - **Windows:** dvojklik na `start-windows.bat`
   - **Mac / Linux:** `./start-mac-linux.sh`
3. Otvorí sa prehliadač na adrese <http://localhost:8080>. V **Nastaveniach → Playlist → Pridať playlist** vlož svoj M3U odkaz
   (alebo údaje Xtream Codes). Program (EPG) sa načíta sám, ak ho playlist obsahuje; inak jeho adresu doplníš v tom istom okne.

Prvé spustenie nainštaluje knižnice a pripraví aplikáciu, potom už štartuje hneď. Okno s čiernym terminálom nechaj otvorené,
to je lokálny server. Zatvorením okna (alebo Ctrl+C) appku vypneš.

Ručne to isté: `npm install`, `npm run build`, `npm start`.

### Prečo lokálny server

Prehliadač sám nepustí väčšinu IPTV serverov (chýbajú im hlavičky CORS, idú cez `http`, niektoré vyžadujú vlastný User-Agent).
Server v `server/` beží len na tvojom PC, posiela požiadavky za prehliadač a nič neukladá ani neodosiela inam.

### Zvuk AC3 / E-AC3 (odporúčané: ffmpeg)

Veľa slovenských a českých kanálov má zvuk AC3 alebo E-AC3, ktorý Chrome nevie prehrať. Ak je na PC nainštalovaný
**ffmpeg**, server pri takom kanáli automaticky prekonvertuje **len zvuk** na AAC (video zostáva bez zmeny, procesor to takmer nezaťaží).

- Windows: `winget install ffmpeg` (alebo stiahni z <https://ffmpeg.org>) a reštartuj appku
- Mac: `brew install ffmpeg`
- Linux: `sudo apt install ffmpeg`

Bez ffmpeg takýto kanál ukáže hlásenie „Kanál sa nedá prehrať“ s vysvetlením. Na TV to nevadí, TV si s AC3 poradí sama.

### Z mobilu alebo iného zariadenia doma

Kým beží server na PC, otvor na mobile adresu, ktorú server vypíše ako „V domácej sieti“ (napr. `http://192.168.1.20:8080`).

## Ovládanie

Šípky, Enter (OK), Esc/Backspace (Späť), čísla 0–9 prepnú na kanál. V prehrávači: ↑ ↓ (alebo PageUp/PageDown) kanál,
← zoznam kanálov, → program kanála, OK ovládanie, medzerník pauza, L posledný kanál. Pomoc: kláves `?`.

## Ako je zabezpečené, aby to nesekalo

- **Prehrávanie:** HLS cez hls.js, MPEG-TS cez mpegts.js (na TV vstavaný hardvérový prehrávač). Buffer 30 s dopredu,
  až 15 minút dozadu pri HLS (pauza a pretáčanie živého vysielania).
- **Strážca obrazu:** keď sa obraz zastaví, appka najprv preskočí drobné medzery v bufferi, potom sa sama znova pripojí
  (postupne dlhšie pauzy, pri bežiacom kanáli až 8 pokusov). Kanál, ktorý vôbec nenaštartuje, ohlási chybu do pár sekúnd.
- **Archív:** pretáčanie za hranicu bufferu prepne na archív poskytovateľa, ak ho kanál má (`catchup` v playliste:
  default, append, shift, flussonic, Xtream). Kanály bez archívu to povedia rovno.
- **Veľké playlisty:** M3U aj EPG sa sťahujú a spracúvajú na pozadí (Web Worker), EPG po kúskoch (aj 100+ MB, aj `.gz`).
  Všetko sa ukladá v zariadení (IndexedDB). Dlhé zoznamy a sprievodca vykresľujú len to, čo je vidieť.
  Otestované s 10 000 kanálmi a 480 000 reláciami: štart z úložiska pod 1 s, pohyb šípkami 5–15 ms.
- Playlist sa obnovuje každých 12 h, program každých 8 h, ručne cez **Nastavenia → Obnoviť**.

## Pre vývoj

```
npm install
npm run dev        # vývojový server s okamžitým prekreslením na http://localhost:5173
npm test           # testy parserov (M3U, XMLTV, archív) a servera
```

Testovací „poskytovateľ“ bez skutočného predplatného:

```
tools/make-test-media.sh /tmp/iptv-test
node tools/fake-provider.js /tmp/iptv-test     # potom v appke playlist http://127.0.0.1:9001/playlist.m3u
```

Štruktúra:

- `src/app.js` rozhranie, navigácia diaľkovým ovládačom, prehrávač
- `src/player/engine.js` prehrávací engine (hls.js / mpegts.js / natívny), strážca, obnovenie spojenia, stopy
- `src/data/` M3U parser, XMLTV parser, archív (catch-up), úložisko, práca na pozadí
- `server/` lokálny server pre PC (statické súbory + `/api/*` sprostredkovateľ)
- `design/prototype.html` pôvodný klikací návrh
