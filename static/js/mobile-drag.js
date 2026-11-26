/*
 * TonePi Mobile — touch drag-and-drop for the Designer screen's chain
 * lane and parallel lanes. Ported 1:1 from a validated interactive
 * mockup (agy design consult + Playwright synthetic-touch testing,
 * every scenario below confirmed working before this file was
 * written): plain tap, long-press-with-no-move -> action sheet,
 * long-press-then-move -> live drag, reorder within a container,
 * cross-container moves (chain<->lane, lane<->lane), and drop-in-
 * dead-space -> cancel with no state mutation.
 *
 * Native HTML5 drag-and-drop (what desktop's chain.js uses) is
 * unreliable on iOS Safari, which this installed PWA targets — this
 * is a from-scratch pointer-event implementation instead, replacing
 * (not layering on top of) the plain attachLongPress() call at each
 * chip: attachDraggable() owns both the long-press timer AND the
 * drag state machine, falling through to the same action-sheet
 * callback attachLongPress() used to call directly when the finger
 * lifts without crossing the drag-start threshold.
 *
 * KNOWN UNVERIFIED RISK: whether iOS Safari actually honours
 * `preventDefault()` on `touchmove` fired well after the initiating
 * `touchstart` (i.e. after the 480ms arm timer, not synchronously) —
 * Chromium's touch emulation (used for all testing so far, including
 * this file's own verification pass) does not reproduce this
 * Safari-specific quirk. If real-device testing shows the lane/chain
 * strip still scrolls out from under an armed drag on iPhone, the
 * documented fallback is a dedicated grab-handle glyph (Option A from
 * the design consult) instead of the long-press-to-arm gesture.
 *
 * Container addressing: 'chain' = currentChain; 'lane:P:L' =
 * currentChain[P].lanes[L]. Callers register a container's DOM
 * element with data-drop-container="<key>" — see renderChainLane()
 * (mobile-chain.js) and renderLaneChips() (mobile-parallel.js).
 */

/* LONG_PRESS_MS is already declared by mobile-state.js's attachLongPress
 * (still used as-is for non-draggable long-press rows, e.g. banks) —
 * reuse that same constant/timing rather than redeclaring it. */
var DRAG_CANCEL_MOVE_PX = 10;   // movement before the arm timer fires -> treat as scroll
var DRAG_START_PX = 6;          // movement after arming -> promote to a live drag
var V_HOTZONE_FRAC = 0.12;
var H_HOTZONE_FRAC = 0.15;
var GHOST_Y_OFFSET = -50;       // keeps the ghost above the fingertip, not hidden under it

var _drag = null;

function resolveContainer(key) {
  if (key === 'chain') return currentChain;
  var m = /^lane:(\d+):(\d+)$/.exec(key);
  if (!m) return null;
  var p = currentChain[+m[1]];
  return (p && p.type === 'parallel' && p.lanes) ? p.lanes[+m[2]] : null;
}

function selectForContainer(key, idx) {
  if (key === 'chain') {
    selectedIdx = idx; selectedLane = -1; selectedLaneBlock = -1;
    return;
  }
  var m = /^lane:(\d+):(\d+)$/.exec(key);
  if (m) { selectedIdx = +m[1]; selectedLane = +m[2]; selectedLaneBlock = idx; }
}

/* Attach the drag+long-press engine to one chip. containerKey/idx are
 * this chip's CURRENT address (re-attached fresh on every render, same
 * as attachLongPress was). onActionSheet is called on a still release,
 * exactly replacing the old attachLongPress(chip, onActionSheet) call.
 *
 * Touch listens on chip.chip-handle SPECIFICALLY, not the whole chip —
 * touch-action:none has to be in place on the actual target before the
 * touch begins (see the CSS comment on .chip-handle); putting it on
 * the whole chip would make the chain lane's own horizontal scroll
 * unreachable by touching a chip directly, and NOT putting it there
 * lets the browser's native scroll win the race against a live drag
 * (confirmed on real hardware: the strip scrolled instead of the chip
 * dragging, and the aborted gesture then resolved as a plain tap,
 * selecting the block instead). contextmenu (desktop right-click)
 * stays on the whole chip — mouse has no such conflict. */
function attachDraggable(chip, containerKey, idx, onActionSheet) {
  var handle = chip.querySelector('.chip-handle') || chip;
  handle.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;           // mouse: contextmenu path only, below
    if (_drag) return;
    beginPending(chip, containerKey, idx, e, onActionSheet);
  });
  chip.addEventListener('contextmenu', function (e) { e.preventDefault(); onActionSheet(); });
}

function beginPending(chip, containerKey, idx, e, onActionSheet) {
  _drag = {
    phase: 'pending', chip: chip, container: containerKey, idx: idx,
    onActionSheet: onActionSheet,
    startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
  };
  _drag.armTimer = setTimeout(armDrag, LONG_PRESS_MS);
  document.addEventListener('pointermove', onDragPointerMove);
  document.addEventListener('pointerup', onDragPointerUp);
  document.addEventListener('pointercancel', onDragPointerUp);
}

function onDragPointerMove(e) {
  if (!_drag) return;
  var dx = e.clientX - _drag.startX, dy = e.clientY - _drag.startY;
  _drag.lastX = e.clientX; _drag.lastY = e.clientY;

  if (_drag.phase === 'pending') {
    if (Math.hypot(dx, dy) > DRAG_CANCEL_MOVE_PX) {
      clearTimeout(_drag.armTimer);
      cleanupDrag();
    }
    return;
  }
  if (_drag.phase === 'armed') {
    e.preventDefault();
    if (Math.hypot(e.clientX - _drag.armX, e.clientY - _drag.armY) > DRAG_START_PX) {
      startLiveDrag(e);
    }
    return;
  }
  if (_drag.phase === 'dragging') {
    e.preventDefault();
    updateGhostPosition(e.clientX, e.clientY);
    updateDropTarget(e.clientX, e.clientY);
  }
}

function onDragPointerUp() {
  if (!_drag) return;
  if (_drag.phase === 'pending') {
    clearTimeout(_drag.armTimer);
    cleanupDrag();
    return;
  }
  if (_drag.phase === 'armed') {
    _drag.chip.classList.remove('drag-armed');
    var cb = _drag.onActionSheet;
    cleanupDrag();
    cb();
    return;
  }
  if (_drag.phase === 'dragging') {
    commitOrCancelDrag();
  }
}

function armDrag() {
  if (!_drag || _drag.phase !== 'pending') return;
  _drag.phase = 'armed';
  _drag.armX = _drag.lastX; _drag.armY = _drag.lastY;
  _drag.chip.classList.add('drag-armed');
  if (navigator.vibrate) navigator.vibrate(50);
}

function startLiveDrag(e) {
  _drag.phase = 'dragging';
  var arr = resolveContainer(_drag.container);
  _drag.item = arr && arr[_drag.idx];
  if (!_drag.item) { cleanupDrag(); return; }
  _drag.curContainer = _drag.container;
  _drag.curIdx = _drag.idx;

  var rect = _drag.chip.getBoundingClientRect();
  _drag.origRect = rect;
  _drag.chip.classList.remove('drag-armed');
  _drag.chip.classList.add('drag-placeholder');

  var d = describeChainItem(_drag.item);
  var ghost = document.createElement('div');
  ghost.className = 'block-chip drag-ghost';
  ghost.style.setProperty('--chip-color', d.color);
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.innerHTML = '<div class="b-name">' + escapeHtml(d.name) + '</div><div class="b-cat">' + escapeHtml(d.cat) + '</div>';
  document.body.appendChild(ghost);
  _drag.ghostEl = ghost;

  updateGhostPosition(e.clientX, e.clientY);
  _drag.rafId = requestAnimationFrame(autoScrollTick);
}

function updateGhostPosition(x, y) {
  _drag.lastX = x; _drag.lastY = y;
  _drag.ghostEl.style.left = (x - 43) + 'px';
  _drag.ghostEl.style.top = (y + GHOST_Y_OFFSET - 45) + 'px';
}

function allDropContainers() {
  return Array.prototype.slice.call(document.querySelectorAll('[data-drop-container]'));
}
function hideAllInsertLines() {
  allDropContainers().forEach(function (el) {
    var line = el.querySelector('.drag-insert-line');
    if (line) line.style.display = 'none';
    el.classList.remove('drag-hover-target');
  });
}
function containerElAtPoint(x, y) {
  var els = allDropContainers();
  for (var i = 0; i < els.length; i++) {
    var r = els[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top - 20 && y <= r.bottom + 20) return els[i];
  }
  return null;
}
function ensureInsertLine(containerEl) {
  var line = containerEl.querySelector('.drag-insert-line');
  if (!line) {
    line = document.createElement('div');
    line.className = 'drag-insert-line';
    containerEl.appendChild(line);
  }
  return line;
}

function updateDropTarget(x, y) {
  hideAllInsertLines();
  var containerEl = containerElAtPoint(x, y);
  if (!containerEl) { _drag.curContainer = null; _drag.curIdx = null; return; }

  var key = containerEl.dataset.dropContainer;
  containerEl.classList.add('drag-hover-target');
  var slots = Array.prototype.slice.call(containerEl.querySelectorAll(':scope > .block-chip:not(.drag-placeholder)'));
  var gapIdx = slots.length, gapX = null;
  for (var i = 0; i < slots.length; i++) {
    var r = slots[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) { gapIdx = i; gapX = r.left; break; }
  }
  if (gapX === null) {
    if (slots.length) gapX = slots[slots.length - 1].getBoundingClientRect().right;
    else gapX = containerEl.getBoundingClientRect().left + 10;
  }
  _drag.curContainer = key;
  _drag.curIdx = gapIdx;

  var line = ensureInsertLine(containerEl);
  var stripRect = containerEl.getBoundingClientRect();
  line.style.left = Math.max(2, gapX - stripRect.left - 2) + 'px';
  line.style.display = 'block';
}

function autoScrollTick() {
  if (!_drag || _drag.phase !== 'dragging') return;
  // Vertical: only #paramArea actually scrolls (the top chain lane is
  // always visible, fixed above it) — hotzone is that element's own
  // bounding rect, not the viewport.
  var paramArea = document.getElementById('paramArea');
  if (paramArea) {
    var pr = paramArea.getBoundingClientRect();
    var y = _drag.lastY;
    var topZone = pr.top + pr.height * V_HOTZONE_FRAC;
    var botZone = pr.bottom - pr.height * V_HOTZONE_FRAC;
    if (y > pr.top && y < topZone) {
      paramArea.scrollTop -= 1 + (1 - (y - pr.top) / (topZone - pr.top)) * 14;
    } else if (y < pr.bottom && y > botZone) {
      paramArea.scrollTop += 1 + ((y - botZone) / (pr.bottom - botZone)) * 14;
    }
  }
  // Horizontal: whichever strip is currently hovered.
  var containerEl = containerElAtPoint(_drag.lastX, _drag.lastY);
  if (containerEl) {
    var r = containerEl.getBoundingClientRect();
    var x = _drag.lastX;
    var leftZone = r.left + r.width * H_HOTZONE_FRAC;
    var rightZone = r.right - r.width * H_HOTZONE_FRAC;
    if (x > r.left && x < leftZone) containerEl.scrollLeft -= 6;
    else if (x < r.right && x > rightZone) containerEl.scrollLeft += 6;
  }
  // Re-evaluate the drop target/insert-line every tick, not just on
  // pointermove — the finger can be perfectly still while auto-scroll
  // keeps shifting chips underneath it, and a target computed before
  // that scroll goes stale (found via real-device-style testing: a
  // held drag near an edge committed to the position that WAS under
  // the finger before scrolling, not the one visually there at drop).
  updateDropTarget(_drag.lastX, _drag.lastY);
  _drag.rafId = requestAnimationFrame(autoScrollTick);
}

/* Removing an earlier top-level chain item shifts every later item's
 * index — including a parallel node's, which a lane's container key
 * ('lane:P:L') embeds. destArr itself stays a valid reference (arrays
 * are reference types, unaffected by their parent's reordering), but
 * a container key string parsed AFTER that removal is stale by one.
 * Matches desktop's chain.js makeLaneDropZone: "Adjust chainIdx if
 * the removed item was before the parallel node." Only 'chain' as the
 * SOURCE can shift a lane's parent index this way — removing from
 * inside one lane array never renumbers currentChain or any other
 * lane array. */
function adjustContainerKeyAfterRemoval(key, removedFrom, removedIdx) {
  if (removedFrom !== 'chain') return key;
  var m = /^lane:(\d+):(\d+)$/.exec(key);
  if (!m) return key;
  var p = +m[1];
  if (removedIdx < p) p -= 1;
  return 'lane:' + p + ':' + m[2];
}

function commitOrCancelDrag() {
  cancelAnimationFrame(_drag.rafId);
  hideAllInsertLines();
  if (_drag.curContainer != null && _drag.curIdx != null) {
    var srcArr = resolveContainer(_drag.container);
    var destArr = resolveContainer(_drag.curContainer);
    if (!srcArr || !destArr) { abortDrag(); return; }
    var item = srcArr.splice(_drag.idx, 1)[0];
    var destKey = adjustContainerKeyAfterRemoval(_drag.curContainer, _drag.container, _drag.idx);
    var destIdx = _drag.curIdx;
    if (_drag.curContainer === _drag.container && destIdx > _drag.idx) destIdx -= 1;
    destArr.splice(destIdx, 0, item);
    selectForContainer(destKey, destIdx);
    dirty = true;
    _drag.ghostEl.remove();
    var topIdx = selectedIdx;
    cleanupDrag();
    renderChainLane();
    renderParamPanel(topIdx);
    updateHeader();
  } else {
    abortDrag();
  }
}

function abortDrag() {
  var g = _drag.ghostEl, r = _drag.origRect, chip = _drag.chip;
  g.classList.add('drag-snapback');
  g.style.left = r.left + 'px';
  g.style.top = r.top + 'px';
  setTimeout(function () {
    g.remove();
    chip.classList.remove('drag-placeholder');
  }, 170);
  cleanupDrag();
}

function cleanupDrag() {
  document.removeEventListener('pointermove', onDragPointerMove);
  document.removeEventListener('pointerup', onDragPointerUp);
  document.removeEventListener('pointercancel', onDragPointerUp);
  if (_drag && _drag.chip) _drag.chip.classList.remove('drag-armed');
  _drag = null;
}
