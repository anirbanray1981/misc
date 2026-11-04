/*
 * TonePi Mobile — shared state + boot-critical utilities.
 * Global scope, loaded first (mirrors desktop's state.js): chain
 * state, block registry, tab/sheet chrome, toasts. Every other
 * mobile-*.js file depends on this one being loaded first.
 */

var currentChain = [];
var chainSource = 'none';
var chainName = null;
var selectedIdx = -1;
var selectedLane = -1;        // lane index within the selected parallel node, -1 = none
var selectedLaneBlock = -1;   // block index within that lane
var pendingLaneInsert = null; // {parentIdx, laneIdx, insertAt} | null — consumed by addBlockToChain
var ROUTING_NODES = [
  { id: '_parallel', name: 'Parallel', icon: '⫽', desc: 'Split into paths, process independently, mix back together' }
];
var PARALLEL_MAX_LANES = 3;  // matches desktop's cap (web/static/js/chain.js)
var dirty = false;
var playing = false;
var busy = false;
var masterMuted = false;  // TonePi guitar master mute — real state read from
                          // /api/chain/master_mute + live /ws/meters pushes,
                          // not owned solely by this button (see mobile-ws.js)

var blockDefsById = {};   // id -> { <version>: def, _cat, _first }
var blocksByCategory = {};

var toastTimer = null;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function toast(msg, ms) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2800);
}

/* ── Tabs ── Scoped to #app-tonepi: with the Zynthian app merged into
 * this same page (setAppMode(), below), an unscoped `.screen`/
 * `.tabbar button` query here would also deactivate whichever
 * Zynthian screen/tab happened to be active — invisible while
 * #app-zynthian is display:none, but it'd come back blank on the
 * next flip since nothing would carry the `.active` class anymore. */
function setTab(name) {
  document.querySelectorAll('#app-tonepi .screen').forEach(function (s) { s.classList.remove('active'); });
  document.getElementById('scr-' + name).classList.add('active');
  document.querySelectorAll('#app-tonepi .tabbar button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  /* Saved-chain list + block presets can change from other sources —
   * re-render lazily on switch-to rather than caching stale content. */
  if (name === 'presets' && typeof renderPresetsView === 'function') renderPresetsView();
  if (name === 'system' && typeof renderBankList === 'function') renderBankList();
}

/* ── Sheets ── */
function openSheet(which) {
  document.getElementById(which + 'Backdrop').classList.add('show');
  document.getElementById(which + 'Sheet').classList.add('show');
}
function closeSheet(which) {
  document.getElementById(which + 'Backdrop').classList.remove('show');
  document.getElementById(which + 'Sheet').classList.remove('show');
}

/* Generic action-list row, shared by the block-action sheet
 * (mobile-chain.js) and the saved-chain context menu (mobile-presets.js)
 * — both reuse the same #actSheet markup. `keepOpen` skips the
 * auto-close for rows that navigate to a submenu within the same
 * sheet instead of performing an action (e.g. "Move to Group…"). */
function actionRowHtml(icon, label, onclick, disabled, danger, keepOpen) {
  var cls = 'action-row' + (disabled ? ' disabled' : '') + (danger ? ' danger' : '');
  var tail = keepOpen ? '' : ';closeSheet(\'act\')';
  return '<div class="' + cls + '" onclick="' + (disabled ? '' : onclick + tail) + '">' +
    '<svg class="ic"><use href="#' + icon + '"/></svg><span>' + label + '</span></div>';
}

/* Collapsible group: a sticky header (chevron, optional count) that
 * toggles a following content container. Shared by the Presets tab's
 * saved-chain families and per-block preset lists. `startCollapsed`
 * renders it closed initially (block presets default to this — one
 * per chain block, so several stack up before the user asks for any
 * of them). */
function collapsibleGroup(label, count, startCollapsed) {
  var hdr = document.createElement('div');
  hdr.className = 'subcat-hdr collapsible' + (startCollapsed ? ' collapsed' : '');
  hdr.innerHTML = '<span>' + escapeHtml(label) + '</span>' +
    (count != null ? '<span class="subcat-count">(' + count + ')</span>' : '') +
    '<svg class="ic"><use href="#ic-chevron-r"/></svg>';
  var body = document.createElement('div');
  body.className = 'subcat-body' + (startCollapsed ? ' collapsed' : '');
  hdr.addEventListener('click', function () {
    hdr.classList.toggle('collapsed');
    body.classList.toggle('collapsed');
  });
  return { header: hdr, body: body };
}

/* Long-press (touch) — opens a menu the same way desktop's right-click
 * does. Shared trigger family across chain chips (mobile-chain.js),
 * bank rows (mobile-banks.js), and the Zynthian screens (zynm-*.js).
 * Bakes in the `contextmenu` (desktop right-click) listener too, so
 * callers don't need a separate explicit one alongside this call. */
var LONG_PRESS_MS = 480;
function attachLongPress(el, cb) {
  var timer = null;
  el.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    timer = setTimeout(function () { timer = null; cb(); }, LONG_PRESS_MS);
  });
  ['pointerup', 'pointerleave', 'pointermove'].forEach(function (evt) {
    el.addEventListener(evt, function () { if (timer) { clearTimeout(timer); timer = null; } });
  });
  el.addEventListener('contextmenu', function (e) { e.preventDefault(); cb(); });
}

function sectionHeader(label) {
  var h = document.createElement('div');
  h.className = 'pal-cat';
  h.textContent = label;
  return h;
}
function emptyNote(text) {
  var d = document.createElement('div');
  d.className = 'of-item';
  d.style.color = 'var(--text-dim)';
  d.textContent = text;
  return d;
}
/* Escape a string for embedding inside a single-quoted inline
 * onclick="..." attribute (row builders across presets/banks pass
 * chain/bank names this way rather than closing over DOM listeners,
 * matching the existing actionRowHtml() idiom). */
function esc1(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

/* Set by Banks' "assign slot" flow (mobile-banks.js) to redirect the
 * Presets tab's saved-chain row tap from "open action sheet" to
 * "assign this chain to the pending slot" — cross-scope hand-off, so
 * it lives here rather than in either single-scope file. */
var pendingBankSlotAssign = null;  // {bankIdx, slotIdx} | null

/* ── App mode flip (TonePi / Zynthian) ──
 * Two whole apps live in this one page now (#app-tonepi / #app-zynthian,
 * each with its own tabbar/screens/sheets) — this just swaps which one
 * is visible and persists the choice. The Zynthian side starts a 2s
 * live-state poll against the real Zynthian engine (zynm-state.js);
 * that poll has no reason to run while the user is in TonePi mode, so
 * it's started lazily on first entry and paused/resumed on every flip
 * rather than firing unconditionally on page load. */
function setAppMode(mode) {
  if (mode !== 'zynthian') mode = 'tonepi';
  var showZyn = mode === 'zynthian';
  document.getElementById('app-tonepi').style.display = showZyn ? 'none' : 'flex';
  document.getElementById('app-zynthian').style.display = showZyn ? 'flex' : 'none';
  document.querySelectorAll('#modeToggle button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  localStorage.setItem('tonepi-mobile-mode', mode);
  if (showZyn) {
    if (typeof initZynApp === 'function') initZynApp();
    if (typeof startLivePoll === 'function') startLivePoll();
    if (typeof refreshLiveState === 'function') refreshLiveState();
  } else if (typeof livePollTimer !== 'undefined' && livePollTimer) {
    clearInterval(livePollTimer);
    livePollTimer = null;
  }
}

/* ── Block registry (GET /api/blocks) ── */
function loadBlocks() {
  return fetch('/api/blocks').then(function (res) { return res.json(); }).then(function (data) {
    blockDefsById = {};
    blocksByCategory = data || {};
    Object.keys(blocksByCategory).forEach(function (cat) {
      (blocksByCategory[cat] || []).forEach(function (b) {
        if (!blockDefsById[b.id]) blockDefsById[b.id] = {};
        var entry = blockDefsById[b.id];
        var ver = b.version || 1;
        entry[ver] = b;
        entry._cat = entry._cat || cat;
        entry._first = entry._first || b;
      });
    });
    renderCatList();
  }).catch(function (e) {
    toast('Could not load block list: ' + e.message);
  });
}

function findDef(item) {
  if (!item || !item.block) return null;
  var entry = blockDefsById[item.block];
  if (!entry) return null;
  if (item.version && entry[item.version]) return entry[item.version];
  return entry._first || null;
}
function categoryOf(item) {
  var entry = item && item.block ? blockDefsById[item.block] : null;
  return entry ? entry._cat : '';
}

/* Walk every chain item including nested parallel-lane / feedback-path
 * blocks — shared by the /ws/events handlers (mobile-ws.js) and the
 * Presets tab's block-preset scan (mobile-presets.js). */
function walkChainItems(items, fn) {
  items.forEach(function (it) {
    if (!it || typeof it !== 'object') return;
    fn(it);
    if (it.type === 'parallel' && Array.isArray(it.lanes)) {
      it.lanes.forEach(function (lane) { walkChainItems(lane, fn); });
    } else if (it.type === 'feedback') {
      if (Array.isArray(it.forward)) walkChainItems(it.forward, fn);
      if (Array.isArray(it.feedback)) walkChainItems(it.feedback, fn);
    }
  });
}

/* Shared by the Designer chain lane and other views that need the
 * same name/color/category for any chain item (block or
 * parallel/feedback routing node). */
function describeChainItem(item) {
  var isRouting = item.type === 'parallel' || item.type === 'feedback';
  var def = isRouting ? null : findDef(item);
  return {
    isRouting: isRouting,
    def: def,
    color: def ? def.color : '#6a6a80',
    name: def ? def.name : (isRouting ? (item.type === 'parallel' ? 'Parallel' : 'Feedback') : (item.block || 'Block')),
    cat: isRouting ? 'Routing' : (categoryOf(item) || '')
  };
}

/* ── Chain state (GET /api/chain/current) ── */
/* SYNC FROM the engine, never push back to it.
 *
 * Every call site (boot, and the WS chain_loaded handler in
 * mobile-ws.js) is reading state the engine already has, not writing
 * new state to it. renderChainLane() ends in LiveGraph.schedule(),
 * so without this guard the sync itself re-POSTed whatever was
 * already playing as a fresh designer edit -- on boot that meant every
 * page load silently re-applied the current chain, and on a hardware
 * load it relabelled the running preset "Designer" out from under the
 * name that was just correctly reported. suspend()/resume() nest
 * safely, so a caller that already wraps its own call (mobile-ws.js
 * does, for its own unrelated bank-highlight refresh) does not
 * double-release. */
/* Sync FROM the engine. The whole body now lives in tp_engine.js --
 * including the suspend guard, which is the part that had to be
 * repeated in three files and still missed loadNamedChain. */
function loadChain() {
  document.getElementById('hdrChainName').textContent = 'Loading…';
  return TPEngine.loadCurrent().then(function (d) {
    if (!d) {
      document.getElementById('hdrChainName').textContent = 'Offline';
      document.getElementById('hdrChainSub').textContent = 'Could not reach the Pi';
    }
    return d;
  });
}

/* Snapshot switcher.
 *
 * Same shared model the desktop uses (tp_snapshots.js), so switching
 * from the phone captures the outgoing snapshot, applies the incoming
 * one, re-pushes any shm-backed block presets and tells the engine
 * which is live -- identical behaviour, not a second implementation. */
function renderSnapshotSelect() {
  var sel = document.getElementById('mobSnapSelect');
  if (!sel || typeof TPSnapshots === 'undefined') return;
  var list = TPSnapshots.list();
  if (!list || list.length < 2) { sel.style.display = 'none'; return; }
  sel.style.display = '';
  var sig = list.map(function (s, i) { return (i + 1) + '. ' + (s.name || 'Snapshot'); }).join('\u0000');
  if (sel.dataset.sig !== sig) {
    sel.innerHTML = '';
    list.forEach(function (s, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = (i + 1) + '. ' + (s.name || 'Snapshot');
      sel.appendChild(o);
    });
    sel.dataset.sig = sig;
  }
  sel.value = String(TPSnapshots.active());
}

function mobSwitchSnapshot(idx) {
  if (typeof TPSnapshots === 'undefined') return;
  if (!TPSnapshots.switchTo(idx)) { renderSnapshotSelect(); return; }
  renderChainLane();
  renderParamPanel(selectedIdx);
  updateHeader();
  renderSnapshotSelect();
  var sn = TPSnapshots.list()[idx];
  toast('Snapshot: ' + ((sn && sn.name) || (idx + 1)));
}

function updateHeader() {
  var nameEl = document.getElementById('hdrChainName');
  var subEl = document.getElementById('hdrChainSub');
  if (currentChain.length === 0 && !dirty && chainSource === 'none') {
    nameEl.textContent = 'No chain loaded';
    subEl.textContent = 'Add a block below to get started';
    subEl.classList.remove('dirty');
    return;
  }
  nameEl.textContent = chainName || (currentChain.length ? 'Untitled Chain' : 'Empty Chain');
  var blockCount = currentChain.filter(function (i) { return i.type === 'block'; }).length;
  var nested = currentChain.length - blockCount;
  var sub = blockCount + ' block' + (blockCount === 1 ? '' : 's');
  if (nested) sub += ' + ' + nested + ' routing node' + (nested === 1 ? '' : 's');
  if (dirty) sub += ' • unsaved';
  subEl.textContent = sub;
  subEl.classList.toggle('dirty', dirty);
}
