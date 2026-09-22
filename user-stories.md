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

## US-13 — Cache jízdního řádu podle jednotlivé stanice

**Kontext:** Příprava na budoucí funkcionalitu využívající historicky
zadávané dvojice stanic (samostatná pozdější story, zahrnující i úpravu
UI). Tahle story řeší jen datovou vrstvu — cachování, beze změny UI.

Zavést cache pro statická (nikoli real-time) data dopočtu spojů —
`computeAllowedRoutes` (jízdní řád výchozí i cílové zastávky přes
`mergeSequences`/`mergeTripInfo`) a `loadDestinationArrivals`
(`mergeArrivals`) — v `localStorage`, klíčovanou podle jednotlivého
stopId, ne podle celé dvojice zastávek. Díky tomu se ušetří i případ, kdy
se opakuje jen jedna ze stanic (výchozí nebo cílová) s jinou protistranou,
ne jen při přesné shodě celé dvojice.

Platnost cache se váže na kalendářní den, ne na plovoucí 24h okno od
stažení. GTFS feed se může aktualizovat kdykoli v průběhu dne — položka
stažená např. v 23:50 by si při plovoucím TTL "myslela", že je platná až
do 23:50 druhého dne, přestože feed už mohl mezitím dostat novou verzi.
Místo `fetchedAt` timestamp + `TTL_MS` porovnání se u téhle cache uloží
kalendářní datum stažení (lokální, `YYYY-MM-DD`) a položka je platná, jen
dokud se shoduje s dnešním datem — o půlnoci je tak vždy neplatná bez
ohledu na to, v kolik hodin byla stažena. Žádná aktivní reakce na přechod
dne u už otevřené stránky se nevyžaduje — nová cache se prostě založí až
při příštím requestu po půlnoci.

Zároveň se na stejný princip (kalendářní den místo plovoucího TTL)
převádí i stávající cache `stopIndex` (`STOP_INDEX_KEY`, US-7) a
`routeIndex` (`ROUTE_INDEX_KEY`, US-11) — dnešní
`STOP_INDEX_TTL_MS`/`ROUTE_INDEX_TTL_MS` plovoucí 24h okno má stejnou
mezeru (možnost přežít půlnoční aktualizaci feedu) a nemá smysl mít v
appce vedle sebe dva různé modely platnosti cache pro data se stejnou
charakteristikou (GTFS feed, denní aktualizace).

Skutečné odjezdy (`departureboards`) a poloha vozidla zůstávají beze
změny — nejsou statická data a nemají se cachovat napříč sezeními.

Bez úpravy UI — zatím se nic uživateli nenabízí ani nezobrazuje, jde jen
o interní optimalizaci volání API pro budoucí použití.

**Akceptační kritéria**

- Výsledky `mergeSequences`, `mergeTripInfo` a `mergeArrivals` pro daný
  stopId se ukládají do `localStorage` spolu s kalendářním datem stažení
  (lokální `YYYY-MM-DD`), ne s timestampem + plovoucím TTL.
- Při opakovaném dopočtu spojů, kde se aspoň jedna ze zastávek (stopId)
  shoduje s platnou cachovanou položkou ze stejného kalendářního dne, se
  pro tu zastávku nevolá Golemio API znovu.
- `stopIndex` (`STOP_INDEX_KEY`) i `routeIndex` (`ROUTE_INDEX_KEY`) jsou
  přepsané ze stávajícího `fetchedAt` + `TTL_MS` modelu na stejný model
  kalendářního dne jako nová cache — platné jen v rámci dne stažení,
  jinak se stáhnou znovu.
- Chování appky (zobrazené spoje, časy, vyhledávání zastávek) je funkčně
  identické jako dnes — jde čistě o interní optimalizaci/zpřesnění
  invalidace, ne o změnu výstupu.
- `departureboards` a `vehiclepositions` zůstávají nedotčené (žádná
  cache, žádná změna).
- Bez viditelné změny v UI.

**Stav:** Aktivní.

---

## US-14 — Oblíbené a nedávné dvojice zastávek

**Zadání (doslovně):** Tak teď můžeme přejít k té UI části. Chtěl bych link
na změnu dvojic zastávek, mezi kterými se hledá spojení přesunout do horní
části obrazovky (možná by bylo lepší tlačítko než link). Po jeho stlačení
bude k dispozici obrazovka s možností výběru dvojic zastávek (taková, jaká
se zobrazuje již dnes). Bude ale obohacená o možnost vybrat si dvojice z
uloženého seznamu či 10 posledních dvojic. Uložený seznam bude obsahovat
dvojice seřazené abecedně, kde 1. klíčem je 1. stanice a 2. klíčem pro
třízení je 2. stanice z dvojice. Navrhni, jak přidat dvojice stanic do
uloženého seznamu. Napadá mě, že uložený seznam je něco jako oblíbené
dvojice stanic a jde tedy o hvěždičkování (u stránky s výpisem spojů tak
může snadno jen příbýt hvězdička, která automaticky přidá danou dvojici do
uloženého seznamu.) Ze seznamu uložených dvojic je možné dvojice odstranit
jednoduše odhvězdičkováním.

**Akceptační kritéria**
- Tlačítko „změnit zastávky" je přesunuté z patičky na horní lištu hlavní
  obrazovky s odjezdy, vizuálně jako výrazné tlačítko (ne jako podtržený
  link, jak dnes vypadá `.change-key`).
- Vedle něj na hlavní obrazovce je hvězdičkové tlačítko pro přidání/odebrání
  aktuálně zobrazené dvojice zastávek do/z oblíbených.
- Obrazovka výběru dvojice zastávek nad stávajícím formulářem Odkud/Kam
  nabízí (pokud nejsou prázdné):
  - sekci „Oblíbené dvojice" seřazenou abecedně (1. klíč: název zastávky
    Odkud, 2. klíč: název zastávky Kam) — každá položka je klikací
    (aktivuje danou dvojici) a má hvězdičku pro odebrání z oblíbených;
  - sekci „Naposledy použité" (max 10, řazeno od nejnovější po nejstarší)
    — každá položka je klikací (aktivuje danou dvojici), bez hvězdičky.
- Formulář Odkud/Kam zůstává funkčně beze změny.
- Dvojice se přidá do „naposledy použité" pokaždé, když se stane aktivní —
  včetně automatického naběhnutí appky na uloženou dvojici při startu,
  přes tlačítko „Zjistit spoje", i výběrem z oblíbených/naposledy použitých.
- Do oblíbených lze dvojici přidat pouze z hlavní obrazovky (po zobrazení
  výpisu spojů), ne přímo ze seznamu „naposledy použité".
- Ze seznamu „naposledy použité" nejde nic ručně mazat — je to čistě
  rolující okno posledních 10 položek, nejstarší tiše vypadne při přidání
  jedenácté.
- Znovupoužití dvojice z oblíbených/naposledy použitých nepřepočítává
  povolené linky (`allowed`) — použije se dřív spočtená a uložená cache,
  stejně jako dnes dělá `loadStopPair()`.

**Stav:** Aktivní.

---

## US-14-bug-fixes — Oprava: hvězdička nejde po pár oblíbených dvojicích

Tohle není nová user story, ale záznam opravy chyby v chování zadaném v
US-14 — zapsáno jako reference na branch `US-14-bug-fixes`.

Hlášení uživatele (doslovné znění):

> po dalsich testech jsem ale narazil na bug. Kdyz uz jsem mel v ulozenych
> dvojicich 6 dvojic, nedari se mi pres tlacitko hvezdicky pridat do
> ulozenych dvojic dalsi dvojici.

Uživatel se následně přiznal, že appku testuje jako PWA na mobilu (iOS,
přidaná na plochu).

**Příčina:** `saveFavoritePairs()`/`saveStopPair()`/`pushRecentPair()`
zapisovaly do `localStorage` v `try/catch`, který chybu jen zalogoval
(`console.warn`) a mlčky zahodil — takže `QuotaExceededError` (mobilní
WebKit/PWA na home screen bývá výrazně přísnější než desktop, řádově kolem
1 MB na origin) hvězdičce nedal vůbec vědět, že se nic neuložilo.
`isFavoritePair()` po takovém neúspěšném zápisu správně hlásilo `false`,
takže to navenek vypadalo, že hvězdička na přidání "nereaguje". Appka si
navíc do stejného úložiště ukládá i podstatně objemnější, ale kdykoli
znovu dopočitatelné cache (celý seznam zastávek z US-7/US-12, per-stanice
jízdní řády z US-13) — ty čas od času vyčerpaly zbytek dostupné kvóty.

**Oprava**
- Nová `trySetItem(key, value)` v `connections.js`: při
  `QuotaExceededError` postupně zahodí velké, znovu-dopočitatelné cache
  (seznam zastávek, index linek, per-stanice cache jízdních řádů z
  US-13) a zápis zopakuje, dokud se buď neuvolní místo, nebo nedojdou
  cache k zahození — teprve pak zápis skutečně selže.
- `saveFavoritePairs`/`addFavoritePair`/`removeFavoritePair`,
  `saveStopPair` i `pushRecentPair` teď přes `trySetItem` procházejí;
  `addFavoritePair`/`removeFavoritePair` navíc vrací `true`/`false` podle
  toho, jestli zápis (i po uvolnění cache) skutečně prošel.
- Hlavní obrazovka má nový řádek pro chybovou hlášku (`#mainError`, stejný
  vzor jako `#pickerError`) — pokud hvězdičkování i po uvolnění cache
  selže, appka to uživateli výslovně napíše, místo aby tiše nic neudělala.
  Stejná hláška se zobrazí i při mazání hvězdičkou přímo ze seznamu
  oblíbených na obrazovce výběru dvojic.

**Stav:** Aktivní.

---

## US-15 — Skryté ladicí zobrazení velikostí klíčů v localStorage

**Zadání (doslovně):** jj, libilo by se mi, kdyby po 5 kliknutich na cislo
verze v zapati stranky byly zobrazeny informace o velikosti jednotlivych
klicu v LOCAL storage.

**Kontext:** Vzniklo při ladění [[US-14-bug-fixes]] (localStorage plná na
mobilu) — uživatel chtěl bez zásahu do konzole prohlížeče zjistit, kolik
místa který klíč v localStorage skutečně zabírá, aby ověřil, jak velký je
`STOP_INDEX_KEY` a další cache oproti uživatelským datům (oblíbené,
naposledy použité).

**Akceptační kritéria**
- Číslo verze v patičce (`#appVersion`) reaguje na 5 kliknutí během krátkého
  časového okna (např. 3 s) — při pomalejším/přerušeném klikání se počítadlo
  vynuluje.
- Po 5. kliknutí se zobrazí přehled: pro každý klíč aktuálně přítomný v
  `localStorage` název klíče a jeho velikost v bytech (součet délky klíče a
  hodnoty, jak je reálně uložená), seřazený od největšího po nejmenší, a
  celkový součet za všechny klíče.
- Přehled je čitelný i na mobilu (např. jednoduchý seznam v modálním
  panelu), jde ho zase zavřít.
- Nejde o trvale viditelnou součást UI — bez těch 5 kliknutí se nic
  nezobrazuje a běžné používání appky se nijak nemění.
- Žádná změna v tom, co a jak se do localStorage ukládá — jde čistě o
  read-only diagnostický náhled.

**Stav:** Aktivní.

---

## US-16 — Automatický refresh appky při nové verzi

**Zadání (doslovně):** Chtěl bych zajistit, aby bylo zajisteno, ze v
pripade nove verze se tato vzdycky v prohlizeci refreshla tak, aby se o to
nemusel starat uzivatel.

**Kontext:** Appka dnes cachuje shell cache-first (`sw.js`, `CACHE_NAME`
odvozený z `APP_VERSION`) a nová verze se plně projeví, jen když uživatel
appku zavře a znovu otevře — a i tak kvůli standardnímu chování service
workerů (nová verze zůstává „waiting", dokud stránku ovládá stará) může
být potřeba otevřít dvakrát. V diskuzi bylo probráno a rozhodnuto:
- Žádný vlastní periodický polling (`registration.update()` na časovač) —
  kontrola nové verze se má spoléhat na to, co prohlížeč dělá sám
  (kontrola `sw.js` na byte-diff při každém reálném otevření appky).
- Reload se nemá dít násilně uprostřed běžícího používání appky (ztráta
  rozepsaného vstupu na `setupScreen`/`pickerScreen`, přerušení
  právě běžícího fetche) — má stačit, že se nová verze plně projeví při
  příštím reálném otevření appky, ne okamžitě za běhu.
- Aby jedno reálné otevření po vydání nové verze stačilo (bez nutnosti
  otevřít appku dvakrát kvůli „waiting" service workeru), je potřeba
  `self.skipWaiting()` v `install` a `clients.claim()` v `activate` v
  `sw.js`.

**Akceptační kritéria**
- Když prohlížeč při reálném otevření/navigaci na appku zjistí novou verzi
  `sw.js` (jiný `CACHE_NAME`), appka se po dokončení instalace nové verze
  sama přesně jednou reloadne — uživatel nemusí appku zavírat a znovu
  otevírat, aby viděl novou verzi.
- Žádný vlastní časovaný polling na kontrolu nové verze
  (`registration.update()` na interval) — appka se spoléhá na kontrolu,
  kterou dělá prohlížeč sám při navigaci.
- Appka se sama od sebe nereloaduje uprostřed už rozjeté session, pokud
  nedojde ke skutečné navigaci/otevření (žádné tiché reloady na pozadí bez
  souvislosti s reálným otevřením appky).
- Appkové tlačítko „obnovit" (`refreshBtn`) zůstává beze změny — dál jen
  dotahuje nová data o odjezdech, nevynucuje reload stránky ani kontrolu
  nové verze.
- Žádná nekonečná smyčka reloadů (pojistka proti opakovanému spuštění
  `controllerchange` handleru).

**Stav:** Aktivní.

---

## US-8-bug-fixes — Oprava: text "odjel" u spoje, který ještě reálně neodjel

Tohle není nová user story, ale záznam opravy chování zadaného v US-8
(countdown vč. stavu "odjel") — zapsáno jako reference na branch
`US-8-bug-fixes`.

Hlášení uživatele (doslovné znění):

> resim spise to, ze realne se dost casto deje, ze se v aplikaci vypisuje
> stav "odjel" a pritom spoj jeste neni ani v zastavce nebo do ni prave
> prijizdi. Minimalni bych tedy zmenil text z "odjel" na "odjíždí".

**Příčina:** Stav "odjel" (`formatCountdown()` v `app.js`) se odvozuje čistě
z toho, že predikovaný čas odjezdu (`dep._predicted`, z jízdního řádu +
zpoždění) je víc než 5 s v minulosti — ne ze skutečné polohy vozidla. Když
appka predikci má, ale poloha vozidla dostupná není (nebo je zastaralá),
countdown dojde na nulu, i když spoj fyzicky teprve přijíždí nebo je pořád
na zastávce.

**Oprava**
- Text při `past === true` změněn z "odjel" na "odjíždí" (`app.js`,
  `tick()`) — přesnější formulace pro stav, kdy appka jen ví, že
  naplánovaný/predikovaný čas odjezdu uplynul, ne že vozidlo reálně opustilo
  zastávku.
- Přesnější odvození stavu od skutečné polohy vozidla (místo jen
  predikovaného času) je mimo rozsah této opravy — vyžadovalo by novou
  story.

**Stav:** Opraveno.

---

## US-17 — Spoj nezmizí ze seznamu dřív, než reálně odjede

**Zadání (doslovně):**

> No, skoro bych rekl, ze je pro me vlastne dulezitejsi, ze mi nezmizi spoj
> ze seznamu spoju drive, nez skutecne odjede. Takze bych to vlastne asi
> rad posunul tak, ze to, ze odjizdi by se zobrazovalo tak, jak je to ted
> (popr v okamziku, kdy ze statusu vime, ze spoj je jiz v zastavce) a ze
> seznamu spoju by spoj zmizel prave az v okamziku, kdy z dat budeme vedet,
> ze uz je na ceste k dalsi zastavce.

**Kontext:** Seznam se dnes při každém fetchi (~20 s) čistě nahradí
odpovědí z `/pid/departureboards` — appka žádnou vlastní logiku "kdy zmizet
ze seznamu" nemá, jen zobrazuje to, co Golemio zrovna vrátí. Jakmile
Golemio přestane spoj v odpovědi vracet (na základě predikovaného, ne
reálného odjezdu), spoj ze seznamu zmizí — i když vozidlo ještě fyzicky
stojí na zastávce nebo teprve přijíždí.

Ověřeno na dvou reálných odpovědích `/vehiclepositions/{tripId}`: dokud
vozidlo zastávku neopustilo, `last_position.last_stop.id` je `null`
(`state_position: "before_track"`); jakmile ji opustí, `last_stop.id` je
stabilně vyplněné ID té zastávky a zůstává tak po celou dobu jízdy k další
zastávce (`state_position: "on_track"`). To je spolehlivější signál "spoj
už je na cestě k další zastávce" než porovnání souřadnic nebo raw GTFS-RT
`INCOMING_AT`/`IN_TRANSIT_TO`.

**Akceptační kritéria**
- Appka si mezi jednotlivými fetchi drží vlastní seznam naposledy viděných
  spojů podle `trip.id`, ne jen poslední odpověď z `/pid/departureboards`.
- Když spoj z čerstvé odpovědi API zmizí, appka ho ze zobrazení hned
  neodebere — zůstane v seznamu (s naposledy známými daty) a appka pro něj
  dál dotazuje `/vehiclepositions/{tripId}`.
- Spoj se ze seznamu skutečně odebere, až `last_position.last_stop.id`
  odpovídá ID zastávky, ze které odjížděl (`dep.stop.id`) — tedy ve chvíli,
  kdy víme, že vozidlo je už na cestě k další zastávce.
- Pokud se polohu pro daný spoj nepodaří získat (netrackuje, opakované
  chyby), appka ho po 60 s od zmizení z API přesto odebere, aby seznam
  neotékal nepotvrzenými spoji.
- Text "odjíždí" (US-8-bug-fixes) se touto story nemění — pořád řízený
  časovým odhadem `formatCountdown()`. Nezávisí na tom, kdy spoj zmizí ze
  seznamu.
- Text "odjíždí" je barevně stejný jako countdown v posledních vteřinách
  před odjezdem (`.min.soon`), ať je to vizuálně konzistentní.
- "poloha před X s" tag (US-8) zůstává beze změny.

**Známé omezení:** u okružních linek, kde se stejná zastávka v trase
opakuje, může `last_stop.id` teoreticky sednout příliš brzy (na jiném
průjezdu). Pro v1 akceptováno, případně řešit přes `sequence` pole, pokud
se to v praxi ukáže jako problém.

**Stav:** Aktivní

---

## US-17-bug-fixes — Oprava: promíchané spoje staré a nové dvojice zastávek po přepnutí

Tohle není nová user story, ale záznam opravy chování zavedeného v US-17
(retenční seznam spojů mezi fetchi) — zapsáno jako reference na branch
`US-17-bug-fixes`.

Hlášení uživatele (doslovné znění):

> při testování jsem ale narazil na škaredý problém. Při změně dvojic
> zastívek ze seznamu oblíbených jsou v seznamu spojů nejen spoje skutečně
> jezdící mezi oněmi 2 zastávkami, ale i jiné spoje (skoro bych řekl, že jde
> o spoje z předchozí dvojice) a ty jsou zobrazeny v jednom výpisu slité
> dohormady. Po provním auto refreshi (či manuálním refreshi se to srovná).

**Příčina:** `retainedDepartures` a `vehiclePositions` (US-17) jsou
modulové proměnné klíčované podle `trip.id`, ne podle aktuální dvojice
zastávek. Přepnutí dvojice (`activatePair()` — ať už z formuláře, nebo z
oblíbených/naposledy použitých) tyhle mapy nijak nečistilo, takže spoje
staré dvojice v nich zůstaly jako "naposledy viděné" a `mergeWithRetained()`
je při prvním fetchi pro novou dvojici přimíchal k čerstvým datům, dokud je
neodstranila 60s grace perioda nebo potvrzená poloha (typicky až při dalším
fetchi).

**Oprava**
- `activatePair()` nově při každém přepnutí dvojice resetuje
  `retainedDepartures`, `vehiclePositions` i `currentDepartures` na prázdné
  hodnoty, než zavolá `fetchDepartures()` pro novou dvojici.

**Stav:** Opraveno.

---

## US-17-bug-fixes — Oprava: zastaralé spoje mizí ze seznamu se zpožděním 60–90 s po návratu

Další záznam opravy chování z US-17 (retenční seznam spojů) — branch
`US-17-bug-fixes`.

Hlášení uživatele (doslovné znění):

> Nene, vidis to spatne. To, co vidis, je obrazek, ktere si konzistentne
> deje, kdykoliv prijdu po delsi dobe zpet k aplikaci. Tj., zustanou tam
> stara data z predchozi seance (ty jzustanou naveky ve stavu "Odjizdi") a
> dole pod nimi jsou pak aktualni odjezdy. Spravi se to az manualnim
> refreshem (nestaci auto-refresh aplikace po 30s ani tlacitko
> "Aktulizovat") - je potřeba klasický refresh stránky (aka CTRL+R na
> desktopu ci swipe down na mobilu)

Po upřesnění (appka to nakonec sama srovná, jen ne hned):

> jo, po nejake chvile zmizi, ale nestane se tak hned po auto-refreshi ci po
> stisknuti tlacitka "Aktualizovat"

**Příčina:** Chování odpovídalo AC z US-17 ("po 60 s od zmizení z API
přesto odebere"), ale ten grace interval byl navržený pro krátké výpadky
API *během* běžného používání, ne pro situaci "appka byla dlouho na
pozadí". `missingSince` se u spoje nastaví až při prvním fetchi po
návratu, takže reálné smazání přišlo až o 60-90 s později (2.-3. tik), což
u zjevně den/večer starých spojů působilo jako appka "nikdy" nereaguje na
refresh.

**První pokus o opravu (zpětně nesprávný):** `mergeWithRetained()` mazala
missing spoj okamžitě, pokud byl jeho `_predicted` čas víc než 5 minut v
minulosti. Uživatel na to reagoval konkrétním protipříkladem (doslovné
znění):

> jak to bude fungovat, kdyz spoj se tesne pred prijezdem do zastavky
> zasekne na posledni zacpane krizovatce na 10 minut? Predpokladam, ze
> kdyz se do appky vratim po 8 minutach, tak protoze uz uplynulo 5 minut,
> tak bude spoj nemilosrdne odstranen. Nebylo by lepsi, kdyby to vrazdeni
> probehlo vzdycky az treba po 30 minutach, ale zaroven u vsech spoju,
> ktere jsou ve stavu "odjizdi" by se provedlo opetovne zavolani API
> kontolujici polohu a v pripade, ze by poloha odpovidala uz tomu, ze je
> spoj skutecne fuc (nevim, co API vrati v pripade, ze uz spoj dokonce
> dojel do sve cilove destinace).

Platí: `_predicted` staré přes 5 minut nemusí znamenat starou seanci —
stejně tak může jít o reálně zpožděný, stále relevantní spoj, kterému
Golemio přestalo vracet predikci, protože ta už "měla" nastat (přesně
důvod, proč US-17 vůbec vznikla). Navíc mazací podmínka byla `NEBO`, ne
`A` — 60s grace lhůta smazala spoj i tehdy, když appka měla platná
polohová data jasně říkající "ještě neodjel", což je v rozporu se
zněním AC k US-17 ("*pokud se polohu nepodaří získat*, appka ho po 60 s
odebere").

**Oprava (finální)**
- Grace lhůta (`MISSING_GRACE_MS`) teď platí jen tehdy, když appka pro
  daný spoj nemá žádná platná polohová data (`!hasPositionData`) — přesně
  podle původního AC. Pokud poloha existuje a nepotvrzuje odjezd, spoj
  zůstává bez ohledu na to, jak dlouho chybí z `/pid/departureboards`
  (appka polohu podle US-17 stejně dál pravidelně re-checkuje na každém
  fetchi přes `refreshVehiclePositions()` — vlastní re-dotaz "je fakt
  pryč?" navrhovaný uživatelem tedy appka dělá už dnes).
- Zrušen heuristický `STALE_PREDICTED_MS` (5 min) test. Místo hádání podle
  `_predicted` appka počítá `missingSince` od času posledního úspěšně
  zpracovaného fetche (`lastFetchCompletedAt`), ne od "teď" — po dlouhé
  odmlce appky (zavřená záložka, uspaný telefon) je tahle mezera obrovská,
  takže spoj bez polohových dat (typicky spoj z předchozí seance/dne, pro
  který Golemio přestalo mít data) grace lhůtu překročí a smaže se hned
  při prvním fetchi po návratu. Při běžném kontinuálním provozu (mezera
  ~`REFRESH_MS`) se chování prakticky neliší od počítání od "teď".
- `activatePair()` navíc resetuje i `lastFetchCompletedAt`, aby zůstal
  konzistentní s resetem `retainedDepartures`/`vehiclePositions` zavedeným
  v předchozí opravě výš na této branchi.
- Ověřeno izolovaným unit testem (6 scénářů, mimo DOM): stará seance bez
  polohy mizí okamžitě po návratu; spoj zaseknutý 10+ minut v koloně s
  platnou "ještě neodjel" polohou přežije; spoj bez polohy mizí po 60s
  grace lhůtě jako dřív; potvrzený odjezd maže okamžitě; čerstvý spoj se
  nemění.

K otázce "co API vrátí po dojetí spoje do cílové destinace": nemám k tomu
ověřená data (netestováno naživo) a nechci si to domýšlet. Pro správnost
téhle opravy to ale není podstatné — appka porovnává `lastStopId` jen s
*výchozí* zastávkou sledovaného úseku (`confirmedDeparted`), takže jakmile
spoj tuhle zastávku opustí, appka ho z retenčního seznamu odstraní dřív,
než by mohl dojet až do cíle. Zůstává tu jen užší, appkou už dřív (US-17)
akceptované omezení: pokud appka minula i samotný okamžik odjezdu ze
zdrojové zastávky (dlouhá odmlka, `lastStopId` mezitím "přeskočilo" na
některou z dalších zastávek) a Golemio pro daný spoj přitom pořád vrací
platná (byť nepotvrzující) polohová data, spoj by teoreticky mohl zůstat
zobrazený déle, než by měl — stejná mezera existovala i v originální
US-17 logice, tahle oprava ji nezavádí ani nerozšiřuje.

**Stav:** Opraveno.

---

## US-17-bug-fixes — Oprava: spoje ze staré seance zůstávají navždy jako "odjíždí"

Další záznam opravy chování z US-17 (retenční seznam spojů) — branch
`US-17-bug-fixes`, reuse po předchozí opravě výš.

Hlášení uživatele (doslovné znění):

> Porad jsem branch US-19 jeste nemergnul do masteru na remote. Duvodem je
> to, ze porad pri testovani v appce vidim ten stary bug s nemizejicimi
> spoji po navratu do appky po delsi dobe. Viz screenshot.

Přiložený screenshot ukazoval spoje "134 Dvorce" z předchozího večera
(predikce 19:50, 20:03, 20:16) trvale zobrazené jako "odjíždí" s
`poloha před 41169 s` (~11,4 h stará), zatímco skutečně aktuální spoje pod
nimi (predikce 06:36, 06:43) se zobrazovaly správně s odpočtem.

**Příčina:** Předchozí oprava na této branchi (`hasPositionData` blokuje
grace lhůtu, pokud appka má *jakákoli* platná polohová data) nepočítala s
tím, že "platná polohová data" mohou být libovolně stará.
`refreshVehiclePositions()` při chybě fetchování polohy záměrně ponechává
poslední známou hodnotu beze změny (aby UI neblikalo na "poloha: neznámá"
při přechodném výpadku) — pokud ale API pro daný `tripId` přestane vracet
data úplně (typicky proto, že spoj v reálném světě už dávno dojel a
Golemio už ho nesleduje), `hasPositionData` zůstane `true` navždy s čím dál
starší cachovanou hodnotou. Protože `confirmedDeparted` vyžaduje přesnou
shodu `lastStopId` s výchozí zastávkou (ke které nemusí nikdy dojít) a
grace lhůta platí jen `!hasPositionData`, spoj se z retenčního seznamu už
nikdy neodstranil.

**Návrh opravy byl před implementací probrán a odsouhlasen s uživatelem**
(viz konverzace) — finální design má tři vzájemně se vylučující případy,
navíc podmíněné tím, že spoj je ve stavu "Odjíždí" (ať už do něj appka
dospěla countdownem na nule, nebo přes `trip.is_at_stop` z API):

1. poloha vozidla se nikdy nepodařila získat -> maže se po
   `MISSING_GRACE_MS` (60 s) od `missingSince`, stejně jako dosud.
2. poloha se už někdy získat podařila, ale poslední úspěšný fetch
   (`cached.fetchedAt`) je starší než `POSITION_FAILING_GRACE_MS` (90 s) ->
   maže se (zjišťování polohy teď reálně selhává).
3. poslední fetch byl úspěšný v posledních 90 s, ale samotná poloha
   (`cached.originTimestamp`) je starší než `POSITION_STALE_MS` (5 min) ->
   maže se (vozidlu se např. sekne GPS a poloha na serveru dál
   neaktualizuje, přestože appka ji úspěšně dotahuje).

Nezávisle na těchto třech (a bez ohledu na stav "Odjíždí") se spoj maže
OKAMŽITĚ, jakmile poloha potvrdí, že vozidlo je už na cestě k další
zastávce (`confirmedDeparted`) — to je nezpochybnitelný signál, kterému
appka věří víc než predikčnímu `/departureboards`.

Případy 1–3 jsou navíc podmíněné stavem "Odjíždí" (`isDepartingNow()`) —
spoj, který ještě nedospěl k odjezdu (např. stojí v koloně těsně před
zastávkou a countdown ještě neproběhl do minulosti), zůstává zobrazený bez
ohledu na to, jak dlouho chybí v `/pid/departureboards` nebo jak stará je
jeho poloha.

`isDepartingNow()` je záměrně nezávislá na `US-19` (samostatná branch) —
čte `dep.trip.is_at_stop` přímo z dat, ne přes `tick()`, aby `US-17-bug-fixes`
a `US-19` zůstaly mergovatelné nezávisle na sobě.

Ověřeno izolovaným unit testem (9 scénářů, mimo DOM): `confirmedDeparted`
maže okamžitě i mimo stav "Odjíždí"; spoj mimo stav "Odjíždí" přežívá i
dlouhou nepřítomnost bez polohy; všechny tři případy (60 s / 90 s / 5 min)
zvlášť u hranice i pod ní; hraniční scénář "fetch OK, poloha 3 min stará"
(spoj musí přežít, protože 3 min < `POSITION_STALE_MS`); spoj zaseknutý
v koloně s čerstvou polohou přežívá; `trip.is_at_stop` samo o sobě spouští
stav "Odjíždí".

**Stav:** Opraveno, čeká na ruční otestování uživatelem.

---

## US-18 — Zmenšení objemu dat v localStorage bez zvýšení počtu API volání

Doslovné zadání (z konverzace):

> napadají Tě nějaké optimalizace, které by snížily objem dat v local
> storage, ale zároveň by razantně nezvýšily čas potřebný k dotažení
> informací z API (zde je nutno počítat i s rate limittingem)

> jo, rozprac to jako story - Tvé návrhy se mi líbí

**Jako** uživatel appky **chci** snížit objem dat ukládaných v localStorage,
**abych** nenarážel na kvótu (typicky na mobilu, kde je limit kolem 1 MB),
aniž by to appku donutilo dělat víc dotazů na Golemio API nebo zpomalilo
načítání dat.

**Akceptační kritéria**
- `stop_arrivals_cache` ukládá pro danou zastávku jen záznamy pro `trip_id`,
  které appka podle už dnes cachovaného `stop_seq_cache` obou zastávek (origin
  i cíl) prokazatelně zná jako přímé spoje aktuální dvojice — stejná definice,
  jakou používá `computeAllowedRoutes` (`destSeq > originSeq`) — ne kompletní
  denní jízdní řád celé zastávky. Filtrování proběhne až nad už staženým
  `/gtfs/stoptimes/{stopId}` response a nad už cachovaným `stop_seq_cache`
  (bez nového dotazu na `/gtfs/stoptimes` pro sekvence). Pokud `stop_seq_cache`
  pro některou ze zastávek dnes ještě není (typicky dvojice aktivovaná
  z oblíbených/naposledy použitých v novém dni), appka filtrování přeskočí
  a uloží kompletní data jako dosud — nikdy kvůli tomu nevyvolá nový
  požadavek navíc.
- `cachedDate` flag pro danou zastávku zůstává zapsaný i po prořezání dat
  (i kdyby výsledné pole bylo prázdné), aby se při příštím čtení nespustil
  zbytečný refetch jen proto, že je uložených záznamů méně.
- Při uložení dvojice zastávek (aktivní/oblíbené/nedávné) appka odstraní ze
  `stop_seq_cache`, `trip_info_cache` a `stop_arrivals_cache` záznamy pro
  `stopId`, které už nepatří žádné z aktuálně uložených dvojic (aktivní +
  oblíbené + nedávné).
- `stop_seq_cache` a `trip_info_cache` zůstávají obsahově beze změny
  (neprořezávají se) — potřebují kompletní data o všech spojích přes danou
  zastávku, protože `computeAllowedRoutes` z nich může kdykoli dopočítávat
  i jinou (dosud neznámou) dvojici zastávek sdílející tu samou stanici.
- Žádná z úprav nepřidává nové HTTP požadavky na Golemio API navíc oproti
  současnému stavu.

**Stav:** Aktivní

---

## US-19 — Okamžité "odjíždí" u spoje, který je dle polohy již v zastávce

Zadání od uživatele (doslovné znění):

> pokud dostaneme z polohoveho API informaci o tom, ze spoj je jiz v
> zastavce, tak dava smysl u takoveho spoje zobrazit rovnou "odjizdi" a
> necekat na jeho dopocet odjezdu do nuly

**Kontext:** [US-8-bug-fixes](#us-8-bug-fixes--oprava-text-odjel-u-spoje-který-ještě-reálně-neodjel)
už dřív řešila, že appka nesmí hlásit "odjel" u spoje, co reálně ještě
neodjel — tehdejší oprava ale zůstala jen na textu ("odjíždí" místo
"odjel") a odvození stavu od skutečné polohy vozidla si výslovně nechala
na budoucí story. Tohle je ta story, jen z druhé strany: teď jde o to,
aby appka na polohu reagovala i směrem dřív — a nedržela numerický
countdown, když už je jasné, že spoj stojí v zastávce a odjíždí.

**Zdroj polohové informace:** appka už dnes z odpovědi
`/pid/departureboards` (Golemio) čte a zobrazuje `trip.is_at_stop`
(viz "ve stanici"/"na trase" v `.meta` řádku) — je to údaj přímo od
Golemia, bez jakéhokoli dalšího API volání navíc, dostupný pro každý
spoj při každém pravidelném refreshi. Pro tuhle story se použije přesně
tenhle příznak, ne samostatné dotazování `/vehiclepositions/{tripId}`
(to je dražší mechanismus z US-8/US-17, co slouží k jinému účelu —
detekci, že spoj už odjel ze zdrojové zastávky, ne že v ní právě stojí).

**Akceptační kritéria**
- Když `dep.trip.is_at_stop` je `true`, countdown daného spoje se zobrazí
  jako "odjíždí" okamžitě, bez ohledu na to, kolik ještě zbývá do
  `dep._predicted` podle lokálního dopočtu.
- Chování se sjednotí s existující logikou v `formatCountdown` — spoj je
  "odjíždí", pokud platí `past` (lokální dopočet) **nebo** `is_at_stop`
  (polohová informace); ani jedna z podmínek tu druhou nenahrazuje.
- Spoj podržený mechanismem `mergeWithRetained` (US-17) po výpadku
  z čerstvé odpovědi si drží poslední známou hodnotu `is_at_stop` —
  žádná zvláštní úprava tam není potřeba, chová se to jako u kteréhokoli
  jiného pole zamrzlého `dep` objektu.
- Žádné nové HTTP požadavky na Golemio API navíc oproti současnému stavu.

**Stav:** Aktivní

---

## US-20 — Zaručit minimální počet/pokrytí zobrazených spojů

Zadání od uživatele (doslovné znění):

> Ma byt presne o tom, ze dnes se deje, ze u nekterych kombinaci zastavek
> zobrazujeme prilis malo spoju. Pokud spoje existuji, tak bych rad videl
> alespon 5 spoju a vsechny spoje pokryvajicich alespon nejblizsich
> 35minut. Zaroven je za me v poradku, ze pokud se nepodari najit onech 5
> spoju jedoucich do 20 hodin, tak je nebudeme hledat dale. Zaroven bych
> nechtel, abychom diky strankovani palili zbytecne moc requestu a trapilo
> nas to z pohledu rate limittingu. A zaroven bych nechtel stahovat prilis
> mnohi dat.
>
> Umim si predstavit,ze bychom si z kazdeho requestu a toho, co se nakonec
> pouzije pro zobrazeni spocitali, jak ma vypadat request pro dalsi
> stranku (tj. zkusit si na zaklade requestu odhadnout, o kolik vice
> polozek bude vyhodne si pozadat, abychom se konecne dostali k
> dostatecnemu poctu spoju k zobrazeni).

**Diagnóza:** appka dnes posílá `/pid/departureboards` s pevným
`limit=40`/`minutesAfter=90` a teprve po odpovědi klientsky filtruje jen
povolené linky/směry. Golemio do těch 40 položek počítá všechny odjezdy ze
zastávky (i cizí linky) — u frekventovanějšího uzlu se limit vyčerpá cizími
linkami dřív, než se appka dostane k těm pár spojům, co ji zajímají, i
kdyby jely v rámci 90minutového okna.

**Akceptační kritéria**
- **Cíl na jeden refresh:** zobrazit aspoň 5 spojů odpovídajících povoleným
  linkám/směrům **a zároveň** všechny takové spoje do 35 minut od teď
  (platí obojí současně — co je přísnější, to určuje potřebné pokrytí).
  Hledá se maximálně 20 hodin dopředu od okamžiku requestu; pokud se ani
  do 20 hodin nenajde 5 spojů, appka to vzdá a zobrazí, co má.
- **Detekce, jestli mám "dost", bez zbytečné další stránky:** Golemio vrací
  odjezdy seřazené vzestupně podle času (`order=real`), takže z jedné
  odpovědi jde poznat garantované pokrytí:
  - pokud přišlo míň položek, než byl poslaný `limit` → nic se neuřízlo,
    mám kompletní data až do konce `minutesAfter` okna;
  - pokud přišlo přesně `limit` položek → data jsou uříznutá, garantované
    pokrytí sahá jen do času posledního vráceného spoje.
- **Adaptivní dopočet dalšího requestu:** pokud cíl není splněný, appka si
  z poměru "kolik vrácených položek odpovídalo povoleným linkám" a "jak
  daleko do budoucnosti mám garantované pokrytí" spočítá odhad nového
  `limit` (když se uřízlo dřív než na 35 min) nebo `minutesAfter` (když je
  35 min pokrytých, ale shodných spojů je < 5), aby další request cíl
  pokud možno splnil rovnou, bez nutnosti nekonečně malých stránek.
- **Rozpočet requestů na Golemio v rámci jednoho refreshe:**
  - pokud po prvním requestu appka má **aspoň 1** shodný spoj → povolen
    max. 1 doplňující request (celkem 2 na refresh); zbytek do cíle (5 /
    35 min) se dotáhne až při některém z dalších pravidelných refreshů,
    ne násilím v rámci jednoho.
  - pokud po prvním requestu appka má **0** shodných spojů → povoleno až
    5 requestů v rámci jednoho refreshe (postupně zvětšovat okno), protože
    nezobrazit nic je výrazně horší stav než zobrazit jen 1 spoj.
- **Perzistence naučeného tvaru requestu:** poslední funkční
  `{limit, minutesAfter}` pro danou dvojici zastávek se uloží do
  `localStorage` (obdoba per-stanice cache z US-13) a příští pravidelné
  refreshe z něj vychází místo pevného 40/90 — u dané dvojice se to časem
  ustálí na 1 requestu/refresh místo opakovaného dohledávání od nuly.
  Když aktuální tvar vrací výrazně víc, než je potřeba (a nebyl uříznutý),
  appka ho postupně zase zmenší, ať nezůstane napořád stahovat zbytečně
  moc dat z doby, kdy byla linka řidší (např. z večera), i po zbytek dne.
- Žádný nový endpoint ani změna sdíleného rate limiteru (`acquireSlot`/
  `golemioGet`, US-11) — jen jinak tvarované/vícenásobné volání existujícího
  `/pid/departureboards` v rámci refreshe.

**Stav:** Aktivní

---

<!--
Šablona pro novou story — zkopíruj a vyplň:

## US-n — Krátký název

**Jako** ... **chci** ... **abych** ...

**Akceptační kritéria**
- ...

**Stav:** Aktivní / Nahrazena US-x — důvod
-->
