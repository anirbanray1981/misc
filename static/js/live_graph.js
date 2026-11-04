/*
 * TonePi — Guitar DSP Platform
 * Copyright (c) 2024-2026 Anirban Ray. All rights reserved.
 * Proprietary and confidential.
 *
 * Live graph editing.
 *
 * A structural edit -- add, remove, reorder, clear -- is pushed straight
 * to the running chain. That is only reasonable because a graph apply
 * costs microseconds; the Play button exists because a FAUST+g++ build
 * costs 5-20s, so a chain that the graph can serve has no use for it.
 *
 * Two rules this file keeps:
 *
 *   NOTHING IS SAVED. apply_live writes only the transient designer
 *   mirror; the preset on disk changes when the user presses Save and at
 *   no other time. Editing live and persisting stay separate decisions.
 *
 *   NEVER COMPILE BEHIND THE USER'S BACK. If the chain needs the compile
 *   path the endpoint says so and changes nothing, and Play comes back to
 *   do it explicitly. Auto-compiling on every keystroke would be worse
 *   than the button.
 */
(function (global) {
  'use strict';

  var DEBOUNCE_MS = 120;   // coalesce a drag or a burst of clicks
  var timer = null;
  var suspended = 0;
  var lastNeedsCompile = null;

  /* The two front-ends name their array differently -- desktop `chain`
   * (state.js), mobile `currentChain` (mobile-state.js).
   *
   * Read them as BARE IDENTIFIERS, not off `window`. A top-level `let`
   * lives in the global lexical environment and is NOT a property of
   * window, so `window.chain` is undefined however visible `chain`
   * is -- which made this silently see an empty editor and apply
   * nothing at all. (mobile's `var currentChain` does land on window,
   * so mobile would have worked and desktop would not: the worst kind
   * of half-working.)
   *
   * The helper is deliberately not called currentChain(), which would
   * shadow the mobile global. */
  function getChain() {
    try {
      if (typeof chain !== 'undefined' && Array.isArray(chain)) return chain;
    } catch (e) { /* not declared in this front-end */ }
    try {
      if (typeof currentChain !== 'undefined' && Array.isArray(currentChain))
        return currentChain;
    } catch (e) { /* not declared in this front-end */ }
    return null;
  }

  /* Play is meaningless for a chain the graph serves: the edit is already
   * audible by the time the button could be pressed. The desktop has no
   * Play / Stop any more; COMPILE & LOAD appears only for a chain the graph
   * cannot serve. Hidden on mobile likewise. */
  function reflectPlayButton(needsCompile) {
    if (needsCompile === lastNeedsCompile) return;
    lastNeedsCompile = needsCompile;

    var desktop = document.getElementById('btn-compile');
    if (desktop) desktop.style.display = needsCompile ? '' : 'none';

    var mobile = document.getElementById('ic-play');
    if (mobile) mobile.style.display = needsCompile ? '' : 'none';
  }

  /* The output stage is part of the chain: a limiter change must reach
   * the engine like any other edit. Omitted when it matches the default
   * so untouched chains keep their existing payload shape. */
  function _body(c, dry) {
    /* The output stage rides IN the chain as a sticky bus_master block,
     * so there is nothing to send alongside it.
     *
     * SERIALISED, not the editor's own objects. Those carry instanceId,
     * and the server keys everything on faust_id -- so every live edit
     * mirrored an id-less chain, the Qt panel read the gap as 0, and
     * Save As New stored six blocks all numbered 0. serializeChain() is
     * the same shape Play and Save send. Mobile's currentChain is already
     * in that shape and goes as it is. */
    var desktop = false;
    try { desktop = (typeof chain !== 'undefined' && c === chain); } catch (e) {}
    var b = { chain: (desktop && typeof serializeChain === 'function') ? serializeChain() : c };
    if (global.TPEngine && global.TPEngine.clientId) b.origin = global.TPEngine.clientId();   /* chain_notify.py */
    /* Which chain this is. After Clear the name field is empty and the
     * server records an untitled chain; without it, a chain built on a
     * cleared editor stayed "<previous preset> -- unsaved" and the
     * panel's Save would have overwritten that preset with it. */
    var cn = desktop ? document.getElementById('chain-name') : null;
    if (cn) b.name = cn.value.trim();
    if (dry) b.dry = true;
    return b;
  }

  /* Route to the chain the designer is editing.
   *
   * Hardcoded to chain 1, this made every live apply land on the guitar
   * engine regardless of which tab was open -- and since any render
   * schedules an apply, and switching tabs re-renders, selecting the
   * Vocals tab replaced the guitar chain with whatever the vocal side
   * held. Every other live-write path already reads activeChainTarget
   * (params.js _pushParamLive, chain.js bypass); this one pushes the
   * WHOLE chain and did not. */
  function _applyUrl() {
    if (typeof activeChainTarget !== 'undefined' && activeChainTarget === 3)
      return '/api/chain3/apply_live';          // the synth engine: the whole chain, in place
    return (typeof activeChainTarget !== 'undefined' && activeChainTarget === 2)
      ? '/api/chain2/apply_live'
      : '/api/chain/apply_live';
  }

  function post(body, cb) {
    fetch(_applyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .then(function (d) { if (cb) cb(d); })
      .catch(function () { /* engine down: leave Play as-is */ });
  }

  /* Ask whether Play is relevant WITHOUT applying. Used on page load: a
   * refresh should not silently re-push the chain to the engine. */
  function refreshPlayState() {
    var c = getChain();
    if (!c) return;
    post(_body(c, true), function (d) {
      reflectPlayButton(!!d.needs_compile);
    });
  }

  /* A rejected apply used to be INVISIBLE: the only response was
   * lighting up Play. That is fine for a structural edit -- you are
   * looking at the editor and Play appearing is a reasonable hint --
   * but it is wrong for anything that changes state the user believes
   * has taken effect. Switching a snapshot is the sharp case: the tab
   * goes active, the params redraw, and the engine carries on playing
   * the previous snapshot with nothing anywhere saying so.
   *
   * Toast once per DISTINCT reason. Repeating it on every debounce tick
   * of a slider drag would be its own bug, and the reason only changes
   * when the offending block/param does. */
  var lastReject = null;
  var lastNotice = null;

  function flush() {
    timer = null;
    var c = getChain();
    if (!c || suspended > 0) return;
    post(_body(c, false), function (d) {
      // graph=false means it was NOT applied -- the chain needs a compile,
      // so surface COMPILE rather than pretending it is live. Not when the
      // server says a compile would not help (an empty chain, a world that
      // is OFF): that is a notice, once per distinct one.
      reflectPlayButton(!d.graph && d.needs_compile !== false);
      if (d.notice && d.notice !== lastNotice) {
        lastNotice = d.notice;
        if (typeof showToast === 'function') showToast(d.notice, 'warn', 6000);
      }
      if (d.graph) lastNotice = null;

      if (d.graph) {
        lastReject = null;
        /* the time-FX set, a NAM model or an IR changed: re-audit (a plain
         * param tweak never does) */
        if (typeof RingAudit !== 'undefined' && typeof serializeChain === 'function')
          RingAudit.maybe(serializeChain());
        return;
      }

      var why = d.graph_reject || null;
      if (why && why !== lastReject) {
        lastReject = why;
        var msg = 'Not applied live — the graph cannot reproduce '
                + why + '. Press Compile & load.';
        if (typeof showToast === 'function') showToast(msg, 'warn', 7000);
        else if (typeof toast === 'function') toast(msg);
      }
    });
  }

  function schedule() {
    if (suspended > 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  /* Wrap an operation that mutates the chain many times (loading a
   * preset, undo of a batch) so it applies once at the end instead of
   * once per intermediate state -- an intermediate chain is a chain the
   * user never asked to hear. */
  function suspend() {
    suspended++;
    /* Cancel any debounce already in flight. The flag alone is not
     * enough: schedule() may have armed the timer moments earlier (a
     * user edit right before a hardware preset load), and flush() only
     * tests `suspended` when it FIRES -- by then resume() has cleared
     * it, so the push went out anyway. */
    if (timer) { clearTimeout(timer); timer = null; }
  }
  function resume(apply) {
    suspended = Math.max(0, suspended - 1);
    if (suspended === 0 && apply !== false) schedule();
  }

  global.LiveGraph = {
    schedule: schedule,
    refreshPlayState: refreshPlayState,
    suspend: suspend,
    resume: resume
  };

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(refreshPlayState, 800);   // after the editor restores state
  });
})(window);
