/*
 * TonePi Mobile -- Bluetooth transport (Web Bluetooth, e.g. Bluefy on iOS).
 *
 * Active only in the Bluetooth bundle (tools/build_ble_bundle.py sets
 * window.TP_BLE before this file). The page is served from an HTTPS host;
 * everything it would ask tonepi-web goes over BLE to web/ble_bridge.py
 * instead. To keep the app code untouched, this file replaces:
 *
 *   fetch('/api/...')            -> {t:"req"} over RX, {t:"res"} back on TX
 *   new WebSocket('.../ws/events') -> {t:"ev"} messages on TX
 *   new WebSocket('.../ws/meters') -> frames on the METER characteristic
 *
 * Wire format: web/ble/proto.py (packets of <= 180 bytes, stream ids,
 * optional raw deflate). Big GET replies are kept in IndexedDB by sha1;
 * the request carries the hash held and the rig answers {same:1} with no
 * body when it still matches -- /api/blocks is 1.2 MB on the air.
 */
(function () {
  'use strict';
  if (!window.TP_BLE) return;

  var SVC   = '7a6f0001-5e1b-4c1e-9b8a-746f6e657069';
  var RX    = '7a6f0002-5e1b-4c1e-9b8a-746f6e657069';
  var TX    = '7a6f0003-5e1b-4c1e-9b8a-746f6e657069';
  var METER = '7a6f0004-5e1b-4c1e-9b8a-746f6e657069';
  var F_FIRST = 1, F_LAST = 2, F_DEFLATE = 4;
  var WRITE_MAX = 180;              /* fits iOS's ATT MTU of 185 (182 per write) */
  var REQ_TIMEOUT_MS = 210000;      /* the rig's own forward timeout is 200 s */
  var PROGRESS_MIN = 48 * 1024;

  var origFetch = window.fetch.bind(window);
  var OrigWS = window.WebSocket;
  var enc = new TextEncoder(), dec = new TextDecoder();
  var canInflate = true;            /* inflateRaw below: plain JS, always there */

  var dev = null, rxChr = null, txChr = null, meterChr = null;
  var ready = false, connecting = false;
  var waiters = [];                 /* resolve() when ready */
  var pending = {};                 /* id -> {resolve, reject, timer, path, have} */
  var nextId = 1, nextSid = 1;
  var writeChain = Promise.resolve();
  var decodeChain = Promise.resolve();
  var sockets = [];                 /* FakeSocket instances */
  var meterSubs = 0;

  /* ── UI: connect overlay + progress strip ───────────────────────── */
  var ov, ovMsg, ovBtn, prog;
  function ui() {
    if (ov) return;
    var css = document.createElement('style');
    css.textContent =
      '#tpBle{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:18px;padding:24px;' +
      'background:rgba(8,9,12,.94);color:#e8e8ea;font:15px/1.4 -apple-system,system-ui,sans-serif;text-align:center}' +
      '#tpBle h2{margin:0;font-size:20px;letter-spacing:.06em}' +
      '#tpBle p{margin:0;max-width:320px;color:#a4a6ad}' +
      '#tpBle button{min-width:220px;min-height:52px;border-radius:12px;border:1px solid #3a7bd5;' +
      'background:linear-gradient(#2c5fa8,#1f4682);color:#fff;font:600 16px -apple-system,system-ui,sans-serif}' +
      '#tpBle button:disabled{opacity:.5}' +
      '#tpBleProg{position:fixed;left:0;right:0;top:0;height:3px;z-index:99998;background:#3a7bd5;' +
      'transform-origin:left;transform:scaleX(0);transition:transform .2s;display:none}';
    document.head.appendChild(css);
    ov = document.createElement('div'); ov.id = 'tpBle';
    ov.innerHTML = '<h2>TONEPI</h2><p id="tpBleMsg"></p><button id="tpBleBtn">Connect</button>';
    document.body.appendChild(ov);
    ovMsg = ov.querySelector('#tpBleMsg'); ovBtn = ov.querySelector('#tpBleBtn');
    ovBtn.addEventListener('click', function () { connect(true); });
    prog = document.createElement('div'); prog.id = 'tpBleProg';
    document.body.appendChild(prog);
  }
  function showOverlay(msg, btnText) {
    ui();
    ov.style.display = 'flex';
    ovMsg.textContent = msg;
    ovBtn.textContent = btnText || 'Connect';
    ovBtn.disabled = !btnText;
    ovBtn.style.display = btnText ? '' : 'none';
  }
  function hideOverlay() { if (ov) ov.style.display = 'none'; }
  function progress(frac) {
    if (!prog) return;
    if (frac == null) { prog.style.display = 'none'; return; }
    prog.style.display = 'block';
    prog.style.transform = 'scaleX(' + Math.max(0.02, Math.min(1, frac)) + ')';
  }

  /* ── cache (IndexedDB, falls back to memory) ────────────────────── */
  var mem = {}, dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        var r = indexedDB.open('tonepi-ble', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('resp'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { report('IndexedDB open failed: ' + (r.error && r.error.message)); res(null); };
        r.onblocked = function () { report('IndexedDB open blocked'); };
      } catch (e) { report('IndexedDB unavailable: ' + e.message); res(null); }
    });
    return dbp;
  }
  function cacheGet(path) {
    if (mem[path]) return Promise.resolve(mem[path]);
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (res) {
        try {
          var q = d.transaction('resp').objectStore('resp').get(path);
          q.onsuccess = function () { if (q.result) mem[path] = q.result; res(q.result || null); };
          q.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    }).then(function (hit) {
      /* the bundle's seed is taken from the rig at publish time: when it
       * differs from what this phone kept, it is the newer one */
      return seed(path, hit).then(function (s) { return s || hit; });
    });
  }
  function cachePut(path, ent) {
    mem[path] = ent;
    db().then(function (d) {
      if (!d) return;
      try {
        var tx = d.transaction('resp', 'readwrite');
        tx.objectStore('resp').put(ent, path);
        tx.onerror = function () { report('cache put ' + path + ': ' + (tx.error && tx.error.message)); };
      } catch (e) { report('cache put ' + path + ': ' + e.message); }
    });
  }
  /* Seed bodies shipped with the bundle (seed/index.json): the first
   * connect sends their hash instead of pulling 1.2 MB over the air. */
  var seedIdx = null;
  function seed(path, have) {
    if (!seedIdx) seedIdx = window.TP_BLE_SEED ? Promise.resolve(window.TP_BLE_SEED)
      : origFetch('seed/index.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; })
          .catch(function () { return {}; });
    return seedIdx.then(function (ix) {
      var e = ix[path];
      if (!e || (have && have.h === e.h)) return null;
      return origFetch(e.file + '?v=' + e.h.slice(0, 12)).then(function (r) {
        if (!r.ok) { report('seed ' + e.file + ': HTTP ' + r.status); return null; }
        return r.text();
      }).then(function (b) {
        if (b == null) return null;
        var ent = { h: e.h, body: b, ct: 'application/json' };
        cachePut(path, ent);
        report('seed ' + path + ': ' + b.length + ' chars');
        return ent;
      }).catch(function (x) { report('seed ' + path + ' failed: ' + (x && x.message || x)); return null; });
    });
  }

  /* ── framing ────────────────────────────────────────────────────── */
  function packets(bytes, sid) {
    var out = [], pos = 0, n = bytes.length, first = true;
    while (first || pos < n) {
      var hdr = first ? 6 : 2;
      var take = Math.min(WRITE_MAX - hdr, n - pos);
      var p = new Uint8Array(hdr + take);
      var flags = first ? F_FIRST : 0;
      if (pos + take >= n) flags |= F_LAST;
      p[0] = flags; p[1] = sid;
      if (first) { p[2] = n & 255; p[3] = (n >>> 8) & 255; p[4] = (n >>> 16) & 255; p[5] = (n >>> 24) & 255; }
      p.set(bytes.subarray(pos, pos + take), hdr);
      out.push(p);
      pos += take; first = false;
    }
    return out;
  }
  function send(msg) {
    var bytes = enc.encode(JSON.stringify(msg));
    var sid = nextSid; nextSid = nextSid % 255 + 1;
    var pk = packets(bytes, sid);
    var chr = rxChr;
    writeChain = writeChain.then(function () {
      var p = Promise.resolve();
      pk.forEach(function (b) {
        p = p.then(function () {
          if (!chr || chr !== rxChr) throw new Error('disconnected');
          return chr.writeValueWithResponse ? chr.writeValueWithResponse(b) : chr.writeValue(b);
        });
      });
      return p;
    });
    var done = writeChain;
    writeChain = writeChain.catch(function () { });
    return done;
  }

  /* Raw DEFLATE (RFC 1951) decoder in plain JS -- the rig's zlib with
   * wbits -15. Not DecompressionStream: on the iPhone (Bluefy) every
   * compressed reply vanished with it, so the page sat on "Loading chain".
   * One code path everywhere; 1.2 MB -> 13.6 MB decodes in well under a
   * second on a phone. Structure after tinf (J. Ibsen). */
  var inflateRaw = (function () {
    var LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    var LBITS = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    var DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,
                 4097,6145,8193,12289,16385,24577];
    var DBITS = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    var CLORD = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
    function Tree() { this.counts = new Uint16Array(16); this.syms = new Uint16Array(320); }
    function build(t, lens, off, n) {
      var i, offs = new Uint16Array(16), sum = 0;
      t.counts.fill(0);
      for (i = 0; i < n; i++) t.counts[lens[off + i]]++;
      t.counts[0] = 0;
      for (i = 0; i < 16; i++) { offs[i] = sum; sum += t.counts[i]; }
      for (i = 0; i < n; i++) if (lens[off + i]) t.syms[offs[lens[off + i]]++] = i;
    }
    var FL = new Tree(), FD = new Tree();
    (function () {
      var l = new Uint8Array(288), i;
      for (i = 0; i < 144; i++) l[i] = 8;
      for (; i < 256; i++) l[i] = 9;
      for (; i < 280; i++) l[i] = 7;
      for (; i < 288; i++) l[i] = 8;
      build(FL, l, 0, 288);
      var d = new Uint8Array(30).fill(5);
      build(FD, d, 0, 30);
    })();
    return function (src) {
      var pos = 0, tag = 0, nb = 0;
      var out = new Uint8Array(Math.max(1024, src.length * 4)), op = 0;
      function need(n) {
        if (op + n <= out.length) return;
        var b = new Uint8Array(Math.max(out.length * 2, op + n));
        b.set(out.subarray(0, op)); out = b;
      }
      function bit() {
        if (!nb) { if (pos >= src.length) throw new Error('inflate: truncated'); tag = src[pos++]; nb = 8; }
        var b = tag & 1; tag >>>= 1; nb--; return b;
      }
      function bits(n, base) {
        var v = 0;
        for (var i = 0; i < n; i++) v |= bit() << i;
        return v + base;
      }
      function sym(t) {
        var sum = 0, cur = 0, len = 0;
        do {
          cur = 2 * cur + bit();
          if (++len > 15) throw new Error('inflate: bad code');
          sum += t.counts[len];
          cur -= t.counts[len];
        } while (cur >= 0);
        return t.syms[sum + cur];
      }
      var LT = new Tree(), DT = new Tree(), lens = new Uint8Array(320);
      function dyn() {
        var hl = bits(5, 257), hd = bits(5, 1), hc = bits(4, 4), i;
        lens.fill(0);
        for (i = 0; i < hc; i++) lens[CLORD[i]] = bits(3, 0);
        var CT = new Tree(); build(CT, lens, 0, 19);
        var n = 0;
        while (n < hl + hd) {
          var s = sym(CT), prev, rep;
          if (s < 16) { lens[n++] = s; continue; }
          if (s === 16) { if (!n) throw new Error('inflate: bad repeat'); prev = lens[n - 1]; rep = bits(2, 3); }
          else if (s === 17) { prev = 0; rep = bits(3, 3); }
          else { prev = 0; rep = bits(7, 11); }
          while (rep--) lens[n++] = prev;
        }
        build(LT, lens, 0, hl);
        build(DT, lens, hl, hd);
      }
      function block(lt, dt) {
        for (;;) {
          var s = sym(lt);
          if (s === 256) return;
          if (s < 256) { need(1); out[op++] = s; continue; }
          s -= 257;
          if (s >= 29) throw new Error('inflate: bad length');
          var len = bits(LBITS[s], LBASE[s]);
          var d = sym(dt);
          if (d >= 30) throw new Error('inflate: bad distance');
          var dist = bits(DBITS[d], DBASE[d]);
          if (dist > op) throw new Error('inflate: distance too far');
          need(len);
          for (var k = 0; k < len; k++, op++) out[op] = out[op - dist];
        }
      }
      var last;
      do {
        last = bit();
        var type = bits(2, 0);
        if (type === 0) {
          nb = 0; tag = 0;                     /* to the byte boundary */
          if (pos + 4 > src.length) throw new Error('inflate: truncated');
          var len = src[pos] | (src[pos + 1] << 8);
          var nlen = src[pos + 2] | (src[pos + 3] << 8);
          if (len !== (~nlen & 0xffff)) throw new Error('inflate: bad stored block');
          pos += 4;
          if (pos + len > src.length) throw new Error('inflate: truncated');
          need(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len;
        } else if (type === 1) block(FL, FD);
        else if (type === 2) { dyn(); block(LT, DT); }
        else throw new Error('inflate: bad block type');
      } while (!last);
      return out.subarray(0, op);
    };
  })();
  function inflate(u8) {
    return new Promise(function (res) { res(inflateRaw(u8)); });
  }

  /* what goes wrong on the phone shows in the rig's journal */
  var reportQ = [];
  function report(what) {
    try { console.error('[ble]', what); } catch (e) { }
    reportQ.push(String(what).slice(0, 300));
    if (ready) flushReports();
  }
  function flushReports() {
    reportQ.splice(0).forEach(function (m) { send({ t: 'log', m: m }).catch(function () { }); });
  }

  function Reasm(onMsg) {
    var open = {}, lastSig = '', dupCount = 0;
    return function (ev) {
      var dv = ev.target.value;
      var u = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      if (u.length < 2) return;
      /* diagnostics: the same bytes twice in a row = the event read a value
       * that was already replaced (packets lost under it) */
      var sig = u.length + ':' + u[0] + ':' + u[1] + ':' + u[u.length >> 1] + ':' + u[u.length - 1];
      if (sig === lastSig) dupCount++;
      lastSig = sig;
      var flags = u[0], sid = u[1], st;
      if (flags & F_FIRST) {
        if (u.length < 6) return;
        var total = (u[2] | (u[3] << 8) | (u[4] << 16) | (u[5] << 24)) >>> 0;
        if (open[sid]) report('stream ' + sid + ' restarted at ' + open[sid].n + '/' + open[sid].total);
        st = open[sid] = { total: total, deflated: !!(flags & F_DEFLATE), buf: new Uint8Array(total), n: 0, pk: 1, d0: dupCount };
        st.buf.set(u.subarray(6, Math.min(u.length, 6 + total)), 0);
        st.n = Math.min(u.length - 6, total);
      } else {
        st = open[sid];
        if (!st) { report('continuation for unknown stream ' + sid + ' (' + u.length + ' B)'); return; }
        st.pk++;
        var c = u.subarray(2, Math.min(u.length, 2 + st.total - st.n));
        st.buf.set(c, st.n); st.n += c.length;
      }
      if (st.total >= PROGRESS_MIN) progress(st.n / st.total);
      if (!(flags & F_LAST)) return;
      delete open[sid];
      if (st.total >= PROGRESS_MIN) progress(null);
      if (st.n !== st.total || dupCount !== st.d0)
        report('stream ' + sid + ': ' + st.n + '/' + st.total + ' B in ' + st.pk + ' packets, '
               + (dupCount - st.d0) + ' repeated');
      var buf = st.buf.subarray(0, st.n), dfl = st.deflated;
      /* decode in arrival order: inflate is async */
      decodeChain = decodeChain.then(function () {
        return (dfl ? inflate(buf) : Promise.resolve(buf)).then(function (b) {
          onMsg(JSON.parse(dec.decode(b)));
        });
      }).catch(function (e) { report('bad message (' + buf.length + ' B' + (dfl ? ' deflated' : '') + '): ' + (e && e.message || e)); });
    };
  }

  /* ── rig -> phone ───────────────────────────────────────────────── */
  var helloWait = null;
  function onTx(msg) {
    if (msg.t === 'hello') { if (helloWait) { helloWait(msg); helloWait = null; } return; }
    if (msg.t === 'ev') {
      sockets.forEach(function (s) { if (s._kind === 'events') s._deliver(msg.d); });
      return;
    }
    if (msg.t !== 'res') return;
    var p = pending[msg.id];
    if (!p) return;
    delete pending[msg.id];
    clearTimeout(p.timer);
    var body;
    if (msg.same && p.have) body = p.have.body;
    else if (msg.b64) {
      var bin = atob(msg.b64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      body = arr;
    } else body = msg.b != null ? msg.b : '';
    if (msg.h && !msg.same && typeof body === 'string') cachePut(p.path, { h: msg.h, body: body, ct: msg.ct });
    var st = msg.s || 502;
    var noBody = st === 204 || st === 205 || st === 304;
    p.resolve(new Response(noBody ? null : body, {
      status: st === 304 ? 200 : st,
      headers: { 'Content-Type': msg.ct || (msg.same && p.have && p.have.ct) || 'application/json' }
    }));
  }
  function onMeter(msg) {
    var s = JSON.stringify(msg);
    sockets.forEach(function (k) { if (k._kind === 'meters') k._deliver(s); });
  }

  /* ── connection ─────────────────────────────────────────────────── */
  function whenReady() {
    if (ready) return Promise.resolve();
    return new Promise(function (res) { waiters.push(res); });
  }

  function attach(device, btnText, onLinked) {
    dev = device;
    if (!dev._tpWired) {
      dev._tpWired = true;
      dev.addEventListener('gattserverdisconnected', onDisconnect);
    }
    /* btnText: a silent reconnect keeps a button, so a tap can take over */
    showOverlay('Connecting to ' + (dev.name || 'TonePi') + '…', btnText);
    return dev.gatt.connect().then(function (srv) {
      if (onLinked) onLinked();
      return srv.getPrimaryService(SVC);
    }).then(function (svc) {
      return Promise.all([svc.getCharacteristic(RX), svc.getCharacteristic(TX), svc.getCharacteristic(METER)]);
    }).then(function (c) {
      rxChr = c[0]; txChr = c[1]; meterChr = c[2];
      txChr.addEventListener('characteristicvaluechanged', Reasm(onTx));
      meterChr.addEventListener('characteristicvaluechanged', Reasm(onMeter));
      showOverlay('If your phone asks to pair, enter the 6-digit code shown on the rig: SYSTEM › BLUETOOTH.');
      /* the first encrypted access is what makes iOS pair */
      return txChr.startNotifications();
    }).then(function () {
      var hello = new Promise(function (res, rej) {
        helloWait = res;
        setTimeout(function () { rej(new Error('the rig did not answer')); }, 15000);
      });
      send({ t: 'hello', z: canInflate ? 1 : 0 });
      return hello;
    }).then(function () {
      ready = true; connecting = false;
      hideOverlay();
      flushReports();
      if (meterSubs > 0) meterChr.startNotifications().catch(function () { });
      waiters.splice(0).forEach(function (f) { f(); });
      sockets.forEach(function (s) { s._open(); });
      try { localStorage.setItem('tpBleDevice', dev.id); } catch (e) { }
    });
  }

  /* A tap ALWAYS opens the chooser (it can only run from a tap) and
   * abandons a silent reconnect still pending: iOS holds gatt.connect() to
   * a remembered device open until it sees that device advertise, so a
   * button that waited on it would do nothing. The silent path (no tap)
   * gives up after SILENT_MS. */
  var SILENT_MS = 12000, attempt = 0;
  function connect(fromTap) {
    if (ready) return;
    if (connecting && !fromTap) return;
    if (!navigator.bluetooth) {
      showOverlay('This browser has no Web Bluetooth. On iPhone open this page in Bluefy.');
      return;
    }
    var my = ++attempt;
    if (connecting && dev && dev.gatt) { try { dev.gatt.disconnect(); } catch (e) { } }
    connecting = true;
    var pick;
    if (fromTap) {
      showOverlay('Pick TonePi in the list…');
      pick = navigator.bluetooth.requestDevice({ filters: [{ services: [SVC] }] });
    } else if (dev && dev.gatt) {
      showOverlay('Looking for the rig…', 'Connect');
      pick = new Promise(function (res, rej) {
        /* the limit covers FINDING the rig only, not pairing (typing the
         * code takes as long as it takes) */
        var t = setTimeout(function () { rej(new Error('rig not found nearby')); }, SILENT_MS);
        attach(dev, 'Connect', function () { clearTimeout(t); })
          .then(function (v) { clearTimeout(t); res(v); },
                function (e) { clearTimeout(t); rej(e); });
      });
    } else pick = Promise.reject(new Error('tap Connect'));
    var go = fromTap ? pick.then(function (d) { return attach(d); }) : pick;
    go.catch(function (e) {
      if (my !== attempt) return;          /* superseded by a tap */
      connecting = false;
      ready = false;
      if (!fromTap && dev && dev.gatt) { try { dev.gatt.disconnect(); } catch (x) { } }
      var why = (e && e.message) || String(e);
      showOverlay(why === 'tap Connect' ? 'Bluetooth remote for the rig.' : 'Not connected: ' + why,
                  'Connect');
    });
  }

  function onDisconnect() {
    var was = ready;
    ready = false; connecting = false;
    rxChr = txChr = meterChr = null;
    progress(null);
    Object.keys(pending).forEach(function (id) {
      var p = pending[id]; delete pending[id];
      clearTimeout(p.timer);
      p.reject(new TypeError('Bluetooth disconnected'));
    });
    sockets.slice().forEach(function (s) { s._drop(); });
    showOverlay('Connection to the rig lost.', 'Reconnect');
    /* one quiet retry: gatt.connect() needs no tap */
    if (was) setTimeout(function () { if (!ready && !connecting && dev) connect(false); }, 1500);
  }

  /* ── fetch ──────────────────────────────────────────────────────── */
  function bodyText(b) {
    if (b == null) return Promise.resolve(null);
    if (typeof b === 'string') return Promise.resolve(b);
    if (b instanceof URLSearchParams) return Promise.resolve(b.toString());
    if (b instanceof Blob) return b.text();
    return Promise.reject(new TypeError('BLE transport sends text bodies only'));
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var u;
    try { u = new URL(url, location.href); } catch (e) { return origFetch(input, init); }
    if (u.origin !== location.origin || u.pathname.indexOf('/api/') !== 0) return origFetch(input, init);
    init = init || {};
    var method = (init.method || (input && input.method) || 'GET').toUpperCase();
    var path = u.pathname + u.search;
    var headers = {};
    if (init.headers) {
      var h = new Headers(init.headers);
      h.forEach(function (v, k) { headers[k] = v; });
    }
    return Promise.all([bodyText(init.body), method === 'GET' ? cacheGet(path) : null])
      .then(function (r) {
        var body = r[0], have = r[1];
        return whenReady().then(function () {
          return new Promise(function (resolve, reject) {
            var id = nextId++;
            var msg = { t: 'req', id: id, m: method, p: path, h: headers };
            if (body != null) msg.b = body;
            if (have && have.h) msg.v = have.h;
            pending[id] = {
              resolve: resolve, reject: reject, path: path, have: have,
              timer: setTimeout(function () {
                if (pending[id]) { delete pending[id]; reject(new TypeError('Bluetooth request timed out')); }
              }, REQ_TIMEOUT_MS)
            };
            send(msg).catch(function (e) {
              var p = pending[id];
              if (p) { delete pending[id]; clearTimeout(p.timer); reject(new TypeError(String(e))); }
            });
          });
        });
      });
  };

  /* ── WebSocket ──────────────────────────────────────────────────── */
  function FakeSocket(url) {
    var path = '';
    try { path = new URL(url, location.href).pathname; } catch (e) { }
    this.url = url;
    this.readyState = 0;
    this._kind = path === '/ws/events' ? 'events' : path === '/ws/meters' ? 'meters' : null;
    this._l = {};
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    var self = this;
    if (!this._kind) { setTimeout(function () { self._drop(); }, 0); return; }
    sockets.push(this);
    if (this._kind === 'meters') {
      meterSubs++;
      if (ready && meterSubs === 1) meterChr.startNotifications().catch(function () { });
    }
    if (ready) setTimeout(function () { self._open(); }, 0);
    else if (!connecting) connect(false);
  }
  FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
  FakeSocket.prototype = {
    CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    _emit: function (type, ev) {
      ev.type = type; ev.target = this;
      if (typeof this['on' + type] === 'function') this['on' + type](ev);
      (this._l[type] || []).forEach(function (f) { f(ev); });
    },
    addEventListener: function (t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener: function (t, f) { this._l[t] = (this._l[t] || []).filter(function (g) { return g !== f; }); },
    _open: function () {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this._emit('open', {});
    },
    _deliver: function (data) { if (this.readyState === 1) this._emit('message', { data: data }); },
    _drop: function () {
      if (this.readyState === 3) return;
      var wasOpen = this.readyState;
      this.readyState = 3;
      this._unlist();
      if (wasOpen === 0 && !this._kind) this._emit('error', {});
      this._emit('close', { code: 1006, reason: 'bluetooth', wasClean: false });
    },
    _unlist: function () {
      var i = sockets.indexOf(this);
      if (i >= 0) {
        sockets.splice(i, 1);
        if (this._kind === 'meters' && --meterSubs === 0 && ready && meterChr)
          meterChr.stopNotifications().catch(function () { });
      }
    },
    send: function () { /* the app never sends on these feeds */ },
    close: function () {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this._unlist();
      this._emit('close', { code: 1000, reason: '', wasClean: true });
    }
  };
  window.WebSocket = FakeSocket;
  window.TPBle = { connect: function () { connect(true); }, origWebSocket: OrigWS,
                   isReady: function () { return ready; } };

  function boot() {
    showOverlay('Bluetooth remote for the rig. Keep the phone near it.', 'Connect');
    /* a phone this page already paired with: try it without the chooser */
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
      navigator.bluetooth.getDevices().then(function (list) {
        var want = null;
        try { want = localStorage.getItem('tpBleDevice'); } catch (e) { }
        var d = (list || []).filter(function (x) { return !want || x.id === want; })[0];
        if (d && !ready && !connecting) { dev = d; connect(false); }
      }).catch(function () { });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
