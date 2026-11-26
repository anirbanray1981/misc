/* TonePi — Guitar DSP Platform
 * Copyright (c) 2024-2026 Anirban Ray. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, modification,
 * or distribution is strictly prohibited without explicit license.
 *
 * Shared engine core for the desktop designer and the mobile app.
 *
 * WHY THIS EXISTS
 *
 * Both UIs talk to the same engine, and until now each carried its own
 * copy of how. The copies drifted in BOTH directions -- desktop handled
 * chain_compiled and snapshot_changed, mobile handled banks_changed,
 * neither was a superset -- so a fix landed on one side and silently
 * missed the other. Two concrete costs, both real:
 *
 *   - The "passive redraw must not push" guard had to be written three
 *     times (state.js, mobile-state.js, mobile-ws.js). It reached
 *     mobile's loadChain() but not its loadNamedChain(), so loading a
 *     named chain on the phone pushed it back as an anonymous DESIGNER
 *     edit and the preset lost its identity on the round trip.
 *   - snapshot_changed only ever landed on desktop, so the phone never
 *     followed a hardware snapshot switch at all.
 *
 * Everything the engine sees lives here: the socket, the event
 * dispatch, the RPCs, and the suspend guard. Rendering does not -- each
 * UI keeps its own, injected as adapter callbacks. Precedent for a
 * shared module is live_graph.js, which both HTMLs already load.
 *
 * ADAPTER. init() takes callbacks; every one is optional, so a UI opts
 * in to the events it can actually render:
 *
 *   applyChain(chain, meta)  replace the chain the UI shows. meta is
 *                            {name, source, hooks}. Called INSIDE the
 *                            suspend guard -- render freely, it cannot
 *                            reach the engine.
 *   applyParam(msg)          one param moved elsewhere: {block, param,
 *                            value, faust_id}
 *   applyBypass(msg)         one block's bypass moved elsewhere
 *   onSnapshotChanged(msg)   the ACTIVE SNAPSHOT moved, chain did not
 *                            reload: {name, index}
 *   onChainCompiled(msg)     a compile finished
 *   onBanksChanged()         banks added/renamed/reassigned
 *   onPresetLoadFailed(msg)  {name, error}
 *   toast(text, kind)        user-visible message
 */
(function () {
  'use strict';

  var A = {};                 /* adapter callbacks */
  var ws = null;
  var retryTimer = null;
  var paramTimers = {};
  var UI = 'ui';

  function cb(name) {
    var f = A[name];
    return (typeof f === 'function') ? f : null;
  }
  function say(text, kind) {
    var t = cb('toast');
    if (t) t(text, kind);
    else console.log('[tp_engine]', text);
  }

  /* ── The suspend guard ───────────────────────────────────────────
   *
   * Any redraw caused by the ENGINE must not travel back to it. Both
   * UIs end a structural render in LiveGraph.schedule(), so a plain
   * redraw on a WS update re-POSTs the whole chain as a designer edit:
   * the engine then relabels the running preset as an anonymous
   * designer chain and marks it dirty, while the correct audio carries
   * on -- so the symptom is a UI that lies, not one that breaks.
   *
   * resume(false) because the engine already HAS this chain; it is what
   * told us about it. Resuming WITH an apply would repeat it. */
  function passive(fn) {
    var lg = (typeof window !== 'undefined') ? window.LiveGraph : null;
    if (lg && lg.suspend) lg.suspend();
    var released = false;
    function release() {
      if (released) return;
      released = true;
      if (lg && lg.resume) lg.resume(false);
    }
    var out;
    try { out = fn(); }
    catch (e) { release(); throw e; }
    /* HOLD the guard until an async callback SETTLES.
     *
     * Releasing in a plain finally looks right and is not: the desktop
     * refresh ends in an awaited loadSnapshots(), which re-renders and
     * would schedule its own apply. With the guard already released by
     * the time that fetch came back, the re-render applied anyway --
     * and that is what kept relabelling a hardware-loaded preset
     * "Designer" on the Perform screen. Callers that return a promise
     * get the guard for as long as it takes. */
    if (out && typeof out.then === 'function') {
      out.then(release, release);
      return out;
    }
    release();
    return out;
  }

  /* ── Engine reads ────────────────────────────────────────────────── */

  /* Sync FROM the engine. Always passive by construction: this is the
   * engine's own state coming back, never an edit. */
  function loadCurrent() {
    return fetch('/api/chain/current')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return null;
        var ac = cb('applyChain');
        if (!ac) return d;
        /* Return the adapter's promise so the guard is held until the
         * UI has finished rebuilding, snapshots included. */
        return Promise.resolve(passive(function () {
          return ac(d.chain || [], { name: d.name || null,
                                     source: d.source || 'none',
                                     hooks: d.hooks || { on_load: [], on_unload: [] },
                                     bus_master: d.bus_master });
        })).then(function () { return d; });
      })
      .catch(function (e) { say('Could not reach the engine: ' + e.message, 'error'); return null; });
  }

  /* Load a SAVED preset.
   *
   * play:true asks the ENGINE to load it (POST /preview), which is what
   * makes it audible and keeps its identity -- the engine answers with
   * chain_loaded and the sync below picks the name up.
   *
   * play:false loads it into the editor only. That still has to be
   * passive: mobile's loadNamedChain fetched the chain, rendered it,
   * and the render pushed it straight back as a designer edit, so the
   * preset arrived anonymous. Fetch-and-render is not an edit and must
   * not look like one. */
  function loadNamed(name, opts) {
    var play = !(opts && opts.play === false);
    if (play) {
      return fetch('/api/chains/' + encodeURIComponent(name) + '/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok || !d || !d.ok) {
            /* Never swallow this: the browser would show a chain the
             * engine is not playing. */
            say('Could not load "' + name + '": ' +
                ((d && d.message) || ('HTTP ' + r.status)), 'error');
            return null;
          }
          return loadCurrent().then(function () { return d; });
        });
      }).catch(function (e) {
        say('Could not load "' + name + '": ' + e.message, 'error');
        return null;
      });
    }
    return fetch('/api/chains/' + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.error) throw new Error((d && d.error) || 'Not found');
        var ac = cb('applyChain');
        if (ac) passive(function () {
          ac(d.chain || [], { name: name, source: 'preset',
                              hooks: d.hooks || { on_load: [], on_unload: [] },
                              bus_master: d.bus_master });
        });
        return d;
      })
      .catch(function (e) { say('Load failed: ' + e.message, 'error'); return null; });
  }

  /* ── Engine writes ───────────────────────────────────────────────── */

  /* Push a param by its FAUST name. Debounced per target: a fader emits
   * a value per pointer move and the engine only needs the last one.
   *
   * Raw-name form exists because not every live param is scoped to a
   * block instance -- a parallel lane level is `lane_level_<id>_<lane>`
   * with no block or param part at all. */
  function setParamByName(name, value, opts) {
    var wait = (opts && typeof opts.debounceMs === 'number') ? opts.debounceMs : 120;
    if (paramTimers[name]) clearTimeout(paramTimers[name]);
    paramTimers[name] = setTimeout(function () {
      delete paramTimers[name];
      fetch('/api/chain/param', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, value: value })
      }).catch(function (e) { say('Param push failed: ' + e.message, 'error'); });
    }, wait);
  }

  /* The usual case: a param on one block instance. */
  function setParam(block, faustId, paramId, value, opts) {
    return setParamByName(block + '_' + (faustId || 0) + '.' + paramId, value, opts);
  }

  function setLaneLevel(parallelId, laneIdx, value, opts) {
    return setParamByName('lane_level_' + (parallelId != null ? parallelId : 0) +
                          '_' + laneIdx, value, opts);
  }

  function setBypass(block, faustId, disabled) {
    return fetch('/api/chain/bypass', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ block: block, faust_id: faustId || 0,
                             disabled: !!disabled })
    }).catch(function (e) { say('Bypass push failed: ' + e.message, 'error'); });
  }

  /* ── Events ──────────────────────────────────────────────────────
   *
   * ONE dispatch table for both UIs. An event a UI cannot render is a
   * missing callback, not a missing branch -- which is what stopped the
   * two lists drifting apart again. */
  var HANDLERS = {
    ping: function () { },

    /* Both UIs edit the GUITAR chain. A vocal value carries kind:"vocal"
     * and must not be applied here: faust_id is unique only within one
     * chain, so a vocal block's id can match a guitar block's and the
     * edit would land on the wrong one. Events with no kind predate the
     * field and are guitar. */
    block_param: function (msg) {
      if (msg.kind && msg.kind !== 'guitar') return;
      var f = cb('applyParam'); if (f) f(msg);
    },
    /* which preset a block has loaded, from any client (panel or a tab):
     * block_preset_state.py; presets.js shows it */
    block_preset: function (msg) {
      if (typeof window.onBlockPresetEvent === 'function') window.onBlockPresetEvent(msg);
    },
    block_bypass: function (msg) {
      if (msg.kind && msg.kind !== 'guitar') return;
      var f = cb('applyBypass'); if (f) f(msg);
    },

    /* A chain went live, from ANY source: web Play, a hardware
     * footswitch, a bank slot, a hook, IPC preview, an edit on the Q8B
     * panel (chain_notify.py). Re-sync rather than trust the payload, so
     * every path converges on one truth. Not our own Play echoing back
     * (origin = this tab's id), and the vocal / synth worlds go to their
     * own callback -- this re-sync reads the GUITAR chain. */
    chain_loaded: function (msg) {
      if (msg && msg.origin && msg.origin === CLIENT_ID) return;
      var kind = (msg && msg.kind) || 'guitar';
      if (kind === 'guitar') { loadCurrent(); return; }
      var f = cb('onWorldChainLoaded'); if (f) f(msg);
    },

    chain_compiled: function (msg) {
      var f = cb('onChainCompiled'); if (f) f(msg);
    },

    /* The active snapshot moved WITHOUT a chain load -- a bank slot
     * whose preset is already loaded and differs only by snapshot. The
     * chain did not reload, so this must not re-render the graph or
     * re-apply anything; the engine is already there. */
    snapshot_changed: function (msg) {
      var f = cb('onSnapshotChanged'); if (f) passive(function () { f(msg); });
    },

    /* A world switched ON / OFF -- from the Q8B panel, this page or any
     * other client (routes/worlds.py _publish). */
    world_power: function (msg) {
      var f = cb('onWorldPower'); if (f) f(msg);
    },

    /* A COMBO slot was played (routes/combo_banks.py select). */
    combo_selected: function (msg) {
      var f = cb('onComboSelected'); if (f) f(msg);
    },

    banks_changed: function (msg) {
      var f = cb('onBanksChanged'); if (f) f(msg);
    },

    preset_load_failed: function (msg) {
      var f = cb('onPresetLoadFailed');
      if (f) f(msg);
      else say('Preset "' + (msg.name || '?') + '" failed to load: ' +
               (msg.error || 'unknown error'), 'error');
    }
  };

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    var proto = (location.protocol === 'https:') ? 'wss://' : 'ws://';
    try { ws = new WebSocket(proto + location.host + '/ws/events'); }
    catch (e) { scheduleRetry(); return; }

    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (!msg || !msg.event) return;
      var h = HANDLERS[msg.event];
      if (h) h(msg);
      var spy = cb('onEvent');            /* for tests / diagnostics */
      if (spy) spy(msg);
    };
    ws.onclose = scheduleRetry;
    ws.onerror = function () { try { ws.close(); } catch (_) { } };
    var open = cb('onSocketOpen');
    ws.onopen = function () { if (open) open(); };
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () { retryTimer = null; connect(); }, 2000);
  }

  /* This tab's id: sent as `origin` with its own Play, so the chain_loaded
   * that answers it is not mistaken for someone else's change. */
  var CLIENT_ID = 'w' + Math.random().toString(36).slice(2, 10);

  function init(adapter) {
    A = adapter || {};
    UI = A.name || 'ui';
    connect();
    return api;
  }

  var api = {
    init: init,
    connect: connect,
    passive: passive,
    loadCurrent: loadCurrent,
    loadNamed: loadNamed,
    setParam: setParam,
    setParamByName: setParamByName,
    setLaneLevel: setLaneLevel,
    setBypass: setBypass,
    /* Exposed so a UI can add an event without editing this file --
     * and so a test can assert the table's contents. */
    handlers: HANDLERS,
    clientId: function () { return CLIENT_ID; },
    ui: function () { return UI; }
  };

  window.TPEngine = api;
})();
