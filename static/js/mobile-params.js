/*
 * TonePi Mobile — param editor panel.
 * Builds the slider/enum/raw-number/readonly rows for the selected
 * block's params, plus tap-to-edit (type an exact value instead of
 * only dragging).
 */

var paramDebounceTimers = {};

/* ── Param panel ── */
function renderParamPanel(idx) {
  var area = document.getElementById('paramArea');
  area.innerHTML = '';
  var item = currentChain[idx];
  if (!item) {
    area.innerHTML = '<div class="placeholder"><svg class="ic"><use href="#ic-chain"/></svg>' +
      '<p>Tap a block in the chain above to edit its parameters, or add one from the + tile.</p></div>';
    return;
  }
  if (item.type === 'feedback') {
    area.innerHTML = '<div class="placeholder"><svg class="ic"><use href="#ic-chain"/></svg>' +
      '<p>Feedback routing node — editing paths is desktop-only for now.</p></div>';
    return;
  }
  if (item.type === 'parallel') {
    var lane = selectedLane >= 0 ? item.lanes[selectedLane] : null;
    var laneItem = lane && selectedLaneBlock >= 0 ? lane[selectedLaneBlock] : null;
    if (laneItem) {
      renderBlockParamBody(area, laneItem, idx, 'Lane ' + (selectedLane + 1), function () {
        selectedLane = -1; selectedLaneBlock = -1;
        renderChainLane();
        renderParamPanel(idx);
      });
    } else {
      renderParallelEditor(area, item, idx);
    }
    return;
  }
  renderBlockParamBody(area, item, idx, null, null);
}

/* Shared by a normal top-level block AND a block selected inside a
 * parallel lane (mobile-parallel.js) — laneLabel/onBack are non-null
 * only for the latter (swaps the category badge for "Lane N" and adds
 * a back chevron into the param-block-hdr). */
function renderBlockParamBody(area, item, idx, laneLabel, onBack) {
  var def = findDef(item);
  var color = def ? def.color : '#e94560';
  var name = def ? def.name : item.block;
  var cat = categoryOf(item);

  var hdr = document.createElement('div');
  hdr.className = 'param-block-hdr';
  hdr.innerHTML = (onBack ? '<button class="hdr-icon-btn param-back-btn"><svg class="ic"><use href="#ic-chevron-l"/></svg></button>' : '') +
    '<div class="cat-spine" style="background:' + color + '"></div>' +
    '<h2>' + escapeHtml(name) + '</h2><span class="b-cat">' + escapeHtml(laneLabel || cat) + '</span>';
  area.appendChild(hdr);
  if (onBack) hdr.querySelector('.param-back-btn').addEventListener('click', onBack);

  var hiddenKeys = {};
  appendModelPickerRows(area, item, idx, def, hiddenKeys);

  var defParamsById = {};
  (def && def.params || []).forEach(function (p) { defParamsById[p.id] = p; });

  var keys = Object.keys(item.params || {});
  /* tonepi_cab: the definition's order (mic A's controls, then B's, the
   * room's, output, speaker), not whatever order the item's keys landed
   * in -- its params arrive from presets and fills in any order. */
  if (def && def.is_cabgrid) {
    var order = (def.params || []).map(function (p) { return p.id; });
    keys.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  }
  var rendered = 0;
  keys.forEach(function (key) {
    if (hiddenKeys[key]) return;
    var p = defParamsById[key];
    if (p && p.hidden) return;
    var val = item.params[key];
    rendered++;
    if (p && Array.isArray(p.values)) {
      area.appendChild(buildEnumRow(item, idx, p, val));
    } else if (p && typeof p.min === 'number' && typeof p.max === 'number') {
      area.appendChild(buildFaderRow(item, idx, p, val));
    } else if (typeof val === 'number') {
      area.appendChild(buildRawNumberRow(item, idx, key, val, p));
    } else {
      area.appendChild(buildReadonlyRow((p && p.label) || key, val));
    }
  });
  if (rendered === 0) {
    var empty = document.createElement('div');
    empty.className = 'placeholder';
    empty.innerHTML = '<p>This block has no editable parameters here.</p>';
    area.appendChild(empty);
  }
  var pad = document.createElement('div');
  pad.style.height = '24px';
  area.appendChild(pad);
}

function mergeCfg(base, extra) {
  var out = {};
  for (var k in base) out[k] = base[k];
  for (var k2 in extra) out[k2] = extra[k2];
  return out;
}

/* Replaces the raw model_idx/ir_idx/bank_id params (a bare index
 * number tells you nothing — desktop hides these too, see params.js's
 * is_nam/is_neural/is_ir_cab/is_conv_cab checks) with a tappable row
 * showing the resolved name, opening mobile-models.js's full-screen
 * chooser. Populates hiddenKeys so the normal per-param loop above
 * skips the raw fields these rows replace. */
function appendModelPickerRows(area, item, idx, def, hiddenKeys) {
  /* XY Amp·Cab: the pad (xy_pad.js) is the whole panel */
  if (def && def.composite && typeof XYPad !== 'undefined') {
    Object.keys(item.params || {}).forEach(function (k) { hiddenKeys[k] = true; });
    (def.params || []).forEach(function (p) { hiddenKeys[p.id] = true; });
    XYPad.build(area, item, {
      onChange: function () { dirty = true; updateHeader(); },
      onSplit: function () {
        var items = XYPad.splitItems(currentChain[idx], function () { return undefined; });
        if (!items) return;
        items.forEach(function (b) { delete b.instanceId; });
        currentChain.splice.apply(currentChain, [idx, 1].concat(items));
        selectedIdx = idx; dirty = true;
        renderChainLane(); renderParamPanel(selectedIdx); updateHeader();
        toast('Split into amp + cab \u2014 Replay to apply.');
      }
    });
    return;
  }
  if (!def) return;

  if (def.is_nam) {
    hiddenKeys.model_idx = true;
    area.appendChild(buildModelPickerRow({
      title: 'NAM Model',
      fetchUrl: '/api/nam/models',
      refreshUrl: '/api/nam/models/refresh',
      labelFn: function (m) { return m.name; },
      groupFn: function (m) { return m.author; },
      isActive: function (m) { return m.index === Math.round(item.params.model_idx || 0); },
      emptyText: 'No NAM models found. Place .nam files in /zynthian/zynthian-data/files/Neural Models/',
      onPick: function (m) {
        item.params.model_idx = m.index;
        dirty = true; updateHeader();
        toast('NAM model set to "' + m.name + '" — Replay to apply.');
        renderParamPanel(idx);
      }
    }, function (list) {
      var cur = list.filter(function (m) { return m.index === Math.round(item.params.model_idx || 0); })[0];
      return cur ? cur.name : (list.length ? 'model #' + (item.params.model_idx || 0) : 'No models found');
    }));
  }

  if (def.is_neural) {
    hiddenKeys.model_idx = true; hiddenKeys.arch = true;
    area.appendChild(buildModelPickerRow({
      title: 'Neural Model',
      fetchUrl: '/api/neural/models',
      refreshUrl: '/api/neural/models/refresh',
      labelFn: function (m) { return m.name + (m.arch === 'lstm' ? ' [LSTM]' : m.arch === 'wavenet' ? '' : ' [?]'); },
      groupFn: function (m) { return m.author; },
      isActive: function (m) { return m.index === Math.round(item.params.model_idx || 0); },
      emptyText: 'No neural models found. Place .nam or GuitarML .json files in the model search paths.',
      onPick: function (m) {
        /* a swapped model keeps the chain's level (model_level.js) */
        var lv = (typeof ModelLevel !== 'undefined') ? ModelLevel.apply(item, 'model_idx', m.index) : null;
        if (lv && typeof TPSnapshots !== 'undefined') TPSnapshots.noteParam(item.block, lv.param, lv.value, item.faust_id || item.instanceId);
        item.params.model_idx = m.index;
        item.params.arch = m.arch === 'lstm' ? 1 : m.arch === 'wavenet' ? 2 : 0;
        dirty = true; updateHeader();
        // Live hot-swap, no recompile needed — the chain briefly mutes
        // while libtp_nn.so's reload worker loads the new model off
        // the audio thread, then unmutes into it automatically.
        var fid = item.faust_id || item.instanceId || 0;
        fetch('/api/neural/reload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            faust_id: fid, model_idx: m.index, arch: item.params.arch,
            quality: item.params.quality
          })
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (!data.ok) throw new Error(data.message || 'Reload failed');
          toast('Neural model set to "' + m.name + '" (live).');
        }).catch(function (e) { toast('Live reload failed: ' + e.message); });
        renderParamPanel(idx);
      }
    }, function (list) {
      var cur = list.filter(function (m) { return m.index === Math.round(item.params.model_idx || 0); })[0];
      return cur ? cur.name : (list.length ? 'model #' + (item.params.model_idx || 0) : 'No models found');
    }));
  }

  if (def.is_ir_cab || def.is_conv_cab) {
    var irBase = {
      fetchUrl: '/api/ir/models',
      refreshUrl: '/api/ir/models/refresh',
      labelFn: function (m) { return m.name + (m.fit_error ? ' (' + m.fit_error + 'dB)' : ''); },
      groupFn: function (m) { return m.author; },
      emptyText: 'No IR files found. Place .wav files in the IR Cabs directories (see Settings).'
    };
    var params = item.params || {};
    if ('ir_idx' in params) {
      hiddenKeys.ir_idx = true;
      Object.keys(params).forEach(function (k) { if (k.indexOf('ir_') === 0) hiddenKeys[k] = true; });
      area.appendChild(buildModelPickerRow(mergeCfg(irBase, {
        title: 'Cabinet IR',
        isActive: function (m) { return m.index === Math.round(item.params.ir_idx || 0); },
        onPick: function (m) {
          /* a swapped model keeps the chain's level (model_level.js) */
          var lv = (typeof ModelLevel !== 'undefined') ? ModelLevel.apply(item, 'ir_idx', m.index) : null;
          if (lv && typeof TPSnapshots !== 'undefined') TPSnapshots.noteParam(item.block, lv.param, lv.value, item.faust_id || item.instanceId);
          item.params.ir_idx = m.index;
          if (m.fit_params) { for (var k in m.fit_params) item.params['ir_' + k] = m.fit_params[k]; }
          dirty = true; updateHeader();
          if (def.is_conv_cab) {
            // Live hot-swap, no recompile needed — the chain briefly
            // mutes while libtp_cc.so's reload worker loads + FFT
            // partitions the new IR off the audio thread.
            var fid = item.faust_id || item.instanceId || 0;
            fetch('/api/ir/reload', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                faust_id: fid, ir_idx: m.index, algo_tail: item.params.algo_tail
              })
            }).then(function (r) { return r.json(); }).then(function (data) {
              if (!data.ok) throw new Error(data.message || 'Reload failed');
              toast('Cabinet IR set to "' + m.name + '" (live).');
            }).catch(function (e) { toast('Live reload failed: ' + e.message); });
          } else {
            toast('Cabinet IR set to "' + m.name + '" — Replay to apply.');
          }
          renderParamPanel(idx);
        }
      }), function (list) {
        var cur = list.filter(function (m) { return m.index === Math.round(item.params.ir_idx || 0); })[0];
        return cur ? cur.name : (list.length ? 'IR #' + (item.params.ir_idx || 0) : 'No IRs found');
      }));
    }
    if ('ir_a_idx' in params) {
      hiddenKeys.ir_a_idx = true;
      area.appendChild(buildModelPickerRow(mergeCfg(irBase, {
        title: 'Cabinet IR A',
        isActive: function (m) { return m.index === Math.round(item.params.ir_a_idx || 0); },
        onPick: function (m) {
          item.params.ir_a_idx = m.index;
          dirty = true; updateHeader();
          toast('IR A set to "' + m.name + '" — Replay to apply.');
          renderParamPanel(idx);
        }
      }), function (list) {
        var cur = list.filter(function (m) { return m.index === Math.round(item.params.ir_a_idx || 0); })[0];
        return cur ? cur.name : (list.length ? 'IR #' + (item.params.ir_a_idx || 0) : 'No IRs found');
      }));
    }
    if ('ir_b_idx' in params) {
      hiddenKeys.ir_b_idx = true;
      area.appendChild(buildModelPickerRow(mergeCfg(irBase, {
        title: 'Cabinet IR B',
        isActive: function (m) { return m.index === Math.round(item.params.ir_b_idx || 0); },
        onPick: function (m) {
          item.params.ir_b_idx = m.index;
          dirty = true; updateHeader();
          toast('IR B set to "' + m.name + '" — Replay to apply.');
          renderParamPanel(idx);
        }
      }), function (list) {
        var cur = list.filter(function (m) { return m.index === Math.round(item.params.ir_b_idx || 0); })[0];
        return cur ? cur.name : (list.length ? 'IR #' + (item.params.ir_b_idx || 0) : 'No IRs found');
      }));
    }
  }

  /* tonepi_cab (capture-grid cab): the CAB by its title, the mics by
   * their names -- never the raw grid string / mic indices. The cab is
   * the node's file, so it needs a Replay; a mic is live (the block's
   * worker rebuilds the IR and crossfades). */
  if (def.is_cabgrid) {
    var cp = item.params || (item.params = {});
    /* A chain saved before a param existed (the speaker dynamics were
     * appended) would not show it: the panel lists the item's keys. */
    (def.params || []).forEach(function (p) { if (!(p.id in cp) && p.init !== undefined) cp[p.id] = p.init; });
    ['grid', 'mic_a', 'mic_b', 'mic_c'].forEach(function (k) { hiddenKeys[k] = true; });
    var curGrid = function () { return String(cp.grid || 'twin_2x12'); };
    var _lastGrids = [];
    var gridOfCache = function () { return (gridOf(_lastGrids).mics || []); };
    var gridOf = function (list) {
      if (list && list.length && list[0].mics) _lastGrids = list;
      return list.filter(function (g) { return g.name === curGrid(); })[0] || { name: curGrid(), title: curGrid(), mics: [] };
    };
    /* -1 = auto (the room mic's default): the cab's first fixed mic */
    var micIdx = function (mics, key) {
      var i = Math.round(cp[key] !== undefined ? cp[key] : (key === 'mic_c' ? -1 : 0));
      if (i < 0) { var f = mics.filter(function (m) { return m.fixed; })[0]; return f ? f.index : 0; }
      return i;
    };
    var makers = ['Fender', 'Vox', 'Marshall', 'Mesa', 'Orange', 'Engl', 'Bogner', 'Supro', 'Sunn', 'Celestion'];
    var makerOf = function (t) {
      for (var i = 0; i < makers.length; i++) if (String(t).indexOf(makers[i]) >= 0) return makers[i];
      return 'Other';
    };
    area.appendChild(buildModelPickerRow({
      title: 'Cab',
      fetchUrl: '/api/cabgrids',
      labelFn: function (g) { return g.title || g.name; },
      groupFn: function (g) { return makerOf(g.title || g.name); },
      subFn: function (g) { return (g.mics || []).length + ' mics'; },
      isActive: function (g) { return g.name === curGrid(); },
      emptyText: 'No cab grids found (/var/lib/tonepi/cabgrids).',
      onPick: function (g) {
        /* a swapped model keeps the chain's level (model_level.js) */
        var lv = (typeof ModelLevel !== 'undefined') ? ModelLevel.apply(item, 'grid', g.name) : null;
        if (lv && typeof TPSnapshots !== 'undefined') TPSnapshots.noteParam(item.block, lv.param, lv.value, item.faust_id || item.instanceId);
        cp.grid = g.name;
        var n = (g.mics || []).length;
        ['mic_a', 'mic_b'].forEach(function (k) { if (Math.round(cp[k] || 0) >= n) cp[k] = 0; });
        cp.mic_c = -1;      // auto: the new cab's first room mic
        if (typeof TPSnapshots !== 'undefined')
          TPSnapshots.noteParam(item.block, 'grid', g.name, item.faust_id || item.instanceId);
        dirty = true; updateHeader();
        toast('Cab set to "' + (g.title || g.name) + '" — Replay to apply.');
        renderParamPanel(idx);
      }
    }, function (list) { return gridOf(list).title || curGrid(); }));
    [['mic_a', 'Mic A'], ['mic_b', 'Mic B'], ['mic_c', 'Room Mic']].forEach(function (pm) {
      var key = pm[0];
      area.appendChild(buildModelPickerRow({
        title: pm[1],
        fetchUrl: '/api/cabgrids',
        mapList: function (list) { return gridOf(list).mics || []; },
        labelFn: function (m) { return m.name; },
        groupFn: function (m) {
          return m.fixed ? 'Fixed (room / rear / mix)' : (/\(derived\)/.test(m.name) ? 'Derived' : 'Close (positioned)');
        },
        subFn: function (m) { return m.fixed ? null : m.nodes + ' captured positions'; },
        isActive: function (m) { return m.index === micIdx(gridOfCache(), key); },
        emptyText: 'This cab has no mics listed.',
        onPick: function (m) {
          applyParamValue(item, idx, key, m.index);
          dirty = true; updateHeader();
          toast(pm[1] + ': ' + m.name);
          renderParamPanel(idx);
        }
      }, function (mics) {
        var m = mics.filter(function (x) { return x.index === micIdx(mics, key); })[0];
        return m ? m.name : (mics.length ? 'mic #' + Math.round(cp[key] || 0) : '…');
      }));
    });
  }

  if (def.is_wavetable_block) {
    hiddenKeys.bank_id = true;
    area.appendChild(buildModelPickerRow({
      title: 'Wavetable Bank',
      fetchUrl: '/api/wavetable/banks',
      refreshUrl: '/api/wavetable/refresh',
      labelFn: function (m) { return m.display || m.name; },
      groupFn: function (m) { return m.category || m.source || 'Other'; },
      subFn: function (m) { return m.source; },
      isActive: function (m) { return Number(m.id) === Math.round(item.params.bank_id || 0); },
      emptyText: 'No wavetable banks found.',
      onPick: function (m) {
        item.params.bank_id = m.id;
        dirty = true; updateHeader();
        // Live hot-swap, no recompile needed (same live-push path every
        // slider uses) — matches desktop's buildWavetableBankSelector.
        var fid = item.faust_id || item.instanceId || 0;
        fetch('/api/chain/param', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item.block + '_' + fid + '.bank_live', value: m.id })
        }).catch(function () {});
        toast('Wavetable bank set to "' + (m.display || m.name) + '" (live).');
        renderParamPanel(idx);
      }
    }, function (list) {
      var cur = list.filter(function (m) { return Number(m.id) === Math.round(item.params.bank_id || 0); })[0];
      return cur ? (cur.display || cur.name) : (list.length ? 'bank #' + (item.params.bank_id || 0) : 'No banks found');
    }));
  }

  if (def.is_sample_guitar) {
    hiddenKeys.bank_id = true;
    area.appendChild(buildModelPickerRow({
      title: 'Sample Bank',
      fetchUrl: '/api/sample_guitar/banks',
      refreshUrl: '/api/sample_guitar/refresh',
      labelFn: function (m) { return m.guitar || m.name; },
      groupFn: function (m) { return m.source || 'Other'; },
      subFn: function (m) {
        var bits = [];
        if (m.dynamic) bits.push(m.dynamic);
        if (m.midi_low != null && m.midi_high != null) bits.push('MIDI ' + m.midi_low + '-' + m.midi_high);
        if (m.available === false) bits.push('missing');
        return bits.join(' · ');
      },
      isActive: function (m) { return Number(m.id) === Math.round(item.params.bank_id || 0); },
      emptyText: 'No sample banks found.',
      onPick: function (m) {
        item.params.bank_id = m.id;
        dirty = true; updateHeader();
        toast('Sample bank set to "' + (m.guitar || m.name) + '" — Replay to apply.');
        renderParamPanel(idx);
      }
    }, function (list) {
      var cur = list.filter(function (m) { return Number(m.id) === Math.round(item.params.bank_id || 0); })[0];
      return cur ? (cur.guitar || cur.name) : (list.length ? 'bank #' + (item.params.bank_id || 0) : '(none)');
    }));
  }
}

function formatParamValue(val, p) {
  var step = p && p.step;
  var decimals = 0;
  if (step != null) {
    if (step <= 0.001) decimals = 3;
    else if (step <= 0.01) decimals = 2;
    else if (step < 1) decimals = 1;
  } else if (!Number.isInteger(val)) {
    decimals = 2;
  }
  var s = Number(val).toFixed(decimals);
  if (p && p.unit) s += (p.unit === '%' ? '%' : ' ' + p.unit);
  return s;
}

/* One param to the engine. Debounce + endpoint live in tp_engine.js so
 * desktop and mobile push identically. */
function applyParamValue(item, idx, paramId, value) {
  item.params[paramId] = value;
  /* Record it against the ACTIVE snapshot as well. chain[] and the
   * active snapshot are mirrors; letting them drift is what silently
   * reverted edits on the next load. */
  if (typeof TPSnapshots !== 'undefined')
    TPSnapshots.noteParam(item.block, paramId, value,
                          item.faust_id || item.instanceId);
  TPEngine.setParam(item.block, item.faust_id || item.instanceId || 0,
                    paramId, value);
}

function buildFaderRow(item, idx, p, val) {
  var row = document.createElement('div');
  row.className = 'param-row';
  var pct = ((val - p.min) / (p.max - p.min)) * 100;
  if (!isFinite(pct)) pct = 0;
  pct = Math.max(0, Math.min(100, pct));
  row.innerHTML =
    '<div class="p-label-row"><span class="p-label">' + escapeHtml(p.label || p.id) + '</span>' +
    '<span class="p-val mono">' + formatParamValue(val, p) + '</span></div>' +
    '<div class="fader"><div class="fader-track"></div><div class="fader-fill" style="width:' + pct + '%"></div>' +
    '<input type="range" min="' + p.min + '" max="' + p.max + '" step="' + (p.step || 'any') + '" value="' + val + '"></div>';
  var valSpan = row.querySelector('.p-val');
  var fill = row.querySelector('.fader-fill');
  var range = row.querySelector('input[type=range]');

  range.addEventListener('input', function () {
    var v = parseFloat(range.value);
    var pc = ((v - p.min) / (p.max - p.min)) * 100;
    fill.style.width = Math.max(0, Math.min(100, pc)) + '%';
    valSpan.textContent = formatParamValue(v, p);
    applyParamValue(item, idx, p.id, v);
  });
  valSpan.addEventListener('click', function () {
    editParamValue(valSpan, range, fill, item, idx, p);
  });
  return row;
}

/* Tap a param's value to type an exact number instead of only dragging.
 * Swaps the span for a number input in place, clamps to the slider's
 * own min/max on commit, restores the original on Escape. */
function editParamValue(span, range, fill, item, idx, p) {
  if (span.dataset.editing) return;
  span.dataset.editing = '1';
  var raw = range.value;

  var input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.className = 'p-val-input mono';
  input.min = range.min;
  input.max = range.max;
  input.value = raw;

  span.replaceWith(input);
  input.focus();
  input.select();

  function commit(apply) {
    var v = parseFloat(input.value);
    if (isNaN(v)) v = parseFloat(raw);
    var min = parseFloat(input.min), max = parseFloat(input.max);
    if (!isNaN(min) && v < min) v = min;
    if (!isNaN(max) && v > max) v = max;
    if (apply) {
      range.value = v;
      var pc = ((v - p.min) / (p.max - p.min)) * 100;
      fill.style.width = Math.max(0, Math.min(100, pc)) + '%';
      applyParamValue(item, idx, p.id, v);
    } else {
      v = parseFloat(raw);
    }
    span.textContent = formatParamValue(v, p);
    delete span.dataset.editing;
    input.replaceWith(span);
  }
  input.addEventListener('blur', function () { commit(true); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
}

function buildEnumRow(item, idx, p, val) {
  var row = document.createElement('div');
  row.className = 'param-row';
  row.innerHTML = '<div class="p-label-row"><span class="p-label">' + escapeHtml(p.label || p.id) + '</span></div>';
  var wrap = document.createElement('div');
  wrap.className = 'param-enum-row';
  var sel = document.createElement('select');
  p.values.forEach(function (opt) {
    var o = document.createElement('option');
    o.value = opt.v;
    o.textContent = opt.l;
    if (String(opt.v) === String(val)) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', function () {
    var v = parseFloat(sel.value);
    if (isNaN(v)) v = sel.value;
    applyParamValue(item, idx, p.id, v);
  });
  wrap.appendChild(sel);
  row.appendChild(wrap);
  return row;
}

/* Numeric params with no known min/max (e.g. dynamic LV2 ctrl_N) —
 * tap-to-edit only, no slider (we don't have a range to draw one). */
function buildRawNumberRow(item, idx, key, val, p) {
  var row = document.createElement('div');
  row.className = 'param-row raw';
  var label = (p && p.label) || key;
  row.innerHTML = '<div class="p-label-row"><span class="p-label">' + escapeHtml(label) + '</span>' +
    '<span class="p-val mono">' + Number(val).toFixed(2) + '</span></div>';
  var valSpan = row.querySelector('.p-val');
  valSpan.addEventListener('click', function () {
    if (valSpan.dataset.editing) return;
    valSpan.dataset.editing = '1';
    var input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.step = 'any';
    input.className = 'p-val-input mono';
    input.value = val;
    valSpan.replaceWith(input);
    input.focus();
    input.select();
    function commit(apply) {
      var v = parseFloat(input.value);
      if (isNaN(v)) v = val;
      if (apply) { val = v; applyParamValue(item, idx, key, v); }
      valSpan.textContent = Number(val).toFixed(2);
      delete valSpan.dataset.editing;
      input.replaceWith(valSpan);
    }
    input.addEventListener('blur', function () { commit(true); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
  });
  return row;
}

function buildReadonlyRow(label, val) {
  var row = document.createElement('div');
  row.className = 'param-row';
  row.innerHTML = '<div class="p-label-row"><span class="p-label">' + escapeHtml(label) + '</span>' +
    '<span class="p-val readonly mono">' + escapeHtml(String(val)) + '</span></div>';
  return row;
}
