# PID odjezdy

Jednoduchá PWA, která zobrazuje přímé spoje Pražské integrované dopravy mezi
libovolnou dvojicí zastávek, které si zvolíte v appce, seřazené podle
skutečně zbývajícího času do odjezdu (přepočteno podle reálné polohy vozu,
pokud je dostupná).

Žádná mapa, žádný bordel navíc — jen seznam.

## Jak to funguje

- Zdroj dat: [Golemio API](https://api.golemio.cz/) (oficiální datová platforma
  Prahy), endpoint `/v2/pid/departureboards` pro odjezdy a GTFS static
  endpointy (`/v2/gtfs/...`) pro dopočet přímých spojů.
- Appka se zeptá na *váš vlastní* API klíč (zdarma, viz níže) a uloží ho do
  `localStorage` prohlížeče. Klíč nikam jinam neodchází.
- Při prvním spuštění (nebo po kliknutí na "změnit zastávky") appka nechá
  vybrat dvojici zastávek (Odkud/Kam) a sama dopočítá, které linky a směry
  mezi nimi jezdí přímo — viz `connections.js`. Zvolená dvojice a dopočtený
  seznam linek se uloží do `localStorage`, takže se příště appka rovnou
  naběhne na poslední dvojici bez opětovného dopočtu.

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

Seznam povolených linek/směrů se **nedopočítává ručně** a needituje se v
`config.js` — appka si ho sama dopočítá při volbě dvojice zastávek (viz výš),
z GTFS static dat Golemio API (`connections.js`, funkce
`computeAllowedRoutes`). Pokud ROPID změní linkové vedení, stačí v appce
kliknout na "změnit zastávky" a nechat dopočet proběhnout znovu — žádný
ruční zásah do kódu.

## Známá omezení

- Placeholder ikony v `icons/` jsou vygenerované narychlo (amber čtverec) —
  budou chtít pořádný redesign, než to bude vypadat jako "appka", ne prototyp.
- Přesnost countdownu na vteřiny je vizuální plynulost, ne záruka — predikce
  vychází z GPS polohy vozu a modelu zpoždění, ne z fyzického příjezdu na
  vteřinu přesně.
