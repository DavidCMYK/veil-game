// Touch movement and interactions use the existing game input, without button overlays.
(() => {
  const params = new URLSearchParams(location.search);
  const enabled = params.get('touch') === '1' ||
    (params.get('touch') !== '0' && window.matchMedia('(pointer: coarse)').matches);
  if (!enabled) return;

  document.documentElement.classList.add('touch-enabled');

  // Give the original menu tabs their own strip above the gameplay viewport.
  const game = document.getElementById('gameContainer');
  const viewport = document.getElementById('viewport');
  const tabs = document.getElementById('menuTopTabs');
  if (game && viewport && tabs) game.insertBefore(tabs, viewport);

  const notice = document.createElement('div');
  notice.id = 'touchLandscapeNotice';
  notice.setAttribute('role', 'status');
  notice.textContent = 'Rotate your device to landscape to play Veil.';
  document.body.appendChild(notice);

  const canvasEl = document.getElementById('gameCanvas');
  let active = null;
  let held = null;
  const isPortrait = () => window.matchMedia('(orientation: portrait)').matches;
  const canSteer = () => !isPortrait() && !loading && !inMenu &&
    !inConversation && !inActionPhrase && !mapOverlayOpen &&
    !controlsLocked && !isPlayerStunned();

  function send(type, code) {
    window.dispatchEvent(new KeyboardEvent(type, {
      code, key: code === 'ArrowLeft' ? 'ArrowLeft' : 'ArrowRight',
      bubbles: true, cancelable: true
    }));
  }

  function setDirection(direction) {
    if (held === direction) return;
    if (held) send('keyup', held);
    held = direction;
    if (held) send('keydown', held);
  }

  function stop() {
    setDirection(null);
    active = null;
  }

  function toWorld(e) {
    const r = canvasEl.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * canvasEl.width / Math.max(1, r.width),
      y: (e.clientY - r.top) * canvasEl.height / Math.max(1, r.height)
    };
  }

  function isActionHit(e) {
    const {x, y} = toWorld(e);
    const hit = r => canvasHitTest(x, y, r);
    if (__lastPromptLayouts.some(hit) || __lastRecruitIcons.some(hit) ||
        hit(__lastInteractIconRect) || hit(__lastInteractObjectRect) ||
        hit(__lastInteractItemRect) || hit(__lastExitIconRect)) return true;

    for (const npc of [...npcs, ...party]) {
      if (!npc || npc === player) continue;
      if (hit({x: npc.worldX - cameraX, y: npc.y, w: npc.w, h: npc.h})) return true;
    }
    return false;
  }

  function updateDrag(e) {
    if (!active || e.pointerId !== active.id) return;
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    if (Math.hypot(dx, dy) > 12) active.moved = true;
    if (!active.moved || active.action || !canSteer()) {
      setDirection(null);
      return;
    }
    // Drag right/left to walk; return near the starting point to stop.
    // Vertical gestures don't move a character in this side-scroller.
    const direction = Math.abs(dx) >= 18 && Math.abs(dx) >= Math.abs(dy) * 0.75
      ? (dx < 0 ? 'ArrowLeft' : 'ArrowRight') : null;
    setDirection(direction);
  }

  canvasEl.addEventListener('pointerdown', e => {
    if (active || (e.pointerType === 'mouse' && params.get('touch') !== '1') ||
        isPortrait()) return;
    if (!canSteer() && !inManualTargeting) return;
    e.preventDefault(); // prevent duplicate compatibility mouse events
    active = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY,
      moved: false, action: isActionHit(e)
    };
    canvasEl.setPointerCapture(e.pointerId);
  });

  canvasEl.addEventListener('pointermove', e => {
    if (!active || e.pointerId !== active.id) return;
    e.preventDefault();
    updateDrag(e);
  });

  canvasEl.addEventListener('pointerup', e => {
    if (!active || e.pointerId !== active.id) return;
    e.preventDefault();
    updateDrag(e);
    const tap = !active.moved;
    stop();
    if (canvasEl.hasPointerCapture(e.pointerId)) canvasEl.releasePointerCapture(e.pointerId);
    if (tap && !isPortrait()) {
      // Delegate every tap to the game's existing icon/NPC targeting handler.
      canvasEl.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY
      }));
    }
  });

  canvasEl.addEventListener('pointercancel', e => {
    if (active && e.pointerId === active.id) stop();
  });
  canvasEl.addEventListener('lostpointercapture', e => {
    if (active && e.pointerId === active.id) stop();
  });
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('resize', () => { if (isPortrait()) stop(); });
  document.addEventListener('pointerdown', e => {
    if (active && !canvasEl.contains(e.target)) setDirection(null);
  }, true);

  // Measure the remaining game viewport after placing tabs outside it.
  requestAnimationFrame(() => {
    resizeCanvas();
    renderMenuTabs(tabs, !inMenu, true);
  });
})();
