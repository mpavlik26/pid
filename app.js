(function(){
  const STORAGE_KEY = 'pid_departures_golemio_api_key';

  let apiKey = null;
  let timer = null;
  let tickTimer = null;
  let currentDepartures = []; // last fetched, filtered, with parsed predicted Date

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
        allowed: pair.allowed
      };
      setTitle(BOARD_CONFIG);
      showMain();
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
        allowed
      };
      setTitle(BOARD_CONFIG);
      showMain();
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

  function fmtTime(iso){
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});
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
      const sched = dep.departure_timestamp ? dep.departure_timestamp.scheduled : null;
      const nightClass = route.is_night ? 'night' : '';
      const hasDelay = delay.is_available && delay.minutes && delay.minutes > 0;
      const platform = stop.platform_code ? ` · stan. ${stop.platform_code}` : '';
      const trackedTag = delay.is_available ? '● poloha vozu' : '';
      return `
        <div class="row" data-idx="${i}">
          <div class="badge ${nightClass}">${route.short_name || '?'}</div>
          <div class="dest">
            <div class="headsign">${trip.headsign || ''}</div>
            <div class="meta">${trip.is_at_stop ? 've stanici' : 'na trase'}${platform}</div>
          </div>
          <div class="eta">
            <span class="min" data-countdown="${i}">…</span>
            <div class="sched ${hasDelay ? 'delayed' : ''}">${fmtTime(sched)}${hasDelay ? ' +' + delay.minutes + ' min' : ''}</div>
            ${trackedTag ? `<div class="live-tag">${trackedTag}</div>` : ''}
          </div>
        </div>`;
    }).join('');
    tick(); // fill in countdowns immediately
  }

  function tick(){
    currentDepartures.forEach((dep, i) => {
      const el = board.querySelector('[data-countdown="' + i + '"]');
      if (!el) return;
      const {text, soon, past} = formatCountdown(dep._predicted);
      el.textContent = past ? 'odjel' : text;
      el.classList.toggle('soon', soon && !past);
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

      const url = 'https://api.golemio.cz/v2/pid/departureboards?' + params.toString();
      const res = await fetch(url, {
        headers: { 'X-Access-Token': apiKey }
      });

      if (res.status === 401 || res.status === 403){
        stopTimer();
        showSetup('API klíč nebyl přijat (chyba ' + res.status + '). Zkontrolujte, že jste ho zkopírovali celý.');
        return;
      }
      if (!res.ok){
        statusText.textContent = 'chyba serveru (' + res.status + '), zkusím znovu za 20 s';
        return;
      }

      const data = await res.json();
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
      const now = new Date();
      statusText.textContent = 'aktualizováno ' + now.toLocaleTimeString('cs-CZ', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
      statusbar.classList.add('live');
    }catch(e){
      console.error(e);
      statusText.textContent = 'nepodařilo se načíst data, zkusím znovu';
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
