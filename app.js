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

  // US-8: poloha vozidla, trip_id -> {originTimestamp, fetchedAt} | 'failed'.
  // Ověřuje se znovu při každém refreshi seznamu spojů pro všechny aktuálně
  // sledované spoje (ne jen jednou) — viz refreshVehiclePositions.
  let vehiclePositions = new Map();
  let positionFetchInFlight = false;

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
  const titleEl = document.getElementById('boardTitle');
  const versionEl = document.getElementById('appVersion');
  if (versionEl) versionEl.textContent = 'verze ' + APP_VERSION;

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
    if (message){
      pickerError.textContent = message;
      pickerError.style.display = 'block';
    } else {
      pickerError.style.display = 'none';
      warmPickerIndex();
    }
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
      BOARD_CONFIG = {
        fromLabel: pair.from.name,
        toLabel: pair.to.name,
        stopIds: pair.from.stopIds,
        toStopIds: pair.to.stopIds,
        allowed: pair.allowed
      };
      setTitle(BOARD_CONFIG);
      showMain();
      destinationArrivals = new Map();
      destinationArrivalsLoaded = false;
      destinationArrivalsInFlight = false;
      arrivalsGeneration++;
      loadDestinationArrivals();
      fetchDepartures();
      startTimer();
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
      Connections.saveStopPair({
        from: selectedFrom,
        to: selectedTo,
        allowed,
        computedAt: new Date().toISOString()
      });
      BOARD_CONFIG = {
        fromLabel: selectedFrom.name,
        toLabel: selectedTo.name,
        stopIds: selectedFrom.stopIds,
        toStopIds: selectedTo.stopIds,
        allowed
      };
      setTitle(BOARD_CONFIG);
      showMain();
      destinationArrivals = new Map();
      destinationArrivalsLoaded = false;
      destinationArrivalsInFlight = false;
      arrivalsGeneration++;
      loadDestinationArrivals();
      fetchDepartures();
      startTimer();
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
      const result = await Connections.loadDestinationArrivals(BOARD_CONFIG.toStopIds, apiKey);
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
      await Connections.fetchVehiclePositions(tripIds, apiKey, (tripId, originTimestamp) => {
        const hadData = vehiclePositions.get(tripId);
        const alreadyKnown = hadData && hadData !== 'failed';
        if (originTimestamp){
          vehiclePositions.set(tripId, {originTimestamp, fetchedAt: Date.now()});
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
        countdownEl.textContent = past ? 'odjel' : text;
        countdownEl.classList.toggle('soon', soon && !past);
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
      const departures = (data.departures || [])
        .filter(dep => {
          const rn = dep.route && dep.route.short_name;
          const hs = dep.trip && dep.trip.headsign;
          return isAllowed(rn, hs);
        })
        .map(dep => { dep._predicted = predictedDate(dep); return dep; })
        .sort((a, b) => {
          const ta = a._predicted ? a._predicted.getTime() : Infinity;
          const tb = b._predicted ? b._predicted.getTime() : Infinity;
          return ta - tb;
        });

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
  }
})();
