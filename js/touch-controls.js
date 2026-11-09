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

  // Browsers cannot hide their address bar just because the phone rotated.
  // Request real fullscreen on the first user gesture in landscape, without
  // creating a separate fullscreen button or changing desktop behavior.
  let fullscreenPending = false;
  function enterFullscreen() {
    if (isPortrait() || document.fullscreenElement || fullscreenPending) return;
    const root = document.documentElement;
    if (typeof root.requestFullscreen !== 'function') return;

    try {
      fullscreenPending = true;
      Promise.resolve(root.requestFullscreen({ navigationUI: 'hide' }))
        .then(() => {
          // Rotation lock is only available after entering fullscreen on
          // supported mobile browsers. The portrait overlay remains fallback.
          if (screen.orientation && typeof screen.orientation.lock === 'function') {
            Promise.resolve(screen.orientation.lock('landscape')).catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => { fullscreenPending = false; });
    } catch {
      fullscreenPending = false;
    }
  }
  document.addEventListener('pointerdown', enterFullscreen, { capture: true, passive: true });

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

  // Swipe vertically on a selected character card to flip its four
  // sub-cards. Use the existing keyboard navigation so the same selection
  // and slide animation logic is shared with desktop.
  const menuContent = document.getElementById('playerMenuContent');
  let menuSwipe = null;
  if (menuContent) {
    const swipePage = () => {
      if (!inMenu || inManualTargeting || isPortrait()) return null;
      if (activeMenuPageId === 'party' || activeMenuPageId === 'npcs' ||
          activeMenuPageId === 'abilities') return activeMenuPageId;
      return null;
    };

    menuContent.addEventListener('touchstart', e => {
      menuSwipe = null;
      if (e.touches.length !== 1) return;
      const page = swipePage();
      if (!page) return;
      const target = e.target;
      const onCard = page === 'abilities'
        ? target.closest?.('.abilityCard')
        : target.closest?.('.partyCardSlot.selected');
      if (!onCard) return;
      const touch = e.touches[0];
      menuSwipe = {
        id: touch.identifier,
        x: touch.clientX, y: touch.clientY,
        lastX: touch.clientX, lastY: touch.clientY,
        page
      };
    }, { passive: true });

    menuContent.addEventListener('touchmove', e => {
      if (!menuSwipe || e.touches.length !== 1 || swipePage() !== menuSwipe.page) {
        menuSwipe = null;
        return;
      }
      const touch = e.touches[0];
      if (touch.identifier !== menuSwipe.id) return;
      menuSwipe.lastX = touch.clientX;
      menuSwipe.lastY = touch.clientY;
      const dx = touch.clientX - menuSwipe.x;
      const dy = touch.clientY - menuSwipe.y;
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        e.preventDefault(); // swipe cards instead of scrolling the menu
      }
    }, { passive: false });

    menuContent.addEventListener('touchend', e => {
      if (!menuSwipe) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === menuSwipe.id);
      if (!touch) return;
      const gesture = menuSwipe;
      menuSwipe = null;
      if (swipePage() !== gesture.page) return;
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.abs(dy) < 45 || Math.abs(dy) <= Math.abs(dx) * 1.2) return;
      e.preventDefault(); // avoid an accidental card tap at the end
      const code = dy < 0 ? 'ArrowDown' : 'ArrowUp';
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code, key: code, bubbles: true, cancelable: true
      }));
    }, { passive: false });

    menuContent.addEventListener('touchcancel', () => { menuSwipe = null; });
  }

  // Measure the remaining game viewport after placing tabs outside it.
  requestAnimationFrame(() => {
    resizeCanvas();
    renderMenuTabs(tabs, !inMenu, true);
  });
})();
