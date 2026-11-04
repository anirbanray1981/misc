/* TonePi — Guitar DSP Platform
 * Copyright (c) 2024-2026 Anirban Ray. All rights reserved.
 * Proprietary and confidential. */

/* XY AMP·CAB pad for the web editors (desktop params.js, mobile
 * mobile-params.js). Same behaviour as the panel's TpXyAmpCabPanel.qml:
 * the dots are the measured inventory (GET /api/xy/map), the amber puck is
 * the target, the white ring the amp + cab actually playing. Moves go to
 * POST /api/xy/move (at most ~30/s while dragging, `commit` on release);
 * the server sends the engine only what changed. x, y, resolved,
 * level_hold and the sources are kept on the chain item so a later full
 * apply or save carries them (and `filter`) -- never pushed as params: the engine has no
 * node called xy_amp_cab.
 *
 *   XYPad.build(container, item, { onChange(pid, value), onSplit() })
 */
const XYPad = (function () {
  const num = (v, d) => (v === undefined || v === null || v === '') ? d : Number(v);

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function build(container, item, opts) {
    opts = opts || {};
    const p = item.params || (item.params = {});
    const fid = item.faust_id || item.instanceId || 0;
    const drive = item.block === 'xy_drive';            // XY Drive: one pedal + its level
    const kq = drive ? '&kind=drive' : '';
    const lvKey = drive ? 'level_match' : 'level_hold';
    /* + AIR (bright_air): the brightness / VOICE axis counts 6.3-10 kHz too */
    let air = num(p.bright_air, 0) >= 0.5, airPending = false;
    const aq = () => '&air=' + (air ? 1 : 0);
    const st = { x: num(p.x, 0.5), y: num(p.y, 0.5), ax: -1, ay: -1, dots: [], busy: false, queued: null, dragging: false };
    /* ZOOM: the pad shows x in [vx, vx + 1/vs], y in [vy, vy + 1/vs] (as on the panel) */
    const view = { vs: 1, vx: 0, vy: 0 };
    const MAXZ = 12;
    const R = () => box.getBoundingClientRect();
    const sx = x => (x - view.vx) * view.vs;                 // data -> 0..1 of the box
    const sy = y => 1 - (y - view.vy) * view.vs;
    const dx = fx => view.vx + fx / view.vs;                 // 0..1 of the box -> data
    const dy = fy => view.vy + (1 - fy) / view.vs;
    /* zoomed in (>= 2x): the real pairs in view, labelled where they fit
     * (as on the panel); a tap near one plays exactly that pair */
    let cands = [], candT = null;
    function fetchCands() {
      if (view.vs < 2) { cands = []; paint(); return; }
      const q = 'x0=' + view.vx + '&x1=' + (view.vx + 1 / view.vs) + '&y0=' + view.vy + '&y1=' + (view.vy + 1 / view.vs) + '&nx=10&ny=7' +
                (nActive(filt) ? '&filter=' + encodeURIComponent(JSON.stringify(filt)) : '');
      fetch('/api/xy/points?' + q + kq + aq()).then(r => r.json()).then(d => { cands = d.points || []; paint(); }).catch(() => {});
    }
    function candAt(fx, fy) {
      if (view.vs < 2) return null;
      const r = R(); let best = null, bd = 12 * 12;
      for (const c of cands) { const dx_ = (sx(c.x) - fx) * r.width, dy_ = (sy(c.y) - fy) * r.height, d = dx_ * dx_ + dy_ * dy_;
        if (d < bd) { bd = d; best = c; } }
      return best;
    }
    function clampView() {
      clearTimeout(candT); candT = setTimeout(fetchCands, 250);
      view.vs = Math.max(1, Math.min(MAXZ, view.vs));
      view.vx = Math.max(0, Math.min(1 - 1 / view.vs, view.vx));
      view.vy = Math.max(0, Math.min(1 - 1 / view.vs, view.vy));
      zoomBtn.hidden = view.vs <= 1.01;
      zoomBtn.textContent = 'Zoom ' + view.vs.toFixed(1) + '× · reset';
      paint(); draw();
    }
    function zoomAt(f, fx, fy) {
      const x = dx(fx), y = dy(fy);
      view.vs = Math.max(1, Math.min(MAXZ, view.vs * f));
      view.vx = x - fx / view.vs; view.vy = y - (1 - fy) / view.vs;
      clampView();
    }
    const set = (k, v) => { p[k] = v; if (opts.onChange) opts.onChange(k, v); };

    const wrap = el('div', 'display:flex;flex-direction:column;gap:8px;margin:6px 0 10px');
    const playing = el('div', 'font:12px var(--mono, monospace);color:#8b93a0;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
    const box = el('div', 'position:relative;width:100%;aspect-ratio:16/9;max-height:420px;background:#08090b;border:1px solid #3a3f4a;border-radius:6px;touch-action:none;cursor:crosshair;overflow:hidden');
    const cv = el('canvas', 'position:absolute;inset:0;width:100%;height:100%');
    const ring = el('div', 'position:absolute;width:16px;height:16px;border:2px solid #fff;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:2;display:none;transition:left .12s,top .12s');
    const puck = el('div', 'position:absolute;width:30px;height:30px;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;background:#F39C12;box-shadow:0 0 14px rgba(243,156,18,.6)');
    const zoomBtn = el('button', 'position:absolute;right:6px;top:6px;z-index:3;font:600 11px sans-serif;letter-spacing:.08em;color:#F39C12;background:rgba(0,0,0,.7);border:1px solid #F39C12;border-radius:4px;padding:3px 8px;cursor:pointer');
    zoomBtn.hidden = true;
    box.append(cv, ring, puck, zoomBtn);
    const axes = el('div', 'display:flex;justify-content:space-between;font:600 11px sans-serif;letter-spacing:.12em;color:#8b93a0');
    axes.append(el('span', '', drive ? 'CLEAN BOOST' : 'CLEAN'), el('span', 'color:#F39C12', drive ? 'GAIN →   ·   VOICE ↑' : 'GAIN →   ·   BRIGHTNESS ↑'),
                el('span', '', drive ? 'FUZZ' : 'HIGH GAIN'));

    const row = el('div', 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:13px');
    const readout = el('span', 'font:12px monospace;color:#e5e7eb;min-width:180px');
    const hold = el('label', 'display:flex;gap:4px;align-items:center');
    const holdCb = el('input'); holdCb.type = 'checkbox'; holdCb.checked = num(p[lvKey], 1) >= 0.5;
    hold.append(holdCb, document.createTextNode(drive ? 'Level match' : 'Level hold'));
    // XY Drive: PUSH, a trim on top of the match (or the natural level)
    const push = el('input', 'width:70px'); push.type = 'number'; push.step = '0.5'; push.min = '-24'; push.max = '24';
    push.value = num(p.push_db, 0); push.title = 'Push (dB)';
    if (drive) hold.append(document.createTextNode('  Push dB '), push);
    const airLbl = el('label', 'display:flex;gap:4px;align-items:center');
    airLbl.title = (drive ? 'VOICE' : 'Brightness') + ' counts the air band (6.3-10 kHz) too: a thin, scooped sound no longer reads as bright';
    const airCb = el('input'); airCb.type = 'checkbox'; airCb.checked = air;
    airLbl.append(airCb, document.createTextNode('+ Air (>6 kHz)'));
    const filtBtn = el('button', '', 'Filter: all'); filtBtn.className = 'btn';
    const split = el('button', '', 'Split into amp + cab'); split.className = 'btn';
    row.append(readout, hold, airLbl, filtBtn, split);
    let filt = (p.filter && typeof p.filter === 'object') ? p.filter : {};
    const nActive = f => Object.keys(f).filter(k => (f[k] || []).length).length;
    const showFilt = () => { const n = nActive(filt); filtBtn.textContent = n ? 'Filter: ' + n + ' active' : 'Filter: all';
                             filtBtn.style.color = n ? '#F39C12' : ''; };
    showFilt();
    wrap.append(playing, box, axes, row);
    container.appendChild(wrap);

    function paint() {
      const r = box.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d);
      const g = cv.getContext('2d');
      g.strokeStyle = '#23262e'; g.lineWidth = 1;
      for (let i = 1; i < 10; i++) {
        const gx = sx(i / 10) * cv.width, gy = sy(i / 10) * cv.height;
        if (gx > 0 && gx < cv.width) { g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, cv.height); g.stroke(); }
        if (gy > 0 && gy < cv.height) { g.beginPath(); g.moveTo(0, gy); g.lineTo(cv.width, gy); g.stroke(); }
      }
      g.fillStyle = 'rgba(243,156,18,.3)';
      const rr = 1.6 * d * Math.min(2, Math.sqrt(view.vs));
      for (const [x, y] of st.dots) {
        const px = sx(x) * cv.width, py = sy(y) * cv.height;
        if (px < -rr || py < -rr || px > cv.width + rr || py > cv.height + rr) continue;
        g.beginPath(); g.arc(px, py, rr, 0, 7); g.fill();
      }
      if (cands.length) {
        const cr = 3 * d, fs = 11 * d, lh = fs * 1.25, W = cv.width, H = cv.height;
        g.fillStyle = '#F39C12';
        for (const c of cands) { g.beginPath(); g.arc(sx(c.x) * W, sy(c.y) * H, cr, 0, 7); g.fill(); }
        g.font = fs + 'px sans-serif';
        const placed = [{ l: W - 170 * d, t: 0, r: W, b: 30 * d }];
        const order = cands.slice().sort((a, b) => Math.hypot(sx(a.x) - .5, sy(a.y) - .5) - Math.hypot(sx(b.x) - .5, sy(b.y) - .5));
        for (const c of order) {
          const w = Math.max(g.measureText(c.amp).width, g.measureText(c.cab).width) + 6 * d;
          let l = sx(c.x) * W + cr + 3 * d; if (l + w > W) l = sx(c.x) * W - cr - 3 * d - w;
          const box = { l, t: sy(c.y) * H - lh, r: l + w, b: sy(c.y) * H + lh };
          if (box.t < 0 || box.b > H || box.l < 0) continue;
          if (placed.some(p => !(box.r < p.l || box.l > p.r || box.b < p.t || box.t > p.b))) continue;
          placed.push(box);
          g.fillStyle = 'rgba(8,9,11,.85)'; g.fillRect(box.l, box.t, w, 2 * lh);
          g.fillStyle = '#e5e7eb'; g.fillText(c.amp, box.l + 3 * d, box.t + fs);
          g.fillStyle = '#8b93a0'; g.fillText(c.cab, box.l + 3 * d, box.t + fs + lh);
        }
      }
    }
    function draw() {
      puck.style.left = (sx(st.x) * 100) + '%'; puck.style.top = (sy(st.y) * 100) + '%';
      if (st.ax >= 0) { ring.style.display = 'block'; ring.style.left = (sx(st.ax) * 100) + '%'; ring.style.top = (sy(st.ay) * 100) + '%'; }
      const lv = p.resolved && p.resolved.cab ? num(p.resolved.cab.params.level_db, 0) : null;
      readout.textContent = 'x ' + st.x.toFixed(3) + ' y ' + st.y.toFixed(3) +
        (st.ax >= 0 ? ' · plays ' + st.ax.toFixed(3) + ', ' + st.ay.toFixed(3) : '') +
        (lv !== null ? ' · trim ' + (lv >= 0 ? '+' : '') + lv.toFixed(1) + ' dB' : '');
    }
    function send(commit, extra) {
      if (st.busy) { const q = st.queued || {}; st.queued = { commit: q.commit || !!commit, extra: extra || q.extra }; return; }
      st.busy = true;
      const body = Object.assign({ fid, x: st.x, y: st.y, commit: !!commit, bright_air: air ? 1 : 0 }, extra || {});
      fetch('/api/xy/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => r.json()).then(d => {
          if (d && d.resolved) {
            st.ax = d.x; st.ay = d.y; set('resolved', d.resolved);
            // released: the puck settles on what is playing (see TpXyAmpCabPanel.qml)
            if (body.commit && !st.dragging && !st.queued) {
              st.x = d.x; st.y = d.y;
              set('x', Math.round(d.x * 1e4) / 1e4); set('y', Math.round(d.y * 1e4) / 1e4);
            }
            playing.textContent = (d.amp || '') + '   +   ' + (d.cab || '');
          } else if (d && d.error) playing.textContent = d.error;
          draw();
        }).catch(() => {}).finally(() => {
          st.busy = false;
          if (st.queued) { const n = st.queued; st.queued = null; send(n.commit, n.extra); }
        });
    }
    let dirty = false;
    const timer = setInterval(() => { if (!document.body.contains(box)) { clearInterval(timer); return; } if (dirty) { dirty = false; send(false); } }, 33);
    function moveTo(e, commit) {
      const r = R();
      st.x = Math.max(0, Math.min(1, dx((e.clientX - r.left) / r.width)));
      st.y = Math.max(0, Math.min(1, dy((e.clientY - r.top) / r.height)));
      set('x', Math.round(st.x * 1e4) / 1e4); set('y', Math.round(st.y * 1e4) / 1e4);
      draw();
      if (commit) send(true); else dirty = true;
    }
    /* one pointer moves the puck; two pinch (zoom about their middle) and pan */
    const ptrs = new Map();
    let pinch = null;
    const mid = () => { const a = [...ptrs.values()], r = R();
      return { fx: ((a[0].x + a[1].x) / 2 - r.left) / r.width, fy: ((a[0].y + a[1].y) / 2 - r.top) / r.height,
               d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };
    box.addEventListener('pointerdown', e => {
      if (e.target === zoomBtn) return;
      try { box.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { st.dragging = false; pinch = mid(); return; }   // a pinch, not a drag
      if (ptrs.size === 1) {
        const r = R(), c = candAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        if (c) {                                   // a labelled candidate: exactly that pair
          st.x = c.x; st.y = c.y; set('x', c.x); set('y', c.y); draw();
          send(true, { pick: { amp: c.amp_id, cab: c.cab_id } }); ptrs.delete(e.pointerId); return;
        }
        st.dragging = true; moveTo(e, false);
      }
    });
    box.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        const m = mid();
        view.vx -= (m.fx - pinch.fx) / view.vs; view.vy += (m.fy - pinch.fy) / view.vs;   // pan
        if (pinch.d > 0) zoomAt(m.d / pinch.d, m.fx, m.fy); else clampView();
        pinch = m;
      } else if (st.dragging) moveTo(e, false);
    });
    const end = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (!st.dragging) return;
      st.dragging = false; moveTo(e, true);
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    /* the wheel zooms the pad (a trackpad pinch arrives as ctrl+wheel) */
    box.addEventListener('wheel', e => {
      e.preventDefault();
      const r = R();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }, { passive: false });
    zoomBtn.addEventListener('click', e => { e.stopPropagation(); view.vs = 1; view.vx = 0; view.vy = 0; clampView(); });
    // the pair keeps playing: only the axis moves; once the puck is on the
    // pair's new spot, a commit there stores the flag (see loadMap)
    airCb.addEventListener('change', () => { air = airCb.checked; set('bright_air', air ? 1 : 0); airPending = true; cands = []; loadMap(); fetchCands(); });
    holdCb.addEventListener('change', () => { const v = holdCb.checked ? 1 : 0; set(lvKey, v); send(true, { [lvKey]: v }); });
    push.addEventListener('change', () => { const v = Math.max(-24, Math.min(24, Number(push.value) || 0)); set('push_db', v); send(true, { push_db: v }); });
    filtBtn.addEventListener('click', () => openFilter(filt, drive ? 'drive' : '', f => {
      filt = f; set('filter', f); showFilt(); send(true, { filter: f }); loadMap();
    }));
    split.addEventListener('click', () => { if (opts.onSplit) opts.onSplit(); });
    function loadMap() {
      const fq = nActive(filt) ? '&filter=' + encodeURIComponent(JSON.stringify(filt)) : '';
      fetch('/api/xy/map?fid=' + encodeURIComponent(fid) + fq + kq + aq()).then(r => r.json()).then(d => {
        st.dots = d.dots || [];
        if (d.filter) { filt = d.filter; showFilt(); }
        if (d.x_actual !== undefined) {
          st.ax = d.x_actual; st.ay = d.y_actual;
          if (!st.dragging) { st.x = d.x_actual; st.y = d.y_actual; }   // at rest: the puck shows what plays
          if (airPending && !st.dragging) { airPending = false; send(true); }
        }
        if (d.amp) playing.textContent = d.amp + '   +   ' + d.cab;
        paint(); draw();
      }).catch(() => {});
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(paint).observe(box);
    loadMap(); draw();
  }

  /* The FILTER sheet (as the panel's TpXyFilterSheet): chips from
   * /api/xy/facets, OR within a group, AND across; nothing = everything. */
  function openFilter(start, kind, done) {
    const sel = {}; for (const k in start || {}) sel[k] = new Set(start[k]);
    const ov = el('div', 'position:fixed;inset:0;z-index:9999;background:rgba(4,5,7,.65);display:flex;align-items:center;justify-content:center;padding:16px');
    const sh = el('div', 'background:#16181d;border:1px solid #3a3f4a;border-radius:8px;width:min(960px,100%);max-height:92vh;display:flex;flex-direction:column;color:#e5e7eb;font-family:sans-serif');
    const head = el('div', 'display:flex;gap:14px;align-items:baseline;padding:12px 16px;border-bottom:1px solid #23262e');
    head.append(el('b', 'color:#F39C12;letter-spacing:.14em', 'FILTER'));
    const count = el('span', 'font:12px monospace;color:#8b93a0'); head.append(count);
    const body = el('div', 'overflow:auto;padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px 20px');
    const foot = el('div', 'display:flex;gap:10px;align-items:center;padding:10px 16px;border-top:1px solid #23262e');
    foot.append(el('span', 'flex:1;font-size:12px;color:#4b5563', 'Nothing selected in a group = everything in it.'));
    const clear = el('button', '', 'Clear all'); clear.className = 'btn';
    const ok = el('button', 'background:#F39C12;color:#111;border-color:#F5B041', 'Done'); ok.className = 'btn';
    const cancel = el('button', '', 'Cancel'); cancel.className = 'btn';
    foot.append(cancel, clear, ok);
    sh.append(head, body, foot); ov.append(sh); document.body.appendChild(ov);
    const plain = () => { const o = {}; for (const k in sel) if (sel[k].size) o[k] = [...sel[k]]; return o; };
    let match = null, groups = [];
    function render() {
      body.innerHTML = '';
      for (const g of groups) {
        const s = sel[g.k] || (sel[g.k] = new Set());
        const box = el('div', (g.k === 'amp_fam' || g.k === 'speaker') ? 'grid-column:span 2' : '');
        const h = el('div', 'display:flex;justify-content:space-between;font:600 11px sans-serif;letter-spacing:.14em;color:#8b93a0;margin-bottom:6px');
        h.append(el('span', '', g.t), el('span', 'font-family:monospace;letter-spacing:0;color:#4b5563', s.size ? s.size + ' selected' : 'all'));
        const chips = el('div', 'display:flex;flex-wrap:wrap;gap:6px');
        for (const [name, n] of g.chips) {
          const on = s.has(name);
          const c = el('button', 'border-radius:999px;padding:4px 10px;font:600 12px sans-serif;cursor:pointer;border:1px solid ' + (on ? '#F39C12' : '#3a3f4a') +
                        ';background:' + (on ? 'rgba(243,156,18,.12)' : '#08090b') + ';color:' + (on ? '#F39C12' : '#8b93a0') + ';opacity:' + (n ? 1 : .45));
          c.textContent = name + '  ' + n;
          c.onclick = () => { on ? s.delete(name) : s.add(name); refresh(); };
          chips.append(c);
        }
        box.append(h, chips); body.append(box);
      }
      const k = Object.keys(plain()).length;
      const mt = match ? Object.keys(match).map(x => match[x] + ' ' + x).join(' · ') : '';
      count.textContent = !k ? 'everything · no filter' : (match ? mt + ' match · ' + k + (k > 1 ? ' filters' : ' filter') : '');
      const none = k && match && Object.values(match).some(v => !v);
      count.style.color = none ? '#E74C3C' : '#8b93a0'; ok.disabled = !!none; ok.style.opacity = none ? .4 : 1;
    }
    function refresh() {
      fetch('/api/xy/facets?filter=' + encodeURIComponent(JSON.stringify(plain())) + (kind === 'drive' ? '&kind=drive' : '')).then(r => r.json()).then(d => {
        groups = d.groups || []; match = d.match; render(); }).catch(() => render());
      render();
    }
    clear.onclick = () => { for (const k in sel) sel[k].clear(); refresh(); };
    cancel.onclick = () => ov.remove();
    ok.onclick = () => { ov.remove(); done(plain()); };
    refresh();
  }

  /* The two real blocks a composite is playing, as chain items. */
  function splitItems(item, nextId) {
    const r = (item.params || {}).resolved;
    if (!r) return null;
    const sl = item.block === 'xy_drive' ? [r.pedal, r.level] : [r.amp, r.cab];
    if (!sl[0] || !sl[1]) return null;
    return sl.map(s => ({ type: 'block', block: s.block, instanceId: nextId(), version: 1,
                                      params: Object.assign({}, s.params || {}), stereo: false, disabled: !!item.disabled }));
  }

  return { build, splitItems };
})();
