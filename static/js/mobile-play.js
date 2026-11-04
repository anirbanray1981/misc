/*
 * TonePi Mobile — Play/Stop FAB.
 */
function updateFabState() {
  var fab = document.getElementById('fab');
  var ic = document.getElementById('fabIc');
  var lbl = document.getElementById('fabLbl');
  fab.classList.toggle('stopped', !playing);
  ic.innerHTML = '<use href="#ic-' + (playing ? 'stop' : 'play') + '"/>';
  lbl.textContent = playing ? 'Stop' : 'Play';
}

function toggleFab() {
  if (busy) return;
  var fab = document.getElementById('fab');
  busy = true;
  fab.classList.add('busy');
  var p;
  if (!playing) {
    p = fetch('/api/chain/play', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: currentChain })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
        playing = true;
        return loadChain();
      });
    });
  } else {
    p = fetch('/api/chain/stop', { method: 'POST' }).then(function () { playing = false; });
  }
  p.catch(function (e) { toast('Play failed: ' + e.message); })
   .then(function () {
     busy = false;
     fab.classList.remove('busy');
     updateFabState();
   });
}
