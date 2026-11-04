/*
 * TonePi Mobile — Add Block palette (category drill-down).
 * Level 1 = category list, level 2 = drilled-in blocks. Mirrors the
 * desktop palette's own flat/nested split (web/static/js/palette.js)
 * exactly — categories containing " / " fold into a parent with
 * sub-groups; a parent that ALSO has a bare flat entry (Airwindows,
 * PureData, LV2 all do — the registry stores one root item + N
 * " / "-suffixed sub-buckets) gets that folded in as a "(root)" sub so
 * there's one tree per parent, not two boxes with the same name.
 * PureData's sub-labels are themselves two segments
 * ("community / delays") since it nests one level deeper than
 * Airwindows does — rendered as-is, not re-split, same as desktop.
 */
function buildPaletteTree() {
  var flat = {}, nested = {};
  Object.keys(blocksByCategory).forEach(function (cat) {
    var blocks = blocksByCategory[cat] || [];
    var ix = cat.indexOf(' / ');
    if (ix > 0) {
      var parent = cat.substring(0, ix);
      var sub = cat.substring(ix + 3);
      nested[parent] = nested[parent] || {};
      nested[parent][sub] = blocks;
    } else {
      flat[cat] = blocks;
    }
  });
  Object.keys(nested).forEach(function (parent) {
    if (flat[parent]) {
      nested[parent]['(root)'] = flat[parent];
      delete flat[parent];
    }
  });
  return { flat: flat, nested: nested };
}
function paletteBlockEl(b) {
  var el = document.createElement('div');
  el.className = 'pal-block';
  el.style.setProperty('--chip-color', b.color || '#6a6a80');
  el.textContent = b.name;
  el.addEventListener('click', function () { addBlockToChain(b); });
  return el;
}
function openAddBlock() {
  renderCatList();
  openSheet('pal');
}
function renderCatList() {
  var tree = buildPaletteTree();
  var rows = [];
  Object.keys(tree.flat).forEach(function (cat) {
    if (tree.flat[cat].length) rows.push({ name: cat, count: tree.flat[cat].length });
  });
  Object.keys(tree.nested).forEach(function (parent) {
    var subs = tree.nested[parent];
    var count = Object.keys(subs).reduce(function (n, s) { return n + subs[s].length; }, 0);
    if (count) rows.push({ name: parent, count: count, nested: true });
  });
  rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
  // Routing (Parallel) leads the list, same as desktop's palette.js —
  // not a real block category, so it's unshifted rather than sorted in.
  rows.unshift({ name: 'Routing', count: ROUTING_NODES.length, routing: true });
  var body = document.getElementById('palBody');
  body.innerHTML = '';
  if (!rows.length) {
    body.innerHTML = '<div class="placeholder"><p>No blocks available.</p></div>';
  } else {
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'cat-row';
      row.innerHTML = '<span>' + escapeHtml(r.name) + '</span>' +
        '<span class="cat-count">' + r.count + '</span>' +
        '<svg class="ic"><use href="#ic-chevron-r"/></svg>';
      row.addEventListener('click', function () { drillCategory(r.name); });
      body.appendChild(row);
    });
  }
  document.getElementById('palTitle').textContent = 'Add Block';
  document.getElementById('palBack').style.display = 'none';
}
function drillCategory(name) {
  if (name === 'Routing') { drillRouting(); return; }
  var tree = buildPaletteTree();
  var body = document.getElementById('palBody');
  body.innerHTML = '';
  if (tree.nested[name]) {
    var subs = tree.nested[name];
    Object.keys(subs).forEach(function (sub) {
      var hdr = document.createElement('div');
      hdr.className = 'subcat-hdr';
      hdr.textContent = sub === '(root)' ? 'General' : sub;
      body.appendChild(hdr);
      var grid = document.createElement('div');
      grid.className = 'pal-grid';
      subs[sub].forEach(function (b) { grid.appendChild(paletteBlockEl(b)); });
      body.appendChild(grid);
    });
  } else {
    var grid = document.createElement('div');
    grid.className = 'pal-grid';
    (tree.flat[name] || []).forEach(function (b) { grid.appendChild(paletteBlockEl(b)); });
    body.appendChild(grid);
  }
  document.getElementById('palTitle').textContent = name;
  document.getElementById('palBack').style.display = '';
}
function drillRouting() {
  var body = document.getElementById('palBody');
  body.innerHTML = '';
  var grid = document.createElement('div');
  grid.className = 'pal-grid';
  ROUTING_NODES.forEach(function (r) {
    var el = document.createElement('div');
    el.className = 'pal-block';
    el.style.setProperty('--chip-color', '#8a5cff');
    el.textContent = r.icon + ' ' + r.name;
    el.title = r.desc;
    el.addEventListener('click', function () { addRoutingNodeToChain(r.id); });
    grid.appendChild(el);
  });
  body.appendChild(grid);
  document.getElementById('palTitle').textContent = 'Routing';
  document.getElementById('palBack').style.display = '';
}

function addBlockToChain(def) {
  var params = {};
  (def.params || []).forEach(function (p) {
    params[p.id] = (p.init !== undefined ? p.init : (typeof p.min === 'number' ? p.min : 0));
  });
  var item = {
    type: 'block',
    block: def.id,
    version: def.version || 1,
    params: params,
    disabled: false,
    stereo: !!def.can_stereo
  };
  if (pendingLaneInsert) {
    var lane = currentChain[pendingLaneInsert.parentIdx] &&
              currentChain[pendingLaneInsert.parentIdx].lanes &&
              currentChain[pendingLaneInsert.parentIdx].lanes[pendingLaneInsert.laneIdx];
    if (lane) {
      var at = Math.min(pendingLaneInsert.insertAt, lane.length);
      lane.splice(at, 0, item);
      selectedIdx = pendingLaneInsert.parentIdx;
      selectedLane = pendingLaneInsert.laneIdx;
      selectedLaneBlock = at;
    }
    pendingLaneInsert = null;
    dirty = true;
    closeSheet('pal');
    renderChainLane();
    renderParamPanel(selectedIdx);
    updateHeader();
    toast('Added "' + def.name + '" to Lane ' + (selectedLane + 1) + '.');
    return;
  }
  addBlockToChainTopLevel(def, item);
}

function addBlockToChainTopLevel(def, item) {
  if (pendingInsertIndex !== null && pendingInsertIndex <= currentChain.length) {
    currentChain.splice(pendingInsertIndex, 0, item);
    selectedIdx = pendingInsertIndex;
  } else {
    currentChain.push(item);
    selectedIdx = currentChain.length - 1;
  }
  pendingInsertIndex = null;
  dirty = true;
  closeSheet('pal');
  renderChainLane();
  renderParamPanel(selectedIdx);
  updateHeader();
  toast('Added "' + def.name + '" — tap Play to hear it, or Save to keep it.');
}
