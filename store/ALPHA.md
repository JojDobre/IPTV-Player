# Alfa verzia v Google Play – postup krok za krokom

Alfa = **Uzavreté testovanie** (Closed testing) v Play Console. Appku uvidia iba ľudia, ktorých pozveš.

## 1. Podpisový kľúč (raz, na tvojom počítači)

Kľúčom sa podpisuje každá verzia. **Nestrať ho a nikomu ho neposielaj** – bez neho nevydáš aktualizáciu.
Ulož si ho aj s heslom na bezpečné miesto (napr. správca hesiel + záloha).

`keytool` je súčasťou Javy (JDK). V termináli / príkazovom riadku:

```
keytool -genkeypair -v -keystore vysielac-release.jks -alias vysielac -keyalg RSA -keysize 4096 -validity 10000
```

Zadáš heslo a meno (stačí tvoje meno, ostatné môžeš preskočiť Enterom).

Prevod na text pre GitHub:

* Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("vysielac-release.jks")) | Set-Clipboard`
* macOS: `base64 -i vysielac-release.jks | pbcopy`
* Linux: `base64 -w0 vysielac-release.jks`

## 2. Tajomstvá v GitHube

GitHub → repozitár **IPTV-Player** → Settings → Secrets and variables → Actions → **New repository secret**:

| Názov | Hodnota |
|---|---|
| `ANDROID_KEYSTORE_B64` | text z kroku 1 (base64) |
| `ANDROID_KEYSTORE_PASSWORD` | heslo ku kľúču |
| `ANDROID_KEY_ALIAS` | `vysielac` |
| `ANDROID_KEY_PASSWORD` | to isté heslo (ak si pri vytváraní nezadal iné) |

Potom v GitHube → Actions → „Android“ → **Run workflow** (alebo mi napíš a spustím to novým pushom).
Pri behu pribudne artefakt **vysielac-release** so súborom `vysielac-X.Y.Z.aab` – ten nahráš do Play.

## 3. Zásady ochrany súkromia (GitHub Pages)

GitHub → Settings → Pages → Source: **Deploy from a branch**, Branch: **main**, priečinok **/docs** → Save.
Po minúte bude stránka na `https://jojdobre.github.io/IPTV-Player/privacy.html` – tento odkaz dáš do Play Console.

## 4. Play Console

1. **Vytvoriť aplikáciu**: názov „Vysielač – IPTV prehrávač“, predvolený jazyk slovenčina, Aplikácia, Zadarmo.
2. **Nastavenie aplikácie** (Dashboard → „Set up your app“) – vyplň podľa `store/LISTING.md`:
   * Zásady ochrany súkromia → odkaz z kroku 3
   * Prístup k aplikácii → „Všetky funkcie sú dostupné bez obmedzení“
     (pozor: recenzent nemá playlist; do poznámky napíš, že appka je prehrávač pre vlastný M3U playlist používateľa)
   * Reklamy → Nie
   * Hodnotenie obsahu (IARC), Cieľové publikum (18+, nie pre deti), Bezpečnosť údajov – odpovede sú v `LISTING.md`
   * Vládne aplikácie / finančné / zdravotné → Nie
3. **Záznam v obchode**: texty z `LISTING.md`, ikona `store/icon-512.png`, hlavný obrázok a snímky zo `store/sk/`
   (anglický preklad: Pridať preklad → angličtina, `store/en/`).
4. **Testovanie → Uzavreté testovanie → Vytvoriť stopu** (napr. „Alfa“):
   * Testeri → vytvor e-mailový zoznam a pridaj adresy (Google účty testerov)
   * Vytvoriť vydanie → **Podpisovanie aplikácií Google Play** nechaj zapnuté → nahraj `.aab`
   * Poznámky k vydaniu – nižšie
   * Krajiny → Slovensko, Česko (alebo všetky)
   * Skontrolovať a odoslať na kontrolu (prvá kontrola trvá zvyčajne pár dní)
5. Testerom pošli **odkaz na pripojenie k testu** (je na stránke stopy) – po prihlásení si appku stiahnu z Play.

**Nový osobný vývojársky účet:** Google pred vydaním do produkcie vyžaduje uzavretý test
s aspoň **12 testermi počas 14 dní** po sebe. Alfa je teda zároveň splnenie tejto podmienky – čím skôr začne, tým lepšie.

**Android TV:** v Play Console → Nastavenie → Rozšírené nastavenia → Formáty → pridaj **Android TV**.
TV verzia prechádza samostatnou kontrolou (potrebuje snímky `store/sk/tv-*.png` a banner – appka ho už má).

## Poznámky k vydaniu

```
<sk-SK>
Prvá testovacia verzia. Pridaj svoj playlist (M3U) a program (XMLTV), alebo ho pošli z mobilu cez QR kód.
Ak niečo nefunguje, napíš nám – pomôže snímka obrazovky alebo technické info z prehrávača.
</sk-SK>
<en-US>
First test version. Add your playlist (M3U) and guide (XMLTV), or send it from your phone with a QR code.
If something does not work, let us know – a screenshot or the technical info from the player helps.
</en-US>
```

## Pred každou ďalšou verziou

Číslo verzie stúpa samo (1000 + číslo behu v GitHub Actions), názov verzie berie z `package.json`.
Novú verziu stačí nahrať do tej istej stopy ako nové vydanie.
