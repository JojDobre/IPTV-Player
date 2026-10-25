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

Ak Chrome nevie ani obraz (HEVC bez hardvérovej podpory, staršie MPEG-2 z DVB), server prekonvertuje aj obraz na H.264.
To už zaťaží procesor (pri 1080p približne ako prehrávanie videa v programe na strih). Hlásenie pri chybe vypíše, aké kodeky kanál má.

Bez ffmpeg takýto kanál ukáže hlásenie „Kanál sa nedá prehrať“ s vysvetlením. Na TV to nevadí, TV si s AC3, HEVC aj MPEG-2 poradí sama.

### Z mobilu alebo iného zariadenia doma

Kým beží server na PC, otvor na mobile adresu, ktorú server vypíše ako „V domácej sieti“ (napr. `http://192.168.1.20:8080`).

## Ovládanie

Šípky, Enter (OK), Esc/Backspace (Späť), čísla 0–9 prepnú na kanál. V prehrávači: ↑ ↓ (alebo PageUp/PageDown) kanál,
← zoznam kanálov, → program kanála, OK ovládanie, medzerník pauza, L posledný kanál, P malé okienko (na TV červené),
D štatistiky prehrávania (na TV modré). Pomoc: kláves `?`.

**Malé okienko:** kanál sa zmenší do rohu a hrá ďalej, kým prechádzaš appku. CH+/CH− v ňom prepína kanály, kliknutie
alebo P ho vráti na celú obrazovku. Na PC ide z okienka spraviť aj okno nad ostatnými aplikáciami.

## Funkcie navyše

- **Nahrávanie** (PC s ffmpeg): v programe OK na budúcej relácii → Nahrať, podržanie OK na kanáli → Nahrať reláciu,
  alebo ⏺ v prehrávači. Nahráva lokálny server aj keď je prehliadač či TV vypnutá, súbory sú v `recordings/`
  (MP4, všetky zvukové stopy). Pozor: ak poskytovateľ povoľuje len jedno pripojenie, počas nahrávania nepôjde iný kanál.
- **Dva obrazy:** v ovládaní „Dva obrazy“ → vyber druhý kanál. ← → prepína, ktorý obraz má zvuk a ovládanie, Späť vráti jeden.
- **Časovač vypnutia:** 15 min až 2 h alebo do konca relácie, minútu pred koncom sa dá predĺžiť.
- **Rodičovský zámok:** Nastavenia → Rodičovský zámok. PIN na celé kategórie alebo jednotlivé kanály (podržať OK na kanáli).
- **Program po dňoch** (včera, dnes, zajtra…) a **hľadanie v celom programe** s pripomienkou alebo nahrávaním.
- **Nastavenia prehrávača:** po spustení pokračovať naposledy pozeraným kanálom, Späť zmenší kanál do okienka.

## Ako je zabezpečené, aby to nesekalo

- **Prehrávanie:** HLS cez hls.js, MPEG-TS cez mpegts.js (na TV vstavaný hardvérový prehrávač). Buffer 30 s dopredu,
  až 15 minút dozadu pri HLS (pauza a pretáčanie živého vysielania).
- **Rezerva:** obraz sa pustí až s 2 s načítanými dopredu. Po každom zaseknutí sa rezerva zväčší (až na 8 s).
  Štatistiky (kláves D) ukazujú rezervu, zaseknutia a zahodené snímky.
- **Strážca obrazu:** keď sa obraz zastaví, appka najprv preskočí drobné medzery v bufferi, potom sa sama znova pripojí
  (postupne dlhšie pauzy, pri bežiacom kanáli až 8 pokusov). Kanál, ktorý vôbec nenaštartuje, ohlási chybu do pár sekúnd.
- **Archív:** pretáčanie za hranicu bufferu prepne na archív poskytovateľa, ak ho kanál má (`catchup` v playliste:
  default, append, shift, flussonic, Xtream). Kanály bez archívu to povedia rovno.
- **Veľké playlisty:** M3U aj EPG sa sťahujú a spracúvajú na pozadí (Web Worker), EPG po kúskoch (aj 100+ MB, aj `.gz`).
  Všetko sa ukladá v zariadení (IndexedDB). Dlhé zoznamy a sprievodca vykresľujú len to, čo je vidieť.
  Otestované s 10 000 kanálmi a 480 000 reláciami: štart z úložiska pod 1 s, pohyb šípkami 5–15 ms.
- Playlist sa obnovuje každých 12 h, program každých 8 h, ručne cez **Nastavenia → Obnoviť**.

## Android (mobil, tablet, Android TV) – testovacia verzia

Každá zmena na GitHube sa sama zostaví do APK: **Releases → „Android – testovacia verzia“ → vysielac.apk**.
Stiahni ho priamo v telefóne alebo TV boxe a nainštaluj (Android sa raz spýta na povolenie inštalácie z neznámych zdrojov).
Ďalšie verzie sa nainštalujú cez staré, nastavenia ostanú.

- Appka nepotrebuje PC: rovnaký relay ako `npm start` beží priamo v nej (`android/…/Relay.java`).
- Na TV boxe sa ukáže v zozname aplikácií pre TV; ovládač funguje vrátane Späť, CH+/CH−, ⏯, ⏪ ⏩, červeného a modrého tlačidla.
- Prehráva natívny **ExoPlayer** (Media3): hardvérové dekódovanie H.264, HEVC a na TV boxoch aj MPEG-2,
  zvuk AC3, E-AC3 a MP2 aj na mobiloch bez Dolby dekodéra (softvérový dekodér FFmpeg). HLS aj MPEG-TS priamo.
  Obraz sa kreslí pod stránkou, ovládanie appky ostáva rovnaké. Štatistiky (D / modré) ukážu kodeky.
- Nahrávanie zatiaľ len na PC (ffmpeg).

Ručná stavba (s Android Studio / SDK): `npm run build && npx cap sync android && cd android && ./gradlew assembleDebug`.

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
