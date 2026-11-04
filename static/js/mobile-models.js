/*
 * TonePi Mobile — full-screen searchable chooser for the "hidden"
 * huge-list block params (NAM/Neural models, IR cabs, Wavetable/
 * Sample Guitar banks) that used to render as a bare, meaningless
 * raw-number row (model_idx=281 tells you nothing). Desktop hides
 * these from the normal per-param list too and swaps in a dedicated
 * selector — mobile's own equivalent of that, sized for a phone
 * screen: a search box + author/category-grouped results in a full
 * sheet, not an inline <select> (unusable past a few dozen entries —
 * these lists run 25 to 1203 real entries on the actual Pi).
 *
 * Wired from mobile-params.js's renderBlockParamBody() based on the
 * block def's is_nam/is_neural/is_ir_cab/is_conv_cab/
 * is_wavetable_block/is_sample_guitar flags — see MODEL_PICKER_CONFIGS
 * there for the per-flag wiring (fetch URL, label/group functions,
 * what changes on pick).
 */

var _modelListCache = {};   // fetchUrl -> resolved list (module-level, survives re-renders)

function fetchModelList(fetchUrl, force) {
  if (force) delete _modelListCache[fetchUrl];
  if (_modelListCache[fetchUrl]) return Promise.resolve(_modelListCache[fetchUrl]);
  return fetch(fetchUrl).then(function (r) { return r.json(); }).then(function (d) {
    var list = Array.isArray(d) ? d : (d.banks || d.models || d.presets || d.grids || []);
    _modelListCache[fetchUrl] = list;
    return list;
  }).catch(function () { return []; });
}

/* cfg: {title, fetchUrl, labelFn(m), groupFn(m), subFn(m)?, isActive(m),
 * emptyText?, refreshUrl?, onPick(m), mapList(list)?} -- mapList turns the
 * fetched list into the rows to choose from (tonepi_cab: one grid's mics). */
function openModelChooser(cfg) {
  document.getElementById('modelTitle').textContent = cfg.title;
  var search = document.getElementById('modelSearch');
  search.value = '';
  var body = document.getElementById('modelBody');
  body.innerHTML = '<div class="placeholder"><p>Loading&hellip;</p></div>';
  openSheet('model');

  var refreshBtn = document.getElementById('modelRefreshBtn');
  refreshBtn.style.display = cfg.refreshUrl ? '' : 'none';
  refreshBtn.onclick = function () {
    refreshBtn.disabled = true;
    fetch(cfg.refreshUrl, { method: 'POST' }).then(function () {
      return fetchModelList(cfg.fetchUrl, true);
    }).then(function (list) {
      if (cfg.mapList) list = cfg.mapList(list);
      refreshBtn.disabled = false;
      renderModelList(list, cfg, search.value);
      toast('Rescanned — ' + list.length + ' found.');
    }).catch(function () { refreshBtn.disabled = false; toast('Rescan failed.'); });
  };

  fetchModelList(cfg.fetchUrl, false).then(function (list) {
    if (cfg.mapList) list = cfg.mapList(list);
    renderModelList(list, cfg, '');
    search.oninput = function () { renderModelList(list, cfg, search.value); };
  });
}

function renderModelList(list, cfg, query) {
  var body = document.getElementById('modelBody');
  body.innerHTML = '';
  var q = (query || '').toLowerCase().trim();
  var filtered = !q ? list : list.filter(function (m) {
    var lbl = (cfg.labelFn(m) || '').toLowerCase();
    var grp = (cfg.groupFn(m) || '').toLowerCase();
    return lbl.indexOf(q) >= 0 || grp.indexOf(q) >= 0;
  });

  var info = document.createElement('div');
  info.className = 'model-count-info';
  info.textContent = filtered.length + (filtered.length === 1 ? ' match' : ' matches') +
    (list.length !== filtered.length ? ' of ' + list.length : '');
  body.appendChild(info);

  if (!filtered.length) {
    body.appendChild(emptyNote(list.length ? 'No matches.' : (cfg.emptyText || 'None found.')));
    return;
  }

  var groups = {};
  var order = [];
  filtered.forEach(function (m) {
    var g = cfg.groupFn(m) || 'Other';
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(m);
  });
  order.sort();

  order.forEach(function (g) {
    var hdr = document.createElement('div');
    hdr.className = 'subcat-hdr';
    hdr.textContent = g + ' (' + groups[g].length + ')';
    body.appendChild(hdr);
    groups[g].forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'of-item';
      var active = cfg.isActive(m);
      var sub = cfg.subFn ? cfg.subFn(m) : null;
      row.innerHTML = '<div style="flex:1;min-width:0"><div>' + escapeHtml(cfg.labelFn(m)) + '</div>' +
        (sub ? '<div class="model-picker-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>' +
        (active ? '<span class="preset-check">&#10003;</span>' : '');
      row.addEventListener('click', function () { closeSheet('model'); cfg.onPick(m); });
      body.appendChild(row);
    });
  });
}

/* Row shown in the param panel in place of the raw index param(s) —
 * current selection's resolved name (or "Loading…" until the cached
 * list is fetched once), tap opens the chooser above. */
function buildModelPickerRow(cfg, currentLabelFn) {
  var row = document.createElement('div');
  row.className = 'param-row model-picker-row';
  row.innerHTML = '<div class="p-label-row"><span class="p-label">' + escapeHtml(cfg.title) + '</span>' +
    '<span class="p-val">&hellip; <svg class="ic"><use href="#ic-chevron-r"/></svg></span></div>';
  var valEl = row.querySelector('.p-val');
  fetchModelList(cfg.fetchUrl, false).then(function (list) {
    if (cfg.mapList) list = cfg.mapList(list);
    var lbl = currentLabelFn(list);
    valEl.innerHTML = escapeHtml(lbl) + ' <svg class="ic"><use href="#ic-chevron-r"/></svg>';
  });
  row.addEventListener('click', function () { openModelChooser(cfg); });
  return row;
}
