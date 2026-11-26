/*
 * ZynEditor Mobile — Zynthian-mode boot. Called lazily by setAppMode()
 * (mobile-state.js) the first time the user flips into Zynthian mode —
 * NOT unconditionally on page load, since this starts a 2s live-state
 * poll against the real Zynthian engine that has no reason to run
 * while the user is in TonePi mode. All actual logic lives in the
 * other zynm-*.js files (state, rack, inspector, library, mixer,
 * voices), loaded before this one.
 */
var zynAppStarted = false;
function initZynApp() {
  if (zynAppStarted) return;
  zynAppStarted = true;
  checkHealth();
  refreshLiveState();
}
