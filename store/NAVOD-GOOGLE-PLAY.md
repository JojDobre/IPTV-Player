# OnAir v Google Play – celý návod a všetky texty

Poradie: **A** príprava (raz) → **B** vytvorenie appky → **C** formuláre „Obsah aplikácie“ → **D** záznam v obchode →
**E** uzavretý test (alfa) → **F** produkcia.

---

## A. Príprava (raz)

### A1. Vývojársky účet
1. https://play.google.com/console → prihlás sa Google účtom, ktorý chceš používať natrvalo.
2. Typ účtu: **Osobný** (stačí) → poplatok **25 USD** jednorazovo.
3. Overenie totožnosti (doklad) a overenie telefónu / e-mailu. Trvá od pár hodín po pár dní.
4. Osobný účet: verejné meno vývojára sa zobrazí v obchode (môžeš dať napr. „OnAir“ alebo svoje meno).

**Podmienka pre nové osobné účty:** pred vydaním pre všetkých musí appka prejsť **uzavretým testom s aspoň 12 testermi,
ktorí ju majú nainštalovanú 14 dní za sebou**. Preto najprv alfa (časť E), produkcia až potom (časť F).

### A2. Podpisový kľúč (na tvojom počítači)
Potrebuješ Javu (JDK, napr. „Temurin“). V termináli / PowerShelli:

```
keytool -genkeypair -v -keystore onair-release.jks -alias onair -keyalg RSA -keysize 4096 -validity 10000
```

Zadáš heslo (zapamätaj si ho) a meno, ostatné môžeš odklepnúť Enterom.
**Súbor `onair-release.jks` a heslo si zálohuj (napr. správca hesiel + USB). Nikomu ho neposielaj.**

Prevod súboru na text:
* Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("onair-release.jks")) | Set-Clipboard`
* macOS: `base64 -i onair-release.jks | pbcopy`
* Linux: `base64 -w0 onair-release.jks`

### A3. Tajomstvá v GitHube
GitHub → **JojDobre/IPTV-Player** → Settings → Secrets and variables → Actions → **New repository secret** (4×):

| Name | Secret |
|---|---|
| `ANDROID_KEYSTORE_B64` | text z A2 (base64) |
| `ANDROID_KEYSTORE_PASSWORD` | heslo kľúča |
| `ANDROID_KEY_ALIAS` | `onair` |
| `ANDROID_KEY_PASSWORD` | to isté heslo |

Potom Actions → **Android** → **Run workflow** → po dobehnutí v behu dole „Artifacts“ → **vysielac-release** (zip)
→ v ňom `vysielac-X.Y.Z.aab`. Tento súbor nahráš do Google Play.

### A4. Zásady ochrany súkromia (GitHub Pages)
GitHub → Settings → **Pages** → Source: *Deploy from a branch* → Branch **main**, priečinok **/docs** → Save.
Po 1–2 minútach otvor https://jojdobre.github.io/IPTV-Player/privacy.html – musí sa zobraziť stránka.

---

## B. Vytvorenie appky (Play Console → Vytvoriť aplikáciu)

| Pole | Vyplň |
|---|---|
| Názov aplikácie | `OnAir – IPTV Player` |
| Predvolený jazyk | **English (United States) – en-US** |
| Aplikácia alebo hra | **Aplikácia** |
| Bezplatná alebo platená | **Bezplatná** |
| Vyhlásenia | zaškrtni obe (pravidlá pre vývojárov, exportné zákony USA) |

---

## C. Obsah aplikácie (Policy → App content / „Nastavte svoju aplikáciu“)

### C1. Pravidlá ochrany súkromia
`https://jojdobre.github.io/IPTV-Player/privacy.html`

### C2. Prístup k aplikácii
Vyber **„Všetky alebo niektoré funkcie sú obmedzené“** → Pridať pokyny:
* Názov: `Playlist needed`
* Používateľské meno / heslo: nechaj prázdne (appka nemá prihlásenie)
* Ďalšie pokyny (vlož):

```
OnAir is a player only. It contains no channels and has no account or login.
To test it, add any M3U playlist: Settings → Playlist → Add playlist → paste the playlist URL.
Test playlist with legally free streams: <SEM DAJ ODKAZ NA SVOJ TESTOVACÍ PLAYLIST>
The app also works on Android TV with the remote (arrows, OK, Back).
```

Ak recenzent nemá čo pustiť, appku často zamietne. Daj mu odkaz na playlist s **legálne voľne dostupnými** streamami.
Nikdy nedávaj platený playlist od poskytovateľa.

### C3. Reklamy
**Nie, moja aplikácia neobsahuje reklamy.**

### C4. Hodnotenie obsahu (dotazník IARC)
* E-mail: tvoj
* Kategória: **Všetky ostatné typy aplikácií** (nie hra, nie sociálna sieť)
* Násilie, sex, vulgarizmy, drogy, hazard: **Nie**
* Môžu sa používatelia navzájom kontaktovať / zdieľať obsah? **Nie**
* Zdieľa appka polohu? **Nie**
* Nákupy v aplikácii? **Nie**
* Prístup k neobmedzenému obsahu z internetu (prehliadač / obsah, ktorý appka nekontroluje)? **Áno**
  (používateľ si pridáva vlastný playlist)

Výsledok býva PEGI 3 až PEGI 12. To je v poriadku.

### C5. Cieľové publikum
* Vekové skupiny: **18 a viac** (len táto)
* Môže appka zaujať deti? **Nie**

### C6. Spravodajská aplikácia
**Nie**

### C7. Bezpečnosť údajov (Data safety)
* Zhromažďuje alebo zdieľa appka niektorý z požadovaných typov údajov? **Nie**
* Šifrovanie pri prenose: táto otázka sa pri „Nie“ nezobrazí.
* Odstránenie účtu: appka nemá účty.

Zdôvodnenie (pre teba): playlist, nastavenia aj história ostávajú iba v zariadení. Appka nemá analytiku ani reklamy
a nič neposiela vývojárovi. QR kódy číta skener Google Play služieb priamo v zariadení. Prenos medzi zariadeniami
ide iba v domácej sieti.

### C8. Ďalšie vyhlásenia
* Vládna aplikácia: **Nie**
* Finančné funkcie: **Nemám žiadne**
* Zdravie: **Nie**
* Advertising ID (reklamný identifikátor): **Nie**
* Funkcie na pozadí / popredí (foreground service): ak sa objaví, **Nie** (appka žiadnu nepoužíva)

---

## D. Záznam v obchode (Grow → Store presence → Main store listing)

### D1. Nastavenia obchodu (Store settings)
* Kategória: **Video players & editors** (Video prehrávače a editory)
* Štítky (Tags): `Video players`, `Streaming` (vyber z ponuky, ak sú)
* Kontaktný e-mail: tvoj (povinný, verejný)
* Web: `https://github.com/JojDobre/IPTV-Player` (nepovinné)

### D2. Texty – angličtina (predvolený jazyk)

**App name (max 30):**
```
OnAir – IPTV Player
```

**Short description (max 80):**
```
Your IPTV playlist as a modern TV: guide, catch-up, phone and Android TV.
```

**Full description (max 4000):**
```
OnAir is a modern IPTV player for phones, tablets and Android TV. Add your own playlist (M3U or Xtream Codes) and programme guide (XMLTV) and get a clean TV experience with large channel cards, a programme guide and smooth playback.

IMPORTANT: OnAir does not include or provide any channels or content. You need your own playlist from your IPTV provider.

★ Smooth playback
• Native player with hardware decoding: H.264, HEVC, MPEG-2; AAC, AC3, E-AC3 and MP2 audio
• HLS and MPEG-TS, automatic reconnection when the stream drops
• On Android TV the screen switches to the broadcast's 50 Hz for smooth motion in sport

★ Programme guide and catch-up
• Clear guide by day, pinch with two fingers to zoom
• Watch from the start and from catch-up (when your provider supports it)
• Pause and rewind live TV
• Search the whole guide, reminders
• Guide time shift if your provider's times are off

★ Easy to use
• On phones: the picture on top, channels below; full screen in landscape with big buttons
• Double-tap for ±30 seconds, swipe for the next channel
• Android TV remote: arrows, channel numbers, CH+/CH−
• Mini player while browsing and a window over other apps
• Two channels side by side

★ Make it yours
• Favourites in big cards, your own categories and channel order
• Move your channels and categories to another device with a QR code
• Audio and subtitles in your device's language automatically, 30+ languages to choose from
• Three looks: Night neon, Liquid glass and Simple
• Parental PIN, sleep timer, text size
• Add more playlists – they merge into one

★ Privacy
No account, no ads, no tracking. Your playlist and settings stay on your device.

OnAir is a player only: you are responsible for the content you add. Use only playlists you have the right to watch.
```

### D3. Texty – slovenčina (Pridať preklad → Slovak – sk-SK)

**Názov:**
```
OnAir – IPTV prehrávač
```

**Krátky popis:**
```
Tvoj IPTV playlist ako moderná TV: program, archív, mobil aj Android TV.
```

**Úplný popis:**
```
OnAir je moderný prehrávač IPTV pre mobil, tablet a Android TV. Pridáš svoj playlist (M3U alebo Xtream Codes) a program (XMLTV) a dostaneš prehľadnú televíziu s veľkými kartami kanálov, TV programom a plynulým prehrávaním.

DÔLEŽITÉ: OnAir neobsahuje ani neposkytuje žiadne kanály ani obsah. Potrebuješ vlastný playlist od svojho poskytovateľa IPTV.

★ Plynulé prehrávanie
• Natívny prehrávač s hardvérovým dekódovaním: H.264, HEVC, MPEG-2, zvuk AAC, AC3, E-AC3 a MP2
• HLS aj MPEG-TS, automatické obnovenie spojenia pri výpadku
• Na Android TV prepnutie obrazovky na 50 Hz podľa vysielania – plynulý pohyb pri športe

★ TV program a archív
• Prehľadný program po dňoch, priblíženie dvoma prstami
• Pozeranie od začiatku a z archívu (ak ho poskytovateľ podporuje)
• Pozastavenie a pretáčanie živého vysielania
• Hľadanie v celom programe, pripomienky
• Posun času programu, ak poskytovateľ posiela zlé časy

★ Pohodlné ovládanie
• Na mobile obraz hore a kanály pod ním, na šírku celá obrazovka s veľkými tlačidlami
• Dvojité ťuknutie ±30 sekúnd, potiahnutie na ďalší kanál
• Ovládač Android TV: šípky, čísla kanálov, CH+/CH−
• Malé okienko počas prehliadania a okno nad ostatnými aplikáciami
• Dva kanály naraz vedľa seba

★ Prispôsobenie
• Obľúbené vo veľkých kartách, vlastné kategórie a poradie kanálov
• Kanály a kategórie prenesieš do ďalšieho zariadenia cez QR kód
• Zvuk a titulky automaticky v jazyku zariadenia, výber z viac ako 30 jazykov
• Tri vzhľady: Nočný neón, Liquid glass a Jednoduchý
• Rodičovský zámok s PIN-om, časovač vypnutia, veľkosť písma
• Viac playlistov – spoja sa do jedného

★ Súkromie
Bez registrácie, bez reklám a bez sledovania. Playlist a nastavenia ostávajú iba v tvojom zariadení.

OnAir je iba prehrávač: za obsah, ktorý doň pridáš, zodpovedáš ty. Používaj len playlisty, na ktoré máš právo.
```

### D4. Grafika (súbory v repozitári, priečinok `store/`)

| V Play Console | EN záznam | SK preklad |
|---|---|---|
| Ikona aplikácie 512×512 | `store/icon-512.png` | (rovnaká) |
| Hlavný obrázok 1024×500 | `store/en/feature-1024x500.png` | `store/sk/feature-1024x500.png` |
| Snímky – telefón (2–8) | `store/en/phone-1…7.png` | `store/sk/phone-1…7.png` |
| Snímky – tablet 7" a 10" | `store/en/tv-1…4.png` | `store/sk/tv-1…4.png` |
| Android TV – snímky | `store/en/tv-1…4.png` | `store/sk/tv-1…4.png` |
| Android TV – banner 1280×720 | `store/tv-banner-1280x720.png` | (rovnaký) |

### D5. Android TV
Play Console → Test and release → Advanced settings → **Form factors** → Add form factor → **Android TV**
→ zaškrtni súhlas s požiadavkami na kvalitu. TV verzia prechádza samostatnou kontrolou: ovládanie len ovládačom,
banner, bez potreby dotyku. Všetko toto appka spĺňa.

---

## E. Uzavretý test – alfa (Test and release → Testing → Closed testing)

1. **Create track** → názov `Alpha`.
2. **Testers** → Create email list → názov `Testeri` → vlož Gmail adresy (aspoň 12 ľudí) → Save → zaškrtni zoznam.
   * Pole „Feedback URL or email address“: tvoj e-mail.
3. **Countries / regions**: Slovakia, Czechia (alebo všetky).
4. **Create new release**:
   * Play App Signing: **nechaj zapnuté (Use Google-generated key)**. Tvoj kľúč z A2 bude „upload key“.
   * App bundles → nahraj `vysielac-X.Y.Z.aab` z A3.
   * Release name: vyplní sa samo (napr. `1012 (0.12.0)`).
   * Release notes:

```
<en-US>
First test version of OnAir. Add your playlist (M3U or Xtream) and guide, or send it from your phone with a QR code.
If something does not work, please let us know – a screenshot or the technical info from the player helps.
</en-US>
<sk-SK>
Prvá testovacia verzia OnAir. Pridaj svoj playlist (M3U alebo Xtream) a program, alebo ho pošli z mobilu cez QR kód.
Ak niečo nefunguje, daj nám vedieť – pomôže snímka obrazovky alebo technické info z prehrávača.
</sk-SK>
```

5. **Next → Save → Send for review** (Publishing overview → Send changes for review). Prvá kontrola trvá 1–7 dní.
6. Po schválení: na stránke stopy Alpha → Testers → **Copy link** (odkaz „Join on the web“) → pošli testerom.
   Tester sa prihlási tým istým Gmailom, potvrdí „Become a tester“ a appku stiahne z Google Play.
7. **14 dní** musí mať aspoň 12 testerov appku nainštalovanú. Medzitým môžeš nahrávať opravy (nové vydanie v tej istej stope).

---

## F. Produkcia (po 14 dňoch)

1. Dashboard → **Apply for production** (Požiadať o prístup k produkcii) → krátky dotazník:
   ako si testoval, koľko testerov, čo si opravil. Odpovedz pravdivo, stačí pár viet.
2. Po schválení: Production → Create new release → **Promote release** z Alpha (alebo nahraj nový .aab).
3. Countries: vyber krajiny → Send for review.

---

## Na čo si dať pozor (najčastejšie dôvody zamietnutia IPTV appiek)

* V názve, popise ani na obrázkoch **nesmú byť skutočné TV stanice, ich logá ani odkazy na playlisty**.
  Naše obrázky majú iba vymyslené kanály.
* Popis musí jasne hovoriť, že appka **neposkytuje obsah**. Je to tam, aj s vetou o zodpovednosti.
* Recenzent musí mať čo pustiť (C2) – inak „nedá sa otestovať“.
* Kľúč z A2 nestrať. Keby sa to stalo, Google vie vymeniť upload key cez podporu (preto nechaj Play App Signing zapnuté).

## Každá ďalšia verzia
Push do `main` → GitHub Actions spraví nový `.aab` (číslo verzie stúpa samo) → Play Console → stopa → Create new release
→ nahraj → poznámky → Send for review.
