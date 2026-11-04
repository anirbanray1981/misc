/*
 * ZynEditor Mobile — Library tab: bank list -> snapshot rows with a
 * collapsible Scenes sub-list -> snapshot/bank action sheets.
 * Scenes are fetched lazily (only when a snapshot's Scenes header is
 * expanded) from GET /api/zyn/snapshots/<bank>/<file>'s .zs3 blob —
 * same source desktop's _renderSceneSubtree() file-mode path uses.
 */
var currentLibBank = null;   // bank dir currently drilled into, or null at the list level
var libBanksCache = [];
var libSnapForSheet = null;  // {bank, file} the open snapshot action sheet targets
var libBankForSheet = null;  // bank record the open bank action sheet targets

function renderZynBankList() {
  currentLibBank = null;
  document.getElementById('libBack').style.display = 'none';
  document.getElementById('libAdd').style.display = '';
  document.getElementById('libTitle').textContent = 'Library';
  var scroll = document.getElementById('libScroll');
  scroll.dataset.loaded = '1';
  scroll.innerHTML = '<div class="placeholder"><p>Loading&hellip;</p></div>';
  API.banks().then(function (d) {
    libBanksCache = d.banks || [];
    scroll.innerHTML = '';
    if (!libBanksCache.length) {
      scroll.appendChild(emptyNote('No banks yet — tap + to add one.'));
      return;
    }
    libBanksCache.forEach(function (b) {
      var row = document.createElement('div');
      row.className = 'cat-row';
      var idx = b.index == null ? '' : String(b.index).padStart(3, '0') + ' ';
      row.innerHTML = '<span>' + escapeHtml(idx) + escapeHtml(b.title || b.dir) + '</span>' +
        '<svg class="ic"><use href="#ic-chevron-r"/></svg>';
      row.addEventListener('click', function () { drillBank(b.dir); });
      attachLongPress(row, function () { openZynBankActionSheet(b); });
      scroll.appendChild(row);
    });
  }).catch(function (e) {
    scroll.innerHTML = '';
    scroll.appendChild(emptyNote('Could not load banks: ' + e.message));
  });
}

function drillBank(dir) {
  currentLibBank = dir;
  document.getElementById('libBack').style.display = '';
  document.getElementById('libAdd').style.display = 'none';
  var bankRec = libBanksCache.filter(function (b) { return b.dir === dir; })[0];
  document.getElementById('libTitle').textContent = bankRec ? (bankRec.title || dir) : dir;
  var scroll = document.getElementById('libScroll');
  scroll.innerHTML = '<div class="placeholder"><p>Loading&hellip;</p></div>';
  API.snapshots(dir).then(function (d) {
    scroll.innerHTML = '';
    var snaps = d.snapshots || [];
    if (!snaps.length) {
      scroll.appendChild(emptyNote('(empty bank)'));
      return;
    }
    snaps.forEach(function (s) { scroll.appendChild(snapshotRowEl(dir, s)); });
  }).catch(function (e) {
    scroll.innerHTML = '';
    scroll.appendChild(emptyNote('Could not load snapshots: ' + e.message));
  });
}

function isSnapshotLoaded(bank, file) {
  if (!liveState || !liveState.snapshot_path) return false;
  var rel = prettySnapPath(liveState.snapshot_path);
  return rel === (bank + '/' + file);
}
function prettySnapPath(fpath) {
  if (!fpath) return '';
  var parts = String(fpath).replace(/\\/g, '/').split('/');
  return parts.length >= 2 ? parts[parts.length - 2] + '/' + parts[parts.length - 1] : fpath;
}

function snapshotRowEl(bank, s) {
  var wrap = document.createElement('div');
  wrap.className = 'snap-row';
  var loaded = isSnapshotLoaded(bank, s.file);
  var pc = s.pc == null ? '' : String(s.pc).padStart(3, '0') + ' ';

  var main = document.createElement('div');
  main.className = 'snap-row-main';
  main.innerHTML = '<span class="snap-pc mono">' + escapeHtml(pc) + '</span>' +
    '<span class="snap-name' + (loaded ? ' loaded' : '') + '">' + escapeHtml(s.title || s.file) + '</span>' +
    '<svg class="ic"><use href="#ic-chevron-r"/></svg>';
  main.addEventListener('click', function () { openSnapshotActionSheet(bank, s); });
  wrap.appendChild(main);

  var grp = collapsibleGroup('Scenes', null, true);
  wrap.appendChild(grp.header);
  wrap.appendChild(grp.body);
  grp.body.innerHTML = '<div style="padding:6px 4px;color:var(--text-dim);font-size:11px">Tap to load&hellip;</div>';
  var scenesLoaded = false;
  grp.header.addEventListener('click', function () {
    if (grp.header.classList.contains('collapsed') || scenesLoaded) return;
    scenesLoaded = true;
    loadScenesInto(grp.body, bank, s.file, loaded);
  });
  return wrap;
}

function loadScenesInto(container, bank, file, loaded) {
  container.innerHTML = '<div style="padding:6px 4px;color:var(--text-dim);font-size:11px">Loading&hellip;</div>';
  var source;
  if (loaded && liveState && liveState.zs3) {
    var scenes = Object.keys(liveState.zs3).map(function (zid) {
      var st = liveState.zs3[zid];
      return { zid: zid, title: st.title || zid, active: !!st.active };
    });
    source = Promise.resolve(scenes);
  } else {
    source = API.snapshot(bank, file).then(function (blob) {
      var zs3 = blob.zs3 || {};
      return Object.keys(zs3).map(function (zid) {
        return { zid: zid, title: (zs3[zid] && zs3[zid].title) || zid, active: false };
      });
    });
  }
  source.then(function (scenes) {
    if (!scenes.length) {
      container.innerHTML = '<div style="padding:6px 4px;color:var(--text-dim);font-size:11px;font-style:italic">(no scenes)</div>';
      return;
    }
    container.innerHTML = '';
    scenes.forEach(function (sc) {
      var row = document.createElement('div');
      row.className = 'scene-item' + (sc.active ? ' active' : '');
      row.innerHTML = '<span class="dot"></span>' + escapeHtml(sc.title);
      container.appendChild(row);
    });
  }).catch(function (e) {
    container.innerHTML = '<div style="padding:6px 4px;color:var(--cat-amp,#ff5c5c);font-size:11px">' + escapeHtml(e.message) + '</div>';
  });
}

/* ── Snapshot actions ── */
function openSnapshotActionSheet(bank, s) {
  libSnapForSheet = { bank: bank, file: s.file, title: s.title };
  document.getElementById('snapActTitle').textContent = s.title || s.file;
  var rows = '';
  rows += actionRow('ic-rack', 'Load', 'loadSnapshotPrompt()', { sheet: 'snapAct' });
  rows += actionRow('ic-save', 'Rename…', 'renameSnapshotPrompt()', { sheet: 'snapAct' });
  rows += actionRow('ic-dup', 'Clone…', 'cloneSnapshotPrompt()', { sheet: 'snapAct' });
  rows += actionRow('ic-clock', 'MIDI Clock Source…', 'clockSourcePrompt()', { sheet: 'snapAct' });
  rows += actionRow('ic-trash', 'Delete', 'deleteSnapshotPrompt()', { sheet: 'snapAct', danger: true });
  document.getElementById('snapActBody').innerHTML = rows;
  openSheet('snapAct');
}
function loadSnapshotPrompt() {
  var t = libSnapForSheet;
  var path = t.bank + '/' + t.file;
  if (!confirm('Load "' + path + '" into Zynthian?\n\nThis replaces all current chains.')) return;
  toast('Loading ' + path + '…');
  API.loadSnapshot(path).then(function (r) {
    if (r.task_id) return awaitTask(r.task_id, 300, 60000).then(function (task) {
      if (task.status === 'failed') throw new Error(task.error || 'load failed');
    });
    if (r.error) throw new Error(r.error);
  }).then(function () {
    toast('Loaded ' + path);
    selectedChainId = null;
    refreshLiveState();
  }).catch(function (e) { toast('Load failed: ' + e.message); });
}
function renameSnapshotPrompt() {
  var t = libSnapForSheet;
  var newFile = prompt('New filename (in the same bank):', t.file);
  if (!newFile || !newFile.trim()) return;
  newFile = newFile.trim();
  if (!newFile.endsWith('.zss')) newFile += '.zss';
  API.renameSnap(t.bank, t.file, { dst_bank: t.bank, dst_file: newFile }).then(function (r) {
    if (r.error) throw new Error(r.error);
    toast('Renamed');
    drillBank(t.bank);
  }).catch(function (e) { toast('Rename failed: ' + e.message); });
}
function cloneSnapshotPrompt() {
  var t = libSnapForSheet;
  var dst = prompt('Clone to filename (in the same bank):', t.file.replace(/\.zss$/, '') + '-copy.zss');
  if (!dst || !dst.trim()) return;
  dst = dst.trim();
  if (!dst.endsWith('.zss')) dst += '.zss';
  API.cloneSnap(t.bank, t.file, { dst_bank: t.bank, dst_file: dst }).then(function (r) {
    if (r.error) throw new Error(r.error);
    toast('Cloned');
    drillBank(t.bank);
  }).catch(function (e) { toast('Clone failed: ' + e.message); });
}
function clockSourcePrompt() {
  var t = libSnapForSheet;
  var MODES = ['0 = Internal', '1 = Master (sends MIDI clock)', '2 = MIDI (follows external clock)', '3 = Analog'];
  API.getSnapClock(t.bank, t.file).then(function (cur) {
    var curVal = cur && cur.source != null ? cur.source : 0;
    var v = prompt('MIDI clock mode:\n' + MODES.join('\n'), String(curVal));
    if (v === null) return;
    var mode = parseInt(v, 10);
    if (isNaN(mode) || mode < 0 || mode > 3) { toast('Enter 0-3'); return; }
    API.setSnapClock(t.bank, t.file, mode).then(function (r) {
      if (r.error) throw new Error(r.error);
      toast('Clock mode set');
    }).catch(function (e) { toast('Failed: ' + e.message); });
  });
}
function deleteSnapshotPrompt() {
  var t = libSnapForSheet;
  if (!confirm('Delete ' + t.bank + '/' + t.file + '? This cannot be undone.')) return;
  API.deleteSnap(t.bank, t.file).then(function (r) {
    if (r.error) throw new Error(r.error);
    toast('Deleted');
    drillBank(t.bank);
  }).catch(function (e) { toast('Delete failed: ' + e.message); });
}

/* ── Bank actions ── */
function openZynBankActionSheet(b) {
  libBankForSheet = b;
  document.getElementById('bankActTitle').textContent = b.title || b.dir;
  var protect = b.dir === '000';
  var rows = '';
  rows += actionRow('ic-save', 'Rename…', 'renameZynBankPrompt()', { sheet: 'bankAct', disabled: protect });
  rows += actionRow('ic-trash', 'Delete', 'deleteZynBankPrompt()', { sheet: 'bankAct', danger: true, disabled: protect });
  document.getElementById('bankActBody').innerHTML = rows;
  openSheet('bankAct');
}
function renameZynBankPrompt() {
  var b = libBankForSheet;
  var name = prompt('Bank name:', b.title || '');
  if (name === null) return;
  API.renameBank(b.dir, { name: name.trim(), index: b.index != null ? b.index : 0 }).then(function (r) {
    if (r.error) throw new Error(r.error);
    toast('Renamed');
    renderZynBankList();
  }).catch(function (e) { toast('Rename failed: ' + e.message); });
}
function deleteZynBankPrompt() {
  var b = libBankForSheet;
  API.deleteBank(b.dir, false).then(function (r) {
    if (r.ok) { toast('Deleted'); renderZynBankList(); return; }
    if (r.snapshots && r.snapshots.length) {
      if (!confirm('Bank "' + b.dir + '" has ' + r.snapshots.length + ' snapshot(s). Delete bank AND all snapshots?')) return;
      return API.deleteBank(b.dir, true).then(function (r2) {
        if (!r2.ok) throw new Error(r2.error || 'delete failed');
        toast('Deleted');
        renderZynBankList();
      });
    }
    throw new Error(r.error || 'delete failed');
  }).catch(function (e) { toast('Delete failed: ' + e.message); });
}
function addZynBankPrompt() {
  var name = prompt('New bank name:', '');
  if (name === null) return;
  API.createBank({ name: name.trim() }).then(function (r) {
    if (r.error) throw new Error(r.error);
    toast('Bank added');
    renderZynBankList();
  }).catch(function (e) { toast('Add failed: ' + e.message); });
}
