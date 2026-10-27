# Google Play – podklady

Grafika v tomto priečinku (vytvára ju `node tools/store-shots.cjs` z ukážkového režimu s vymyslenými kanálmi):

| Súbor | Kam v Play Console |
|---|---|
| `icon-512.png` | Ikona aplikácie (512 × 512) |
| `sk/`, `en/` | Sady pre slovenský a anglický záznam v obchode |
| `*/feature-1024x500.png` | Hlavný obrázok (feature graphic) |
| `*/phone-1…7.png` | Snímky obrazovky – telefón (1080 × 1920, posledná 1920 × 1080) |
| `*/tv-1…4.png` | Snímky obrazovky – Android TV (1920 × 1080), aj 7" a 10" tablet |

Zásady ochrany súkromia: `https://jojdobre.github.io/IPTV-Player/privacy.html` (súbor `docs/privacy.html`).

Pozor na pravidlá Google Play pre IPTV: v popise, snímkach ani v názve nesmú byť skutočné TV stanice, ich logá ani
odkazy na playlisty. Appka nič nevysiela, len prehráva playlist používateľa – presne tak to aj píšeme.

---

## Slovensky (preklad – predvolený jazyk záznamu je angličtina)

**Názov (max 30):** OnAir – IPTV prehrávač

**Krátky popis (max 80):** Tvoj IPTV playlist ako moderná televízia. TV program, archív, mobil aj Android TV.

**Úplný popis (max 4000):**

OnAir je moderný prehrávač IPTV pre mobil, tablet a Android TV. Pridáš svoj playlist (M3U) a program (XMLTV)
a dostaneš prehľadnú televíziu s veľkými kartami kanálov, TV programom a plynulým prehrávaním.

DÔLEŽITÉ: OnAir neobsahuje ani neposkytuje žiadne kanály. Potrebuješ vlastný playlist od svojho poskytovateľa IPTV.

★ Plynulé prehrávanie
• Natívny prehrávač s hardvérovým dekódovaním: H.264, HEVC, MPEG-2, zvuk AAC, AC3, E-AC3, MP2
• HLS aj MPEG-TS, automatické obnovenie spojenia pri výpadku
• Na Android TV prepnutie obrazovky na 50 Hz podľa vysielania – plynulý pohyb pri športe

★ TV program a archív
• Prehľadný TV program po dňoch, priblíženie dvoma prstami
• Pozeranie od začiatku a z archívu (ak ho poskytovateľ podporuje)
• Pozastavenie a pretáčanie živého vysielania
• Hľadanie relácií v celom programe a pripomienky

★ Pohodlné ovládanie
• Na mobile obraz hore a zoznam kanálov pod ním, na šírku celá obrazovka s veľkými tlačidlami
• Dvojité ťuknutie: ±30 sekúnd, potiahnutie: ďalší kanál
• Na TV ovládač: šípky, čísla kanálov, CH+/CH−, farebné tlačidlá
• Malé okienko počas prehliadania a okno nad ostatnými aplikáciami
• Dva kanály naraz vedľa seba

★ Prispôsobenie
• Obľúbené kanály vo veľkých kartách, vlastné kategórie a poradie kanálov – prenesieš ich do ďalšieho zariadenia cez QR kód
• Zvuk a titulky automaticky v jazyku zariadenia, výber z viac ako 30 jazykov
• Rodičovský zámok s PIN-om, časovač vypnutia

★ Súkromie
Bez registrácie, bez reklám a bez sledovania. Playlist a nastavenia ostávajú iba v tvojom zariadení.

**Kategória:** Video prehrávače a editory · **Štítky:** IPTV, prehrávač, TV program

---

## English (default language)

**Title:** OnAir – IPTV Player

**Short description:** Your IPTV playlist as a modern TV. Programme guide, catch-up, phone and Android TV.

**Full description:**

OnAir is a modern IPTV player for phones, tablets and Android TV. Add your own playlist (M3U) and guide (XMLTV)
and get a clean TV experience with large channel cards, a programme guide and smooth playback.

IMPORTANT: OnAir does not include or provide any channels. You need your own playlist from your IPTV provider.

• Native player with hardware decoding: H.264, HEVC, MPEG-2; AAC, AC3, E-AC3, MP2 audio; HLS and MPEG-TS
• Programme guide by day with pinch zoom, catch-up and restart (when your provider supports it)
• Pause and rewind live TV, search the whole guide, reminders
• Phone layout with the picture on top and channels below; full-screen landscape controls; double-tap ±30 s
• Android TV remote: arrows, channel numbers, CH+/CH−, colour keys; 50 Hz refresh-rate matching
• Mini player, picture-in-picture, two channels side by side
• Favourites, custom categories and channel order – move them to another device with a QR code
• Audio and subtitles in your device's language automatically, 30+ languages to choose from
• Guide time shift, parental PIN, sleep timer
• No account, no ads, no tracking. Your playlist and settings stay on your device.

---

## Formulár „Bezpečnosť údajov“ (Data safety)

* Zhromažďuje appka údaje? **Nie.**
* Zdieľa údaje s tretími stranami? **Nie.**
* Šifrovanie pri prenose: appka sa pripája na adresy používateľa (často http) – zaškrtni podľa skutočnosti: „nie všetky údaje sa prenášajú šifrovane“ sa týka len streamov od poskytovateľa, nie údajov o používateľovi.
* Možnosť vymazať údaje: áno (odinštalovanie / vymazanie úložiska).

## Hodnotenie obsahu (IARC)

Kategória „Nástroje / prehrávač“, appka sama neobsahuje násilie ani iný obsah → najnižšie hodnotenie. Pri otázke
„Môžu používatelia pristupovať k obsahu z internetu, ktorý appka nekontroluje?“ odpovedz **áno** (vlastný playlist).
