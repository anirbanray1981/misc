/*
 * ZynEditor Mobile — shared state + shell utilities.
 * Loaded after mobile-*.js in the merged mobile.html — this is a
 * different mental model from the guitar-DSP side (Zynthian synth
 * engine, not TonePi's own chain), but it now shares the SAME page and
 * global JS scope (see setAppMode() in mobile-state.js), so the
 * generic shell utilities (toast/openSheet/closeSheet/escapeHtml/
 * esc1/emptyNote/attachLongPress/LONG_PRESS_MS/toastTimer) are NOT
 * redefined here — mobile-state.js's copies serve both apps. Only
 * Zynthian-specific state and the tab switcher (setZynTab — distinct
 * from mobile-state.js's setTab since it has its own screen-id
 * namespace and its own per-tab refresh hooks) live here.
 *
 * API wrappers mirror web/static/js/zyn_editor.js's own `API` object
 * exactly (same endpoints, same bodies) — that file is the proven,
 * already-shipped desktop client for this same backend.
 */

var API = {
  health:       function () { return fetch('/api/zyn/live/health').then(function (r) { return r.json(); }); },
  liveState:    function () { return fetch('/api/zyn/live/state').then(function (r) { return r.json(); }); },
  engines:      function () { return fetch('/api/zyn/live/engines').then(function (r) { return r.json(); }); },
  presets:      function (pid) { return fetch('/api/zyn/live/processors/' + pid + '/presets').then(function (r) { return r.json(); }); },
  engineBanks:  function (pid) { return fetch('/api/zyn/live/processors/' + pid + '/banks').then(function (r) { return r.json(); }); },
  setEngineBank: function (pid, body) {
    return fetch('/api/zyn/live/processors/' + pid + '/bank', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  },
  controllers:  function (pid) { return fetch('/api/zyn/live/processors/' + pid + '/controllers').then(function (r) { return r.json(); }); },
  setPreset:    function (pid, body) {
    return fetch('/api/zyn/live/processors/' + pid + '/preset', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  },
  setCtrl:      function (pid, sym, val) {
    return fetch('/api/zyn/live/processors/' + pid + '/controllers/' + encodeURIComponent(sym), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: val })
    }).then(function (r) { return r.json(); });
  },
  setActive:    function (cid) { return fetch('/api/zyn/live/chains/' + cid + '/active', { method: 'PUT' }).then(function (r) { return r.json(); }); },
  addChain:     function (body) {
    return fetch('/api/zyn/live/chains', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  },
  removeChain:  function (cid) { return fetch('/api/zyn/live/chains/' + cid + '?async=1', { method: 'DELETE' }).then(function (r) { return r.json(); }); },
  setMidiChan:  function (cid, chan) {
    return fetch('/api/zyn/live/chains/' + cid + '/midi_chan', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ midi_chan: chan })
    }).then(function (r) { return r.json(); });
  },
  addProc:      function (cid, body) {
    return fetch('/api/zyn/live/chains/' + cid + '/processors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  },
  removeProc:   function (pid) { return fetch('/api/zyn/live/processors/' + pid + '?async=1', { method: 'DELETE' }).then(function (r) { return r.json(); }); },
  nudgeProc:    function (pid, up) {
    return fetch('/api/zyn/live/processors/' + pid + '/nudge', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ up: up })
    }).then(function (r) { return r.json(); });
  },
  task:         function (tid) { return fetch('/api/zyn/live/tasks/' + tid).then(function (r) { return r.json(); }); },
  mixer:        function () { return fetch('/api/zyn/live/mixer').then(function (r) { return r.json(); }); },
  setMixer:     function (chan, field, value) {
    return fetch('/api/zyn/live/mixer/' + chan + '/' + field, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: value })
    }).then(function (r) { return r.json(); });
  },
  banks:        function () { return fetch('/api/zyn/banks').then(function (r) { return r.json(); }); },
  createBank:   function (body) {
    return fetch('/api/zyn/banks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  },
  deleteBank:   function (bank, force) {
    return fetch('/api/zyn/banks/' + encodeURIComponent(bank) + (force ? '?force=1' : ''), { method: 'DELETE' }).then(function (r) { return r.json(); });
  },
  renameBank:   function (bank, body) {
    return fetch('/api/zyn/banks/' + encodeURIComponent(bank) + '/rename', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  },
  snapshots:    function (bank) { return fetch('/api/zyn/banks/' + encodeURIComponent(bank) + '/snapshots').then(function (r) { return r.json(); }); },
  snapshot:     function (bank, file) { return fetch('/api/zyn/snapshots/' + encodeURIComponent(bank) + '/' + encodeURIComponent(file)).then(function (r) { return r.json(); }); },
  cloneSnap:    function (bank, file, body) {
    return fetch('/api/zyn/snapshots/' + encodeURIComponent(bank) + '/' + encodeURIComponent(file) + '/clone', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  },
  renameSnap:   function (bank, file, body) {
    return fetch('/api/zyn/snapshots/' + encodeURIComponent(bank) + '/' + encodeURIComponent(file) + '/rename', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  },
  deleteSnap:   function (bank, file) {
    return fetch('/api/zyn/snapshots/' + encodeURIComponent(bank) + '/' + encodeURIComponent(file), { method: 'DELETE' }).then(function (r) { return r.json(); });
  },
  getSnapClock: function (bank, file) {
    return fetch('/api/zyn/snapshots/' + encodeURIComponent(bank) + '/' + encodeURIComponent(file) + '/midi_clock_source').then(function (r) { return r.json(); });
  },
  setSnapClock: function (bank, file, source) {
    return fetch('/api/zyn/snapshots/' + encodeURIComponent(bank) + '/' + encodeURIComponent(file) + '/midi_clock_source', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: source })
    }).then(function (r) { return r.json(); });
  },
  loadSnapshot: function (fpath) {
    return fetch('/api/zyn/live/snapshot/load', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fpath: fpath })
    }).then(function (r) { return r.json(); });
  }
};

/* ── Shared live state ── */
var liveState = null;        // last /api/zyn/live/state response
var selectedChainId = null;  // which chain the Rack tab is showing
var inspectedPid = null;     // processor id open in the Inspector
var currentTab = 'rack';
var livePollTimer = null;
var enginesPromise = null;   // lazy cache, matches desktop's _engineCatalog

function engineCatalog() {
  if (!enginesPromise) enginesPromise = API.engines();
  return enginesPromise;
}

/* Poll a task to completion — mutations that touch the audio engine
 * (add chain/processor, load snapshot) are async server-side. */
function awaitTask(taskId, intervalMs, maxMs) {
  intervalMs = intervalMs || 250;
  maxMs = maxMs || 30000;
  var t0 = Date.now();
  function poll() {
    return API.task(taskId).then(function (t) {
      if (t.status === 'done' || t.status === 'failed') return t;
      if (Date.now() - t0 >= maxMs) return { status: 'timeout', error: 'client timeout' };
      return new Promise(function (resolve) { setTimeout(resolve, intervalMs); }).then(poll);
    });
  }
  return poll();
}

/* ── Tabs ── Named setZynTab (not setTab — mobile-state.js already
 * owns that name for the TonePi side; different screen-id namespace,
 * different per-tab refresh hooks, so this stays a separate function
 * rather than folding into it). */
function setZynTab(name) {
  currentTab = name;
  document.querySelectorAll('#app-zynthian .tabbar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
  document.querySelectorAll('#app-zynthian .screen:not(.overlay)').forEach(function (s) { s.classList.remove('active'); });
  document.getElementById('scr-' + name).classList.add('active');
  if (name === 'library' && typeof renderZynBankList === 'function' && !document.getElementById('libScroll').dataset.loaded) {
    renderZynBankList();
  }
  if (name === 'mixer' && typeof refreshMixer === 'function') refreshMixer();
  if (name === 'voices' && typeof renderVoices === 'function') renderVoices();
}

/* Generic action-list row — same idiom as the main TonePi mobile app's
 * actionRowHtml(), generalized since several different sheets on this
 * page share it: pass which sheet id to auto-close via opts.sheet.
 * opts.keepOpen skips the auto-close for rows that navigate to a
 * submenu within the same sheet instead of performing an action.
 * (Kept as a distinct function from mobile-state.js's actionRowHtml —
 * different call signature, both are fine to coexist.) */
function actionRow(icon, label, onclick, opts) {
  opts = opts || {};
  var cls = 'action-row' + (opts.disabled ? ' disabled' : '') + (opts.danger ? ' danger' : '');
  var tail = opts.keepOpen ? '' : (opts.sheet ? ';closeSheet(\'' + opts.sheet + '\')' : '');
  return '<div class="' + cls + '" onclick="' + (opts.disabled ? '' : onclick + tail) + '">' +
    '<svg class="ic"><use href="#' + icon + '"/></svg><span>' + label + '</span></div>';
}

/* ── Health + live-state polling ── */
function checkHealth() {
  return API.health().then(function (h) {
    var sub = document.getElementById('rackSub');
    if (!sub) return h;
    if (h.zyngui_present) sub.textContent = 'Live • ' + (liveState ? liveState.chains.length : 0) + ' chains';
    else sub.textContent = 'Zynthian not ready';
    return h;
  }).catch(function () {
    var sub = document.getElementById('rackSub');
    if (sub) sub.textContent = 'Unreachable';
  });
}

function refreshLiveState() {
  return API.liveState().then(function (st) {
    liveState = st;
    if (!st || !Array.isArray(st.chains)) return st;
    if (selectedChainId == null || !st.chains.some(function (c) { return c.chain_id === selectedChainId; })) {
      selectedChainId = st.active_chain_id != null ? st.active_chain_id : (st.chains[0] ? st.chains[0].chain_id : null);
    }
    if (currentTab === 'rack' && typeof renderChainStrip === 'function') {
      renderChainStrip();
      renderRack();
    }
    if (currentTab === 'voices' && typeof renderVoices === 'function') renderVoices();
    var sub = document.getElementById('rackSub');
    if (sub) sub.textContent = 'Live • ' + st.chains.length + ' chain' + (st.chains.length === 1 ? '' : 's');
    return st;
  }).catch(function (e) {
    toast('Could not reach Zynthian: ' + e.message);
  });
}

function startLivePoll() {
  if (livePollTimer) clearInterval(livePollTimer);
  livePollTimer = setInterval(function () {
    checkHealth();
    if (currentTab === 'rack' || currentTab === 'voices') refreshLiveState();
    else if (currentTab === 'mixer' && typeof refreshMixer === 'function') refreshMixer();
  }, 2000);
}

function panicAllNotesOff() {
  if (!liveState || !Array.isArray(liveState.chains)) return;
  toast('Panic not wired to a dedicated endpoint yet — use Zynthian’s own panic.');
}
