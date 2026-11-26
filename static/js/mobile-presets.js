/*
 * TonePi Mobile — Presets tab.
 * Two sections: (1) saved-chain library, browsed via the same
 * role -> family -> name drill-down /api/chains/grouped already
 * returns (mirrors the Add Block sheet's category drill-down
 * interaction shape — mobile-palette.js), family groups collapsible,
 * a chain row opens an action sheet (Play / Load in Designer / Move
 * to Group / Rename / Delete) rather than loading on tap; (2)
 * per-block presets (higain_v2 / dualcab / guitar_xform) for whichever
 * such blocks exist in the currently-loaded chain, also collapsible —
 * all three share the same REST shape: /api/<ns>/presets,
 * /api/<ns>/apply_preset/<name>.
 */
var chainsGrouped = null;
var currentPresetRole = null;

function renderPresetsView() {
  var scroll = document.getElementById('presetsScroll');
  scroll.innerHTML = '<div class="placeholder"><svg class="ic"><use href="#ic-library"/></svg><p>Loading&hellip;</p></div>';
  ensureChainsGrouped().then(renderPresetRoles);
}

function ensureChainsGrouped() {
  if (chainsGrouped) return Promise.resolve(chainsGrouped);
  return fetch('/api/chains/grouped').then(function (r) { return r.json(); }).then(function (d) {
    chainsGrouped = d || {};
    return chainsGrouped;
  }).catch(function (e) {
    chainsGrouped = {};
    toast('Could not load saved chains: ' + e.message);
    return chainsGrouped;
  });
}
function refreshPresets(stayOnRole) {
  chainsGrouped = null;
  ensureChainsGrouped().then(function () {
    if (stayOnRole && currentPresetRole) renderPresetRole(currentPresetRole);
    else renderPresetRoles();
  });
}

/* ── Saved chains (level 1: role list, level 2: collapsible family groups) ── */
function renderPresetRoles() {
  currentPresetRole = null;
  document.getElementById('presetsBack').style.display = 'none';
  document.getElementById('presetsTitle').textContent = 'Presets';
  var scroll = document.getElementById('presetsScroll');
  scroll.innerHTML = '';
  appendAssignBanner(scroll);

  scroll.appendChild(sectionHeader('Saved Chains'));
  var roles = Object.keys(chainsGrouped || {});
  if (!roles.length) {
    scroll.appendChild(emptyNote('No saved chains found.'));
  } else {
    roles.sort().forEach(function (role) {
      var count = Object.keys(chainsGrouped[role]).reduce(function (n, fam) {
        return n + chainsGrouped[role][fam].length;
      }, 0);
      var row = document.createElement('div');
      row.className = 'cat-row';
      row.innerHTML = '<span>' + escapeHtml(role) + '</span>' +
        '<span class="cat-count">' + count + '</span>' +
        '<svg class="ic"><use href="#ic-chevron-r"/></svg>';
      row.addEventListener('click', function () { renderPresetRole(role); });
      scroll.appendChild(row);
    });
  }

  appendBlockPresetsSection(scroll);
}

function renderPresetRole(role) {
  currentPresetRole = role;
  document.getElementById('presetsBack').style.display = '';
  document.getElementById('presetsTitle').textContent = role;
  var scroll = document.getElementById('presetsScroll');
  scroll.innerHTML = '';
  appendAssignBanner(scroll);
  var fams = (chainsGrouped && chainsGrouped[role]) || {};
  Object.keys(fams).sort().forEach(function (fam) {
    var names = fams[fam].slice().sort();
    var grp = collapsibleGroup(fam, names.length);
    scroll.appendChild(grp.header);
    names.forEach(function (name) {
      var row = document.createElement('div');
      row.className = 'of-item';
      row.textContent = name;
      row.addEventListener('click', function () {
        if (pendingBankSlotAssign) assignPendingSlot(name);
        else openPresetActionSheet(name);
      });
      grp.body.appendChild(row);
    });
    scroll.appendChild(grp.body);
  });
}

/* Banks' "assign slot" flow (mobile-banks.js) parks a pending target
 * here and jumps to this tab — show a banner so it's obvious tapping
 * a chain now assigns it rather than opening the usual menu. */
function appendAssignBanner(scroll) {
  if (!pendingBankSlotAssign) return;
  var b = document.createElement('div');
  b.className = 'of-item';
  b.style.color = 'var(--accent)';
  b.innerHTML = 'Pick a chain for the bank slot&hellip; <span style="margin-left:auto;text-decoration:underline">Cancel</span>';
  b.addEventListener('click', function () {
    pendingBankSlotAssign = null;
    renderPresetRoles();
  });
  scroll.appendChild(b);
}
function assignPendingSlot(name) {
  var t = pendingBankSlotAssign;
  pendingBankSlotAssign = null;
  fetch('/api/banks/' + t.bankIdx + '/slots/' + t.slotIdx, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: name, snapshot: 0, label: name })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Assign failed');
    toast('Assigned "' + name + '"');
    setTab('system');
  }).catch(function (e) { toast('Assign failed: ' + e.message); });
}

/* ── Saved-chain action sheet (Play / Load in Designer / Move to
 * Group / Rename / Delete) — reuses the same #actSheet the block
 * long-press/right-click menu does. Tap replaces auto-load-on-tap:
 * the old behaviour ("loads chain 2000 into Designer but never plays
 * it") only covered one of five things a user might want here. */
function openPresetActionSheet(name) {
  document.getElementById('actTitle').textContent = name;
  var rows = '';
  rows += actionRowHtml('ic-play', 'Play', "playSavedChain('" + esc1(name) + "')");
  rows += actionRowHtml('ic-load', 'Load in Designer', "loadNamedChain('" + esc1(name) + "')");
  rows += actionRowHtml('ic-chevron-r', 'Move to Group…', "openMoveToGroup('" + esc1(name) + "')", false, false, true);
  rows += actionRowHtml('ic-save', 'Rename…', "renameSavedChain('" + esc1(name) + "')");
  rows += actionRowHtml('ic-trash', 'Delete', "deleteSavedChain('" + esc1(name) + "')", false, true);
  document.getElementById('actBody').innerHTML = rows;
  openSheet('act');
}

function playSavedChain(name) {
  fetch('/api/chains/' + encodeURIComponent(name) + '/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  }).then(function (r) { return r.json().catch(function () { return {}; }); })
    .then(function (data) {
      if (data && data.ok === false) throw new Error(data.message || 'Play failed');
      toast('Playing "' + name + '"');
    }).catch(function (e) { toast('Play failed: ' + e.message); });
}

function renameSavedChain(name) {
  var newName = prompt('Rename "' + name + '" to:', name);
  if (!newName || newName === name) return;
  fetch('/api/chains/' + encodeURIComponent(name) + '/rename', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: newName })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Rename failed');
    toast('Renamed to "' + newName + '"');
    refreshPresets(true);
  }).catch(function (e) { toast('Rename failed: ' + e.message); });
}

function deleteSavedChain(name) {
  if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
  fetch('/api/chains/' + encodeURIComponent(name), { method: 'DELETE' })
    .then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) throw new Error(data.message || 'Delete failed');
      toast('Deleted "' + name + '"');
      refreshPresets(true);
    }).catch(function (e) { toast('Delete failed: ' + e.message); });
}

/* "Move to Group…" swaps the same open #actSheet's content to a list
 * of sibling families within the chain's current role (touch
 * drag-and-drop across two list sections is unreliable — this is the
 * same "long-press → Move to category…" idiom the desktop LV2 palette
 * already uses for the identical underlying problem). */
function openMoveToGroup(name) {
  var fams = (chainsGrouped && chainsGrouped[currentPresetRole]) || {};
  var names = Object.keys(fams).sort();
  document.getElementById('actTitle').textContent = 'Move "' + name + '" to…';
  var rows = names.map(function (fam) {
    return actionRowHtml('ic-chevron-r', fam, "setChainFamily('" + esc1(name) + "','" + esc1(fam) + "')");
  }).join('');
  rows += actionRowHtml('ic-add', 'New Group…', "setChainFamily('" + esc1(name) + "', null)");
  document.getElementById('actBody').innerHTML = rows;
}

function setChainFamily(name, family) {
  if (family === null) {
    family = prompt('New group name for "' + name + '":');
    if (!family) return;
  }
  fetch('/api/chains/' + encodeURIComponent(name) + '/family', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ family: family })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Move failed');
    closeSheet('act');
    toast('Moved to "' + family + '"');
    refreshPresets(true);
  }).catch(function (e) { toast('Move failed: ' + e.message); });
}

/* Load a saved chain.
 *
 * play:true -- the ENGINE loads it, which is what makes it audible and
 * keeps its name. This used to only GET the chain into the editor; the
 * render that followed pushed it straight back through
 * LiveGraph.schedule() as an anonymous DESIGNER edit, so asking for
 * "Hgn Rthm Wide" ended up showing a designer chain under a different
 * name while the engine never actually loaded the preset. Measured:
 * one GET, two apply_live POSTs, then a chain_loaded that overwrote
 * the name. */
function loadNamedChain(name) {
  return TPEngine.loadNamed(name, { play: true }).then(function (d) {
    if (d) { setTab('designer'); toast('Loaded "' + name + '"'); }
    return d;
  });
}

/* ── Per-block presets (higain_v2 / dualcab / guitar_xform), each
 * block's list collapsible — ──
 * Detected via the block def's is_higain_v2/is_dualcab/is_guitar_xform
 * flag — the flag maps to a different REST namespace than the block's
 * own id (e.g. block id "tonepi_higain_v2" -> /api/higain_v2/*). */
var PRESET_BLOCK_FLAGS = { is_higain_v2: 'higain_v2', is_dualcab: 'dualcab', is_guitar_xform: 'guitar_xform' };

function findPresetableBlocks() {
  var out = [];
  var counts = {};
  walkChainItems(currentChain, function (item) {
    if (item.type !== 'block') return;
    var def = findDef(item);
    if (!def) return;
    var ns = null;
    for (var flag in PRESET_BLOCK_FLAGS) { if (def[flag]) { ns = PRESET_BLOCK_FLAGS[flag]; break; } }
    if (!ns) return;
    counts[ns] = (counts[ns] || 0) + 1;
    out.push({ item: item, def: def, namespace: ns, instanceNum: counts[ns] });
  });
  return out;
}

function appendBlockPresetsSection(scroll) {
  var targets = findPresetableBlocks();
  if (!targets.length) return;
  scroll.appendChild(sectionHeader('Block Presets'));
  targets.forEach(function (t) {
    var totalOfNs = targets.filter(function (x) { return x.namespace === t.namespace; }).length;
    var label = t.def.name + (totalOfNs > 1 ? ' #' + t.instanceNum : '');
    var grp = collapsibleGroup(label, null, true);
    scroll.appendChild(grp.header);
    scroll.appendChild(grp.body);
    var loading = document.createElement('div');
    loading.className = 'of-item';
    loading.textContent = 'Loading presets…';
    grp.body.appendChild(loading);
    fetch('/api/' + t.namespace + '/presets').then(function (r) { return r.json(); }).then(function (d) {
      loading.remove();
      var names = (d.presets || []).slice().sort();
      if (!names.length) {
        grp.body.appendChild(emptyNote('No presets available.'));
        return;
      }
      names.forEach(function (name) {
        var row = document.createElement('div');
        row.className = 'of-item';
        var active = t.item.params && t.item.params.preset_name === name;
        row.innerHTML = escapeHtml(name) + (active ? '<span class="preset-check">&#10003;</span>' : '');
        row.addEventListener('click', function () { applyBlockPreset(t, name); });
        grp.body.appendChild(row);
      });
    }).catch(function () { loading.textContent = 'Could not load presets.'; });
  });
}

function applyBlockPreset(t, name) {
  fetch('/api/' + t.namespace + '/apply_preset/' + encodeURIComponent(name), { method: 'POST' })
    .then(function (r) { return r.json().catch(function () { return {}; }); })
    .then(function (data) {
      if (data && data.ok === false) throw new Error(data.error || 'Apply failed');
      t.item.params.preset_name = name;
      dirty = true;
      updateHeader();
      if (currentChain[selectedIdx] === t.item) renderParamPanel(selectedIdx);
      toast('Applied "' + name + '"');
      renderPresetsView();
    }).catch(function (e) { toast('Apply preset failed: ' + e.message); });
}
