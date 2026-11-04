/*
 * TonePi Mobile — Banks tab (lives inside the System screen; Backup/
 * Settings are a separate, not-yet-built concern in the same screen).
 * A bank is a fixed 4-slot array; each slot optionally points at a
 * saved chain (+ snapshot index) with its own display label — the
 * same footswitch-driven "quick recall" concept the hardware UI's
 * bank_manager and FS Mapping `slot.N` actions use. Level 1 = bank
 * list, level 2 = that bank's 4 slots. Long-press (mobile) /
 * right-click (desktop) a bank row for Rename/Delete — same #actSheet
 * reuse as chain blocks (mobile-chain.js) and saved chains
 * (mobile-presets.js). Assigning an empty (or "Reassign…"'d) slot
 * hands off to the Presets tab's saved-chain browser via
 * `pendingBankSlotAssign` (mobile-state.js).
 */
var banksData = null;
var currentBankIdx = null;

function ensureBanksData() {
  return fetch('/api/banks').then(function (r) { return r.json(); }).then(function (d) {
    banksData = d || { banks: [] };
    return banksData;
  }).catch(function (e) {
    banksData = { banks: [] };
    toast('Could not load banks: ' + e.message);
    return banksData;
  });
}
function refreshBanks(stayOnBank) {
  ensureBanksData().then(function () {
    if (stayOnBank && currentBankIdx != null && banksData.banks[currentBankIdx]) renderBank(currentBankIdx);
    else renderBankList();
  });
}

/* Whether a slot's preset is the one actually loaded right now.
 * bank_manager's own `active_bank`/`active_slot` (persisted in
 * banks.json) is NOT reliable for this — confirmed live that
 * bank_manager_activate_slot()/set_bank() update the in-memory state
 * (and the real hardware highlight) without calling
 * bank_manager_save(), so the on-disk value can sit stale indefinitely.
 * /api/chain/current's {source,name} (mirrored into the shared
 * chainSource/chainName globals by loadChain(), mobile-state.js) is
 * written by the audio engine on EVERY load regardless of trigger —
 * web Play, a footswitch tap, hooks, this tab's own Select — so
 * matching by preset NAME against that is the actually-live signal.
 * A chain that isn't a saved preset at all (source !== 'preset') or
 * doesn't match any slot correctly shows nothing as active. */
function isSlotActive(slot) {
  return !!slot && chainSource === 'preset' && chainName === slot.preset;
}

function renderBankList() {
  currentBankIdx = null;
  document.getElementById('banksBack').style.display = 'none';
  document.getElementById('banksAdd').style.display = '';
  document.getElementById('banksTitle').textContent = 'Banks';
  var scroll = document.getElementById('banksScroll');
  scroll.innerHTML = '<div class="placeholder"><p>Loading&hellip;</p></div>';
  ensureBanksData().then(function (d) {
    scroll.innerHTML = '';
    var banks = d.banks || [];
    if (!banks.length) {
      scroll.appendChild(emptyNote('No banks yet — tap + to add one.'));
      return;
    }
    banks.forEach(function (bank, idx) {
      var filled = (bank.slots || []).filter(function (s) { return s; }).length;
      var isActiveBank = (bank.slots || []).some(isSlotActive);
      var row = document.createElement('div');
      row.className = 'cat-row';
      var activeBadge = isActiveBank
        ? '<span class="cat-count" style="background:var(--accent);color:#1a0509">ACTIVE</span>' : '';
      row.innerHTML = '<span>' + escapeHtml(bank.name) + '</span>' + activeBadge +
        '<span class="cat-count">' + filled + '/4</span>' +
        '<svg class="ic"><use href="#ic-chevron-r"/></svg>';
      row.addEventListener('click', function () { renderBank(idx); });
      attachLongPress(row, function () { openBankActionSheet(idx); });
      scroll.appendChild(row);
    });
  });
}

function renderBank(idx) {
  currentBankIdx = idx;
  var bank = banksData.banks[idx];
  document.getElementById('banksBack').style.display = '';
  document.getElementById('banksAdd').style.display = 'none';
  document.getElementById('banksTitle').textContent = bank.name;
  var scroll = document.getElementById('banksScroll');
  scroll.innerHTML = '';
  (bank.slots || []).forEach(function (slot, slotIdx) {
    var row = document.createElement('div');
    row.className = 'of-item';
    if (slot) {
      row.innerHTML = '<b>' + (slotIdx + 1) + '.</b>&nbsp;' + escapeHtml(slot.label || slot.preset) +
        (isSlotActive(slot) ? '<span class="preset-check">&#9679;</span>' : '');
      row.addEventListener('click', function () { openSlotActionSheet(idx, slotIdx); });
    } else {
      row.style.color = 'var(--text-dim)';
      row.innerHTML = '<b>' + (slotIdx + 1) + '.</b>&nbsp;Empty — tap to assign';
      row.addEventListener('click', function () { assignSlotStart(idx, slotIdx); });
    }
    scroll.appendChild(row);
  });
}

/* Re-render whichever bank view is on screen from already-cached
 * banksData — no refetch needed, only the chainName/chainSource
 * comparison changed. Called after chain_loaded (mobile-ws.js). */
function refreshBankHighlight() {
  if (!banksData) return;
  if (currentBankIdx != null && banksData.banks[currentBankIdx]) renderBank(currentBankIdx);
  else renderBankList();
}

/* ── Bank-level actions (long-press / right-click a bank row) ── */
function openBankActionSheet(idx) {
  var bank = banksData.banks[idx];
  document.getElementById('actTitle').textContent = bank.name;
  var rows = '';
  rows += actionRowHtml('ic-save', 'Rename Bank…', 'renameBankPrompt(' + idx + ')');
  rows += actionRowHtml('ic-trash', 'Delete Bank', 'deleteBankPrompt(' + idx + ')', false, true);
  document.getElementById('actBody').innerHTML = rows;
  openSheet('act');
}
function addBankPrompt() {
  var n = (banksData && banksData.banks ? banksData.banks.length : 0) + 1;
  var name = prompt('New bank name:', 'Bank ' + n);
  if (!name || !name.trim()) return;
  fetch('/api/banks/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Add failed');
    toast('Added "' + name.trim() + '"');
    refreshBanks(false);
  }).catch(function (e) { toast('Add failed: ' + e.message); });
}
function renameBankPrompt(idx) {
  var bank = banksData.banks[idx];
  var name = prompt('Rename bank:', bank.name);
  if (!name || !name.trim() || name.trim() === bank.name) return;
  bank.name = name.trim();
  fetch('/api/banks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(banksData)
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Rename failed');
    toast('Renamed to "' + bank.name + '"');
    refreshBanks(false);
  }).catch(function (e) { toast('Rename failed: ' + e.message); });
}
function deleteBankPrompt(idx) {
  var bank = banksData.banks[idx];
  if (!confirm('Delete bank "' + bank.name + '"? This cannot be undone.')) return;
  fetch('/api/banks/' + idx, { method: 'DELETE' }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Delete failed');
    toast('Deleted "' + bank.name + '"');
    refreshBanks(false);
  }).catch(function (e) { toast('Delete failed: ' + e.message); });
}

/* ── Slot-level actions (tap a filled slot) ── */
function openSlotActionSheet(bankIdx, slotIdx) {
  var slot = banksData.banks[bankIdx].slots[slotIdx];
  document.getElementById('actTitle').textContent = slot.label || slot.preset;
  var rows = '';
  rows += actionRowHtml('ic-play', 'Select', 'selectSlot(' + bankIdx + ',' + slotIdx + ')');
  rows += actionRowHtml('ic-load', 'Load in Designer', "loadNamedChain('" + esc1(slot.preset) + "')");
  rows += actionRowHtml('ic-chevron-r', 'Reassign…', 'assignSlotStart(' + bankIdx + ',' + slotIdx + ');closeSheet(\'act\')');
  rows += actionRowHtml('ic-save', 'Rename Label…', 'renameSlotPrompt(' + bankIdx + ',' + slotIdx + ')');
  rows += actionRowHtml('ic-trash', 'Clear Slot', 'clearSlot(' + bankIdx + ',' + slotIdx + ')', false, true);
  document.getElementById('actBody').innerHTML = rows;
  openSheet('act');
}
/* Unlike Play (the old action — /api/chains/<name>/preview, which
 * only loads audio), Select fires the same bank_manager primitives a
 * physical footswitch tap does: moves the hardware UI's active bank/
 * slot, highlighting it on the Perform screen. The highlight here
 * updates itself — the resulting audio-engine load fires the same
 * chain_loaded broadcast every load path does (web Play, hooks,
 * footswitch), which mobile-ws.js already turns into a
 * refreshBankHighlight() call. No manual refetch/timeout needed. */
function selectSlot(bankIdx, slotIdx) {
  var slot = banksData.banks[bankIdx].slots[slotIdx];
  fetch('/api/banks/' + bankIdx + '/slots/' + slotIdx + '/select', { method: 'POST' })
    .then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (data) {
    if (data && data.ok === false) throw new Error(data.message || 'Select failed');
    toast('Selected "' + (slot.label || slot.preset) + '"');
  }).catch(function (e) { toast('Select failed: ' + e.message); });
}
function renameSlotPrompt(bankIdx, slotIdx) {
  var slot = banksData.banks[bankIdx].slots[slotIdx];
  var label = prompt('Slot label:', slot.label || slot.preset);
  if (!label || !label.trim() || label.trim() === slot.label) return;
  fetch('/api/banks/' + bankIdx + '/slots/' + slotIdx, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: slot.preset, snapshot: slot.snapshot || 0, label: label.trim() })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Rename failed');
    toast('Renamed');
    refreshBanks(true);
  }).catch(function (e) { toast('Rename failed: ' + e.message); });
}
function clearSlot(bankIdx, slotIdx) {
  fetch('/api/banks/' + bankIdx + '/slots/' + slotIdx, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Clear failed');
    toast('Slot cleared');
    refreshBanks(true);
  }).catch(function (e) { toast('Clear failed: ' + e.message); });
}

/* ── Assign flow: hands off to the Presets tab's saved-chain browser.
 * See pendingBankSlotAssign (mobile-state.js) + assignPendingSlot()
 * (mobile-presets.js), which owns the actual PUT once a chain is picked. */
function assignSlotStart(bankIdx, slotIdx) {
  pendingBankSlotAssign = { bankIdx: bankIdx, slotIdx: slotIdx };
  setTab('presets');
}

/* ── System settings footer (System tab, below Banks) ──
 * Reboot/Shutdown route through the hardware UI's own tonepi_action()
 * dispatcher via IPC (web/routes/settings.py -> ipc_client.notify_run_action
 * -> control_router.c tp_ctl_run_named_action) — same detached
 * stop-zynthian-then-reboot / poweroff path a physical pisound_button
 * binding takes. Recover Audio launches the exact same
 * tonepi-jack-recover.sh via systemd-run that the hardware UI's JACK-wedge
 * dialog uses (jack_wedge_dialog.cpp), which restarts the whole audio
 * stack including tonepi-web itself — so this tab going briefly
 * unreachable partway through is expected, not a failure. */
function systemAction(action) {
  var label = action === 'reboot' ? 'Reboot' : 'Shutdown';
  if (!confirm(label + ' TonePi now? This will interrupt any live performance.')) return;
  fetch('/api/system/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || (label + ' failed'));
    toast(label + ' initiated…');
  }).catch(function (e) { toast(label + ' failed: ' + e.message); });
}

function systemRecoverAudio() {
  if (!confirm('Recover Audio: restarts JACK, Zynthian and the UI. Live audio will drop out for ~20-30s. Continue?')) return;
  fetch('/api/system/recover_audio', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
    if (!data.ok) throw new Error(data.message || 'Recovery failed to start');
    toast('Audio recovery started…');
  }).catch(function (e) { toast('Recovery failed: ' + e.message); });
}
