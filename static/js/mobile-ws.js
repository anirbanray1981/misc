/*
 * TonePi Mobile — WebSocket feeds.
 * Live meters (/ws/meters, same feed the desktop app uses) and the
 * events feed (/ws/events, same feed desktop's state.js subscribes
 * to) so the phone stays in sync with any source that mutates the
 * live chain: another open tab, a wildcard fire, or the hardware
 * LVGL UI's own param/bypass writes (both go through the same
 * persist+broadcast path server-side — see CLAUDE.md). We only mirror
 * state in; we never fire a request back since the event is itself
 * the result of one.
 */

/* ── Live meters ── */
var meterWs = null;

function dbToPct(db) {
  if (db <= -60) return 0;
  if (db >= 0) return 100;
  return (db + 60) * (100 / 60);
}
function setWsStatus(on) {
  var dot = document.getElementById('wsDot');
  var lbl = document.getElementById('wsLabel');
  if (!dot) return;
  dot.classList.toggle('off', !on);
  lbl.textContent = on ? 'live' : 'offline';
}
function updateMeters(jm) {
  var inp = jm.input;
  var outL = jm.out_l, outR = jm.out_r;
  var inEl = document.getElementById('meterIn');
  var inVal = document.getElementById('meterInVal');
  var outEl = document.getElementById('meterOut');
  var outVal = document.getElementById('meterOutVal');
  if (inp) {
    inEl.style.width = dbToPct(inp.peak) + '%';
    inEl.classList.toggle('clip', inp.true_peak >= -0.1);
    inVal.textContent = inp.peak <= -60 ? '—' : inp.peak.toFixed(0);
  }
  if (outL || outR) {
    var outPeak = Math.max(outL ? outL.peak : -100, outR ? outR.peak : -100);
    var outClip = (outL && outL.true_peak >= -0.1) || (outR && outR.true_peak >= -0.1);
    outEl.style.width = dbToPct(outPeak) + '%';
    outEl.classList.toggle('clip', outClip);
    outVal.textContent = outPeak <= -60 ? '—' : outPeak.toFixed(0);
  }
}
/* ── Master mute readback (real state, any path) ── */
function updateMasterMuteUI(muted) {
  masterMuted = muted;
  var btn = document.getElementById('btnMasterMute');
  var ic = document.getElementById('masterMuteIc');
  if (!btn || !ic) return;
  btn.classList.toggle('muted', muted);
  ic.querySelector('use').setAttribute('href', muted ? '#ic-mute' : '#ic-speaker');
}

function connectMeterWs() {
  try {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    meterWs = new WebSocket(proto + '//' + location.host + '/ws/meters');
    meterWs.onopen = function () { setWsStatus(true); };
    meterWs.onclose = function () { setWsStatus(false); setTimeout(connectMeterWs, 3000); };
    meterWs.onerror = function () { setWsStatus(false); };
    meterWs.onmessage = function (evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.engine_jm) updateMeters(data.engine_jm);
        if (typeof data.master_mute === 'boolean') updateMasterMuteUI(data.master_mute);
      } catch (e) { /* ignore malformed frame */ }
    };
  } catch (e) {
    setWsStatus(false);
  }
}

/* ── Events (state sync) ── */
var eventsWs = null;
/* Events now come from the SHARED core (tp_engine.js), which desktop
 * uses too. Everything below is what only this UI can do: render.
 *
 * Before, each UI carried its own socket and its own dispatch, and the
 * two drifted -- this one had banks_changed and no snapshot_changed,
 * desktop had the reverse -- so a fix landed on one side and missed the
 * other. An event this UI cannot render is now a missing callback, not
 * a missing branch. */
function connectEventsWs() {
  if (typeof TPEngine === 'undefined') {
    console.error('[mobile] tp_engine.js not loaded');
    return;
  }
  /* The snapshot model reads the live chain through this adapter, so it
   * never has to know which global each UI keeps it in. */
  if (typeof TPSnapshots !== 'undefined') {
    TPSnapshots.init({
      getChain: function () { return currentChain; },
      toast: function (t) { if (typeof toast === 'function') toast(t); }
    });
  }

  TPEngine.init({
    name: 'mobile',
    toast: function (t) { if (typeof toast === 'function') toast(t); },

    /* The engine's chain, arriving from any source. Called inside the
     * core's suspend guard, so rendering here cannot echo back. */
    applyChain: function (chainArr, meta) {
      currentChain = chainArr || [];
      chainSource = meta.source || 'none';
      chainName = meta.name || null;
      dirty = false;
      selectedIdx = currentChain.length ? 0 : -1;
      updateHeader();
      renderChainLane();
      renderParamPanel(selectedIdx);
      if (typeof updateFabState === 'function') updateFabState();
      /* Pull this preset's snapshots so a later hardware switch has a
       * model to move. Without it the phone has nothing to adopt and
       * re-syncing cannot help -- /api/chain/current returns chain[]'s
       * params, not snapshot N's. */
      if (typeof TPSnapshots !== 'undefined') {
        return TPSnapshots.load(meta.source === 'preset' ? meta.name : '')
          .then(function () {
            if (typeof renderSnapshotSelect === 'function') renderSnapshotSelect();
          });
      }
      /* The Banks tab highlight is derived from chainSource/chainName,
       * not from bank_manager's own lazily-persisted active slot, so it
       * has to be recomputed whenever those move. */
      if (typeof refreshBankHighlight === 'function') refreshBankHighlight();
    },

    applyParam:  function (msg) { applyBlockParamEvent(msg); },
    applyBypass: function (msg) { applyBlockBypassEvent(msg); },

    /* The hardware moved to another snapshot of the chain already
     * loaded. This UI had no handler at all, so a bank slot that
     * differs only by snapshot changed the sound and left the phone
     * showing the previous values. */
    onSnapshotChanged: function (msg) {
      /* Only if it is THIS chain -- adopting another preset's index
       * would rewrite the params of whatever is open here. */
      if (chainName && msg.name && msg.name !== chainName) return;
      if (typeof TPSnapshots === 'undefined') return;
      if (!TPSnapshots.adopt(msg.index)) return;
      renderChainLane();
      renderParamPanel(selectedIdx);
      updateHeader();
      if (typeof renderSnapshotSelect === 'function') renderSnapshotSelect();
      if (typeof toast === 'function') {
        var sn = TPSnapshots.list()[msg.index];
        toast('Snapshot: ' + ((sn && sn.name) || (msg.index + 1)));
      }
    },

    onBanksChanged: function () {
      if (typeof refreshBanks === 'function' && banksData) {
        refreshBanks(currentBankIdx != null);
      }
    },

    onPresetLoadFailed: function (msg) {
      /* No .so fallback for a graph-saved preset -- a failed load is
       * otherwise just silence, which reads as broken hardware. */
      if (typeof toast === 'function')
        toast('Preset "' + (msg.name || '?') + '" failed to load: '
              + (msg.error || 'unknown error'));
    },

    onSocketOpen: function () { if (typeof setWsStatus === 'function') setWsStatus(true); }
  });
}

function applyBlockParamEvent(msg) {
  var blockId = String(msg.block || '');
  var paramId = String(msg.param || '');
  if (!blockId || !paramId) return;
  var value = msg.value;
  if (typeof value === 'number') { if (!isFinite(value)) return; }
  else if (typeof value === 'boolean') { value = value ? 1 : 0; }
  else if (typeof value !== 'string') { return; }
  var targetFid = (msg.faust_id != null) ? Number(msg.faust_id) : null;
  var touched = false;
  walkChainItems(currentChain, function (it) {
    var fid = it.faust_id != null ? it.faust_id : it.instanceId;
    if (it.block === blockId && (targetFid == null || Number(fid) === targetFid)) {
      if (!it.params) it.params = {};
      if (it.params[paramId] !== value) { it.params[paramId] = value; touched = true; }
    }
  });
  if (!touched) return;
  dirty = true;
  updateHeader();
  if (selectedIdx >= 0 && currentChain[selectedIdx] && currentChain[selectedIdx].block === blockId) {
    renderParamPanel(selectedIdx);
  }
}
function applyBlockBypassEvent(msg) {
  var blockId = String(msg.block || '');
  var want = !!msg.disabled;
  var targetFid = (msg.faust_id != null) ? Number(msg.faust_id) : null;
  var touched = false;
  walkChainItems(currentChain, function (it) {
    var fid = it.faust_id != null ? it.faust_id : it.instanceId;
    if (it.block === blockId && (targetFid == null || Number(fid) === targetFid) && !!it.disabled !== want) {
      it.disabled = want;
      touched = true;
    }
  });
  if (!touched) return;
  dirty = true;
  /* REDRAW ONLY -- see state.js's _applyBlockBypassEvent for why. The
   * engine already applied this; renderChainLane() ending in
   * LiveGraph.schedule() would otherwise re-POST the whole chain for a
   * toggle this tab never made. */
  if (typeof LiveGraph !== 'undefined') LiveGraph.suspend();
  renderChainLane();
  if (typeof LiveGraph !== 'undefined') LiveGraph.resume(false);
  updateHeader();
  if (selectedIdx >= 0 && currentChain[selectedIdx] && currentChain[selectedIdx].block === blockId) {
    renderParamPanel(selectedIdx);
  }
}
