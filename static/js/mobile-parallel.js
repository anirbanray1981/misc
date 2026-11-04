/*
 * TonePi Mobile — Parallel routing node editor.
 * A parallel node is `{type:'parallel', lanes:[[block,...],...],
 * levels:[0..2,...]}` — same shape web/static/js/chain.js (desktop)
 * uses, so a chain built/edited here loads identically there.
 * Levels are LINEAR gain 0..2 (0=silent, 1=unity, 2≈+6dB), default
 * 1/N per lane, pushed live as FAUST param `lane_level_<instanceId>_
 * <laneIdx>` — same convention as desktop's showRoutingEditor().
 * Feedback nodes stay desktop-only (mobile-params.js's placeholder);
 * not built here.
 *
 * New chain items on mobile never get a client-side instanceId (see
 * mobile-palette.js's addBlockToChain) — the server assigns faust_id
 * at compile time. A freshly-added parallel node's level pushes fall
 * back to instanceId 0 until the first Save+Play, same accepted gap
 * regular block params already have.
 */

function addRoutingNodeToChain(routingId) {
  if (routingId !== '_parallel') return;
  var item = { type: 'parallel', lanes: [[], []], levels: [0.5, 0.5] };
  if (pendingInsertIndex !== null && pendingInsertIndex <= currentChain.length) {
    currentChain.splice(pendingInsertIndex, 0, item);
    selectedIdx = pendingInsertIndex;
  } else {
    currentChain.push(item);
    selectedIdx = currentChain.length - 1;
  }
  pendingInsertIndex = null;
  selectedLane = -1; selectedLaneBlock = -1;
  dirty = true;
  closeSheet('pal');
  renderChainLane();
  renderParamPanel(selectedIdx);
  updateHeader();
  toast('Added Parallel — tap + in a lane to add blocks.');
}

/* ── Parallel overview: mix-level sliders + per-lane block strips ── */
function renderParallelEditor(area, item, idx) {
  var hdr = document.createElement('div');
  hdr.className = 'param-block-hdr';
  hdr.innerHTML = '<div class="cat-spine" style="background:#8a5cff"></div>' +
    '<h2>Parallel</h2><span class="b-cat">' + item.lanes.length + ' path' + (item.lanes.length === 1 ? '' : 's') + '</span>';
  area.appendChild(hdr);

  if (!Array.isArray(item.levels) || item.levels.length !== item.lanes.length) {
    var n = item.lanes.length;
    item.levels = Array.from({ length: n }, function () { return 1 / n; });
  }

  var mixHdr = document.createElement('div');
  mixHdr.className = 'pal-cat';
  mixHdr.textContent = 'Lane Mix';
  area.appendChild(mixHdr);
  item.lanes.forEach(function (lane, li) {
    area.appendChild(buildParallelLevelRow(item, li));
  });

  item.lanes.forEach(function (lane, li) {
    var wrap = document.createElement('div');
    wrap.className = 'chain-lane-wrap';
    var labelRow = document.createElement('div');
    labelRow.className = 'chain-lane-label pal-lane-label-row';
    labelRow.innerHTML = '<span>Lane ' + (li + 1) + '</span>';
    if (item.lanes.length > 2) {
      var rm = document.createElement('button');
      rm.className = 'lane-rm-btn';
      rm.title = 'Remove lane';
      rm.innerHTML = '<svg class="ic"><use href="#ic-trash"/></svg>';
      rm.addEventListener('click', function () { removeParallelLane(idx, li); });
      labelRow.appendChild(rm);
    }
    wrap.appendChild(labelRow);
    var chipRow = document.createElement('div');
    chipRow.className = 'chain-lane';
    renderLaneChips(chipRow, item, idx, li);
    wrap.appendChild(chipRow);
    area.appendChild(wrap);
  });

  if (item.lanes.length < PARALLEL_MAX_LANES) {
    var addBtn = document.createElement('button');
    addBtn.className = 'add-lane-btn';
    addBtn.innerHTML = '<svg class="ic"><use href="#ic-add"/></svg><span>Add Lane</span>';
    addBtn.addEventListener('click', function () { addParallelLane(idx); });
    area.appendChild(addBtn);
  }

  var pad = document.createElement('div');
  pad.style.height = '24px';
  area.appendChild(pad);
}

function buildParallelLevelRow(item, laneIdx) {
  var val = item.levels[laneIdx];
  var min = 0, max = 2, step = 0.01;
  var row = document.createElement('div');
  row.className = 'param-row';
  var pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  row.innerHTML =
    '<div class="p-label-row"><span class="p-label">Lane ' + (laneIdx + 1) + '</span>' +
    '<span class="p-val mono">' + val.toFixed(2) + '</span></div>' +
    '<div class="fader"><div class="fader-track"></div><div class="fader-fill" style="width:' + pct + '%"></div>' +
    '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"></div>';
  var valSpan = row.querySelector('.p-val');
  var fill = row.querySelector('.fader-fill');
  var range = row.querySelector('input[type=range]');
  range.addEventListener('input', function () {
    var v = parseFloat(range.value);
    item.levels[laneIdx] = v;
    var pc = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
    fill.style.width = pc + '%';
    valSpan.textContent = v.toFixed(2);
    /* Lane levels are not block-scoped params -- the core has a form
     * for them, and debounces them like any other. */
    TPEngine.setLaneLevel(item.instanceId, laneIdx, v);
  });
  return row;
}

function addParallelLane(idx) {
  var item = currentChain[idx];
  if (!item || item.lanes.length >= PARALLEL_MAX_LANES) return;
  item.lanes.push([]);
  var n = item.lanes.length;
  item.levels = Array.from({ length: n }, function () { return 1 / n; });
  dirty = true;
  renderChainLane();
  renderParamPanel(idx);
  updateHeader();
}
function removeParallelLane(idx, laneIdx) {
  var item = currentChain[idx];
  if (!item || item.lanes.length <= 2) return;
  item.lanes.splice(laneIdx, 1);
  if (Array.isArray(item.levels)) item.levels.splice(laneIdx, 1);
  if (selectedIdx === idx) {
    if (selectedLane === laneIdx) { selectedLane = -1; selectedLaneBlock = -1; }
    else if (selectedLane > laneIdx) selectedLane--;
  }
  dirty = true;
  renderChainLane();
  renderParamPanel(idx);
  updateHeader();
}

/* ── Lane block chips — mirrors mobile-chain.js's renderChainLane() ── */
function renderLaneChips(container, item, pIdx, laneIdx) {
  var lane = item.lanes[laneIdx];
  container.dataset.dropContainer = 'lane:' + pIdx + ':' + laneIdx;
  lane.forEach(function (block, bIdx) {
    var d = describeChainItem(block);
    var chip = document.createElement('div');
    var sel = (selectedIdx === pIdx && selectedLane === laneIdx && selectedLaneBlock === bIdx) ? ' selected' : '';
    chip.className = 'block-chip' + sel + (block.disabled ? ' bypassed' : '');
    chip.style.setProperty('--chip-color', d.color);
    chip.innerHTML = '<span class="bypass-dot"></span>' +
      '<div class="b-name">' + escapeHtml(d.name) + '</div><div class="b-cat">' + escapeHtml(d.cat) + '</div>' +
      '<span class="chip-handle" title="Drag to move"></span>';
    chip.addEventListener('click', function () { selectLaneBlock(pIdx, laneIdx, bIdx); });
    var dot = chip.querySelector('.bypass-dot');
    dot.addEventListener('click', function (ev) { ev.stopPropagation(); toggleLaneBypass(pIdx, laneIdx, bIdx); });
    attachDraggable(chip, 'lane:' + pIdx + ':' + laneIdx, bIdx, function () { openLaneActionSheet(pIdx, laneIdx, bIdx); });
    container.appendChild(chip);
  });
  var addChip = document.createElement('div');
  addChip.className = 'add-chip';
  addChip.innerHTML = '<svg class="ic"><use href="#ic-add"/></svg>';
  addChip.addEventListener('click', function () { insertAtLane(pIdx, laneIdx, lane.length); });
  container.appendChild(addChip);
}

function selectLaneBlock(pIdx, laneIdx, bIdx) {
  selectedIdx = pIdx; selectedLane = laneIdx; selectedLaneBlock = bIdx;
  renderChainLane();
  renderParamPanel(pIdx);
}

function toggleLaneBypass(pIdx, laneIdx, bIdx) {
  var block = currentChain[pIdx] && currentChain[pIdx].lanes[laneIdx][bIdx];
  if (!block) return;
  block.disabled = !block.disabled;
  var fid = block.faust_id || block.instanceId || 0;
  fetch('/api/chain/bypass', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block_id: block.block, instance: fid, bypassed: block.disabled })
  }).catch(function (e) { toast('Bypass failed: ' + e.message); });
  renderChainLane();
  if (selectedIdx === pIdx && selectedLane === laneIdx && selectedLaneBlock === bIdx) renderParamPanel(pIdx);
}

/* ── Lane block action sheet: same shape as mobile-chain.js's
 * openActionSheet(), targeting `item.lanes[laneIdx]` instead of
 * currentChain. Reuses the same #actSheet/#actBody DOM. ── */
function openLaneActionSheet(pIdx, laneIdx, bIdx) {
  var item = currentChain[pIdx];
  var lane = item && item.lanes[laneIdx];
  var block = lane && lane[bIdx];
  if (!block) return;
  var d = describeChainItem(block);
  var atStart = bIdx === 0;
  var atEnd = bIdx === lane.length - 1;
  document.getElementById('actTitle').textContent = d.name + ' (Lane ' + (laneIdx + 1) + ')';
  var rows = '';
  rows += actionRowHtml('ic-insert-l', 'Insert Left', 'insertAtLane(' + pIdx + ',' + laneIdx + ',' + bIdx + ')');
  rows += actionRowHtml('ic-insert-r', 'Insert Right', 'insertAtLane(' + pIdx + ',' + laneIdx + ',' + (bIdx + 1) + ')');
  rows += actionRowHtml('ic-chevron-l', 'Move Left', 'moveLaneBlock(' + pIdx + ',' + laneIdx + ',' + bIdx + ',-1)', atStart);
  rows += actionRowHtml('ic-chevron-r', 'Move Right', 'moveLaneBlock(' + pIdx + ',' + laneIdx + ',' + bIdx + ',1)', atEnd);
  rows += actionRowHtml('ic-dup', 'Duplicate', 'duplicateLaneBlockAt(' + pIdx + ',' + laneIdx + ',' + bIdx + ')');
  rows += actionRowHtml('ic-trash', 'Remove', 'removeLaneBlockAt(' + pIdx + ',' + laneIdx + ',' + bIdx + ')', false, true);
  document.getElementById('actBody').innerHTML = rows;
  openSheet('act');
}
function moveLaneBlock(pIdx, laneIdx, bIdx, dir) {
  var lane = currentChain[pIdx].lanes[laneIdx];
  var j = bIdx + dir;
  if (j < 0 || j >= lane.length) return;
  var tmp = lane[bIdx]; lane[bIdx] = lane[j]; lane[j] = tmp;
  selectedIdx = pIdx; selectedLane = laneIdx; selectedLaneBlock = j;
  dirty = true;
  renderChainLane();
  renderParamPanel(pIdx);
  updateHeader();
}
function duplicateLaneBlockAt(pIdx, laneIdx, bIdx) {
  var lane = currentChain[pIdx].lanes[laneIdx];
  var src = lane[bIdx];
  if (!src) return;
  var copy = JSON.parse(JSON.stringify(src));
  delete copy.instanceId; delete copy.faust_id;
  lane.splice(bIdx + 1, 0, copy);
  selectedIdx = pIdx; selectedLane = laneIdx; selectedLaneBlock = bIdx + 1;
  dirty = true;
  renderChainLane();
  renderParamPanel(pIdx);
  updateHeader();
}
function removeLaneBlockAt(pIdx, laneIdx, bIdx) {
  var lane = currentChain[pIdx].lanes[laneIdx];
  lane.splice(bIdx, 1);
  if (selectedIdx === pIdx && selectedLane === laneIdx) {
    if (selectedLaneBlock === bIdx) { selectedLane = -1; selectedLaneBlock = -1; }
    else if (selectedLaneBlock > bIdx) selectedLaneBlock--;
  }
  dirty = true;
  renderChainLane();
  renderParamPanel(pIdx);
  updateHeader();
}
function insertAtLane(pIdx, laneIdx, insertAt) {
  pendingLaneInsert = { parentIdx: pIdx, laneIdx: laneIdx, insertAt: insertAt };
  pendingInsertIndex = null;
  openAddBlock();
}
