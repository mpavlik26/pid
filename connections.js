// Dopočet přímých spojů mezi dvojicí zastávek z GTFS static dat Golemio API,
// bez nutnosti stahovat a ručně parsovat celý PID_GTFS.zip (viz US-6).
// Odděleno od app.js (rendering/countdown) a config.js (běhová konfigurace).
(function () {
  const API_BASE = 'https://api.golemio.cz/v2';
  const STOP_PAIR_KEY = 'pid_departures_stop_pair';
  const STOP_INDEX_KEY = 'pid_departures_stop_index';
  const STOP_INDEX_TTL_MS = 24 * 60 * 60 * 1000; // GTFS feed se aktualizuje denně
  const STOP_INDEX_PAGE_LIMIT = 10000;
  const STOP_INDEX_MAX_PAGES = 5; // bezpečnostní strop proti nekonečné stránkované smyčce
  const ROUTE_INDEX_KEY = 'pid_departures_route_index';
  const ROUTE_INDEX_TTL_MS = 24 * 60 * 60 * 1000; // GTFS feed se aktualizuje denně
  const RATE_LIMIT_DELAY_MS = 420; // Golemio limit: 20 req / 8 s na klíč

  // V paměti držený index všech zastávek (stop_name -> stopIds) pro
  // rychlé, case-insensitive vyhledávání na klientovi — viz warmStopIndex.
  let stopIndex = null;

  // V paměti držený index linek (route_id -> route_short_name), viz
  // warmRouteIndex — potřebný k převodu route_id z /gtfs/trips na krátký
  // název linky, který appka zobrazuje a se kterým porovnává departureboards.
  let routeIndex = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function golemioGet(path, apiKey) {
    const res = await fetch(API_BASE + path, {
      headers: { 'X-Access-Token': apiKey }
    });
    if (!res.ok) {
      const err = new Error('Golemio API chyba ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
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
  // stopIds), a to buď z localStorage (pokud není starší než TTL), nebo
  // čerstvým stránkovaným stažením celého /gtfs/stops. Bez names[] filtru je
  // to jediný způsob, jak vyhledávat case-insensitive/částečnou shodou —
  // Golemio API samo takové vyhledávání nenabízí (jen exaktní název).
  async function warmStopIndex(apiKey, onProgress) {
    const report = (text) => { if (onProgress) onProgress(text); };

    try {
      const raw = localStorage.getItem(STOP_INDEX_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && Array.isArray(cached.stops) && Date.now() - cached.fetchedAt < STOP_INDEX_TTL_MS) {
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
      await sleep(RATE_LIMIT_DELAY_MS);
    }

    const stops = groupStopsByName(allRows);
    stopIndex = stops;
    try {
      localStorage.setItem(STOP_INDEX_KEY, JSON.stringify({ stops, fetchedAt: Date.now() }));
    } catch (e) {
      console.warn('Nepodařilo se uložit index zastávek', e);
    }
  }

  // Vyhledá zastávky podle názvu, case-insensitive a částečnou shodou, nad
  // klientským indexem (viz warmStopIndex) — ne dotazem na server.
  async function searchStops(query, apiKey) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    if (!stopIndex) await warmStopIndex(apiKey);

    const startsWith = [];
    const contains = [];
    stopIndex.forEach((stop) => {
      const lower = stop.name.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx === 0) startsWith.push(stop);
      else if (idx > 0) contains.push(stop);
    });

    return startsWith.concat(contains).slice(0, 25);
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
    return map;
  }

  // Přestupní uzly (typicky metro) mají pod stejným stop_name desítky
  // nástupišť/směrů (samostatné stop_id) — bez pauzy mezi requesty by se
  // snadno překročil Golemio rate limit (20 req / 8 s na klíč) a API by
  // odpovědělo 429, což computeAllowedRoutes shodí jako obecnou chybu. U
  // běžné tramvajové/autobusové zastávky (1-2 stopId) tahle pauza prakticky
  // nic nezpomalí.
  async function mergeSequences(stopIds, apiKey) {
    const merged = new Map();
    for (let i = 0; i < stopIds.length; i++) {
      const seqs = await fetchStopSequences(stopIds[i], apiKey);
      seqs.forEach((seq, tripId) => {
        const prev = merged.get(tripId);
        if (prev === undefined || seq < prev) merged.set(tripId, seq);
      });
      if (i < stopIds.length - 1) await sleep(RATE_LIMIT_DELAY_MS);
    }
    return merged;
  }

  // Zajistí index linek (route_id -> route_short_name), z localStorage
  // (pokud není starší než TTL) nebo čerstvým stažením /gtfs/routes. Seznam
  // linek celé sítě PID je krátký (stovky záznamů), stačí jedna stránka a
  // nemá smysl ho stahovat opakovaně pro každý dopočet spojů.
  async function warmRouteIndex(apiKey, onProgress) {
    const report = (text) => { if (onProgress) onProgress(text); };

    try {
      const raw = localStorage.getItem(ROUTE_INDEX_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && Array.isArray(cached.routes) && Date.now() - cached.fetchedAt < ROUTE_INDEX_TTL_MS) {
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
      localStorage.setItem(ROUTE_INDEX_KEY, JSON.stringify({ routes: entries, fetchedAt: Date.now() }));
    } catch (e) {
      console.warn('Nepodařilo se uložit index linek', e);
    }
  }

  // Stáhne (v jednom stránkovaném dotazu) pro danou zastávku všechny spoje,
  // které přes ni jedou, včetně route_id a cílového nápisu — na rozdíl od
  // /gtfs/stoptimes to Golemio API vrací přímo bez nutnosti dotazovat každý
  // trip_id zvlášť. Vrátí Map trip_id -> {routeId, headsign}.
  async function fetchTripsForStop(stopId, apiKey) {
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
    return map;
  }

  async function mergeTripInfo(stopIds, apiKey) {
    const merged = new Map();
    for (let i = 0; i < stopIds.length; i++) {
      const infos = await fetchTripsForStop(stopIds[i], apiKey);
      infos.forEach((info, tripId) => {
        if (!merged.has(tripId)) merged.set(tripId, info);
      });
      if (i < stopIds.length - 1) await sleep(RATE_LIMIT_DELAY_MS);
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
    try {
      localStorage.setItem(STOP_PAIR_KEY, JSON.stringify(pair));
    } catch (e) {
      console.warn('Nepodařilo se uložit dvojici zastávek', e);
    }
  }

  function clearStopPair() {
    try { localStorage.removeItem(STOP_PAIR_KEY); } catch (e) {}
  }

  window.Connections = {
    searchStops,
    warmStopIndex,
    computeAllowedRoutes,
    loadStopPair,
    saveStopPair,
    clearStopPair
  };
})();
