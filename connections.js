// Dopočet přímých spojů mezi dvojicí zastávek z GTFS static dat Golemio API,
// bez nutnosti stahovat a ručně parsovat celý PID_GTFS.zip (viz US-6).
// Odděleno od app.js (rendering/countdown) a config.js (běhová konfigurace).
(function () {
  const API_BASE = 'https://api.golemio.cz/v2';
  const STOP_PAIR_KEY = 'pid_departures_stop_pair';

  // Oblíbené a naposledy použité dvojice zastávek (US-14) — na rozdíl od
  // STOP_PAIR_KEY (jediná AKTUÁLNÍ dvojice) tohle jsou seznamy víc dvojic,
  // viz loadFavoritePairs/loadRecentPairs níže.
  const STOP_PAIR_FAVORITES_KEY = 'pid_departures_stop_pair_favorites';
  const STOP_PAIR_RECENTS_KEY = 'pid_departures_stop_pair_recents';
  const RECENT_PAIRS_MAX = 10;

  const STOP_INDEX_KEY = 'pid_departures_stop_index';
  const STOP_INDEX_PAGE_LIMIT = 10000;
  const STOP_INDEX_MAX_PAGES = 5; // bezpečnostní strop proti nekonečné stránkované smyčce
  const ROUTE_INDEX_KEY = 'pid_departures_route_index';

  // Per-stopId cache statického jízdního řádu (US-13) — viz
  // fetchStopSequences/fetchStopArrivals/fetchTripsForStop. Klíčovaná podle
  // jednotlivé zastávky, ne podle celé dvojice, aby se ušetřilo API volání,
  // i když se mezi dvěma dopočty opakuje jen jedna ze stanic.
  const STOP_SEQ_CACHE_KEY = 'pid_departures_stop_seq_cache';
  const STOP_ARRIVALS_CACHE_KEY = 'pid_departures_stop_arrivals_cache';
  const TRIP_INFO_CACHE_KEY = 'pid_departures_trip_info_cache';

  // Naučený tvar requestu (limit/minutesAfter) na departureboards pro danou
  // dvojici zastávek (US-20) — na rozdíl od STOP_SEQ_CACHE_KEY apod. není
  // vázaný na kalendářní den (viz loadDayCache), protože nejde o statická
  // jízdní data, ale o průběžně se přizpůsobující odhad. Klíčovaný podle
  // pairKey (název-název), stejně jako oblíbené/naposledy použité dvojice.
  const REQUEST_SHAPE_CACHE_KEY = 'pid_departures_request_shape_cache';

  // Cache klíče, které appka umí kdykoli zahodit a znovu dopočítat/stáhnout
  // (US-14-bug-fixes) — na rozdíl od oblíbených/naposledy použitých dvojic,
  // což je uživatelský obsah. Na mobilu (zejména PWA přidaná na plochu na
  // iOS) bývá kvóta localStorage jen kolem 1 MB, takže tyhle větší cache
  // (hlavně celý seznam zastávek) ji časem vyčerpají — viz trySetItem.
  const REGENERABLE_CACHE_KEYS = [
    STOP_INDEX_KEY,
    ROUTE_INDEX_KEY,
    STOP_SEQ_CACHE_KEY,
    STOP_ARRIVALS_CACHE_KEY,
    TRIP_INFO_CACHE_KEY,
    REQUEST_SHAPE_CACHE_KEY
  ];

  // US-20: cíl na jeden refresh (aspoň 5 shodných spojů a pokrytí aspoň
  // 35 min dopředu, co je přísnější), strop hledání do budoucnosti a
  // rozpočet requestů na Golemio — viz akceptační kritéria v
  // user-stories.md.
  const TARGET_MIN_MATCHES = 5;
  const TARGET_COVERAGE_MINUTES = 35;
  const SEARCH_HORIZON_MINUTES = 20 * 60;
  const REQUEST_ATTEMPTS_IF_SOME_MATCH = 2;
  const REQUEST_ATTEMPTS_IF_NO_MATCH = 5;
  const DEFAULT_REQUEST_SHAPE = { limit: 40, minutesAfter: 90 };
  const MAX_GOLEMIO_LIMIT = 1000; // dokumentovaný strop /pid/departureboards
  const REQUEST_SHAPE_MARGIN = 1.3; // rezerva při odhadu dalšího requestu
  const SHRINK_OVERSHOOT_RATIO = 1.5; // zmenšovat jen při výrazném přetahu
  const SHRINK_STEP = 0.5; // krok zmenšení k odhadnutému ideálu za refresh

  // Golemio limit: 20 req / 8 s na klíč. Místo pevné pauzy mezi requesty
  // (dřívější RATE_LIMIT_DELAY_MS) appka teď hospodaří s rozpočtem sdíleně
  // napříč VŠEMI voláními na Golemio (viz acquireSlot/golemioGet, US-11) —
  // ptá se tak často, jak to okno dovolí, a čeká jen když je skutečně plné.
  const RATE_WINDOW_MS = 8000;
  const RATE_SOFT_LIMIT = 18; // 90 % tvrdého limitu — rezerva na drobný skew

  // V paměti držený index všech zastávek (stop_name -> stopIds) pro
  // rychlé, case-insensitive vyhledávání na klientovi — viz warmStopIndex.
  let stopIndex = null;

  // V paměti držený index linek (route_id -> route_short_name), viz
  // warmRouteIndex — potřebný k převodu route_id z /gtfs/trips na krátký
  // název linky, který appka zobrazuje a se kterým porovnává departureboards.
  let routeIndex = null;

  // Sdílený stav rate governoru (US-11): timestampy požadavků povolených
  // v aktuálním okně + do kdy případně čekat po 429 (viz golemioGet).
  let requestLog = [];
  let cooldownUntil = 0;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Dnešní kalendářní den v lokálním čase jako "YYYY-MM-DD" (US-13). Cache
  // GTFS dat se váže na kalendářní den, ne na plovoucí 24h okno od stažení —
  // GTFS feed se může aktualizovat kdykoli během dne, takže položka stažená
  // těsně před půlnocí nemá "přežít" do stejného času druhý den.
  function todayKey() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  // Načte z localStorage cachovanou hodnotu pro daný dílčí klíč (typicky
  // stopId), pokud byla uložená dnes (US-13) — jinak null. Víc dílčích
  // hodnot se drží pohromadě pod jedním localStorage klíčem (storageKey).
  function loadDayCache(storageKey, subKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const all = JSON.parse(raw);
      const entry = all[subKey];
      return entry && entry.cachedDate === todayKey() ? entry.data : null;
    } catch (e) {
      return null;
    }
  }

  // Uloží hodnotu pro daný dílčí klíč s dnešním datem a zároveň zahodí
  // položky z jiných dnů (US-13) — cache tak neroste donekonečna, drží jen
  // to, co je relevantní pro dnešek.
  // Zapíše do localStorage; pokud selže kvůli plné kvótě (QuotaExceededError
  // — na mobilu běžné, viz REGENERABLE_CACHE_KEYS výše), postupně zahazuje
  // velké znovu-dopočitatelné cache a zápis zkouší znovu, dokud se buď
  // neuvolní dost místa, nebo nedojdou cache k zahození (US-14-bug-fixes).
  // Používá se pro malý, pro uživatele důležitý obsah (oblíbené/naposledy
  // použité/aktuální dvojice), který nesmí tiše zmizet jen proto, že si
  // appka mezitím nacpala kvótu velkým seznamem zastávek.
  function trySetItem(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      for (const cacheKey of REGENERABLE_CACHE_KEYS) {
        try { localStorage.removeItem(cacheKey); } catch (e2) { /* ignorujeme */ }
        try {
          localStorage.setItem(key, value);
          return true;
        } catch (e3) { /* zkusit uvolnit další cache */ }
      }
      console.warn('Nepodařilo se uložit do localStorage ani po uvolnění cache', key, e);
      return false;
    }
  }

  function saveDayCache(storageKey, subKey, data) {
    try {
      const raw = localStorage.getItem(storageKey);
      const all = raw ? JSON.parse(raw) : {};
      const today = todayKey();
      const pruned = {};
      Object.keys(all).forEach((key) => {
        if (all[key] && all[key].cachedDate === today) pruned[key] = all[key];
      });
      pruned[subKey] = { data, cachedDate: today };
      localStorage.setItem(storageKey, JSON.stringify(pruned));
    } catch (e) {
      console.warn('Nepodařilo se uložit cache', storageKey, e);
    }
  }

  // Gate volaná před každým requestem na Golemio. Pustí hned, pokud je
  // v posledních RATE_WINDOW_MS méně než RATE_SOFT_LIMIT požadavků; jinak
  // počká, dokud nejstarší z okna nevypadne. Respektuje i cooldown nastavený
  // po 429 (viz golemioGet) — po dobu cooldownu nepustí nic.
  async function acquireSlot() {
    for (;;) {
      const now = Date.now();
      if (now < cooldownUntil) {
        await sleep(cooldownUntil - now);
        continue;
      }
      const cutoff = now - RATE_WINDOW_MS;
      while (requestLog.length && requestLog[0] <= cutoff) requestLog.shift();
      if (requestLog.length < RATE_SOFT_LIMIT) {
        requestLog.push(now);
        return;
      }
      await sleep(Math.max(requestLog[0] + RATE_WINDOW_MS - now, 10));
    }
  }

  // Jediné místo, odkud appka mluví s Golemio API — každé volání jde přes
  // acquireSlot (proaktivní pacing) a na 429 samo počká a zkusí to znovu
  // (reaktivní cooldown, podle Retry-After headeru, jinak celé okno), než
  // chybu nechá probublat volajícímu. Volající tak 429 prakticky nikdy
  // neuvidí, pokud Golemio není nedostupné dlouhodobě (US-11).
  async function golemioGet(path, apiKey) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await acquireSlot();
      const res = await fetch(API_BASE + path, {
        headers: { 'X-Access-Token': apiKey }
      });
      if (res.status === 429 && attempt < maxAttempts) {
        const retryAfterSec = Number(res.headers.get('Retry-After'));
        cooldownUntil = Date.now() + (retryAfterSec > 0 ? retryAfterSec * 1000 : RATE_WINDOW_MS);
        console.warn('Golemio API 429, čekám před dalším pokusem');
        continue;
      }
      if (!res.ok) {
        const err = new Error('Golemio API chyba ' + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }
  }

  // Čas (v minutách od teď) do predikovaného/plánovaného odjezdu spoje,
  // podle stejné logiky jako predictedDate v app.js — držíme si vlastní
  // kopii, ať connections.js nezávisí na app.js (viz oddělení modulů).
  function departureMinutesFromNow(dep) {
    const ts = (dep && dep.departure_timestamp) || {};
    const iso = ts.predicted || ts.scheduled;
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return (d.getTime() - Date.now()) / 60000;
  }

  function loadRequestShape(pair) {
    try {
      const raw = localStorage.getItem(REQUEST_SHAPE_CACHE_KEY);
      if (!raw) return null;
      const all = JSON.parse(raw);
      const entry = all[pairKey(pair)];
      return entry && Number.isFinite(entry.limit) && Number.isFinite(entry.minutesAfter)
        ? { limit: entry.limit, minutesAfter: entry.minutesAfter }
        : null;
    } catch (e) {
      return null;
    }
  }

  function saveRequestShape(pair, shape) {
    try {
      const raw = localStorage.getItem(REQUEST_SHAPE_CACHE_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[pairKey(pair)] = { limit: shape.limit, minutesAfter: shape.minutesAfter };
      trySetItem(REQUEST_SHAPE_CACHE_KEY, JSON.stringify(all));
    } catch (e) {
      console.warn('Nepodařilo se uložit naučený tvar requestu', e);
    }
  }

  async function requestDepartureBoard(stopIds, shape, apiKey) {
    const params = new URLSearchParams();
    stopIds.forEach((id) => params.append('ids[]', id));
    params.set('limit', String(shape.limit));
    params.set('minutesAfter', String(shape.minutesAfter));
    params.set('order', 'real');
    params.set('mode', 'departures');
    return golemioGet('/pid/departureboards?' + params.toString(), apiKey);
  }

  // Garantované pokrytí (v minutách od teď) plynoucí z jedné odpovědi
  // (US-20) — Golemio vrací odjezdy vzestupně podle času (order=real):
  // pokud přišlo míň položek než poslaný limit, nic se neuřízlo a pokrytí
  // sahá do konce celého minutesAfter okna; jinak jen do času posledního
  // vráceného spoje.
  function coverageMinutesFromResponse(departures, shape) {
    if (departures.length < shape.limit) return shape.minutesAfter;
    const lastMinutes = departureMinutesFromNow(departures[departures.length - 1]);
    return lastMinutes != null ? lastMinutes : 0;
  }

  // Odhadne tvar dalšího requestu, když cíl (5 shodných spojů a 35 min
  // pokrytí) není splněný (US-20) — z poměru toho, co odpověď obsahovala,
  // a toho, jak daleko do budoucnosti je garantované pokrytí.
  function nextRequestShape(shape, departures, matched, coverageMinutes, truncated) {
    if (truncated) {
      // Uříznuto -> potřebujeme větší limit, který pokryje celé UŽ
      // požadované okno (shape.minutesAfter), ne jen 35minutovou podlahu.
      // Bug fix (US-20): dřív se tu cílilo jen na TARGET_COVERAGE_MINUTES
      // bez ohledu na to, jak velké okno appka ve skutečnosti žádala — u
      // frekventovaného uzlu, kde se okno mezitím rozrostlo (viz druhá
      // větev níž) třeba až na SEARCH_HORIZON_MINUTES, to zajišťovalo
      // limitu růst jen v mikroskopických krocích (rate * 35 min), takže
      // appka se prakticky navždy zasekla na stejném uříznutém requestu.
      const rate = departures.length / Math.max(coverageMinutes, 1);
      const neededLimit = Math.ceil(rate * shape.minutesAfter * REQUEST_SHAPE_MARGIN);
      return {
        limit: Math.min(MAX_GOLEMIO_LIMIT, Math.max(shape.limit + 1, neededLimit)),
        minutesAfter: shape.minutesAfter
      };
    }
    if (coverageMinutes < TARGET_COVERAGE_MINUTES) {
      // Neuříznuto, ale samotné okno je menší než 35minutová podlaha —
      // v praxi nedosažitelné (minutesAfter nikdy neklesne pod výchozích
      // 90 min), ponecháno jen jako bezpečnostní pojistka.
      return { limit: shape.limit, minutesAfter: TARGET_COVERAGE_MINUTES };
    }
    // 35 min je pokrytých, ale shodných spojů je < 5 -> potřebujeme hledat
    // dál do budoucnosti (a úměrně tomu i větší limit, ať se okno znovu
    // neuřízne cizími linkami dřív, než tam nové shody vůbec budou).
    const matchRate = matched.length / coverageMinutes;
    const targetMinutesAfter = matched.length > 0
      ? Math.ceil((TARGET_MIN_MATCHES / matchRate) * REQUEST_SHAPE_MARGIN)
      : shape.minutesAfter * 2; // nulová hustota shod zatím neumožňuje odhad
    const cappedMinutesAfter = Math.min(
      SEARCH_HORIZON_MINUTES,
      Math.max(shape.minutesAfter + 1, targetMinutesAfter)
    );
    const overallRate = departures.length / coverageMinutes;
    const neededLimit = Math.ceil(overallRate * cappedMinutesAfter * REQUEST_SHAPE_MARGIN);
    return {
      limit: Math.min(MAX_GOLEMIO_LIMIT, Math.max(shape.limit, neededLimit)),
      minutesAfter: cappedMinutesAfter
    };
  }

  // Odhad minimálního tvaru requestu, který by ještě splnil cíl, z jedné
  // NEuříznuté odpovědi (US-20) — základ pro postupné zmenšování naučeného
  // tvaru, když aktuálně vrací výrazně víc, než je potřeba.
  function estimateIdealShape(shape, departures, matched) {
    let idealMinutesAfter = TARGET_COVERAGE_MINUTES;
    if (matched.length >= TARGET_MIN_MATCHES) {
      const fifthMinutes = departureMinutesFromNow(matched[TARGET_MIN_MATCHES - 1]);
      if (fifthMinutes != null) idealMinutesAfter = Math.max(idealMinutesAfter, fifthMinutes);
    }
    idealMinutesAfter = Math.ceil(idealMinutesAfter * REQUEST_SHAPE_MARGIN);
    const density = departures.length / shape.minutesAfter;
    const idealLimit = Math.max(TARGET_MIN_MATCHES, Math.ceil(density * idealMinutesAfter * REQUEST_SHAPE_MARGIN));
    return { limit: idealLimit, minutesAfter: idealMinutesAfter };
  }

  // Posune tvar requestu kus cesty směrem k odhadnutému ideálu, místo
  // rovnou na minimum (US-20) — ať drobné výkyvy v provozu nezpůsobí, že
  // příští refresh hned zase uřízne a musí dohledávat další stránku.
  function shrinkTowardsIdeal(shape, ideal) {
    const overshoot = shape.limit >= ideal.limit * SHRINK_OVERSHOOT_RATIO
      || shape.minutesAfter >= ideal.minutesAfter * SHRINK_OVERSHOOT_RATIO;
    if (!overshoot) return shape;
    return {
      limit: Math.max(ideal.limit, Math.round(shape.limit - (shape.limit - ideal.limit) * SHRINK_STEP)),
      minutesAfter: Math.max(
        ideal.minutesAfter,
        Math.round(shape.minutesAfter - (shape.minutesAfter - ideal.minutesAfter) * SHRINK_STEP)
      )
    };
  }

  // Hlavní vstupní bod pro US-20: místo jednoho pevného volání
  // departureboards (limit=40/minutesAfter=90) si podle potřeby vyžádá
  // víc/větší requesty, dokud nemá aspoň 5 shodných spojů a pokrytí aspoň
  // 35 min dopředu (nebo dokud nevyčerpá 20h horizont či rozpočet requestů
  // na refresh), a naučený tvar requestu si uloží pro příští refreshe.
  // Všechny requesty jdou přes golemioGet/acquireSlot beze změny — jen se
  // jich pošle víc/jinak velkých.
  async function fetchDeparturesAdaptive(pair, apiKey, isAllowedFn) {
    let shape = loadRequestShape(pair) || Object.assign({}, DEFAULT_REQUEST_SHAPE);
    let data = null;
    let departures = [];
    let matched = [];
    let coverageMinutes = 0;
    let truncated = false;
    let targetMet = false;
    let budget = REQUEST_ATTEMPTS_IF_NO_MATCH;
    let attempt = 0;

    for (;;) {
      attempt++;
      data = await requestDepartureBoard(pair.from.stopIds, shape, apiKey);
      departures = data.departures || [];
      matched = departures.filter((dep) => isAllowedFn(
        dep.route && dep.route.short_name,
        dep.trip && dep.trip.headsign
      ));
      truncated = departures.length >= shape.limit;
      coverageMinutes = coverageMinutesFromResponse(departures, shape);

      if (attempt === 1) {
        budget = matched.length >= 1 ? REQUEST_ATTEMPTS_IF_SOME_MATCH : REQUEST_ATTEMPTS_IF_NO_MATCH;
      }

      targetMet = matched.length >= TARGET_MIN_MATCHES && coverageMinutes >= TARGET_COVERAGE_MINUTES;
      // Bug fix (US-20): horizonExhausted musí vycházet ze skutečně
      // ověřeného pokrytí (coverageMinutes), ne z požadované velikosti
      // okna (shape.minutesAfter) — když je odpověď uříznutá limitem
      // (truncated), požadované okno může být klidně 20h, ale reálně
      // ověřeno je jen pár desítek minut. Dřívější podmínka to
      // ignorovala, takže se u frekventovaných uzlů (např. Smíchovské
      // nádraží) naučený tvar zamrzl na uříznutém requestu navždy.
      const horizonExhausted = coverageMinutes >= SEARCH_HORIZON_MINUTES;
      if (targetMet || horizonExhausted || attempt >= budget) break;

      shape = nextRequestShape(shape, departures, matched, coverageMinutes, truncated);
    }

    // Zmenšovat naučený tvar zkoušíme jen po skutečně splněném cíli — když
    // appka vzdala hledání na 20h horizontu s < 5 shodami, jde o řídce
    // obsluhovanou dvojici, která ten velký tvar zase příští refresh
    // potřebuje celý, ne zmenšit (viz US-20 v user-stories.md).
    let finalShape = shape;
    if (!truncated && targetMet) {
      finalShape = shrinkTowardsIdeal(shape, estimateIdealShape(shape, departures, matched));
    }
    saveRequestShape(pair, finalShape);

    return data;
  }

  // Golemio GTFS endpointy vrací GeoJSON FeatureCollection — properties
  // obsahují skutečná data, features je pole záznamů.
  function featureProps(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.features)) {
      return data.features.map((f) => f.properties || f);
    }
    return [];
  }

  // Seskupí syrové GTFS řádky podle stop_name -> pole stop_id (jedna stanice
  // = víc nástupišť).
  function groupStopsByName(rows) {
    const byName = new Map();
    rows.forEach((row) => {
      const name = row.stop_name;
      const id = row.stop_id;
      if (!name || !id) return;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(id);
    });
    return Array.from(byName.entries()).map(([name, stopIds]) => ({ name, stopIds }));
  }

  // Zajistí, že je k dispozici čerstvý index všech zastávek (stop_name ->
  // stopIds), a to buď z localStorage (pokud je z dnešního kalendářního dne,
  // US-13), nebo čerstvým stránkovaným stažením celého /gtfs/stops. Bez
  // names[] filtru je to jediný způsob, jak vyhledávat case-insensitive/
  // částečnou shodou — Golemio API samo takové vyhledávání nenabízí (jen
  // exaktní název).
  async function warmStopIndex(apiKey, onProgress) {
    const report = (text) => { if (onProgress) onProgress(text); };

    try {
      const raw = localStorage.getItem(STOP_INDEX_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && Array.isArray(cached.stops) && cached.cachedDate === todayKey()) {
          stopIndex = cached.stops;
          return;
        }
      }
    } catch (e) {
      // poškozený/starý záznam v localStorage - ignorujeme a stáhneme znovu
    }

    report('Stahuji seznam zastávek…');
    const allRows = [];
    for (let page = 0; page < STOP_INDEX_MAX_PAGES; page++) {
      const offset = page * STOP_INDEX_PAGE_LIMIT;
      const data = await golemioGet(
        '/gtfs/stops?limit=' + STOP_INDEX_PAGE_LIMIT + '&offset=' + offset,
        apiKey
      );
      const rows = featureProps(data);
      allRows.push(...rows);
      report('Stahuji seznam zastávek… (' + allRows.length + ')');
      if (rows.length < STOP_INDEX_PAGE_LIMIT) break;
    }

    const stops = groupStopsByName(allRows);
    stopIndex = stops;
    try {
      localStorage.setItem(STOP_INDEX_KEY, JSON.stringify({ stops, cachedDate: todayKey() }));
    } catch (e) {
      console.warn('Nepodařilo se uložit index zastávek', e);
    }
  }

  // Odstraní diakritiku a převede na malá písmena (US-12) — ať se dá hledat
  // "budejovicka" i pro zastávku "Budějovická".
  function foldDiacritics(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Vyhledá zastávky podle názvu, bez diakritiky a podle začátků
  // jednotlivých slov (US-12), nad klientským indexem (viz warmStopIndex) —
  // ne dotazem na server. Dotaz se rozdělí na tokeny podle mezer a každý
  // token musí být prefixem některého (dalšího, v pořadí zleva doprava)
  // slova z názvu zastávky — např. "pol b" tak najde "Poliklinika
  // Budějovická" i "Poliklinika Barrandov", ne jen shodu od úplného začátku
  // názvu. Pomlčka v názvu zastávky se chová jako další oddělovač slov
  // (rozšíření US-12) — "Praha-Libeň" se tak dá najít i jako "p li".
  // Výsledky se vrací seřazené abecedně.
  async function searchStops(query, apiKey) {
    const tokens = foldDiacritics(query.trim()).split(/[\s-]+/).filter(Boolean);
    if (!tokens.length) return [];
    if (!stopIndex) await warmStopIndex(apiKey);

    const matches = stopIndex.filter((stop) => {
      const words = foldDiacritics(stop.name).split(/[\s-]+/).filter(Boolean);
      let from = 0;
      return tokens.every((token) => {
        const idx = words.findIndex((w, i) => i >= from && w.startsWith(token));
        if (idx === -1) return false;
        from = idx + 1;
        return true;
      });
    });

    matches.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    return matches.slice(0, 25);
  }

  // Stáhne stop_times pro danou zastávku (bez date filtru = celé okno
  // platnosti feedu, včetně nočních linek) a vrátí Map trip_id -> nejnižší
  // stop_sequence, na jaké tam ten spoj zastavuje.
  //
  // Pozor: trip_id je u Golemio feedu specifický pro konkrétní kalendářní
  // den (např. "991_1156_180709"), takže jeden a ten samý reálný spoj se
  // v okně ~2 týdnů objeví jako desítky různých trip_id — to je v pořádku,
  // computeAllowedRoutes dál dedupuje podle dvojice route/headsign, ne podle
  // trip_id.
  async function fetchStopSequences(stopId, apiKey) {
    const cached = loadDayCache(STOP_SEQ_CACHE_KEY, stopId);
    if (cached) return new Map(cached);

    const data = await golemioGet(
      '/gtfs/stoptimes/' + encodeURIComponent(stopId) + '?limit=10000',
      apiKey
    );
    const rows = featureProps(data);
    const map = new Map();
    rows.forEach((row) => {
      const tripId = row.trip_id;
      const seq = Number(row.stop_sequence);
      if (!tripId || Number.isNaN(seq)) return;
      const prev = map.get(tripId);
      if (prev === undefined || seq < prev) map.set(tripId, seq);
    });
    saveDayCache(STOP_SEQ_CACHE_KEY, stopId, Array.from(map.entries()));
    return map;
  }

  // Stáhne stop_times pro danou zastávku a vrátí Map trip_id -> arrival_time
  // (string "HH:MM:SS", může přesáhnout 24:00:00 u spojů přes půlnoc — GTFS
  // konvence). Použito pro dopočet času příjezdu do cílové zastávky (US-8) —
  // na rozdíl od fetchStopSequences nezajímá stop_sequence, ale čas.
  //
  // allowedTripIds (US-18, volitelné) — Set trip_id, které appka už z
  // dnešního stop_seq_cache obou zastávek prokazatelně zná jako přímé spoje
  // dané dvojice (viz candidateTripIdsFromCache). Pokud je zadaný, do
  // localStorage se uloží jen tahle podmnožina (drtivá většina spojů přes
  // velký přestupní uzel appku vůbec nezajímá) — v paměti appka ale i tak
  // dostane a používá kompletní mapu pro AKTUÁLNÍ session, takže tohle
  // prořezání nemá žádný dopad na chování dnešního běhu appky, jen na to,
  // co přežije do dalšího čtení z localStorage.
  async function fetchStopArrivals(stopId, apiKey, allowedTripIds) {
    const cached = loadDayCache(STOP_ARRIVALS_CACHE_KEY, stopId);
    if (cached) return new Map(cached);

    const data = await golemioGet(
      '/gtfs/stoptimes/' + encodeURIComponent(stopId) + '?limit=10000',
      apiKey
    );
    const rows = featureProps(data);
    const map = new Map();
    rows.forEach((row) => {
      const tripId = row.trip_id;
      if (!tripId || !row.arrival_time) return;
      map.set(tripId, row.arrival_time);
    });
    const toStore = allowedTripIds
      ? Array.from(map.entries()).filter(([tripId]) => allowedTripIds.has(tripId))
      : Array.from(map.entries());
    saveDayCache(STOP_ARRIVALS_CACHE_KEY, stopId, toStore);
    return map;
  }

  // Sekvenční dotazy přes všechna nástupiště cílové zastávky — rate limit
  // hlídá sdíleně golemioGet (viz acquireSlot), tady se jen sčítají výsledky.
  async function mergeArrivals(stopIds, apiKey, allowedTripIds) {
    const merged = new Map();
    for (let i = 0; i < stopIds.length; i++) {
      const arrivals = await fetchStopArrivals(stopIds[i], apiKey, allowedTripIds);
      arrivals.forEach((time, tripId) => merged.set(tripId, time));
    }
    return merged;
  }

  // Zjistí (bez jakéhokoli API volání navíc — US-18), jestli appka už dnes
  // má v cache stop_seq_cache pro VŠECHNA nástupiště origin i dest zastávky
  // (typicky hned po computeAllowedRoutes pro nově zvolenou dvojici). Pokud
  // ano, vrátí Set trip_id, které mezi nimi jedou ve správném pořadí — přesně
  // stejná definice "přímého spoje", jakou používá computeAllowedRoutes.
  // Pokud stop_seq_cache pro některou zastávku ještě dnes není (typicky
  // dvojice aktivovaná z oblíbených/naposledy použitých v novém dni), vrátí
  // null — volající pak filtrování přeskočí, aby si o chybějící data
  // nemusel říkat novým requestem.
  function candidateTripIdsFromCache(originStopIds, destStopIds) {
    function mergedSeqFromCache(stopIds) {
      const merged = new Map();
      for (const stopId of stopIds) {
        const cached = loadDayCache(STOP_SEQ_CACHE_KEY, stopId);
        if (!cached) return null;
        cached.forEach(([tripId, seq]) => {
          const prev = merged.get(tripId);
          if (prev === undefined || seq < prev) merged.set(tripId, seq);
        });
      }
      return merged;
    }

    const originSeq = mergedSeqFromCache(originStopIds);
    if (!originSeq) return null;
    const destSeq = mergedSeqFromCache(destStopIds);
    if (!destSeq) return null;

    const candidates = new Set();
    originSeq.forEach((originIdx, tripId) => {
      const destIdx = destSeq.get(tripId);
      if (destIdx !== undefined && destIdx > originIdx) candidates.add(tripId);
    });
    return candidates;
  }

  // Načte jízdním řádem daný (statický) čas příjezdu do cílové zastávky pro
  // všechny spoje, které přes ni jedou. Volá se jednou při nastavení/změně
  // BOARD_CONFIG (US-8), ne při každém refreshi odjezdů — statický jízdní
  // řád se v rámci jedné session nemění.
  async function loadDestinationArrivals(destStopIds, originStopIds, apiKey, onProgress) {
    const report = (text) => { if (onProgress) onProgress(text); };
    report('Načítám jízdní řád cílové zastávky…');
    const allowedTripIds = candidateTripIdsFromCache(originStopIds || [], destStopIds);
    return mergeArrivals(destStopIds, apiKey, allowedTripIds);
  }

  // Poloha vozidla pro konkrétní spoj (US-8, rozšířeno v US-17) — na rozdíl
  // od GTFS endpointů vrací Golemio tady jeden GeoJSON Feature (ne
  // FeatureCollection), skutečná data jsou tedy v properties, ne přímo v
  // odpovědi. Vrátí {originTimestamp, lastStopId} nebo null, pokud spoj nemá
  // aktuální polohu (404) nebo properties neobsahuje last_position — to není
  // fatální chyba, řádek se prostě zobrazí bez informace o poloze.
  // lastStopId (last_position.last_stop.id) je null, dokud vozidlo svou
  // zdrojovou zastávku ještě neopustilo — jakmile ji opustí, zůstává
  // vyplněné ID té zastávky po celou dobu jízdy k další (US-17: appka to
  // používá jako potvrzení, že spoj skutečně odjel).
  async function fetchVehiclePosition(tripId, apiKey) {
    try {
      const data = await golemioGet('/vehiclepositions/' + encodeURIComponent(tripId), apiKey);
      const props = data && data.properties;
      const pos = props && props.last_position;
      const iso = pos && pos.origin_timestamp;
      if (!iso) return null;
      const d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      const lastStopId = (pos.last_stop && pos.last_stop.id) || null;
      return {originTimestamp: d, lastStopId};
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw e;
      return null;
    }
  }

  // Znovu ověří polohu vozidla pro víc spojů sekvenčně — rate limit hlídá
  // sdíleně golemioGet (viz acquireSlot). Volá se s KAŽDÝM refreshem seznamu
  // spojů pro všechny aktuálně sledované spoje (US-8 zpětná vazba: jednorázové
  // zjištění polohy nestačí, potřeba průběžně ověřovat, jak moc je poslední
  // známý údaj čerstvý). Výsledek jednoho spoje se hlásí přes
  // onResult(tripId, {originTimestamp, lastStopId}|null) hned po dotazu, aby
  // volající (app.js) mohl průběžně promítat nové hodnoty do UI bez čekání
  // na celou dávku. Chyba 401/403 z fetchVehiclePosition přeruší dávku a
  // probublá volajícímu.
  async function fetchVehiclePositions(tripIds, apiKey, onResult) {
    for (let i = 0; i < tripIds.length; i++) {
      const tripId = tripIds[i];
      const result = await fetchVehiclePosition(tripId, apiKey);
      if (onResult) onResult(tripId, result);
    }
  }

  // Přestupní uzly (typicky metro) mají pod stejným stop_name desítky
  // nástupišť/směrů (samostatné stop_id) — golemioGet tyhle requesty sdíleně
  // rozpočítá (viz acquireSlot), takže i u velkých uzlů appka nepřekročí
  // Golemio rate limit (20 req / 8 s na klíč).
  async function mergeSequences(stopIds, apiKey) {
    const merged = new Map();
    for (let i = 0; i < stopIds.length; i++) {
      const seqs = await fetchStopSequences(stopIds[i], apiKey);
      seqs.forEach((seq, tripId) => {
        const prev = merged.get(tripId);
        if (prev === undefined || seq < prev) merged.set(tripId, seq);
      });
    }
    return merged;
  }

  // Zajistí index linek (route_id -> route_short_name), z localStorage
  // (pokud je z dnešního kalendářního dne, US-13) nebo čerstvým stažením
  // /gtfs/routes. Seznam linek celé sítě PID je krátký (stovky záznamů),
  // stačí jedna stránka a nemá smysl ho stahovat opakovaně pro každý
  // dopočet spojů.
  async function warmRouteIndex(apiKey, onProgress) {
    const report = (text) => { if (onProgress) onProgress(text); };

    try {
      const raw = localStorage.getItem(ROUTE_INDEX_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && Array.isArray(cached.routes) && cached.cachedDate === todayKey()) {
          routeIndex = new Map(cached.routes);
          return;
        }
      }
    } catch (e) {
      // poškozený/starý záznam v localStorage - ignorujeme a stáhneme znovu
    }

    report('Stahuji seznam linek…');
    const data = await golemioGet('/gtfs/routes?limit=10000', apiKey);
    const rows = featureProps(data);
    const entries = rows
      .filter((row) => row.route_id)
      .map((row) => [row.route_id, row.route_short_name || row.route_id]);
    routeIndex = new Map(entries);
    try {
      localStorage.setItem(ROUTE_INDEX_KEY, JSON.stringify({ routes: entries, cachedDate: todayKey() }));
    } catch (e) {
      console.warn('Nepodařilo se uložit index linek', e);
    }
  }

  // Stáhne (v jednom stránkovaném dotazu) pro danou zastávku všechny spoje,
  // které přes ni jedou, včetně route_id a cílového nápisu — na rozdíl od
  // /gtfs/stoptimes to Golemio API vrací přímo bez nutnosti dotazovat každý
  // trip_id zvlášť. Vrátí Map trip_id -> {routeId, headsign}.
  async function fetchTripsForStop(stopId, apiKey) {
    const cached = loadDayCache(TRIP_INFO_CACHE_KEY, stopId);
    if (cached) return new Map(cached);

    const data = await golemioGet(
      '/gtfs/trips?stopId=' + encodeURIComponent(stopId) + '&limit=10000',
      apiKey
    );
    const rows = featureProps(data);
    const map = new Map();
    rows.forEach((row) => {
      if (!row.trip_id) return;
      map.set(row.trip_id, { routeId: row.route_id, headsign: row.trip_headsign || '' });
    });
    saveDayCache(TRIP_INFO_CACHE_KEY, stopId, Array.from(map.entries()));
    return map;
  }

  async function mergeTripInfo(stopIds, apiKey) {
    const merged = new Map();
    for (let i = 0; i < stopIds.length; i++) {
      const infos = await fetchTripsForStop(stopIds[i], apiKey);
      infos.forEach((info, tripId) => {
        if (!merged.has(tripId)) merged.set(tripId, info);
      });
    }
    return merged;
  }

  // Najde přímé spoje mezi dvěma dvojicemi zastávek (origin/dest může mít
  // víc nástupišť) a vrátí unikátní dvojice {route, headsign} ve stejném
  // tvaru, jaký app.js dřív očekával v BOARD_CONFIG.allowed.
  //
  // Route/headsign pro kandidátní spoje se získává hromadně přes
  // /gtfs/trips?stopId= (viz fetchTripsForStop) místo dřívějšího dotazu
  // per trip_id (/public/gtfs/trips/{id}) — u frekventovaných přestupních
  // uzlů to znamenalo desítky až stovky sekvenčních requestů, každý s
  // povinnou pauzou kvůli rate limitu. Díky tomu navíc odpadá potřeba
  // jakéhokoli stropu/vzorkování kandidátů — kontrolujeme je všechny.
  async function computeAllowedRoutes(originStopIds, destStopIds, apiKey, onProgress) {
    const report = (text) => { if (onProgress) onProgress(text); };

    report('Načítám jízdní řád výchozí zastávky…');
    const originSeq = await mergeSequences(originStopIds, apiKey);
    report('Načítám jízdní řád cílové zastávky…');
    const destSeq = await mergeSequences(destStopIds, apiKey);

    const candidateIds = [];
    originSeq.forEach((originIdx, tripId) => {
      const destIdx = destSeq.get(tripId);
      if (destIdx !== undefined && destIdx > originIdx) candidateIds.push(tripId);
    });
    if (!candidateIds.length) return [];

    report('Načítám informace o spojích…');
    const tripInfoById = await mergeTripInfo(originStopIds, apiKey);
    await warmRouteIndex(apiKey, report);

    const seenCombos = new Set();
    const result = [];
    candidateIds.forEach((tripId) => {
      const info = tripInfoById.get(tripId);
      if (!info) return; // neznámý trip_id (nemělo by nastat, ale buďme robustní)
      const routeShort = routeIndex.get(info.routeId) || info.routeId || '?';
      const combo = routeShort + '|' + info.headsign;
      if (!seenCombos.has(combo)) {
        seenCombos.add(combo);
        result.push({ route: routeShort, headsign: info.headsign });
      }
    });

    return result;
  }

  function loadStopPair() {
    try {
      const raw = localStorage.getItem(STOP_PAIR_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('Nepodařilo se načíst uloženou dvojici zastávek', e);
      return null;
    }
  }

  function saveStopPair(pair) {
    trySetItem(STOP_PAIR_KEY, JSON.stringify(pair));
    pruneOrphanedStopCaches();
  }

  function clearStopPair() {
    try { localStorage.removeItem(STOP_PAIR_KEY); } catch (e) {}
  }

  // Identita dvojice pro oblíbené/naposledy použité (US-14) — podle názvu
  // zastávek, ne podle stopIds, protože i řazení oblíbených je požadované
  // podle názvu (viz sortPairsAlphabetically).
  function pairKey(pair) {
    return pair.from.name + '|' + pair.to.name;
  }

  function sortPairsAlphabetically(pairs) {
    return pairs.slice().sort((a, b) => {
      const byFrom = a.from.name.localeCompare(b.from.name, 'cs');
      return byFrom !== 0 ? byFrom : a.to.name.localeCompare(b.to.name, 'cs');
    });
  }

  function loadFavoritePairs() {
    try {
      const raw = localStorage.getItem(STOP_PAIR_FAVORITES_KEY);
      const pairs = raw ? JSON.parse(raw) : [];
      return sortPairsAlphabetically(Array.isArray(pairs) ? pairs : []);
    } catch (e) {
      console.warn('Nepodařilo se načíst oblíbené dvojice zastávek', e);
      return [];
    }
  }

  function saveFavoritePairs(pairs) {
    const ok = trySetItem(STOP_PAIR_FAVORITES_KEY, JSON.stringify(sortPairsAlphabetically(pairs)));
    if (ok) pruneOrphanedStopCaches();
    return ok;
  }

  function isFavoritePair(pair) {
    const key = pairKey(pair);
    return loadFavoritePairs().some((p) => pairKey(p) === key);
  }

  // Vrací true/false podle toho, jestli se zápis do localStorage povedl
  // (US-14-bug-fixes) — volající (hvězdička v app.js) na false zobrazí
  // uživateli chybu místo tichého selhání.
  function addFavoritePair(pair) {
    const key = pairKey(pair);
    const pairs = loadFavoritePairs().filter((p) => pairKey(p) !== key);
    pairs.push(pair);
    return saveFavoritePairs(pairs);
  }

  function removeFavoritePair(pair) {
    const key = pairKey(pair);
    return saveFavoritePairs(loadFavoritePairs().filter((p) => pairKey(p) !== key));
  }

  function loadRecentPairs() {
    try {
      const raw = localStorage.getItem(STOP_PAIR_RECENTS_KEY);
      const pairs = raw ? JSON.parse(raw) : [];
      return Array.isArray(pairs) ? pairs : [];
    } catch (e) {
      console.warn('Nepodařilo se načíst naposledy použité dvojice zastávek', e);
      return [];
    }
  }

  // Přidá dvojici na začátek seznamu naposledy použitých (US-14). Pokud tam
  // stejná dvojice (podle názvu) už je, přesune se na začátek místo vzniku
  // duplicity. Ořízne na RECENT_PAIRS_MAX — nejstarší položka tiše vypadne,
  // žádné ruční mazání není potřeba (viz user-stories.md).
  function pushRecentPair(pair) {
    const key = pairKey(pair);
    const pairs = loadRecentPairs().filter((p) => pairKey(p) !== key);
    pairs.unshift(pair);
    trySetItem(STOP_PAIR_RECENTS_KEY, JSON.stringify(pairs.slice(0, RECENT_PAIRS_MAX)));
    pruneOrphanedStopCaches();
  }

  // Po každé změně aktivní/oblíbené/naposledy použité dvojice (US-18) smaže
  // z per-stopId cache (stop_seq_cache, trip_info_cache, stop_arrivals_cache)
  // záznamy pro zastávky, které už nepatří žádné z aktuálně uložených dvojic.
  // Obsah zachovaných záznamů se nemění — jen se appka zbaví dat pro
  // zastávky, které už nemá šanci znovu použít bez nového dopočtu. Stejně se
  // (podle pairKey, ne stopId) prořezává i naučený tvar requestu pro US-20 —
  // je to obdoba per-stanice cache, viz jeho definice výš.
  function pruneOrphanedStopCaches() {
    const keepStopIds = new Set();
    const keepPairKeys = new Set();
    function collect(pair) {
      if (!pair) return;
      ((pair.from && pair.from.stopIds) || []).forEach((id) => keepStopIds.add(id));
      ((pair.to && pair.to.stopIds) || []).forEach((id) => keepStopIds.add(id));
      keepPairKeys.add(pairKey(pair));
    }
    collect(loadStopPair());
    loadFavoritePairs().forEach(collect);
    loadRecentPairs().forEach(collect);

    [STOP_SEQ_CACHE_KEY, TRIP_INFO_CACHE_KEY, STOP_ARRIVALS_CACHE_KEY].forEach((storageKey) => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const all = JSON.parse(raw);
        const pruned = {};
        Object.keys(all).forEach((stopId) => {
          if (keepStopIds.has(stopId)) pruned[stopId] = all[stopId];
        });
        localStorage.setItem(storageKey, JSON.stringify(pruned));
      } catch (e) {
        console.warn('Nepodařilo se prořezat cache osiřelých zastávek', storageKey, e);
      }
    });

    try {
      const raw = localStorage.getItem(REQUEST_SHAPE_CACHE_KEY);
      if (raw) {
        const all = JSON.parse(raw);
        const pruned = {};
        Object.keys(all).forEach((key) => {
          if (keepPairKeys.has(key)) pruned[key] = all[key];
        });
        localStorage.setItem(REQUEST_SHAPE_CACHE_KEY, JSON.stringify(pruned));
      }
    } catch (e) {
      console.warn('Nepodařilo se prořezat cache naučeného tvaru requestu', e);
    }
  }

  window.Connections = {
    searchStops,
    warmStopIndex,
    computeAllowedRoutes,
    loadDestinationArrivals,
    fetchVehiclePositions,
    golemioGet,
    fetchDeparturesAdaptive,
    loadStopPair,
    saveStopPair,
    clearStopPair,
    loadFavoritePairs,
    addFavoritePair,
    removeFavoritePair,
    isFavoritePair,
    loadRecentPairs,
    pushRecentPair
  };
})();
