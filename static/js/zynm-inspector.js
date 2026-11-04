/*
 * ZynEditor Mobile — Inspector: full-screen slide-over for one
 * processor. Preset picker (sheet), engine-bank picker (inline, only
 * shown when the engine actually has >1 bank — matches desktop),
 * sticky search/filter, flat scrollable controller fader list reusing
 * the exact .fader/.param-row markup + mechanics from mobile-app.css
 * (real <input type=range>, not a static thumb).
 */
var inspectorControllers = [];  // cached raw controller list for client-side filtering
var inspectorPresets = [];
var inspectorChainLabel = '';

function openInspector(pid, chain) {
  inspectedPid = pid;
  inspectorChainLabel = chain ? (chain.title || ('Chain ' + chain.chain_id)) : '';
  var p = procOf(pid);
  document.getElementById('inspEngine').textContent = p ? (p.name || p.eng_code) : ('Processor ' + pid);
  document.getElementById('inspChain').textContent = inspectorChainLabel;
  document.getElementById('inspBody').innerHTML = '<div class="placeholder"><p>Loading&hellip;</p></div>';
  document.getElementById('scr-inspector').classList.add('active');
  loadInspector(pid);
}
function closeInspector() {
  document.getElementById('scr-inspector').classList.remove('active');
  inspectedPid = null;
}

function loadInspector(pid) {
  Promise.all([
    API.presets(pid),
    API.controllers(pid),
    API.engineBanks(pid).catch(function () { return { banks: [], current_index: 0 }; })
  ]).then(function (results) {
    var presets = results[0], ctrls = results[1], banks = results[2];
    inspectorPresets = presets.presets || [];
    inspectorControllers = ctrls.controllers || [];
    var currentPreset = presets.presets && presets.current_index != null
      ? (presets.presets.filter(function (p) { return p.index === presets.current_index; })[0] || null) : null;

    var body = document.getElementById('inspBody');
    body.innerHTML = '';

    var presetBtn = document.createElement('div');
    presetBtn.className = 'insp-preset-btn';
    presetBtn.innerHTML = '<div><div class="pb-label">Preset</div><div class="pb-name">' +
      escapeHtml(currentPreset ? currentPreset.name : (presets.current_name || '(none)')) + '</div></div>' +
      '<svg class="ic"><use href="#ic-chevron-r"/></svg>';
    presetBtn.addEventListener('click', function () { openPresetPicker(pid); });
    body.appendChild(presetBtn);

    var bArr = (banks && banks.banks) || [];
    if (bArr.length > 1) {
      var bankRow = document.createElement('div');
      bankRow.className = 'insp-bank-row';
      var opts = bArr.map(function (b) {
        return '<option value="' + b.index + '"' + (b.index === banks.current_index ? ' selected' : '') + '>' + escapeHtml(String(b.name)) + '</option>';
      }).join('');
      bankRow.innerHTML = '<label>Bank</label><select id="inspBankSel">' + opts + '</select>';
      body.appendChild(bankRow);
      bankRow.querySelector('#inspBankSel').addEventListener('change', function (e) {
        var idx = parseInt(e.target.value, 10);
        API.setEngineBank(pid, { index: idx }).then(function (r) {
          if (r.error) throw new Error(r.error);
          loadInspector(pid);
        }).catch(function (err) { toast('Bank set failed: ' + err.message); });
      });
    }

    var searchWrap = document.createElement('div');
    searchWrap.className = 'insp-search-wrap';
    searchWrap.innerHTML = '<div class="insp-search"><svg class="ic"><use href="#ic-search"/></svg>' +
      '<input id="ctrlFilter" placeholder="Filter ' + inspectorControllers.length + ' controllers&hellip;"></div>';
    body.appendChild(searchWrap);

    var scroll = document.createElement('div');
    scroll.className = 'insp-scroll';
    scroll.id = 'inspCtrlScroll';
    body.appendChild(scroll);

    renderControllerList('');
    document.getElementById('ctrlFilter').addEventListener('input', function (e) { renderControllerList(e.target.value); });
  }).catch(function (e) {
    document.getElementById('inspBody').innerHTML = '<div class="placeholder"><p>' + escapeHtml(e.message) + '</p></div>';
  });
}

function renderControllerList(query) {
  var scroll = document.getElementById('inspCtrlScroll');
  if (!scroll) return;
  var q = (query || '').toLowerCase().trim();
  var list = inspectorControllers.filter(function (z) {
    if (!q) return true;
    var hay = ((z.short_name || z.name || '') + ' ' + (z.symbol || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  });
  scroll.innerHTML = '';
  if (!list.length) {
    scroll.appendChild(emptyNote(inspectorControllers.length ? 'No controllers match.' : 'This processor has no controllers.'));
    return;
  }
  list.forEach(function (z) { scroll.appendChild(controllerRowEl(z)); });
  var pad = document.createElement('div');
  pad.style.height = '24px';
  scroll.appendChild(pad);
}

function controllerRowEl(z) {
  var pid = inspectedPid;
  var sym = z.symbol || '?';
  var name = z.short_name || z.name || sym;
  var min = z.min != null ? z.min : 0;
  var max = z.max != null ? z.max : 1;
  var val = z.value != null ? z.value : 0;

  var row = document.createElement('div');
  row.className = 'param-row';

  if (z.is_toggle) {
    row.innerHTML = '<div class="p-label-row"><span class="p-label">' + escapeHtml(name) + '</span></div>';
    var wrap = document.createElement('div');
    wrap.className = 'param-enum-row';
    var sel = document.createElement('select');
    sel.innerHTML = '<option value="0"' + (!val ? ' selected' : '') + '>Off</option><option value="1"' + (val ? ' selected' : '') + '>On</option>';
    if (z.readonly) sel.disabled = true;
    sel.addEventListener('change', function () { sendCtrl(pid, sym, parseInt(sel.value, 10)); });
    wrap.appendChild(sel);
    row.appendChild(wrap);
    return row;
  }

  if (z.labels && z.labels.length && z.ticks && z.ticks.length === z.labels.length) {
    row.innerHTML = '<div class="p-label-row"><span class="p-label">' + escapeHtml(name) + '</span></div>';
    var ewrap = document.createElement('div');
    ewrap.className = 'param-enum-row';
    var esel = document.createElement('select');
    esel.innerHTML = z.labels.map(function (lbl, i) {
      return '<option value="' + z.ticks[i] + '"' + (z.ticks[i] === val ? ' selected' : '') + '>' + escapeHtml(lbl) + '</option>';
    }).join('');
    if (z.readonly) esel.disabled = true;
    esel.addEventListener('change', function () { sendCtrl(pid, sym, parseFloat(esel.value)); });
    ewrap.appendChild(esel);
    row.appendChild(ewrap);
    return row;
  }

  var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  pct = Math.max(0, Math.min(100, pct));
  var step = z.is_integer ? 1 : Math.max((max - min) / 1000, 0.001);
  row.innerHTML =
    '<div class="p-label-row"><span class="p-label">' + escapeHtml(name) + '</span>' +
    '<span class="p-val mono">' + fmtCtrlValue(val, z) + '</span></div>' +
    '<div class="fader"><div class="fader-track"></div><div class="fader-fill" style="width:' + pct + '%"></div>' +
    '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"' + (z.readonly ? ' disabled' : '') + '></div>';
  var valSpan = row.querySelector('.p-val');
  var fill = row.querySelector('.fader-fill');
  var range = row.querySelector('input[type=range]');
  var pending = null;
  range.addEventListener('input', function () {
    var v = parseFloat(range.value);
    var pc = max > min ? ((v - min) / (max - min)) * 100 : 0;
    fill.style.width = Math.max(0, Math.min(100, pc)) + '%';
    valSpan.textContent = fmtCtrlValue(v, z);
    clearTimeout(pending);
    pending = setTimeout(function () { sendCtrl(pid, sym, v); }, 30);
  });
  return row;
}

function sendCtrl(pid, sym, val) {
  API.setCtrl(pid, sym, val).catch(function (e) { console.warn('ctrl set failed:', e); });
}
function fmtCtrlValue(v, z) {
  if (typeof v !== 'number') return String(v);
  if (z && z.is_integer) return String(Math.round(v));
  return v.toFixed(3);
}

/* ── Preset picker sheet ── */
function openPresetPicker(pid) {
  document.getElementById('presetPickTitle').textContent = 'Presets (' + inspectorPresets.length + ')';
  var body = document.getElementById('presetPickBody');
  body.innerHTML = '';
  if (!inspectorPresets.length) {
    body.appendChild(emptyNote('No presets for this engine/bank.'));
  } else {
    inspectorPresets.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'of-item';
      row.textContent = String(p.index).padStart ? String(p.index).padStart(3, '0') + ' ' + p.name : p.index + ' ' + p.name;
      row.addEventListener('click', function () {
        closeSheet('presetPick');
        toast('Loading preset&hellip;');
        API.setPreset(pid, { index: p.index }).then(function (r) {
          if (r.error) throw new Error(r.error);
          loadInspector(pid);
          setTimeout(refreshLiveState, 200);
        }).catch(function (e) { toast('Preset failed: ' + e.message); });
      });
      body.appendChild(row);
    });
  }
  openSheet('presetPick');
}
