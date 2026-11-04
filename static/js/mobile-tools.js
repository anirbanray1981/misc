/*
 * TonePi Mobile — Tools grid.
 * Links to the real routes served by web/routes/pages.py + app.py,
 * same-tab navigation (no new browser tab — see WebMobileRevamp.md
 * for why the desktop dropdown-launcher pattern doesn't work in a
 * standalone PWA).
 */
var TOOLS = [
  /* SHOW IS ONE THING NOW -- see the same regrouping in the desktop
   * launcher. StageFlow was under Performance and Song Designer under
   * Composition, which is two homes for the two halves of one
   * document. Both live here, designer first, because making a show is
   * what you come to this grid for; the stem player is what is behind
   * one of its section kinds. */
  { section: 'Show', items: [
    { label: 'Show Designer', icon: 'song', href: '/song_designer_mobile' },
    { label: 'Show Stems', icon: 'monitor', href: '/stageflow' }
  ] },
  { section: 'Performance', items: [
    { label: 'Tone Match', icon: 'target', href: '/tone_match_v3' }
  ] },
  { section: 'Block Designers', items: [
    { label: 'Higain V2', icon: 'amp', href: '/higain_v2' },
    { label: 'DualCab', icon: 'cab', href: '/dualcab' },
    { label: 'Guitar Xform', icon: 'mic', href: '/guitar_xform' },
    { label: 'Midi Guitar Sim', icon: 'note', href: '/midi_guitar_sim' }
  ] },
  { section: 'Composition', items: [
    { label: 'Sample Arp', icon: 'note', href: '/sample_arp_designer' },
    { label: 'Sample Chord', icon: 'note', href: '/sample_chord_designer' },
    { label: 'Sample Sequencer', icon: 'note', href: '/sample_seq_mobile' },
    { label: 'Pd Patch Editor', icon: 'patch', href: '/pd' }
  ] },
  { section: 'Capture & Analysis', items: [
    { label: 'Recordings', icon: 'rec', href: '/recordings' },
    { label: 'Ghost-Note Log', icon: 'ghost', href: '/ghostlog' }
  ] },
  { section: 'Other', items: [
    { label: 'Lyrics Manager', icon: 'song', href: '/lyrics_mobile' },
    { label: 'Raw DSP View', icon: 'raw', href: '/dsp' },
    { label: 'User Guide', icon: 'library', href: '/guide' }
  ] }
];
function renderToolsGrid() {
  var scroll = document.getElementById('toolsScroll');
  scroll.innerHTML = '';
  TOOLS.forEach(function (sec) {
    var h = document.createElement('div');
    h.className = 'tools-section';
    h.textContent = sec.section;
    scroll.appendChild(h);
    var grid = document.createElement('div');
    grid.className = 'tools-grid';
    sec.items.forEach(function (t) {
      var card = document.createElement('div');
      card.className = 'tool-card';
      card.innerHTML = '<svg class="ic"><use href="#ic-' + t.icon + '"/></svg>' +
        '<div class="t-lbl">' + escapeHtml(t.label) + '</div>';
      card.addEventListener('click', function () { window.location.href = t.href; });
      grid.appendChild(card);
    });
    scroll.appendChild(grid);
  });
}
