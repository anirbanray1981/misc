/*
 * ZynEditor Mobile — Voices tab: read-only overview of every synth
 * voice currently live, grouped by MIDI channel. Deliberately does
 * NOT show a polyphony/voice count — the Zynthian inject API
 * (zyn_editor/zyn_inject.py) doesn't expose one anywhere; showing a
 * fabricated number would be worse than showing none.
 */
var VOICE_COLORS = ['#e94560', '#5c8aff', '#f5d44f', '#10b981', '#b35cff', '#f5a623'];

function renderVoices() {
  var scroll = document.getElementById('voicesScroll');
  if (!scroll) return;
  if (!liveState || !Array.isArray(liveState.chains)) {
    scroll.innerHTML = '<div class="placeholder"><svg class="ic"><use href="#ic-layers"/></svg><p>Loading&hellip;</p></div>';
    return;
  }
  var midiChains = liveState.chains.filter(function (c) { return c.midi_chan != null; })
    .sort(function (a, b) { return a.midi_chan - b.midi_chan; });
  var audioChains = liveState.chains.filter(function (c) { return c.midi_chan == null; });

  scroll.innerHTML = '';
  var colorIdx = 0;
  var any = false;

  midiChains.forEach(function (chain) {
    var procs = chainSynthProcs(chain);
    if (!procs.length) return;
    any = true;
    var sect = document.createElement('div');
    sect.className = 'voice-sect';
    sect.textContent = 'MIDI Ch ' + chain.midi_chan;
    scroll.appendChild(sect);
    procs.forEach(function (p) {
      scroll.appendChild(voiceRowEl(p, chain, VOICE_COLORS[colorIdx % VOICE_COLORS.length]));
      colorIdx++;
    });
  });

  if (audioChains.length) {
    var procsAny = audioChains.some(function (c) { return chainSynthProcs(c).length || chainAnyProcs(c).length; });
    if (procsAny) {
      var sect2 = document.createElement('div');
      sect2.className = 'voice-sect';
      sect2.textContent = 'Audio FX chains (no MIDI)';
      scroll.appendChild(sect2);
      audioChains.forEach(function (chain) {
        var procs = chainAnyProcs(chain);
        procs.forEach(function (p) {
          any = true;
          scroll.appendChild(voiceRowEl(p, chain, VOICE_COLORS[colorIdx % VOICE_COLORS.length]));
          colorIdx++;
        });
      });
    }
  }

  if (!any) {
    scroll.innerHTML = '<div class="placeholder"><svg class="ic"><use href="#ic-layers"/></svg><p>Nothing layered yet — add a chain with a synth on the Rack tab.</p></div>';
  }
}

function chainSynthProcs(chain) {
  var out = [];
  (chain.synth_slots || []).forEach(function (group) {
    (group || []).forEach(function (pid) {
      var p = procOf(pid);
      if (p) out.push(p);
    });
  });
  return out;
}
function chainAnyProcs(chain) {
  var out = [];
  ['midi_slots', 'synth_slots', 'audio_slots'].forEach(function (key) {
    (chain[key] || []).forEach(function (group) {
      (group || []).forEach(function (pid) {
        var p = procOf(pid);
        if (p) out.push(p);
      });
    });
  });
  return out;
}

function voiceRowEl(p, chain, color) {
  var row = document.createElement('div');
  row.className = 'voice-row';
  var chainLabel = (chain.title || ('Chain ' + chain.chain_id)) + (p.preset_name ? ' · ' + p.preset_name : '');
  row.innerHTML = '<div class="voice-swatch" style="background:' + color + '"></div>' +
    '<div class="voice-body"><div class="voice-name">' + escapeHtml(p.name || p.eng_code) + '</div>' +
    '<div class="voice-chain">' + escapeHtml(chainLabel) + '</div></div>';
  return row;
}
