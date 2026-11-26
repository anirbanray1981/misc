/*
 * ZynEditor Mobile — Mixer tab: horizontal-scroll vertical fader
 * strips (one per chain with an audio mixer channel) + a Main strip
 * pinned outside the scrollable area. Same value semantics as
 * desktop's zyn_editor.js: level is the linear 0..1 zynmixer fader
 * value (dB label = 20*log10(level)); balance is -1..1; mute/solo are
 * booleans. DOM is rebuilt only when the strip set changes; the poll
 * otherwise just updates values/meters so a fader mid-drag isn't
 * yanked back (mirrors desktop's _mixerBusy set).
 */
var mixerSig = null;
var mixerBusy = {};  // chan -> true while the user is dragging that strip

function levelToDb(level) {
  if (!level || level <= 0) return '-inf';
  var db = 20 * Math.log10(level);
  return (db >= 0 ? '+' : '') + db.toFixed(1);
}

function refreshMixer() {
  var wrap = document.getElementById('mixerWrap');
  if (!wrap) return;
  API.mixer().then(function (data) {
    if (!data || !data.ok || !data.main) {
      wrap.innerHTML = '<div class="mix-empty">' + (data && data.error ? escapeHtml(data.error) : 'Mixer unavailable') + '</div>';
      mixerSig = null;
      return;
    }
    var strips = (data.strips || []).slice();
    var sig = strips.map(function (s) { return s.chan; }).join(',');
    if (sig !== mixerSig) {
      mixerSig = sig;
      buildMixerDom(wrap, strips, data.main);
    }
    updateMixerLive(strips, data.main);
    document.getElementById('mixerSub').textContent = strips.length + ' chain' + (strips.length === 1 ? '' : 's') + ' + Main';
  }).catch(function (e) {
    wrap.innerHTML = '<div class="mix-empty">Failed to load mixer: ' + escapeHtml(e.message) + '</div>';
    mixerSig = null;
  });
}

function buildMixerDom(wrap, strips, main) {
  wrap.innerHTML = '';
  var scroll = document.createElement('div');
  scroll.className = 'mixer-scroll';
  if (!strips.length) {
    scroll.innerHTML = '<div class="mix-empty">No audio chains yet — add a chain with a synth or audio FX on the Rack tab.</div>';
  } else {
    strips.forEach(function (s) { scroll.appendChild(mixStripEl(s, false)); });
  }
  wrap.appendChild(scroll);
  var mainEl = mixStripEl(main, true);
  mainEl.classList.add('mix-main');
  wrap.appendChild(mainEl);
}

function mixStripEl(s, isMain) {
  var el = document.createElement('div');
  el.className = 'mix-strip';
  el.dataset.chan = s.chan;
  el.innerHTML =
    '<div class="mix-pan-row"><input type="range" class="mix-pan" min="-1" max="1" step="0.02" value="' + s.balance + '" title="Pan"></div>' +
    '<div class="mix-fader-wrap"><input type="range" class="mix-fader" min="0" max="1" step="0.001" value="' + s.level + '"></div>' +
    '<div class="mix-db mono">' + levelToDb(s.level) + '</div>' +
    '<div class="mix-btns"><div class="mix-btn mute' + (s.mute ? ' on' : '') + '">M</div><div class="mix-btn solo' + (s.solo ? ' on' : '') + '">S</div></div>' +
    '<div class="mix-name">' + escapeHtml(s.title) + '</div>';

  var chan = s.chan;
  var fader = el.querySelector('.mix-fader');
  var pan = el.querySelector('.mix-pan');
  var dbLbl = el.querySelector('.mix-db');
  var muteBtn = el.querySelector('.mix-btn.mute');
  var soloBtn = el.querySelector('.mix-btn.solo');

  var lastSend = 0, pendingSend = null;
  function throttledSend(field, value) {
    var now = Date.now();
    if (now - lastSend >= 50) { lastSend = now; API.setMixer(chan, field, value).catch(function () {}); }
    else {
      clearTimeout(pendingSend);
      pendingSend = setTimeout(function () { lastSend = Date.now(); API.setMixer(chan, field, value).catch(function () {}); }, 55);
    }
  }
  fader.addEventListener('input', function () {
    mixerBusy[chan] = true;
    dbLbl.textContent = levelToDb(parseFloat(fader.value));
    throttledSend('level', parseFloat(fader.value));
  });
  fader.addEventListener('change', function () {
    API.setMixer(chan, 'level', parseFloat(fader.value)).catch(function () {});
    delete mixerBusy[chan];
  });
  pan.addEventListener('input', function () {
    mixerBusy[chan] = true;
    throttledSend('balance', parseFloat(pan.value));
  });
  pan.addEventListener('change', function () {
    API.setMixer(chan, 'balance', parseFloat(pan.value)).catch(function () {});
    delete mixerBusy[chan];
  });
  muteBtn.addEventListener('click', function () {
    var next = !muteBtn.classList.contains('on');
    muteBtn.classList.toggle('on', next);
    API.setMixer(chan, 'mute', next).catch(function () {});
  });
  soloBtn.addEventListener('click', function () {
    var next = !soloBtn.classList.contains('on');
    soloBtn.classList.toggle('on', next);
    API.setMixer(chan, 'solo', next).catch(function () {});
  });
  return el;
}

function updateMixerLive(strips, main) {
  strips.concat([main]).forEach(function (s) {
    var el = document.querySelector('.mix-strip[data-chan="' + s.chan + '"]');
    if (!el || mixerBusy[s.chan]) return;
    var fader = el.querySelector('.mix-fader');
    var pan = el.querySelector('.mix-pan');
    var dbLbl = el.querySelector('.mix-db');
    if (fader && document.activeElement !== fader) fader.value = s.level;
    if (pan && document.activeElement !== pan) pan.value = s.balance;
    if (dbLbl) dbLbl.textContent = levelToDb(s.level);
    el.querySelector('.mix-btn.mute').classList.toggle('on', s.mute);
    el.querySelector('.mix-btn.solo').classList.toggle('on', s.solo);
  });
}
