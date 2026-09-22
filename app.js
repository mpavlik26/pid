(function(){
  const STORAGE_KEY = 'pid_departures_golemio_api_key';

  let apiKey = null;
  let timer = null;
  let tickTimer = null;
  let currentDepartures = []; // last fetched, filtered, with parsed predicted Date

  // US-8: statický čas příjezdu do cílové zastávky, trip_id -> "HH:MM:SS".
  // Načte se po nastavení BOARD_CONFIG; dokud se to nepodaří, zkouší se to
  // znovu při každém refreshi odjezdů (viz fetchDepartures) — jednorázový
  // pokus bez opakování dřív při jediném selhání (např. kolize s rate
  // limitem hned po startu appky) natrvalo zabil příjezdové časy pro
  // zbytek session, viz bugfix v loadDestinationArrivals().
  let destinationArrivals = new Map();
  // US-10: dokud je false, render() u příjezdu zobrazí explicitně "zjišťuji…"
  // místo tichého "–" — viz loadDestinationArrivals(). Nastaví se na true jen
  // po ÚSPĚŠNÉM načtení, ne po každém pokusu.
  let destinationArrivalsLoaded = false;
  let destinationArrivalsInFlight = false;
  // Zvýší se při každém nastavení nové dvojice zastávek — probíhající pokus
  // o načtení pro starou dvojici se po doběhnutí pozná jako zastaralý (podle
  // téhle hodnoty) a jeho výsledek se zahodí, místo aby přepsal už načtená
  // data nové dvojice.
  let arrivalsGeneration = 0;

  // US-8: poloha vozidla, trip_id -> {originTimestamp, lastStopId, fetchedAt}
  // | 'failed'. Ověřuje se znovu při každém refreshi seznamu spojů pro
  // všechny aktuálně sledované spoje (ne jen jednou) — viz
  // refreshVehiclePositions. lastStopId přibylo v US-17 (viz níže).
  let vehiclePositions = new Map();
  let positionFetchInFlight = false;

  // US-17: appka si mezi jednotlivými fetchi drží vlastní seznam naposledy
  // viděných spojů podle trip.id, aby spoj nezmizel ze zobrazení jen proto,
  // že ho Golemio přestalo vracet v /pid/departureboards (to se řídí
  // predikovaným, ne reálným odjezdem). trip_id -> {dep, missingSince}.
  // missingSince je null, dokud je spoj v čerstvé odpovědi API; jakmile z ní
  // vypadne, uloží se čas vypadnutí a spoj zůstává zobrazený, dokud buď
  // poloha vozidla nepotvrdí, že už odjel ze zdrojové zastávky, nebo
  // neuplyne MISSING_GRACE_MS (záložní doba pro případ, že se poloha vůbec
  // nepodaří zjistit).
  let retainedDepartures = new Map();
  // US-17-bug-fixes: záložní doba pro spoj, u kterého se poloha vozidla NIKDY
  // nepodařila získat (cached je undefined nebo 'failed') — viz komentář
  // k retainedDepartures výš.
  const MISSING_GRACE_MS = 60000;

  // US-17-bug-fixes: mazání retained spoje, který je ve stavu "Odjíždí" (viz
  // isDepartingNow níž), se řídí třemi vzájemně se vylučujícími případy podle
  // toho, jak dopadlo poslední zjišťování polohy vozidla:
  //  1. poloha se nikdy nepodařila získat -> mažeme po MISSING_GRACE_MS od
  //     missingSince (viz výš)
  //  2. poloha se už někdy získat podařila, ale poslední úspěšný fetch je
  //     starší než POSITION_FAILING_GRACE_MS -> mažeme (zjišťování polohy
  //     teď reálně selhává)
  //  3. poslední fetch byl úspěšný v posledních POSITION_FAILING_GRACE_MS, ale
  //     samotná poloha (origin_timestamp) je starší než POSITION_STALE_MS ->
  //     mažeme (vozidlu se např. sekne GPS a poloha na serveru dál
  //     neaktualizuje)
  // Pozor: nezávisle na těchto třech případech (a bez ohledu na stav
  // "Odjíždí") se spoj maže OKAMŽITĚ, jakmile poloha potvrdí, že už je na
  // cestě pryč ze zdrojové zastávky — viz confirmedDeparted níž.
  const POSITION_FAILING_GRACE_MS = 90000;
  const POSITION_STALE_MS = 300000;

  // US-17-bug-fixes: čas, kdy naposledy proběhlo úspěšné sloučení čerstvé
  // odpovědi API (viz mergeWithRetained). Slouží k odhadu, odkdy je spoj
  // *skutečně* pryč z API, když appka byla delší dobu na pozadí — v tu
  // chvíli totiž nevíme nic mezi posledním úspěšným fetchem a teď, takže
  // není správné počítat grace lhůtu od "teď" (viz komentář níž).
  let lastFetchCompletedAt = null;

  // GTFS route type -> ikona druhu dopravního prostředku (US-8).
  const ROUTE_TYPE_ICON = {
    0: '🚊', // tramvaj
    1: 'Ⓜ', // metro
    2: '🚆', // vlak
    3: '🚌', // autobus
    4: '⛴', // přívoz
    7: '🚞', // lanovka
    11: '🚎' // trolejbus
  };

  let selectedFrom = null; // { name, stopIds } vybrané kliknutím v autocomplete
  let selectedTo = null;
  let fromSearchResults = [];
  let toSearchResults = [];

  // US-14: aktuálně aktivní dvojice zastávek jako celý objekt (from/to/allowed),
  // ne jen odvozený BOARD_CONFIG — potřeba pro hvězdičkové tlačítko a pro
  // zápis do "naposledy použité" při každé aktivaci (viz activatePair).
  let currentPair = null;
  let favoritePairsData = [];
  let recentPairsData = [];

  const setupScreen = document.getElementById('setupScreen');
  const pickerScreen = document.getElementById('pickerScreen');
  const mainScreen = document.getElementById('mainScreen');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const setupError = document.getElementById('setupError');
  const fromInput = document.getElementById('fromInput');
  const fromSuggestions = document.getElementById('fromSuggestions');
  const toInput = document.getElementById('toInput');
  const toSuggestions = document.getElementById('toSuggestions');
  const findRoutesBtn = document.getElementById('findRoutesBtn');
  const pickerProgress = document.getElementById('pickerProgress');
  const pickerError = document.getElementById('pickerError');
  const board = document.getElementById('board');
  const statusbar = document.getElementById('statusbar');
  const statusText = document.getElementById('statusText');
  const refreshBtn = document.getElementById('refreshBtn');
  const changeKeyBtn = document.getElementById('changeKeyBtn');
  const changeStopsBtn = document.getElementById('changeStopsBtn');
  const toggleFavoriteBtn = document.getElementById('toggleFavoriteBtn');
  const mainError = document.getElementById('mainError');
  const favoritePairsSection = document.getElementById('favoritePairsSection');
  const favoritePairsList = document.getElementById('favoritePairsList');
  const recentPairsSection = document.getElementById('recentPairsSection');
  const recentPairsList = document.getElementById('recentPairsList');
  const titleEl = document.getElementById('boardTitle');
  const versionEl = document.getElementById('appVersion');
  if (versionEl) versionEl.textContent = 'verze ' + APP_VERSION;
  const debugOverlay = document.getElementById('debugOverlay');
  const debugList = document.getElementById('debugList');
  const debugTotal = document.getElementById('debugTotal');
  const debugCloseBtn = document.getElementById('debugCloseBtn');

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function debounce(fn, delay){
    let t;
    return function(...args){
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function isAllowed(routeShort, headsign){
    return BOARD_CONFIG.allowed.some(a =>
      a.route === routeShort && headsign && headsign.indexOf(a.headsign) !== -1
    );
  }

  function setTitle(config){
    titleEl.innerHTML = `${escapeHtml(config.fromLabel)} <span class="arrow">→</span> ${escapeHtml(config.toLabel)}`;
    document.title = `PID odjezdy · ${config.fromLabel} → ${config.toLabel}`;
  }

  function showSetup(message){
    setupScreen.style.display = 'block';
    pickerScreen.style.display = 'none';
    mainScreen.style.display = 'none';
    if (message){
      setupError.textContent = message;
      setupError.style.display = 'block';
    } else {
      setupError.style.display = 'none';
    }
  }

  function showPicker(message){
    setupScreen.style.display = 'none';
    mainScreen.style.display = 'none';
    pickerScreen.style.display = 'block';
    renderPairShortcuts();
    if (message){
      pickerError.textContent = message;
      pickerError.style.display = 'block';
    } else {
      pickerError.style.display = 'none';
      warmPickerIndex();
    }
  }

  // Dočasná chybová hláška na hlavní obrazovce (US-14-bug-fixes) — hlavně
  // pro selhání ukládání oblíbených/naposledy použitých dvojic kvůli plné
  // kvótě localStorage (běžné na mobilu). Zmizí sama po pár vteřinách, aby
  // netrčela nad statusbarem donekonečna.
  let mainErrorTimer = null;
  function showMainError(message){
    mainError.textContent = message;
    mainError.style.display = 'block';
    clearTimeout(mainErrorTimer);
    mainErrorTimer = setTimeout(() => { mainError.style.display = 'none'; }, 6000);
  }

  const STORAGE_FULL_MESSAGE = 'Nepodařilo se uložit — úložiště prohlížeče je plné i po uvolnění dočasných dat appky. Zkuste odebrat některou oblíbenou dvojici, ať se uvolní místo.';

  function renderPairList(listEl, pairs, withStar){
    listEl.innerHTML = pairs.map((pair, i) => {
      const label = `${escapeHtml(pair.from.name)} <span class="arrow">→</span> ${escapeHtml(pair.to.name)}`;
      const star = withStar
        ? `<button class="pair-star-toggle" data-idx="${i}" title="Odebrat z oblíbených">★</button>`
        : '';
      return `<li><span class="pair-name" data-idx="${i}">${label}</span>${star}</li>`;
    }).join('');
  }

  // Naplní na pickeru sekce "Oblíbené dvojice" a "Naposledy použité" (US-14),
  // obě skryté, pokud jsou prázdné. Volá se při každém vstupu do pickeru, aby
  // byly vždy čerstvé (např. po hvězdičkování na hlavní obrazovce).
  function renderPairShortcuts(){
    favoritePairsData = Connections.loadFavoritePairs();
    recentPairsData = Connections.loadRecentPairs();

    favoritePairsSection.style.display = favoritePairsData.length ? 'block' : 'none';
    renderPairList(favoritePairsList, favoritePairsData, true);

    recentPairsSection.style.display = recentPairsData.length ? 'block' : 'none';
    renderPairList(recentPairsList, recentPairsData, false);
  }

  favoritePairsList.addEventListener('click', (e) => {
    const starBtn = e.target.closest('.pair-star-toggle');
    if (starBtn){
      const pair = favoritePairsData[Number(starBtn.dataset.idx)];
      if (pair){
        if (Connections.removeFavoritePair(pair)){
          renderPairShortcuts();
        } else {
          showPicker(STORAGE_FULL_MESSAGE);
        }
      }
      return;
    }
    const nameEl = e.target.closest('.pair-name');
    if (nameEl){
      const pair = favoritePairsData[Number(nameEl.dataset.idx)];
      if (pair) activatePair(pair);
    }
  });

  recentPairsList.addEventListener('click', (e) => {
    const nameEl = e.target.closest('.pair-name');
    if (nameEl){
      const pair = recentPairsData[Number(nameEl.dataset.idx)];
      if (pair) activatePair(pair);
    }
  });

  function updateFavoriteButtonState(){
    const favorited = !!currentPair && Connections.isFavoritePair(currentPair);
    toggleFavoriteBtn.textContent = favorited ? '★' : '☆';
    toggleFavoriteBtn.setAttribute('aria-pressed', String(favorited));
  }

  toggleFavoriteBtn.addEventListener('click', () => {
    if (!currentPair) return;
    const ok = Connections.isFavoritePair(currentPair)
      ? Connections.removeFavoritePair(currentPair)
      : Connections.addFavoritePair(currentPair);
    if (!ok) showMainError(STORAGE_FULL_MESSAGE);
    updateFavoriteButtonState();
  });

  // Aktivuje danou dvojici zastávek jako aktuální (US-14) — ať už přišla
  // z formuláře Odkud/Kam, z automatického naběhnutí appky na uloženou
  // dvojici, nebo z výběru z oblíbených/naposledy použitých. Vždy zapíše
  // dvojici do "naposledy použité" a nastaví ji jako aktivní (STOP_PAIR_KEY) —
  // routy (pair.allowed) se přebírají z dvojice beze změny, nepřepočítávají se.
  function activatePair(pair){
    currentPair = pair;
    Connections.saveStopPair(pair);
    Connections.pushRecentPair(pair);
    BOARD_CONFIG = {
      fromLabel: pair.from.name,
      toLabel: pair.to.name,
      stopIds: pair.from.stopIds,
      toStopIds: pair.to.stopIds,
      allowed: pair.allowed
    };
    setTitle(BOARD_CONFIG);
    updateFavoriteButtonState();
    showMain();
    destinationArrivals = new Map();
    destinationArrivalsLoaded = false;
    destinationArrivalsInFlight = false;
    arrivalsGeneration++;
    // US-17-bug-fixes: retainedDepartures/vehiclePositions/currentDepartures
    // jsou klíčované trip.id napříč celou appkou, ne per dvojice zastávek —
    // bez resetu se sem při přepnutí dvojice (i z oblíbených) na chvíli
    // promíchají spoje staré dvojice, dokud je neodstraní grace period nebo
    // potvrzená poloha.
    retainedDepartures = new Map();
    vehiclePositions = new Map();
    lastFetchCompletedAt = null;
    currentDepartures = [];
    loadDestinationArrivals();
    fetchDepartures();
    startTimer();
  }

  // Zahřeje klientský index zastávek (viz Connections.warmStopIndex), aby
  // vyhledávání v polích Odkud/Kam bylo od prvního keystroke okamžité a
  // case-insensitive (US-7). Volá se jen při čerstvém vstupu do pickeru, ne
  // po chybě "žádný přímý spoj", kdy je index už zahřátý.
  async function warmPickerIndex(){
    pickerProgress.textContent = 'Připravuji seznam zastávek…';
    pickerProgress.style.display = 'block';
    try{
      await Connections.warmStopIndex(apiKey, (text) => { pickerProgress.textContent = text; });
    }catch(e){
      console.error(e);
      if (e.status === 401 || e.status === 403){
        stopTimer();
        clearKey();
        apiKey = null;
        showSetup('API klíč nebyl přijat (chyba ' + e.status + '). Zkontrolujte, že jste ho zkopírovali celý.');
        return;
      }
      pickerError.textContent = 'Nepodařilo se načíst seznam zastávek. Zkuste to prosím znovu.';
      pickerError.style.display = 'block';
    }finally{
      pickerProgress.style.display = 'none';
    }
  }

  function showMain(){
    setupScreen.style.display = 'none';
    pickerScreen.style.display = 'none';
    mainScreen.style.display = 'block';
  }

  function loadKey(){
    try{
      const v = localStorage.getItem(STORAGE_KEY);
      if (v){ apiKey = v; return true; }
    }catch(e){
      // localStorage can throw in private-browsing modes on some browsers
      console.warn('localStorage nedostupný', e);
    }
    return false;
  }

  function saveKey(key){
    try{
      localStorage.setItem(STORAGE_KEY, key);
    }catch(e){
      console.warn('Nepodařilo se uložit klíč do localStorage', e);
    }
  }

  function clearKey(){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
  }

  // Po ověření API klíče rozhodne, jestli appka rovnou naběhne na uloženou
  // dvojici zastávek, nebo jestli je potřeba nechat uživatele vybrat novou.
  function proceedAfterAuth(){
    const pair = Connections.loadStopPair();
    if (pair && pair.from && pair.to && pair.allowed && pair.allowed.length){
      activatePair(pair);
    } else {
      showPicker();
    }
  }

  saveKeyBtn.addEventListener('click', () => {
    const val = apiKeyInput.value.trim();
    if (!val){
      setupError.textContent = 'Vložte prosím platný API klíč.';
      setupError.style.display = 'block';
      return;
    }
    apiKey = val;
    saveKey(val);
    proceedAfterAuth();
  });

  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveKeyBtn.click();
  });

  changeKeyBtn.addEventListener('click', () => {
    stopTimer();
    clearKey();
    apiKey = null;
    showSetup();
    apiKeyInput.value = '';
  });

  changeStopsBtn.addEventListener('click', () => {
    stopTimer();
    Connections.clearStopPair();
    BOARD_CONFIG = null;
    currentPair = null;
    selectedFrom = null;
    selectedTo = null;
    fromInput.value = '';
    toInput.value = '';
    fromSuggestions.innerHTML = '';
    fromSuggestions.style.display = 'none';
    toSuggestions.innerHTML = '';
    toSuggestions.style.display = 'none';
    updateFindButtonState();
    showPicker();
  });

  refreshBtn.addEventListener('click', () => fetchDepartures());

  // US-15: skryté ladicí zobrazení velikostí klíčů v localStorage — 5 kliknutí
  // na číslo verze v patičce během 3 s. Pomalejší/přerušené klikání počítadlo
  // vynuluje, ať se to nespustí náhodou při běžném používání appky.
  const DEBUG_CLICKS_NEEDED = 5;
  const DEBUG_CLICK_WINDOW_MS = 3000;
  let debugClickCount = 0;
  let debugClickTimer = null;

  function formatBytes(n){
    return n >= 1024 ? (n / 1024).toFixed(1) + ' kB' : n + ' B';
  }

  function showStorageDebug(){
    const rows = Object.keys(localStorage).map((key) => {
      const size = new Blob([key]).size + new Blob([localStorage.getItem(key)]).size;
      return { key, size };
    }).sort((a, b) => b.size - a.size);

    debugList.innerHTML = rows.map((row) =>
      '<li><span class="debug-key">' + escapeHtml(row.key) + '</span>' +
      '<span class="debug-size">' + formatBytes(row.size) + '</span></li>'
    ).join('');

    const total = rows.reduce((sum, row) => sum + row.size, 0);
    debugTotal.innerHTML = '<span>celkem (' + rows.length + ' klíčů)</span><span>' + formatBytes(total) + '</span>';

    debugOverlay.style.display = 'flex';
  }

  if (versionEl){
    versionEl.addEventListener('click', () => {
      debugClickCount++;
      clearTimeout(debugClickTimer);
      if (debugClickCount >= DEBUG_CLICKS_NEEDED){
        debugClickCount = 0;
        showStorageDebug();
      } else {
        debugClickTimer = setTimeout(() => { debugClickCount = 0; }, DEBUG_CLICK_WINDOW_MS);
      }
    });
  }

  debugCloseBtn.addEventListener('click', () => { debugOverlay.style.display = 'none'; });
  debugOverlay.addEventListener('click', (e) => {
    if (e.target === debugOverlay) debugOverlay.style.display = 'none';
  });

  function updateFindButtonState(){
    findRoutesBtn.disabled = !(selectedFrom && selectedTo);
  }

  function renderSuggestions(listEl, results){
    if (!results.length){
      listEl.innerHTML = '';
      listEl.style.display = 'none';
      return;
    }
    listEl.innerHTML = results
      .map((r, i) => `<li data-idx="${i}">${escapeHtml(r.name)}</li>`)
      .join('');
    listEl.style.display = 'block';
  }

  function wireStopPicker(input, suggestionsEl, getResults, setResults, onSelect){
    input.addEventListener('input', debounce(async () => {
      onSelect(null);
      const q = input.value.trim();
      if (q.length < 2){
        suggestionsEl.innerHTML = '';
        suggestionsEl.style.display = 'none';
        return;
      }
      try{
        const results = await Connections.searchStops(q, apiKey);
        setResults(results);
        renderSuggestions(suggestionsEl, results);
      }catch(e){
        console.warn('Vyhledávání zastávek selhalo', e);
      }
    }, 300));

    suggestionsEl.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const idx = Number(li.dataset.idx);
      const picked = getResults()[idx];
      if (!picked) return;
      onSelect(picked);
      input.value = picked.name;
      suggestionsEl.innerHTML = '';
      suggestionsEl.style.display = 'none';
    });
  }

  wireStopPicker(
    fromInput, fromSuggestions,
    () => fromSearchResults,
    (r) => { fromSearchResults = r; },
    (picked) => { selectedFrom = picked; updateFindButtonState(); }
  );

  wireStopPicker(
    toInput, toSuggestions,
    () => toSearchResults,
    (r) => { toSearchResults = r; },
    (picked) => { selectedTo = picked; updateFindButtonState(); }
  );

  findRoutesBtn.addEventListener('click', async () => {
    if (!selectedFrom || !selectedTo) return;
    findRoutesBtn.disabled = true;
    pickerError.style.display = 'none';
    pickerProgress.style.display = 'block';
    pickerProgress.textContent = 'Zjišťuji spoje…';
    try{
      const allowed = await Connections.computeAllowedRoutes(
        selectedFrom.stopIds,
        selectedTo.stopIds,
        apiKey,
        (text) => { pickerProgress.textContent = text; }
      );
      if (!allowed.length){
        showPicker('Mezi těmito zastávkami nejede žádný přímý spoj. Zkuste jinou dvojici.');
        return;
      }
      activatePair({
        from: selectedFrom,
        to: selectedTo,
        allowed,
        computedAt: new Date().toISOString()
      });
    }catch(e){
      console.error(e);
      if (e.status === 401 || e.status === 403){
        stopTimer();
        clearKey();
        apiKey = null;
        showSetup('API klíč nebyl přijat (chyba ' + e.status + '). Zkontrolujte, že jste ho zkopírovali celý.');
      } else {
        showPicker('Nepodařilo se dopočítat spoje. Zkuste to prosím znovu.');
      }
    }finally{
      pickerProgress.style.display = 'none';
      updateFindButtonState();
    }
  });

  function startTimer(){
    stopTimer();
    timer = setInterval(fetchDepartures, REFRESH_MS);
    tickTimer = setInterval(tick, TICK_MS);
  }
  function stopTimer(){
    if (timer) clearInterval(timer);
    if (tickTimer) clearInterval(tickTimer);
    timer = null;
    tickTimer = null;
  }

  // Načte statický čas příjezdu do cílové zastávky pro všechny spoje (US-8).
  // Volá se bez await z proceedAfterAuth()/findRoutesBtn handleru a dál pak
  // opakovaně z fetchDepartures(), dokud se nepodaří — dokud nedoběhne
  // úspěšně, render() jen zobrazí placeholder, žádné blokování hlavního flow.
  //
  // Bugfix: dřív se po JAKÉMKOLI selhání (i jednorázovém, např. kolize s
  // Golemio rate limitem těsně po startu appky, kdy běží najednou tenhle
  // dotaz i první fetchDepartures()/refreshVehiclePositions()) natrvalo
  // vzdala pro zbytek session — na rozdíl od polohy vozidla, která se
  // zkouší znovu při každém refreshi. destinationArrivalsLoaded se teď
  // nastaví na true jen po úspěchu, takže se to samo zkusí znovu.
  async function loadDestinationArrivals(){
    if (!BOARD_CONFIG || !BOARD_CONFIG.toStopIds) return;
    if (destinationArrivalsInFlight) return;
    const myGeneration = arrivalsGeneration;
    destinationArrivalsInFlight = true;
    try{
      const result = await Connections.loadDestinationArrivals(BOARD_CONFIG.toStopIds, BOARD_CONFIG.stopIds, apiKey);
      if (myGeneration !== arrivalsGeneration) return; // mezitím se změnila dvojice zastávek
      destinationArrivals = result;
      destinationArrivalsLoaded = true;
    }catch(e){
      if (myGeneration !== arrivalsGeneration) return;
      console.warn('Nepodařilo se načíst čas příjezdu do cílové zastávky, zkusím to znovu při dalším refreshi', e);
      if (e.status === 401 || e.status === 403){
        stopTimer();
        clearKey();
        apiKey = null;
        showSetup('API klíč nebyl přijat (chyba ' + e.status + '). Zkontrolujte, že jste ho zkopírovali celý.');
      }
    }finally{
      if (myGeneration === arrivalsGeneration) destinationArrivalsInFlight = false;
      // US-10: jakmile je pokus hotový (ať už úspěšně nebo ne), appka o tom
      // nemá dál mlčet do dalšího auto-refreshe — hned přerenderuje, aby se
      // "zjišťuji…" u příjezdu bez zbytečného čekání změnilo na výsledek.
      if (myGeneration === arrivalsGeneration && currentDepartures.length) render(currentDepartures);
    }
  }

  function predictedDate(dep){
    const ts = dep.departure_timestamp || {};
    const iso = ts.predicted || ts.scheduled;
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatCountdown(targetDate){
    if (!targetDate) return {text: "?", soon: false, past: false};
    const diffMs = targetDate.getTime() - Date.now();
    const past = diffMs < -5000; // more than 5s in the past: treat as departed
    const totalSec = Math.max(0, Math.round(diffMs / 1000));
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    const text = mm > 0
      ? (mm + ':' + String(ss).padStart(2,'0'))
      : (ss + ' s');
    return {text, soon: totalSec <= 120, past};
  }

  // Čas vč. vteřin (US-8), přijímá rovnou Date.
  function formatClock(date){
    if (!date || isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  }

  // US-10: záporné sec = spoj jede s náskokem, zobrazí se '−m:ss' (modře,
  // viz .delay-row.early v style.css), ne skryté pod 'na čas' jako dřív.
  function fmtDelaySeconds(sec){
    if (!sec) return 'na čas';
    const sign = sec > 0 ? '+' : '−';
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return sign + m + ':' + String(s).padStart(2, '0');
  }

  // Sestaví Date z GTFS času "HH:MM:SS" (hodiny mohou být >=24 u spojů přes
  // půlnoc) vůči servisnímu dni odvozenému z baseDate. Pokud výsledek vyjde
  // dřív než baseDate (okrajový případ kolem půlnoci), přičte den navíc.
  function combineServiceDayTime(baseDate, hhmmss){
    const parts = hhmmss.split(':').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [h, m, s] = parts;
    const d = new Date(baseDate);
    d.setHours(0, 0, 0, 0);
    d.setSeconds(h * 3600 + m * 60 + s);
    if (d.getTime() < baseDate.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // Text značky o stáří polohy vozidla (US-8) — počítá se z vehiclePositions
  // cache, aktualizuje se jak při render(), tak po vteřinách v tick().
  function positionTagText(dep){
    const delay = dep.delay || {};
    if (!delay.is_available) return 'bez údajů o aktuální poloze';
    const tripId = dep.trip && dep.trip.id;
    const cached = tripId ? vehiclePositions.get(tripId) : null;
    if (!cached) return 'poloha: zjišťuji…';
    if (cached === 'failed') return 'poloha: neznámá';
    const ageSec = Math.max(0, Math.round((Date.now() - cached.originTimestamp.getTime()) / 1000));
    return 'poloha před ' + ageSec + ' s';
  }

  // Barevný stav značky o poloze — červeně jen když appka pro daný spoj vůbec
  // nemá aktuální polohu (delay.is_available false), ne u přechodných stavů
  // jako "zjišťuji…" nebo "neznámá" (viz .position.unavailable ve style.css).
  function positionTagClass(dep){
    const delay = dep.delay || {};
    return delay.is_available ? '' : 'unavailable';
  }

  // Ověří polohu vozidla znovu pro všechny aktuálně sledované spoje (US-8
  // zpětná vazba: jednorázové zjištění nestačí, s každým refreshem seznamu
  // spojů se má zkusit zjistit aktuálnější údaj, ne u něj navždy zůstat).
  // Sekvenční dotazy s pauzou kvůli rate limitu (Connections.fetchVehiclePositions),
  // fire-and-forget, nezdržuje render(). Pokud dotaz pro už dřív úspěšně
  // zjištěný spoj selže, ponechá se poslední známá hodnota (radši o kousek
  // starší platný údaj než "neznámá") — díky tomu se "poloha: zjišťuji…" na
  // UI píše jen při úplně prvním zjišťování daného spoje.
  async function refreshVehiclePositions(departures){
    if (positionFetchInFlight) return;
    const tripIds = departures
      .filter(dep => dep.delay && dep.delay.is_available && dep.trip && dep.trip.id)
      .map(dep => dep.trip.id);
    if (!tripIds.length) return;
    positionFetchInFlight = true;
    try{
      await Connections.fetchVehiclePositions(tripIds, apiKey, (tripId, result) => {
        const hadData = vehiclePositions.get(tripId);
        const alreadyKnown = hadData && hadData !== 'failed';
        if (result){
          vehiclePositions.set(tripId, {
            originTimestamp: result.originTimestamp,
            lastStopId: result.lastStopId,
            fetchedAt: Date.now()
          });
        } else if (!alreadyKnown){
          vehiclePositions.set(tripId, 'failed');
        }
        tick();
      });
    }catch(e){
      if (e.status === 401 || e.status === 403){
        stopTimer();
        clearKey();
        apiKey = null;
        showSetup('API klíč nebyl přijat (chyba ' + e.status + '). Zkontrolujte, že jste ho zkopírovali celý.');
      } else {
        console.warn('Nepodařilo se načíst polohu vozidla', e);
      }
    }finally{
      positionFetchInFlight = false;
    }
  }

  // Odstraní z vehiclePositions spoje, které už nejsou mezi aktuálně
  // zobrazenými (odjely / vypadly z filtru) — brání neomezenému růstu mapy.
  function pruneVehiclePositions(departures){
    const activeIds = new Set(departures.filter(dep => dep.trip && dep.trip.id).map(dep => dep.trip.id));
    Array.from(vehiclePositions.keys()).forEach(tripId => {
      if (!activeIds.has(tripId)) vehiclePositions.delete(tripId);
    });
  }

  // US-17: sloučí čerstvou odpověď API s dřív zapamatovanými spoji, které
  // z ní mezitím vypadly, a rozhodne, které z nich už skutečně patří pryč ze
  // seznamu. Spoj bez trip.id nelze mezi fetchi sledovat (nemá stabilní
  // klíč) — takový se chová postaru, zmizí hned, jakmile ho API přestane
  // vracet.
  // US-17-bug-fixes: nezávislá definice "spoj je ve stavu Odjíždí" pro potřeby
  // mergeWithRetained — nesmí se opírat o nic z US-19 (ten je na samostatné
  // větvi), proto čte dep.trip.is_at_stop přímo, ne přes tick()/render().
  // Podmínka "predikovaný odjezd je v minulosti" replikuje stejnou 5s
  // toleranci jako formatCountdown(), ať se shoduje s tím, co appka reálně
  // zobrazuje.
  function isDepartingNow(dep, now){
    const predicted = dep._predicted;
    const pastPredicted = !!predicted && (predicted.getTime() - now) < -5000;
    const atStop = !!(dep.trip && dep.trip.is_at_stop);
    return pastPredicted || atStop;
  }

  function mergeWithRetained(freshDepartures){
    const freshIds = new Set();
    freshDepartures.forEach(dep => {
      const tripId = dep.trip && dep.trip.id;
      if (!tripId) return;
      freshIds.add(tripId);
      retainedDepartures.set(tripId, {dep, missingSince: null});
    });

    const now = Date.now();
    // US-17-bug-fixes: spoj, co teď poprvé vypadl z čerstvé odpovědi, byl
    // prokazatelně přítomný ještě při posledním úspěšném fetchi — ne až
    // "teď". Po delší odmlce appky (zavřená záložka, telefon uspaný) je
    // mezera mezi tímto a předchozím fetchem obrovská, takže missingSince
    // zpětně nastavené na dobu posledního fetche hned překročí grace lhůtu
    // a appka zastaralý spoj smaže při prvním fetchi po návratu, ne až po
    // 60–90 s. Při běžném provozu (mezera ~REFRESH_MS) se prakticky nic
    // nemění oproti počítání od "teď".
    const missingSinceBaseline = lastFetchCompletedAt !== null ? lastFetchCompletedAt : now;

    Array.from(retainedDepartures.keys()).forEach(tripId => {
      if (freshIds.has(tripId)) return;
      const entry = retainedDepartures.get(tripId);
      if (entry.missingSince === null) entry.missingSince = missingSinceBaseline;

      const cached = vehiclePositions.get(tripId);
      const originStopId = entry.dep.stop && entry.dep.stop.id;
      // US-17-bug-fixes: "poloha se někdy úspěšně získala" - i když je stará
      // nebo se teď nedaří ji obnovit (refreshVehiclePositions() při chybě
      // starou hodnotu záměrně nechává ležet, viz její komentář).
      const everHadPosition = !!cached && cached !== 'failed';
      const confirmedDeparted = everHadPosition && cached.lastStopId
        && originStopId && cached.lastStopId === originStopId;

      // confirmedDeparted platí bez ohledu na cokoliv dalšího (viz komentář
      // u POSITION_FAILING_GRACE_MS/POSITION_STALE_MS výš) — spoj se maže
      // hned, i kdyby ještě nebyl ve stavu "Odjíždí".
      let shouldDelete = confirmedDeparted;

      // Tři gradované případy níž se týkají jen spojů ve stavu "Odjíždí" —
      // dokud tam spoj není (např. čeká na odjezd, nebo stojí v koloně těsně
      // před zastávkou a poloha to nepotvrzuje), musí zůstat bez ohledu na
      // to, jak dlouho chybí v /pid/departureboards nebo jak stará je jeho
      // poloha.
      if (!shouldDelete && isDepartingNow(entry.dep, now)){
        if (!everHadPosition){
          shouldDelete = (now - entry.missingSince) >= MISSING_GRACE_MS;
        } else {
          const fetchFailingNow = (now - cached.fetchedAt) >= POSITION_FAILING_GRACE_MS;
          const positionContentStale = !fetchFailingNow
            && (now - cached.originTimestamp.getTime()) >= POSITION_STALE_MS;
          shouldDelete = fetchFailingNow || positionContentStale;
        }
      }

      if (shouldDelete){
        retainedDepartures.delete(tripId);
      }
    });

    lastFetchCompletedAt = now;

    const untracked = freshDepartures.filter(dep => !(dep.trip && dep.trip.id));
    const merged = Array.from(retainedDepartures.values()).map(e => e.dep).concat(untracked);
    merged.sort((a, b) => {
      const ta = a._predicted ? a._predicted.getTime() : Infinity;
      const tb = b._predicted ? b._predicted.getTime() : Infinity;
      return ta - tb;
    });
    return merged;
  }

  function render(departures){
    if (!departures.length){
      board.innerHTML = '<div class="empty">V nejbližší době nejede žádný přímý spoj.</div>';
      return;
    }
    board.innerHTML = departures.map((dep, i) => {
      const route = dep.route || {};
      const trip = dep.trip || {};
      const stop = dep.stop || {};
      const delay = dep.delay || {};
      const schedIso = dep.departure_timestamp ? dep.departure_timestamp.scheduled : null;
      const sched = schedIso ? new Date(schedIso) : null;
      const nightClass = route.is_night ? 'night' : '';
      const platform = stop.platform_code ? ` · stan. ${stop.platform_code}` : '';
      const vtypeIcon = ROUTE_TYPE_ICON[route.type];

      // US-10: zpoždění se zobrazuje jako samostatný delay-row mezi odjezdem
      // a příjezdem (platí pro oba), kladné červeně, záporné (náskok) modře.
      const delaySec = delay.seconds || 0;
      const delayClass = delaySec > 0 ? 'delayed' : (delaySec < 0 ? 'early' : '');

      // US-10: náskok se do výpočtu příjezdu nezapočítává (spoj s náskokem
      // dorazí do cíle dle jízdního řádu, ne dřív) — zpoždění ano, jako dřív.
      let arrHtml = destinationArrivalsLoaded
        ? '<span class="dim">čas příjezdu: nedostupný</span>'
        : '<span class="dim">čas příjezdu: zjišťuji…</span>';
      const arrivalTime = trip.id ? destinationArrivals.get(trip.id) : null;
      if (sched && arrivalTime){
        const arrSched = combineServiceDayTime(sched, arrivalTime);
        if (arrSched){
          const arrExpected = new Date(arrSched.getTime() + Math.max(0, delaySec) * 1000);
          arrHtml = `${formatClock(arrSched)} <span class="dim">příjezd →</span> ${formatClock(arrExpected)}`;
        }
      }

      return `
        <div class="row" data-idx="${i}">
          <div class="row-top">
            <div class="badge ${nightClass}">
              ${vtypeIcon ? `<span class="vtype">${vtypeIcon}</span>` : ''}
              <span class="num">${route.short_name || '?'}</span>
            </div>
            <div class="dest">
              <div class="headsign">${trip.headsign || ''}</div>
              <div class="meta">${trip.is_at_stop ? 've stanici' : 'na trase'}${platform}</div>
            </div>
            <span class="min" data-countdown="${i}">…</span>
          </div>
          <div class="row-details">
            <div class="dep-block">
              ${formatClock(sched)} <span class="dim">odjezd →</span> ${formatClock(dep._predicted)}
            </div>
            <div class="delay-row ${delayClass}">
              <span class="arrow">↓</span> <span class="delay-value">${fmtDelaySeconds(delaySec)}</span> <span class="arrow">↓</span>
            </div>
            <div class="arr-block">${arrHtml}</div>
            <div class="position ${positionTagClass(dep)}" data-postag="${i}">${positionTagText(dep)}</div>
          </div>
        </div>`;
    }).join('');
    tick(); // fill in countdowns immediately
  }

  function tick(){
    currentDepartures.forEach((dep, i) => {
      const countdownEl = board.querySelector('[data-countdown="' + i + '"]');
      if (countdownEl){
        const {text, soon, past} = formatCountdown(dep._predicted);
        // US-19: Golemio u spoje stojícího v zastávce hlásí trip.is_at_stop
        // rovnou v /pid/departureboards — pak nemá smysl čekat na lokální
        // dopočet do nuly, "odjíždí" se zobrazí hned.
        const atStop = !!(dep.trip && dep.trip.is_at_stop);
        countdownEl.textContent = (past || atStop) ? 'odjíždí' : text;
        countdownEl.classList.toggle('soon', soon || atStop);
      }
      const posEl = board.querySelector('[data-postag="' + i + '"]');
      if (posEl){
        posEl.textContent = positionTagText(dep);
        posEl.classList.toggle('unavailable', positionTagClass(dep) === 'unavailable');
      }
    });
  }

  async function fetchDepartures(){
    if (!apiKey || !BOARD_CONFIG) return;
    statusText.textContent = 'aktualizuji…';
    statusbar.classList.remove('live');
    try{
      const params = new URLSearchParams();
      BOARD_CONFIG.stopIds.forEach(id => params.append('ids[]', id));
      params.set('limit', '40');
      params.set('minutesAfter', '90');
      params.set('order', 'real');
      params.set('mode', 'departures');

      const data = await Connections.golemioGet('/pid/departureboards?' + params.toString(), apiKey);
      const freshDepartures = (data.departures || [])
        .filter(dep => {
          const rn = dep.route && dep.route.short_name;
          const hs = dep.trip && dep.trip.headsign;
          return isAllowed(rn, hs);
        })
        .map(dep => { dep._predicted = predictedDate(dep); return dep; });

      // US-17: spoj, který z čerstvé odpovědi vypadl, hned nemizí ze
      // seznamu — viz mergeWithRetained.
      const departures = mergeWithRetained(freshDepartures);

      currentDepartures = departures;
      render(departures);
      pruneVehiclePositions(departures);
      refreshVehiclePositions(departures);
      // Bugfix: dřív se čas příjezdu zkoušel načíst jen jednou při startu —
      // při selhání (viz loadDestinationArrivals) appka o další pokus už
      // nikdy nepožádala. Teď se to zkouší znovu při každém refreshi
      // odjezdů, dokud se to jednou nepovede.
      if (!destinationArrivalsLoaded) loadDestinationArrivals();
      const now = new Date();
      statusText.textContent = 'aktualizováno ' + now.toLocaleTimeString('cs-CZ', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
      statusbar.classList.add('live');
    }catch(e){
      console.error(e);
      if (e.status === 401 || e.status === 403){
        stopTimer();
        showSetup('API klíč nebyl přijat (chyba ' + e.status + '). Zkontrolujte, že jste ho zkopírovali celý.');
      } else if (e.status){
        statusText.textContent = 'chyba serveru (' + e.status + '), zkusím znovu za 20 s';
      } else {
        statusText.textContent = 'nepodařilo se načíst data, zkusím znovu';
      }
    }
  }

  (function init(){
    if (loadKey()){
      proceedAfterAuth();
    } else {
      showSetup();
    }
  })();

  // Register service worker for basic offline app-shell caching (PWA requirement).
  if ('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('Service worker se nepodařilo zaregistrovat', err);
      });
    });

    // US-16: jakmile prohlížeč při reálném otevření appky zjistí novou verzi
    // sw.js (skipWaiting/clients.claim v sw.js převezmou kontrolu na pozadí),
    // dokončit přechod jedním automatickým reloadem — ať uživatel nemusí
    // appku zavírat a otevírat znovu, aby viděl novou verzi.
    let reloadedForNewVersion = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadedForNewVersion) return;
      reloadedForNewVersion = true;
      window.location.reload();
    });
  }
})();
