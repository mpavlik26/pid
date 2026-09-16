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

## US-8 — Polishing informací u každého spoje

Další story - US-8 - by měla být o polishingu informací, které bych chtěl
vidět u každého spoje.

Věci, které tam jsou už teď:

* linka - odlišil bych druhy dopravních prostředků (vlak, tramvaj, metro,
  autobus, trolejbus, přívoz, ....)
* cílová stanice (nechal bych obsahově stejně, jak máme nyní)
* odjezdové stanoviště (nechal bych stejně)
* odpočet včetně vteřin (nechal bych stejně (tj. i včetně informace o tom, že
  spoj už odjel))

Mix existujících a nových věcí:

* čas odjezdu a zpoždení
   * zobrazoval bych čas odjezdu (výrazněji / větším fontem než je dnes)
     podle jízdního řádu (vč. vteřin), k tomu zpoždění (vč. vteřin) a k tomu
     výsledný očekávaný čas odjezdu (vč. vteřin)
* čas příjezdu do druhé zastávky
   * zobrazoval bych čas příjezdu dle jízdního řádu (vč. vteřin), zpoždění je
     stejné s odjezdem (nezobrazoval bych jej 2x) a k tomu očekávaný výsledný
     čas
* informace o tom, před jakou dobou máme poslední informace o poloze
  vozidla, pokud je tato informace vůbec k dispozici:
   * s tím souvisí lepší zachycení informací o tom, jestli je údaj na
     základě polohy vozidla nebo je to jen čistě podle jízdního řádu

**Akceptační kritéria**
- U každého spoje se zobrazuje ikona druhu dopravního prostředku (tramvaj,
  metro, vlak, autobus, přívoz, lanovka, trolejbus) odvozená z GTFS
  `route.type`, vedle/nad číslem linky.
- Cílová stanice, odjezdové stanoviště a countdown (vč. vteřin a stavu
  "odjel") zůstávají beze změny oproti dosavadnímu chování.
- Zobrazuje se čas odjezdu podle jízdního řádu (vč. vteřin), zpoždění
  (vč. vteřin) a výsledný očekávaný čas odjezdu, výrazněji než dosavadní
  drobný `.sched` řádek.
- Zobrazuje se čas příjezdu do cílové zastávky podle jízdního řádu
  (vč. vteřin) a výsledný očekávaný čas příjezdu; zpoždění se u příjezdu
  nezobrazuje znovu (je stejné jako u odjezdu).
- U spojů se sledovanou polohou (`delay.is_available`) se zobrazuje, před
  jakou dobou byla naposledy zjištěna poloha vozidla; u spojů bez sledování
  polohy appka jasně uvádí, že jde jen o údaj podle jízdního řádu.
- Stáří polohy vozidla se ověřuje znovu při každém refreshi seznamu spojů
  (ne jen jednou při prvním zjištění) pro všechny aktuálně sledované spoje
  se sledovanou polohou — sekvenčně, s pauzou kvůli Golemio rate limitu;
  úvodní vykreslení spojů na to nečeká.
- Dokud nedorazí nová hodnota, zůstává na UI vidět naposledy známé stáří
  (dál plynule tiká) — text "poloha: zjišťuji…" se zobrazuje jen při úplně
  prvním zjišťování polohy daného spoje, ne při každém následném refreshi.
  Pokud opakovaný dotaz selže u spoje, který už má dřív zjištěnou polohu,
  appka ponechá poslední známou hodnotu místo přepnutí na "neznámá".
- Auto-refresh dat z `departureboards` je nastavený na 30 s (dřív 20 s).

**Stav:** Aktivní.

---

## US-9 — Verze appky viditelná ve spodní části obrazovky

Ted by se mi libilo, kdyby ve spodni casti obrazovky byla k dispozici verze,
aby bylo mozne vzdy bezpecne zjistit, jestli se divam na spravnou nejnovejsi
verzi.

**Akceptační kritéria**
- Ve spodní části obrazovky (footer) je vždy viditelné označení verze appky.
- Číslo/označení verze je jediný zdroj pravdy sdílený s `CACHE_NAME` v
  `sw.js` — bump verze při deploi tak stačí udělat na jednom místě a projeví
  se zároveň v UI i v cache busting mechanismu.
- Podle zobrazené verze lze bezpečně poznat, jestli prohlížeč servíruje
  aktuální nasazenou verzi, nebo starou cachovanou appku.

**Stav:** Aktivní.

---

## US-10 — Přeuspořádání údajů o zpoždění, odjezdu a příjezdu

V rámci nové story US-10 bych chtěl přeuspořádat údaje o zpoždění, odjezdu a
příjezdu. Stručnou představu o designu přikládám. Je potřeba explicitně
zmínit edge case, kdy příjezdový čas je dotahován až formou lazy loadu
později a není k dispozici.

Proti současnému chování bych ale potřeboval i jednu změnu aplikační logiky
s tím související:

* pokud jede spoj s náskokem, měl by být náskok viditelný podobně jako
  zpoždění (tedy podobně jako je při zpoždění zobrazováno +0:20 červeně by
  při náskoku mělo být zobrazováno -0:20 při dvacetivteřinovém náskoku
  modře)
   * zároveň platí, že náskok by neměl být započítáván do příjezdového
     času. Tedy pokud jede spoj s náskokem 20s, tak pro účely výpočtu
     příjezdu se to bere tak, že do cíle přijede včas. Zpoždění se
     samozřejmě přičítat musí (tak, jako to teď).

Přiložený náčrtek (přepis rukopisu):

```
15:37:20 odjezd  =>  15:38:40
        ↓
     +1:20
        ↓
15:43:40 příjezd  =>  15:45:00
```

**Akceptační kritéria**
- Zpoždění se zobrazuje jako samostatný řádek mezi časem odjezdu a
  příjezdu (ne inline u odjezdu, jako dřív), protože platí pro oba.
- Kladné zpoždění se zobrazuje jako `+m:ss` červeně (beze změny). Záporné
  (spoj jede s náskokem) se nově zobrazuje jako `−m:ss` modře, místo aby
  zmizelo pod "na čas". Nulové/neznámé zpoždění zůstává "na čas" bez barvy.
- Výpočet očekávaného času příjezdu do cílové zastávky zpoždění nadále
  přičítá, ale náskok do něj nezapočítává — spoj s náskokem má v appce
  vypočtený příjezd podle jízdního řádu, ne dřív.
- Dokud appka ještě nedotáhla statický jízdní řád cílové zastávky (lazy
  load, viz US-8), zobrazuje se u příjezdu explicitně
  "čas příjezdu: zjišťuji…"; pokud se po dotažení pro daný spoj nenajde
  záznam, zobrazuje se "čas příjezdu: nedostupný" — místo dosavadního
  tichého "–" v obou případech.
- Jakmile se dotažení dokončí (úspěšně i neúspěšně), appka zobrazené spoje
  rovnou přerenderuje, aby uživatel na výsledek nečekal až do dalšího
  auto-refreshe.

**Stav:** Aktivní.

---

## US-10-bug-fixes — Oprava: čas příjezdu se nikdy nenačte

Tohle není nová user story, ale záznam opravy chyby v chování zadaném v
US-10 (lazy load příjezdového času) — zapsáno jako reference na branch
`US-10-bug-fixes`.

Hlášení uživatele (doslovné znění):

> Kdyz si s appkou hraji, tak vidim, ze zlobi nacitani casu prijezdu.
> Nefunguje ani lazy loading. Prijezdovy cas se proste nedonacte. Vsechno
> ostatni je v pohode (vcetne informace o tom, jak je stara informace o
> aktualni poloze vozu).

**Příčina:** `loadDestinationArrivals()` (US-8) se volala přesně jednou při
nastavení dvojice zastávek, souběžně s dalšími požadavky sdílejícími Golemio
rate limit (`fetchDepartures()`, první `refreshVehiclePositions()`). Jediné
přechodné selhání (např. kolize s rate limitem hned po startu appky) natrvalo
vypnulo dotahování příjezdového času pro zbytek session, bez jakékoli další
šance — na rozdíl od polohy vozidla, která se zkouší znovu při každém
refreshi a při selhání jen ponechá poslední známou hodnotu.

**Oprava**
- `destinationArrivalsLoaded` se nastaví na `true` jen po úspěšném načtení,
  ne po každém pokusu (dřív se nastavovalo vždy, i po chybě).
- Dokud se načtení nepovede, `fetchDepartures()` ho při každém auto-refreshi
  (stejná 30s kadence jako u polohy vozidla) zkusí znovu — žádný nový časovač.
- Přidán `destinationArrivalsInFlight` (ochrana proti souběžným pokusům) a
  `arrivalsGeneration` (při změně dvojice zastávek se doběhnutí starého,
  ještě běžícího pokusu pozná jako zastaralé a jeho výsledek se zahodí,
  místo aby přepsal už načtená data nové dvojice).
- Chyba 401/403 (neplatný API klíč) se řeší stejně jako jinde v appce —
  vrátí uživatele na obrazovku zadání klíče.

**Stav:** Opraveno.

---

## US-11 — Chytré hospodaření s Golemio rate limitem

Moc by se mi líbilo, kdyby appka obecně fungovala tak, že půjde na hranu
nějakých procent limitů rate limittingu. Tedy kdyby si počítala počet
requestů v daném okně a chytře s nimi hospodařila. A tím chytře míním to, že
by se ptala častěji, když může (protože se do limitu v pohodě vejde) a
zároveň se na chvíli dotazování zastavilo, pokud narazíme na "virtuální"
nebo i tvrdý 429 limit.

**Akceptační kritéria**

- Appka počítá požadavky na Golemio v rolling okně 8 s (limit klíče:
  20 req/8 s) sdíleně napříč VŠEMI voláními (odjezdy, poloha vozidla,
  dopočet povolených linek, příjezdové časy) — ne izolovaně po funkcích.
- Dokud je v okně volná kapacita (do ~90 % tvrdého limitu), appka se ptá
  ihned, bez umělé pevné pauzy mezi requesty.
- Po dosažení měkkého limitu appka počká jen tak dlouho, dokud nejstarší
  request z okna nevypadne — ne o víc.
- Na HTTP 429 appka počká (podle `Retry-After` headeru, jinak celé okno) a
  automaticky požadavek zopakuje (max. 3 pokusy), místo aby rovnou celou
  operaci shodila jako obecnou chybu.
- Chování appky při neplatném API klíči (401/403) i při dlouhodobé
  nedostupnosti Golemio se nemění.

**Stav:** Aktivní.

---

## US-12 — Vylepšené vyhledávání dvojice stanic

V další user story bych se rád zabýval zlepšením vyhledávání dvojice stanic.
Chtěl bych tyto základní funkcionality:

- seřazení stanic z dropdownu podle abecedy
- schopnost fungovat i bez diakritiky
- vyhledávání filtrující stanice i jen podle začátků slov
  - např. "pol b" automaticky povede k filtru jen na "poliklinika
    budějovická" a "poliklinika barrandov"; dnes musím zadat, abych dostal
    tento výsledek "poliklinika b" - tedy celé první slovo (resp. kompletní
    levý substring)

Dodatek k zadání: ocenil bych, kdyby se podobně jako mezery v názvu chovaly
i pomlčky. Např. u stanice "Praha-Libeň" by bylo skvělé, kdyby fungoval
filtr po napsání "p li". To není bug, to je jen rozšíření zadání - takže
bug v zadání.

**Akceptační kritéria**

- Výsledky vyhledávání zastávek (dropdown nápovědy u obou polí) jsou seřazené
  abecedně, ne podle relevance shody jako dřív.
- Vyhledávání funguje bez ohledu na diakritiku — dotaz i bez diakritiky
  (např. "budejovicka") najde zastávky s diakritikou ("Budějovická").
- Dotaz se dělí na tokeny podle mezer; každý token musí být prefixem
  některého slova z názvu zastávky (slova se procházejí zleva doprava,
  jeden token = jedno slovo). Např. "pol b" tak najde "Poliklinika
  Budějovická" i "Poliklinika Barrandov" — nestačí už jen shoda od úplného
  začátku názvu zastávky.
- Pomlčka v názvu zastávky se chová jako další oddělovač slov — např.
  "Praha-Libeň" se dá najít i zadáním "p li" (dvě samostatná slova).
- Limit 25 zobrazených výsledků zůstává zachován.

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
