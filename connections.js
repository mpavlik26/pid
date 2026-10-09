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

  // Per-stopId cache statického jízdního řádu (US-13) — viz
  // loadStopTimes. Klíčovaná podle jednotlivé
  // zastávky, ne podle celé dvojice, aby se ušetřilo API volání, i když se
  // mezi dvěma dopočty opakuje jen jedna ze stanic.
  // US-6-bug-fixes (v44): obsah je od téhle verze omezený na dnešní a včerejší
  // servisní den (date filtr na /gtfs/stoptimes), ne na celé okno feedu —
  // proto nové názvy klíčů; staré záznamy (viz LEGACY_CACHE_KEYS) by se jinak
  // četly jako platné dnešní a míchaly by do průniku cizí dny.
  const STOP_SEQ_CACHE_KEY = 'pid_departures_stop_seq_cache_v2';
  const STOP_ARRIVALS_CACHE_KEY = 'pid_departures_stop_arrivals_cache_v2';

  // Klíče z dřívějších verzí, které appka už nepoužívá (v44: pryč je dopočet
  // `allowed` přes /gtfs/trips a /gtfs/routes a staré stoptimes cache bez
  // date filtru). Při startu se smažou, ať zbytečně nedrží kvótu localStorage.
  const LEGACY_CACHE_KEYS = [
    'pid_departures_route_index',
    'pid_departures_trip_info_cache',
    'pid_departures_stop_seq_cache',
    'pid_departures_stop_arrivals_cache'
  ];

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
    STOP_SEQ_CACHE_KEY,
    STOP_ARRIVALS_CACHE_KEY,
    REQUEST_SHAPE_CACHE_KEY
  ];

  // US-20: cíl na jeden refresh (aspoň 5 shodných spojů a pokrytí aspoň
  // 35 min dopředu, co je přísnější), strop hledání do budoucnosti a
  // rozpočet requestů na Golemio — viz akceptační kritéria v
  // user-stories.md.
  //
  // Stránkování přes timeFrom (US-20, zjištění z 2026-09-25): Golemio
  // /pid/departureboards vrací jen omezené časové okno relativně k
  // timeFrom bez ohledu na to, jak velký limit/minutesAfter appka pošle —
  // jediný způsob, jak se dostat dál do budoucnosti, je opakovat request
  // s posunutým timeFrom (viz fetchDeparturesAdaptive). REQUEST_ATTEMPTS_*
  // proto teď omezují počet STRÁNEK (requestů se zřetězeným timeFrom) na
  // refresh, ne počet přepočtů jednoho pevného okna.
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
  const PAGE_OVERLAP_MS = 60 * 1000; // úmyslný přesah mezi stránkami (viz nextTimeFrom)

  // Golemio limit: 20 req / 8 s na klíč. Místo pevné pauzy mezi requesty
  // (dřívější RATE_LIMIT_DELAY_MS) appka teď hospodaří s rozpočtem sdíleně
  // napříč VŠEMI voláními na Golemio (viz acquireSlot/golemioGet, US-11) —
  // ptá se tak často, jak to okno dovolí, a čeká jen když je skutečně plné.
  const RATE_WINDOW_MS = 8000;
  const RATE_SOFT_LIMIT = 18; // 90 % tvrdého limitu — rezerva na drobný skew

  // V paměti držený index všech zastávek (stop_name -> stopIds) pro
  // rychlé, case-insensitive vyhledávání na klientovi — viz warmStopIndex.
  let stopIndex = null;

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
    return dayKey(new Date());
  }

  function dayKey(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  // US-6-bug-fixes (v44): denní cache (viz loadDayCache/saveDayCache) se drží
  // v paměti a z localStorage se každý klíč naparsuje jen JEDNOU za session
  // (dřív se celý blob parsoval při každém čtení a při každém zápisu
  // jednoho nástupiště se přečetl, naparsoval, přepsal a zapsal znovu — u
  // přestupních uzlů s desítkami nástupišť to byla hlavní režie navíc).
  // Zápisy do localStorage se dávkují, viz flushDayCaches.
  const dayBlobs = new Map(); // storageKey -> { subKey: { data, cachedDate } }
  const dirtyDayBlobs = new Set();
  const DAY_CACHE_FLUSH_MS = 2000;
  let dayFlushTimer = null;

  function getDayBlob(storageKey) {
    let blob = dayBlobs.get(storageKey);
    if (blob) return blob;
    blob = {};
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') blob = parsed;
    } catch (e) {
      // poškozený záznam v localStorage - začínáme s prázdnou cache
    }
    dayBlobs.set(storageKey, blob);
    return blob;
  }

  // Zapíše všechny změněné bloby do localStorage najednou. Volá se explicitně
  // na konci dávky nástupišť (viz computeDirectTrips), jinak
  // nejpozději po DAY_CACHE_FLUSH_MS a při opuštění stránky.
  function flushDayCaches() {
    clearTimeout(dayFlushTimer);
    dayFlushTimer = null;
    dirtyDayBlobs.forEach((storageKey) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(getDayBlob(storageKey)));
      } catch (e) {
        console.warn('Nepodařilo se uložit cache', storageKey, e);
      }
    });
    dirtyDayBlobs.clear();
  }

  // Načte cachovanou hodnotu pro daný dílčí klíč (typicky stopId), pokud
  // byla uložená dnes (US-13) — jinak null. Víc dílčích hodnot se drží
  // pohromadě pod jedním localStorage klíčem (storageKey).
  function loadDayCache(storageKey, subKey) {
    const entry = getDayBlob(storageKey)[subKey];
    return entry && entry.cachedDate === todayKey() ? entry.data : null;
  }

  // Uloží hodnotu pro daný dílčí klíč s dnešním datem a zároveň zahodí
  // položky z jiných dnů (US-13) — cache tak neroste donekonečna, drží jen
  // to, co je relevantní pro dnešek. Do localStorage se propíše dávkově
  // (flushDayCaches).
  function saveDayCache(storageKey, subKey, data) {
    const blob = getDayBlob(storageKey);
    const today = todayKey();
    Object.keys(blob).forEach((key) => {
      if (!blob[key] || blob[key].cachedDate !== today) delete blob[key];
    });
    blob[subKey] = { data, cachedDate: today };
    dirtyDayBlobs.add(storageKey);
    if (!dayFlushTimer) dayFlushTimer = setTimeout(flushDayCaches, DAY_CACHE_FLUSH_MS);
  }

  window.addEventListener('pagehide', flushDayCaches);

  // Úklid klíčů z dřívějších verzí (viz LEGACY_CACHE_KEYS).
  LEGACY_CACHE_KEYS.forEach((key) => {
    try { localStorage.removeItem(key); } catch (e) { /* ignorujeme */ }
  });

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
        dayBlobs.delete(cacheKey);
        dirtyDayBlobs.delete(cacheKey);
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

  // Čas odjezdu spoje jako Date (US-20) — stejný zdroj jako
  // departureMinutesFromNow, ale vrací absolutní okamžik místo minut od
  // "teď", potřebné pro zřetězené timeFrom stránkování napříč requesty.
  function departureDate(dep) {
    const ts = (dep && dep.departure_timestamp) || {};
    const iso = ts.predicted || ts.scheduled;
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function minutesBetween(fromDate, toDate) {
    return (toDate.getTime() - fromDate.getTime()) / 60000;
  }

  // Klíč pro deduplikaci spojů při slučování stránek (US-20) — sousední
  // stránky se záměrně mírně překrývají (viz nextTimeFrom), takže stejný
  // spoj se může objevit ve dvou po sobě jdoucích odpovědích. trip.id je
  // stabilní napříč requesty (stejně jako jinde v appce, viz app.js); pro
  // vzácné spoje bez trip.id je fallback z času/linky/cílové stanice, ať
  // se aspoň neduplikují jasně identické záznamy.
  function departureDedupeKey(dep) {
    const tripId = dep.trip && dep.trip.id;
    if (tripId) return 'trip:' + tripId;
    const date = departureDate(dep);
    const route = dep.route && dep.route.short_name;
    const headsign = dep.trip && dep.trip.headsign;
    return 'ts:' + (date ? date.toISOString() : '') + '|' + route + '|' + headsign;
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

  // timeFrom (US-20, volitelné) — ISO čas začátku okna pro stránkování přes
  // opakované requesty (viz fetchDeparturesAdaptive). Když je null/undefined,
  // parametr se do query stringu vůbec nepřidá a Golemio použije svoje
  // vlastní "teď" — stejné chování jako dřív pro první request.
  async function requestDepartureBoard(stopIds, shape, apiKey, timeFrom) {
    const params = new URLSearchParams();
    stopIds.forEach((id) => params.append('ids[]', id));
    params.set('limit', String(shape.limit));
    params.set('minutesAfter', String(shape.minutesAfter));
    params.set('order', 'real');
    params.set('mode', 'departures');
    if (timeFrom) params.set('timeFrom', timeFrom);
    return golemioGet('/pid/departureboards?' + params.toString(), apiKey);
  }

  // Garantované pokrytí jedné stránky jako absolutní ISO čas (US-20) —
  // Golemio vrací odjezdy vzestupně podle času (order=real). Bug fix
  // (US-20, zjištění z 2026-09-25): dřív se při departures.length <
  // shape.limit mylně předpokládalo pokrytí celého minutesAfter okna —
  // Golemio ale vrací jen omezené okno bez ohledu na limit/minutesAfter,
  // takže "neuříznuto limitem" neznamená "pokryto až do konce okna". Když
  // stránka vrátila 0 spojů, jde tedy o konec požadovaného okna
  // (pageTimeFrom + shape.minutesAfter); jinak o čas POSLEDNÍHO vráceného
  // spoje. Vrací se absolutní čas (ne minuty od teď), protože při
  // zřetězeném timeFrom stránkování je potřeba pracovat s konkrétním
  // okamžikem té stránky, ne s "teď" — na minuty od teď se převádí až ve
  // fetchDeparturesAdaptive pro vyhodnocení cíle/horizontu.
  function coveredUntil(departures, pageTimeFrom, shape) {
    if (!departures.length) {
      return new Date(pageTimeFrom.getTime() + shape.minutesAfter * 60000);
    }
    const lastDate = departureDate(departures[departures.length - 1]);
    return lastDate || pageTimeFrom;
  }

  // Čas pro timeFrom DALŠÍHO requestu (US-20, upřesnění od uživatele):
  // záměrně STEJNÝ nebo mírně DŘÍVĚJŠÍ než odjezd posledního spoje z téhle
  // stránky (o PAGE_OVERLAP_MS), ne čas až za koncem pokrytí. Cíl: žádná
  // mezera na hranici dvou stránek, i kdyby Golemio vracelo hraniční
  // položky pro týž timeFrom nekonzistentně — výsledný malý překryv řeší
  // dedup podle trip.id (departureDedupeKey) ve fetchDeparturesAdaptive.
  // Nikdy se ale nevrátí čas dřívější než pageTimeFrom téhle stránky, ať
  // appka nezacyklí na stejném okně, když stránka vrátí jen spoj těsně po
  // pageTimeFrom (další stránka pak postoupí přes větší minutesAfter z
  // nextRequestShape, i když timeFrom zůstane stejný).
  function nextTimeFrom(departures, pageTimeFrom, shape) {
    if (!departures.length) {
      return coveredUntil(departures, pageTimeFrom, shape);
    }
    const lastDate = departureDate(departures[departures.length - 1]);
    if (!lastDate) return coveredUntil(departures, pageTimeFrom, shape);
    const candidate = new Date(lastDate.getTime() - PAGE_OVERLAP_MS);
    return candidate.getTime() > pageTimeFrom.getTime() ? candidate : pageTimeFrom;
  }

  // Odhadne tvar DALŠÍ stránky, když cíl (5 shodných spojů a 35 min
  // pokrytí) není splněný (US-20) — z poměru toho, co TATO stránka
  // obsahovala, a toho, jak daleko dopředu OD SVÉHO VLASTNÍHO timeFrom
  // sahá její garantované pokrytí (viz coveredUntil). Pracuje čistě nad
  // jednou stránkou/odpovědí — volající (fetchDeparturesAdaptive) jí
  // předává vždy jen data poslední stránky, ne kumulativní merge napříč
  // stránkami.
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

  // Odhad minimálního JEDNOSTRÁNKOVÉHO tvaru requestu (od timeFrom=teď),
  // který by ještě splnil cíl (US-20) — základ pro postupné zmenšování
  // naučeného tvaru, když aktuálně vrací výrazně víc, než je potřeba.
  // Na rozdíl od nextRequestShape (jedna stránka) počítá nad SLOUČENÝMI
  // daty ze všech stránek použitých v refreshi (mergedDepartures/matched)
  // a nad celkovým pokrytím od now0 (totalMinutesAfter) — appka totiž při
  // příštím refreshi startuje zase z jednoho "teď", takže naučený tvar má
  // odpovídat tomu, co by stačilo na POKRYTÍ CELÉHO cíle od nuly, ne jen
  // poslední navštívené stránce.
  function estimateIdealShape(totalMinutesAfter, mergedDepartures, matched) {
    let idealMinutesAfter = TARGET_COVERAGE_MINUTES;
    if (matched.length >= TARGET_MIN_MATCHES) {
      const fifthMinutes = departureMinutesFromNow(matched[TARGET_MIN_MATCHES - 1]);
      if (fifthMinutes != null) idealMinutesAfter = Math.max(idealMinutesAfter, fifthMinutes);
    }
    idealMinutesAfter = Math.ceil(idealMinutesAfter * REQUEST_SHAPE_MARGIN);
    const density = mergedDepartures.length / Math.max(totalMinutesAfter, 1);
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
  // víc stránek (requestů se zřetězeným timeFrom — Golemio vrací jen
  // omezené okno bez ohledu na limit/minutesAfter, viz PAGE_OVERLAP_MS a
  // komentáře u coveredUntil/nextTimeFrom), dokud nemá aspoň 5 shodných
  // spojů a pokrytí aspoň 35 min dopředu (nebo dokud nevyčerpá 20h
  // horizont či rozpočet stránek na refresh), a naučený tvar requestu si
  // uloží pro příští refreshe. Všechny requesty jdou přes
  // golemioGet/acquireSlot beze změny — jen se jich pošle víc/jinak
  // velkých, s posouvaným timeFrom.
  //
  // isAllowedFn dostává celý odjezd (US-6-bug-fixes: rozhoduje se i podle
  // trip.id, ne jen podle linky a headsignu).
  async function fetchDeparturesAdaptive(pair, apiKey, isAllowedFn) {
    const now0 = new Date(); // pevný referenční bod "teď" pro celý refresh
    let shape = loadRequestShape(pair) || Object.assign({}, DEFAULT_REQUEST_SHAPE);
    let pageTimeFrom = now0;
    let timeFromParam = null; // první request nechává Golemio dopočítat "teď" samo

    const mergedDepartures = []; // napříč stránkami, deduplikované (viz departureDedupeKey)
    const seenKeys = new Set();
    let matched = [];
    let verifiedUntil = now0;
    let pageDepartures = [];
    let truncated = false;
    let targetMet = false;
    let budget = REQUEST_ATTEMPTS_IF_NO_MATCH;
    let attempt = 0;

    for (;;) {
      attempt++;
      const data = await requestDepartureBoard(pair.from.stopIds, shape, apiKey, timeFromParam);
      pageDepartures = data.departures || [];
      truncated = pageDepartures.length >= shape.limit;

      pageDepartures.forEach((dep) => {
        const key = departureDedupeKey(dep);
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        mergedDepartures.push(dep);
      });
      matched = mergedDepartures.filter(isAllowedFn);

      verifiedUntil = coveredUntil(pageDepartures, pageTimeFrom, shape);

      if (attempt === 1) {
        budget = matched.length >= 1 ? REQUEST_ATTEMPTS_IF_SOME_MATCH : REQUEST_ATTEMPTS_IF_NO_MATCH;
      }

      // Bug fix (US-20): cíl/horizont se vyhodnocují vůči verifiedUntil
      // (skutečně ověřené pokrytí napříč VŠEMI dosavadními stránkami od
      // now0), ne vůči požadované velikosti okna poslední stránky — ta
      // může být uříznutá limitem dřív, než reálně pokryje to, co si
      // appka vyžádala.
      const totalCoverageMinutes = minutesBetween(now0, verifiedUntil);
      targetMet = matched.length >= TARGET_MIN_MATCHES && totalCoverageMinutes >= TARGET_COVERAGE_MINUTES;
      const horizonExhausted = totalCoverageMinutes >= SEARCH_HORIZON_MINUTES;
      if (targetMet || horizonExhausted || attempt >= budget) break;

      const pageMatched = pageDepartures.filter(isAllowedFn);
      const pageCoverageMinutes = minutesBetween(pageTimeFrom, verifiedUntil);
      shape = nextRequestShape(shape, pageDepartures, pageMatched, pageCoverageMinutes, truncated);

      if (!truncated) {
        // Neuříznuto, ale cíl nesplněn -> okno téhle stránky je vyčerpané,
        // posunout se na další stránku (záměrný přesah, viz nextTimeFrom).
        pageTimeFrom = nextTimeFrom(pageDepartures, pageTimeFrom, shape);
        timeFromParam = pageTimeFrom.toISOString();
      }
      // Uříznuto limitem -> ponechat stejné pageTimeFrom/timeFromParam,
      // jen zkusit stejné okno znovu s větším limitem (viz nextRequestShape).
    }

    // Zmenšovat naučený tvar zkoušíme jen po skutečně splněném cíli — když
    // appka vzdala hledání na 20h horizontu s < 5 shodami, jde o řídce
    // obsluhovanou dvojici, která ten velký tvar zase příští refresh
    // potřebuje celý, ne zmenšit (viz US-20 v user-stories.md).
    let finalShape = shape;
    if (!truncated && targetMet) {
      const totalMinutesAfter = minutesBetween(now0, verifiedUntil);
      finalShape = shrinkTowardsIdeal(shape, estimateIdealShape(totalMinutesAfter, mergedDepartures, matched));
    }
    saveRequestShape(pair, finalShape);

    return { departures: mergedDepartures, verifiedUntil };
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

  // US-6-bug-fixes (v44): jízdní řády zastávek se stahují jen pro dnešní
  // servisní den (parametr date na /gtfs/stoptimes), ne pro celé ~2týdenní
  // okno feedu jako dřív — payload je zhruba o řád menší. Spoje po půlnoci
  // patří do servisního dne předchozího kalendářního dne (GTFS časy ≥ 24:00),
  // proto se v časných ranních hodinách přidá i včerejšek. Později ve dne
  // už žádný včerejší spoj nejede, takže se druhý dotaz na nástupiště šetří.
  // trip_id nese datum, takže se dny v jedné množině nepletou.
  const YESTERDAY_SERVICE_UNTIL_HOUR = 6;

  function serviceDateKeys() {
    const now = new Date();
    const keys = [dayKey(now)];
    if (now.getHours() < YESTERDAY_SERVICE_UNTIL_HOUR) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      keys.push(dayKey(yesterday));
    }
    return keys;
  }

  // Stáhne stop_times nástupiště pro relevantní servisní dny a vrátí z nich
  // Map trip_id -> nejnižší stop_sequence (seq) a Map trip_id -> arrival_time
  // (arr; "HH:MM:SS", může přesáhnout 24:00:00 — GTFS konvence). Oba údaje
  // vznikají z JEDNOHO dotazu, ať se pro cílová nástupiště nestahuje totéž
  // dvakrát (dřív zvlášť pro pořadí zastavení a zvlášť pro časy příjezdu).
  async function downloadStopTimes(stopId, apiKey) {
    const seq = new Map();
    const arr = new Map();
    for (const date of serviceDateKeys()) {
      const data = await golemioGet(
        '/gtfs/stoptimes/' + encodeURIComponent(stopId) + '?limit=10000&date=' + date,
        apiKey
      );
      featureProps(data).forEach((row) => {
        const tripId = row.trip_id;
        if (!tripId) return;
        const s = Number(row.stop_sequence);
        if (!Number.isNaN(s)) {
          const prev = seq.get(tripId);
          if (prev === undefined || s < prev) seq.set(tripId, s);
        }
        if (row.arrival_time) arr.set(tripId, row.arrival_time);
      });
    }
    return { seq, arr };
  }

  // Dnešní jízdní řád nástupiště z denní cache, jinak ze serveru (a uloží do
  // cache). needArrivals — cílová nástupiště potřebují i časy příjezdu (US-8);
  // pro výchozí stačí pořadí zastavení, takže se arrivals nedrží ani neukládá.
  // Cache je per nástupiště (ne per dvojice), ať se sdílí mezi dvojicemi.
  async function loadStopTimes(stopId, apiKey, needArrivals) {
    const cachedSeq = loadDayCache(STOP_SEQ_CACHE_KEY, stopId);
    const cachedArr = needArrivals ? loadDayCache(STOP_ARRIVALS_CACHE_KEY, stopId) : null;
    if (cachedSeq && (!needArrivals || cachedArr)) {
      return { seq: new Map(cachedSeq), arr: cachedArr ? new Map(cachedArr) : null };
    }
    const { seq, arr } = await downloadStopTimes(stopId, apiKey);
    saveDayCache(STOP_SEQ_CACHE_KEY, stopId, Array.from(seq.entries()));
    if (needArrivals) saveDayCache(STOP_ARRIVALS_CACHE_KEY, stopId, Array.from(arr.entries()));
    return { seq, arr: needArrivals ? arr : null };
  }

  // Sloučí pořadí zastavení z víc nástupišť jedné zastávky (nejnižší
  // stop_sequence vyhrává).
  function mergeMinSeq(target, seq) {
    seq.forEach((s, tripId) => {
      const prev = target.get(tripId);
      if (prev === undefined || s < prev) target.set(tripId, s);
    });
  }

  // Průnik spojů výchozí a cílové zastávky dvojice — přímý spoj je takový
  // trip_id, který zastavuje na výchozí zastávce PŘED cílovou (nižší
  // stop_sequence). Vrací { tripIds: Set, arrivals: Map trip_id -> čas
  // příjezdu do cíle } jen pro přímé spoje.
  //
  // Přestupní uzly (typicky metro) mají pod stejným stop_name desítky
  // nástupišť/směrů (samostatné stop_id) — golemioGet requesty sdíleně
  // rozpočítá (viz acquireSlot), takže ani u velkých uzlů appka nepřekročí
  // Golemio rate limit (20 req / 8 s na klíč).
  async function computeDirectTrips(originStopIds, destStopIds, apiKey, onProgress) {
    const report = (text) => { if (onProgress) onProgress(text); };

    report('Načítám jízdní řád výchozí zastávky…');
    const originSeq = new Map();
    for (const stopId of originStopIds) {
      const { seq } = await loadStopTimes(stopId, apiKey, false);
      mergeMinSeq(originSeq, seq);
    }

    report('Načítám jízdní řád cílové zastávky…');
    const destSeq = new Map();
    const destArr = new Map();
    for (const stopId of destStopIds) {
      const { seq, arr } = await loadStopTimes(stopId, apiKey, true);
      mergeMinSeq(destSeq, seq);
      arr.forEach((time, tripId) => destArr.set(tripId, time));
    }
    flushDayCaches();

    const tripIds = new Set();
    const arrivals = new Map();
    originSeq.forEach((originIdx, tripId) => {
      const destIdx = destSeq.get(tripId);
      if (destIdx === undefined || destIdx <= originIdx) return;
      tripIds.add(tripId);
      const time = destArr.get(tripId);
      if (time) arrivals.set(tripId, time);
    });
    return { tripIds, arrivals };
  }

  // Průnik se počítá JEDNOU na dvojici a dnešní den (v44) — sdílí ho
  // loadDirectTripIds (filtr odjezdů) i loadDestinationArrivals (časy
  // příjezdu); dřív se počítal třikrát nezávisle. Memoizuje se i rozběhnutý
  // dotaz (Promise), takže souběžné volání obou funkcí nestáhne nic dvakrát.
  // Při chybě se memo zahodí, ať se příští pokus zkusí znovu.
  const directTripsMemo = new Map();

  function getDirectTrips(originStopIds, destStopIds, apiKey, onProgress) {
    const memoKey = todayKey() + '|' + originStopIds.join(',') + '>' + destStopIds.join(',');
    let promise = directTripsMemo.get(memoKey);
    if (!promise) {
      if (directTripsMemo.size >= 5) directTripsMemo.clear();
      promise = computeDirectTrips(originStopIds, destStopIds, apiKey, onProgress);
      promise.catch(() => directTripsMemo.delete(memoKey));
      directTripsMemo.set(memoKey, promise);
    }
    return promise;
  }

  // US-6-bug-fixes: množina trip_id přímých spojů dvojice na dnešní servisní
  // den (fail-closed filtr odjezdů — zobrazit se smí jen spoj, jehož trip.id
  // v ní je). Chyby probublají volajícímu — ten nesmí při selhání spadnout
  // zpátky na neověřený filtr. Prázdná množina = dnes mezi zastávkami nejede
  // žádný přímý spoj (v44: tím se ověřuje i platnost nově zvolené dvojice).
  async function loadDirectTripIds(originStopIds, destStopIds, apiKey, onProgress) {
    const { tripIds } = await getDirectTrips(originStopIds, destStopIds, apiKey, onProgress);
    return tripIds;
  }

  // Jízdním řádem daný (statický) čas příjezdu do cílové zastávky pro přímé
  // spoje dvojice. Volá se při nastavení/změně BOARD_CONFIG (US-8), ne při
  // každém refreshi odjezdů; díky sdílenému průniku (getDirectTrips) většinou
  // už jen přečte výsledek z paměti.
  async function loadDestinationArrivals(destStopIds, originStopIds, apiKey, onProgress) {
    const { arrivals } = await getDirectTrips(originStopIds || [], destStopIds, apiKey, onProgress);
    return arrivals;
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

    // Denní cache jsou v paměti (viz getDayBlob) — prořezává se tedy blob v
    // paměti a do localStorage se propíše dávkově.
    [STOP_SEQ_CACHE_KEY, STOP_ARRIVALS_CACHE_KEY].forEach((storageKey) => {
      const blob = getDayBlob(storageKey);
      Object.keys(blob).forEach((stopId) => {
        if (keepStopIds.has(stopId)) return;
        delete blob[stopId];
        dirtyDayBlobs.add(storageKey);
      });
    });
    flushDayCaches();

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
    todayKey,
    loadDirectTripIds,
    searchStops,
    warmStopIndex,
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
