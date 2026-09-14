# User Stories

Historie požadavků na projekt, v pořadí, jak vznikaly. Tohle **není** živě
přepisovaná specifikace — je to log. Když nová story mění chování popsané ve
starší story, stará story zůstává zapsaná tak, jak byla zadaná, jen se jí
změní `Stav` na `Nahrazena US-n — důvod`. Viz `CLAUDE.md` pro pravidla.

---

## US-1 — Přímé spoje mezi dvěma zastávkami v reálném čase

**Jako** cestující MHD **chci** vidět seznam přímých spojů (bez přestupu)
mezi zastávkou Zelený pruh a Poliklinika Budějovická, seřazený podle
zbývajícího času do odjezdu a reflektující aktuální polohu vozidla, **abych**
věděl, kdy vyrazit na zastávku, bez nutnosti dívat se na mapu.

**Akceptační kritéria**
- Zobrazí se seznam odjezdů seřazený vzestupně podle predikovaného odjezdu.
- Zahrnuté jsou jen linky/směry, které skutečně jedou přímo mezi danými
  zastávkami — zjištěno analýzou statického jízdního řádu PID (GTFS):
  linka 114 (směr Šeberák), 134 (směr Podolská vodárna / Poliklinika
  Budějovická), noční 914 (směr Poliklinika Budějovická / Vinoř).
- Zdroj dat: Golemio API, `/v2/pid/departureboards`, s uživatelovým vlastním
  API klíčem.
- Bez mapy — jen textový seznam.

**Stav:** Aktivní — základ, na kterém stojí vše další. Konkrétní pevná
dvojice zastávek a ručně zjištěný seznam linek v akceptačních kritériích je
nahrazený US-6 (uživatel si dvojici volí sám, linky se dopočítávají
automaticky); řazení podle času, filtr jen na přímé spoje a absence mapy
platí beze změny dál.

---

## US-2 — Odpočet do odjezdu na vteřiny

**Jako** uživatel **chci**, aby se čas do odjezdu odpočítával plynule po
vteřinách, ne skokově po celých minutách, **abych** měl lepší představu, jak
moc si můžu pospíšit.

**Akceptační kritéria**
- Countdown se dopočítává na klientovi z `departure_timestamp.predicted`
  (přesný ISO čas), ne ze zaokrouhleného pole `minutes` od serveru.
- Server se dotazuje jen jednou za ~20 s; mezi dotazy countdown tiká lokálně
  každou vteřinu.
- Uživatel je informován, že vteřinová přesnost zobrazení neznamená
  vteřinovou přesnost predikce příjezdu — jde o plynulost, ne záruku.

**Stav:** Aktivní — rozšiřuje US-1.

---

## US-3 — Spustitelnost appky mimo náhled Claude artefaktu

**Jako** uživatel appky spuštěné v Claude.ai **chci**, aby appka fungovala i
přesto, že síťová volání na cizí API (`api.golemio.cz`) jsou v náhledu
artefaktu blokovaná sandboxem, **abych** appku mohl reálně používat.

**Akceptační kritéria (v době zadání)**
- Appka jasně rozliší chybu způsobenou sandboxem od jiných síťových chyb.
- Uživatel dostane instrukci stáhnout appku a otevřít ji jako lokální soubor
  přímo v prohlížeči, mimo náhled chatu.

**Stav:** Nahrazena US-4 — po přesunu na standalone statický projekt appka
už nikdy neběží uvnitř sandboxu Claude artefaktu, takže tohle omezení a jeho
detekce jsou bezpředmětné. Kód pro rozlišení sandboxové chyby byl při
refaktoringu v US-4 odstraněný.

---

## US-4 — Standalone PWA projekt a git repozitář

**Jako** vývojář **chci** mít appku jako standardní statický vícesouborový
web s git repozitářem a připravenou jako PWA, **abych** na ní mohl dál
iterovat, verzovat ji a nasadit na GitHub Pages.

**Akceptační kritéria**
- Rozdělení jednoho HTML souboru na `index.html` / `style.css` / `config.js`
  / `app.js`.
- `manifest.webmanifest` + `sw.js` (service worker cachující jen statický
  app shell, nikdy odpovědi z `golemio.cz`) + sada ikon (zatím placeholder).
- `README.md` s návodem na lokální spuštění, nasazení a údržbu seznamu
  povolených linek v `config.js`.
- Ukládání API klíče přes `localStorage` misto `window.storage`.

**Stav:** Aktivní. Zneplatňuje způsob ukládání klíče z US-1
(`window.storage` → `localStorage`, protože `window.storage` mimo Claude
artefakt neexistuje) a činí US-3 bezpředmětnou.

**Známý dluh:** ikony v `icons/` jsou narychlo vygenerovaný placeholder, ne
promyšlený design. ~~Config zatím počítá jen s jednou dvojicí zastávek.~~
Vyřešeno US-6 — appka teď umí libovolnou dvojici zastávek zvolenou v UI.

---

## US-5 — Projektová dokumentace a proces práce

**Jako** vývojář pracující s Claude Code na tomhle projektu **chci** mít
`CLAUDE.md` s instrukcemi pro Claude Code a `user-stories.md` jako průběžně
rostoucí log požadavků, **abych** měl konzistentní kontext napříč sezeními a
aby nová práce nerozbíjela záměrná rozhodnutí z předchozích story.

**Akceptační kritéria**
- `CLAUDE.md` existuje a obsahuje: přehled projektu, tech stack, kritická
  fakta, která se nemají bezdůvodně měnit, a pravidla pro práci s
  `user-stories.md`.
- `user-stories.md` existuje, obsahuje US-1 až US-5 popisující dosavadní
  vývoj a je připravený na přidávání dalších story.

**Stav:** Aktivní — tenhle dokument je jeho vlastním výstupem.

---

## US-6 — Výběr dvojice zastávek s automatickým dopočtem linek

Jako uživatel chci mít možnost si vybrat dvojici stanic, mezi kterými mě
zajímají spoje. Aplikace se postará automaticky o to, že udělá vše potřebné,
aby změnila příslušnou konfiguraci, načetla aktuální seznam linek a vše
potřebné k tomu, aby pak mohla zobrazit seznam všech spojů v blízké době tak,
jak to činila doposud. Při dalším příchodu do aplikace se budou zobrazovat
aktuální odjezdy naposledy nastavené dvojice stanice.

**Akceptační kritéria**
- V appce je obrazovka pro výběr zastávek (Odkud/Kam) s vyhledáváním podle
  názvu (autocomplete), použitá vždy, když ještě není žádná dvojice uložená.
- Po zvolení dvojice appka sama dopočítá, které linky/směry mezi nimi jezdí
  přímo — z GTFS static dat Golemio API, bez ručního zásahu do `config.js`.
- Pokud mezi zvolenou dvojicí nejede žádný přímý spoj, appka to srozumitelně
  oznámí a nechá uživatele zvolit jinou dvojici, místo aby spadla nebo
  zobrazila prázdný/matoucí stav.
- Po úspěšném dopočtu appka rovnou přejde na zobrazení odjezdů, stejné jako
  dosavadní chování (řazení podle zbývajícího času, jen přímé spoje).
- Vybraná dvojice (a její dopočtený seznam linek) se uloží do `localStorage`.
  Při dalším spuštění appky se použije rovnou, bez opětovného dopočtu.
- V hlavní obrazovce je možnost dvojici změnit (tlačítko "změnit zastávky"),
  které vrátí uživatele na výběr zastávek.

**Stav:** Aktivní.

---

## US-7 — Vyhledávání zastávek necitlivé na velikost písmen s postupným našeptáváním

Netuším, jaké jsou možnosti, ale v současném řešení je potřeba zadávat názvy
stanic naprosto exaktně včetně velkých písmen. Očekával bych, že to bude case
insensitive a že od zadání prvních několika písmen bude k dispozici nějaké
našeptávání.

**Akceptační kritéria**
- Zadávání názvu zastávky v polích Odkud/Kam nerozlišuje velká a malá
  písmena.
- Návrh zastávek (autocomplete) se nabízí už od zadání několika prvních
  písmen názvu — nemusí jít o přesný začátek řetězce.
- Existující chování (výběr ze seznamu, tlačítko "Zjistit spoje", uložení
  dvojice) zůstává funkčně stejné.

**Stav:** Aktivní.

---

<!--
Šablona pro novou story — zkopíruj a vyplň:

## US-n — Krátký název

**Jako** ... **chci** ... **abych** ...

**Akceptační kritéria**
- ...

**Stav:** Aktivní / Nahrazena US-x — důvod
-->
