/* TonePi — Guitar DSP Platform
 * Copyright (c) 2024-2026 Anirban Ray. All rights reserved.
 * Proprietary and confidential. */

/* KEEP THE LEVEL ACROSS A MODEL SWAP.
 *
 * Captures and IRs are not level-matched: swapping a 5150 capture for a
 * Princeton clean one dropped the chain 10 dB. Each model's loudness on
 * its own is measured once (tools/model_loudness.py -> /api/model_loudness:
 * the balance DI through that model alone); a swap moves the block's OWN
 * output trim by the difference, so the chain stays where it was
 * balanced. Clamped to the trim's range; a model that was never measured
 * leaves the trim alone. The Qt panel does the same (Router::levelTrim). */
const ModelLevel = (function () {
  const RULES = {
    neural_model: { kind: 'nam',  key: 'model_idx', param: 'output_db', lo: -12, hi: 12 },
    conv_cab:     { kind: 'ir',   key: 'ir_idx',    param: 'level_db',  lo: -24, hi: 12 },
    tonepi_cab:   { kind: 'grid', key: 'grid',      param: 'level_db',  lo: -24, hi: 24 },
  };
  let table = null;
  function load() {
    fetch('/api/model_loudness').then(r => r.json()).then(t => { table = t; }).catch(() => {});
  }
  load();

  /* Moves item's trim for `key` changing to newVal (before the caller
   * writes newVal). Returns {param, value} it set, or null. */
  function apply(item, key, newVal) {
    const r = item && RULES[item.block];
    if (!r || r.key !== key || !table) return null;
    const p = item.params || (item.params = {});
    const t = table[r.kind] || {};
    const from = t[String(p[key] !== undefined ? p[key] : '')];
    const to = t[String(newVal)];
    if (from === undefined || to === undefined || String(p[key]) === String(newVal)) return null;
    const cur = Number(p[r.param]) || 0;
    const v = Math.round(Math.min(r.hi, Math.max(r.lo, cur + from - to)) * 10) / 10;
    p[r.param] = v;
    return { param: r.param, value: v };
  }
  return { apply, load };
})();
