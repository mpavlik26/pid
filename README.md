# PID odjezdy — Zelený pruh → Poliklinika Budějovická

Jednoduchá PWA, která zobrazuje přímé spoje Pražské integrované dopravy mezi
zastávkou **Zelený pruh** a **Poliklinika Budějovická**, seřazené podle
skutečně zbývajícího času do odjezdu (přepočteno podle reálné polohy vozu,
pokud je dostupná).

Žádná mapa, žádný bordel navíc — jen seznam.

## Jak to funguje

- Zdroj dat: [Golemio API](https://api.golemio.cz/) (oficiální datová platforma
  Prahy), endpoint `/v2/pid/departureboards`.
- Appka se zeptá na *váš vlastní* API klíč (zdarma, viz níže) a uloží ho do
  `localStorage` prohlížeče. Klíč nikam jinam neodchází.
- Filtr linek/směrů je v `config.js` — natvrdo tam jsou zapsané linky, které
  aktuálně jezdí přímo mezi těmito dvěma zastávkami (114, 134, noční 914).

## Nastavení API klíče

1. Zaregistruj se na <https://api.golemio.cz/api-keys/auth/sign-up> (zdarma).
2. Vlož klíč do appky při prvním spuštění.

## Lokální spuštění

Je to čistě statický web (žádný build krok). Stačí:

```bash
python3 -m http.server 8080
# nebo: npx serve .
```

a otevřít `http://localhost:8080`. (Otevření přes `file://` většinou funguje
taky, ale service worker se u některých prohlížečů přes `file://`
nezaregistruje — pro plnou PWA funkčnost je lepší lokální server.)

## Nasazení jako PWA (GitHub Pages)

```bash
git push -u origin main
```

a v nastavení repozitáře zapnout **Settings → Pages → Deploy from branch →
main / (root)**. Appka pak poběží na `https://<uživatel>.github.io/<repo>/`
a půjde si ji na mobilu přidat na plochu ("Přidat na plochu" / "Add to Home
Screen") jako běžnou appku.

## Aktualizace seznamu linek

Pokud ROPID změní linkové vedení, seznam povolených linek v `config.js`
zastará. Postup, jak ho znovu vygenerovat:

1. Stáhnout aktuální jízdní řády: `https://data.pid.cz/PID_GTFS.zip`
2. Rozbalit a najít `stop_id` obou zastávek v `stops.txt`.
3. V `stop_times.txt` najít trip_id, které obsahují obě zastávky ve správném
   pořadí (Zelený pruh dřív než Poliklinika Budějovická).
4. Podle těch trip_id dohledat v `trips.txt` čísla linek (`routes.txt`) a
   cílové tabule (`trip_headsign`).
5. Aktualizovat pole `allowed` v `config.js`.

(Dalo by se to i zautomatizovat skriptem, který by tohle dělal za tebe při
buildu — zatím to ale není potřeba pro dvě zastávky.)

## Známá omezení

- Placeholder ikony v `icons/` jsou vygenerované narychlo (amber čtverec) —
  budou chtít pořádný redesign, než to bude vypadat jako "appka", ne prototyp.
- Appka počítá s jednou pevnou dvojicí zastávek. Rozšíření na víc tras by
  chtělo předělat `config.js` na pole více "boards" a přidat přepínač v UI.
- Přesnost countdownu na vteřiny je vizuální plynulost, ne záruka — predikce
  vychází z GPS polohy vozu a modelu zpoždění, ne z fyzického příjezdu na
  vteřinu přesně.
