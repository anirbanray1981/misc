/*
 * ZynEditor Mobile — Rack tab: chain selector strip + the selected
 * chain's processor rack (MIDI FX / Synth / Audio FX slot cards,
 * parallel groups), chain-level and processor-level action sheets,
 * add-processor flow.
 *
 * Action sets are trimmed to what the real backend actually supports
 * (verified against zyn_editor/zyn_inject.py) — no Clone Chain, no
 * Clone/Bypass Processor: those endpoints don't exist server-side.
 * Chain: Make Active, Set MIDI Channel, Delete (chain 0 is protected).
 * Processor: Move Up, Move Down, Delete.
 */

function renderChainStrip() {
  var strip = document.getElementById('chainStrip');
  if (!strip || !liveState) return;
  strip.innerHTML = '';
  var chains = liveState.chains || [];
  chains.forEach(function (c) {
    var chip = document.createElement('div');
    chip.className = 'chain-chip' + (c.chain_id === selectedChainId ? ' sel' : '');
    var num = c.midi_chan != null ? ('CH ' + c.midi_chan) : 'AUDIO FX';
    chip.innerHTML = '<span class="c-num">' + escapeHtml(num) + '</span>' +
      '<span class="c-name">' + escapeHtml(c.title || ('Chain ' + c.chain_id)) + '</span>' +
      (c.chain_id === liveState.active_chain_id ? '<span class="c-recv"></span>' : '');
    chip.addEventListener('click', function () { selectChain(c.chain_id); });
    attachLongPress(chip, function () { openChainActionSheet(c.chain_id); });
    strip.appendChild(chip);
  });
  var addChip = document.createElement('div');
  addChip.className = 'add-chip';
  addChip.innerHTML = '<svg class="ic"><use href="#ic-add"/></svg>';
  addChip.addEventListener('click', addChainPrompt);
  strip.appendChild(addChip);
}

function selectChain(cid) {
  selectedChainId = cid;
  renderChainStrip();
  renderRack();
}

function findChain(cid) {
  return (liveState && liveState.chains || []).filter(function (c) { return c.chain_id === cid; })[0] || null;
}
function procOf(pid) {
  return (liveState && liveState.processors) ? liveState.processors[pid] : null;
}

function renderRack() {
  var scroll = document.getElementById('rackScroll');
  var fab = document.getElementById('rackFab');
  if (!scroll) return;
  var chain = findChain(selectedChainId);
  if (!chain) {
    scroll.innerHTML = '<div class="placeholder"><svg class="ic"><use href="#ic-rack"/></svg><p>No chains yet — tap + above to add one.</p></div>';
    if (fab) fab.style.display = 'none';
    return;
  }
  if (fab) fab.style.display = '';
  scroll.innerHTML = '';
  var cards = [
    ['MIDI FX', chain.midi_slots],
    ['Synth', chain.synth_slots],
    ['Audio FX', chain.audio_slots]
  ];
  var any = false;
  cards.forEach(function (pair) {
    var label = pair[0], slots = pair[1] || [];
    var nonEmpty = slots.filter(function (grp) { return grp && grp.length; });
    if (!nonEmpty.length) return;
    any = true;
    var card = document.createElement('div');
    card.className = 'slot-card';
    var hdr = document.createElement('div');
    hdr.className = 'slot-card-hdr';
    hdr.textContent = label;
    card.appendChild(hdr);
    var body = document.createElement('div');
    body.className = 'slot-card-body';
    nonEmpty.forEach(function (group) {
      if (group.length > 1) {
        var pgrp = document.createElement('div');
        pgrp.className = 'parallel-group';
        pgrp.innerHTML = '<div class="parallel-label"><svg class="ic"><use href="#ic-branch"/></svg>Parallel</div>';
        group.forEach(function (pid) { pgrp.appendChild(procRowEl(pid, chain)); });
        body.appendChild(pgrp);
      } else {
        body.appendChild(procRowEl(group[0], chain));
      }
    });
    card.appendChild(body);
    scroll.appendChild(card);
  });
  if (!any) {
    scroll.innerHTML = '<div class="placeholder"><svg class="ic"><use href="#ic-rack"/></svg><p>Empty chain — tap + Processor below to add one.</p></div>';
  }
}

function procRowEl(pid, chain) {
  var p = procOf(pid);
  var row = document.createElement('div');
  row.className = 'proc-row';
  var name = p ? (p.name || p.eng_code || ('#' + pid)) : ('#' + pid);
  var preset = p && p.preset_name ? p.preset_name : '';
  row.innerHTML = '<span class="proc-dot"></span>' +
    '<div class="proc-body"><div class="proc-name">' + escapeHtml(name) + '</div>' +
    (preset ? '<div class="proc-preset">' + escapeHtml(preset) + '</div>' : '') + '</div>' +
    '<svg class="ic proc-chevron"><use href="#ic-chevron-r"/></svg>';
  row.addEventListener('click', function () { openInspector(pid, chain); });
  attachLongPress(row, function () { openProcActionSheet(pid, chain); });
  return row;
}

/* ── Chain actions ── */
function openChainActionSheet(cid) {
  var chain = findChain(cid);
  if (!chain) return;
  document.getElementById('chainActTitle').textContent = chain.title || ('Chain ' + cid);
  var isActive = cid === liveState.active_chain_id;
  var isMain = cid === 0;
  var rows = '';
  rows += actionRow('ic-play', 'Make Active (MIDI Receive)', 'setChainActive(' + cid + ')', { sheet: 'chainAct', disabled: isActive });
  rows += actionRow('ic-chevron-r', 'Set MIDI Channel…', 'setMidiChanPrompt(' + cid + ')', { sheet: 'chainAct' });
  rows += actionRow('ic-trash', 'Delete Chain', 'deleteChainPrompt(' + cid + ')', { sheet: 'chainAct', danger: true, disabled: isMain });
  document.getElementById('chainActBody').innerHTML = rows;
  openSheet('chainAct');
}
function setChainActive(cid) {
  API.setActive(cid).then(function () { refreshLiveState(); }).catch(function (e) { toast('Failed: ' + e.message); });
}
function setMidiChanPrompt(cid) {
  var chain = findChain(cid);
  var cur = chain && chain.midi_chan != null ? String(chain.midi_chan) : '';
  var v = prompt('MIDI channel (0-15, blank = audio-only/no MIDI):', cur);
  if (v === null) return;
  v = v.trim();
  var chan = v === '' ? null : parseInt(v, 10);
  if (chan !== null && (isNaN(chan) || chan < 0 || chan > 15)) { toast('Channel must be 0-15'); return; }
  API.setMidiChan(cid, chan).then(function (r) {
    if (r.error) throw new Error(r.error);
    refreshLiveState();
  }).catch(function (e) { toast('Failed: ' + e.message); });
}
function deleteChainPrompt(cid) {
  var chain = findChain(cid);
  if (!confirm('Delete chain "' + (chain ? (chain.title || cid) : cid) + '"? This stops its engines.')) return;
  API.removeChain(cid).then(function (r) {
    if (r.error) throw new Error(r.error);
    if (selectedChainId === cid) selectedChainId = null;
    refreshLiveState();
  }).catch(function (e) { toast('Delete failed: ' + e.message); });
}
function addChainPrompt() {
  var chanStr = prompt('MIDI channel for the new chain (0-15, blank = audio-only):', '');
  if (chanStr === null) return;
  chanStr = chanStr.trim();
  var chan = chanStr === '' ? null : parseInt(chanStr, 10);
  if (chan !== null && (isNaN(chan) || chan < 0 || chan > 15)) { toast('Channel must be 0-15'); return; }
  toast('Adding chain…');
  API.addChain({ midi_chan: chan }).then(function (r) {
    if (r.error) throw new Error(r.error);
    if (r.chain_id != null) selectedChainId = r.chain_id;
    return refreshLiveState();
  }).catch(function (e) { toast('Add chain failed: ' + e.message); });
}

/* ── Processor actions ── */
function openProcActionSheet(pid, chain) {
  var p = procOf(pid);
  document.getElementById('procActTitle').textContent = p ? (p.name || p.eng_code) : ('Processor ' + pid);
  var rows = '';
  rows += actionRow('ic-up', 'Move Up', 'nudgeProcessor(' + pid + ',true)', { sheet: 'procAct' });
  rows += actionRow('ic-down', 'Move Down', 'nudgeProcessor(' + pid + ',false)', { sheet: 'procAct' });
  rows += actionRow('ic-trash', 'Delete', 'deleteProcessorPrompt(' + pid + ')', { sheet: 'procAct', danger: true });
  document.getElementById('procActBody').innerHTML = rows;
  openSheet('procAct');
}
function nudgeProcessor(pid, up) {
  API.nudgeProc(pid, up).then(function (r) {
    if (r.error) throw new Error(r.error);
    refreshLiveState();
  }).catch(function (e) { toast('Move failed: ' + e.message); });
}
function deleteProcessorPrompt(pid) {
  var p = procOf(pid);
  if (!confirm('Delete "' + (p ? (p.name || p.eng_code) : pid) + '"?')) return;
  API.removeProc(pid).then(function (r) {
    if (r.error) throw new Error(r.error);
    if (inspectedPid === pid) closeInspector();
    refreshLiveState();
  }).catch(function (e) { toast('Delete failed: ' + e.message); });
}

/* ── Add processor (search + category-grouped engine list) ── */
function openAddProcSheet() {
  if (selectedChainId == null) { toast('Add a chain first'); return; }
  document.getElementById('engSearch').value = '';
  document.getElementById('engParallel').checked = false;
  document.getElementById('addProcBody').innerHTML = '<div class="placeholder"><p>Loading engines&hellip;</p></div>';
  openSheet('addProc');
  engineCatalog().then(function () { renderEngineList(); }).catch(function (e) {
    document.getElementById('addProcBody').innerHTML = '<div class="placeholder"><p>' + escapeHtml(e.message) + '</p></div>';
  });
}
function renderEngineList() {
  engineCatalog().then(function (cat) {
    var body = document.getElementById('addProcBody');
    var q = document.getElementById('engSearch').value.toLowerCase().trim();
    var engines = (cat && cat.engines) || [];
    var grouped = {};
    engines.forEach(function (e) {
      if (e.enabled === false) return;
      var hay = (e.code + ' ' + (e.name || '') + ' ' + (e.title || '') + ' ' + (e.category || '')).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      var cat2 = e.category || 'Other';
      (grouped[cat2] = grouped[cat2] || []).push(e);
    });
    var cats = Object.keys(grouped).sort();
    if (!cats.length) { body.innerHTML = '<div class="placeholder"><p>No matches.</p></div>'; return; }
    body.innerHTML = '';
    cats.forEach(function (cat2) {
      body.appendChild(sectionHeaderEl(cat2 + ' (' + grouped[cat2].length + ')'));
      grouped[cat2].sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); }).forEach(function (e) {
        var row = document.createElement('div');
        row.className = 'of-item';
        row.innerHTML = '<div style="flex:1;min-width:0"><div style="font-weight:600">' + escapeHtml(e.name || e.code) + '</div>' +
          '<div style="font-size:11px;color:var(--text-dim)">' + escapeHtml(e.code) + (e.type ? ' · ' + escapeHtml(e.type) : '') + '</div></div>';
        row.addEventListener('click', function () { addProcessor(e.code); });
        body.appendChild(row);
      });
    });
  });
}
function sectionHeaderEl(label) {
  var h = document.createElement('div');
  h.className = 'pal-cat';
  h.textContent = label;
  return h;
}
function addProcessor(code) {
  var parallel = document.getElementById('engParallel').checked;
  closeSheet('addProc');
  toast('Adding ' + code + '…');
  API.addProc(selectedChainId, { eng_code: code, parallel: parallel }).then(function (r) {
    if (r.error) throw new Error(r.error);
    if (r.task_id) return awaitTask(r.task_id, 300, 30000).then(function (t) {
      if (t.status === 'failed') throw new Error(t.error || 'add failed');
    });
  }).then(function () {
    return refreshLiveState();
  }).catch(function (e) { toast('Add failed: ' + e.message); });
}
