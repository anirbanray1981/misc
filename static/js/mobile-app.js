/*
 * TonePi Mobile — boot entry.
 * Wires the approved nav-shell/Designer mockup to the real backend
 * (same REST endpoints the desktop web app uses). Does not touch
 * index.html / style.css / mobile.css / any existing desktop JS.
 * All actual logic lives in the other mobile-*.js files (state,
 * chain, params, palette, tools, ws, play), loaded before this one —
 * this file only sequences the boot.
 */
document.addEventListener('DOMContentLoaded', function () {
  renderToolsGrid();
  /* Chain rendering needs the block registry (param min/max/units/
   * colors) to be in hand first, or every param falls back to the
   * raw/no-slider path. Load blocks, then chain. */
  loadBlocks().then(loadChain);
  connectMeterWs();
  connectEventsWs();
  fetchMasterMute();
});
