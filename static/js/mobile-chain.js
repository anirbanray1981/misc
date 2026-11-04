/*
 * TonePi Mobile — chain lane + block-action sheet.
 * Rendering the chain-lane chips, selection, bypass, and the
 * long-press (mobile) / right-click (desktop parity) block-action
 * sheet: insert-before/after, move, duplicate, remove. Also the
 * Chain overflow menu's Save/Clear (chain lifecycle, same scope).
 */

var pendingInsertIndex = null;  // set by Insert Left/Right, consumed by addBlockToChain()
var actionIdx = null;           // which chain index the open block-action sheet targets

/* ── Chain lane ── */
/* Keep the output stage present and last. Same reasoning as the desktop
 * editor's pinStickyBlocks(): every structural edit redraws through this
 * function, so pinning here cannot be bypassed by a future sixth way to
 * mutate the chain. A cleared chain still gets one -- see chain.js. */
function pinStickyBlocks() {
  if (!Array.isArray(currentChain)) return;
  // A cleared chain still gets one -- see chain.js's pinStickyBlocks.
  var i = -1, k;
  for (k = 0; k < currentChain.length; k++)
    if (isStickyBlock(currentChain[k])) { i = k; break; }
  if (i < 0) {
    currentChain.push({ type: 'block', block: 'bus_master', version: 1,
                        stereo: true, disabled: false,
                        params: { ceiling_db: -1.0 } });
  } else if (i !== currentChain.length - 1) {
    currentChain.push(currentChain.splice(i, 1)[0]);
    if (selectedIdx === i) selectedIdx = currentChain.length - 1;
    else if (selectedIdx > i) selectedIdx--;
  }
}

function renderChainLane() {
  pinStickyBlocks();
  var lane = document.getElementById('chainLane');
  lane.innerHTML = '';
  /* Same hook as the desktop editor: every structural edit redraws
   * through here, so the running graph tracks the screen. Debounced, and
   * a no-op for a chain that still needs the compile path. */
  if (window.LiveGraph) LiveGraph.schedule();
  currentChain.forEach(function (item, idx) {
    var d = describeChainItem(item);

    var chip = document.createElement('div');
    chip.className = 'block-chip' + (idx === selectedIdx ? ' selected' : '') + (item.disabled ? ' bypassed' : '');
    chip.style.setProperty('--chip-color', d.color);
    chip.innerHTML = '<span class="bypass-dot"></span>' +
      '<div class="b-name">' + escapeHtml(d.name) + '</div><div class="b-cat">' + escapeHtml(d.cat) + '</div>' +
      '<span class="chip-handle" title="Drag to move"></span>';
    chip.addEventListener('click', function () { selectBlock(idx); });
    if (!d.isRouting) {
      var dot = chip.querySelector('.bypass-dot');
      dot.addEventListener('click', function (ev) { ev.stopPropagation(); toggleBypass(idx); });
    }
    attachDraggable(chip, 'chain', idx, function () { openActionSheet(idx); });
    lane.appendChild(chip);
  });
  var addChip = document.createElement('div');
  addChip.className = 'add-chip';
  addChip.innerHTML = '<svg class="ic"><use href="#ic-add"/></svg>';
  addChip.addEventListener('click', function () { pendingInsertIndex = null; pendingLaneInsert = null; openAddBlock(); });
  lane.appendChild(addChip);
}

/* ── Block-action sheet: insert-before/after, move, duplicate, remove.
 * Bypass stays on the chip itself (most frequent action, not buried
 * in the menu). Routing nodes (parallel/feedback) only get Remove —
 * insert/move/duplicate assume a flat `type:'block'` item shape. */
/* The output stage is sticky: in every chain, pinned last, removable
 * from nowhere. Bypass still works -- and bypassing is the intended way
 * to hear the chain unlimited. */
function isStickyBlock(item) {
  return !!item && item.type !== 'parallel' && item.type !== 'feedback'
         && item.block === 'bus_master';
}

function openActionSheet(idx) {
  var item = currentChain[idx];
  if (!item) return;
  var sticky = isStickyBlock(item);
  actionIdx = idx;
  var d = describeChainItem(item);
  var atStart = idx === 0;
  var atEnd = idx === currentChain.length - 1;
  document.getElementById('actTitle').textContent = d.name;
  var rows = '';
  if (!d.isRouting) {
    rows += actionRowHtml('ic-insert-l', 'Insert Left', 'insertAt(' + idx + ')');
    // Nothing may be inserted after the output stage, or moved past it:
    // anything there would be processing post-limiter.
    rows += actionRowHtml('ic-insert-r', 'Insert Right',
                          'insertAt(' + (idx + 1) + ')', sticky);
    rows += actionRowHtml('ic-chevron-l', 'Move Left',
                          'moveBlock(' + idx + ',-1)', atStart || sticky);
    rows += actionRowHtml('ic-chevron-r', 'Move Right',
                          'moveBlock(' + idx + ',1)', atEnd || sticky);
    rows += actionRowHtml('ic-dup', 'Duplicate',
                          'duplicateBlock(' + idx + ')', sticky);
  }
  rows += actionRowHtml('ic-trash', 'Remove', 'removeBlockAt(' + idx + ')',
                        sticky, true);
  document.getElementById('actBody').innerHTML = rows;
  openSheet('act');
}
function moveBlock(idx, dir) {
  var j = idx + dir;
  if (j < 0 || j >= currentChain.length) return;
  // Neither move the output stage nor swap another block into its slot.
  if (isStickyBlock(currentChain[idx]) || isStickyBlock(currentChain[j])) return;
  var tmp = currentChain[idx]; currentChain[idx] = currentChain[j]; currentChain[j] = tmp;
  selectedIdx = j;
  dirty = true;
  renderChainLane();
  renderParamPanel(selectedIdx);
  updateHeader();
}
function duplicateBlock(idx) {
  var item = currentChain[idx];
  if (!item || item.type !== 'block') return;
  var copy = JSON.parse(JSON.stringify(item));
  delete copy.instanceId; delete copy.faust_id;
  currentChain.splice(idx + 1, 0, copy);
  selectedIdx = idx + 1;
  dirty = true;
  renderChainLane();
  renderParamPanel(selectedIdx);
  updateHeader();
}
function removeBlockAt(idx) {
  // The action row is greyed out, but guard the function too: drag and
  // other call sites reach it without going through the sheet.
  if (isStickyBlock(currentChain[idx])) {
    if (typeof toast === 'function')
      toast('Output stage cannot be removed \u2014 bypass it instead');
    return;
  }
  currentChain.splice(idx, 1);
  if (selectedIdx === idx) selectedIdx = currentChain.length ? Math.min(idx, currentChain.length - 1) : -1;
  else if (selectedIdx > idx) selectedIdx--;
  dirty = true;
  renderChainLane();
  renderParamPanel(selectedIdx);
  updateHeader();
}
function insertAt(idx) {
  pendingInsertIndex = idx;
  pendingLaneInsert = null;
  openAddBlock();
}

function selectBlock(idx) {
  selectedIdx = idx;
  selectedLane = -1; selectedLaneBlock = -1;
  renderChainLane();
  renderParamPanel(idx);
}

function toggleBypass(idx) {
  var item = currentChain[idx];
  if (!item || item.type !== 'block') return;
  item.disabled = !item.disabled;
  var fid = item.faust_id || item.instanceId || 0;
  fetch('/api/chain/bypass', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block_id: item.block, instance: fid, bypassed: item.disabled })
  }).catch(function (e) { toast('Bypass failed: ' + e.message); });
  renderChainLane();
  if (idx === selectedIdx) renderParamPanel(idx);
}

/* ── Master mute — real state lives in audio_engine.c, not this button:
 * the physical Source Switch and a running Song's entry/exit hooks can
 * also change it. This POST is fire-and-forget; updateMasterMuteUI()
 * (mobile-ws.js) is the single place the icon actually gets set, driven
 * by the shm-backed GET below (page load) and /ws/meters (live, every
 * path). ── */
function fetchMasterMute() {
  fetch('/api/chain/master_mute').then(function (r) { return r.json(); })
    .then(function (d) { updateMasterMuteUI(!!d.muted); })
    .catch(function () { /* ws will catch us up once connected */ });
}
function toggleMasterMute() {
  var next = !masterMuted;
  fetch('/api/chain/master_mute', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted: next })
  }).catch(function (e) { toast('Mute toggle failed: ' + e.message); });
  updateMasterMuteUI(next);  // optimistic — the shm/ws readback confirms or corrects
}

/* ── Chain menu (Save / Clear; rest explicitly out of scope) ── */
function saveChain() {
  closeSheet('of');
  var name = chainName;
  if (!name) {
    name = prompt('Save chain as:');
    if (!name) return;
  }
  fetch('/api/chains/' + encodeURIComponent(name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain: currentChain })
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
      chainName = name;
      dirty = false;
      updateHeader();
      toast('Saved "' + name + '"');
    });
  }).catch(function (e) { toast('Save failed: ' + e.message); });
}

function clearChain() {
  closeSheet('of');
  if (!confirm('Clear the entire chain?')) return;
  currentChain = [];
  chainName = null;
  selectedIdx = -1;
  dirty = true;
  renderChainLane();
  renderParamPanel(-1);
  updateHeader();
  toast('Chain cleared locally — tap Play to apply, or Save to persist.');
}
