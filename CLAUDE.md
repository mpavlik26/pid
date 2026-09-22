# CLAUDE.md

Instrukce pro Claude Code při práci na tomhle repozitáři.

## Co to je

Statická PWA (žádný framework, žádný build krok) zobrazující přímé spoje PID
mezi konkrétní dvojicí zastávek, seřazené podle skutečně zbývajícího času do
odjezdu. Detaily produktu a historie rozhodnutí jsou v `user-stories.md` —
**přečti si ho před jakoukoli netriviální změnou**, ať nerozbiješ něco, co
bylo záměrně vyřešené v dřívější story.

## Tech stack a konvence

- Čistý HTML/CSS/JS, žádný bundler, žádný `package.json`, žádné závislosti.
- Jazyk UI textů i komentářů v kódu: **čeština**.
- `config.js` — konfigurace (zastávky, povolené linky/směry). Logika appky
  je v `app.js`, styly v `style.css`. Neslučuj je zpátky do jednoho souboru.
- Testování je zatím ručně: `python3 -m http.server` (nebo `npx serve .`)
  a otevřít v prohlížeči. Žádné automatické testy zatím nejsou — pokud
  nějaké přidáváš, založ to jako novou user story.

## Kritická fakta, která neplatí zpochybňovat bez nové story

- **`localStorage`, ne `window.storage`.** `window.storage` je API dostupné
  jen uvnitř Claude.ai artefaktů. V reálném prohlížeči neexistuje. Pokud
  najdeš kód, co ho používá, je to pozůstatek prototypu — nahraď ho.
- **Žádná mapa.** Explicitní produktový požadavek od začátku (US-1). Nepřidávej
  mapovou komponentu, dokud si to vyloženě nevyžádá nová user story.
- **Seznam povolených linek se dopočítává za běhu appky** (`connections.js`,
  proti Golemio GTFS static REST endpointům), ne ručně z GTFS zipu — viz
  US-6. `BOARD_CONFIG` v `config.js` je jen runtime placeholder, naplní se
  buď z uložené dvojice zastávek (`localStorage`), nebo po novém dopočtu.
  Nezaváděj zpátky ruční editaci `config.js` ani stahování celého statického
  feedu bez explicitního zadání — je to jiná (a dražší) architektura.
  Výjimka: `connections.js` si kvůli rychlému, case-insensitive vyhledávání
  zastávek (US-7) drží v `localStorage` malou stránkovanou mezipaměť
  *seznamu zastávek* (`/gtfs/stops`, TTL 24 h) — to není totéž co zakázané
  ruční parsování `PID_GTFS.zip` pro seznam linek, jde jen o REST dotaz na
  zastávky, ne o statický feed s jízdními řády.
- **Golemio API vyžaduje osobní API klíč** (`X-Access-Token` header).
  Appka ho nikdy neukládá jinam než do `localStorage` uživatele a nikdy ho
  neposílá nikam kromě `api.golemio.cz`. Neloguj ho, nedávej do commitů,
  nedávej do error hlášek celý (jen že je neplatný).
- **Countdown na vteřiny je lokální dopočet**, ne vteřinová přesnost dat ze
  serveru. Server (`departureboards`) se dotazuje max. jednou za ~20 s —
  neztenčuj ten interval bez důvodu, je to cizí veřejné API.
- **`sw.js` cachuje app shell cache-first** (`CACHE_NAME` + `SHELL_FILES`).
  Browser detekuje update service workera jen podle změny bajtů v `sw.js`
  samotném — pokud upravíš libovolný soubor ze `SHELL_FILES` (`index.html`,
  `style.css`, `config.js`, `connections.js`, `app.js`, ...) a `CACHE_NAME`
  nezvýšíš, prohlížeč bude do nekonečna servírovat starou cachovanou verzi,
  i po hard refresh. **Při každé změně souboru ze `SHELL_FILES` zvyš
  `CACHE_NAME`** (např. `-v2` → `-v3`), jinak testování/nasazení tiše
  neprojeví žádnou změnu.

## Práce s `user-stories.md` a git workflow

Tenhle projekt vede historii jako sled user stories, ne jako živě přepisovanou
specifikaci. Ke každé story patří vlastní branch a pevná sada checkpoint
commitů. Pravidla:

1. Než začneš implementovat něco netriviálního, zkontroluj `user-stories.md`,
   jestli podobnou story už někdo nezadal / neřešil.
2. **Totéž platí pro opravu nahlášeného bugu, ne jen pro novou story.** I
   když se ti diagnóza a řešení zdají jednoznačné, neimplementuj rovnou.
   Nejdřív uživateli v konverzaci stručně shrň diagnózu (co je příčina) a
   navržený postup opravy (co konkrétně se změní a proč) a počkej na jeho
   výslovný souhlas — stejný postup návrh-pak-implementace jako u nové
   story. Teprve po odsouhlasení návrhu založ/použij branch a pokračuj podle
   kroků níž.
3. **Ještě předtím, než cokoli zapíšeš do `user-stories.md`**, založ novou
   branch z `master` pojmenovanou `US-n` (n = číslo story). U oprav bez
   vlastního čísla story (např. `US-10-bug-fixes`) platí stejný princip
   analogicky.
4. Jakmile je nová story zadaná (i jen v konverzaci), zapiš ji do
   `user-stories.md` jako úplně první krok na té nové branchi — před
   jakýmkoli zkoumáním kódu, návrhem řešení nebo psaním plánu. Zadání zapiš
   doslovným zněním, jak ho uživatel formuloval, ne přeformulované do
   šablony Jako/chci/abych — přesné původní znění má být dohledatelné
   zpětně. Akceptační kritéria a `Stav` k ní doplň, až je návrh řešení
   hotový a odsouhlasený (viz bod 2).
5. Jakmile je zadání kompletní — tj. víš přesně, co se má udělat, a
   nepotřebuješ se uživatele na nic dalšího doptávat — commitni (typicky
   jde jen o zápis do `user-stories.md`) jako `US-n-story-defined` a rovnou
   pushni na `origin/US-n`.
6. Po dokončení implementace, ještě před tím, než appku ručně otestuje
   uživatel, commitni jako `US-n-implemented-not-tested` a pushni.
7. Po ručním otestování uživatelem:
   - pokud testování odhalilo něco k opravě, po opravě commitni jako
     `US-n-implemented-and-tested` a pushni;
   - pokud testování neodhalilo nic k opravě (žádné nové změny), přejmenuj
     (`git commit --amend`) předchozí commit na `US-n-implemented-and-tested`
     a pushni s `--force-with-lease` (ten předchozí commit už je na
     `origin/US-n` z kroku 6, takže jde o přepsání historie jen na této
     vlastní feature branchi, ne na `master`).
8. Kromě těchto tří pojmenovaných checkpointů pushuj na `origin/US-n` i
   jakýkoli další commit, který během práce na story vznikne — uživatel
   běžně pracuje z 2–3 různých počítačů a potřebuje mít rozpracovanou story
   vidět všude.
9. Merge request/PR z `US-n` do `master` si po úspěšném otestování zakládá
   uživatel sám — nezakládej ho automaticky.
10. Když tvá změna mění chování popsané v existující story (typicky
    prototypové řešení, které nahrazuješ pořádným), **nepřepisuj tu starou
    story** — přidej novou (`US-n+1`) a u staré nastav
    `Stav: Nahrazena US-n+1` s jednořádkovým důvodem. Historie se má dát
    dohledat zpětně.
11. Nová story má vlastní ID (`US-n`), krátký název, popis požadovaného
    chování z pohledu uživatele/vývojáře, akceptační kritéria a stav
    (`Aktivní` / `Nahrazena US-x — důvod`).
12. Neslučuj víc nesouvisejících změn do jedné story.

## Nasazení

GitHub Pages z branch `main`, root adresář. Žádný CI/CD pipeline zatím není
nastavený — pokud ho budeš přidávat, založ to jako novou story.
