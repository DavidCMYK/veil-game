// Veil

// Grab HTML elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const promptEl = document.getElementById('prompt');
const viewportEl = document.getElementById('viewport');

// Conversation overlay elements
const conversationOverlay = document.getElementById('conversationOverlay');
const conversationPortrait = document.getElementById('conversationPortrait');
const dialogBox = document.getElementById('dialogBox');
const optionsBox = document.getElementById('optionsBox');

// Player menu elements
const playerMenuOverlay = document.getElementById('playerMenuOverlay');
const playerMenuContent = document.getElementById('playerMenuContent');
const playerMenuError = document.getElementById('playerMenuError');
const menuTopTabs = document.getElementById('menuTopTabs');
const miniMapEl = document.getElementById('miniMap');
const miniMapCanvas = document.getElementById('miniMapCanvas');
const mapOverlayEl = document.getElementById('mapOverlay');
const mapCanvas = document.getElementById('mapCanvas');
const miniMapCtx = miniMapCanvas ? miniMapCanvas.getContext('2d') : null;
const mapCtx = mapCanvas ? mapCanvas.getContext('2d') : null;
globalThis.loading = true;

const UI_FONT_FAMILY = '"Parchment MF", serif';
const UI_FONT_SCALE = 2.00;
function uiFont(sizePx, weight = 'normal', style = 'normal') {
  const scaled = Math.max(1, Math.round(Number(sizePx) * UI_FONT_SCALE));
  const parts = [];
  if (style && style !== 'normal') parts.push(style);
  if (weight && weight !== 'normal') parts.push(weight);
  parts.push(`${scaled}px`, UI_FONT_FAMILY);
  return parts.join(' ');
}

let __menuErrorTimer = null;
function showPlayerMenuError(msg, ms = 1800) {
  if (!playerMenuError) return;
  playerMenuError.textContent = String(msg || '');
  playerMenuError.style.display = 'block';
  if (__menuErrorTimer) clearTimeout(__menuErrorTimer);
  __menuErrorTimer = setTimeout(() => {
    playerMenuError.style.display = 'none';
    playerMenuError.textContent = '';
    __menuErrorTimer = null;
  }, ms);
}

function clearPlayerMenuError() {
  if (!playerMenuError) return;
  playerMenuError.style.display = 'none';
  playerMenuError.textContent = '';
  if (__menuErrorTimer) clearTimeout(__menuErrorTimer);
  __menuErrorTimer = null;
}

// ===== Map UI =====
let mapOverlayOpen = false;
let mapPanX = 0;
let mapPanY = 0;
let mapPanNeedsInit = false;
let mapOverlayDebug = false;

function actorHasFeature(actor, featureId) {
  const id = lc(featureId || '');
  if (!actor || !id) return false;
  if (actor.itemGrantedFeatures && actor.itemGrantedFeatures.has(id)) return true;
  return false;
}

function playerHasFeature(featureId) {
  return actorHasFeature(player, featureId);
}

function canOpenMapOverlay() {
  if (!playerHasFeature('map_access')) {
    showPlayerMenuError('You need a map.');
    return false;
  }
  return true;
}

function setMapOverlayOpen(open, debug = false) {
  mapOverlayOpen = !!open;
  mapOverlayDebug = !!debug;
  if (mapOverlayEl) {
    mapOverlayEl.style.display = mapOverlayOpen ? 'flex' : 'none';
  }
  if (miniMapEl) {
    miniMapEl.style.display = mapOverlayOpen ? 'none' : 'block';
  }
  if (mapOverlayOpen) {
    mapPanNeedsInit = true;
    resizeMapCanvases();
  }
}

if (miniMapEl) {
  miniMapEl.addEventListener('click', (e) => {
    if (loading) return;
    if (inMenu || inConversation || inActionPhrase || controlsLocked || isPlayerStunned()) return;
    if (!canOpenMapOverlay()) return;
    setMapOverlayOpen(true, false);
    e.preventDefault();
    e.stopPropagation();
  });
}

if (mapOverlayEl) {
  mapOverlayEl.addEventListener('click', (e) => {
    if (e.target === mapOverlayEl) {
      setMapOverlayOpen(false);
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

function ensureMapCanvasSize(c, ctx) {
  if (!c || !ctx) return;
  const rect = c.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width || c.clientWidth || c.width));
  const h = Math.max(1, Math.floor(rect.height || c.clientHeight || c.height));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  ctx.imageSmoothingEnabled = false;
}

function resizeMapCanvases() {
  ensureMapCanvasSize(miniMapCanvas, miniMapCtx);
  ensureMapCanvasSize(mapCanvas, mapCtx);
}

// ===== UI flash helper (general-purpose) =====
// Flashes any DOM element with a colored outline/glow.
// Options:
//   color: CSS color string
//   times: number of flashes
//   onMs/offMs: durations per flash phase
function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function flashElement(el, opts = {}) {
  if (!el || !(el instanceof Element)) return false;

  const color = String(opts.color || 'rgba(0, 160, 255, 0.35)');
  const times = Math.max(1, Math.floor(Number(opts.times ?? 2)));
  const onMs  = Math.max(0, Math.floor(Number(opts.onMs  ?? 70)));
  const offMs = Math.max(0, Math.floor(Number(opts.offMs ?? 50)));

  // For table rows, flash all cells so the whole block lights up
  const targets =
    el.tagName === 'TR'
      ? Array.from(el.children).filter(n => n instanceof HTMLElement)
      : [el];

  const prev = targets.map(t => ({
    t,
    backgroundColor: t.style.backgroundColor,
    transition: t.style.transition
  }));

  const applyOn = () => {
    for (const { t } of prev) {
      t.style.transition = 'none';
      t.style.backgroundColor = color;
    }
  };

  const applyOff = () => {
    for (const { t } of prev) {
      t.style.backgroundColor = '';
    }
  };

  for (let i = 0; i < times; i++) {
    applyOn();
    await sleepMs(onMs);
    applyOff();
    if (i < times - 1) await sleepMs(offMs);
  }

  for (const p of prev) {
    p.t.style.backgroundColor = p.backgroundColor;
    p.t.style.transition = p.transition;
  }

  return true;
}


function flashMenuItemRow(itemId, itemUid = null, opts = {}) {
  const id = lc(itemId || '');
  if (!id || !playerMenuContent) return false;

  const sel =
    (itemUid != null)
      ? `[data-item-id="${CSS.escape(id)}"][data-item-uid="${CSS.escape(String(itemUid))}"]`
      : `[data-item-id="${CSS.escape(id)}"]`;

  const row = playerMenuContent.querySelector(sel);
  if (!row) return false;
  void flashElement(row, opts);
  return true;
}

async function tryUseItemWithFeedback(itemId, itemUid = null, rowEl = null) {
  const def = getItemDef(itemId);
  const hasTargeting = !!(def && (def.fixedTarget || def?.targeting));
  if (hasTargeting) {
    const res = beginManualItemTargeting(itemId, itemUid);
    return res ? true : false;
  }

  const ok = useItemOnce(itemId, itemUid);

  const sel =
    (itemUid != null)
      ? `[data-item-id="${CSS.escape(lc(itemId))}"][data-item-uid="${CSS.escape(String(itemUid))}"]`
      : `[data-item-id="${CSS.escape(lc(itemId))}"]`;

  if (ok) {
    const el = rowEl || (
      playerMenuContent &&
      playerMenuContent.querySelector(sel)

    );

    if (el) {
      await flashElement(el, {
        color: 'rgba(0, 140, 255, 0.85)',
        times: 2,
        onMs: 70,
        offMs: 50
      });
    }

    if (inMenu) hideMenuOverlayForHeadBars();
    else renderPlayerMenu();
  } else {
    const el = rowEl || (
      playerMenuContent &&
      playerMenuContent.querySelector(sel)

    );

    if (el) {
      await flashElement(el, {
        color: 'rgba(255, 60, 60, 0.85)',
        times: 2,
        onMs: 70,
        offMs: 50
      });
    }

    showPlayerMenuError(__lastItemUseError || 'Cannot use that item right now.');
  }

  return ok;
}

async function tryUseActorItemWithFeedback(actor, itemId, itemUid = null, rowEl = null) {
  if (!actor) return false;
  if (actor === player) return tryUseItemWithFeedback(itemId, itemUid, rowEl);

  const def = getItemDef(itemId);
  const hasTargeting = !!(def && (def.fixedTarget || def?.targeting));
  if (hasTargeting) {
    const res = beginManualItemTargetingForActor(actor, itemId, itemUid);
    return res ? true : false;
  }

  const ok = useActorItemOnce(actor, itemId, itemUid, actor);
  if (ok && rowEl) {
    await flashElement(rowEl, {
      color: 'rgba(0, 140, 255, 0.85)',
      times: 1,
      onMs: 150,
      offMs: 120
    });
  }
  return ok;
}

function __getAbilityTiming(ability) {
  if (!ability || typeof ability !== 'object') {
    return { warmupMs: 0, cooldownMs: 0, lockoutMs: 0, castingTimeMs: 0 };
  }
  const warmupMs = Math.max(0, Number(ability.warmupMs ?? 0));
  const cooldownMs = Math.max(0, Number(ability.cooldownMs ?? ability.cooldown ?? 0));
  const lockoutMs = Math.max(0, Number(ability.lockoutMs ?? 0));
  const castingTimeMs = Math.max(0, Number(ability.castingTimeMs ?? 0));
  return { warmupMs, cooldownMs, lockoutMs, castingTimeMs };
}

function __applyAbilityEffectsWithTiming(kind, caster, ability, targets, extraPayload = null, nowMs = null) {
  const effects = Array.isArray(ability?.effects) ? ability.effects : [];
  if (!effects.length) return false;

  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);
  const timing = __getAbilityTiming(ability);
  const abilityId = lc(ability?.id || ability?.name || '');
  const payload = { source: 'ability', ability: abilityId, ...(extraPayload || {}) };
  const targetList = Array.isArray(targets) ? targets : [targets];

  if (timing.castingTimeMs > 0) {
    const animType = lc(ability?.animation || ability?.anim || 'ability');
    setActorTempAnim(caster, animType || 'ability', timing.castingTimeMs, now);
    if (ability?.stopMoving === true) {
      lockActorMovementForMs(caster, timing.castingTimeMs);
    }
  }

  const applyNow = () => {
    for (const t of targetList) {
      if (!t) continue;
      const rel = getRelation(caster, t);
      const casterName = caster?.name || caster?.id || 'player';
      const targetName = t?.name || t?.id || 'unknown';
      const targetKind = isMobActor(t) ? 'mob' : (isNpcActor(t) ? 'npc' : (t === player ? 'player' : 'unknown'));
      const effectsStr = Array.isArray(effects) ? JSON.stringify(effects) : String(effects || '');
      console.log(
        `dbg/ability_fire ability=${abilityId} caster=${casterName}(${kind}) target=${targetName}(${targetKind}) relation=${rel} effects=${effectsStr}`
      );
    }
    if (abilityId === 'reset_mira_alignment_colossus' || abilityId === 'sustain_colossus') {
      for (const t of targetList) {
        const rel = t ? getRelation(caster, t) : 'none';
        console.log('[ability-timing] effect', { abilityId, rel, target: t?.name || t?.id || null });
      }
    }
    const fixedNow = resolveAbilityFixedTargets(caster, ability);
    const candidates = fixedNow ? fixedNow : __getAbilityTargetCandidates(caster, ability, { priorityOnly: false });
    if (Array.isArray(candidates) && candidates.length === 0) return;
    for (const t of targetList) {
      if (!t) continue;
      if (Array.isArray(candidates) && !candidates.includes(t)) continue;
      if ((ability?.requiresContact || ability?.inContact) && kind === 'mob') {
        const pairKey = contactPairKey(caster.instanceId, t);
        if (!pairKey || !contactInsidePairs.has(pairKey)) continue;
      }
      if (kind === 'mob') applyMobEffects(effects, caster, payload, t);
      else if (kind === 'npc') applyNpcEffects(effects, caster, payload, t);
      else if (kind === 'player') applyPlayerEffects(effects, payload, t);
    }
  };

  if (abilityId === 'reset_mira_alignment_colossus' || abilityId === 'sustain_colossus') {
    const rels = targetList.map(t => (t ? getRelation(caster, t) : 'none'));
    console.log('[ability-timing] cast', { abilityId, warmupMs: timing.warmupMs, rels });
  }

  if (timing.warmupMs > 0) scheduleTimedEffect(now + timing.warmupMs, applyNow);
  else applyNow();

  if (timing.lockoutMs > 0) {
    const until = now + timing.warmupMs + timing.lockoutMs;
    const prev = Number(caster.__abilityLockUntilMs || 0);
    caster.__abilityLockUntilMs = Math.max(prev, until);
  }

  if (!caster.abilityNextAtMs) caster.abilityNextAtMs = Object.create(null);
  const nextAt = now + timing.warmupMs + timing.cooldownMs;
  caster.abilityNextAtMs[abilityId] = nextAt;

  return true;
}

function tryCastPartyAbility(npcName, abilityId, targetActor = null) {
  const wantNpc = lc(npcName);
  const wantAb = lc(abilityId);
  if (!wantNpc || !wantAb) return false;

  if (loading) return false;
  if (inConversation || inActionPhrase) return false;
  if (controlsLocked || isPlayerStunned()) return false;

  const caster = party.find(n => n && lc(n.name) === wantNpc);
  if (!caster) return false;
  if (actorHasTag(caster, 'stunned')) return false;

  const ability = (Array.isArray(caster.abilities) ? caster.abilities : []).find(a => a && lc(a.id) === wantAb);
  if (!ability) return false;

  const now = getGameNowMs();
  const lockUntil = Number(caster.__abilityLockUntilMs || 0);
  if (lockUntil > now) {
    showPlayerMenuError('Ability is on cooldown.');
    return false;
  }
  const nextAt = Number(caster.abilityNextAtMs?.[wantAb] || 0);
  if (nextAt > now) {
    showPlayerMenuError('Ability is on cooldown.');
    return false;
  }

  const fixedTargets = resolveAbilityFixedTargets(caster, ability);
  if (fixedTargets) {
    __applyAbilityEffectsWithTiming('npc', caster, ability, fixedTargets, null, now);
  } else {
    __applyAbilityEffectsWithTiming('npc', caster, ability, targetActor || null, null, now);
  }

  emitGameEvent('npc_ability_cast', { npc: caster.name, ability: ability.id });

  if (lc(caster.__forcedTargetAbilityId || '') === wantAb) {
    caster.__forcedTargetKey = null;
    caster.__forcedTargetAbilityId = null;
  }

  return true;
}

function tryCastPlayerAbility(abilityId, targetActor = null) {
  const wantAb = lc(abilityId);
  if (!wantAb) return false;

  if (loading) return false;
  if (inConversation || inActionPhrase) return false;
  if (controlsLocked || isPlayerStunned()) return false;

  const ability = (Array.isArray(player.abilities) ? player.abilities : []).find(a => a && lc(a.id) === wantAb);
  if (!ability) return false;
  if (actorHasTag(player, 'stunned')) return false;

  const now = getGameNowMs();
  const lockUntil = Number(player.__abilityLockUntilMs || 0);
  if (lockUntil > now) {
    showPlayerMenuError('Ability is on cooldown.');
    return false;
  }
  const nextAt = Number(player.abilityNextAtMs?.[wantAb] || 0);
  if (nextAt > now) {
    showPlayerMenuError('Ability is on cooldown.');
    return false;
  }

  const fixedTargets = resolveAbilityFixedTargets(player, ability);
  if (fixedTargets) {
    __applyAbilityEffectsWithTiming('player', player, ability, fixedTargets, null, now);
  } else {
    __applyAbilityEffectsWithTiming('player', player, ability, targetActor || null, null, now);
  }

  emitGameEvent('player_ability_cast', { ability: ability.id });

  if (lc(player.__forcedTargetAbilityId || '') === wantAb) {
    player.__forcedTargetKey = null;
    player.__forcedTargetAbilityId = null;
  }

  return true;
}

function toggleActorAutoCast(actor, abilityId) {
  if (!actor) return false;
  const wantAb = lc(abilityId);
  if (!wantAb) return false;

  const has = Array.isArray(actor.abilities) && actor.abilities.some(a => a && lc(a.id) === wantAb);
  if (!has) return false;

  actor.autoCastAbilityId = (lc(actor.autoCastAbilityId || '') === wantAb) ? null : wantAb;
  return true;
}

// Pausable game-time clock (freezes when inMenu is true)
let __gameNowMs = performance.now();
function getGameNowMs() {
  return __gameNowMs;
}

// UI flags
let showNames = false; //don't show character names by default
let showRangeIndicators = false;
// Menu state
let inMenu = false;
let activeMenuPageId = 'party';
let inManualTargeting = false;
let manualTargetingState = null; // { npcName, abilityId, candidates, selectedIndex, returnPageId }
let manualTargetingMouse = { x: 0, y: 0, has: false };
let wasMenuOpenBeforeDialog = false;
let partyMenuSelectedIndex = 0;
let partyMenuLastSelectedIndex = 0;
let partyMenuCardIndex = 0; // 0=stats,1=abilities/tags,2=inventory
let partyMenuCardSize = { h: 0, w: 0 };
let partyMenuPrevCardIndex = 0;
let partyMenuCardSlideDir = 1; // 1 = down, -1 = up
let partyMenuCardAnimUntilMs = 0;
let partyMenuWheelAccum = 0;
let partyMenuWheelLastAt = 0;
let npcMenuSelectedIndex = 0;
let npcMenuLastSelectedIndex = 0;
let npcMenuCardIndex = 0;
let npcMenuPrevCardIndex = 0;
let npcMenuCardSlideDir = 1;
let npcMenuCardAnimUntilMs = 0;
let npcMenuWheelAccum = 0;
let npcMenuWheelLastAt = 0;

const MENU_PAGES = []; // { id, label, hotkey, render() }
function registerMenuPage(id, label, hotkey, renderFn) {
  MENU_PAGES.push({
    id: String(id),
    label: String(label),
    hotkey: String(hotkey || ''),
    render: renderFn
  });
}

function getNpcMenuNames() {
  const entries = Object.entries(npcRegistry || {})
    .filter(([_, rec]) => !!(rec?.met || rec?.hasBeenInParty));
  const names = entries.map(([name]) => name).filter(n => lc(n) !== 'player');
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

function isMenuPageEmpty(id) {
  const p = globalThis.player;
  if (!p) return false;
  const pid = String(id || '').toLowerCase();
  if (pid === 'abilities') return getAbilityList().length === 0;
  if (pid === 'items') return getActorInventoryCards(p).length === 0;
  if (pid === 'npcs') return getNpcMenuNames().length === 0;
  return false;
}

function getVisibleMenuPages() {
  return MENU_PAGES.filter(p => !isMenuPageEmpty(p.id));
}

function isMenuPageVisible(id) {
  return getVisibleMenuPages().some(p => p.id === id);
}

function setActiveMenuPage(id) {
  const pages = getVisibleMenuPages();
  const wanted = String(id || 'party');
  const exists = pages.find(p => p.id === wanted);
  activeMenuPageId = exists ? wanted : (pages[0]?.id || 'party');
  if (activeMenuPageId === 'party') {
    partyMenuCardIndex = 0;
    partyMenuPrevCardIndex = 0;
    partyMenuCardAnimUntilMs = 0;
  }
  if (activeMenuPageId === 'npcs') {
    npcMenuCardIndex = 0;
    npcMenuPrevCardIndex = 0;
    npcMenuCardAnimUntilMs = 0;
  }
  renderPlayerMenu();
}

function openPlayerMenu(pageId = null) {
  if (!playerMenuOverlay) return;
  inMenu = true;
  clearPlayerMenuError();

  if (pageId) activeMenuPageId = String(pageId);

  // Always open on stats/picture card, but keep selected character per menu
  partyMenuCardIndex = 0;
  partyMenuPrevCardIndex = 0;
  partyMenuCardAnimUntilMs = 0;
  npcMenuCardIndex = 0;
  npcMenuPrevCardIndex = 0;
  npcMenuCardAnimUntilMs = 0;

  playerMenuOverlay.style.display = 'block';
  renderPlayerMenu();
}

function closePlayerMenu() {
  if (!playerMenuOverlay) return;
  inMenu = false;
  inManualTargeting = false;
  manualTargetingState = null;
  closePartyInventoryOverlay();
  playerMenuOverlay.style.display = 'none';
  renderMenuTabs(menuTopTabs, true, true);
}

function togglePlayerMenu(pageId = null) {
  if (inMenu) closePlayerMenu();
  else openPlayerMenu(pageId);
}

let __menuOverlayHideToken = 0;
function hideMenuOverlayForHeadBars() {
  if (!playerMenuOverlay || !inMenu) return;
  const delayMs = Math.max(0, Number(HEAD_STAT_BAR_TIMING?.totalMs ?? 0));
  const token = ++__menuOverlayHideToken;
  playerMenuOverlay.style.display = 'none';
  setTimeout(() => {
    if (!inMenu) return;
    if (token !== __menuOverlayHideToken) return;
    playerMenuOverlay.style.display = 'block';
    renderPlayerMenu();
  }, delayMs);
}

let __pendingNameLabels = [];
let __pendingHeadBars = [];

function renderMenuTabs(targetEl, forceInactive = false, allowScale = false) {
  if (!targetEl) return;
  if (globalThis.loading !== false) {
    targetEl.style.display = 'none';
    targetEl.style.pointerEvents = 'none';
    targetEl.innerHTML = '';
    return;
  }
  if (globalThis.inConversation || globalThis.inActionPhrase) {
    targetEl.style.display = 'none';
    targetEl.style.pointerEvents = 'none';
    targetEl.innerHTML = '';
    return;
  }
  targetEl.style.display = '';
  targetEl.style.pointerEvents = '';
  targetEl.innerHTML = '';
  if (allowScale) {
    targetEl.style.setProperty('--menu-tab-scale', '1');
    targetEl.style.setProperty('--menu-tabs-fit-scale', '1');
    targetEl.style.width = '';
  } else {
    targetEl.style.setProperty('--menu-tab-scale', '1');
    targetEl.style.setProperty('--menu-tabs-fit-scale', '1');
    targetEl.style.width = '';
  }
  const pages = getVisibleMenuPages();
  for (const p of pages) {
    const btn = document.createElement('button');
    const isActive = (!forceInactive && p.id === activeMenuPageId);
    btn.className = 'playerMenuTabBtn';
    if (isActive) btn.dataset.active = '1';
    btn.style.width = '';
    if (p.hotkey && p.hotkey.length > 0) {
      const label = String(p.label || '');
      const hot = String(p.hotkey || '').toLowerCase();
      const idx = label.toLowerCase().indexOf(hot);
      if (idx >= 0) {
        const before = document.createElement('span');
        before.textContent = label.slice(0, idx);
        const key = document.createElement('span');
        key.className = 'playerMenuTabHotkey';
        key.textContent = label[idx];
        const after = document.createElement('span');
        after.textContent = label.slice(idx + 1);
        btn.appendChild(before);
        btn.appendChild(key);
        btn.appendChild(after);
      } else {
        btn.textContent = label;
      }
    } else {
      btn.textContent = p.label;
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!inMenu) {
        openPlayerMenu(p.id);
        return;
      }
      if (p.id === activeMenuPageId) {
        closePlayerMenu();
        return;
      }
      setActiveMenuPage(p.id);
    });
    targetEl.appendChild(btn);
  }
  if (allowScale) {
    const gapRaw = getComputedStyle(targetEl).columnGap || getComputedStyle(targetEl).gap || '0';
    const gap = parseFloat(gapRaw) || 0;
    const tabs = Array.from(targetEl.children);
    let maxW = 0;
    for (const el of tabs) {
      const w = el.scrollWidth;
      if (w > maxW) maxW = w;
    }
    for (const el of tabs) {
      el.style.width = `${Math.ceil(maxW)}px`;
    }
    const totalW = (Math.ceil(maxW) * tabs.length) + Math.max(0, tabs.length - 1) * gap;
    const containerW = (viewportEl?.clientWidth || window.innerWidth) - 16;
    const scale = Math.min(1, totalW > 0 ? (containerW / totalW) : 1);
    targetEl.style.setProperty('--menu-tabs-fit-scale', String(scale));
    if (isFinite(totalW) && totalW > 0) targetEl.style.width = `${totalW}px`;
    for (const el of tabs) {
      if (el.dataset.active === '1') el.classList.add('active');
      else el.classList.remove('active');
      delete el.dataset.active;
    }
  } else {
    const tabs = Array.from(targetEl.children);
    for (const el of tabs) {
      if (el.dataset.active === '1') el.classList.add('active');
      else el.classList.remove('active');
      delete el.dataset.active;
    }
  }
}

function hideMenuTabsForDialog() {
  if (!menuTopTabs) return;
  menuTopTabs.classList.add('isHidden');
}

function showMenuTabsAfterDialog() {
  if (!menuTopTabs) return;
  menuTopTabs.classList.remove('isHidden');
  renderMenuTabs(menuTopTabs, !inMenu, true);
}

function renderPlayerMenu() {
  renderMenuTabs(menuTopTabs, !inMenu, true);
  if (!playerMenuOverlay || !playerMenuContent) return;

  // Content
  const pages = getVisibleMenuPages();
  if (pages.length === 0) {
    playerMenuContent.innerHTML = '';
    return;
  }
  if (!pages.find(p => p.id === activeMenuPageId)) {
    closePlayerMenu();
    return;
  }
  const page = pages.find(p => p.id === activeMenuPageId) || pages[0];
  playerMenuContent.innerHTML = '';
  if (page && typeof page.render === 'function') {
    const node = page.render();
    if (node) {
      playerMenuContent.appendChild(node);
      requestAnimationFrame(() => syncAbilityCardPortraits(playerMenuContent));
    }
  }
}

function syncAbilityCardPortraits(rootEl) {
  const root = rootEl || document;
  const cards = root.querySelectorAll('.abilityCard');
  for (const card of cards) {
    const portrait = card.querySelector('.abilityCardPortrait');
    const content = card.querySelector('.abilityCardContent');
    if (!portrait || !content) continue;
    const h = Math.round(content.getBoundingClientRect().height || 0);
    if (!h) continue;
    portrait.style.width = `${h}px`;
    portrait.style.height = `${h}px`;
  }
}

function makeMenuCard(title, rows) {
  const card = document.createElement('div');
  card.className = 'playerMenuCard';

  const h = document.createElement('div');
  h.className = 'playerMenuCardTitle';
  h.textContent = title;
  card.appendChild(h);

  const table = document.createElement('table');
  table.className = 'playerMenuTable';

  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const tdK = document.createElement('td');
    const tdV = document.createElement('td');
    tdK.textContent = String(k);
    tdV.textContent = String(v);
    tr.appendChild(tdK);
    tr.appendChild(tdV);
    table.appendChild(tr);
  }

  card.appendChild(table);
  return card;
}

function renderMenuPage_PC() {
  ensurePlayerStats();

  const wrap = document.createElement('div');
  wrap.className = 'playerMenuGrid';

  // Stats
  const statRows = [];
  for (const k of PLAYER_STAT_ORDER) {
    const def = getStatDef(k);
    if (!def) continue;
    const rec = player.stats?.[k];
    if (!rec) continue;
    if (def.type === 'depletable') {
      const cur = Number(rec.current ?? 0);
      const max = Number(getStatEffectiveValue(player, k) ?? rec.max ?? 0);
      statRows.push([def.label || k, `${cur} / ${max}`]);
    } else if (def.type === 'scalar') {
      const val = Number(getStatEffectiveValue(player, k) ?? rec.base ?? 0);
      statRows.push([def.label || k, `${val}`]);
    } else if (def.type === 'variable') {
      const val = Number(getStatEffectiveValue(player, k) ?? rec.current ?? 0);
      statRows.push([def.label || k, `${val}`]);
    }
  }
  wrap.appendChild(makeMenuCard('Player Stats', statRows));

  // Location / debug-ish basics (useful now, expandable later)
  const locRows = [
    ['Area', currentAreaName ?? '—'],
    ['WorldX', Math.floor(player.worldX ?? 0)],
    ['Section', (typeof getSectionNameForX === 'function' ? (getSectionNameForX(player.worldX) ?? '—') : '—')]
  ];
  wrap.appendChild(makeMenuCard('Status', locRows));

  return wrap;
}

function renderMenuPage_Party() {
  const wrap = document.createElement('div');
  wrap.className = 'playerMenuGrid';

  // Player card
  ensurePlayerStats();
  const pRows = [
    ['Name', player.name ?? 'Player'],
    ['Area', currentAreaName ?? '—'],
    ['WorldX', Math.floor(player.worldX ?? 0)]
  ];
  wrap.appendChild(makeMenuCard('Player', pRows));

  // Party member cards
  if (!party || party.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playerMenuCard';
    empty.textContent = 'No party members.';
    wrap.appendChild(empty);
    return wrap;
  }

  for (const m of party) {
    const rows = [
      ['Name', m.name ?? '—'],
      ['Alignment', Number(getActorStatValue(m?.name || '', 'alignment', 'current') ?? 0)],
      ['Affection', Number(getActorStatValue(m?.name || '', 'affection', 'current') ?? 0)],
      ['Min Align Recruit', Number(getActorStatValue(m?.name || '', 'minalignment', 'base') ?? 0)],
      ['Min Aff Recruit', Number(getActorStatValue(m?.name || '', 'minaffection', 'base') ?? 0)]
    ];
    const card = makeMenuCard(m.name || 'Party Member', rows);

    const invBtn = document.createElement('button');
    invBtn.textContent = 'Inventory';
    invBtn.style.marginTop = '10px';
    invBtn.style.alignSelf = 'flex-start';
    invBtn.addEventListener('click', () => {
      showPartyInventoryOverlay(m);
    });
    card.appendChild(invBtn);

    wrap.appendChild(card);
  }

  return wrap;
}

function getActorPortraitContext(actor, mode) {
  const nm = String(actor?.name || '');
  let areaName = null;
  if (mode === 'party') {
    areaName = currentAreaName ?? null;
  } else if (mode === 'npcs') {
    const nameLc = lc(nm);
    const inPartyNow = Array.isArray(party) && party.some(p => lc(p?.name || '') === nameLc);
    const inWorldNow = Array.isArray(npcs) && npcs.some(n => lc(n?.name || '') === nameLc);
    if (inPartyNow || inWorldNow) areaName = currentAreaName ?? null;
    else {
      const rec = ensureNpcRecord(nm);
      areaName = rec?.area || rec?.lastSeenArea || null;
    }
  }

  const area = areaName ? buildAreaFromDefinition(areaName) : currentArea;

  let worldX = null;
  if (actor && isFinite(actor.worldX)) worldX = Number(actor.worldX);
  else if (mode === 'party') {
    worldX = Number(player?.worldX || 0);
  } else if (mode === 'npcs') {
    const rec = ensureNpcRecord(nm);
    if (isFinite(rec?.worldX)) worldX = Number(rec.worldX);
    else if (isFinite(rec?.lastSeenWorldX)) worldX = Number(rec.lastSeenWorldX);
  }

  if (!isFinite(worldX)) worldX = Number(player?.worldX || 0);
  return { area, worldX };
}

function getGoalStoreForActor(actor) {
  if (!actor) return null;
  const name = String(actor?.name || '');
  const nameLc = lc(name);
  const playerLc = lc(player?.name || 'player');
  if (actor === player || nameLc === playerLc || nameLc === 'player') {
    ensurePlayerGoals();
    return player;
  }
  if (name) return ensureNpcRecord(name);
  return null;
}

function getGoalCompletionInfoForStore(store, goal) {
  const count = __getGoalCount(store, goal?.id);
  const max = __getGoalMax(goal);
  const complete = (max !== 0 && count >= max);
  return { count, max, complete };
}

function formatGoalStatusText(info) {
  if (!info) return 'Incomplete';
  if (info.max === 0) return `Completed ${info.count} times`;
  if (!info.complete) return 'Incomplete';
  if (info.max === 1) return 'Completed';
  return `Completed ${info.count}/${info.max} times`;
}

function isPublicGoal(goal) {
  return lc(goal?.visibility || 'public') !== 'private';
}

function getIncompletePublicGoalsForStore(store) {
  if (!store || !Array.isArray(store.goalsActive)) return [];
  const out = [];
  for (const g of store.goalsActive) {
    if (!g || !isPublicGoal(g)) continue;
    const info = getGoalCompletionInfoForStore(store, g);
    if (info.complete) continue;
    out.push({ goal: g, info });
  }
  return out;
}

function collectJournalGoalsForStore(store, ownerName) {
  if (!store) return [];
  __initGoalStore(store);
  const out = [];
  const seen = new Set();

  for (const g of store.goalsActive) {
    if (!g || !isPublicGoal(g)) continue;
    const info = getGoalCompletionInfoForStore(store, g);
    out.push({ owner: ownerName, goal: g, info });
    seen.add(g.id);
  }

  for (const [gid, g] of Object.entries(store.goalsRemoved || {})) {
    if (seen.has(gid)) continue;
    if (!g || !isPublicGoal(g)) continue;
    const info = getGoalCompletionInfoForStore(store, g);
    if (!info.complete) continue;
    out.push({ owner: ownerName, goal: g, info });
  }

  return out;
}

function renderMenuPage_PartyCards() {
  ensurePlayerStats();

  const wrap = document.createElement('div');
  wrap.className = 'partyCardsGrid';

  const members = [player].concat(Array.isArray(party) ? party : []);
  if (!members.length) {
    const empty = document.createElement('div');
    empty.className = 'playerMenuCard';
    empty.textContent = 'No party members.';
    wrap.appendChild(empty);
    return wrap;
  }
  if (!Number.isFinite(partyMenuSelectedIndex)) partyMenuSelectedIndex = 0;
  if (partyMenuSelectedIndex >= members.length) partyMenuSelectedIndex = members.length - 1;
  if (partyMenuSelectedIndex < 0) partyMenuSelectedIndex = 0;
  if (partyMenuLastSelectedIndex !== partyMenuSelectedIndex) {
    partyMenuCardIndex = 0;
    partyMenuLastSelectedIndex = partyMenuSelectedIndex;
  }

  const viewportRect = viewportEl?.getBoundingClientRect();
  const tabsRect = menuTopTabs?.getBoundingClientRect();
  const tabsBottom = (tabsRect && viewportRect) ? (tabsRect.bottom - viewportRect.top) : 120;
  const availableHeight = Math.max(1, (viewportRect?.height || window.innerHeight) - tabsBottom);
  const cardH = availableHeight * 0.8;
  const cardW = cardH * 0.6667;
  const gap = 18;
  const n = members.length;
  const availableWidth = Math.max(1, (viewportRect?.width || window.innerWidth) - (gap * 2));
  let nonSelectedW = cardW;
  if (n > 1) {
    nonSelectedW = (availableWidth - cardW - (gap * (n + 1))) / (n - 1);
    if (!isFinite(nonSelectedW)) nonSelectedW = cardW;
  }
  nonSelectedW = Math.max(0, Math.min(cardW, nonSelectedW));
  const nonSelectedH = nonSelectedW * 1.5;
  wrap.style.setProperty('--party-card-height', `${cardH}px`);
  wrap.style.setProperty('--party-card-width', `${cardW}px`);
  wrap.style.setProperty('--party-card-scaled-height', `${nonSelectedH}px`);
  wrap.style.setProperty('--party-card-scaled-width', `${nonSelectedW}px`);
  partyMenuCardSize = { h: cardH, w: cardW };

  const labelForStat = (key) => {
    const def = getStatDef(String(key || '').toLowerCase());
    if (def && def.label) return String(def.label);
    const raw = String(key || '');
    return raw
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  const buildSignedStatBar = (statKey, cur) => {
    const wrap = document.createElement('div');
    wrap.className = 'partyStatBar';
    wrap.style.position = 'relative';

    const val = Math.max(-10, Math.min(10, Number(cur) || 0));
    const pct = (val + 10) / 20; // 0..1

    const marker = document.createElement('img');
    const dir = (val >= 0) ? 'up' : 'down';
    marker.src = `assets/icons/${statKey}_${dir}.png`;
    marker.alt = `${statKey} ${dir}`;
    marker.style.position = 'absolute';
    marker.style.left = `${Math.round(pct * 100)}%`;
    marker.style.top = '50%';
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.width = '16px';
    marker.style.height = '16px';
    wrap.appendChild(marker);

    return wrap;
  };

  const buildStatValueNode = (actor, statKey, rec) => {
    const k = String(statKey || '').toLowerCase();
    const def = getStatDef(k);
    const base = (rec && rec.base != null) ? Number(rec.base) : 0;
    const cur = (rec && rec.current != null) ? Number(rec.current) : 0;

    if (def && def.type === 'depletable') {
      const wrap = document.createElement('div');
      wrap.className = 'partyStatBar';
      const actorKey = lc(actor?.name || 'player');
      wrap.dataset.actor = actorKey;
      wrap.dataset.stat = k;
      const effMax = Number(getStatEffectiveValue(actor, k) ?? rec?.max ?? 0);
      wrap.dataset.base = String(effMax);

      const fill = document.createElement('div');
      fill.className = 'partyStatBarFill';
      const pct = (effMax > 0) ? Math.max(0, Math.min(1, cur / effMax)) : 0;
      fill.style.width = `${Math.round(pct * 100)}%`;
      wrap.appendChild(fill);

      const text = document.createElement('div');
      text.className = 'partyStatBarText';
      text.textContent = `${cur} / ${effMax}`;
      wrap.appendChild(text);

      return wrap;
    }

    if (def && def.type === 'variable') {
      const eff = Number(getStatEffectiveValue(actor, k) ?? cur);
      return buildSignedStatBar(k, eff);
    }

    if (def && def.type === 'scalar') {
      const wrap = document.createElement('span');
      wrap.className = 'partyStatValue';

      const curSpan = document.createElement('span');
      curSpan.className = 'partyStatCurrent';
      const eff = Number(getStatEffectiveValue(actor, k) ?? base);
      curSpan.textContent = String(eff);
      wrap.appendChild(curSpan);

      const delta = eff - base;
      if (isFinite(delta) && delta !== 0) {
        const tail = document.createElement('span');
        tail.className = 'partyStatBaseWrap';
        tail.textContent = ` (${base} `;

        const mod = document.createElement('span');
        mod.className = 'partyStatMod ' + (delta > 0 ? 'pos' : 'neg');
        mod.textContent = `${delta > 0 ? '+' : ''}${delta}`;

        const close = document.createElement('span');
        close.textContent = ')';

        tail.appendChild(mod);
        tail.appendChild(close);
        wrap.appendChild(tail);
      }

      return wrap;
    }

    const fallback = document.createElement('span');
    fallback.textContent = `${cur} / ${base}`;
    return fallback;
  };

  const buildStatRows = (actor) => {
    const stats = actor?.stats && typeof actor.stats === 'object' ? actor.stats : {};
    const keys = Object.keys(stats);

    const defKeys = NPC_STAT_ORDER.map(d => String(d).toLowerCase());
    const ordered = [];
    for (const k of defKeys) {
      if (stats[k]) ordered.push(k);
    }
    const rest = keys.filter(k => !ordered.includes(k)).sort();
    ordered.push(...rest);

    return ordered.map((k) => {
      const rec = stats[k] || {};
      return [labelForStat(k), buildStatValueNode(actor, k, rec)];
    });
  };

  const buildAbilitiesPanel = (actor, opts = {}) => {
    const panel = document.createElement('div');
    panel.className = 'partyCardPanel';

    const name = document.createElement('div');
    name.className = 'partyCardName';
    name.textContent = actor?.name || 'Party Member';
    panel.appendChild(name);

    const titleI = document.createElement('div');
    titleI.className = 'partyCardSectionTitle';
    titleI.textContent = 'Can Interact With';
    panel.appendChild(titleI);

    const interacts = (typeof getActorInteractTags === 'function')
      ? getActorInteractTags(actor)
      : [];
    const interactLine = document.createElement('div');
    interactLine.className = 'partyTagLine';
    interactLine.textContent = (Array.isArray(interacts) && interacts.length > 0)
      ? interacts.join(', ')
      : 'None';
    panel.appendChild(interactLine);

    const titleT = document.createElement('div');
    titleT.className = 'partyCardSectionTitle';
    titleT.textContent = 'Effects';
    panel.appendChild(titleT);

    const tagsSet = ensureActorTags(actor) || new Set();
    const tags = Array.from(tagsSet.values()).sort();
    const tagWrap = document.createElement('div');
    tagWrap.className = 'partyTagList';
    if (tags.length === 0) {
      tagWrap.textContent = 'None';
      tagWrap.classList.add('playerMenuMuted');
    } else {
      for (const t of tags) {
        const pill = document.createElement('span');
        pill.className = 'partyTagPill';
        pill.textContent = t;
        // Optional duration display if tag expiry data exists
        const expMap = actor?.tagExpiresAtMs;
        if (expMap && typeof expMap === 'object' && expMap[t] != null) {
          const now = getGameNowMs();
          const remainMs = Math.max(0, Number(expMap[t]) - now);
          const remainS = Math.ceil(remainMs / 1000);
          if (isFinite(remainS)) {
            const dur = document.createElement('span');
            dur.className = 'partyTagDuration';
            dur.textContent = ` ${remainS}s`;
            pill.appendChild(dur);
          }
        }
        tagWrap.appendChild(pill);
      }
    }
    panel.appendChild(tagWrap);

    const titleA = document.createElement('div');
    titleA.className = 'partyCardSectionTitle';
    titleA.textContent = 'Abilities';
    panel.appendChild(titleA);

    const abilities = Array.isArray(actor?.abilities) ? actor.abilities : [];
    if (abilities.length === 0) {
      const none = document.createElement('div');
      none.className = 'playerMenuMuted';
      none.textContent = 'None';
      panel.appendChild(none);
    } else {
      const list = document.createElement('div');
      list.className = 'partyAbilityCardList';
      for (let i = 0; i < abilities.length; i++) {
        const ab = abilities[i];
        const hotKey = (i < 9) ? (i + 1) : null;
        const card = buildAbilityCard(actor, ab, {
          hotKey,
          includeToggle: true,
          showPortrait: false,
          badge: opts.badge || null,
          onToggle: () => {
            toggleActorAutoCast(actor, ab?.id || ab);
            renderPlayerMenu();
          },
          onClick: (e) => {
            if (e && e.shiftKey) {
              toggleActorAutoCast(actor, ab?.id || ab);
              renderPlayerMenu();
              return;
            }
            triggerAbilityFromEntry({ actor, ability: ab });
          }
        });
        list.appendChild(card);
      }
      panel.appendChild(list);
    }

    return panel;
  };

  const getActorAreaLabel = (actor, mode) => {
    if (!actor) return '—';
    const nm = String(actor.name || '');
    if (mode === 'party') {
      if (actor === player || lc(nm) === lc(player?.name || '')) return currentAreaName ?? '—';
      const rec = ensureNpcRecord(nm);
      return rec?.lastSeenArea || rec?.area || '—';
    }
    if (mode === 'npcs') {
      const nameLc = lc(nm);
      const inPartyNow = Array.isArray(party) && party.some(p => lc(p?.name || '') === nameLc);
      const inWorldNow = Array.isArray(npcs) && npcs.some(n => lc(n?.name || '') === nameLc);
      if (inPartyNow || inWorldNow) return currentAreaName ?? '—';
      const rec = ensureNpcRecord(nm);
      return rec?.area || rec?.lastSeenArea || '—';
    }
    return '—';
  };

  const buildStatsCard = (actor, mode = 'party') => {
    const c = document.createElement('div');
    c.className = 'partyCard partyCardStatsCard';

    const portraitWrap = document.createElement('div');
    portraitWrap.className = 'partyCardPortrait';
    portraitWrap.style.backgroundColor = getCurrentSkyColor();
    const bgKey = (() => {
      const ctx = getActorPortraitContext(actor, mode);
      const area = ctx.area;
      if (!area || !area.sectionTileWidth || !Array.isArray(area.backgroundEntries)) return null;
      const wx = ctx.worldX;
      const idx = Math.max(0, Math.floor(wx / area.sectionTileWidth));
      const entry = area.backgroundEntries[idx + 1] ?? area.backgroundEntries[idx] ?? null;
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (entry?.img?.src) return entry.img.src;
      return null;
    })();
    if (bgKey) {
      const src = bgKey.includes('assets/')
        ? bgKey
        : `assets/tiles/${bgKey.includes('.') ? bgKey : `${bgKey}.png`}`;
      portraitWrap.style.backgroundImage = `url("${src}")`;
    }
    const img = document.createElement('img');
    img.alt = `${actor.name || 'Member'} portrait`;
    img.src = `assets/portraits/character_portrait_${lc(actor.name || 'player')}_neutral.png`;
    img.addEventListener('error', () => {
      portraitWrap.style.display = 'none';
    });
    portraitWrap.appendChild(img);
    c.appendChild(portraitWrap);

    const overlay = document.createElement('div');
    overlay.className = 'partyCardOverlay';

    const nameBlock = document.createElement('div');
    nameBlock.className = 'partyOverlayBlock';
    const name = document.createElement('div');
    name.className = 'partyCardName';
    name.textContent = actor.name || 'Party Member';
    nameBlock.appendChild(name);
    const area = document.createElement('div');
    area.className = 'partyCardArea playerMenuMuted';
    area.textContent = getActorAreaLabel(actor, mode);
    nameBlock.appendChild(area);
    overlay.appendChild(nameBlock);

    const table = document.createElement('table');
    table.className = 'partyCardStats';
    const rows = buildStatRows(actor);
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const tdK = document.createElement('td');
      const tdV = document.createElement('td');
      tdK.textContent = String(k);
      if (v instanceof Node) tdV.appendChild(v);
      else tdV.textContent = String(v);
      tr.appendChild(tdK);
      tr.appendChild(tdV);
      table.appendChild(tr);
    }
    const statsBlock = document.createElement('div');
    statsBlock.className = 'partyOverlayBlock';
    statsBlock.appendChild(table);
    overlay.appendChild(statsBlock);
    c.appendChild(overlay);
    return c;
  };

  const buildAbilitiesCard = (actor, opts = {}) => {
    const c = document.createElement('div');
    c.className = 'partyCard';
    c.appendChild(buildAbilitiesPanel(actor, opts));
    return c;
  };

  const buildInventoryCard = (actor) => {
    const c = document.createElement('div');
    c.className = 'partyCard';
    c.appendChild(buildInventoryPanel(actor));
    return c;
  };

  const buildGoalsCard = (actor) => {
    const c = document.createElement('div');
    c.className = 'partyCard';
    c.appendChild(buildGoalsPanel(actor));
    return c;
  };

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    if (!member) continue;
    const isSelected = (i === partyMenuSelectedIndex);
    const slot = document.createElement('div');
    slot.className = 'partyCardSlot' + (isSelected ? ' selected' : ' scaled');
    slot.addEventListener('mouseenter', () => {
      if (partyMenuSelectedIndex !== i) {
        partyMenuSelectedIndex = i;
        partyMenuCardIndex = 0;
        renderPlayerMenu();
      }
    });
    slot.addEventListener('wheel', (e) => {
      const now = performance.now();
      partyMenuWheelAccum += e.deltaY;
      const threshold = 1000;
      if (Math.abs(partyMenuWheelAccum) < threshold) {
        e.preventDefault();
        return;
      }
      if (now - partyMenuWheelLastAt < 120) {
        e.preventDefault();
        return;
      }
      const dir = (partyMenuWheelAccum > 0) ? 1 : -1;
      partyMenuWheelAccum = 0;
      partyMenuWheelLastAt = now;
      if (partyMenuSelectedIndex !== i) {
        partyMenuSelectedIndex = i;
        partyMenuCardIndex = 0;
      }
      partyMenuPrevCardIndex = partyMenuCardIndex;
      partyMenuCardSlideDir = dir;
      partyMenuCardIndex = (partyMenuCardIndex + dir + 4) % 4;
      partyMenuCardAnimUntilMs = performance.now() + 1000;
      renderPlayerMenu();
      e.preventDefault();
    }, { passive: false });

    if (isSelected) {
      const stage = document.createElement('div');
      stage.className = 'partyCardStageFull';

      const cards = [
        buildStatsCard(member, 'party'),
        buildAbilitiesCard(member, { showHotkeys: true, badge: { overlapXMult: 1.8, overlapYMult: 1.8 } }),
        buildInventoryCard(member),
        buildGoalsCard(member)
      ];

      const nowMs = performance.now();
      const animating = (partyMenuPrevCardIndex !== partyMenuCardIndex) && (nowMs < partyMenuCardAnimUntilMs);

      if (animating) {
        const outgoing = cards[partyMenuPrevCardIndex];
        const incoming = cards[partyMenuCardIndex];

        outgoing.classList.add('partyCardAnim', partyMenuCardSlideDir > 0 ? 'to-up' : 'to-down', 'outgoing');
        incoming.classList.add('partyCardAnim', partyMenuCardSlideDir > 0 ? 'from-down' : 'from-up', 'incoming', 'selected');

        stage.appendChild(outgoing);
        stage.appendChild(incoming);
      } else {
        const current = cards[partyMenuCardIndex];
        current.classList.add('selected');
        stage.appendChild(current);
        partyMenuPrevCardIndex = partyMenuCardIndex;
      }

      slot.appendChild(stage);
    } else {
      const statsCard = buildStatsCard(member, 'party');
      statsCard.classList.add('partyCard--scaled');
      slot.appendChild(statsCard);
    }

    wrap.appendChild(slot);
  }

  return wrap;
}

let partyInventoryOverlay = null;
let partyInventoryOverlayTimer = null;
let partyInventoryAfterClose = null;
let partyInventoryPrevContentDisplay = null;
let partyInventoryPrevInMenu = null;
let manualTargetingItemPreview = null;
let manualTargetingAbilityPreview = null;
let manualTargetingCameraRestore = null;
let manualTargetingDragTile = null;
let __lastRecruitIcons = [];
let __lastPromptLayouts = [];
let __lastInteractIconRect = null;
let __lastInteractObjectRect = null;
let __lastInteractItemRect = null;
let __lastExitIconRect = null;
let __pendingInteractIcon = null;

function closePartyInventoryOverlay() {
  if (partyInventoryOverlay && partyInventoryOverlay.parentNode) {
    partyInventoryOverlay.parentNode.removeChild(partyInventoryOverlay);
  }
  partyInventoryOverlay = null;
  if (partyInventoryOverlayTimer) {
    clearTimeout(partyInventoryOverlayTimer);
    partyInventoryOverlayTimer = null;
  }
  if (playerMenuContent && partyInventoryPrevContentDisplay !== null) {
    playerMenuContent.style.display = partyInventoryPrevContentDisplay;
  }
  partyInventoryPrevContentDisplay = null;
  if (partyInventoryPrevInMenu !== null) {
    inMenu = !!partyInventoryPrevInMenu;
    partyInventoryPrevInMenu = null;
  }
  if (typeof partyInventoryAfterClose === 'function') {
    const fn = partyInventoryAfterClose;
    partyInventoryAfterClose = null;
    fn();
  } else {
    partyInventoryAfterClose = null;
  }
}

function buildItemTile({
  id,
  uid,
  inst,
  showName = true,
  showUses = true,
  showDesc = true,
  keyText = null,
  badge = null,
  onClick = null,
  onHoldStart = null,
  holdMs = 260,
  showGiveButton = false,
  onGive = null,
  empty = false,
  highlight = false
}) {
  const tile = document.createElement('div');
  tile.className = 'playerMenuItemTile';
  if (highlight) tile.classList.add('itemJustAdded');

  if (!empty) {
    tile.dataset.itemId = lc(id);
    tile.dataset.itemUid = String(uid);
  }

  if (!empty && (onClick || onHoldStart)) {
    let holdTimer = null;
    let holdFired = false;
    const clearHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
    tile.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      holdFired = false;
      clearHold();
      if (typeof onHoldStart === 'function') {
        const delay = Math.max(80, Number(holdMs) || 0);
        holdTimer = setTimeout(() => {
          holdFired = true;
          onHoldStart(id, uid, tile, e);
        }, delay);
      }
    });
    tile.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      clearHold();
      if (!holdFired && typeof onClick === 'function') {
        onClick(id, uid, tile, e);
      }
    });
    tile.addEventListener('mouseleave', () => {
      clearHold();
    });
    tile.addEventListener('dragstart', (e) => e.preventDefault());
  }

  if (!empty) {
    const def = getItemDef(id) || {};
    const usesPerItem = getItemUsesPerItem(def);

    if (showName) {
      const nameLine = document.createElement('div');
      nameLine.className = 'playerMenuItemName';
      nameLine.textContent = def.name ? String(def.name) : id;
      tile.appendChild(nameLine);
    }

    const imgBox = document.createElement('div');
    imgBox.className = 'playerMenuItemImgBox';

    const img = document.createElement('img');
    img.className = 'playerMenuItemImg';
    img.alt = def.name ? String(def.name) : id;
    img.src = `assets/items/${lc(id)}.png`;

    img.onerror = () => {
      img.style.display = 'none';
      imgBox.classList.add('playerMenuItemImgBoxMissing');
    };

    imgBox.appendChild(img);
    tile.appendChild(imgBox);

    if (showUses && usesPerItem > 1) {
      const countLine = document.createElement('div');
      countLine.className = 'playerMenuItemCount';

      const usesLeft =
        (inst?.usesLeft == null || !isFinite(inst.usesLeft))
          ? usesPerItem
          : Math.max(0, Math.floor(inst.usesLeft));

      countLine.textContent = `uses: ${usesLeft}/${usesPerItem}`;
      tile.appendChild(countLine);
    }

    if (showGiveButton && typeof onGive === 'function') {
      const giveBtn = document.createElement('div');
      giveBtn.textContent = 'Give';
      giveBtn.style.display = 'inline-block';
      giveBtn.style.marginTop = '6px';
      giveBtn.style.padding = '2px 6px';
      giveBtn.style.border = '1px solid #888';
      giveBtn.style.borderRadius = '4px';
      giveBtn.style.fontSize = '12px';
      giveBtn.style.cursor = 'pointer';
      giveBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      giveBtn.addEventListener('mouseup', (e) => e.stopPropagation());
      giveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onGive(id, uid);
      });
      tile.appendChild(giveBtn);
    }

    if (keyText) {
      const merged = (badge && typeof badge === 'object') ? badge : {};
      attachHotkeyBadge(tile, keyText, merged);
    }

    if (showDesc && def.description) {
      const desc = document.createElement('div');
      desc.className = 'playerMenuItemDesc playerMenuMuted';
      desc.textContent = String(def.description);
      tile.appendChild(desc);
    }
  } else {
    const imgBox = document.createElement('div');
    imgBox.className = 'playerMenuItemImgBox playerMenuItemImgBoxMissing';
    tile.appendChild(imgBox);
  }

  return tile;
}

function buildInventoryPanel(actor, opts = {}) {
  const panel = document.createElement('div');
  panel.className = 'partyCardPanel partyCardInventory';

  const name = document.createElement('div');
  name.className = 'partyCardName';
  name.textContent = actor?.name || 'Party Member';
  panel.appendChild(name);

  const title = document.createElement('div');
  title.className = 'partyCardSectionTitle';
  title.textContent = 'Inventory';
  panel.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'playerMenuItemsGrid';
  grid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';

  const cards = getActorInventoryCards(actor);

  const slotCount = Math.max(
    Math.floor(Number(actor?.inventorySize ?? 0)) || 0,
    cards.length
  );

  const highlightUid = opts.highlightUid != null ? String(opts.highlightUid) : null;
  for (let idx = 0; idx < slotCount; idx++) {
    const c = cards[idx];
    const tile = buildItemTile({
      id: c?.id,
      uid: c?.uid,
      inst: c?.inst,
      showName: true,
      showUses: true,
      showDesc: true,
      keyText: (idx < 9) ? String(idx + 1) : null,
      badge: { overlapXMult: 1.8, overlapYMult: 1.8 },
      onClick: (id, uid, tileEl) => {
        void tryUseActorItemWithFeedback(actor, id, uid, tileEl).then((ok) => {
          if (!ok && __lastItemUseError) {
            showPlayerMenuError(__lastItemUseError);
            return;
          }
          if (ok) renderPlayerMenu();
        });
      },
      onHoldStart: (id, uid, tileEl, e) => {
        const res = beginManualItemGiveTargetingForActor(actor, id, uid);
        if (res === 'started') {
          showManualTargetingDragTile(id, uid, actor, tileEl);
          const vrect = viewportEl?.getBoundingClientRect?.();
          if (manualTargetingDragTile && vrect && e) {
            manualTargetingDragTile.style.left = `${e.clientX - vrect.left + 8}px`;
            manualTargetingDragTile.style.top = `${e.clientY - vrect.top + 8}px`;
          }
        }
      },
      empty: !c,
      highlight: highlightUid != null && c && String(c.uid) === highlightUid
    });
    grid.appendChild(tile);
  }

  panel.appendChild(grid);
  return panel;
}

function buildGoalsPanel(actor) {
  const panel = document.createElement('div');
  panel.className = 'partyCardPanel';

  const name = document.createElement('div');
  name.className = 'partyCardName';
  name.textContent = actor?.name || 'Party Member';
  panel.appendChild(name);

  const title = document.createElement('div');
  title.className = 'partyCardSectionTitle';
  title.textContent = 'Goals';
  panel.appendChild(title);

  const store = getGoalStoreForActor(actor);
  const goals = getIncompletePublicGoalsForStore(store);

  if (!goals.length) {
    const none = document.createElement('div');
    none.className = 'playerMenuMuted';
    none.textContent = 'None';
    panel.appendChild(none);
    return panel;
  }

  const list = document.createElement('div');
  list.className = 'partyCardList';
  for (const entry of goals) {
    const g = entry.goal;
    if (!g) continue;

    const row = document.createElement('div');
    row.className = 'partyCardListRow';

    const nameEl = document.createElement('div');
    nameEl.className = 'partyCardListName';
    nameEl.textContent = g.name || g.id || 'Goal';
    row.appendChild(nameEl);

    if (g.description) {
      const desc = document.createElement('div');
      desc.className = 'playerMenuMuted';
      desc.textContent = String(g.description);
      row.appendChild(desc);
    }

    list.appendChild(row);
  }

  panel.appendChild(list);
  return panel;
}

function buildGoalsCard(actor) {
  const c = document.createElement('div');
  c.className = 'partyCard';
  c.appendChild(buildGoalsPanel(actor));
  return c;
}

function getActorInventoryCards(actor) {
  const inv = ensureActorInventory(actor) || {};
  const cards = [];
  for (const [id, bucket] of Object.entries(inv)) {
    const b = getActorInvBucket(actor, id);
    const insts = b?.instances;
    if (!Array.isArray(insts) || insts.length === 0) continue;
    for (const inst of insts) {
      cards.push({ id: lc(id), uid: String(inst?.uid ?? ''), inst });
    }
  }

  cards.sort((a, b) => {
    const da = getItemDef(a.id) || {};
    const db = getItemDef(b.id) || {};
    const na = lc(da.name || a.id);
    const nb = lc(db.name || b.id);
    if (na < nb) return -1;
    if (na > nb) return 1;
    return String(a.uid) < String(b.uid) ? -1 : (String(a.uid) > String(b.uid) ? 1 : 0);
  });

  return cards;
}

function __renderActorInventoryGrid(actor) {
  const wrap = document.createElement('div');
  wrap.className = 'playerMenuItemsGrid';

  const inv = ensureActorInventory(actor) || {};

  const cards = [];
  for (const [id, bucket] of Object.entries(inv)) {
    const b = getActorInvBucket(actor, id);
    const insts = b?.instances;
    if (!Array.isArray(insts) || insts.length === 0) continue;
    for (const inst of insts) {
      cards.push({ id: lc(id), uid: String(inst?.uid ?? ''), inst });
    }
  }

  cards.sort((a, b) => {
    const da = getItemDef(a.id) || {};
    const db = getItemDef(b.id) || {};
    const na = lc(da.name || a.id);
    const nb = lc(db.name || b.id);
    if (na < nb) return -1;
    if (na > nb) return 1;
    return String(a.uid) < String(b.uid) ? -1 : (String(a.uid) > String(b.uid) ? 1 : 0);
  });

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playerMenuMuted';
    empty.textContent = 'No items.';
    wrap.appendChild(empty);
    return wrap;
  }

  for (const { id, uid, inst } of cards) {
    const def = getItemDef(id) || {};
    const usesPerItem = getItemUsesPerItem(def);

    const tile = document.createElement('div');
    tile.className = 'playerMenuItemTile';
    tile.dataset.itemId = lc(id);
    tile.dataset.itemUid = String(uid);

    const nameLine = document.createElement('div');
    nameLine.className = 'playerMenuItemName';
    nameLine.textContent = def.name ? String(def.name) : id;
    tile.appendChild(nameLine);

    const imgBox = document.createElement('div');
    imgBox.className = 'playerMenuItemImgBox';

    const img = document.createElement('img');
    img.className = 'playerMenuItemImg';
    img.alt = def.name ? String(def.name) : id;
    img.src = `assets/items/${lc(id)}.png`;

    img.onerror = () => {
      img.style.display = 'none';
      imgBox.classList.add('playerMenuItemImgBoxMissing');
    };

    imgBox.appendChild(img);
    tile.appendChild(imgBox);

    if (usesPerItem > 1) {
      const countLine = document.createElement('div');
      countLine.className = 'playerMenuItemCount';

      const usesLeft =
        (inst?.usesLeft == null || !isFinite(inst.usesLeft))
          ? usesPerItem
          : Math.max(0, Math.floor(inst.usesLeft));

      countLine.textContent = `uses: ${usesLeft}/${usesPerItem}`;
      tile.appendChild(countLine);
    }

    if (def.description) {
      const desc = document.createElement('div');
      desc.className = 'playerMenuItemDesc playerMenuMuted';
      desc.textContent = String(def.description);
      tile.appendChild(desc);
    }

    wrap.appendChild(tile);
  }

  return wrap;
}

function showPartyInventoryOverlay(actor, opts = {}) {
  if (!playerMenuOverlay || !actor) return;

  closePartyInventoryOverlay();

  const {
    highlightUid = null,
    flashBad = false,
    autoCloseMs = 3000,
    afterClose = null
  } = opts || {};

  if (playerMenuContent) {
    partyInventoryPrevContentDisplay = playerMenuContent.style.display ?? '';
    playerMenuContent.style.display = 'none';
  }
  partyInventoryPrevInMenu = inMenu;
  inMenu = true;
  playerMenuOverlay.style.display = 'block';

  const overlay = document.createElement('div');
  overlay.className = 'partyInventoryOverlay';
  const ensureOverlaySizeVars = () => {
    if (partyMenuCardSize && partyMenuCardSize.h && partyMenuCardSize.w) {
      overlay.style.setProperty('--party-card-height', `${partyMenuCardSize.h}px`);
      overlay.style.setProperty('--party-card-width', `${partyMenuCardSize.w}px`);
      return;
    }
    const viewportRect = viewportEl?.getBoundingClientRect();
    const tabsRect = menuTopTabs?.getBoundingClientRect();
    const tabsBottom = (tabsRect && viewportRect) ? (tabsRect.bottom - viewportRect.top) : 120;
    const availableHeight = Math.max(1, (viewportRect?.height || window.innerHeight) - tabsBottom);
    const cardH = availableHeight * 0.8;
    const cardW = cardH * 0.6667;
    partyMenuCardSize = { h: cardH, w: cardW };
    overlay.style.setProperty('--party-card-height', `${cardH}px`);
    overlay.style.setProperty('--party-card-width', `${cardW}px`);
  };
  ensureOverlaySizeVars();

  const card = document.createElement('div');
  card.className = 'partyCard selected';

  const invCard = buildInventoryPanel(actor, { highlightUid });
  if (flashBad) invCard.classList.add('inventoryFlashBad');
  card.appendChild(invCard);
  overlay.appendChild(card);

  partyInventoryOverlay = overlay;
  playerMenuOverlay.appendChild(overlay);

  partyInventoryAfterClose = (typeof afterClose === 'function') ? afterClose : null;
  if (autoCloseMs != null && Number(autoCloseMs) >= 0) {
    partyInventoryOverlayTimer = setTimeout(() => {
      closePartyInventoryOverlay();
    }, Math.max(0, Number(autoCloseMs) || 0));
  }
}

function renderMenuPage_NPCs() {
  const wrap = document.createElement('div');
  wrap.className = 'playerMenuCard';

  const h = document.createElement('div');
  h.className = 'playerMenuCardTitle';
  h.textContent = 'NPC Index';
  wrap.appendChild(h);

  const note = document.createElement('div');
  note.className = 'playerMenuMuted';
  note.textContent = 'Shows NPCs you have met or who have been in the party. Last known location updates when they leave the party or when you talk to them.';
  wrap.appendChild(note);

  const table = document.createElement('table');
  table.className = 'playerMenuTable';

  const header = document.createElement('tr');
  for (const col of ['Name', 'Met', 'In Party', 'Alignment', 'Affection', 'Last Known']) {
    const th = document.createElement('td');
    th.style.fontWeight = '700';
    th.textContent = col;
    header.appendChild(th);
  }
  table.appendChild(header);

  const entries = Object.entries(npcRegistry || {})
    .filter(([_, rec]) => !!(rec?.met || rec?.hasBeenInParty))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [name, rec] of entries) {
    const tr = document.createElement('tr');

    const lastKnown =
      rec.inParty ? 'With you' :
      (rec.lastSeenArea ? `${rec.lastSeenArea} @ X=${Math.floor(rec.lastSeenWorldX ?? 0)}` : '—');

    const cols = [
      name,
      rec.met ? 'Yes' : 'No',
      rec.inParty ? 'Yes' : 'No',
      String(Number(getActorStatValue(name, 'alignment', 'current') ?? 0)),
      String(Number(getActorStatValue(name, 'affection', 'current') ?? 0)),
      lastKnown
    ];

    for (const c of cols) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  if (entries.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'No NPCs recorded yet.';
    tr.appendChild(td);
    table.appendChild(tr);
  }

  wrap.appendChild(table);
  return wrap;
}

function renderMenuPage_NPCs_Cards() {
  const wrap = document.createElement('div');
  wrap.className = 'partyCardsGrid';

  const entries = Object.entries(npcRegistry || {})
    .filter(([_, rec]) => !!(rec?.met || rec?.hasBeenInParty))
    .map(([name]) => name)
    .filter((name) => lc(name) !== 'player');

  entries.sort((a, b) => a.localeCompare(b));

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playerMenuMuted';
    empty.textContent = 'No characters yet.';
    wrap.appendChild(empty);
    return wrap;
  }

  if (!Number.isFinite(npcMenuSelectedIndex)) npcMenuSelectedIndex = 0;
  if (npcMenuSelectedIndex >= entries.length) npcMenuSelectedIndex = entries.length - 1;
  if (npcMenuSelectedIndex < 0) npcMenuSelectedIndex = 0;
  if (npcMenuLastSelectedIndex !== npcMenuSelectedIndex) {
    npcMenuCardIndex = 0;
    npcMenuLastSelectedIndex = npcMenuSelectedIndex;
  }

  const viewportRect = viewportEl?.getBoundingClientRect();
  const tabsRect = menuTopTabs?.getBoundingClientRect();
  const tabsBottom = (tabsRect && viewportRect) ? (tabsRect.bottom - viewportRect.top) : 120;
  const availableHeight = Math.max(1, (viewportRect?.height || window.innerHeight) - tabsBottom);
  const cardH = availableHeight * 0.8;
  const cardW = cardH * 0.6667;
  const gap = 18;
  const visibleCount = Math.min(5, entries.length);
  const availableWidth = Math.max(1, (viewportRect?.width || window.innerWidth) - (gap * 2));
  let nonSelectedW = cardW;
  if (visibleCount > 1) {
    nonSelectedW = (availableWidth - cardW - (gap * (visibleCount + 1))) / (visibleCount - 1);
    if (!isFinite(nonSelectedW)) nonSelectedW = cardW;
  }
  nonSelectedW = Math.max(0, Math.min(cardW, nonSelectedW));
  const nonSelectedH = nonSelectedW * 1.5;
  wrap.style.setProperty('--party-card-height', `${cardH}px`);
  wrap.style.setProperty('--party-card-width', `${cardW}px`);
  wrap.style.setProperty('--party-card-scaled-height', `${nonSelectedH}px`);
  wrap.style.setProperty('--party-card-scaled-width', `${nonSelectedW}px`);

  const sel = npcMenuSelectedIndex;
  let start = Math.max(0, sel - 2);
  let end = Math.min(entries.length - 1, start + 4);
  start = Math.max(0, end - 4);

  const leftPad = Math.max(0, 2 - (sel - start));
  const rightPad = Math.max(0, 2 - (end - sel));

  const addPlaceholder = () => {
    const slot = document.createElement('div');
    slot.className = 'partyCardSlot scaled';
    wrap.appendChild(slot);
  };

  for (let i = 0; i < leftPad; i++) addPlaceholder();

  const getActorAreaLabel = (actor) => {
    if (!actor) return '—';
    const nm = String(actor.name || '');
    const nameLc = lc(nm);
    const inPartyNow = Array.isArray(party) && party.some(p => lc(p?.name || '') === nameLc);
    const inWorldNow = Array.isArray(npcs) && npcs.some(n => lc(n?.name || '') === nameLc);
    if (inPartyNow || inWorldNow) return currentAreaName ?? '—';
    const rec = ensureNpcRecord(nm);
    return rec?.area || rec?.lastSeenArea || '—';
  };

  const labelForStat = (key) => {
    const def = getStatDef(String(key || '').toLowerCase());
    if (def && def.label) return String(def.label);
    const raw = String(key || '');
    return raw
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  const buildSignedStatBar = (statKey, cur) => {
    const wrap = document.createElement('div');
    wrap.className = 'partyStatBar';
    wrap.style.position = 'relative';

    const val = Math.max(-10, Math.min(10, Number(cur) || 0));
    const pct = (val + 10) / 20; // 0..1

    const marker = document.createElement('img');
    const dir = (val >= 0) ? 'up' : 'down';
    marker.src = `assets/icons/${statKey}_${dir}.png`;
    marker.alt = `${statKey} ${dir}`;
    marker.style.position = 'absolute';
    marker.style.left = `${Math.round(pct * 100)}%`;
    marker.style.top = '50%';
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.width = '16px';
    marker.style.height = '16px';
    wrap.appendChild(marker);

    return wrap;
  };

  const buildStatValueNode = (statKey, rec) => {
    const k = String(statKey || '').toLowerCase();
    const def = getStatDef(k);
    const base = (rec && rec.base != null) ? Number(rec.base) : 0;
    const cur = (rec && rec.current != null) ? Number(rec.current) : 0;

    if (def && def.type === 'depletable') {
      const w = document.createElement('div');
      w.className = 'partyStatBar';
      const fill = document.createElement('div');
      fill.className = 'partyStatBarFill';
      const effMax = Number(getStatEffectiveValue(currentNpc, k) ?? rec?.max ?? 0);
      const pct = (effMax > 0) ? Math.max(0, Math.min(1, cur / effMax)) : 0;
      fill.style.width = `${Math.round(pct * 100)}%`;
      w.appendChild(fill);
      const text = document.createElement('div');
      text.className = 'partyStatBarText';
      text.textContent = `${cur} / ${effMax}`;
      w.appendChild(text);
      return w;
    }

    if (def && def.type === 'variable') {
      const eff = Number(getStatEffectiveValue(currentNpc, k) ?? cur);
      return buildSignedStatBar(k, eff);
    }

    if (def && def.type === 'scalar') {
      const wrapV = document.createElement('span');
      wrapV.className = 'partyStatValue';
      const curSpan = document.createElement('span');
      curSpan.className = 'partyStatCurrent';
      const eff = Number(getStatEffectiveValue(currentNpc, k) ?? base);
      curSpan.textContent = String(eff);
      wrapV.appendChild(curSpan);
      const delta = eff - base;
      if (isFinite(delta) && delta !== 0) {
        const tail = document.createElement('span');
        tail.className = 'partyStatBaseWrap';
        tail.textContent = ` (${base} `;
        const mod = document.createElement('span');
        mod.className = 'partyStatMod ' + (delta > 0 ? 'pos' : 'neg');
        mod.textContent = `${delta > 0 ? '+' : ''}${delta}`;
        const close = document.createElement('span');
        close.textContent = ')';
        tail.appendChild(mod);
        tail.appendChild(close);
        wrapV.appendChild(tail);
      }
      return wrapV;
    }

    const fallback = document.createElement('span');
    fallback.textContent = `${cur} / ${base}`;
    return fallback;
  };

  const buildStatRows = (actor) => {
    const stats = actor?.stats && typeof actor.stats === 'object' ? actor.stats : {};
    const keys = Object.keys(stats);
    const defKeys = NPC_STAT_ORDER.map(d => String(d).toLowerCase());
    const ordered = [];
    for (const k of defKeys) {
      if (stats[k]) ordered.push(k);
    }
    const rest = keys.filter(k => !ordered.includes(k)).sort();
    ordered.push(...rest);
    return ordered.map((k) => {
      const rec = stats[k] || {};
      return [labelForStat(k), buildStatValueNode(k, rec)];
    });
  };

  const buildAbilitiesPanel = (actor, opts = {}) => {
    const panel = document.createElement('div');
    panel.className = 'partyCardPanel';
    const name = document.createElement('div');
    name.className = 'partyCardName';
    name.textContent = actor?.name || 'Party Member';
    panel.appendChild(name);

    const titleI = document.createElement('div');
    titleI.className = 'partyCardSectionTitle';
    titleI.textContent = 'Can Interact With';
    panel.appendChild(titleI);

    const interacts = (typeof getActorInteractTags === 'function')
      ? getActorInteractTags(actor)
      : [];
    const interactLine = document.createElement('div');
    interactLine.className = 'partyTagLine';
    interactLine.textContent = (Array.isArray(interacts) && interacts.length > 0)
      ? interacts.join(', ')
      : 'None';
    panel.appendChild(interactLine);

    const titleT = document.createElement('div');
    titleT.className = 'partyCardSectionTitle';
    titleT.textContent = 'Effects';
    panel.appendChild(titleT);

    const tagsSet = ensureActorTags(actor) || new Set();
    const tags = Array.from(tagsSet.values()).sort();
    const tagWrap = document.createElement('div');
    tagWrap.className = 'partyTagList';
    if (tags.length === 0) {
      tagWrap.textContent = 'None';
    } else {
      for (const t of tags) {
        const pill = document.createElement('span');
        pill.className = 'partyTagPill';
        pill.textContent = t;
        const expMap = actor?.tagExpiresAtMs;
        if (expMap && typeof expMap === 'object' && expMap[t] != null) {
          const now = getGameNowMs();
          const remainMs = Math.max(0, Number(expMap[t]) - now);
          const remainS = Math.ceil(remainMs / 1000);
          if (isFinite(remainS)) {
            const dur = document.createElement('span');
            dur.className = 'partyTagDuration';
            dur.textContent = ` ${remainS}s`;
            pill.appendChild(dur);
          }
        }
        tagWrap.appendChild(pill);
      }
    }
    panel.appendChild(tagWrap);

    const titleA = document.createElement('div');
    titleA.className = 'partyCardSectionTitle';
    titleA.textContent = 'Abilities';
    panel.appendChild(titleA);

    const abilities = Array.isArray(actor?.abilities) ? actor.abilities : [];
    if (abilities.length === 0) {
      const none = document.createElement('div');
      none.className = 'playerMenuMuted';
      none.textContent = 'None';
      panel.appendChild(none);
    } else {
      const list = document.createElement('div');
      list.className = 'partyAbilityCardList';
      const showHotkeys = !!opts.showHotkeys;
      for (let i = 0; i < abilities.length; i++) {
        const ab = abilities[i];
        const hotKey = (showHotkeys && i < 9) ? (i + 1) : null;
        const card = buildAbilityCard(actor, ab, {
          includeToggle: false,
          hotKey,
          showPortrait: false,
          badge: opts.badge || null
        });
        list.appendChild(card);
      }
      panel.appendChild(list);
    }
    return panel;
  };

  const buildStatsCard = (actor) => {
    const c = document.createElement('div');
    c.className = 'partyCard partyCardStatsCard';

    const portraitWrap = document.createElement('div');
    portraitWrap.className = 'partyCardPortrait';
    portraitWrap.style.backgroundColor = getCurrentSkyColor();
    const bgKey = (() => {
      const ctx = getActorPortraitContext(actor, 'npcs');
      const area = ctx.area;
      if (!area || !area.sectionTileWidth || !Array.isArray(area.backgroundEntries)) return null;
      const wx = ctx.worldX;
      const idx = Math.max(0, Math.floor(wx / area.sectionTileWidth));
      const entry = area.backgroundEntries[idx + 1] ?? area.backgroundEntries[idx] ?? null;
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (entry?.img?.src) return entry.img.src;
      return null;
    })();
    if (bgKey) {
      const src = bgKey.includes('assets/')
        ? bgKey
        : `assets/tiles/${bgKey.includes('.') ? bgKey : `${bgKey}.png`}`;
      portraitWrap.style.backgroundImage = `url("${src}")`;
    }
    const img = document.createElement('img');
    img.alt = `${actor.name || 'Member'} portrait`;
    img.src = `assets/portraits/character_portrait_${lc(actor.name || 'player')}_neutral.png`;
    img.addEventListener('error', () => {
      portraitWrap.style.display = 'none';
    });
    portraitWrap.appendChild(img);
    c.appendChild(portraitWrap);

    const overlay = document.createElement('div');
    overlay.className = 'partyCardOverlay';

    const nameBlock = document.createElement('div');
    nameBlock.className = 'partyOverlayBlock';
    const name = document.createElement('div');
    name.className = 'partyCardName';
    name.textContent = actor.name || 'Party Member';
    nameBlock.appendChild(name);
    const area = document.createElement('div');
    area.className = 'partyCardArea playerMenuMuted';
    area.textContent = getActorAreaLabel(actor);
    nameBlock.appendChild(area);
    overlay.appendChild(nameBlock);

    const table = document.createElement('table');
    table.className = 'partyCardStats';
    const rows = buildStatRows(actor);
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const tdK = document.createElement('td');
      const tdV = document.createElement('td');
      tdK.textContent = String(k);
      if (v instanceof Node) tdV.appendChild(v);
      else tdV.textContent = String(v);
      tr.appendChild(tdK);
      tr.appendChild(tdV);
      table.appendChild(tr);
    }
    const statsBlock = document.createElement('div');
    statsBlock.className = 'partyOverlayBlock';
    statsBlock.appendChild(table);
    overlay.appendChild(statsBlock);
    c.appendChild(overlay);
    return c;
  };

  const buildAbilitiesCard = (actor, opts = {}) => {
    const c = document.createElement('div');
    c.className = 'partyCard';
    c.appendChild(buildAbilitiesPanel(actor, opts));
    return c;
  };

  const buildInventoryCard = (actor) => {
    const c = document.createElement('div');
    c.className = 'partyCard';
    c.appendChild(buildInventoryPanel(actor));
    return c;
  };

  const buildNpcMenuActor = (name) => {
    const nameLc = lc(name);
    const liveParty = Array.isArray(party) ? party.find(p => lc(p?.name || '') === nameLc) : null;
    if (liveParty) return liveParty;
    const liveWorld = Array.isArray(npcs) ? npcs.find(n => lc(n?.name || '') === nameLc) : null;
    if (liveWorld) return liveWorld;
    const rec = ensureNpcRecord(name);
    const def = (npcDetailsByLc ? npcDetailsByLc[nameLc] : null) || (npcDetails ? npcDetails[name] : null);
    return {
      name,
      stats: rec?.stats,
      inventory: rec?.inventory,
      inventorySize: Number(def?.inventorySize ?? 0),
      abilities: resolveAbilityList(def?.abilities),
      tags: Array.isArray(rec?.tags) ? rec.tags.slice() : [],
      worldX: rec?.worldX,
      area: rec?.area
    };
  };

  for (let i = start; i <= end; i++) {
    const name = entries[i];
    const actor = buildNpcMenuActor(name);
    const isSelected = (i === sel);
    const slot = document.createElement('div');
    slot.className = 'partyCardSlot' + (isSelected ? ' selected' : ' scaled');
    slot.addEventListener('mouseenter', () => {
      if (npcMenuSelectedIndex !== i) {
        npcMenuSelectedIndex = i;
        npcMenuCardIndex = 0;
        renderPlayerMenu();
      }
    });
    slot.addEventListener('wheel', (e) => {
      const now = performance.now();
      npcMenuWheelAccum += e.deltaY;
      const threshold = 1000;
      if (Math.abs(npcMenuWheelAccum) < threshold) {
        e.preventDefault();
        return;
      }
      if (now - npcMenuWheelLastAt < 120) {
        e.preventDefault();
        return;
      }
      const dir = (npcMenuWheelAccum > 0) ? 1 : -1;
      npcMenuWheelAccum = 0;
      npcMenuWheelLastAt = now;
      if (npcMenuSelectedIndex !== i) {
        npcMenuSelectedIndex = i;
        npcMenuCardIndex = 0;
      }
      npcMenuPrevCardIndex = npcMenuCardIndex;
      npcMenuCardSlideDir = dir;
      npcMenuCardIndex = (npcMenuCardIndex + dir + 4) % 4;
      npcMenuCardAnimUntilMs = performance.now() + 1000;
      renderPlayerMenu();
      e.preventDefault();
    }, { passive: false });

    if (isSelected) {
      const stage = document.createElement('div');
      stage.className = 'partyCardStageFull';

      const cards = [
        buildStatsCard(actor),
        buildAbilitiesCard(actor),
        buildInventoryCard(actor),
        buildGoalsCard(actor)
      ];

      const nowMs = performance.now();
      const animating = (npcMenuPrevCardIndex !== npcMenuCardIndex) && (nowMs < npcMenuCardAnimUntilMs);

      if (animating) {
        const outgoing = cards[npcMenuPrevCardIndex];
        const incoming = cards[npcMenuCardIndex];

        outgoing.classList.add('partyCardAnim', npcMenuCardSlideDir > 0 ? 'to-up' : 'to-down', 'outgoing');
        incoming.classList.add('partyCardAnim', npcMenuCardSlideDir > 0 ? 'from-down' : 'from-up', 'incoming', 'selected');

        stage.appendChild(outgoing);
        stage.appendChild(incoming);
      } else {
        const current = cards[npcMenuCardIndex];
        current.classList.add('selected');
        stage.appendChild(current);
        npcMenuPrevCardIndex = npcMenuCardIndex;
      }

      slot.appendChild(stage);
    } else {
      const statsCard = buildStatsCard(actor);
      statsCard.classList.add('partyCard--scaled');
      slot.appendChild(statsCard);
    }

    wrap.appendChild(slot);
  }

  for (let i = 0; i < rightPad; i++) addPlaceholder();

  return wrap;
}

function renderMenuPage_Journal() {
  const wrap = document.createElement('div');
  wrap.className = 'playerMenuCard';

  const h = document.createElement('div');
  h.className = 'playerMenuCardTitle';
  h.textContent = 'Journal';
  wrap.appendChild(h);

  const goalsTitle = document.createElement('div');
  goalsTitle.className = 'partyCardSectionTitle';
  goalsTitle.textContent = 'Goals';
  wrap.appendChild(goalsTitle);

  const entries = [];

  ensurePlayerGoals();
  if (player) {
    entries.push(...collectJournalGoalsForStore(player, player?.name || 'Player'));
  }

  const npcEntries = Object.entries(npcRegistry || {})
    .filter(([_, rec]) => !!(rec?.met || rec?.hasBeenInParty))
    .map(([name]) => name)
    .filter(n => lc(n) !== 'player')
    .sort((a, b) => a.localeCompare(b));

  for (const name of npcEntries) {
    const rec = ensureNpcRecord(name);
    entries.push(...collectJournalGoalsForStore(rec, name));
  }

  entries.sort((a, b) => {
    if (a.info.complete !== b.info.complete) return a.info.complete ? 1 : -1;
    const ownerCmp = String(a.owner || '').localeCompare(String(b.owner || ''));
    if (ownerCmp) return ownerCmp;
    return String(a.goal?.name || a.goal?.id || '').localeCompare(String(b.goal?.name || b.goal?.id || ''));
  });

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'playerMenuMuted';
    empty.textContent = 'No public goals yet.';
    wrap.appendChild(empty);
    return wrap;
  }

  const list = document.createElement('div');
  list.className = 'partyCardList';

  for (const entry of entries) {
    const g = entry.goal;
    if (!g) continue;

    const row = document.createElement('div');
    row.className = 'partyCardListRow';

    const name = document.createElement('div');
    name.className = 'partyCardListName';
    name.textContent = g.name || g.id || 'Goal';
    row.appendChild(name);

    const owner = document.createElement('div');
    owner.className = 'playerMenuMuted';
    owner.textContent = entry.owner || 'Unknown';
    row.appendChild(owner);

    if (g.description) {
      const desc = document.createElement('div');
      desc.className = 'playerMenuMuted';
      desc.textContent = String(g.description);
      row.appendChild(desc);
    }

    const status = document.createElement('div');
    status.className = 'partyTagLine';
    status.textContent = formatGoalStatusText(entry.info);
    row.appendChild(status);

    list.appendChild(row);
  }

  wrap.appendChild(list);

  return wrap;
}

let itemsMenuHotkeys = []; // index 0..8 => itemId

let abilitiesMenuHotkeys = []; // index 0..8 => { actorName, abilityId }
let abilitiesMenuEntries = []; // index => { actor, ability }
let abilitiesMenuSelectedIndex = 0;

function getAbilityList() {
  const out = [];
  const pAbs = Array.isArray(player.abilities) ? player.abilities : [];
  for (const a of pAbs) {
    if (!a || !a.id) continue;
    out.push({ actor: player, ability: a });
  }
  for (const npc of party) {
    if (!npc) continue;
    const abs = Array.isArray(npc.abilities) ? npc.abilities : [];
    for (const a of abs) {
      if (!a || !a.id) continue;
      out.push({ actor: npc, ability: a });
    }
  }
  return out;
}

function abilityTargetLabel(t) {
  const k = lc(String(t || ''));
  if (!k) return '';
  if (k === 'player' || k === 'self') return 'Self';
  if (k === 'party' || k === 'wholeparty' || k === 'allparty') return 'Party';
  if (k === 'ally') return 'Ally';
  if (k === 'enemy') return 'Enemy';
  if (k === 'neutral') return 'Neutral';
  if (k === 'npc') return 'NPC';
  if (k === 'mob') return 'Enemy';
  if (k === 'object') return 'Object';
  return t;
}

function formatAbilityTargets(ability) {
  if (!ability) return 'â€”';
  const fixed = lc(String(ability.fixedTarget || ''));
  if (fixed) return abilityTargetLabel(fixed) || fixed;
  const t = ability.targeting || {};
  const pri = Array.isArray(t.priority) ? t.priority.map(abilityTargetLabel).filter(Boolean) : [];
  const allowed = Array.isArray(t.allowed) ? t.allowed.map(abilityTargetLabel).filter(Boolean) : [];
  if (pri.length === 0 && allowed.length === 0) return 'â€”';
  const priTxt = pri.length ? pri.join(', ') : '';
  const allowedTxt = allowed.length ? allowed.join(', ') : '';
  if (priTxt && allowedTxt) return { priTxt, allowedTxt };
  if (priTxt) return { priTxt, allowedTxt: '' };
  return { priTxt: '', allowedTxt };
}

function classifyAbilityClass(ability) {
  let hasRed = false;
  let hasGreen = false;
  let hasBlue = false;
  let hasYellow = false;
  const effects = Array.isArray(ability?.effects) ? ability.effects : [];
  for (const ef of effects) {
    if (!ef || lc(ef.type) !== 'updatestat') continue;
    const stat = lc(ef.stat || '');
    const delta = Number(ef.delta || 0);
    if (!isFinite(delta) || delta === 0) continue;
    if (stat === 'stamina' || stat === 'composure') {
      if (delta > 0) hasGreen = true;
      else hasRed = true;
    } else {
      if (delta > 0) hasBlue = true;
      else hasYellow = true;
    }
  }
  if (hasRed) return 'abilityCard--red';
  if (hasGreen) return 'abilityCard--green';
  if (hasBlue) return 'abilityCard--blue';
  if (hasYellow) return 'abilityCard--yellow';
  return 'abilityCard--sepia';
}

function buildAbilityCard(actor, ability, opts = {}) {
  const hotKey = opts.hotKey ?? null;
  const includeToggle = (opts.includeToggle !== false);
  const onToggle = (typeof opts.onToggle === 'function') ? opts.onToggle : null;
  const onClick = (typeof opts.onClick === 'function') ? opts.onClick : null;
  const extraClass = opts.extraClass || '';
  const badgeOpts = opts.badge || null;
  const showPortrait = (opts.showPortrait !== false);

  const ownerName = (actor === player) ? 'Player' : (actor?.name || 'Party Member');
  const abName = String(ability?.name || ability?.id || 'Ability');
  const desc = String(ability?.description || '');

  const card = document.createElement('div');
  card.className = `abilityCard ${classifyAbilityClass(ability)}${extraClass ? ` ${extraClass}` : ''}`;
  if (hotKey && !showPortrait) {
    card.classList.add('abilityCard--hotkeyIndent');
  }
  if (onClick) {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
  }

  if (showPortrait) {
    const portrait = document.createElement('div');
    portrait.className = 'abilityCardPortrait';
    const img = document.createElement('img');
    img.alt = `${ownerName} prompt`;
    img.src = `assets/icons/${lc(ownerName)}_prompt.png`;
    img.addEventListener('error', () => {
      portrait.classList.add('no-img');
    });
    portrait.appendChild(img);
    card.appendChild(portrait);
  }

  const content = document.createElement('div');
  content.className = 'abilityCardContent';

  const header = document.createElement('div');
  header.className = 'abilityCardHeader';

  const title = document.createElement('div');
  title.className = 'abilityCardTitle';
  title.textContent = abName;
  header.appendChild(title);

  if (includeToggle) {
    const toggle = document.createElement('button');
    toggle.textContent = (lc(actor?.autoCastAbilityId || '') === lc(ability?.id || '')) ? 'Auto: On' : 'Auto: Off';
    toggle.className = 'playerMenuToggleBtn';
    if (onToggle) toggle.addEventListener('click', onToggle);
    toggle.addEventListener('click', (e) => e.stopPropagation());
    header.appendChild(toggle);
  }

  content.appendChild(header);

  const meta = document.createElement('div');
  meta.className = 'abilityCardMeta';
  const cdMs = Number(ability?.cooldownMs || 0);
  const nextAt = Number(actor?.abilityNextAtMs?.[lc(ability?.id || '')] || 0);
  const remainingMs = Math.max(0, nextAt - getGameNowMs());
  const remainingSec = Math.ceil(remainingMs / 1000);
  const cooldownTxt = (cdMs > 0 && remainingMs > 0) ? `CD: ${remainingSec}s` : '';
  meta.textContent = cooldownTxt;
  content.appendChild(meta);

  const descWrap = document.createElement('div');
  descWrap.className = 'abilityCardDesc';
  descWrap.textContent = desc || 'â€”';
  content.appendChild(descWrap);

  const targetLine = document.createElement('div');
  targetLine.className = 'abilityCardTargets';
  const targets = formatAbilityTargets(ability);
  if (typeof targets === 'string') {
    targetLine.textContent = `Target: ${targets}`;
  } else {
    const label = document.createElement('span');
    label.textContent = 'Target: ';
    const pri = document.createElement('span');
    pri.className = 'abilityCardTargetPriority';
    pri.textContent = targets.priTxt || '';
    targetLine.appendChild(label);
    if (targets.priTxt) targetLine.appendChild(pri);
    if (targets.allowedTxt) {
      if (targets.priTxt) {
        const sep = document.createElement('span');
        sep.textContent = ' ';
        targetLine.appendChild(sep);
      }
      const allowed = document.createElement('span');
      allowed.className = 'abilityCardTargetAllowed';
      allowed.textContent = targets.allowedTxt;
      targetLine.appendChild(allowed);
    }
  }
  content.appendChild(targetLine);

  card.appendChild(content);

  if (hotKey) {
    const merged = (badgeOpts && typeof badgeOpts === 'object') ? badgeOpts : {};
    attachHotkeyBadge(card, hotKey, merged);
  }
  return card;
}

function triggerAbilityFromEntry(entry) {
  if (!entry || !entry.actor || !entry.ability) return;
  const actorName = (entry.actor === player) ? 'player' : entry.actor.name;
  const abilityId = String(entry.ability.id || '');
  if (!abilityId) return;
  const res = beginManualTargeting(actorName, abilityId);
  if (res === 'started') return;
  if (res === 'casted') {
    closePlayerMenu();
    renderPlayerMenu();
    return;
  }
}

function renderMenuPage_Abilities_OLD() {
  const wrap = document.createElement('div');
  wrap.className = 'playerMenuGrid';

  abilitiesMenuHotkeys = [];

  const list = getAbilityList();
  const now = getGameNowMs();

  const card = document.createElement('div');
  card.className = 'playerMenuCard';
  const h = document.createElement('div');
  h.className = 'playerMenuCardTitle';
  h.textContent = 'Abilities';
  card.appendChild(h);

  const table = document.createElement('table');
  table.className = 'playerMenuTable';

  for (let i = 0; i < list.length; i++) {
    const { actor, ability } = list[i];
    const abId = String(ability.id);
    const abName = String(ability.name || ability.id);
    const desc = String(ability.description || '');
    const cdMs = Number(ability.cooldownMs || 0);

    const nextAt = Number(actor.abilityNextAtMs?.[lc(abId)] || 0);
    const remainingMs = Math.max(0, nextAt - now);
    const remainingSec = Math.ceil(remainingMs / 1000);

    const hotKey = (i < 9) ? (i + 1) : null;
    if (hotKey) {
      abilitiesMenuHotkeys[hotKey - 1] = { actorName: (actor === player) ? 'player' : actor.name, abilityId: abId };
    }

    const ownerName = (actor === player) ? 'Player' : actor.name;
    const label = hotKey
      ? `${hotKey}. ${ownerName} — ${abName}`
      : `${ownerName} — ${abName}`;

    const cooldownTxt = (cdMs > 0 && remainingMs > 0) ? ` (CD: ${remainingSec}s)` : '';

    const tr = document.createElement('tr');
    const tdK = document.createElement('td');
    const tdV = document.createElement('td');
    tdK.textContent = label + cooldownTxt;

    const toggle = document.createElement('button');
    toggle.textContent = (lc(actor.autoCastAbilityId || '') === lc(abId)) ? 'Auto: On' : 'Auto: Off';
    toggle.className = 'playerMenuToggleBtn';
    toggle.addEventListener('click', () => {
      toggleActorAutoCast(actor, abId);
      renderPlayerMenu();
    });

    const descWrap = document.createElement('div');
    descWrap.textContent = desc;
    tdV.appendChild(descWrap);
    tdV.appendChild(toggle);

    tr.appendChild(tdK);
    tr.appendChild(tdV);
    table.appendChild(tr);
  }

  if (list.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.textContent = 'No abilities available.';
    tr.appendChild(td);
    table.appendChild(tr);
  }

  card.appendChild(table);
  wrap.appendChild(card);
  return wrap;
}

function renderMenuPage_Abilities_OLD2() {
  const wrap = document.createElement('div');
  wrap.className = 'abilitiesCardGrid';

  abilitiesMenuHotkeys = [];

  const list = getAbilityList();
  abilitiesMenuEntries = list.slice();
  const now = getGameNowMs();
  if (!Number.isFinite(abilitiesMenuSelectedIndex)) abilitiesMenuSelectedIndex = 0;
  if (abilitiesMenuSelectedIndex >= list.length) abilitiesMenuSelectedIndex = Math.max(0, list.length - 1);
  if (abilitiesMenuSelectedIndex < 0) abilitiesMenuSelectedIndex = 0;

  const classifyAbilityClass = (ability) => {
    let hasRed = false;
    let hasGreen = false;
    let hasBlue = false;
    let hasYellow = false;
    const effects = Array.isArray(ability?.effects) ? ability.effects : [];
    for (const ef of effects) {
      if (!ef || lc(ef.type) !== 'updatestat') continue;
      const stat = lc(ef.stat || '');
      const delta = Number(ef.delta || 0);
      if (!isFinite(delta) || delta === 0) continue;
      if (stat === 'stamina' || stat === 'composure') {
        if (delta > 0) hasGreen = true;
        else hasRed = true;
      } else {
        if (delta > 0) hasBlue = true;
        else hasYellow = true;
      }
    }
    if (hasRed) return 'abilityCard--red';
    if (hasGreen) return 'abilityCard--green';
    if (hasBlue) return 'abilityCard--blue';
    if (hasYellow) return 'abilityCard--yellow';
    return 'abilityCard--sepia';
  };

  const targetLabel = (t) => {
    const k = lc(String(t || ''));
    if (!k) return '';
    if (k === 'player' || k === 'self') return 'Self';
    if (k === 'party' || k === 'wholeparty' || k === 'allparty') return 'Party';
    if (k === 'npc') return 'NPC';
    if (k === 'mob') return 'Enemy';
    if (k === 'object') return 'Object';
    return t;
  };

  const formatTargets = (ability) => {
    if (!ability) return '—';
    const fixed = lc(String(ability.fixedTarget || ''));
    if (fixed) return targetLabel(fixed) || fixed;
    const t = ability.targeting || {};
    const pri = Array.isArray(t.priority) ? t.priority.map(targetLabel).filter(Boolean) : [];
    const allowed = Array.isArray(t.allowed) ? t.allowed.map(targetLabel).filter(Boolean) : [];
    if (pri.length === 0 && allowed.length === 0) return '—';
    const priTxt = pri.length ? pri.join(', ') : '';
    const allowedTxt = allowed.length ? allowed.join(', ') : '';
    if (priTxt && allowedTxt) return { priTxt, allowedTxt };
    if (priTxt) return { priTxt, allowedTxt: '' };
    return { priTxt: '', allowedTxt };
  };

  for (let i = 0; i < list.length; i++) {
    const { actor, ability } = list[i];
    const abId = String(ability.id);
    const abName = String(ability.name || ability.id);
    const desc = String(ability.description || '');
    const cdMs = Number(ability.cooldownMs || 0);

    const nextAt = Number(actor.abilityNextAtMs?.[lc(abId)] || 0);
    const remainingMs = Math.max(0, nextAt - now);
    const remainingSec = Math.ceil(remainingMs / 1000);

    const hotKey = (i < 9) ? (i + 1) : null;
    if (hotKey) {
      abilitiesMenuHotkeys[hotKey - 1] = { actorName: (actor === player) ? 'player' : actor.name, abilityId: abId };
    }

    const ownerName = (actor === player) ? 'Player' : actor.name;
    const cooldownTxt = (cdMs > 0 && remainingMs > 0) ? ` (CD: ${remainingSec}s)` : '';

    const toggle = document.createElement('button');
    toggle.textContent = (lc(actor.autoCastAbilityId || '') === lc(abId)) ? 'Auto: On' : 'Auto: Off';
    toggle.className = 'playerMenuToggleBtn';
    toggle.addEventListener('click', () => {
      // Keep card click from firing
      toggle.blur();
      toggleActorAutoCast(actor, abId);
      renderPlayerMenu();
    });
    toggle.addEventListener('click', (e) => e.stopPropagation());

    const card = document.createElement('div');
    card.className = `abilityCard ${classifyAbilityClass(ability)}`;
    if (i === abilitiesMenuSelectedIndex) card.classList.add('selected');
    card.addEventListener('click', () => {
      abilitiesMenuSelectedIndex = i;
      triggerAbilityFromEntry({ actor, ability });
    });

    const portrait = document.createElement('div');
    portrait.className = 'abilityCardPortrait';
    const img = document.createElement('img');
    img.alt = `${ownerName} prompt`;
    img.src = `assets/icons/${lc(ownerName)}_prompt.png`;
    img.addEventListener('error', () => {
      portrait.classList.add('no-img');
    });
    portrait.appendChild(img);
    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'abilityCardPortraitName';
    nameOverlay.textContent = ownerName;
    portrait.appendChild(nameOverlay);
    card.appendChild(portrait);

    const content = document.createElement('div');
    content.className = 'abilityCardContent';

    const header = document.createElement('div');
    header.className = 'abilityCardHeader';

    const title = document.createElement('div');
    title.className = 'abilityCardTitle';
    title.textContent = hotKey ? `${abName} [${hotKey}]` : abName;
    header.appendChild(title);
    header.appendChild(toggle);
    content.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'abilityCardMeta';
    meta.textContent = `${ownerName}${cooldownTxt}`;
    content.appendChild(meta);

    const descWrap = document.createElement('div');
    descWrap.className = 'abilityCardDesc';
    descWrap.textContent = desc || 'â€”';
    content.appendChild(descWrap);

    const targetLine = document.createElement('div');
    targetLine.className = 'abilityCardTargets';
    const targets = formatTargets(ability);
    if (typeof targets === 'string') {
      targetLine.textContent = `Target: ${targets}`;
    } else {
      const label = document.createElement('span');
      label.textContent = 'Target: ';
      const pri = document.createElement('span');
      pri.className = 'abilityCardTargetPriority';
      pri.textContent = targets.priTxt || '';
      targetLine.appendChild(label);
      if (targets.priTxt) targetLine.appendChild(pri);
      if (targets.allowedTxt) {
        if (targets.priTxt) {
          const sep = document.createElement('span');
          sep.textContent = ' ';
          targetLine.appendChild(sep);
        }
        const allowed = document.createElement('span');
        allowed.className = 'abilityCardTargetAllowed';
        allowed.textContent = targets.allowedTxt;
        targetLine.appendChild(allowed);
      }
    }
    content.appendChild(targetLine);
    card.appendChild(content);

    wrap.appendChild(card);
  }

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playerMenuMuted';
    empty.textContent = 'No abilities available.';
    wrap.appendChild(empty);
  }

  return wrap;
}

function renderMenuPage_Abilities() {
  const wrap = document.createElement('div');
  wrap.className = 'abilitiesCardGrid';

  abilitiesMenuHotkeys = [];

  const list = getAbilityList();
  abilitiesMenuEntries = list.slice();
  if (!Number.isFinite(abilitiesMenuSelectedIndex)) abilitiesMenuSelectedIndex = 0;
  if (abilitiesMenuSelectedIndex >= list.length) abilitiesMenuSelectedIndex = Math.max(0, list.length - 1);
  if (abilitiesMenuSelectedIndex < 0) abilitiesMenuSelectedIndex = 0;

  for (let i = 0; i < list.length; i++) {
    const { actor, ability } = list[i];
    const abId = String(ability.id);
    const hotKey = (i < 9) ? (i + 1) : null;
    if (hotKey) {
      abilitiesMenuHotkeys[hotKey - 1] = { actorName: (actor === player) ? 'player' : actor.name, abilityId: abId };
    }

    const card = buildAbilityCard(actor, ability, {
      hotKey,
      includeToggle: true,
      onToggle: () => {
        toggleActorAutoCast(actor, abId);
        renderPlayerMenu();
      },
      onClick: (e) => {
        abilitiesMenuSelectedIndex = i;
        if (e && e.shiftKey) {
          toggleActorAutoCast(actor, abId);
          renderPlayerMenu();
          return;
        }
        triggerAbilityFromEntry({ actor, ability });
      }
    });
    if (i === abilitiesMenuSelectedIndex) card.classList.add('selected');
    wrap.appendChild(card);
  }

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playerMenuMuted';
    empty.textContent = 'No abilities available.';
    wrap.appendChild(empty);
  }

  return wrap;
}

function __screenToRenderX(sx) {
  const cx = WIDTH * 0.5;
  return (Number(sx) - cx) / Math.max(0.0001, cameraZoom) + cx;
}

function __screenToRenderY(sy) {
  const cy = HEIGHT * 0.5;
  return (Number(sy) - cy) / Math.max(0.0001, cameraZoom) + cy;
}

function __actorRenderCenter(actor) {
  if (!actor) return null;
  const isObj = (actor.kind === 'object' || actor._targetKind === 'object');
  const parallax = isObj ? Number(actor._parallax || PARALLAX.ground) : null;
  const baseX = Number(actor.worldX) || 0;
  const sx = isObj
    ? (worldToScreenX(baseX, parallax) + (Number(actor.w) || 0) * 0.5)
    : (baseX - cameraX + (Number(actor.w) || 0) * 0.5);
  const sy = (Number(actor.y) || 0) + (Number(actor.h) || 0) * 0.45;
  return { x: sx, y: sy };
}

function __getTargetKindsFromDef(tdef, priorityOnly = false) {
  if (!tdef) return [];
  // Default: no targets unless priority/allowed are defined
  const list = priorityOnly
    ? (tdef.priority || [])
    : [...(tdef.priority || []), ...(tdef.allowed || [])];
  return Array.from(new Set(list));
}

const COVER_LAYER_ORDER = {
  back: 0,
  gback: 1,
  actor: 2,
  gfore: 3,
  fore: 4
};

function _coverLayerOrder(layer) {
  const k = lc(layer);
  return (k && Object.prototype.hasOwnProperty.call(COVER_LAYER_ORDER, k))
    ? COVER_LAYER_ORDER[k]
    : -1;
}

function _getObjectDrawMetrics(obj, bucket, nowMs) {
  if (!obj || !bucket) return null;

  const base = objectBaseFromKey(obj.key || obj.name || obj.filename);
  if (!base) return null;

  const resolved = resolvePlacedObjectRender(obj, base, nowMs);
  let entry = resolved.entry;
  if (!entry || !entry.ready || entry.failed) {
    const fallback = loadObjectImage(base);
    if (fallback && fallback.ready && !fallback.failed) entry = fallback;
    else return null;
  }

  const targetH = Math.floor(
    (obj.heightPx || (TILE_DRAW_HEIGHT() * bucket.defaultHMult)) * SCALE.objects
  );

  let targetW = Math.floor(player.w);
  const def = getObjectDef(base) || null;
  const fw = Number(def?.animFramePx?.w);
  const fh = Number(def?.animFramePx?.h);
  if (isFinite(fw) && isFinite(fh) && fh > 0) {
    targetW = Math.floor(targetH * (fw / fh));
  } else if (entry && entry.ready) {
    const srcW = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameW) : Math.max(1, entry.w);
    const srcH = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameH) : Math.max(1, entry.h);
    if (srcH > 0) targetW = Math.floor(targetH * (srcW / srcH));
  }

  let baseW = null;
  let baseH = null;
  if (isFinite(fw) && isFinite(fh) && fw > 0 && fh > 0) {
    baseW = fw; baseH = fh;
  } else if (entry && entry.ready) {
    const srcW = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameW) : Math.max(1, entry.w);
    const srcH = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameH) : Math.max(1, entry.h);
    if (srcW > 0 && srcH > 0) { baseW = srcW; baseH = srcH; }
  }

  const sx = worldToScreenX(obj.worldX, bucket.parallax);
  const dy = Math.floor(bucket.dyFn(obj, targetH));

  return { base, entry, targetW, targetH, sx, dy, baseW, baseH };
}

function __getCoverRectsForCurrentArea() {
  if (!currentArea) return [];
  const nowMs = getGameNowMs();
  const out = [];

  const buckets = [
    {
      layer: 'back',
      list: currentArea.backObjects,
      parallax: PARALLAX.backObjects,
      defaultHMult: 0.55,
      dyFn: (obj, targetH) => {
        const baseY = HEIGHT - TILE_DRAW_HEIGHT();
        return baseY - targetH + (obj.yJitter || 0) - (obj.baseBelowTop || 0);
      }
    },
    {
      layer: 'gback',
      list: currentArea.groundBackObjects,
      parallax: PARALLAX.ground,
      defaultHMult: 0.70,
      dyFn: (_obj, targetH) => (HEIGHT - targetH - 250)
    },
    {
      layer: 'gfore',
      list: currentArea.groundForeObjects,
      parallax: PARALLAX.ground,
      defaultHMult: 0.70,
      dyFn: (_obj, targetH) => (HEIGHT - targetH)
    },
    {
      layer: 'fore',
      list: currentArea.foreObjects,
      parallax: PARALLAX.foreground,
      defaultHMult: 0.70,
      dyFn: (_obj, targetH) => (HEIGHT - targetH)
    }
  ];

  for (const bucket of buckets) {
    const list = bucket.list;
    if (!Array.isArray(list) || list.length === 0) continue;

    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (!obj) continue;
      if (obj._spawned === false) continue;

      const m = _getObjectDrawMetrics(obj, bucket, nowMs);
      if (!m || !m.baseW || !m.baseH) continue;

      const def = getObjectDef(m.base) || null;
      const coverDef = def?.cover || null;
      if (!coverDef) continue;

      if (def?.blocker && shouldPlayerSeeBlockerAsOpen(def.blocker)) continue;

      const rect = coverDef.rect || coverDef;
      if (!rect || typeof rect !== 'object') continue;

      const rw = Number(rect.w);
      const rh = Number(rect.h);
      if (!(isFinite(rw) && rw > 0)) continue;
      if (!(isFinite(rh) && rh > 0)) continue;

      const scaleX = m.targetW / m.baseW;
      const scaleY = m.targetH / m.baseH;

      const rx = m.sx + (Number(rect.x) || 0) * scaleX;
      const ry = m.dy + (Number(rect.y) || 0) * scaleY;

      const instanceId = _objectInstanceIdForBucket(obj, bucket.layer, m.base, i);
      const instanceKey = `object:${instanceId}`;

      out.push({
        x: rx,
        y: ry,
        w: rw * scaleX,
        h: rh * scaleY,
        layer: bucket.layer,
        layerOrder: _coverLayerOrder(bucket.layer),
        drawIndex: i,
        instanceKey
      });
    }
  }

  return out;
}

function _targetScreenRect(target) {
  if (!target) return null;
  if (target._targetKind === 'object') {
    if (!isFinite(target._screenX) || !isFinite(target._screenY)) return null;
    return { x: target._screenX, y: target._screenY, w: target._screenW, h: target._screenH };
  }

  if (!isFinite(target.worldX) || !isFinite(target.y)) return null;
  const x = Number(target.worldX) - Number(cameraX || 0);
  const y = Number(target.y);
  const w = Number(target.w || 0);
  const h = Number(target.h || 0);
  return { x, y, w, h };
}

function _isTargetBehindCover(targetLayerOrder, targetDrawIndex, coverLayerOrder, coverDrawIndex) {
  if (coverLayerOrder < 0 || targetLayerOrder < 0) return false;
  if (coverLayerOrder > targetLayerOrder) return true;
  if (coverLayerOrder < targetLayerOrder) return false;
  return (coverDrawIndex > targetDrawIndex);
}

function isTargetCovered(target, coverList) {
  if (!target || !Array.isArray(coverList) || coverList.length === 0) return false;

  const tRect = _targetScreenRect(target);
  if (!tRect) return false;

  const tLayerOrder = (target._targetKind === 'object')
    ? _coverLayerOrder(target._layer)
    : COVER_LAYER_ORDER.actor;
  const tDrawIndex = (target._targetKind === 'object') ? (target._drawIndex ?? 0) : 0;
  const tKey = (target._targetKind === 'object') ? String(target.instanceId || '') : '';

  for (const c of coverList) {
    if (!c) continue;
    if (tKey && c.instanceKey && String(c.instanceKey) === `object:${tKey}`) continue;

    if (!_isTargetBehindCover(tLayerOrder, tDrawIndex, c.layerOrder, c.drawIndex)) continue;

    if (aabbOverlap(tRect.x, tRect.y, tRect.w, tRect.h, c.x, c.y, c.w, c.h)) {
      return true;
    }
  }

  return false;
}

function _getPlacedObjectByInstanceKeyWithLayer(instanceKey) {
  const raw = String(instanceKey || '');
  if (!raw.startsWith('object:')) return null;

  const rest = raw.slice('object:'.length);
  const parts = raw.split(':');

  if (parts.length === 4) {
    const layer = parts[1];
    const base = lc(parts[2]);
    const idx = Math.floor(Number(parts[3]));
    const list = _getObjectBucketListByLayerToken(layer);
    if (!Array.isArray(list)) return null;
    if (!isFinite(idx) || idx < 0 || idx >= list.length) return null;
    const obj = list[idx];
    if (!obj) return null;
    const gotBase = objectBaseFromKey(obj.key || obj.name || obj.filename);
    if (lc(gotBase) !== base) return null;
    return { obj, layer, index: idx };
  }

  const wantId = String(rest || '').trim();
  if (!wantId || !currentArea) return null;

  const buckets = [
    { layer: 'back',  list: currentArea.backObjects },
    { layer: 'fore',  list: currentArea.foreObjects },
    { layer: 'gback', list: currentArea.groundBackObjects },
    { layer: 'gfore', list: currentArea.groundForeObjects }
  ];

  for (const b of buckets) {
    if (!Array.isArray(b.list)) continue;
    for (let i = 0; i < b.list.length; i++) {
      const o = b.list[i];
      if (!o) continue;
      if (String(o.instanceId || '').trim() === wantId) return { obj: o, layer: b.layer, index: i };
    }
  }

  return null;
}

function _buildObjectTargetForInstance(instanceKey) {
  const info = _getPlacedObjectByInstanceKeyWithLayer(instanceKey);
  if (!info || !info.obj) return null;

  const bucketMap = {
    back: { parallax: PARALLAX.backObjects, defaultHMult: 0.55, dyFn: (obj, targetH) => {
      const baseY = HEIGHT - TILE_DRAW_HEIGHT();
      return baseY - targetH + (obj.yJitter || 0) - (obj.baseBelowTop || 0);
    }},
    fore: { parallax: PARALLAX.foreground, defaultHMult: 0.70, dyFn: (_obj, targetH) => (HEIGHT - targetH) },
    gback: { parallax: PARALLAX.ground, defaultHMult: 0.70, dyFn: (_obj, targetH) => (HEIGHT - targetH - 250) },
    gfore: { parallax: PARALLAX.ground, defaultHMult: 0.70, dyFn: (_obj, targetH) => (HEIGHT - targetH) }
  };

  const bucket = bucketMap[info.layer];
  if (!bucket) return null;

  const m = _getObjectDrawMetrics(info.obj, bucket, getGameNowMs());
  if (!m) return null;

  const instanceId = String(info.obj.instanceId || `${info.layer}:${m.base}:${info.index}`).trim();

  return {
    kind: 'object',
    id: m.base,
    instanceId,
    worldX: info.obj.worldX,
    w: m.targetW,
    h: m.targetH,
    y: m.dy,
    _parallax: bucket.parallax,
    _layer: info.layer,
    _drawIndex: info.index,
    _screenX: m.sx,
    _screenY: m.dy,
    _screenW: m.targetW,
    _screenH: m.targetH,
    _targetKind: 'object'
  };
}

function isObjectInstanceCovered(instanceKey) {
  const coverList = __getCoverRectsForCurrentArea();
  if (!coverList.length) return false;

  const target = _buildObjectTargetForInstance(instanceKey);
  if (!target) return false;
  return isTargetCovered(target, coverList);
}

function isObjectInstanceCoveredWithCoverList(instanceKey, coverList) {
  if (!instanceKey || !Array.isArray(coverList) || coverList.length === 0) return false;
  const target = _buildObjectTargetForInstance(instanceKey);
  if (!target) return false;
  return isTargetCovered(target, coverList);
}

function getWorldItemByInstanceKey(instanceKey) {
  if (!instanceKey || !currentArea || !currentArea.worldItemByKey) return null;
  if (currentArea.worldItemByKey instanceof Map) {
    return currentArea.worldItemByKey.get(instanceKey) || null;
  }
  return currentArea.worldItemByKey[instanceKey] || null;
}

function isWorldItemAvailable(item) {
  if (!item || item._picked) return false;
  const flagKey = worldItemPickedFlagKey(item.instanceKey);
  if (flagKey && getFlag('global', flagKey)) return false;
  return true;
}

function isWorldItemInteractable(instanceKey) {
  const item = getWorldItemByInstanceKey(instanceKey);
  return isWorldItemAvailable(item);
}

function getWorldItemDrawMetrics(item) {
  if (!item) return null;
  const def = getItemDef(item.itemId);
  const icon = __getItemIcon(item.itemId, def);

  const baseH = Number(def?.worldSizePx ?? 80);
  const targetH = Math.max(12, Math.floor(baseH * SCALE.objects));

  let targetW = targetH;
  if (icon && icon.ready && icon.img) {
    const srcW = Math.max(1, icon.img.width || 1);
    const srcH = Math.max(1, icon.img.height || 1);
    if (srcH > 0) targetW = Math.max(8, Math.floor(targetH * (srcW / srcH)));
  }

  const leftWorldX = (Number(item.worldX) || 0) - (targetW * 0.5);
  const sx = worldToScreenX(leftWorldX, PARALLAX.ground);
  const sy = Math.floor(HEIGHT - targetH);

  return { icon, targetW, targetH, sx, sy };
}

function _buildWorldItemTarget(item) {
  if (!item) return null;
  const m = getWorldItemDrawMetrics(item);
  if (!m) return null;

  return {
    _targetKind: 'object',
    _layer: 'gback',
    _drawIndex: Number(item._drawIndex || 0),
    _screenX: Math.floor(m.sx),
    _screenY: Math.floor(m.sy),
    _screenW: Math.floor(m.targetW),
    _screenH: Math.floor(m.targetH),
    instanceId: String(item.instanceKey || ''),
    worldX: Number(item.worldX) || 0,
    w: m.targetW,
    h: m.targetH,
    y: m.sy
  };
}

function isWorldItemCoveredWithCoverList(instanceKey, coverList) {
  if (!instanceKey || !Array.isArray(coverList) || coverList.length === 0) return false;
  const item = getWorldItemByInstanceKey(instanceKey);
  if (!item) return false;
  const target = _buildWorldItemTarget(item);
  if (!target) return false;
  return isTargetCovered(target, coverList);
}

function __getObjectTargetPoolForCurrentArea() {
  if (!currentArea) return [];
  const nowMs = getGameNowMs();
  const out = [];

  const buckets = [
    {
      layer: 'back',
      list: currentArea.backObjects,
      parallax: PARALLAX.backObjects,
      defaultHMult: 0.55,
      dyFn: (obj, targetH) => {
        const baseY = HEIGHT - TILE_DRAW_HEIGHT();
        return baseY - targetH + (obj.yJitter || 0) - (obj.baseBelowTop || 0);
      }
    },
    {
      layer: 'fore',
      list: currentArea.foreObjects,
      parallax: PARALLAX.foreground,
      defaultHMult: 0.70,
      dyFn: (_obj, targetH) => (HEIGHT - targetH)
    },
    {
      layer: 'gback',
      list: currentArea.groundBackObjects,
      parallax: PARALLAX.ground,
      defaultHMult: 0.70,
      dyFn: (_obj, targetH) => (HEIGHT - targetH - 250)
    },
    {
      layer: 'gfore',
      list: currentArea.groundForeObjects,
      parallax: PARALLAX.ground,
      defaultHMult: 0.70,
      dyFn: (_obj, targetH) => (HEIGHT - targetH)
    }
  ];

  for (const bucket of buckets) {
    const list = bucket.list;
    if (!Array.isArray(list) || list.length === 0) continue;

    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (!obj) continue;
      if (obj._spawned === false) continue;

      const m = _getObjectDrawMetrics(obj, bucket, nowMs);
      if (!m) continue;

      const instanceId = String(obj.instanceId || `${bucket.layer}:${m.base}:${i}`).trim();
      const sx = m.sx;
      const dy = m.dy;
      const targetW = m.targetW;
      const targetH = m.targetH;

      out.push({
        kind: 'object',
        id: m.base,
        instanceId,
        worldX: obj.worldX,
        w: targetW,
        h: targetH,
        y: dy,
        _parallax: bucket.parallax,
        _layer: bucket.layer,
        _drawIndex: i,
        _screenX: sx,
        _screenY: dy,
        _screenW: targetW,
        _screenH: targetH,
        _targetKind: 'object'
      });
    }
  }

  return out;
}

function __buildTargetPoolFromKinds(kinds, caster) {
  const pool = [];
  const relationMap = new Map();
  const wantSelf = kinds.includes('self');
  const wantPlayer = kinds.includes('player');
  const wantParty = kinds.includes('party');
  const wantNpc = kinds.includes('npc');
  const wantMob = kinds.includes('mob');
  const wantObject = kinds.includes('object');
  const wantAlly = kinds.includes('ally');
  const wantEnemy = kinds.includes('enemy');
  const wantNeutral = kinds.includes('neutral');

  if (wantSelf && caster) pool.push(caster);
  if (wantPlayer) pool.push(player);
  if (wantParty) {
    for (const p of party) pool.push(p);
  }
  if (wantNpc) {
    for (const n of npcs) pool.push(n);
  }
  if (wantMob) {
    for (const m of mobs) {
      if (!m) continue;
      if (m === caster) continue;
      pool.push(m);
    }
  }
  if (wantObject) {
    const objs = __getObjectTargetPoolForCurrentArea();
    for (const o of objs) pool.push(o);
  }

  if (wantAlly || wantEnemy || wantNeutral) {
    const added = new Set();
    for (const a of pool) {
      if (!a) continue;
      const k = targetKeyFromDescriptor(targetActorDescriptorFromActor(a));
      if (k) added.add(k);
    }

    const allActors = [player, ...(Array.isArray(party) ? party : []), ...(Array.isArray(npcs) ? npcs : []), ...(Array.isArray(mobs) ? mobs : [])];
    for (const a of allActors) {
      if (!a) continue;
      if (a === caster) continue;
      const relation = getRelation(caster, a);
      if (relation === 'ally' && !wantAlly) continue;
      if (relation === 'enemy' && !wantEnemy) continue;
      if (relation === 'neutral' && !wantNeutral) continue;
      const k = targetKeyFromDescriptor(targetActorDescriptorFromActor(a));
      if (k && added.has(k)) continue;
      relationMap.set(a, relation);
      pool.push(a);
      if (k) added.add(k);
    }
  }

  return { pool, relationMap };
}

function __getTargetCandidates(caster, tdef, opts = {}) {
  if (!caster || !tdef) return [];

  const remove = tdef.remove || Object.create(null);
  const kinds = __getTargetKindsFromDef(tdef, !!opts.priorityOnly);
  if (!kinds.length) return [];

  const built = __buildTargetPoolFromKinds(kinds, caster);
  const pool = built.pool;
  const relationMap = built.relationMap;
  const out = [];
  const rangePx = opts.rangePx;
  const rangeFallbackFn = (typeof opts.rangeFallbackFn === 'function') ? opts.rangeFallbackFn : null;
  const extraFilter = (typeof opts.extraFilter === 'function') ? opts.extraFilter : null;
  const coverList = __getCoverRectsForCurrentArea();

  const casterIsParty = (caster === player) || (party && party.includes(caster));
  const getKind = (a) => {
    if (!a) return '';
    if (a === caster) return 'self';
    if (relationMap && relationMap.has(a)) return relationMap.get(a);
    return targetKindForActor(a);
  };

  for (const a of pool) {
    if (!a) continue;
    if (extraFilter && !extraFilter(a)) continue;

    if (a === caster) {
      const casterKind = targetKindForActor(caster);
      if (tdef?.excluded && tdef.excluded.includes('self')) continue;
      if (!kinds.includes(casterKind) && !kinds.includes('self')) continue;
      out.push(a);
      continue;
    }

    if (tdef?.excluded && tdef.excluded.length) {
      const k = getKind(a);
      if (tdef.excluded.includes(k)) continue;
    }
    if (isTargetCovered(a, coverList)) continue;
    if (!passesTargetingFilters(caster, a, tdef)) continue;
    if (shouldRemoveTarget(caster, a, remove, tdef)) continue;

    const targetIsParty = (a === player) || (party && party.includes(a));
    const ignoreRangeForParty = casterIsParty && targetIsParty &&
      (kinds.includes('player') || kinds.includes('party'));

    if (!ignoreRangeForParty) {
      if (isFinite(rangePx) && rangePx > 0) {
        const dx = Math.abs(actorCenterX(a) - actorCenterX(caster));
        if (dx > rangePx) continue;
      } else if (rangeFallbackFn) {
        const dx = Math.abs(actorCenterX(a) - actorCenterX(caster));
        const r = Number(rangeFallbackFn(a));
        if (isFinite(r) && dx > r) continue;
      }
    }

    out.push(a);
  }

  return sortTargetsByKindPriority(out, tdef, caster, getKind);
}

function __getAbilityTargetCandidates(caster, ability, opts = {}) {
  if (!caster || !ability) return [];
  const tdef = getAbilityTargetingDef(ability);
  if (!tdef) return [];
  const rangePx = getAbilityRangePx(ability, tdef);
  return __getTargetCandidates(caster, tdef, {
    priorityOnly: !!opts.priorityOnly,
    rangePx
  });
}

function __getManualTargetingCandidates(caster, ability) {
  return __getAbilityTargetCandidates(caster, ability);
}

let __manualTargetingHeadBarRestore = null;

function __forceHeadBarsVisibleForTargets(targets) {
  return;
}

function __restoreHeadBarsVisibility() {
  __manualTargetingHeadBarRestore = null;
}

function ensureManualTargetingItemPreview() {
  if (!viewportEl) return null;
  if (manualTargetingItemPreview && manualTargetingItemPreview.parentNode) return manualTargetingItemPreview;

  const el = document.createElement('div');
  el.className = 'manualTargetingItemPreview';
  el.style.position = 'absolute';
  el.style.left = '16px';
  el.style.bottom = '16px';
  el.style.zIndex = '35';
  el.style.pointerEvents = 'none';
  el.style.display = 'none';
  viewportEl.appendChild(el);
  manualTargetingItemPreview = el;
  return el;
}

function showManualTargetingItemPreview(st) {
  const el = ensureManualTargetingItemPreview();
  if (!el) return;
  if (!st || st.kind !== 'item') {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const actor = st.actorName ? findActorByName(st.actorName) : player;
  const bucket = getActorInvBucket(actor || player, st.itemId);
  const inst = bucket?.instances?.find(x => String(x?.uid) === String(st.itemUid || '')) || null;
  const tile = buildItemTile({
    id: st.itemId,
    uid: st.itemUid,
    inst,
    showName: true,
    showUses: true,
    showDesc: true,
    keyText: null,
    showGiveButton: false,
    ownerActor: actor || player
  });

  el.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'playerMenuItemsGrid';
  grid.style.gridTemplateColumns = 'repeat(1, minmax(0, 1fr))';
  // Let content size the card for ability preview (no forced width).
  tile.style.pointerEvents = 'none';
  grid.appendChild(tile);
  el.appendChild(grid);
  el.style.display = 'block';
}

function hideManualTargetingItemPreview() {
  if (!manualTargetingItemPreview) return;
  manualTargetingItemPreview.style.display = 'none';
  manualTargetingItemPreview.innerHTML = '';
}

function showManualTargetingDragTile(itemId, itemUid, actor, sourceTileEl = null) {
  if (!viewportEl) return;
  if (!manualTargetingDragTile) {
    const el = document.createElement('div');
    el.className = 'manualTargetingDragTile';
    el.style.position = 'absolute';
    el.style.zIndex = '40';
    el.style.pointerEvents = 'none';
    viewportEl.appendChild(el);
    manualTargetingDragTile = el;
  }

  const rect = sourceTileEl?.getBoundingClientRect?.();
  const img = document.createElement('img');
  img.alt = String(itemId || '');
  img.src = `assets/items/${lc(itemId)}.png`;
  img.style.display = 'block';
  img.style.imageRendering = 'pixelated';
  img.style.pointerEvents = 'none';

  let w = rect?.width || 48;
  let h = rect?.height || 48;
  const box = sourceTileEl?.querySelector?.('.playerMenuItemImgBox');
  if (box) {
    const b = box.getBoundingClientRect?.();
    if (b && b.width && b.height) { w = b.width; h = b.height; }
  }
  img.style.width = `${Math.max(1, w)}px`;
  img.style.height = `${Math.max(1, h)}px`;

  manualTargetingDragTile.innerHTML = '';
  manualTargetingDragTile.appendChild(img);
}

function hideManualTargetingDragTile() {
  if (!manualTargetingDragTile) return;
  manualTargetingDragTile.innerHTML = '';
  if (manualTargetingDragTile.parentNode) {
    manualTargetingDragTile.parentNode.removeChild(manualTargetingDragTile);
  }
  manualTargetingDragTile = null;
}

function ensureManualTargetingAbilityPreview() {
  if (!viewportEl) return null;
  if (manualTargetingAbilityPreview && manualTargetingAbilityPreview.parentNode) return manualTargetingAbilityPreview;

  const el = document.createElement('div');
  el.className = 'manualTargetingAbilityPreview';
  el.style.position = 'absolute';
  el.style.left = '16px';
  el.style.bottom = '16px';
  el.style.zIndex = '35';
  el.style.pointerEvents = 'none';
  el.style.display = 'none';
  viewportEl.appendChild(el);
  manualTargetingAbilityPreview = el;
  return el;
}

function showManualTargetingAbilityPreview(st) {
  const el = ensureManualTargetingAbilityPreview();
  if (!el) return;
  if (!st || st.kind !== 'ability') {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const caster =
    (lc(st.npcName) === 'player' || lc(st.npcName) === lc(player?.name || '')) ? player
    : party.find(n => n && lc(n.name) === lc(st.npcName));
  if (!caster) return;

  const ability = (Array.isArray(caster.abilities) ? caster.abilities : []).find(a => a && lc(a.id) === lc(st.abilityId));
  if (!ability) return;

  const card = buildAbilityCard(caster, ability, {
    hotKey: null,
    includeToggle: false
  });

  const grid = document.createElement('div');
  grid.className = 'abilitiesCardGrid';
  grid.style.gridTemplateColumns = 'repeat(1, minmax(0, 1fr))';
  grid.style.display = 'inline-grid';
  grid.style.width = 'fit-content';

  card.style.pointerEvents = 'none';
  grid.appendChild(card);

  el.innerHTML = '';
  el.appendChild(grid);
  el.style.display = 'block';
}

function hideManualTargetingAbilityPreview() {
  if (!manualTargetingAbilityPreview) return;
  manualTargetingAbilityPreview.style.display = 'none';
  manualTargetingAbilityPreview.innerHTML = '';
}

function __getTargetBoundsX(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const a of candidates) {
    if (!a) continue;
    const cx = actorCenterX(a);
    if (!isFinite(cx)) continue;
    const half = Math.max(0, Number(a.w) || 0) * 0.5;
    minX = Math.min(minX, cx - half);
    maxX = Math.max(maxX, cx + half);
  }
  if (!isFinite(minX) || !isFinite(maxX)) return null;
  return { minX, maxX };
}

function applyManualTargetingCamera(st) {
  if (!st || !Array.isArray(st.candidates) || st.candidates.length === 0) return;
  if (!currentArea) return;

  const bounds = __getTargetBoundsX(st.candidates);
  if (!bounds) return;

  const span = Math.max(1, bounds.maxX - bounds.minX);
  const pad = Math.max(80, span * 0.08);
  const targetSpan = span + pad * 2;
  const needZoom = WIDTH / targetSpan;

  // Only zoom out if needed; never zoom in here.
  const endZoom = Math.min(cameraZoom, Math.max(0.35, Math.min(1, needZoom)));

  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const vwAtZoom = WIDTH / Math.max(0.0001, endZoom);
  const curLeft = cameraX;
  const curRight = cameraX + cameraViewportW();
  const alreadyFits = (bounds.minX >= curLeft) && (bounds.maxX <= curRight);

  if (alreadyFits && endZoom >= cameraZoom) return;

  // Snapshot current camera so we can restore after targeting
  if (!manualTargetingCameraRestore) {
    manualTargetingCameraRestore = {
      mode: cameraMode,
      targetSpec: cameraTargetSpec ? { ...cameraTargetSpec } : null,
      manualCenterX: cameraManualCenterX,
      zoom: cameraZoom
    };
  }

  const clampedCenter = clampCameraX(centerX - vwAtZoom * 0.5) + vwAtZoom * 0.5;
  if (shouldFreezeWorldTime()) {
    cameraZoom = endZoom;
    cameraMode = 'manual';
    cameraManualCenterX = clampedCenter;
    cameraTargetSpec = { type: 'player' };
    cameraX = clampCameraX(clampedCenter - cameraViewportW() * 0.5);
  } else {
    startCameraTween({
      endMode: 'manual',
      endManualCenterX: clampedCenter,
      endZoom,
      durationMs: 200
    });
  }
}

function restoreManualTargetingCamera() {
  if (!manualTargetingCameraRestore) return;
  const prev = manualTargetingCameraRestore;
  manualTargetingCameraRestore = null;

  const endMode = prev.mode || 'follow';
  const endTargetSpec = prev.targetSpec || { type: 'player' };
  const endManualCenterX = prev.manualCenterX;
  const endZoom = (isFinite(prev.zoom) && prev.zoom > 0) ? prev.zoom : 1;

  if (shouldFreezeWorldTime()) {
    cameraZoom = endZoom;
    cameraMode = endMode;
    cameraTargetSpec = endTargetSpec;
    cameraManualCenterX = (endMode === 'manual') ? endManualCenterX : null;
    const endCenter = (endMode === 'manual')
      ? endManualCenterX
      : getTargetCenterXFromSpec(endTargetSpec);
    if (isFinite(endCenter)) {
      cameraX = clampCameraX(endCenter - cameraViewportW() * 0.5);
    } else {
      cameraX = clampCameraX(cameraX);
    }
  } else {
    startCameraTween({
      endMode,
      endTargetSpec,
      endManualCenterX,
      endZoom,
      durationMs: 200
    });
  }
}

function getItemTargetingDef(itemDef) {
  if (!itemDef || typeof itemDef !== 'object') return null;
  return normalizeTargetingDef(itemDef.targeting || null);
}

function getItemRangePx(itemDef, tdef) {
  const raw =
    (tdef && tdef.withinPx != null && isFinite(tdef.withinPx)) ? tdef.withinPx
    : (tdef && (tdef.rangePx ?? tdef.range) != null) ? (tdef.rangePx ?? tdef.range)
    : (itemDef?.rangePx ?? itemDef?.range);
  const v = Number(raw);
  return (isFinite(v) && v > 0) ? v : null;
}

function __getItemTargetCandidates(caster, itemDef, itemId = null) {
  if (!caster || !itemDef) return [];
  const tdef = getItemTargetingDef(itemDef);
  if (!tdef) return [];
  const rangePx = getItemRangePx(itemDef, tdef);
  const resolvedItemId = lc(itemId || itemDef.id || itemDef._id || '');
  return __getTargetCandidates(caster, tdef, {
    rangePx,
    extraFilter: (a) => {
    const k = targetKindForActor(a);
    if (k !== 'object') return true;
      const objId = String(a.id || a.filename || '').trim();
      return !!(resolvedItemId && objId && canUseItemOnObject(resolvedItemId, objId));
    },
    rangeFallbackFn: (a) => {
      const k = targetKindForActor(a);
      if (k === 'object') return interactionRadius('object', Number(a.w) || 0);
      return interactionRadius('npc', Number(a.w) || 0);
    }
  });
}

function canActorReceiveItem(actor) {
  const cap = getActorInventorySize(actor);
  if (!isFinite(cap)) return true;
  return cap > 0;
}

function hasActorInventorySpace(actor) {
  const cap = getActorInventorySize(actor);
  if (!isFinite(cap)) return true;
  return getActorInventoryCount(actor) < cap;
}

function getItemGiveTargetingDef(itemDef) {
  if (!itemDef || typeof itemDef !== 'object') return null;
  if (itemDef.giveTargeting) return normalizeTargetingDef(itemDef.giveTargeting);
  // Default: party + world NPCs (only those with inventory capacity)
  return normalizeTargetingDef({ priority: ['party'], allowed: ['npc'] });
}

function __getItemGiveTargetCandidates(caster, itemDef) {
  if (!caster || !itemDef) return [];
  const tdefRaw = getItemGiveTargetingDef(itemDef);
  const pri = Array.isArray(tdefRaw?.priority) ? tdefRaw.priority.slice() : [];
  const allowed = Array.isArray(tdefRaw?.allowed) ? tdefRaw.allowed.slice() : [];
  if (!pri.map(lc).includes('player')) pri.push('player');
  if (allowed.length > 0 && !allowed.map(lc).includes('player')) allowed.push('player');
  const tdef = { ...tdefRaw, priority: pri, allowed };
  if (!tdef) return [];
  return __getTargetCandidates(caster, tdef, {
    rangeFallbackFn: (a) => interactionRadius('npc', Number(a.w) || 0),
    extraFilter: (a) => canActorReceiveItem(a) && a !== caster
  });
}

function __forceTargetToFront(actor, targetActor, holdAbilityId = null) {
  if (!actor || !targetActor) return false;
  if (!Array.isArray(actor.attackTargetQueue)) actor.attackTargetQueue = [];

  const td = targetActorDescriptorFromActor(targetActor);
  const key = targetKeyFromDescriptor(td);
  if (!key) return false;

  // Remove existing entry
  for (let i = actor.attackTargetQueue.length - 1; i >= 0; i--) {
    if (targetKeyFromDescriptor(actor.attackTargetQueue[i]) === key) {
      actor.attackTargetQueue.splice(i, 1);
    }
  }

  actor.attackTargetQueue.unshift(td);
  actor.attackTargetCurrentKey = key;
  actor.__attackTargetActor = targetActor;

  if (holdAbilityId) {
    actor.__forcedTargetKey = key;
    actor.__forcedTargetAbilityId = lc(holdAbilityId);
  }

  return true;
}

function resolveAbilityFixedTargets(caster, ability) {
  if (!caster || !ability) return null;
  const ft = lc(ability.fixedTarget || ability?.targeting?.fixedTarget || '');
  if (!ft) return null;

  if (ft === 'self') return [caster];

  if (ft === 'party') {
    const out = [];
    if (player) out.push(player);
    for (const p of party) {
      if (p) out.push(p);
    }
    return out;
  }

  if (ft === 'allmobs' || ft === 'all_mobs') {
    const rangePx = Number(ability.rangePx ?? ability.range ?? 0);
    const out = [];
    for (const m of mobs) {
      if (!m || m === caster) continue;
      if (isFinite(rangePx) && rangePx > 0) {
        const dx = Math.abs(actorCenterX(m) - actorCenterX(caster));
        if (dx > rangePx) continue;
      }
      out.push(m);
    }
    return out;
  }

  return null;
}

function beginManualTargeting(npcName, abilityId) {
  const wantNpc = lc(npcName);
  const wantAb = lc(abilityId);
  if (!wantNpc || !wantAb) return false;

  const caster =
    (wantNpc === 'player' || wantNpc === lc(player?.name || '')) ? player
    : party.find(n => n && lc(n.name) === wantNpc);
  if (!caster) return false;

  const ability = (Array.isArray(caster.abilities) ? caster.abilities : []).find(a => a && lc(a.id) === wantAb);
  if (!ability) return false;

  const fixedTargets = resolveAbilityFixedTargets(caster, ability);
  if (fixedTargets) {
    const ok = (caster === player)
      ? tryCastPlayerAbility(ability.id, null)
      : tryCastPartyAbility(caster.name, ability.id, null);
    return ok ? 'casted' : false;
  }

  const tdefRaw = getActorTargetingRaw(caster);
  const tdef = normalizeTargetingDef(tdefRaw);
  const candidates = __getManualTargetingCandidates(caster, ability);
  if (!candidates.length) {
    // If there's no targeting config, this ability is likely self/area-only: cast immediately.
    if (!tdef) {
      const ok = (caster === player)
        ? tryCastPlayerAbility(ability.id, null)
        : tryCastPartyAbility(caster.name, ability.id, null);
      return ok ? 'casted' : false;
    }
    showPlayerMenuError('No valid targets.');
    return false;
  }

  let selectedIndex = 0;
  const cur = caster.__attackTargetActor || null;
  if (cur) {
    const idx = candidates.indexOf(cur);
    if (idx >= 0) selectedIndex = idx;
  }

  inManualTargeting = true;
  manualTargetingState = {
    kind: 'ability',
    npcName: caster.name,
    abilityId: ability.id,
    candidates,
    selectedIndex,
    returnPageId: activeMenuPageId,
    previewTilePx: (() => {
      const tile = playerMenuContent?.querySelector('.abilityCard');
      const w = tile?.getBoundingClientRect?.().width;
      return (isFinite(w) && w > 0) ? w : 0;
    })()
  };

  __forceHeadBarsVisibleForTargets(candidates);
    // no debug logging

  // Hide menu overlay but keep menu state (so game stays paused)
  if (playerMenuOverlay) playerMenuOverlay.style.display = 'none';
  showManualTargetingAbilityPreview(manualTargetingState);
  applyManualTargetingCamera(manualTargetingState);
  inMenu = true;

  return 'started';
}

function resolveItemFixedTargets(caster, itemDef) {
  if (!caster || !itemDef) return null;
  const ft = lc(itemDef.fixedTarget || itemDef?.targeting?.fixedTarget || '');
  if (!ft) return null;

  if (ft === 'self') return [caster];

  if (ft === 'party') {
    const out = [];
    if (player) out.push(player);
    for (const p of party) {
      if (p) out.push(p);
    }
    return out;
  }

  if (ft === 'allmobs' || ft === 'all_mobs') {
    const out = [];
    const tdef = getItemTargetingDef(itemDef);
    const rangePx = getItemRangePx(itemDef, tdef);
    const casterCx = actorCenterX(caster);
    for (const m of mobs) {
      if (!m || m === caster) continue;
      const dx = Math.abs(actorCenterX(m) - casterCx);
      if (isFinite(rangePx) && rangePx > 0) {
        if (dx > rangePx) continue;
      } else {
        const r = interactionRadius('npc', Number(m.w) || 0);
        if (dx > r) continue;
      }
      out.push(m);
    }
    return out;
  }

  return null;
}

function beginManualItemTargeting(itemId, itemUid = null, preferredTarget = null) {
  const id = lc(itemId);
  if (!id) return false;

  const def = getItemDef(id);
  if (!def) return false;

  const caster = player;
  const fixedTargets = resolveItemFixedTargets(caster, def);
  if (fixedTargets) {
    const ok = useItemOnceOnTargets(id, itemUid, fixedTargets);
    if (ok && inMenu) hideMenuOverlayForHeadBars();
    return ok ? 'casted' : false;
  }

  const candidates = __getItemTargetCandidates(caster, def, id);
  if (!candidates.length) {
    showPlayerMenuError('No valid targets.');
    return false;
  }

  let selectedIndex = 0;
  if (preferredTarget) {
    const idx = candidates.indexOf(preferredTarget);
    if (idx >= 0) selectedIndex = idx;
  }

  inManualTargeting = true;
  manualTargetingState = {
    kind: 'item',
    itemId: id,
    itemUid: itemUid != null ? String(itemUid) : null,
    candidates,
    selectedIndex,
    returnPageId: activeMenuPageId,
    previewTilePx: (() => {
      const tile = playerMenuContent?.querySelector('.playerMenuItemTile');
      const w = tile?.getBoundingClientRect?.().width;
      return (isFinite(w) && w > 0) ? w : 0;
    })()
  };

  __forceHeadBarsVisibleForTargets(candidates);
  // no debug logging

  if (playerMenuOverlay) playerMenuOverlay.style.display = 'none';
  showManualTargetingItemPreview(manualTargetingState);
  applyManualTargetingCamera(manualTargetingState);
  inMenu = true;
  return 'started';
}

function beginManualItemTargetingForActor(actor, itemId, itemUid = null, preferredTarget = null) {
  if (!actor) return false;
  if (actor === player) return beginManualItemTargeting(itemId, itemUid, preferredTarget);

  const id = lc(itemId);
  if (!id) return false;

  const def = getItemDef(id);
  if (!def) return false;

  const caster = actor;
  const fixedTargets = resolveItemFixedTargets(caster, def);
  if (fixedTargets) {
    const ok = useItemOnceOnTargets(id, itemUid, fixedTargets);
    if (ok && inMenu) hideMenuOverlayForHeadBars();
    return ok ? 'casted' : false;
  }

  const candidates = __getItemTargetCandidates(caster, def, id);
  if (!candidates.length) {
    showPlayerMenuError('No valid targets.');
    return false;
  }

  let selectedIndex = 0;
  if (preferredTarget) {
    const idx = candidates.indexOf(preferredTarget);
    if (idx >= 0) selectedIndex = idx;
  }

  inManualTargeting = true;
  manualTargetingState = {
    kind: 'item',
    itemId: id,
    itemUid: itemUid != null ? String(itemUid) : null,
    candidates,
    selectedIndex,
    returnPageId: activeMenuPageId,
    previewTilePx: (() => {
      const tile = playerMenuContent?.querySelector('.playerMenuItemTile');
      const w = tile?.getBoundingClientRect?.().width;
      return (isFinite(w) && w > 0) ? w : 0;
    })(),
    actorName: actor?.name || null
  };

  __forceHeadBarsVisibleForTargets(candidates);
  if (playerMenuOverlay) playerMenuOverlay.style.display = 'none';
  showManualTargetingItemPreview(manualTargetingState);
  applyManualTargetingCamera(manualTargetingState);
  inMenu = true;
  return 'started';
}

function beginManualItemGiveTargeting(itemId, itemUid = null) {
  const id = lc(itemId);
  if (!id) return false;

  const def = getItemDef(id);
  if (!def) return false;

  const caster = player;
  const candidates = __getItemGiveTargetCandidates(caster, def);
  if (!candidates.length) {
    showPlayerMenuError('No valid targets to give to.');
    return false;
  }

  inManualTargeting = true;
  manualTargetingState = {
    kind: 'give',
    itemId: id,
    itemUid: itemUid != null ? String(itemUid) : null,
    candidates,
    selectedIndex: 0,
    returnPageId: activeMenuPageId
  };

  __forceHeadBarsVisibleForTargets(candidates);

  if (playerMenuOverlay) playerMenuOverlay.style.display = 'none';
  inMenu = true;
  return 'started';
}

function beginManualItemGiveTargetingForActor(actor, itemId, itemUid = null) {
  if (!actor) return false;
  if (actor === player) return beginManualItemGiveTargeting(itemId, itemUid);

  const id = lc(itemId);
  if (!id) return false;

  const def = getItemDef(id);
  if (!def) return false;

  const caster = actor;
  const candidates = __getItemGiveTargetCandidates(caster, def);
  if (!candidates.length) {
    showPlayerMenuError('No valid targets to give to.');
    return false;
  }

  inManualTargeting = true;
  manualTargetingState = {
    kind: 'give',
    itemId: id,
    itemUid: itemUid != null ? String(itemUid) : null,
    candidates,
    selectedIndex: 0,
    returnPageId: activeMenuPageId,
    actorName: actor?.name || null
  };

  __forceHeadBarsVisibleForTargets(candidates);
  if (playerMenuOverlay) playerMenuOverlay.style.display = 'none';
  inMenu = true;
  return 'started';
}

function endManualTargeting({ openMenuPageId = null, closeAll = false } = {}) {
  __restoreHeadBarsVisibility();
  inManualTargeting = false;
  manualTargetingState = null;
  hideManualTargetingItemPreview();
  hideManualTargetingAbilityPreview();
  hideManualTargetingDragTile();
  restoreManualTargetingCamera();

  if (closeAll) {
    closePlayerMenu();
    return;
  }

  if (openMenuPageId) {
    openPlayerMenu(openMenuPageId);
  } else {
    // Return to prior menu page (or reopen menu if it was hidden)
    openPlayerMenu(activeMenuPageId);
  }
}

function confirmManualTargetingSelection() {
  if (!inManualTargeting || !manualTargetingState) return false;

  const st = manualTargetingState;
  if (st.kind === 'give') {
    const target = st.candidates[st.selectedIndex] || null;
    if (!target) return false;

    const giver = st.actorName ? findActorByName(st.actorName) : player;

    if (!hasActorInventorySpace(target)) {
      showPartyInventoryOverlay(target, { flashBad: true, autoCloseMs: 450 });
      showPlayerMenuError('Target inventory is full.');
      return false;
    }

    const addedUid = giver && giver !== player
      ? giveItemToTargetFromActor(giver, st.itemId, st.itemUid, target)
      : giveItemToTarget(st.itemId, st.itemUid, target);
    if (!addedUid) return false;

    __restoreHeadBarsVisibility();
    inManualTargeting = false;
    manualTargetingState = null;
    inMenu = false;
    if (playerMenuOverlay) playerMenuOverlay.style.display = 'none';

    const returnPage = st.returnPageId || 'items';
    if (party && party.includes(target)) {
      showPartyInventoryOverlay(target, {
        highlightUid: addedUid,
        autoCloseMs: 2000,
        afterClose: () => openPlayerMenu(returnPage)
      });
    } else {
      openPlayerMenu(returnPage);
    }
    return true;
  }

  if (st.kind === 'item') {
    const target = st.candidates[st.selectedIndex] || null;
    if (!target) return false;

    const def = getItemDef(st.itemId);
    const effects = def?.effects || null;
    if (!wouldEffectsChangeAnything(effects, target)) {
      const badNow = Date.now();
      st.flashBadAtMs = badNow;
      st.flashBadPulseMs = 55;
      st.flashBadUntilMs = badNow + 650;
      st.errorMsg = 'No effect on target';
      st.errorUntilMs = badNow + 1200;
      // no debug logging
      showPlayerMenuError(__lastItemUseError || 'No effect on that target.');
      // Menu is hidden during targeting; show a small toast so the error is visible.
      showItemFoundToast(__lastItemUseError || 'No effect on that target.');
      return false;
    }

    const actor = st.actorName ? findActorByName(st.actorName) : player;
    const ok = (actor && actor !== player)
      ? useActorItemOnce(actor, st.itemId, st.itemUid, target)
      : useItemOnce(st.itemId, st.itemUid, target);
    if (ok) {
      const canUseAgain = (actor && actor !== player)
        ? canUseActorItem(actor, st.itemId, st.itemUid)
        : canUseItem(st.itemId, st.itemUid);
      if (canUseAgain) {
        const res = beginManualItemTargetingForActor(actor || player, st.itemId, st.itemUid, target);
        if (res) return true;
      }
      endManualTargeting({ openMenuPageId: st.returnPageId || activeMenuPageId });
      hideMenuOverlayForHeadBars();
    }
    return !!ok;
  }

  const caster =
    (lc(st.npcName) === 'player' || lc(st.npcName) === lc(player?.name || '')) ? player
    : party.find(n => n && lc(n.name) === lc(st.npcName));
  if (!caster) return false;

  const ability = (Array.isArray(caster.abilities) ? caster.abilities : []).find(a => a && lc(a.id) === lc(st.abilityId));
  if (!ability) return false;

  const target = st.candidates[st.selectedIndex] || null;
  if (!target) return false;

  // Always push the chosen target to the front for immediate use
  __forceTargetToFront(caster, target, (lc(caster.autoCastAbilityId || '') === lc(ability.id)) ? ability.id : null);

  // Cast immediately if not on cooldown
  const now = getGameNowMs();
  const nextAt = Number(caster.abilityNextAtMs?.[lc(ability.id)] || 0);
  if (nextAt <= now) {
    if (caster === player) {
      tryCastPlayerAbility(ability.id, target);
    } else {
      tryCastPartyAbility(caster.name, ability.id, target);
    }
  }

  endManualTargeting({ closeAll: true });
  return true;
}

function updateManualTargetingHover() {
  if (!inManualTargeting || !manualTargetingState || !manualTargetingMouse.has) return;
  const st = manualTargetingState;
  const mx = __screenToRenderX(manualTargetingMouse.x);
  const my = __screenToRenderY(manualTargetingMouse.y);

  let bestIdx = -1;
  let bestD = Infinity;

  for (let i = 0; i < st.candidates.length; i++) {
    const a = st.candidates[i];
    const pos = __actorRenderCenter(a);
    if (!pos) continue;

    const r = Math.max(36, Math.min(120, (Number(a.w) || 0) * 0.6));
    const dx = mx - pos.x;
    const dy = my - pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= r && d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    st.selectedIndex = bestIdx;
  }
  st.hoverIndex = bestIdx;
}


function renderMenuPage_Items() {
  ensurePlayerInventory();

  const wrap = document.createElement('div');
  wrap.className = 'playerMenuItemsGrid';

  const inv = player.inventory || {};

  // Expand inventory into per-instance cards.
  const cards = [];
  for (const [id, bucket] of Object.entries(inv)) {
    const b = getInvBucket(id);
    const insts = b?.instances;
    if (!Array.isArray(insts) || insts.length === 0) continue;
    for (const inst of insts) {
      cards.push({ id: lc(id), uid: String(inst?.uid ?? ''), inst });
    }
  }

  cards.sort((a, b) => {
    const da = getItemDef(a.id) || {};
    const db = getItemDef(b.id) || {};
    const na = lc(da.name || a.id);
    const nb = lc(db.name || b.id);
    if (na < nb) return -1;
    if (na > nb) return 1;
    // Stable-ish ordering within same item
    return String(a.uid) < String(b.uid) ? -1 : (String(a.uid) > String(b.uid) ? 1 : 0);
  });

  // index 0..8 => { id, uid }
  itemsMenuHotkeys = cards.slice(0, 9).map((c) => ({ id: c.id, uid: c.uid }));

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playerMenuMuted';
    empty.textContent = 'No items.';
    wrap.appendChild(empty);
    return wrap;
  }

  for (let idx = 0; idx < cards.length; idx++) {
    const c = cards[idx];
    const tile = buildItemTile({
      id: c.id,
      uid: c.uid,
      inst: c.inst,
      showName: true,
      showUses: true,
      showDesc: true,
      keyText: (idx < 9 ? String(idx + 1) : null),
      onClick: (id, uid, tileEl) => {
        if (canUseItem(id, uid)) {
          tryUseItemWithFeedback(id, uid, tileEl);
        }
      },
      onHoldStart: (id, uid, tileEl, e) => {
        const res = beginManualItemGiveTargeting(id, uid);
        if (res === 'started') {
          showManualTargetingDragTile(id, uid, player, tileEl);
          const vrect = viewportEl?.getBoundingClientRect?.();
          if (manualTargetingDragTile && vrect && e) {
            manualTargetingDragTile.style.left = `${e.clientX - vrect.left + 8}px`;
            manualTargetingDragTile.style.top = `${e.clientY - vrect.top + 8}px`;
          }
        }
      },
      showGiveButton: true,
      onGive: (id, uid) => beginManualItemGiveTargeting(id, uid)
    });
    wrap.appendChild(tile);
  }

  return wrap;
}


// Register default pages (modular: add new ones by adding a new registerMenuPage call)
registerMenuPage('party', 'Party', 'P', renderMenuPage_PartyCards);
registerMenuPage('items', 'Items', 'I', renderMenuPage_Items);
registerMenuPage('abilities', 'Abilities', 'A', renderMenuPage_Abilities);
registerMenuPage('npcs', 'Characters', 'C', renderMenuPage_NPCs_Cards);
registerMenuPage('journal', 'Journal', 'J', renderMenuPage_Journal);
renderMenuTabs(menuTopTabs, true, true);

// Click outside frame closes
if (playerMenuOverlay) {
  playerMenuOverlay.addEventListener('click', (e) => {
    if (!inMenu) return;
    const t = e.target;
    if (menuTopTabs && menuTopTabs.contains(t)) return;
    if (t && t.closest && t.closest('#menuTopTabs')) return;
    if (t && t.closest && t.closest('.playerMenuTabBtn')) return;
    if (playerMenuContent && playerMenuContent.contains(t)) return;
    closePlayerMenu();
  });
}

// Tabs live outside the overlay; stop them from triggering overlay close
if (menuTopTabs) {
  menuTopTabs.addEventListener('click', (e) => e.stopPropagation());
  menuTopTabs.addEventListener('mousedown', (e) => e.stopPropagation());
}

// Conversation click handling
if (conversationOverlay) {
  conversationOverlay.addEventListener('click', (e) => {
    if (!inConversation) return;
    const t = e.target;
    if (optionsBox && optionsBox.contains(t)) {
      const optEl = t && t.closest ? t.closest('[data-option-index]') : null;
      if (optEl && optEl.dataset && optEl.dataset.optionIndex) {
        const idx = parseInt(optEl.dataset.optionIndex, 10);
        if (Number.isFinite(idx)) selectDialogOptionByIndex(idx);
      }
      return;
    }

    if (dialogOptionsMap && Object.keys(dialogOptionsMap).length > 0) {
      return;
    }

    if (isTypingDialog) {
      cancelDialogTyping = true;
      return;
    }

    const evt = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(evt);
  });
}

if (optionsBox) {
  optionsBox.addEventListener('mousedown', (e) => {
    if (!inConversation) return;
    const optEl = e.target && e.target.closest ? e.target.closest('[data-option-index]') : null;
    if (!optEl || !optEl.dataset) return;
    if (optEl.dataset.optionKey) {
      selectDialogOptionByKey(optEl.dataset.optionKey);
    } else if (optEl.dataset.optionIndex) {
      const idx = parseInt(optEl.dataset.optionIndex, 10);
      if (Number.isFinite(idx)) selectDialogOptionByIndex(idx);
    }
    e.stopPropagation();
  });
  optionsBox.addEventListener('click', (e) => {
    if (!inConversation) return;
    const optEl = e.target && e.target.closest ? e.target.closest('[data-option-index]') : null;
    if (!optEl || !optEl.dataset) return;
    if (optEl.dataset.optionKey) {
      selectDialogOptionByKey(optEl.dataset.optionKey);
    } else if (optEl.dataset.optionIndex) {
      const idx = parseInt(optEl.dataset.optionIndex, 10);
      if (Number.isFinite(idx)) selectDialogOptionByIndex(idx);
    }
  });
}

// Dialog typing speed (characters per second)
let dialogCharsPerSecond = 50;

// ===== Time-of-day visuals (sky tint + layered darkening) =====
const TIME_VISUAL_CFG = {
  // Sky tint overlay applied AFTER the sky is drawn (image/gradient), BEFORE background layers.
  // Uses simple phase keyframes: morning/night->day, evening/day->night.
  sky: {
    day:   { color: '#000000', alpha: 0.00 },
    night: { color: '#0b1026', alpha: 0.45 }
  },

  // Max darkening alpha per group (A darkest, C lightest)
  darken: {
    A: 0.55, // sky + distant backgrounds + background layers (+ background objects behind ground)
    B: 0.32, // ground + groundBack/Fore objects + actors
    C: 0.18  // true foreground objects
  }
};

function __clamp01(v) {
  v = Number(v);
  if (!isFinite(v)) return 0;
  return (v < 0) ? 0 : (v > 1) ? 1 : v;
}

function __lerp(a, b, t) {
  return a + (b - a) * t;
}

function __hexToRgb(hex) {
  const s = String(hex || '').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function __lerpHex(c1, c2, t) {
  const a = __hexToRgb(c1);
  const b = __hexToRgb(c2);
  const r = Math.round(__lerp(a.r, b.r, t));
  const g = Math.round(__lerp(a.g, b.g, t));
  const b2 = Math.round(__lerp(a.b, b.b, t));
  return `rgb(${r},${g},${b2})`;
}

function getEffectiveTimeOfDayVisualCfg() {
  // Defaults
  const out = {
    disableAll: false,
    disableDarkening: false,
    fixedPhase: null, // 'morning'|'day'|'evening'|'night'
    mult: { A: 1, B: 1, C: 1 }
  };

  // Area-level config
  const areaCfg = currentArea?.timeOfDay || currentArea?.raw?.timeOfDay || null;

  // Section-level config (overrides area)
  let secCfg = null;
  if (currentArea && player && typeof player.worldX === 'number' && currentArea.sectionTileWidth) {
    const idx = Math.floor(player.worldX / currentArea.sectionTileWidth);
    const sec = Array.isArray(currentArea.sections) ? currentArea.sections[idx] : null;
    secCfg = sec?.timeOfDay || null;
  }

  function applyCfg(cfg) {
    if (!cfg) return;

    if (cfg.disableAll === true) out.disableAll = true;
    if (cfg.disableDarkening === true) out.disableDarkening = true;

    if (cfg.fixedPhase != null && String(cfg.fixedPhase).trim() !== '') {
      out.fixedPhase = String(cfg.fixedPhase).trim();
    }

    const m = cfg.multipliers || cfg.mult || null;
    if (m) {
      if (m.A != null && m.A !== '') out.mult.A = Number(m.A);
      if (m.B != null && m.B !== '') out.mult.B = Number(m.B);
      if (m.C != null && m.C !== '') out.mult.C = Number(m.C);
    }
  }

  applyCfg(areaCfg);
  applyCfg(secCfg);

  // Sanitize multipliers
  for (const k of ['A','B','C']) {
    const v = Number(out.mult[k]);
    out.mult[k] = (isFinite(v) && v >= 0) ? v : 1;
  }

  out.fixedPhase = out.fixedPhase ? lc(out.fixedPhase) : null;
  return out;
}

function __getTimeInfoForVisuals() {
  const cfg = getEffectiveTimeOfDayVisualCfg();
  if (cfg.fixedPhase) {
    // Keep transitions stable if forced to morning/evening
    const phase = cfg.fixedPhase;
    const phaseT = (phase === 'morning' || phase === 'evening') ? 0.5 : (phase === 'night' ? 1 : 0);
    const base = getWorldTimeInfo(WORLD_TIME_MIN);
    return { ...base, phase, phaseT };
  }
  return getWorldTimeInfo(WORLD_TIME_MIN);
}


// 0 (day) -> 1 (night), with smooth fades during evening/morning
function getTimeDarknessFactor() {
  const info = __getTimeInfoForVisuals();

  const phase = lc(info.phase);
  const t = __clamp01(info.phaseT);

  if (phase === 'day') return 0;
  if (phase === 'night') return 1;
  if (phase === 'evening') return t;       // fade in
  if (phase === 'morning') return 1 - t;   // fade out
  return 0;
}

function drawSkyTimeOverlay() {
  const cfg = getEffectiveTimeOfDayVisualCfg();
  if (cfg.disableAll) return;

  const info = __getTimeInfoForVisuals();

  const phase = lc(info.phase);
  const t = __clamp01(info.phaseT);

  const day = TIME_VISUAL_CFG.sky.day;
  const night = TIME_VISUAL_CFG.sky.night;

  let color = day.color;
  let alpha = day.alpha;

  if (phase === 'night') {
    color = night.color;
    alpha = night.alpha;
  } else if (phase === 'morning') {
    color = __lerpHex(night.color, day.color, t);
    alpha = __lerp(Number(night.alpha) || 0, Number(day.alpha) || 0, t);
  } else if (phase === 'evening') {
    color = __lerpHex(day.color, night.color, t);
    alpha = __lerp(Number(day.alpha) || 0, Number(night.alpha) || 0, t);
  } else {
    color = day.color;
    alpha = day.alpha;
  }

  alpha = __clamp01(alpha);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.restore();
}

// ===== Map rendering =====
function isVisitedSection(areaName, sectionName) {
  if (!areaName || !sectionName) return false;
  return !!getFlag('global', `visited:${areaName}:${sectionName}`);
}

function isVisitedSectionIndex(areaName, sectionIndex) {
  if (!areaName && areaName !== '') return false;
  const idx = Number(sectionIndex);
  if (!isFinite(idx) || idx < 0) return false;
  const byIndex = getFlag('global', `visitedIdx:${areaName}:${idx}`);
  if (byIndex) return true;
  const sections = getAreaSectionsByName(areaName);
  const name = sections && sections[idx] ? sections[idx].name : null;
  if (name) return isVisitedSection(areaName, name);
  return false;
}

function getSectionKeyForIndex(areaName, sectionIndex) {
  const idx = Number(sectionIndex);
  if (!areaName || !isFinite(idx) || idx < 0) return null;
  const sections = getAreaSectionsByName(areaName);
  const name = sections && sections[idx] ? sections[idx].name : null;
  return name ? String(name) : `idx:${idx}`;
}

function getAreaDisplayName(areaName) {
  const def = areasData && areasData[areaName];
  return String(def?.name || areaName || '').trim();
}

function getAreaSectionsByName(areaName) {
  const area = buildAreaFromDefinition(areaName);
  if (!area || !Array.isArray(area.sections)) return null;
  return area.sections;
}

function getSectionIndexForWorldX(areaName, worldX) {
  const area = buildAreaFromDefinition(areaName);
  if (!area || !area.sectionTileWidth || !Array.isArray(area.sections)) return -1;
  const idx = Math.floor(Number(worldX || 0) / area.sectionTileWidth);
  if (!isFinite(idx) || idx < 0 || idx >= area.sections.length) return -1;
  return idx;
}

function getAreaPortals(areaName, opts = null) {
  const area = buildAreaFromDefinition(areaName);
  if (!area) return [];

  const includeDespawned = !!(opts && opts.includeDespawned);
  const out = [];
  const buckets = [
    { list: area.backObjects, layer: 'back' },
    { list: area.foreObjects, layer: 'fore' },
    { list: area.groundBackObjects, layer: 'gback' },
    { list: area.groundForeObjects, layer: 'gfore' }
  ];

  for (const bucket of buckets) {
    const list = bucket.list;
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      if (!includeDespawned && o._spawned === false) continue;
      if (!o.portal) continue;

      const instId = _objectInstanceIdForBucket(o, bucket.layer, objectBaseFromKey(o.key || o.name || o.filename), i);
      const instanceKey = `object:${instId}`;
      const worldX = Number(o.worldX || 0);
      const secIndex = (typeof o.sectionIndex === 'number')
        ? o.sectionIndex
        : getSectionIndexForWorldX(areaName, worldX);

      if (secIndex < 0) continue;

      out.push({
        areaName,
        sectionIndex: secIndex,
        worldX,
        objectId: (o.objectId != null && o.objectId !== '') ? String(o.objectId) : ((o.id != null && o.id !== '') ? String(o.id) : null),
        instanceKey,
        portalDef: o.portal,
        isSpawned: (o._spawned !== false)
      });
    }
  }

  return out;
}

function getAreaSectionTileWidth(areaName) {
  const area = buildAreaFromDefinition(areaName);
  const w = Number(area?.sectionTileWidth || 0);
  return (isFinite(w) && w > 0) ? w : 0;
}

function getExitPosLocal(areaName, sectionName, exitId) {
  if (!areasData || !areaName || !sectionName || !exitId) return null;
  const def = areasData[areaName];
  if (!def || !def.sections || !def.sections[sectionName]) return null;
  const exits = normalizeExits(def.sections[sectionName].exits);
  const ex = exits.find(e => String(e.id) === String(exitId));
  if (!ex) return null;
  return Number(ex.posLocal || 0);
}

function mapLocalXToRect(localX, tileW, rectX, rectW) {
  const w = Math.max(1, Number(tileW) || 1);
  const t = Math.max(0, Math.min(1, Number(localX) / w));
  return rectX + Math.round(t * rectW);
}

function drawMapArrow(ctx, x1, y1, x2, y2, color = '#d44') {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!isFinite(len) || len < 1) return;

  const ux = dx / len;
  const uy = dy / len;
  const headLen = Math.min(10, Math.max(5, len * 0.25));
  const headW = headLen * 0.6;

  const hx = x2 - ux * headLen;
  const hy = y2 - uy * headLen;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(hx + (-uy * headW), hy + (ux * headW));
  ctx.lineTo(hx + (uy * headW), hy + (-ux * headW));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMapArrowCurved(ctx, x1, y1, x2, y2, color = '#d44', offset = 0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!isFinite(len) || len < 1) return;

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const mx = (x1 + x2) * 0.5 + (px * offset);
  const my = (y1 + y2) * 0.5 + (py * offset);

  const tx = x2 - mx;
  const ty = y2 - my;
  const tLen = Math.hypot(tx, ty);
  const tux = (tLen > 0) ? (tx / tLen) : ux;
  const tuy = (tLen > 0) ? (ty / tLen) : uy;

  const headLen = Math.min(10, Math.max(5, len * 0.25));
  const headW = headLen * 0.6;

  const hx = x2 - tux * headLen;
  const hy = y2 - tuy * headLen;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(hx + (-tuy * headW), hy + (tux * headW));
  ctx.lineTo(hx + (tuy * headW), hy + (-tux * headW));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function _pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (!isFinite(len2) || len2 <= 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function _segmentDistance(a, b) {
  const d1 = _pointSegmentDistance(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2);
  const d2 = _pointSegmentDistance(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
  const d3 = _pointSegmentDistance(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2);
  const d4 = _pointSegmentDistance(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2);
  return Math.min(d1, d2, d3, d4);
}

function _segmentsOverlapAlong(a, b, pad = 0) {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy);
  if (!isFinite(len) || len <= 0) return false;
  const ux = dx / len;
  const uy = dy / len;
  const projA0 = 0;
  const projA1 = len;
  const projB0 = ((b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy);
  const projB1 = ((b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy);
  const minB = Math.min(projB0, projB1);
  const maxB = Math.max(projB0, projB1);
  return (maxB >= (projA0 - pad)) && (minB <= (projA1 + pad));
}

function drawMapArrowsNonOverlapping(ctx, arrows, opts = {}) {
  if (!ctx || !Array.isArray(arrows) || arrows.length === 0) return;

  const parallelDeg = Number(opts.parallelAngleDeg ?? 8);
  const parallelCos = Math.cos((parallelDeg * Math.PI) / 180);
  const distanceThreshold = Number(opts.distanceThreshold ?? 8);
  const overlapPad = Number(opts.overlapPad ?? 6);
  const offsetStep = Number(opts.offsetStep ?? 40);
  const portalDots = Array.isArray(opts.portalDots) ? opts.portalDots : [];

  const n = arrows.length;
  const conflicts = Array.from({ length: n }, () => new Set());
  const needsOffset = Array(n).fill(false);

  if (portalDots.length) {
    for (let i = 0; i < n; i++) {
      const a = arrows[i];
      for (const d of portalDots) {
        if (!d) continue;
        if (!isFinite(d.x) || !isFinite(d.y) || !isFinite(d.r)) continue;
        // Ignore if the dot is near the arrow endpoints (same portal)
        if (Math.hypot(d.x - a.x1, d.y - a.y1) <= d.r * 1.4) continue;
        if (Math.hypot(d.x - a.x2, d.y - a.y2) <= d.r * 1.4) continue;
        const dist = _pointSegmentDistance(d.x, d.y, a.x1, a.y1, a.x2, a.y2);
        if (dist <= d.r) {
          needsOffset[i] = true;
          break;
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const a = arrows[i];
    const dx1 = a.x2 - a.x1;
    const dy1 = a.y2 - a.y1;
    const len1 = Math.hypot(dx1, dy1);
    if (!isFinite(len1) || len1 <= 0) continue;
    const ux1 = dx1 / len1;
    const uy1 = dy1 / len1;

    for (let j = i + 1; j < n; j++) {
      const b = arrows[j];
      const dx2 = b.x2 - b.x1;
      const dy2 = b.y2 - b.y1;
      const len2 = Math.hypot(dx2, dy2);
      if (!isFinite(len2) || len2 <= 0) continue;
      const ux2 = dx2 / len2;
      const uy2 = dy2 / len2;

      const dot = (ux1 * ux2 + uy1 * uy2);
      if (Math.abs(dot) < parallelCos) continue;
      if (!_segmentsOverlapAlong(a, b, overlapPad)) continue;

      const dist = _segmentDistance(a, b);
      if (dist <= distanceThreshold) {
        conflicts[i].add(j);
        conflicts[j].add(i);
      }
    }
  }

  const offsets = Array(n).fill(0);
  const candidates = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
  const nonZeroCandidates = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5];

  for (let i = 0; i < n; i++) {
    if (!conflicts[i].size && !needsOffset[i]) continue;
    const used = new Set();
    for (const j of conflicts[i]) {
      if (offsets[j] != null) used.add(offsets[j]);
    }
    let picked = 0;
    const pool = needsOffset[i] ? nonZeroCandidates : candidates;
    for (const c of pool) {
      if (!used.has(c)) {
        picked = c;
        break;
      }
    }
    offsets[i] = picked;
  }

  for (let i = 0; i < n; i++) {
    const a = arrows[i];
    const offset = offsets[i] * offsetStep;
    drawMapArrowCurved(ctx, a.x1, a.y1, a.x2, a.y2, a.color || '#d44', offset);
  }
}

function buildAreaLabelPositions(nodes) {
  const byArea = new Map();
  for (const n of nodes.values()) {
    if (!byArea.has(n.area)) {
      byArea.set(n.area, { minX: n.x, minY: n.y });
    } else {
      const rec = byArea.get(n.area);
      rec.minX = Math.min(rec.minX, n.x);
      rec.minY = Math.min(rec.minY, n.y);
    }
  }

  const labels = [];
  const labelH = 28;
  for (const [area, rec] of byArea.entries()) {
    labels.push({
      area,
      label: getAreaDisplayName(area),
      x: rec.minX,
      y: Math.max(2, rec.minY - labelH)
    });
  }
  return labels;
}

function renderMapCommon(ctx, nodes, opts = {}) {
  if (!ctx || !nodes || nodes.size === 0) return;
  const currentKey = opts.currentKey || null;
  const showAll = !!opts.showAll;

  // Left/right area links (edge connectors)
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  for (const areaName of new Set(Array.from(nodes.values()).map(n => n.area))) {
    const raw = areasData && areasData[areaName] ? areasData[areaName] : null;
    if (!raw) continue;
    const sections = getAreaSectionsByName(areaName);
    if (!sections || sections.length === 0) continue;

    if (raw.leftarea) {
      const leftSections = getAreaSectionsByName(raw.leftarea);
      if (leftSections && leftSections.length > 0) {
        const aNode = nodes.get(`${areaName}::0`);
        const bNode = nodes.get(`${raw.leftarea}::${leftSections.length - 1}`);
        if (aNode && bNode) {
          ctx.beginPath();
          ctx.moveTo(aNode.x + aNode.w / 2, aNode.y + aNode.h / 2);
          ctx.lineTo(bNode.x + bNode.w / 2, bNode.y + bNode.h / 2);
          ctx.stroke();
        }
      }
    }
    if (raw.rightarea) {
      const rightSections = getAreaSectionsByName(raw.rightarea);
      if (rightSections && rightSections.length > 0) {
        const aNode = nodes.get(`${areaName}::${sections.length - 1}`);
        const bNode = nodes.get(`${raw.rightarea}::0`);
        if (aNode && bNode) {
          ctx.beginPath();
          ctx.moveTo(aNode.x + aNode.w / 2, aNode.y + aNode.h / 2);
          ctx.lineTo(bNode.x + bNode.w / 2, bNode.y + bNode.h / 2);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();

  // Nodes
  for (const n of nodes.values()) {
    const isCurrent = (currentKey && `${n.area}::${n.idx}` === currentKey);
    ctx.fillStyle = isCurrent ? '#ffd27d' : '#e6e6e6';
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    ctx.rect(n.x, n.y, n.w, n.h);
    ctx.fill();
    ctx.stroke();
  }

  const portalsByArea = new Map();
  const getPortalsForArea = (areaName) => {
    if (portalsByArea.has(areaName)) return portalsByArea.get(areaName);
    const list = getAreaPortals(areaName, { includeDespawned: true });
    portalsByArea.set(areaName, list);
    return list;
  };

  // Portals (red dots + optional arrows)
  const portalArrows = [];
  const portalDots = [];
  for (const n of nodes.values()) {
    const portals = getPortalsForArea(n.area).filter(p => p.sectionIndex === n.idx);
    if (!portals.length) continue;
    const tileW = getAreaSectionTileWidth(n.area) || 1;

    for (const p of portals) {
      const localX = p.worldX - (p.sectionIndex * tileW);
      const rx = n.x + Math.max(2, Math.min(n.w - 2, Math.round((localX / tileW) * n.w)));
      const ry = n.y + Math.round(n.h * 0.5);

      const portalAlpha = (p.isSpawned === false) ? 0.3 : 1;
      ctx.save();
      ctx.globalAlpha = portalAlpha;
      ctx.fillStyle = '#d44';
      ctx.beginPath();
      ctx.arc(rx, ry, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      portalDots.push({ x: rx, y: ry, r: 6 });

      const sectionKey = getSectionKeyForIndex(n.area, p.sectionIndex);
      const portalObjectId = p.objectId || p.instanceId || p.typeId || null;
      const usedKey = (sectionKey && portalObjectId)
        ? `portalUsed:${n.area}:${sectionKey}:${portalObjectId}`
        : null;
      if (showAll || (usedKey && getFlag('global', usedKey))) {
        const dest = resolvePortalTarget(p.portalDef?.target);
        if (dest && dest.areaName) {
          const tIdx = getSectionIndexForWorldX(dest.areaName, dest.worldX);
          const tKey = `${dest.areaName}::${tIdx}`;
          const tNode = nodes.get(tKey);
          if (tNode) {
            const tTileW = getAreaSectionTileWidth(dest.areaName) || 1;
            const localX = dest.worldX - (tIdx * tTileW);
            const tx = mapLocalXToRect(localX, tTileW, tNode.x, tNode.w);
            const ty = tNode.y + Math.round(tNode.h * 0.5);
            const arrowColor = (portalAlpha < 1) ? 'rgba(212, 68, 68, 0.3)' : '#d44';
            portalArrows.push({ x1: rx, y1: ry, x2: tx, y2: ty, color: arrowColor });
          }
        }
      }
    }
  }
  if (portalArrows.length) {
    drawMapArrowsNonOverlapping(ctx, portalArrows, { portalDots });
  }

  // Exits (unused = stub, used + target displayed = connector)
  for (const n of nodes.values()) {
    const area = buildAreaFromDefinition(n.area);
    if (!area || !Array.isArray(area.sections)) continue;
    const sec = area.sections[n.idx];
    if (!sec) continue;
    const exits = Array.isArray(sec.exits) ? sec.exits : [];
    if (!exits.length) continue;

    const tileW = getAreaSectionTileWidth(n.area) || 1;
    for (const ex of exits) {
      const dir = lc(ex?.direction || '');
      if (dir !== 'up' && dir !== 'down') continue;
      const exitId = String(ex.id || '');
      if (!exitId) continue;

      const used = showAll ? true : !!getFlag('global', `exitUsed:${n.area}:${n.idx}:${exitId}`);
      const srcX = mapLocalXToRect(ex.posLocal || 0, tileW, n.x, n.w);
      const srcY = (dir === 'up') ? n.y : (n.y + n.h);

      if (used) {
        const target = parseTargetExitString(ex.target);
        if (target && target.area && target.section) {
          const tIdx = __getSectionIndexByName(target.area, target.section);
          const tKey = `${target.area}::${tIdx}`;
          const tNode = nodes.get(tKey);
          if (tNode) {
            const tPosLocal = target.exitId
              ? getExitPosLocal(target.area, target.section, target.exitId)
              : null;
            const tTileW = getAreaSectionTileWidth(target.area) || 1;
            const tgtX = (tPosLocal != null)
              ? mapLocalXToRect(tPosLocal, tTileW, tNode.x, tNode.w)
              : (tNode.x + Math.round(tNode.w / 2));
            const tgtY = (dir === 'up') ? (tNode.y + tNode.h) : tNode.y;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(srcX, srcY);
            ctx.lineTo(tgtX, tgtY);
            ctx.stroke();
            ctx.restore();
            continue;
          }
        }
      }

      if (!used) {
        const stub = Math.max(4, Math.round(n.h * 0.35));
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(srcX, srcY);
        ctx.lineTo(srcX, srcY + (dir === 'up' ? -stub : stub));
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Safeplaces (orange upward triangles)
  for (const n of nodes.values()) {
    const area = buildAreaFromDefinition(n.area);
    if (!area || !Array.isArray(area.sections)) continue;
    const sec = area.sections[n.idx];
    if (!sec) continue;
    if (!showAll && !isVisitedSectionIndex(n.area, n.idx)) continue;

    const safePlaces = Array.isArray(sec.safePlaces) ? sec.safePlaces : [];
    if (!safePlaces.length) continue;

    const tileW = getAreaSectionTileWidth(n.area) || 1;
    for (const sp of safePlaces) {
      const sx = mapLocalXToRect(sp.posLocal || 0, tileW, n.x, n.w);
      const centerY = n.y + Math.round(n.h * 0.5);
      const size = Math.max(8, Math.round(Math.min(n.w, n.h) * 0.36));
      const baseY = centerY + size;

      ctx.save();
      ctx.fillStyle = '#e8892a';
      ctx.beginPath();
      ctx.moveTo(sx, baseY - (size * 2));
      ctx.lineTo(sx - size, baseY);
      ctx.lineTo(sx + size, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // NPC last-known positions (icons)
  for (const [name, rec] of Object.entries(npcRegistry || {})) {
    if (!showAll && !(rec?.met || rec?.hasBeenInParty)) continue;
    const inPartyNow = Array.isArray(party) && party.some(p => lc(p?.name || '') === lc(name));
    const partyActor = inPartyNow
      ? party.find(p => lc(p?.name || '') === lc(name))
      : null;

    const areaName = inPartyNow ? currentAreaName : (rec?.lastSeenArea ?? rec?.area ?? null);
    const worldX = inPartyNow ? (partyActor?.worldX ?? null) : (rec?.lastSeenWorldX ?? rec?.worldX ?? null);
    if (!areaName || !isFinite(worldX)) continue;
    const secIdx = getSectionIndexForWorldX(areaName, worldX);
    const key = `${areaName}::${secIdx}`;
    const node = nodes.get(key);
    if (!node) continue;

    const icon = getPromptIconEntry(name);
    if (!icon || !icon.ready || icon.failed || !icon.img) continue;
    const size = Math.max(8, Math.min(16, Math.min(node.w, node.h)));
    const x = Math.round(node.x + (node.w - size) / 2);
    const y = Math.round(node.y + 2);
    ctx.drawImage(icon.img, x, y, size, size);
  }

  // Area labels
  if (opts.areaLabels && opts.areaLabels.length) {
    ctx.save();
    ctx.font = uiFont(16, 'bold');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const l of opts.areaLabels) {
      ctx.fillText(l.label, l.x, l.y);
    }
    ctx.restore();
  }
}

function getVisitedSectionIndices(areaName) {
  const sections = getAreaSectionsByName(areaName);
  if (!sections) return [];
  const out = [];
  for (let i = 0; i < sections.length; i++) {
    if (isVisitedSectionIndex(areaName, i)) out.push(i);
  }
  return out;
}

function getSectionRectSize(areaName, baseH) {
  const area = buildAreaFromDefinition(areaName);
  const tileW = Number(area?.sectionTileWidth || 128);
  const aspect = tileW / WORLD_HEIGHT;
  const h = Math.max(6, Math.round(baseH));
  const w = Math.max(4, Math.round(h * aspect));
  return { w, h };
}

function buildNodesFromLayout(layout, opts = {}) {
  if (!layout) return { nodes: new Map(), bounds: null };
  const { areas, node, labelH, pad } = layout;
  const GAP = node.gap;
  const showAll = !!opts.showAll;
  const offsetX = Number(opts.offsetX || 0);
  const offsetY = Number(opts.offsetY || 0);
  const panX = Number(opts.panX || 0);
  const panY = Number(opts.panY || 0);

  const nodes = new Map();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const a of areas) {
    for (let i = 0; i < a.sections.length; i++) {
      if (!showAll && !a.visited.has(i)) continue;
      const x = offsetX + panX + a.originX + (i * (a.nodeW + GAP));
      const y = offsetY + panY + a.originY + labelH + pad;
      const key = `${a.name}::${i}`;
      nodes.set(key, { area: a.name, idx: i, x, y, w: a.nodeW, h: a.nodeH });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + a.nodeW);
      maxY = Math.max(maxY, y + a.nodeH);
    }
  }

  const bounds = (isFinite(minX) && isFinite(minY))
    ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
    : null;

  return { nodes, bounds };
}

function drawMiniMap() {
  if (!miniMapEl || !miniMapCanvas || !miniMapCtx) return;
  if (!currentAreaName || !currentArea) return;
  if (loading) return;

  ensureMapCanvasSize(miniMapCanvas, miniMapCtx);
  const ctx = miniMapCtx;
  const w = miniMapCanvas.width;
  const h = miniMapCanvas.height;

  ctx.clearRect(0, 0, w, h);

  const areaSections = getAreaSectionsByName(currentAreaName);
  if (!areaSections || areaSections.length === 0) return;

  const curIdx = Math.floor(player.worldX / currentArea.sectionTileWidth);
  if (!isFinite(curIdx) || curIdx < 0 || curIdx >= areaSections.length) return;

  const baseH = 12;
  const curSize = getSectionRectSize(currentAreaName, baseH);
  const centerX = Math.floor(w / 2);
  const centerY = Math.floor(h / 2) + 4;

  const layout = buildFullMapLayout(false, { maxDegrees: 2 });
  if (!layout) return;

  const curNodeW = curSize.w;
  const curNodeH = curSize.h;
  const curKey = `${currentAreaName}::${curIdx}`;
  const tempNodes = buildNodesFromLayout(layout, { showAll: false }).nodes;
  const curNode = tempNodes.get(curKey);
  if (!curNode) return;

  const offsetX = Math.floor(centerX - (curNode.x + curNodeW / 2));
  const offsetY = Math.floor(centerY - (curNode.y + curNodeH / 2));

  const { nodes } = buildNodesFromLayout(layout, { showAll: false, offsetX, offsetY });

  // Circular mask
  const radius = Math.min(w, h) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();

  const areaLabels = buildAreaLabelPositions(nodes);
  renderMapCommon(ctx, nodes, {
    currentKey: `${currentAreaName}::${curIdx}`,
    areaLabels
  });

  ctx.restore();
}

function buildFullMapLayout(showAll = false, opts = null) {
  if (!currentAreaName || !areasData) return null;

  const BASE_H = 18;
  const GAP = 0;
  const AREA_GAP_X = 28;
  const AREA_GAP_Y = 30;
  const LABEL_H = 14;
  const PAD = 10;
  const maxDegrees = (opts && Number.isFinite(opts.maxDegrees)) ? Number(opts.maxDegrees) : 1;

  const areaDefs = {};
  const ensureArea = (name) => {
    if (!name) return null;
    if (areaDefs[name]) return areaDefs[name];
    const sections = getAreaSectionsByName(name);
    if (!sections) return null;
    const visited = new Set(getVisitedSectionIndices(name));
    if (!showAll && visited.size === 0) return null;
    if (showAll) {
      visited.clear();
      for (let i = 0; i < sections.length; i++) visited.add(i);
    }
    const nodeSize = getSectionRectSize(name, BASE_H);
    const width = sections.length * (nodeSize.w + GAP) - GAP;
    const height = LABEL_H + PAD + nodeSize.h + PAD;
    const def = {
      name,
      label: getAreaDisplayName(name),
      sections,
      visited,
      nodeW: nodeSize.w,
      nodeH: nodeSize.h,
      width,
      height,
      originX: 0,
      originY: 0
    };
    areaDefs[name] = def;
    return def;
  };

  const current = ensureArea(currentAreaName);
  if (!current) return null;

  // Place current area at (0,0)
  current.originX = 0;
  current.originY = 0;

  const placed = [current];
  const placedNames = new Set([current.name]);

  const queue = [{ area: current, depth: 0 }];
  const seen = new Set([current.name]);

  const placeAdjacentArea = (fromArea, targetArea, originX, originY) => {
    if (!targetArea) return;
    if (placedNames.has(targetArea.name)) return;
    targetArea.originX = originX;
    targetArea.originY = originY;
    placed.push(targetArea);
    placedNames.add(targetArea.name);
  };

  while (queue.length) {
    const entry = queue.shift();
    if (!entry) continue;
    const base = entry.area;
    if (entry.depth >= maxDegrees) continue;

    const baseRaw = areasData[base.name] || {};

    // Left/right area links
    if (baseRaw.leftarea) {
      const leftArea = ensureArea(baseRaw.leftarea);
      if (leftArea && !seen.has(leftArea.name)) {
        placeAdjacentArea(base, leftArea, base.originX - (leftArea.width + AREA_GAP_X), base.originY);
        seen.add(leftArea.name);
        queue.push({ area: leftArea, depth: entry.depth + 1 });
      }
    }
    if (baseRaw.rightarea) {
      const rightArea = ensureArea(baseRaw.rightarea);
      if (rightArea && !seen.has(rightArea.name)) {
        placeAdjacentArea(base, rightArea, base.originX + base.width + AREA_GAP_X, base.originY);
        seen.add(rightArea.name);
        queue.push({ area: rightArea, depth: entry.depth + 1 });
      }
    }

    // Exit-connected areas (up/down) from this area's sections
    const baseSections = base.sections;
    for (let i = 0; i < baseSections.length; i++) {
      const sec = baseSections[i];
      const exits = Array.isArray(sec?.exits) ? sec.exits : [];
      for (const ex of exits) {
        const dir = lc(ex?.direction || '');
        if (dir !== 'up' && dir !== 'down') continue;
        const target = parseTargetExitString(ex?.target);
        if (!target || !target.area) continue;

        const targetArea = ensureArea(target.area);
        if (!targetArea) continue;

        if (placedNames.has(targetArea.name)) continue;

        const targetIdx = target.section
          ? __getSectionIndexByName(target.area, target.section)
          : 0;

        const srcCenterX = (i * (base.nodeW + GAP)) + (base.nodeW / 2);
        const tgtCenterX = (targetIdx * (targetArea.nodeW + GAP)) + (targetArea.nodeW / 2);
        let originX = base.originX + srcCenterX - tgtCenterX;
        let originY = base.originY + ((dir === 'up') ? -(targetArea.height + AREA_GAP_Y) : (base.height + AREA_GAP_Y));

        // Avoid overlaps with existing areas on same row
        let safe = false;
        let guard = 0;
        while (!safe && guard < 40) {
          safe = true;
          for (const a of placed) {
            if (a.originY !== originY) continue;
            const aMin = a.originX;
            const aMax = a.originX + a.width;
            const bMin = originX;
            const bMax = originX + targetArea.width;
            const overlap = !(bMax <= aMin || bMin >= aMax);
            if (overlap) {
              originX += (targetArea.width + AREA_GAP_X);
              safe = false;
              break;
            }
          }
          guard++;
        }

        placeAdjacentArea(base, targetArea, originX, originY);
        seen.add(targetArea.name);
        queue.push({ area: targetArea, depth: entry.depth + 1 });
      }
    }
  }

  return {
    node: { gap: GAP },
    labelH: LABEL_H,
    pad: PAD,
    areas: placed
  };
}

function drawFullMapOverlay() {
  if (!mapOverlayOpen || !mapCanvas || !mapCtx) return;
  if (!currentAreaName || !currentArea) return;
  if (loading) return;

  ensureMapCanvasSize(mapCanvas, mapCtx);
  const ctx = mapCtx;
  const w = mapCanvas.width;
  const h = mapCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const layout = buildFullMapLayout(mapOverlayDebug, { maxDegrees: 1 });
  if (!layout) return;

  const { node, areas, labelH, pad } = layout;
  const GAP = node.gap;

  const baseNodes = buildNodesFromLayout(layout, { showAll: mapOverlayDebug });
  if (!baseNodes.bounds) return;
  const { bounds } = baseNodes;
  const layoutW = bounds.w;
  const layoutH = bounds.h;

  const margin = 16;
  const viewW = Math.max(1, w - margin * 2);
  const viewH = Math.max(1, h - margin * 2);

  const baseOffsetX = margin - bounds.minX;
  const baseOffsetY = margin - bounds.minY;

  const centerPanX = Math.floor((viewW - layoutW) / 2);
  const centerPanY = Math.floor((viewH - layoutH) / 2);

  const minPanX = (layoutW > viewW) ? (viewW - layoutW) : centerPanX;
  const maxPanX = (layoutW > viewW) ? 0 : centerPanX;
  const minPanY = (layoutH > viewH) ? (viewH - layoutH) : centerPanY;
  const maxPanY = (layoutH > viewH) ? 0 : centerPanY;

  let panX = mapPanX;
  let panY = mapPanY;

  const getNodePosWithPan = (area, idx, panDX, panDY) => {
    const x = baseOffsetX + panDX + area.originX + (idx * (area.nodeW + GAP));
    const y = baseOffsetY + panDY + area.originY + labelH + pad;
    return {
      x,
      y,
      w: area.nodeW,
      h: area.nodeH,
      cx: x + area.nodeW / 2,
      cy: y + area.nodeH / 2
    };
  };

  if (mapPanNeedsInit) {
    let initPanX = Math.floor((viewW - layoutW) / 2);
    let initPanY = Math.floor((viewH - layoutH) / 2);

    const curIdx = (currentArea && currentArea.sectionTileWidth)
      ? Math.floor(player.worldX / currentArea.sectionTileWidth)
      : -1;
    const curArea = areas.find(a => a.name === currentAreaName) || null;
    if (curArea && curIdx >= 0 && curIdx < curArea.sections.length) {
      const rect = getNodePosWithPan(curArea, curIdx, initPanX, initPanY);
      const rectL = rect.x;
      const rectR = rect.x + rect.w;
      const rectT = rect.y;
      const rectB = rect.y + rect.h;
      const viewL = margin;
      const viewR = w - margin;
      const viewT = margin;
      const viewB = h - margin;

      if (rectL < viewL) initPanX += (viewL - rectL);
      if (rectR > viewR) initPanX -= (rectR - viewR);
      if (rectT < viewT) initPanY += (viewT - rectT);
      if (rectB > viewB) initPanY -= (rectB - viewB);
    }

    panX = initPanX;
    panY = initPanY;
    mapPanNeedsInit = false;
  }

  panX = Math.max(minPanX, Math.min(maxPanX, panX));
  panY = Math.max(minPanY, Math.min(maxPanY, panY));
  mapPanX = panX;
  mapPanY = panY;

  const { nodes } = buildNodesFromLayout(layout, {
    showAll: mapOverlayDebug,
    offsetX: baseOffsetX + panX,
    offsetY: baseOffsetY + panY
  });

  const curIdx = (currentArea && currentArea.sectionTileWidth)
    ? Math.floor(player.worldX / currentArea.sectionTileWidth)
    : -1;

  const areaLabels = buildAreaLabelPositions(nodes);
  renderMapCommon(ctx, nodes, {
    currentKey: `${currentAreaName}::${curIdx}`,
    areaLabels,
    showAll: mapOverlayDebug
  });
}

function getCurrentSkyColor() {
  const info = __getTimeInfoForVisuals();
  const phase = lc(info.phase);
  const t = __clamp01(info.phaseT);

  const day = TIME_VISUAL_CFG.sky.day;
  const night = TIME_VISUAL_CFG.sky.night;

  if (phase === 'night') return night.color;
  if (phase === 'morning') return __lerpHex(night.color, day.color, t);
  if (phase === 'evening') return __lerpHex(day.color, night.color, t);
  return day.color;
}

function drawTimeDarkenOverlay(groupKey) {
  const cfg = getEffectiveTimeOfDayVisualCfg();
  if (cfg.disableAll) return;
  if (cfg.disableDarkening) return;

  const k = String(groupKey || '').trim().toUpperCase();

  const baseMax = Number(TIME_VISUAL_CFG.darken[k]);
  if (!isFinite(baseMax) || baseMax <= 0) return;

  const mult = Number(cfg.mult?.[k] ?? 1);
  const maxA = baseMax * (isFinite(mult) ? mult : 1);
  if (maxA <= 0) return;

  const d = getTimeDarknessFactor();

  const a = __clamp01(d * maxA);
  if (a <= 0) return;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.restore();
}

// ===== Time-of-day UI widget (bottom-right icon + sun arc) =====
function __getTimeDayOverlayOpacity() {
  const info = __getTimeInfoForVisuals();
  const phase = lc(info.phase);
  const t = __clamp01(info.phaseT);

  // time_day overlays time_night
  if (phase === 'day') return 1;
  if (phase === 'night') return 0;
  if (phase === 'morning') return t;       // 0 -> 1
  if (phase === 'evening') return 1 - t;   // 1 -> 0
  return 1;
}

function __getSunAngleDegForPhase() {
  const info = __getTimeInfoForVisuals();
  const phase = lc(info.phase);
  const t = __clamp01(info.phaseT);

  // We only draw the sun during morning/day/evening.
  // Angles are in degrees; because canvas Y increases downward,
  // increasing degrees produces clockwise motion visually.
  //
  // Key constraints with orbit center at bottom of the time icon (which is screen bottom):
  // - Morning start: sun just below (top edge touches bottom) => angle 30°
  // - Day start: sun fully on-screen => angle 270°
  // - Evening start: sun bottom edge touches screen bottom => angle 330°
  // - Night start: sun disappears (top edge touches bottom) => angle 510° (== 150° mod 360)
  if (phase === 'morning') return __lerp(162.5, 187.5, t);
  if (phase === 'day')     return __lerp(187.5, 352.5, t);
  if (phase === 'evening') return __lerp(352.5, 367.5, t);
  return null; // night (not drawn)
}

function drawTimeOfDayWidget() {
  // If the time visuals are disabled for this area/section, also hide the widget.
  const cfg = getEffectiveTimeOfDayVisualCfg();
  if (cfg.disableAll) return;

  // Require at least the night base icon to place/layout the widget.
  if (!timeNightIcon?.ready || !timeNightIcon.img) return;

  const BASE_W = 500;
  const BASE_H = 500;
  const DAY_W = 500;
  const DAY_H = 250;

  const baseX = WIDTH - BASE_W;
  const dayX = WIDTH - DAY_W;
  const dayY = HEIGHT - DAY_H; // keep day icon in original position
  const baseY = dayY;          // night icon top aligned to day (half off-screen)

  // 1) Draw night base (always), rotated around its center
  ctx.save();
  ctx.globalAlpha = 1;
  {
    const info = __getTimeInfoForVisuals();
    const dayT = __clamp01(info.dayT);
    const angle = dayT * Math.PI * 2;
    const cx = baseX + (BASE_W / 2);
    const cy = baseY + (BASE_H / 2);
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(timeNightIcon.img, -BASE_W / 2, -BASE_H / 2, BASE_W, BASE_H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // 2) Draw day overlay with phase-based opacity
  const dayA = __clamp01(__getTimeDayOverlayOpacity());
  if (dayA > 0 && timeDayIcon?.ready && timeDayIcon.img) {
    ctx.globalAlpha = dayA;
    ctx.drawImage(timeDayIcon.img, dayX, dayY, DAY_W, DAY_H);
  }

  // 3) Draw the sun in front of both icons
  const angDeg = __getSunAngleDegForPhase();
  if (angDeg != null) {
    const SUN_R = 21.75;        // sun radius (tuned to match the timing/visibility constraints)
    const ORBIT_R = DAY_W / 3;

    const cx = dayX + (DAY_W / 2);  // horizontal center of time icon
    const cy = dayY + DAY_H;        // vertical bottom of time icon

    const a = (angDeg * Math.PI) / 180;

    const sx = cx + ORBIT_R * Math.cos(a);
    const sy = cy + ORBIT_R * Math.sin(a);

    // Visibility constraints are satisfied by the angle keyframes above + these radii.
    // (Morning start / Night start: top edge touches bottom; Evening start: bottom edge touches bottom.)
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, SUN_R, 0, Math.PI * 2);
    ctx.fillStyle = 'yellow';
    ctx.fill();
  }

  // 4) Draw current time phase (centered within widget)
  const timeInfo = __getTimeInfoForVisuals();
  const phaseRaw = String(timeInfo.phase || '').trim();
  if (phaseRaw) {
    const padY = 8; // padding from bottom of icon to text
    ctx.globalAlpha = 1;
    const phase = lc(phaseRaw);
    const t = __clamp01(timeInfo.phaseT);
    const lerpRgb = (a, b, tt) => ([
      Math.round(__lerp(a[0], b[0], tt)),
      Math.round(__lerp(a[1], b[1], tt)),
      Math.round(__lerp(a[2], b[2], tt))
    ]);
    const toHex = (c) => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
    const WHITE = [255, 255, 255];
    const BLACK = [0, 0, 0];
    const ORANGE = [170, 60, 25]; // dark red/orange

    let textColor = '#ffffff';
    if (phase === 'night') {
      textColor = '#ffffff';
    } else if (phase === 'day') {
      textColor = '#000000';
    } else if (phase === 'morning') {
      const tt = (t < 0.5) ? (t * 2) : ((t - 0.5) * 2);
      const c = (t < 0.5)
        ? lerpRgb(WHITE, ORANGE, tt)
        : lerpRgb(ORANGE, BLACK, tt);
      textColor = toHex(c);
    } else if (phase === 'evening') {
      const tt = (t < 0.5) ? (t * 2) : ((t - 0.5) * 2);
      const c = (t < 0.5)
        ? lerpRgb(BLACK, ORANGE, tt)
        : lerpRgb(ORANGE, WHITE, tt);
      textColor = toHex(c);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = textColor;
    const tx = dayX + (DAY_W / 2);
    const areaY = dayY + DAY_H - padY;

    // Use the region label font styling
    ctx.font = uiFont(42, 'bold', 'italic');
    const phaseLabel = phaseRaw.charAt(0).toUpperCase() + phaseRaw.slice(1);
    ctx.fillText(phaseLabel, tx, areaY);

  }

  ctx.restore();
}



// ===== World time (day/night cycle core state) =====
// Authoritative continuous time value: minutes since day 0
let WORLD_TIME_MIN = 3600;

// Coarse time tick interval (in in-game minutes) for rule triggers
const WORLD_TIME_TICK_MIN = 10;

// Internal tracking so we can emit events only when needed
let __lastWorldTimeInfo = null;       // { phase, ... }
let __lastWorldTimeTickBucket = null; // integer


// Configurable in one place
const WORLD_TIME_CFG = {
  // How fast in-game time advances:
  // minutesPerRealSecond = 1 means 1 real second = 1 in-game minute
  minutesPerRealSecond: 1,

  // Phase durations (in in-game minutes)
  // phases: {
  //   morning: 300, // fade night -> day
  //   day:     3300,
  //   evening: 300, // fade day -> night
  //   night:   3300
  //}

  phases: {
    morning: 300, // fade night -> day
    day:     3300,
    evening: 300, // fade day -> night
    night:   3300
  }
};

function worldDayLengthMin() {
  const p = WORLD_TIME_CFG.phases;
  return (Number(p.morning) || 0) + (Number(p.day) || 0) + (Number(p.evening) || 0) + (Number(p.night) || 0);
}

// Derive phase + progress from the authoritative minutes value
function getWorldTimeInfo(tMin = WORLD_TIME_MIN) {
  const dayLen = Math.max(1, worldDayLengthMin());

  const t = Number(tMin) || 0;
  const dayIndex = Math.floor(t / dayLen);

  // normalized progress across full day cycle (0..1)
  const minutesIntoDay = ((t % dayLen) + dayLen) % dayLen;
  const dayT = minutesIntoDay / dayLen;

  const p = WORLD_TIME_CFG.phases;
  const morningLen = Math.max(0, Number(p.morning) || 0);
  const dayLenP    = Math.max(0, Number(p.day) || 0);
  const eveningLen = Math.max(0, Number(p.evening) || 0);
  const nightLen   = Math.max(0, Number(p.night) || 0);

  let phase = 'day';
  let phaseT = 0;

  let acc = 0;

  // Morning
  if (minutesIntoDay < acc + morningLen) {
    phase = 'morning';
    phaseT = (morningLen > 0) ? ((minutesIntoDay - acc) / morningLen) : 1;
    return { tMin: t, dayIndex, minutesIntoDay, dayLen, dayT, phase, phaseT };
  }
  acc += morningLen;

  // Day
  if (minutesIntoDay < acc + dayLenP) {
    phase = 'day';
    phaseT = (dayLenP > 0) ? ((minutesIntoDay - acc) / dayLenP) : 1;
    return { tMin: t, dayIndex, minutesIntoDay, dayLen, dayT, phase, phaseT };
  }
  acc += dayLenP;

  // Evening
  if (minutesIntoDay < acc + eveningLen) {
    phase = 'evening';
    phaseT = (eveningLen > 0) ? ((minutesIntoDay - acc) / eveningLen) : 1;
    return { tMin: t, dayIndex, minutesIntoDay, dayLen, dayT, phase, phaseT };
  }
  acc += eveningLen;

  // Night (default remainder)
  phase = 'night';
  phaseT = (nightLen > 0) ? ((minutesIntoDay - acc) / nightLen) : 1;
  return { tMin: t, dayIndex, minutesIntoDay, dayLen, dayT, phase, phaseT };
}

// Time advances using dt, and pauses are deterministic.
function shouldFreezeWorldTime() {
  // No time progression while menus are open
  if (inMenu || mapOverlayOpen) return true;

  // No time progression during dialog/conversations,
  // unless we're in an action phrase that explicitly allows time.
  if (inConversation && (!inActionPhrase || activeAction?.timeFrozen)) return true;

  return false;
}

function shouldAdvanceWorldTime() {
  return !shouldFreezeWorldTime();
}

function advanceWorldTime(dt) {
  const dts = Number(dt) || 0;
  if (dts <= 0) return;

  const rate = Number(WORLD_TIME_CFG.minutesPerRealSecond) || 0;
  if (rate === 0) return;

  const prevT = WORLD_TIME_MIN;
  const prevInfo = getWorldTimeInfo(prevT);
  const prevPhase = lc(prevInfo.phase);

  const prevBucket = Math.floor(prevT / Math.max(1e-6, WORLD_TIME_TICK_MIN));

  WORLD_TIME_MIN += dts * rate;

  const nextT = WORLD_TIME_MIN;
  const nextInfo = getWorldTimeInfo(nextT);
  const nextPhase = lc(nextInfo.phase);

  const nextBucket = Math.floor(nextT / Math.max(1e-6, WORLD_TIME_TICK_MIN));

  // Cache latest info for debug/UI
  __lastWorldTimeInfo = nextInfo;
  __lastWorldTimeTickBucket = nextBucket;

  // ---- Phase change event ----
  if (prevPhase && nextPhase && prevPhase !== nextPhase) {
    emitGameEvent('time_phase_change', {
      fromPhase: prevInfo.phase,
      toPhase: nextInfo.phase,
      tMin: nextInfo.tMin,
      dayIndex: nextInfo.dayIndex,
      dayT: nextInfo.dayT,
      phaseT: nextInfo.phaseT
    });
  }

  // ---- Coarse time tick event(s) ----
  if (nextBucket !== prevBucket) {
    // If time jumps forward a lot, emit each crossed bucket (cap to avoid runaway loops)
    const step = (nextBucket > prevBucket) ? 1 : -1;
    const maxTicks = 200;
    let emitted = 0;

    for (let b = prevBucket + step; (step > 0 ? b <= nextBucket : b >= nextBucket); b += step) {
      emitted++;
      if (emitted > maxTicks) break;

      const tickTMin = b * WORLD_TIME_TICK_MIN;
      const info = getWorldTimeInfo(tickTMin);

      emitGameEvent('time_tick', {
        bucket: b,
        tickMin: WORLD_TIME_TICK_MIN,
        tMin: info.tMin,
        dayIndex: info.dayIndex,
        dayT: info.dayT,
        phase: info.phase,
        phaseT: info.phaseT
      });
    }
  }
}

function __phaseStartMinute(phaseLc) {
  const p = WORLD_TIME_CFG.phases;
  const m = Math.max(0, Number(p.morning) || 0);
  const d = Math.max(0, Number(p.day) || 0);
  const e = Math.max(0, Number(p.evening) || 0);

  const ph = lc(phaseLc);
  if (ph === 'morning') return 0;
  if (ph === 'day') return m;
  if (ph === 'evening') return m + d;
  if (ph === 'night') return m + d + e;
  return 0;
}

function __setWorldTimeMin(nextTMin, meta) {
  const prevT = WORLD_TIME_MIN;
  const prevInfo = getWorldTimeInfo(prevT);
  const prevPhase = lc(prevInfo.phase);

  const tickMin = Math.max(1e-6, Number(WORLD_TIME_TICK_MIN) || 10);
  const prevBucket = Math.floor(prevT / tickMin);

  WORLD_TIME_MIN = Number(nextTMin) || 0;

  const nextT = WORLD_TIME_MIN;
  const nextInfo = getWorldTimeInfo(nextT);
  const nextPhase = lc(nextInfo.phase);

  const nextBucket = Math.floor(nextT / tickMin);

  __lastWorldTimeInfo = nextInfo;
  __lastWorldTimeTickBucket = nextBucket;

  // Phase change
  if (prevPhase && nextPhase && prevPhase !== nextPhase) {
    emitGameEvent('time_phase_change', {
      fromPhase: prevInfo.phase,
      toPhase: nextInfo.phase,
      tMin: nextInfo.tMin,
      dayIndex: nextInfo.dayIndex,
      dayT: nextInfo.dayT,
      phaseT: nextInfo.phaseT,
      meta: meta || null
    });
  }

  // Time tick(s)
  if (nextBucket !== prevBucket) {
    const step = (nextBucket > prevBucket) ? 1 : -1;
    const maxTicks = 200;
    let emitted = 0;

    for (let b = prevBucket + step; (step > 0 ? b <= nextBucket : b >= nextBucket); b += step) {
      emitted++;
      if (emitted > maxTicks) break;

      const tickTMin2 = b * tickMin;
      const info = getWorldTimeInfo(tickTMin2);

      emitGameEvent('time_tick', {
        bucket: b,
        tickMin: tickMin,
        tMin: info.tMin,
        dayIndex: info.dayIndex,
        dayT: info.dayT,
        phase: info.phase,
        phaseT: info.phaseT,
        meta: meta || null
      });
    }
  }
}

function __advanceWorldTimeByMinutes(deltaMin, meta) {
  const d = Number(deltaMin) || 0;
  if (d === 0) return;
  __setWorldTimeMin(WORLD_TIME_MIN + d, meta);
}

function __setWorldTimeToPhase(phase, meta) {
  const ph = lc(phase);
  const info = getWorldTimeInfo(WORLD_TIME_MIN);
  const dayLen = Math.max(1, worldDayLengthMin());

  const startIntoDay = __phaseStartMinute(ph);
  const target = (info.dayIndex * dayLen) + startIntoDay;

  __setWorldTimeMin(target, meta);
}

function __skipWorldTimeToNextPhase(phase, meta) {
  const ph = lc(phase);
  const info = getWorldTimeInfo(WORLD_TIME_MIN);
  const dayLen = Math.max(1, worldDayLengthMin());

  const startIntoDay = __phaseStartMinute(ph);
  const base = (info.dayIndex * dayLen) + startIntoDay;

  // If we're already past (or at) that start today, go to next day's start
  const target = (WORLD_TIME_MIN >= base) ? (base + dayLen) : base;

  __setWorldTimeMin(target, meta);
}



// Physics baselines (we scale these with character scale so jumping feels consistent)
const BASE_GRAVITY = 0.35;
const BASE_JUMP_FORCE = -7.5;
let gravity = BASE_GRAVITY;
const friction = 0.90;

//CHARACTER CONSTANTS
// Interaction radii (multipliers of player visible width)
let INTERACTION = {
  npc: 1.8,
  object: 1.0,
  exit: 1.0,
  safeplace: 1.0,
  area_end: 1.0
};



const FOLLOW_ACCEL_TIME = 2.0; // seconds to reach full speed
const FOLLOW_DECEL_TIME = 2.0; // seconds to come to rest

// Recruit icon (draw above recruitable world NPCs)
const recruitIcon = {
  img: null,
  ready: false,
  failed: false
};

(() => {
  const img = new Image();
  img.onload = () => { recruitIcon.img = img; recruitIcon.ready = true; };
  img.onerror = () => { recruitIcon.failed = true; };
  img.src = 'assets/icons/recruit.png';
})();

const interactIcon = {
  img: null,
  ready: false,
  failed: false
};

(() => {
  const img = new Image();
  img.onload = () => { interactIcon.img = img; interactIcon.ready = true; };
  img.onerror = () => { interactIcon.failed = true; };
  img.src = 'assets/icons/interact.png';
})();

const exitUpIcon = {
  img: null,
  ready: false,
  failed: false
};

(() => {
  const img = new Image();
  img.onload = () => { exitUpIcon.img = img; exitUpIcon.ready = true; };
  img.onerror = () => { exitUpIcon.failed = true; };
  img.src = 'assets/icons/exit_up.png';
})();

const exitDownIcon = {
  img: null,
  ready: false,
  failed: false
};

(() => {
  const img = new Image();
  img.onload = () => { exitDownIcon.img = img; exitDownIcon.ready = true; };
  img.onerror = () => { exitDownIcon.failed = true; };
  img.src = 'assets/icons/exit_down.png';
})();

// Time-of-day UI icons (bottom-right)
const timeNightIcon = {
  img: null,
  ready: false,
  failed: false
};

(() => {
  const img = new Image();
  img.onload = () => { timeNightIcon.img = img; timeNightIcon.ready = true; };
  img.onerror = () => { timeNightIcon.failed = true; };
  img.src = 'assets/icons/time_night.png';
})();

const timeDayIcon = {
  img: null,
  ready: false,
  failed: false
};

(() => {
  const img = new Image();
  img.onload = () => { timeDayIcon.img = img; timeDayIcon.ready = true; };
  img.onerror = () => { timeDayIcon.failed = true; };
  img.src = 'assets/icons/time_day.png';
})();

// Prompt tag icons (npcName_prompt.png)
const promptIconByNpc = new Map(); // name -> {img, ready, failed}
function getPromptIconEntry(npcName) {
  const key = lc(String(npcName || '').trim());
  if (!key) return null;
  if (promptIconByNpc.has(key)) return promptIconByNpc.get(key);
  const entry = { img: null, ready: false, failed: false };
  const img = new Image();
  img.onload = () => { entry.img = img; entry.ready = true; };
  img.onerror = () => { entry.failed = true; };
  img.src = `assets/icons/${key}_prompt.png`;
  promptIconByNpc.set(key, entry);
  return entry;
}



//SCALING HANDLING
const BASE_VIEW_HEIGHT = 720; // CSS pixels: the height your current SCALE values were tuned for
const BASE_CANVAS_W = 1000;
const BASE_CANVAS_H = 800;
const WORLD_HEIGHT = 1800; // logical world height, NEVER changes


const BASE_SCALE = {
  world: 3.9,
  characters: 3.0,
  objects: 4.6
};

// NOTE: SCALE is now dynamic. It updates on window resize using HEIGHT only.
let SCALE = {
  resolution: 2,   // internal render resolution (sharpness) - leave this constant
  world: BASE_SCALE.world,
  characters: BASE_SCALE.characters,
  objects: BASE_SCALE.objects
};




// Canvas / view size (set by resizeCanvas)
let WIDTH = canvas.width;
let HEIGHT = canvas.height;

// Ground line (screen-space baseline; world Y stability handled in resizeWorldAfterResize)
let groundLineY = HEIGHT - 40;
let groundY = groundLineY;



function resizeCanvas() {
  resizeCanvasResolution();
  resizeWorldAfterResize();
  resizeMapCanvases();

  // IMPORTANT: area geometry depends on SCALE.world (tile draw width), so rebuild it.
  if (currentArea) recalcCurrentAreaGeometry();
}

function resizeCanvasResolution() {
  canvas.height = WORLD_HEIGHT;
  const touchLayout = document.documentElement.classList.contains('touch-enabled');
  const viewW = touchLayout ? viewportEl.clientWidth : window.innerWidth;
  const viewH = touchLayout ? viewportEl.clientHeight : window.innerHeight;
  canvas.width  = Math.floor(WORLD_HEIGHT * (viewW / Math.max(1, viewH)));

  WIDTH  = canvas.width;
  HEIGHT = canvas.height;
}





function resizeWorldAfterResize() {
  // Recompute character sizes (because SCALE.characters changes with window height)
  player.w = BASE_CHAR_W * SCALE.characters;
  player.h = BASE_CHAR_H * SCALE.characters;
  player.jumpForce = BASE_JUMP_FORCE * (SCALE.characters / BASE_SCALE.characters);

  for (const m of party) {
    m.w = player.w;
    m.h = player.h;
  }
  for (const n of npcs) {
    n.w = player.w;
    n.h = player.h;
  }

  const oldGroundY = groundY;

  groundLineY = HEIGHT - Math.floor(40 * SCALE.world);
  groundY = groundLineY;

  const dY = groundY - oldGroundY;

if (currentArea) {
  cameraX = clampCameraX(cameraX);
}


  // Preserve world Y positions relative to ground instead of snapping
  player.y += dY;
  for (const m of party) m.y += dY;
  for (const n of npcs)  n.y += dY;

}




function movementSpeed() {
  return 3000 * (WORLD_HEIGHT / BASE_VIEW_HEIGHT);
}

function maxMovementSpeed() {
  return 1000 * (WORLD_HEIGHT / BASE_VIEW_HEIGHT);
}



//PARTY FOLLOWING CONTROLS
const FOLLOW = {
  baseStart: 1.4, // multiples of character width
  baseStop:  1.3  // MUST be smaller than baseStart
};

//Distance beyond which a party member should start chasing the previous party member
function followStartDistance(index) {
  return player.w * (FOLLOW.baseStart + index * 0.35);
}

//Distance within which a party member should stop chasing the previous party member
function followStopDistance(index) {
  return player.w * (FOLLOW.baseStop + index * 0.35);
}

function __isPartyMemberDetachedForFollow(m, nowMs) {
  if (!m) return false;

  if (m.__followChainDetached === true) {
    const until = Number(m.__followChainDetachedUntilMs || 0);
    if (isFinite(until) && until > nowMs) return true;

    // expired -> cleanup
    m.__followChainDetached = false;
    m.__followChainDetachedUntilMs = 0;
  }

  return false;
}

function getPartyFollowTargetForIndex(i, nowMs) {
  // party[i] follows the nearest previous party member that is NOT detached;
  // if none, follow player.
  for (let j = i - 1; j >= 0; j--) {
    const prev = party[j];
    if (!prev) continue;
    if (__isPartyMemberDetachedForFollow(prev, nowMs)) continue;
    return prev;
  }
  return player;
}


//LEVELS OF PARALLAX FOR DIFFERENT LAYERS
const PARALLAX = {
  sky: 0.0,
  distant: 0.15,
  background: 0.45,
  backObjects: 0.65,
  ground: 1.0,
  foreground: 1.18
};

//I THINK THIS CONVERTS BETWEEN DIFFERENT COORDINATE SYSTEMS
function worldToScreenX(worldX, parallax = 1) {
  return Math.floor(worldX - cameraX * parallax);
}


//START GAME
//Start game in loading screen
let loading = true;


// WORLD BUILDING=
const areaCache = new Map();
let cameraX = 0; // left edge in world px (at zoom=1)
let cameraZoom = 1; // 1 = default (no zoom)
let lastDirection = 1; //Which direction the player character was facing the last time they moved

// Camera mode:
// - follow: tracks a target (player/npc/object)
// - manual: fixed centerX (world px)
let cameraMode = 'follow';
let cameraTargetSpec = { type: 'player' }; // default follow target
let cameraManualCenterX = null;

// Single active camera transition (used by dialog action phrases)
const CAMERA_TWEEN = {
  active: false,
  id: 0,
  startedAtMs: 0,
  durationMs: 0,
  startCenterX: 0,
  startZoom: 1,
  endMode: 'follow',          // 'follow'|'manual'
  endTargetSpec: { type: 'player' },
  endManualCenterX: null,     // number when endMode==='manual'
  endZoom: 1
};

function cameraViewportW() {
  return WIDTH / Math.max(0.0001, cameraZoom);
}

function clampCameraX(x) {
  if (!currentArea) return Math.max(0, x);
  const vw = cameraViewportW();
  return Math.max(0, Math.min(Number(x) || 0, Math.max(0, currentArea.lengthPx - vw)));
}

function currentCameraCenterX() {
  return cameraX + cameraViewportW() * 0.5;
}

function __resolveActionTargetSpec(act) {
  if (!act || typeof act !== 'object') return null;

  if (act.target && typeof act.target === 'object') return act.target;
  if (act.targetSpec && typeof act.targetSpec === 'object') return act.targetSpec;

  if (act.objectId || act.object || act.objectBase) {
    return { type: 'object', id: act.objectId || act.object || act.objectBase };
  }
  if (act.objectInstanceKey || act.objectInstanceId || act.instanceKey) {
    return { type: 'objectInstance', instanceKey: act.objectInstanceKey || act.objectInstanceId || act.instanceKey };
  }
  if (act.mobId || act.mob) {
    return { type: 'mob', id: act.mobId || act.mob };
  }
  if (act.mobInstanceId || act.mobInstance || act.mobInstanceKey) {
    return { type: 'mobInstance', instanceId: act.mobInstanceId || act.mobInstance || act.mobInstanceKey };
  }
  if (act.toChar || act.actorTo || act.toNpc) {
    return { type: 'npc', npc: act.toChar || act.actorTo || act.toNpc };
  }
  if (act.toActiveObject === true) {
    return { type: 'activeObject' };
  }
  if (act.section || act.sectionX != null) {
    return {
      type: 'sectionPos',
      area: act.area || act.areaName || null,
      section: act.section || null,
      x: act.sectionX ?? act.x ?? 0
    };
  }
  if (act.worldX != null || act.x != null) {
    return { type: 'worldX', x: act.worldX ?? act.x };
  }
  return null;
}

function __getTargetCenterXFromSpecNearActor(spec, actor) {
  if (!spec) return null;
  const t = lc(spec?.type);
  const nearX = isFinite(actor?.worldX) ? Number(actor.worldX) : currentCameraCenterX();

  if (t === 'object') {
    const baseId = String(spec.id || spec.baseId || spec.filename || '');
    if (!baseId) return null;
    const instKey = findAnyObjectInstanceByBaseIdNear(baseId, nearX);
    const tgt = instKey ? proximityTargetByKey.get(instKey) : null;
    return (tgt && isFinite(tgt.worldX)) ? Number(tgt.worldX) : null;
  }

  if (t === 'mob') {
    const mobId = String(spec.id || spec.mobId || spec.mob || '');
    if (!mobId) return null;
    const instanceId = findAnyMobInstanceByIdNear(mobId, nearX);
    if (!instanceId) return null;
    const m = mobs.find(mm => mm && String(mm.instanceId) === String(instanceId));
    if (!m) return null;
    const hb = getMobHitboxWorldRect(m);
    return (hb && isFinite(hb.x) && isFinite(hb.w)) ? (Number(hb.x) + Number(hb.w) * 0.5) : null;
  }

  if (t === 'sectionpos') {
    const areaName = spec.area ? String(spec.area) : String(currentAreaName || '');
    if (areaName && currentAreaName && areaName !== String(currentAreaName)) return null;
    const startX = sectionStartWorldX(currentArea, spec.section);
    if (!isFinite(startX)) return null;
    const local = Number(spec.x);
    if (!isFinite(local)) return null;
    return startX + local;
  }

  return getTargetCenterXFromSpec(spec);
}

// Zoom transform around screen center for WORLD rendering
function applyCameraZoomTransform() {
  ctx.translate(WIDTH * 0.5, HEIGHT * 0.5);
  ctx.scale(cameraZoom, cameraZoom);
  ctx.translate(-WIDTH * 0.5, -HEIGHT * 0.5);
}

function getTargetCenterXFromSpec(spec) {
  const t = lc(spec?.type);
  if (t === 'player') return player.worldX + player.w * 0.5;

  if (t === 'npc') {
    const a = findActorByName(spec.npc || spec.name);
    return a ? (a.worldX + a.w * 0.5) : null;
  }

  if (t === 'objectinstance') {
    const key = String(spec.instanceKey || '');
    const tgt = proximityTargetByKey.get(key);
    return (tgt && isFinite(tgt.worldX)) ? Number(tgt.worldX) : null;
  }

  if (t === 'activeobject') {
    const key = currentObjectInteract?.instanceKey ? String(currentObjectInteract.instanceKey) : null;
    if (key) {
      const tgt = proximityTargetByKey.get(key);
      return (tgt && isFinite(tgt.worldX)) ? Number(tgt.worldX) : null;
    }
    // fallback: nearest instance by base id (if the flag exists)
    const baseId = getFlag('global', 'activeObjectType');
    if (baseId) {
      const nearX = currentCameraCenterX();
      const instKey = findAnyObjectInstanceByBaseIdNear(String(baseId), nearX);
      const tgt = instKey ? proximityTargetByKey.get(instKey) : null;
      return (tgt && isFinite(tgt.worldX)) ? Number(tgt.worldX) : null;
    }
    return null;
  }

  if (t === 'object') {
    const baseId = String(spec.id || spec.baseId || spec.filename || '');
    if (!baseId) return null;
    const nearX = currentCameraCenterX();
    const instKey = findAnyObjectInstanceByBaseIdNear(baseId, nearX);
    const tgt = instKey ? proximityTargetByKey.get(instKey) : null;
    return (tgt && isFinite(tgt.worldX)) ? Number(tgt.worldX) : null;
  }

    if (t === 'mobinstance') {
    const wantInstanceId = String(spec.instanceId || spec.instance || spec.id || '');
    if (!wantInstanceId) return null;

    const m = mobs.find(mm => mm && String(mm.instanceId) === wantInstanceId);
    if (!m) return null;

    const hb = getMobHitboxWorldRect(m);
    return (hb && isFinite(hb.x) && isFinite(hb.w)) ? (Number(hb.x) + Number(hb.w) * 0.5) : null;
  }

  if (t === 'mob') {
    const mobId = String(spec.id || spec.mobId || spec.mob || '');
    if (!mobId) return null;

    const nearX = currentCameraCenterX();
    const instanceId = findAnyMobInstanceByIdNear(mobId, nearX);
    if (!instanceId) return null;

    const m = mobs.find(mm => mm && String(mm.instanceId) === String(instanceId));
    if (!m) return null;

    const hb = getMobHitboxWorldRect(m);
    return (hb && isFinite(hb.x) && isFinite(hb.w)) ? (Number(hb.x) + Number(hb.w) * 0.5) : null;
  }


  if (t === 'worldx') {
    const x = Number(spec.x);
    return isFinite(x) ? x : null; // centerX in world px
  }

  if (t === 'sectionpos') {
    if (spec.area && String(spec.area) !== String(currentAreaName)) return null;
    const startX = sectionStartWorldX(currentArea, spec.section);
    if (!isFinite(startX)) return null;
    const local = Number(spec.x);
    if (!isFinite(local)) return null;
    return startX + local; // centerX in world px
  }

  return null;
}

function startCameraTween({ endMode, endTargetSpec, endManualCenterX, endZoom, durationMs }) {
  CAMERA_TWEEN.active = true;
  CAMERA_TWEEN.id++;
  CAMERA_TWEEN.startedAtMs = getGameNowMs();
  CAMERA_TWEEN.durationMs = Math.max(0, Number(durationMs) || 0);

  CAMERA_TWEEN.startCenterX = currentCameraCenterX();
  CAMERA_TWEEN.startZoom = cameraZoom;

  CAMERA_TWEEN.endMode = endMode;
  CAMERA_TWEEN.endTargetSpec = endTargetSpec || { type: 'player' };
  CAMERA_TWEEN.endManualCenterX = (endMode === 'manual') ? Number(endManualCenterX) : null;
  CAMERA_TWEEN.endZoom = (isFinite(endZoom) && endZoom > 0) ? Number(endZoom) : cameraZoom;

  // Instant snap if duration is 0
  if (CAMERA_TWEEN.durationMs <= 0) {
    cameraZoom = CAMERA_TWEEN.endZoom;

    if (endMode === 'manual') {
      cameraMode = 'manual';
      cameraManualCenterX = CAMERA_TWEEN.endManualCenterX;
    } else {
      cameraMode = 'follow';
      cameraTargetSpec = CAMERA_TWEEN.endTargetSpec;
      cameraManualCenterX = null;
    }

    const endCenter = (endMode === 'manual')
      ? cameraManualCenterX
      : getTargetCenterXFromSpec(cameraTargetSpec);

    if (isFinite(endCenter)) {
      cameraX = clampCameraX(Number(endCenter) - cameraViewportW() * 0.5);
    } else {
      cameraX = clampCameraX(cameraX);
    }

    CAMERA_TWEEN.active = false;
  }

  return CAMERA_TWEEN.id;
}

function updateCameraTween() {
  if (!CAMERA_TWEEN.active) return;

  const now = getGameNowMs();
  const t = (now - CAMERA_TWEEN.startedAtMs) / Math.max(1, CAMERA_TWEEN.durationMs);
  const a = Math.max(0, Math.min(1, t));

  // Zoom (interpolate)
  const z = CAMERA_TWEEN.startZoom + (CAMERA_TWEEN.endZoom - CAMERA_TWEEN.startZoom) * a;
  cameraZoom = Math.max(0.0001, z);

  // End center: dynamic if following a moving target
  let endCenter = null;
  if (CAMERA_TWEEN.endMode === 'manual') {
    endCenter = CAMERA_TWEEN.endManualCenterX;
  } else {
    endCenter = getTargetCenterXFromSpec(CAMERA_TWEEN.endTargetSpec);
  }

  if (!isFinite(endCenter)) endCenter = CAMERA_TWEEN.startCenterX;

  // Center interpolate (move + zoom finish together)
  const center = CAMERA_TWEEN.startCenterX + (endCenter - CAMERA_TWEEN.startCenterX) * a;

  cameraX = clampCameraX(center - cameraViewportW() * 0.5);

  if (a >= 1) {
    // Commit final mode/target
    if (CAMERA_TWEEN.endMode === 'manual') {
      cameraMode = 'manual';
      cameraManualCenterX = CAMERA_TWEEN.endManualCenterX;
    } else {
      cameraMode = 'follow';
      cameraTargetSpec = CAMERA_TWEEN.endTargetSpec;
      cameraManualCenterX = null;
    }

    CAMERA_TWEEN.active = false;
  }
}

// ===== Areas / Sections / Exits =====
let areasData = null;
let currentAreaName = null;
let currentArea = null;

// World-space bounds (for this Area)
let worldMin = 0;
let worldMax = 0;
let lastTs = 0;

// Section and ground assets
const groundImages = new Map(); // key -> {img, ready, w, h}
const BASE_TILE_DRAW_HEIGHT_PCT = 23.8333; // percent of window height (tuned to match old 110 * 3.9)
function TILE_DRAW_HEIGHT() {
  return Math.floor(HEIGHT * (BASE_TILE_DRAW_HEIGHT_PCT / 100));
}

// Scenery (simple per-area)
const trees = [];
const bushes = [];
const rocks = [];

// FADE TRANSITION OVERLAY BETWEEN AREAS
const FADE = {
  id: 0,

  // shared
  active: false,
  kind: 'none', // 'transfer' | 'tween' | 'none'
  t: 0,

  // current overlay alpha (0..1)
  alpha: 0,

  // transfer (area change / pass out)
  phase: 'idle', // 'out' | 'in' | 'idle'
  durOut: 0.22,  // seconds
  durIn: 0.22,   // seconds
  onMid: null,

  // tween (custom fade)
  startAlpha: 0,
  targetAlpha: 0,
  dur: 0         // seconds
};

// Exits (absolute world-space list for current area)
let worldExits = [];
let worldSafePlaces = [];
let lastSafePlace = null;
let playerIsPassedOut = false
let currentExitUp = null;
let currentExitDown = null;
let currentTrigger = null;

// ===== Pass-out carry system =====
// Names (original casing) of party members who passed out and were dropped from party
// since the last time the PLAYER visited a safe place.
let unconsciousPartyMembers = [];

// Track where/when NPCs fell unconscious (even if removed from the list above).
// key: lc(npcName) -> { name, area, worldX, dayIndex }
const unconsciousNpcFalls = new Map();

let __passoutPromptSeq = 0;

let __pendingPassoutRescue = null; // { kind, candidates:[names], phraseId, triggerKey }
let __passoutSafeplaceId = null;
let __passoutSafeplaceArea = null;


let lastProximityNpc = null;

// Track which proximity targets are currently within interaction radius (edge-trigger)
// NOTE: for objects, this is INSTANCE-based because makeProxKey prefers instanceId.
const proximityInside = new Set();
const proximityInsideRaw = new Set(); // raw proximity for objects (ignores cover)

// Track "rule-facing" proximity by TYPE (kind + base id), eg "object:letta_bush"
const proximityInsideTypes = new Set();

// Which instance is currently interactable per type (kind:id → instanceKey)
const proximityInteractFocus = new Map();

// Per-frame target lookup (instanceKey -> target)
const proximityTargetByKey = new Map();
const portalInside = new Set();         // contactKey -> inside portal rect
const portalSuppressInside = new Set(); // contactKey -> suppress enter trigger until exit
let portalArrivalPending = false;       // set when teleported via portal; suppress portals on arrival
const PORTAL_ARRIVAL_SUPPRESS_MS = 250;
let portalSuppressUntilMs = 0;
const DEBUG_PORTALS = false;
const DEBUG_PORTAL_MAP = true;
const __portalMapLogged = new Set();
const DEBUG_GATES = true;

// ===== Mob contact tracking (AABB overlap) =====
// Pair-level: mob instance + target actor (player or npc)
const contactInsidePairs = new Set(); // key "mob:<instanceId>|<actorKey>"
const contactTypeCountPairs = new Map(); // key "mob:<mobId>|<actorKey>" -> number of instances currently in contact with that actor

// Keep the existing TYPE-level state for rule-facing "playerInContact" checks (any actor contact still counts)
const contactTypeCount = new Map(); // key "mob:<mobId>" -> number of instances currently in contact with ANY actor
const contactInsideTypes = new Set(); // rule-facing TYPE contact: contains "mob:<mobId>"


function makeContactKey(t) {
  const kind = lc(t?.kind);
  const id   = lc(t?.id);
  if (!kind || !id) return '';
  return `${kind}:${id}`;
}

function contactActorKeyFromActor(actor) {
  if (!actor) return '';
  if (actor === player || lc(actor?.name) === 'player') return 'player';

  // Mob instance (needs to be distinguishable from NPC by name)
  if (actor && actor.instanceId && actor.id) {
    return `mob:${lc(actor.id)}:${String(actor.instanceId)}`;
  }

  const n = String(actor.name || '').trim();
  if (!n) return '';
  return `npc:${n}`;
}

function contactPairKey(mobInstanceId, actor) {
  const akey = contactActorKeyFromActor(actor);
  const mid = lc(mobInstanceId || '');
  if (!akey || !mid) return '';
  return `mob:${mid}|${akey}`;
}

function targetActorDescriptorFromActor(actor) {
  if (!actor) return null;
  if (actor.kind === 'object' || actor._targetKind === 'object') {
    const id = String(actor.id || actor.filename || '').trim();
    const inst = String(actor.instanceId || '').trim();
    if (!id) return null;
    return { kind: 'object', id, instanceId: (inst || undefined) };
  }
  if (actor === player || lc(actor?.name) === 'player') return { kind: 'player' };

  // Mob instance
  if (actor && actor.instanceId && actor.id) {
    return { kind: 'mob', id: String(actor.id), instanceId: String(actor.instanceId) };
  }

  const n = String(actor.name || '').trim();
  if (!n) return null;
  return { kind: 'npc', name: n };
}

function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return (
    ax < bx + bw &&
    ax + aw > bx &&
    ay < by + bh &&
    ay + ah > by
  );
}

// ===== Object blocker rectangles (mist / future obstacles) =====

function evalObjectPassConditions(passConditions) {
  // First iteration: AND all conditions.
  if (!Array.isArray(passConditions) || passConditions.length === 0) return true;

  for (const c of passConditions) {
    // String shorthand: area-flag must be truthy
    if (typeof c === 'string') {
      const v = getFlag('area', c);
      if (!v) return false;
      continue;
    }

    if (!c || typeof c !== 'object') return false;

    const type = lc(c.type || 'flag');
    if (type !== 'flag') return false;

    const scope = String(c.scope || 'area');
    const key = String(c.key || c.flag || '');
    if (!key) return false;

    const op = lc(c.op || 'eq');
    const want = (c.value !== undefined) ? c.value : ((c.is !== undefined) ? c.is : true);
    const got = getFlag(scope, key);

    if (op === 'neq') {
      if (got === want) return false;
    } else { // eq (default)
      if (got !== want) return false;
    }
  }

  return true;
}

// ===== Actor tags (dynamic gameplay tags) =====

function ensureActorTags(actor) {
  if (!actor || typeof actor !== 'object') return null;

  // Support either Set or array (we normalize to Set)
  if (actor.tags instanceof Set) return actor.tags;

  const s = new Set();
  if (Array.isArray(actor.tags)) {
    for (const t of actor.tags) {
      const k = lc(t);
      if (k) s.add(k);
    }
  }
  actor.tags = s;
  return s;
}

function actorHasTag(actor, tag) {
  const t = lc(tag);
  if (!t) return false;
  const s = ensureActorTags(actor);
  return !!(s && s.has(t));
}

function actorAddTag(actor, tag) {
  const t = lc(tag);
  if (!t) return false;
  const s = ensureActorTags(actor);
  if (!s) return false;
  s.add(t);
  return true;
}

function actorRemoveTag(actor, tag) {
  const t = lc(tag);
  if (!t) return false;
  const s = ensureActorTags(actor);
  if (!s) return false;
  s.delete(t);
  return true;
}

function partyHasTag(tag) {
  if (actorHasTag(player, tag)) return true;
  for (const m of party) {
    if (actorHasTag(m, tag)) return true;
  }
  return false;
}


// ===== Gate state (open/closed) =====

function gateFlagKeyForInstance(instanceIdRaw) {
  const id = String(instanceIdRaw || '').trim();
  if (!id) return '';
  return `gateOpen:${id}`;
}

function gateFlagKeyFromObjectRef(refRaw) {
  const ref = String(refRaw || '').trim();
  if (!ref) return '';
  const parts = ref.split('.').map(p => String(p || '').trim()).filter(Boolean);
  if (parts.length >= 3) {
    const area = parts[0];
    const section = parts[1];
    const objectId = parts.slice(2).join('.');
    if (area && section && objectId) {
      return `gateOpen:${area}:${section}:${objectId}`;
    }
  }
  return gateFlagKeyForInstance(ref);
}

function getGateFlagKeyForObject(o, fallbackInstanceId) {
  const area = String(currentAreaName || '').trim();
  const objectId = (o?.objectId != null && o.objectId !== '') ? String(o.objectId)
    : ((o?.id != null && o.id !== '') ? String(o.id) : null);
  const idx = (typeof o?.sectionIndex === 'number')
    ? o.sectionIndex
    : (area ? getSectionIndexForWorldX(area, o?.worldX) : -1);
  const sectionKey = (area && idx >= 0) ? getSectionKeyForIndex(area, idx) : null;
  if (area && sectionKey && objectId) {
    return `gateOpen:${area}:${sectionKey}:${objectId}`;
  }
  const instanceId = String(o?.instanceId || fallbackInstanceId || '').trim();
  return gateFlagKeyForInstance(instanceId);
}

function resolveGateFlagKeyFromId(idRaw) {
  const id = String(idRaw || '').trim();
  if (!id) return '';

  // If the id is already a full ref (area.section.objectId)
  const byRef = gateFlagKeyFromObjectRef(id);
  if (byRef !== gateFlagKeyForInstance(id)) return byRef;

  // Try to resolve within the current area by objectId
  if (currentArea && currentAreaName) {
    const lists = []
      .concat(currentArea.backObjects || [])
      .concat(currentArea.foreObjects || [])
      .concat(currentArea.groundBackObjects || [])
      .concat(currentArea.groundForeObjects || []);

    let hit = null;
    for (const o of lists) {
      if (!o) continue;
      const objId = (o.objectId != null && o.objectId !== '') ? String(o.objectId)
        : ((o.id != null && o.id !== '') ? String(o.id) : null);
      if (!objId || objId !== id) continue;
      if (hit) {
        hit = null;
        break; // ambiguous
      }
      hit = o;
    }

    if (hit) {
      const idx = (typeof hit.sectionIndex === 'number')
        ? hit.sectionIndex
        : getSectionIndexForWorldX(currentAreaName, hit.worldX);
      const sectionKey = getSectionKeyForIndex(currentAreaName, idx);
      if (sectionKey) {
        return `gateOpen:${currentAreaName}:${sectionKey}:${id}`;
      }
    }
  }

  return gateFlagKeyForInstance(id);
}

function getGateIsOpenForObjectInstance(o, def, fallbackInstanceId) {
  const gate = def?.gate || null;
  if (!gate) return false;

  const instanceId = String(o?.instanceId || fallbackInstanceId || '').trim();
  const k = getGateFlagKeyForObject(o, instanceId);
  if (!k) return false;

  const v = getFlag('global', k);
  if (v === true || v === false) return v;

  // Not set yet: initialize from areas.json override, else objects.json defaultOpen, else closed.
  const instOpen = (o && o.startOpen != null) ? !!o.startOpen : null;
  const defOpen = (gate.defaultOpen != null) ? !!gate.defaultOpen : false;
  const initial = (instOpen != null) ? instOpen : defOpen;

  setFlag('global', k, initial);
  return initial;
}

function setGateIsOpenByInstanceId(instanceId, open) {
  const k = resolveGateFlagKeyFromId(instanceId);
  if (!k) return false;
  setFlag('global', k, !!open);
  if (DEBUG_GATES) {
  }
  return true;
}

function toggleGateByInstanceId(instanceId) {
  const k = resolveGateFlagKeyFromId(instanceId);
  if (!k) return false;
  const cur = getFlag('global', k);
  const next = !(cur === true);
  setFlag('global', k, next);
  if (DEBUG_GATES) {
  }
  return true;
}


// ===== Obstacle passability checks =====

function canActorPassBlockerDef(actor, blockerDef) {
  if (!blockerDef) return true;

  // Tag requirement (new)
  const req = blockerDef.requiredTag || blockerDef.requiredKeyTag || blockerDef.tag || null;
  if (req) {
    return actorHasTag(actor, req);
  }

  // Flag conditions (legacy)
  const passConditions = blockerDef.passConditions || blockerDef.pass || [];
  return evalObjectPassConditions(passConditions);
}

function shouldPlayerSeeBlockerAsOpen(blockerDef) {
  if (!blockerDef) return true;

  const req = blockerDef.requiredTag || blockerDef.requiredKeyTag || blockerDef.tag || null;
  if (req) return partyHasTag(req);

  const passConditions = blockerDef.passConditions || blockerDef.pass || [];
  return evalObjectPassConditions(passConditions);
}


function getActiveObjectBlockers() {
  // Returns world-space rects for ALL obstacles (blockers + gates).
  // Per-actor pass logic is handled inside resolveActorVsBlockers.
  if (!currentArea) return [];

  const blockers = [];

  const objectBuckets = [
    { layer: 'back',   list: currentArea.backObjects },
    { layer: 'fore',   list: currentArea.foreObjects },
    { layer: 'gback',  list: currentArea.groundBackObjects },
    { layer: 'gfore',  list: currentArea.groundForeObjects }
  ];

  for (const bucket of objectBuckets) {
    const list = bucket.list;
    if (!Array.isArray(list)) continue;

    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      if (o._spawned === false) continue;

      const raw = String(o.key || o.name || o.filename || '').trim();
      if (!raw) continue;

      const base = raw.replace(/\.[^/.]+$/, '').trim();
      if (!base) continue;

      const def = getObjectDef(base) || null;
      const blockerDef = def?.blocker || null;
      const gateDef = def?.gate || null;

      const instanceId = String(o.instanceId || `${bucket.layer}:${base}:${i}`).trim();

      // --- Gate obstacle ---
      if (gateDef) {
        const rect = gateDef.rect || gateDef;
        if (rect && typeof rect === 'object') {
          const isOpen = getGateIsOpenForObjectInstance(o, def, instanceId);

          // Only block when CLOSED
          if (!isOpen) {
            const bx = (Number(o.worldX) || 0) + (Number(rect.x) || 0);
            const bw = (Number(rect.w) || 0);
            const bh = (Number(rect.h) || WORLD_HEIGHT);

            if (isFinite(bw) && bw > 0) {
              const h = (isFinite(bh) && bh > 0) ? bh : WORLD_HEIGHT;

              // Objects are drawn bottom-aligned to ground; match that for collision.
              const groundBaseY = (Number(groundY) || 0) - 8;
              const by = groundBaseY - h + (Number(rect.y) || 0);

              blockers.push({
                x: bx,
                y: by,
                w: bw,
                h,
                typeId: base,
                instanceId,
                kind: 'gate'
              });
            }
          }
        }
      }

      // --- Blocker obstacle ---
      if (blockerDef) {
        const rect = blockerDef.rect || blockerDef;
        if (!rect || typeof rect !== 'object') continue;

        const bx = (Number(o.worldX) || 0) + (Number(rect.x) || 0);
        const bw = (Number(rect.w) || 0);
        const bh = (Number(rect.h) || WORLD_HEIGHT);

        if (!(isFinite(bw) && bw > 0)) continue;
        const h = (isFinite(bh) && bh > 0) ? bh : WORLD_HEIGHT;

        // Objects are drawn bottom-aligned to ground; match that for collision.
        const groundBaseY = (Number(groundY) || 0) - 8;
        const by = groundBaseY - h + (Number(rect.y) || 0);

        blockers.push({
          x: bx,
          y: by,
          w: bw,
          h,
          typeId: base,
          instanceId,
          kind: 'blocker',
          blockerDef
        });

      }
    }
  }

  return blockers;
}

function _objectInstanceIdForBucket(o, layer, base, index) {
  return String(o?.instanceId || `${layer}:${base}:${index}`).trim();
}

function getActiveObjectPortals() {
  if (!currentArea) return [];

  const portals = [];

  const objectBuckets = [
    { layer: 'back',   list: currentArea.backObjects },
    { layer: 'fore',   list: currentArea.foreObjects },
    { layer: 'gback',  list: currentArea.groundBackObjects },
    { layer: 'gfore',  list: currentArea.groundForeObjects }
  ];

  for (const bucket of objectBuckets) {
    const list = bucket.list;
    if (!Array.isArray(list)) continue;

    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      if (o._spawned === false) continue;

      const portalDef = o.portal || null;
      if (!portalDef) continue;

      const rect = portalDef.rect || portalDef;
      if (!rect || typeof rect !== 'object') continue;

      const raw = String(o.key || o.name || o.filename || '').trim();
      if (!raw) continue;
      const base = raw.replace(/\.[^/.]+$/, '').trim();
      if (!base) continue;

      const bw = (Number(rect.w) || 0);
      const bh = (Number(rect.h) || 0);
      if (!(isFinite(bw) && bw > 0)) continue;
      if (!(isFinite(bh) && bh > 0)) continue;

      const bx = (Number(o.worldX) || 0) + (Number(rect.x) || 0);
      const groundBaseY = (Number(groundY) || 0) - 8;
      const by = groundBaseY - bh + (Number(rect.y) || 0);

      const instanceId = _objectInstanceIdForBucket(o, bucket.layer, base, i);
      const instanceKey = `object:${instanceId}`;
      let sectionName = null;
      if (typeof o.sectionIndex === 'number' && currentArea?.sections?.[o.sectionIndex]) {
        sectionName = currentArea.sections[o.sectionIndex]?.name || null;
      } else {
        sectionName = _sectionNameForWorldXInArea(currentArea, o.worldX);
      }
      const secKey = String(sectionName || 'unknown');
      const idKey = String(o.instanceId || instanceId || `${base}:${i}`);
      const contactKey = `portal:${currentAreaName}:${secKey}:${idKey}`;

      portals.push({
        x: bx,
        y: by,
        w: bw,
        h: bh,
        typeId: base,
        objectId: (o.objectId != null && o.objectId !== '') ? String(o.objectId) : ((o.id != null && o.id !== '') ? String(o.id) : null),
        instanceId,
        instanceKey,
        contactKey,
        portalDef
      });
    }
  }

  return portals;
}

function handlePortalContacts() {
  if (!currentArea) return false;
  if (FADE.active) return false;

  const portals = getActiveObjectPortals();
  if (!portals.length) return false;

  const ax = Number(player.worldX || 0);
  const ay = Number(player.y || 0);
  const aw = Number(player.w || 0);
  const ah = Number(player.h || 0);
  const nowMs = getGameNowMs();

  if (nowMs < portalSuppressUntilMs) {
    for (const p of portals) {
      const key = p.contactKey;
      if (!key) continue;
      const inside = aabbOverlap(ax, ay, aw, ah, p.x, p.y, p.w, p.h);
      const wasInside = portalInside.has(key);
      if (inside) {
        portalInside.add(key);
        portalSuppressInside.add(key);
      } else if (wasInside) {
        portalInside.delete(key);
        if (portalSuppressInside.has(key)) portalSuppressInside.delete(key);
      }
    }
    portalArrivalPending = false;
    return false;
  }

  if (portalArrivalPending) {
    for (const p of portals) {
      const key = p.contactKey;
      if (!key) continue;
      const inside = aabbOverlap(ax, ay, aw, ah, p.x, p.y, p.w, p.h);
      if (inside) {
        portalInside.add(key);
        portalSuppressInside.add(key);
      }
    }
    portalArrivalPending = false;
  }

  for (const p of portals) {
    const key = p.contactKey;
    if (!key) continue;

    const inside = aabbOverlap(ax, ay, aw, ah, p.x, p.y, p.w, p.h);
    const wasInside = portalInside.has(key);

    if (inside && !wasInside) {
      portalInside.add(key);

      if (portalSuppressInside.has(key)) {
        continue;
      }

      const req = p.portalDef?.requiredTag || null;
      if (req && !partyHasTag(req)) continue;

      const dest = resolvePortalTarget(p.portalDef?.target);
      if (!dest || !dest.areaName) continue;

      const prevX = player.worldX;

      emitGameEvent('portal_use', {
        area: currentAreaName,
        section: getSectionNameForX(player.worldX),
        sectionIndex: getSectionIndexForWorldX(currentAreaName, player.worldX),
        target: p.portalDef?.target || null,
        toArea: dest.areaName,
        from: (playerCenterX() < (p.x + p.w * 0.5)) ? 'left' : 'right',
        instanceKey: p.instanceKey,
        objectId: p.objectId || p.instanceId || p.typeId || null,
        requiredTag: req || null
      });

      startAreaTransfer({
        areaName: dest.areaName,
        worldX: dest.worldX,
        spawnEdge: 'left',
        prevX,
        nudgeParty: false,
        skipBuildIfSameArea: true,
        carryParty: false,
        snapPartyToPlayer: true
      });

      portalArrivalPending = true;
      portalSuppressUntilMs = nowMs + PORTAL_ARRIVAL_SUPPRESS_MS;
      return true;
    }

    if (!inside && wasInside) {
      portalInside.delete(key);
      if (portalSuppressInside.has(key)) portalSuppressInside.delete(key);
    }
  }

  return false;
}


function resolveActorVsBlockers(actor, prevX, blockers) {
  if (!actor || !Array.isArray(blockers) || blockers.length === 0) return;

  const ax = Number(actor.worldX) || 0;
  const ay = Number(actor.y) || 0;
  const aw = Number(actor.w) || 0;
  const ah = Number(actor.h) || 0;

  for (const b of blockers) {
    if (!b) continue;

    // Tag-based pass for blocker objects
    if (b.kind === 'blocker' && b.blockerDef) {
      if (canActorPassBlockerDef(actor, b.blockerDef)) continue;
    }

    if (!aabbOverlap(ax, ay, aw, ah, b.x, b.y, b.w, b.h)) continue;

    // Push out based on movement direction
    const movedRight = ax > (Number(prevX) || 0);
    const movedLeft  = ax < (Number(prevX) || 0);

    if (movedRight) {
      actor.worldX = (b.x - aw) - 0.01;
    } else if (movedLeft) {
      actor.worldX = (b.x + b.w) + 0.01;
    } else {
      // No clear direction (eg gate toggled closed while overlapping):
      // For gates, choose side based on actor-center vs gate-center.
      if (b.kind === 'gate') {
        const actorCx = ax + aw * 0.5;
        const gateCx  = b.x + b.w * 0.5;
        actor.worldX = (actorCx < gateCx) ? ((b.x - aw) - 0.01) : ((b.x + b.w) + 0.01);
      } else {
        // Default fallback: push to nearest side
        const toLeft = Math.abs(ax - (b.x - aw));
        const toRight = Math.abs(ax - (b.x + b.w));
        actor.worldX = (toLeft <= toRight) ? ((b.x - aw) - 0.01) : ((b.x + b.w) + 0.01);
      }
    }

    actor.vx = 0;
    return;
  }
}



function getMobHitboxWorldRect(mob) {
  const def = mob?.def || mobDetails?.[lc(mob?.id)] || null;

  const bw = Number(def?.body?.w);
  const bh = Number(def?.body?.h);

  let x = Number(mob?.worldX) || 0;
  let y = Number(mob?.y) || 0;

  // fallback: full body rect
  let w = Number(mob?.w);
  let h = Number(mob?.h);

  if (!(isFinite(w) && w > 0)) w = (isFinite(bw) && bw > 0) ? bw : 1;
  if (!(isFinite(h) && h > 0)) h = (isFinite(bh) && bh > 0) ? bh : 1;

  const hb = def?.body?.hitbox || null;
  if (hb && lc(hb.type) === 'rect') {
    const hx = Number(hb.x);
    const hy = Number(hb.y);
    const hw = Number(hb.w);
    const hh = Number(hb.h);

    if (isFinite(hx)) x += hx;
    if (isFinite(hy)) y += hy;
    if (isFinite(hw) && hw > 0) w = hw;
    if (isFinite(hh) && hh > 0) h = hh;
  }

  return { x, y, w, h };
}



// Single focused interactable object for input
let currentObjectInteract = null; // { typeId: string, instanceKey: string } | null
let currentItemInteract = null; // { itemId: string, instanceKey: string } | null
const activeObjectInteractions = new Map(); // instanceKey -> interaction state
let pendingObjectInteraction = null; // { instanceKey, effects, payload, releaseLock, resetSpec }

const OBJECT_INTERACT_COOLDOWN_MS = 200;
let nextObjectInteractAtMs = 0;

const OBJECT_INTERACT_MOVE_TIMEOUT_MS = 3500;
const OBJECT_INTERACT_MOVE_SPEED_FACTOR = 4;

const objectInteractStateByInstance = new Map(); // instanceKey -> { totalInteractions, interactionsSinceInactive, inactiveUntilMs, resetQueue }

function getObjectInteractState(instanceKey) {
  if (!instanceKey) return null;
  let st = objectInteractStateByInstance.get(instanceKey);
  if (!st) {
    st = {
      totalInteractions: 0,
      interactionsSinceInactive: 0,
      inactiveUntilMs: 0,
      resetQueue: []
    };
    objectInteractStateByInstance.set(instanceKey, st);
  }
  return st;
}

function isObjectInstanceInactive(instanceKey, def, nowMs) {
  if (!instanceKey || !def) return false;
  const inactiveMs = Number(def.inactiveMs || 0);
  if (!isFinite(inactiveMs) || inactiveMs <= 0) return false;
  const st = getObjectInteractState(instanceKey);
  if (!st) return false;
  const until = Number(st.inactiveUntilMs || 0);
  return isFinite(until) && until > nowMs;
}

function __enqueueObjectReset(instanceKey, actions, resetMs, objectId) {
  if (!instanceKey || !Array.isArray(actions) || actions.length === 0) return false;
  const ms = Number(resetMs || 0);
  if (!isFinite(ms) || ms <= 0) return false;
  const st = getObjectInteractState(instanceKey);
  if (!st) return false;
  const nowMs = getGameNowMs();
  st.resetQueue.push({
    atMs: nowMs + ms,
    actions,
    objectId: objectId ? String(objectId) : ''
  });
  return true;
}

function processObjectResetQueues(nowMs) {
  if (!objectInteractStateByInstance.size) return;
  const now = Number(nowMs);
  if (!isFinite(now)) return;

  for (const st of objectInteractStateByInstance.values()) {
    if (!st || !Array.isArray(st.resetQueue) || st.resetQueue.length === 0) continue;

    while (st.resetQueue.length && now >= Number(st.resetQueue[0]?.atMs || 0)) {
      const entry = st.resetQueue.shift();
      const actions = Array.isArray(entry?.actions) ? entry.actions : [];
      if (actions.length) {
        applyEffects(actions, {
          source: 'object_reset',
          objectId: entry?.objectId || null
        });
      }
    }
  }
}

function isActorDrivenByInteractionMove(actor) {
  return !!(actor && actor.__interactionMoveActive);
}

function __getObjectApproachSpec(def) {
  const rawMode = lc(def?.approach?.mode || 'none');
  if (rawMode !== 'range' && rawMode !== 'distance') return { mode: 'none', distance: null };
  const dist = Number(def?.approach?.distance);
  const spd = Number(def?.approach?.speedFactor);
  return {
    mode: rawMode,
    distance: (isFinite(dist) && dist >= 0) ? dist : null,
    speedFactor: (isFinite(spd) && spd > 0) ? spd : null
  };
}

function __clearInteractionMove(actor) {
  if (!actor) return;
  actor.__interactionMoveActive = false;
  actor.__interactionMove = null;
}

function __releaseObjectInteractionLock(instanceKey) {
  if (!instanceKey) return;
  activeObjectInteractions.delete(instanceKey);
}

function __applyObjectInteractionEffects(effects, payload, resetSpec = null) {
  if (!Array.isArray(effects) || effects.length === 0) return;

  const resetMs = Number(resetSpec?.resetMs || 0);
  const doReset = isFinite(resetMs) && resetMs > 0;

  if (doReset) {
    if (!payload || typeof payload !== 'object') payload = {};
    payload.__resetSpec = {
      resetMs,
      objectId: resetSpec?.objectId || null,
      instanceKey: resetSpec?.instanceKey || null
    };
    payload.__resetCapture = { actions: [] };
  }

  applyEffects(effects, payload);

  if (doReset) {
    const actions = Array.isArray(payload?.__resetCapture?.actions)
      ? payload.__resetCapture.actions
      : [];
    if (actions.length) {
      __enqueueObjectReset(
        resetSpec?.instanceKey || payload?.instanceKey || null,
        actions,
        resetMs,
        resetSpec?.objectId || payload?.objectId || null
      );
    }
    if (payload && typeof payload === 'object') {
      delete payload.__resetCapture;
      delete payload.__resetSpec;
    }
  }
}

function __flushPendingObjectInteraction(reason = '') {
  const ctx = pendingObjectInteraction;
  if (!ctx) return false;

  if (Array.isArray(ctx.effects) && ctx.effects.length) {
    __applyObjectInteractionEffects(ctx.effects, ctx.payload, ctx.resetSpec);
  }

  if (ctx.releaseLock && ctx.instanceKey) {
    __releaseObjectInteractionLock(ctx.instanceKey);
  }

  pendingObjectInteraction = null;
  return true;
}

function __cancelObjectInteraction(entry) {
  if (!entry || !entry.instanceKey) return;
  const actor = findActorByName(entry.actorName);
  if (actor) __clearInteractionMove(actor);
  __releaseObjectInteractionLock(entry.instanceKey);
}

function __completeObjectInteraction(entry) {
  if (!entry || !entry.instanceKey) return;
  const actor = findActorByName(entry.actorName);
  if (actor) __clearInteractionMove(actor);

  setFlag('global', 'activeObjectType', entry.objectId);
  setFlag('global', `objectTypeInteractedBefore:${entry.objectId}`, !!entry.wasTypeInteracted);

  emitGameEvent('object_interact', {
    kind: 'object',
    id: entry.objectId,
    instanceKey: entry.instanceKey,
    objectSectionId: entry.objectSectionId || null,
    area: currentAreaName || null,
    section: getSectionNameForX(player.worldX),
    wasTypeInteracted: !!entry.wasTypeInteracted,
    wasInstanceInteracted: !!entry.wasInstanceInteracted,
    interactor: targetActorDescriptorFromActor(actor || player),
    sourceActor: targetActorDescriptorFromActor(actor || player)
  });

  entry.mode = 'none';
  entry._emitted = true;
}

function __beginObjectInteraction(objectIdRaw, instanceKey) {
  const objectId = lc(objectIdRaw);
  if (!objectId || !instanceKey) return false;
  if (activeObjectInteractions.has(instanceKey)) return false;

  const def = getObjectDef(objectId);
  if (!def) return false;
  if (isObjectInstanceInactive(instanceKey, def, getGameNowMs())) return false;

  const hasInteractTags =
    (Array.isArray(def.interact) && def.interact.length) ||
    (Array.isArray(def.interacts) && def.interacts.length) ||
    (Array.isArray(def.interactTags) && def.interactTags.length);

  if (hasInteractTags && !partyCanInteractWithObjectDef(def)) return false;

  const interactor = getFirstInteractorForObjectDef(def);
  if (!interactor) return false;

  const t = proximityTargetByKey.get(instanceKey);
  if (!t || !isFinite(t.worldX)) return false;

  const areaKey = String(currentAreaName || '').trim();
  const instFlagKey = areaKey
    ? `objectInstanceInteracted:${areaKey}:${instanceKey}`
    : `objectInstanceInteracted:${instanceKey}`;

  const wasTypeInteracted = !!getFlag('global', `objectTypeInteracted:${objectId}`);
  const wasInstanceInteracted = !!getFlag('global', instFlagKey);

  const approach = __getObjectApproachSpec(def);
  const stopDist = (approach.mode === 'range')
    ? Number(t.radius || 0)
    : (approach.mode === 'distance' ? Number(approach.distance || 0) : 0);

  let objectSectionId = null;
  if (t && t.objectSectionId) {
    objectSectionId = t.objectSectionId;
  } else {
    const info = _getPlacedObjectByInstanceKeyWithLayer(instanceKey);
    if (info && info.obj) {
      objectSectionId = (info.obj.objectId != null && info.obj.objectId !== '')
        ? String(info.obj.objectId)
        : ((info.obj.id != null && info.obj.id !== '') ? String(info.obj.id) : null);
    }
  }

  const entry = {
    objectId,
    instanceKey,
    actorName: (interactor === player) ? 'player' : String(interactor.name || ''),
    startedAtMs: getGameNowMs(),
    mode: approach.mode,
    targetX: Number(t.worldX),
    stopDist: Math.max(0, Number(stopDist || 0)),
    speedFactor: approach.speedFactor,
    wasTypeInteracted,
    wasInstanceInteracted,
    objectSectionId
  };

  activeObjectInteractions.set(instanceKey, entry);

  if (entry.mode === 'none') {
    __completeObjectInteraction(entry);
    return true;
  }

  const actor = findActorByName(entry.actorName);
  if (!actor) {
    __cancelObjectInteraction(entry);
    return false;
  }

  actor.__interactionMoveActive = true;
  actor.__interactionMove = {
    targetX: entry.targetX,
    stopDist: entry.stopDist,
    startedAtMs: entry.startedAtMs,
    timeoutMs: OBJECT_INTERACT_MOVE_TIMEOUT_MS,
    instanceKey: entry.instanceKey
  };

  return true;
}

function updateInteractionMoves(dt, nowMs, activeObjectBlockers) {
  if (!activeObjectInteractions.size) return;

  for (const entry of activeObjectInteractions.values()) {
    if (!entry || entry.mode === 'none') continue;

    const actor = findActorByName(entry.actorName);
    if (!actor) {
      __cancelObjectInteraction(entry);
      continue;
    }

    if (actor.__forcedMoveActive) {
      continue;
    }

    {
      const until = Number(actor.__stopMoveUntilMs || 0);
      if (isFinite(until) && until > nowMs) {
        actor.vx = 0;
        actor.vy = 0;
        actor.y = groundY - actor.h - (actor === player ? 0 : 8);
        continue;
      }
    }

    const move = actor.__interactionMove;
    if (!move) {
      __cancelObjectInteraction(entry);
      continue;
    }

    const elapsed = nowMs - Number(move.startedAtMs || 0);
    const timeoutMs = Number(move.timeoutMs || 0);
    if (timeoutMs > 0 && isFinite(elapsed) && elapsed > timeoutMs) {
      __cancelObjectInteraction(entry);
      continue;
    }

    const targetWorldX = Number(move.targetX) - (Number(actor.w) * 0.5);
    const dx = targetWorldX - actor.worldX;
    const distToCenter = Math.abs((actor.worldX + actor.w * 0.5) - Number(move.targetX));

    if (distToCenter <= Number(move.stopDist || 0)) {
      __completeObjectInteraction(entry);
      continue;
    }

    const baseSpeed = actor.maxMovementSpeed || 240;
    const factor = Number(entry.speedFactor ?? OBJECT_INTERACT_MOVE_SPEED_FACTOR);
    const spd = baseSpeed * (isFinite(factor) && factor > 0 ? factor : 1);
    const step = Math.sign(dx) * spd * dt;
    const prevX = actor.worldX;

    if (Math.abs(step) >= Math.abs(dx)) {
      actor.worldX = targetWorldX;
      actor.vx = 0;
    } else {
      actor.worldX += step;
      actor.vx = step / dt;
    }

    if (actor.vx !== 0) {
      // Facing resolved centrally after movement updates.
      actor.lastMoveTime = nowMs;
      actor.hasEverMoved = true;
    }

    actor.y = groundY - actor.h - (actor === player ? 0 : 8);

    if (activeObjectBlockers) {
      resolveActorVsBlockers(actor, prevX, activeObjectBlockers);
    }
  }
}


function makeProxTypeKey(t) {
  const kind = lc(t?.kind);
  const id   = lc(t?.id);
  if (!kind || !id) return '';
  return `${kind}:${id}`;
}


// For targets where many instances share a common "rule id" (eg objects by filename),
// we refcount how many instances are currently inside so we only emit enter/leave once.
const proximityTypeCount = new Map(); // key `${kind}:${id}` -> number

function makeProxKey(t) {
  // instanceId is used for internal edge tracking when multiple instances share the same rule id
  const kind = lc(t?.kind);
  const id   = lc(t?.instanceId ?? t?.id);
  if (!kind || !id) return '';
  return `${kind}:${id}`;
}



function playerCenterX() {
  return (player.worldX + player.w * 0.5);
}

function playerDistX(targetWorldX) {
  return Math.abs(playerCenterX() - targetWorldX);
}

function inRadius(targetWorldX, radius) {
  return playerDistX(targetWorldX) < radius;
}



//CHARACTERS
const BASE_CHAR_W = 163;
const BASE_CHAR_H = 300;

// ===== Centralized stat schema =====
const STAT_DEFS = {
  stamina:   { type: 'depletable', label: 'Stamina', shortLabel: 'STA', clampMin: 0, defaultMax: 5, defaultCurrent: 5, appliesTo: ['player', 'npc'] },
  composure: { type: 'depletable', label: 'Composure', shortLabel: 'COM', clampMin: 0, defaultMax: 5, defaultCurrent: 5, appliesTo: ['player', 'npc'] },
  hp:        { type: 'depletable', label: 'HP', shortLabel: 'HP', clampMin: 0, defaultMax: 5, defaultCurrent: 5, appliesTo: ['mob'] },
  endurance: { type: 'scalar', label: 'Endurance', shortLabel: 'END', clampMin: 0, defaultBase: 0, appliesTo: ['player', 'npc', 'mob'] },
  fortitude: { type: 'scalar', label: 'Fortitude', shortLabel: 'FOR', clampMin: 0, defaultBase: 0, appliesTo: ['player', 'npc', 'mob'] },
  alignment: { type: 'variable', label: 'Alignment', shortLabel: 'ALN', clampMin: -10, clampMax: 10, defaultCurrent: 0, appliesTo: ['npc'] },
  affection: { type: 'variable', label: 'Affection', shortLabel: 'AFF', clampMin: -10, clampMax: 10, defaultCurrent: 0, appliesTo: ['npc'] },
  minalignment: { type: 'scalar', label: 'Min Alignment', shortLabel: 'MIN A', clampMin: -10, clampMax: 10, defaultBase: 0, appliesTo: ['npc'] },
  minaffection: { type: 'scalar', label: 'Min Affection', shortLabel: 'MIN F', clampMin: -10, clampMax: 10, defaultBase: 0, appliesTo: ['npc'] }
};

const PLAYER_STAT_ORDER = ['stamina', 'composure', 'endurance', 'fortitude'];
const NPC_STAT_ORDER = ['stamina', 'composure', 'endurance', 'fortitude', 'alignment', 'affection', 'minalignment', 'minaffection'];

function getStatDef(statKey) {
  const k = lc(statKey || '');
  return k ? (STAT_DEFS[k] || null) : null;
}

function getActorKindName(actor) {
  if (!actor) return '';
  if (actor === player) return 'player';
  const kind = getActorKind(actor);
  if (kind === 'mob') return 'mob';
  return 'npc';
}

function statAppliesToActor(statKey, actor) {
  const def = getStatDef(statKey);
  if (!def) return false;
  const kind = getActorKindName(actor);
  return Array.isArray(def.appliesTo) && def.appliesTo.includes(kind);
}

function createStatsForKind(kind) {
  const out = Object.create(null);
  for (const [key, def] of Object.entries(STAT_DEFS)) {
    if (!def || !Array.isArray(def.appliesTo) || !def.appliesTo.includes(kind)) continue;
    if (def.type === 'depletable') {
      out[key] = {
        current: Number(def.defaultCurrent ?? def.defaultMax ?? 0),
        max: Number(def.defaultMax ?? def.defaultCurrent ?? 0),
        mods: []
      };
    } else if (def.type === 'scalar') {
      out[key] = { base: Number(def.defaultBase ?? 0), mods: [] };
    } else if (def.type === 'variable') {
      out[key] = { current: Number(def.defaultCurrent ?? 0), mods: [] };
    }
  }
  return out;
}

function ensureStatsSchemaForKind(statsObj, kind, opts = null) {
  if (!statsObj || typeof statsObj !== 'object') statsObj = Object.create(null);
  const skip = new Set((opts && Array.isArray(opts.skip) ? opts.skip : []).map(k => lc(k)));
  for (const [key, def] of Object.entries(STAT_DEFS)) {
    if (!def || !Array.isArray(def.appliesTo) || !def.appliesTo.includes(kind)) continue;
    if (skip.has(lc(key))) continue;
    if (!statsObj[key] || typeof statsObj[key] !== 'object') {
      if (def.type === 'depletable') {
        statsObj[key] = {
          current: Number(def.defaultCurrent ?? def.defaultMax ?? 0),
          max: Number(def.defaultMax ?? def.defaultCurrent ?? 0),
          mods: []
        };
      } else if (def.type === 'scalar') {
        statsObj[key] = { base: Number(def.defaultBase ?? 0), mods: [] };
      } else if (def.type === 'variable') {
        statsObj[key] = { current: Number(def.defaultCurrent ?? 0), mods: [] };
      }
    } else {
      if (!Array.isArray(statsObj[key].mods)) statsObj[key].mods = [];
      if (def.type === 'depletable') {
        if (statsObj[key].max == null && statsObj[key].base != null) {
          statsObj[key].max = Number(statsObj[key].base ?? 0);
          if (statsObj[key].current == null) statsObj[key].current = Number(statsObj[key].max ?? 0);
          delete statsObj[key].base;
        }
      } else if (def.type === 'scalar') {
        if (statsObj[key].base == null && statsObj[key].current != null) {
          statsObj[key].base = Number(statsObj[key].current ?? 0);
          delete statsObj[key].current;
        }
      }
    }
  }
  return statsObj;
}

function ensureNpcStatsShared(nameOrActor) {
  const name =
    (nameOrActor && typeof nameOrActor === 'object')
      ? String(nameOrActor.name || '')
      : String(nameOrActor || '');
  const rec = ensureNpcRecord(name);
  if (!rec) return null;
  ensureNpcRecordStats(name, rec);
  const live = findActorByName(name);
  if (live && live !== player) {
    live.stats = rec.stats;
  }
  return rec.stats;
}

function ensureActorStatsSchema(actor) {
  if (!actor) return;
  const kind = getActorKindName(actor);
  if (kind === 'npc') {
    ensureNpcStatsShared(actor);
    return;
  }
  actor.stats = ensureStatsSchemaForKind(actor.stats, kind);
}

function getStatModifiers(statRec) {
  if (!statRec || typeof statRec !== 'object') return [];
  if (!Array.isArray(statRec.mods)) statRec.mods = [];
  return statRec.mods;
}

function sumStatModifiers(statRec) {
  const mods = getStatModifiers(statRec);
  let total = 0;
  for (const m of mods) {
    if (!m || typeof m !== 'object') continue;
    const d = Number(m.delta ?? 0);
    if (isFinite(d)) total += d;
  }
  return total;
}

function getStatEffectiveValue(actor, statKey) {
  const def = getStatDef(statKey);
  if (!def || !actor || !actor.stats) return null;
  const rec = actor.stats[lc(statKey)];
  if (!rec) return null;

  if (def.type === 'depletable') {
    const max = Number(rec.max ?? 0);
    return max + sumStatModifiers(rec);
  }
  if (def.type === 'scalar') {
    const base = Number(rec.base ?? 0);
    return base + sumStatModifiers(rec);
  }
  if (def.type === 'variable') {
    const cur = Number(rec.current ?? 0);
    const min = Number(def.clampMin ?? -10);
    const max = Number(def.clampMax ?? 10);
    const clamped = Math.max(min, Math.min(max, cur));
    return clamped + sumStatModifiers(rec);
  }
  return null;
}

function normalizeStatFieldForDef(def, fieldRaw) {
  const f = normStatKey(fieldRaw) || 'current';
  if (!def) return f;
  if (def.type === 'depletable') {
    if (f === 'base') return 'max';
    if (f === 'max' || f === 'current') return f;
    return 'current';
  }
  if (def.type === 'scalar') {
    return 'base';
  }
  if (def.type === 'variable') {
    return 'current';
  }
  return f;
}

function clampScalarValue(def, value) {
  let v = Number(value);
  if (!isFinite(v)) return 0;
  if (def && def.clampMin != null) v = Math.max(Number(def.clampMin), v);
  if (def && def.clampMax != null) v = Math.min(Number(def.clampMax), v);
  return v;
}

function clampVariableValue(def, value) {
  let v = Number(value);
  if (!isFinite(v)) return 0;
  if (def && def.clampMin != null) v = Math.max(Number(def.clampMin), v);
  if (def && def.clampMax != null) v = Math.min(Number(def.clampMax), v);
  return v;
}

function clampDepletableCurrent(def, rec) {
  const min = Number(def?.clampMin ?? 0);
  const maxEff = Number(rec?.max ?? 0) + sumStatModifiers(rec);
  const max = isFinite(maxEff) ? maxEff : Number(rec?.max ?? 0);
  const cur = Number(rec?.current ?? 0);
  const clamped = Math.max(min, Math.min(max, cur));
  rec.current = clamped;
}

function setStatRecField(def, rec, fieldRaw, valueRaw) {
  if (!def || !rec) return null;
  const field = normalizeStatFieldForDef(def, fieldRaw);
  const v = Number(valueRaw);
  if (!isFinite(v)) return null;

  let prev = null;
  if (def.type === 'depletable') {
    prev = (field === 'max') ? Number(rec.max ?? 0) : Number(rec.current ?? 0);
    if (field === 'max') {
      rec.max = Math.max(Number(def.clampMin ?? 0), v);
      clampDepletableCurrent(def, rec);
    } else {
      rec.current = v;
      clampDepletableCurrent(def, rec);
    }
  } else if (def.type === 'scalar') {
    prev = Number(rec.base ?? 0);
    rec.base = clampScalarValue(def, v);
  } else if (def.type === 'variable') {
    prev = Number(rec.current ?? 0);
    rec.current = clampVariableValue(def, v);
  } else {
    prev = Number(rec.current ?? 0);
    rec.current = v;
  }

  const next = (def.type === 'depletable')
    ? (field === 'max' ? Number(rec.max ?? 0) : Number(rec.current ?? 0))
    : (def.type === 'scalar' ? Number(rec.base ?? 0) : Number(rec.current ?? 0));

  return { field, prev, next };
}

function getStatRecFieldValue(def, rec, fieldRaw) {
  if (!def || !rec) return null;
  const field = normalizeStatFieldForDef(def, fieldRaw);
  if (def.type === 'depletable') {
    return (field === 'max') ? Number(rec.max ?? 0) : Number(rec.current ?? 0);
  }
  if (def.type === 'scalar') {
    return Number(rec.base ?? 0);
  }
  if (def.type === 'variable') {
    return Number(rec.current ?? 0);
  }
  return Number(rec.current ?? 0);
}

function normStatKey(k) {
  return String(k || '').trim().toLowerCase();
}

function ensurePlayerStats() {
  player.stats = ensureStatsSchemaForKind(player.stats, 'player');
}

// ===== Items / Inventory =====
// player.inventory shape:
//   { [itemIdLower]: { count: number, usesLeft: number|null } }
//
// usesLeft is a "current stack" counter for items that have usesPerItem > 1.
// When usesLeft hits 0, we decrement count and reset usesLeft for the next item.

let itemsData = null; // loaded from data/items.json (wire-up added later)

let objectsData = null; // loaded from data/objects.json

function getObjectDef(objectId) {
  const id = lc(objectId);
  if (!id || !objectsData) return null;

  // Support either { objects: { id: def } } OR { id: def }
  const root = (objectsData.objects && typeof objectsData.objects === 'object') ? objectsData.objects : objectsData;
  return root && typeof root === 'object' ? (root[id] || root[objectId] || null) : null;
}

function canUseItemOnObject(itemId, objectId) {
  const def = getObjectDef(objectId);
  if (!def) return false;
  const list = Array.isArray(def.itemUse) ? def.itemUse : [];
  if (list.length === 0) return false;
  const want = lc(itemId);
  return list.some(x => lc(String(x || '')) === want);
}

function getActorInteractTags(actorOrName) {
  let name =
    (typeof actorOrName === 'string' ? actorOrName
    : actorOrName?.name) || 'player';
  const isPlayer =
    actorOrName === player
    || lc(String(name)) === 'player'
    || lc(String(name)) === lc(player?.name || '');
  if (isPlayer) name = 'Player';
  const key = lc(name);
  const def =
    (npcDetailsByLc ? npcDetailsByLc[key] : null)
    || (npcDetails ? npcDetails[name] : null);
  const raw = def?.interacts || def?.interactTags || def?.interact || null;
  if (!Array.isArray(raw)) return [];
  return raw.map(x => lc(x)).filter(Boolean);
}

function partyHasInteractTag(tag) {
  const want = lc(tag);
  if (!want) return false;

  // Player alone should still be able to interact if Player has the tag.
  const pTags = getActorInteractTags(player);
  if (pTags.includes(want)) return true;

  for (const p of (party || [])) {
    const nm = p?.name;
    if (!nm) continue;
    const tags = getActorInteractTags(nm);
    if (tags.includes(want)) return true;
  }
  return false;
}


function partyCanInteractWithObjectDef(objDef) {
  if (!objDef || typeof objDef !== 'object') return false;
  const tags = Array.isArray(objDef.interact) ? objDef.interact
             : Array.isArray(objDef.interacts) ? objDef.interacts
             : Array.isArray(objDef.interactTags) ? objDef.interactTags
             : null;
  if (!tags || tags.length === 0) return false;

  for (const t of tags) {
    if (partyHasInteractTag(t)) return true;
  }
  return false;
}

function getFirstInteractorForObjectDef(objDef) {
  if (!objDef || typeof objDef !== 'object') return null;
  const tags = Array.isArray(objDef.interact) ? objDef.interact
             : Array.isArray(objDef.interacts) ? objDef.interacts
             : Array.isArray(objDef.interactTags) ? objDef.interactTags
             : null;
  const needTags = Array.isArray(tags) ? tags.map(t => lc(t)).filter(Boolean) : [];

  // If no tags are defined, default to player.
  if (needTags.length === 0) return player || null;

  const pTags = getActorInteractTags(player);
  if (needTags.some(t => pTags.includes(t))) return player || null;

  for (const p of (party || [])) {
    const nm = p?.name;
    if (!nm) continue;
    const tagsHere = getActorInteractTags(nm);
    if (needTags.some(t => tagsHere.includes(t))) return p;
  }
  return null;
}

function getItemDef(itemId) {
  const id = lc(itemId);
  if (!id || !itemsData) return null;

  // Support either { items: { id: def } } OR { id: def }
  const root = itemsData.items && typeof itemsData.items === 'object' ? itemsData.items : itemsData;
  return root && typeof root === 'object' ? (root[id] || root[itemId] || null) : null;
}

function getItemUsesPerItem(def) {
  const v = Number(def?.usesPerItem);
  if (!isFinite(v) || v <= 0) return 0; // 0 => unlimited
  return Math.floor(v);
}

function getItemGrants(def) {
  if (!def || typeof def !== 'object') return [];
  return Array.isArray(def.grants) ? def.grants.filter(g => g && typeof g === 'object') : [];
}

function getActorNameKey(actor) {
  if (!actor) return '';
  if (actor === player || lc(actor?.name) === 'player' || lc(actor?.name) === lc(player?.name || '')) return 'player';
  return lc(actor?.name || '');
}

function actorHasFaction(actor, factionKey) {
  const key = lc(factionKey || '');
  if (!key) return false;
  const factions = getActorFactions(actor);
  return factions.includes(key);
}

function isActorEligibleForAbility(actor, abilityDef, eligibleOverride = null) {
  if (!actor || !abilityDef) return false;
  const eligible = (eligibleOverride && typeof eligibleOverride === 'object')
    ? eligibleOverride
    : (abilityDef.eligible && typeof abilityDef.eligible === 'object' ? abilityDef.eligible : null);
  if (!eligible) return true;

  if (Array.isArray(eligible.names) && eligible.names.length) {
    const nameKey = getActorNameKey(actor);
    const allow = eligible.names.map(x => lc(String(x || ''))).filter(Boolean);
    if (!allow.includes(nameKey)) return false;
  }

  if (Array.isArray(eligible.tags) && eligible.tags.length) {
    const hasTag = eligible.tags.some(t => actorHasTag(actor, t));
    if (!hasTag) return false;
  }

  if (Array.isArray(eligible.factions) && eligible.factions.length) {
    const hasFac = eligible.factions.some(f => actorHasFaction(actor, f));
    if (!hasFac) return false;
  }

  return true;
}

function ensureActorLearnedAbilities(actor) {
  if (!actor) return [];
  if (actor === player) {
    if (!Array.isArray(player.learnedAbilities)) player.learnedAbilities = [];
    return player.learnedAbilities;
  }
  const rec = ensureNpcRecord(actor.name);
  if (!Array.isArray(rec.learnedAbilities)) rec.learnedAbilities = [];
  actor.learnedAbilities = rec.learnedAbilities;
  return actor.learnedAbilities;
}

function ensureActorItemGrantProgress(actor) {
  if (!actor) return null;
  if (actor === player) {
    if (!player.itemGrantProgress || typeof player.itemGrantProgress !== 'object') {
      player.itemGrantProgress = Object.create(null);
    }
    return player.itemGrantProgress;
  }
  const rec = ensureNpcRecord(actor.name);
  if (!rec.itemGrantProgress || typeof rec.itemGrantProgress !== 'object') {
    rec.itemGrantProgress = Object.create(null);
  }
  actor.itemGrantProgress = rec.itemGrantProgress;
  return actor.itemGrantProgress;
}

function learnAbilityForActor(actor, abilityId) {
  const id = lc(abilityId || '');
  if (!actor || !id) return false;
  const learned = ensureActorLearnedAbilities(actor);
  if (learned.some(a => lc(String(a || '')) === id)) return false;
  learned.push(id);
  rebuildActorAbilities(actor);
  return true;
}

function rebuildActorAbilities(actor) {
  if (!actor) return;
  const innate = Array.isArray(actor.innateAbilities) ? actor.innateAbilities : [];
  const learnedIds = Array.isArray(actor.learnedAbilities) ? actor.learnedAbilities : [];
  const learned = resolveAbilityList(learnedIds);
  const held = Array.isArray(actor.heldAbilities) ? actor.heldAbilities : [];

  actor.abilities = mergeAbilityLists([innate, learned, held]);

  const curAuto = lc(actor.autoCastAbilityId || '');
  if (curAuto && !actor.abilities.some(a => lc(a?.id || '') === curAuto)) {
    actor.autoCastAbilityId = null;
  }
}

function actorHasItem(actor, itemId) {
  const bucket = getActorInvBucket(actor, itemId);
  return !!(bucket && Array.isArray(bucket.instances) && bucket.instances.length > 0);
}

function getItemGrantKey(itemId, abilityId) {
  const i = lc(itemId || '');
  const a = lc(abilityId || '');
  return (i && a) ? `${i}|${a}` : '';
}

function clearActorItemStatMods(actor) {
  if (!actor || !actor.stats || typeof actor.stats !== 'object') return;
  for (const rec of Object.values(actor.stats)) {
    if (!rec || !Array.isArray(rec.mods)) continue;
    rec.mods = rec.mods.filter(m => !(m && m.source === 'item'));
  }
}

function addActorItemStatMod(actor, statKey, delta, itemId, grantId) {
  if (!actor) return;
  const k = lc(statKey || '');
  if (!k) return;
  const def = getStatDef(k);
  if (!def || !statAppliesToActor(k, actor)) return;
  const rec = actor.stats?.[k];
  if (!rec) return;
  if (!Array.isArray(rec.mods)) rec.mods = [];
  const d = Number(delta);
  if (!isFinite(d) || d === 0) return;
  rec.mods.push({
    delta: d,
    source: 'item',
    itemId: lc(itemId || ''),
    grant: grantId || null
  });
}

let __timedStatModId = 0;

function addTimedStatModForActor(actor, statKey, delta, durationMs) {
  if (!actor) return false;
  const k = lc(statKey || '');
  if (!k) return false;
  const def = getStatDef(k);
  if (!def || !statAppliesToActor(k, actor)) return false;
  const rec = actor.stats?.[k];
  if (!rec) return false;
  if (!Array.isArray(rec.mods)) rec.mods = [];
  const d = Number(delta);
  if (!isFinite(d) || d === 0) return false;
  const id = `timed:${++__timedStatModId}`;
  rec.mods.push({ id, delta: d, source: 'timed' });
  if (durationMs > 0) {
    const expiresAtMs = getGameNowMs() + durationMs;
    scheduleTimedEffect(expiresAtMs, () => {
      if (!actor || !actor.stats || !actor.stats[k] || !Array.isArray(actor.stats[k].mods)) return;
      actor.stats[k].mods = actor.stats[k].mods.filter(m => m?.id !== id);
    });
  }
  return true;
}

function rebuildActorItemGrants(actor) {
  if (!actor) return;
  if (isMobActor(actor)) return;
  if (!itemsData) {
    rebuildActorAbilities(actor);
    return;
  }

  ensureActorStatsSchema(actor);
  clearActorItemStatMods(actor);

  const heldAbilities = [];
  const heldGrantMap = new Map(); // abilityId -> [{ itemId, grant }]
  const features = new Set();
  const inv = ensureActorInventory(actor);
  const grantProgress = ensureActorItemGrantProgress(actor);

  for (const [itemId, bucket] of Object.entries(inv || {})) {
    if (!bucket || !Array.isArray(bucket.instances) || bucket.instances.length === 0) continue;
    const def = getItemDef(itemId);
    if (!def) continue;

    const grants = getItemGrants(def);
    if (!grants.length) continue;

    for (let i = 0; i < grants.length; i++) {
      const g = grants[i];
      const kind = lc(g.kind || 'ability');
      const mode = lc(g.mode || 'hold_use');
      const id = lc(g.id || g.ability || '');
      if (!id && kind === 'ability') continue;

      if (kind === 'feature') {
        if (mode !== 'hold_use') continue;
        const ok = isActorEligibleForAbility(actor, { eligible: g.eligible || null }, g.eligible || null);
        if (ok) features.add(id);
        continue;
      }

      if (kind === 'statmod' || kind === 'stat') {
        if (mode && mode !== 'hold_use') continue;
        const ok = isActorEligibleForAbility(actor, { eligible: g.eligible || null }, g.eligible || null);
        if (!ok) continue;
        addActorItemStatMod(actor, g.stat, g.delta, itemId, g.id || i);
        continue;
      }

      if (kind !== 'ability') continue;

      if (mode === 'hold_use' || mode === 'hold_then_retain') {
        const base = getAbilityDefById(id);
        if (!base) continue;
        if (!isActorEligibleForAbility(actor, base, g.eligible || null)) continue;

        const learned = Array.isArray(actor.learnedAbilities) ? actor.learnedAbilities : [];
        if (mode === 'hold_then_retain' && learned.some(a => lc(String(a || '')) === id)) {
          continue; // already retained
        }

        const entry = (g.abilityOverrides && typeof g.abilityOverrides === 'object')
          ? { id, ...g.abilityOverrides }
          : id;
        const resolved = resolveAbilityEntry(entry);
        if (resolved) heldAbilities.push(resolved);

        if (!heldGrantMap.has(id)) heldGrantMap.set(id, []);
        heldGrantMap.get(id).push({ itemId: lc(itemId), grant: g });

        // ensure progress record exists when needed
        if (mode === 'hold_then_retain') {
          const key = getItemGrantKey(itemId, id);
          if (key && !grantProgress[key]) grantProgress[key] = { uses: 0, timeHeldMs: 0 };
        }
      }
    }
  }

  actor.heldAbilities = heldAbilities;
  actor.itemGrantedFeatures = features;
  actor.__heldAbilityGrants = heldGrantMap;

  rebuildActorAbilities(actor);
}

function applyItemGrantsOnUse(sourceActor, targetActor, itemId, itemDef) {
  const def = itemDef || getItemDef(itemId);
  if (!def) return;
  const grants = getItemGrants(def);
  if (!grants.length) return;

  for (const g of grants) {
    const kind = lc(g.kind || 'ability');
    const mode = lc(g.mode || '');
    if (kind !== 'ability' || mode !== 'use_to_learn') continue;
    const id = lc(g.id || g.ability || '');
    if (!id) continue;
    const base = getAbilityDefById(id);
    if (!base) continue;
    if (!isActorEligibleForAbility(targetActor, base, g.eligible || null)) continue;
    learnAbilityForActor(targetActor, id);
  }
}

function noteAbilityUseForActor(actor, abilityId) {
  if (!actor || !abilityId) return;
  const id = lc(abilityId);
  if (!id || !actor.__heldAbilityGrants || !actor.__heldAbilityGrants.has(id)) return;
  const grants = actor.__heldAbilityGrants.get(id) || [];
  const progress = ensureActorItemGrantProgress(actor);
  let learnedAny = false;

  for (const info of grants) {
    const g = info.grant || {};
    const mode = lc(g.mode || '');
    if (mode !== 'hold_then_retain') continue;
    const retain = (g.retain && typeof g.retain === 'object') ? g.retain : Object.create(null);
    const needUses = Number(retain.uses || 0);
    if (!isFinite(needUses) || needUses <= 0) continue;
    const key = getItemGrantKey(info.itemId, id);
    if (!key) continue;
    if (!progress[key]) progress[key] = { uses: 0, timeHeldMs: 0 };
    progress[key].uses = Math.max(0, Number(progress[key].uses || 0) + 1);
    if (progress[key].uses >= needUses) {
      if (learnAbilityForActor(actor, id)) learnedAny = true;
    }
  }

  if (learnedAny) rebuildActorItemGrants(actor);
}

function updateItemGrantHoldProgress(dtReal) {
  const dtMs = Math.max(0, Number(dtReal || 0) * 1000);
  if (!isFinite(dtMs) || dtMs <= 0) return;

  const actors = [player, ...(Array.isArray(party) ? party : []), ...(Array.isArray(npcs) ? npcs : [])];
  for (const actor of actors) {
    if (!actor || !actor.__heldAbilityGrants) continue;
    const progress = ensureActorItemGrantProgress(actor);
    let learnedAny = false;

    for (const [abilityId, grants] of actor.__heldAbilityGrants.entries()) {
      for (const info of grants) {
        const g = info.grant || {};
        const mode = lc(g.mode || '');
        if (mode !== 'hold_then_retain') continue;
        const retain = (g.retain && typeof g.retain === 'object') ? g.retain : Object.create(null);
        const key = getItemGrantKey(info.itemId, abilityId);
        if (!key) continue;
        if (!progress[key]) progress[key] = { uses: 0, timeHeldMs: 0 };

        if (retain.timeHeldMs != null) {
          const want = Math.max(0, Number(retain.timeHeldMs));
          if (isFinite(want) && want > 0) {
            progress[key].timeHeldMs = Math.max(0, Number(progress[key].timeHeldMs || 0) + dtMs);
          }
        }

        const usesNeed = Number(retain.uses || 0);
        const heldEnough = (retain.timeHeldMs != null)
          ? (Number(progress[key].timeHeldMs || 0) >= Number(retain.timeHeldMs))
          : false;
        const usedEnough = (usesNeed > 0) ? (Number(progress[key].uses || 0) >= usesNeed) : false;

        if ((usesNeed > 0 && usedEnough) || (retain.timeHeldMs != null && heldEnough)) {
          if (learnAbilityForActor(actor, abilityId)) learnedAny = true;
        }
      }
    }

    if (learnedAny) rebuildActorItemGrants(actor);
  }
}

function ensurePlayerInventory() {
  if (!player.inventory || typeof player.inventory !== 'object') {
    player.inventory = Object.create(null);
  }
  if (!isFinite(player.inventoryUidCounter)) player.inventoryUidCounter = 1;
  return player.inventory;
}

function nextInventoryUid() {
  if (!isFinite(player.inventoryUidCounter)) player.inventoryUidCounter = 1;
  const uid = Math.floor(player.inventoryUidCounter);
  player.inventoryUidCounter = uid + 1;
  return String(uid);
}

function getActorInventorySize(actor) {
  if (!actor) return 0;
  if (actor === player) {
    const v = Number(player.inventorySize);
    return isFinite(v) ? Math.max(0, Math.floor(v)) : Infinity;
  }
  const name = actor?.name;
  const details =
    (npcDetails && name && npcDetails[name]) ? npcDetails[name]
    : (npcDetailsByLc && name && npcDetailsByLc[lc(name)]) ? npcDetailsByLc[lc(name)]
    : null;
  const raw = (details?.inventorySize != null) ? details.inventorySize : (actor.inventorySize ?? 0);
  const n = Number(raw);
  return isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function ensureActorInventory(actor) {
  if (!actor) return null;
  if (actor === player) return ensurePlayerInventory();

  const rec = ensureNpcRecord(actor.name);
  if (!rec.inventory || typeof rec.inventory !== 'object') {
    rec.inventory = Object.create(null);
  }
  if (!isFinite(rec.inventoryUidCounter)) rec.inventoryUidCounter = 1;

  actor.inventory = rec.inventory;
  actor.inventoryUidCounter = rec.inventoryUidCounter;
  return actor.inventory;
}

function nextActorInventoryUid(actor) {
  if (actor === player) return nextInventoryUid();
  const rec = ensureNpcRecord(actor?.name);
  if (!isFinite(rec.inventoryUidCounter)) rec.inventoryUidCounter = 1;
  const uid = Math.floor(rec.inventoryUidCounter);
  rec.inventoryUidCounter = uid + 1;
  if (actor) actor.inventoryUidCounter = rec.inventoryUidCounter;
  return String(uid);
}

function getActorInvBucket(actor, itemId) {
  const inv = ensureActorInventory(actor);
  const id = lc(itemId);
  if (!id || !inv) return null;

  // Bucket schema:
  //   inv[id] = { instances: [ { uid: '...', usesLeft: number|null } ] }
  // Back-compat: if older saves used { count, usesLeft }, migrate on the fly.
  if (!inv[id]) inv[id] = { instances: [] };

  const bucket = inv[id];

  // Migrate legacy format
  if (!Array.isArray(bucket.instances) && (bucket.count != null || bucket.usesLeft != null)) {
    const def = getItemDef(id);
    const usesPerItem = getItemUsesPerItem(def);

    const count = Math.max(0, Math.floor(Number(bucket.count ?? 0)));
    const legacyUsesLeft = Number(bucket.usesLeft);

    bucket.instances = [];
    for (let i = 0; i < count; i++) {
      let usesLeft = null;
      if (usesPerItem > 1) {
        if (i == 0 && isFinite(legacyUsesLeft)) usesLeft = Math.max(0, Math.floor(legacyUsesLeft));
        else usesLeft = usesPerItem;
      }
      bucket.instances.push({ uid: nextInventoryUid(), usesLeft });
    }

    delete bucket.count;
    delete bucket.usesLeft;
  }

  if (!Array.isArray(bucket.instances)) bucket.instances = [];

  return bucket;
}

function getInvBucket(itemId) {
  return getActorInvBucket(player, itemId);
}

function getActorInventoryCount(actor) {
  const inv = ensureActorInventory(actor);
  if (!inv) return 0;
  let count = 0;
  for (const bucket of Object.values(inv)) {
    if (!bucket || !Array.isArray(bucket.instances)) continue;
    count += bucket.instances.length;
  }
  return count;
}

function addItemToActorInventory(actor, itemId, qtyRaw = 1, outUids = null) {
  const id = lc(itemId);
  const qty = Math.max(0, Math.floor(Number(qtyRaw)));
  if (!id || !isFinite(qty) || qty <= 0) return false;

  const def = getItemDef(id);
  const usesPerItem = getItemUsesPerItem(def);

  const bucket = getActorInvBucket(actor, id);
  if (!bucket) return false;

  const prevCount = bucket.instances.length;

  for (let i = 0; i < qty; i++) {
    const uid = nextActorInventoryUid(actor);
    bucket.instances.push({
      uid,
      usesLeft: usesPerItem > 1 ? usesPerItem : null
    });
    if (outUids && Array.isArray(outUids)) outUids.push(String(uid));
  }

  const changed = bucket.instances.length !== prevCount;
  if (changed) {
    const actorName = (actor === player) ? 'Player' : actor?.name;
    if (actorName) emitGameEvent('inventory_change', { item: id, actor: actorName });
    spawnFoundItemFeedback(id, qty, actor);
  }
  return changed;
}

function addItemInstanceToActor(actor, itemId, inst) {
  const id = lc(itemId);
  if (!id || !actor) return false;

  const def = getItemDef(id);
  const usesPerItem = getItemUsesPerItem(def);
  const bucket = getActorInvBucket(actor, id);
  if (!bucket) return false;

  const usesLeftRaw = inst?.usesLeft;
  const usesLeft = (usesPerItem > 1)
    ? (isFinite(usesLeftRaw) ? Math.max(0, Math.floor(usesLeftRaw)) : usesPerItem)
    : null;

  const uid = String(inst?.uid ?? nextActorInventoryUid(actor));
  bucket.instances.push({ uid, usesLeft });
  const actorName = (actor === player) ? 'Player' : actor?.name;
  if (actorName) emitGameEvent('inventory_change', { item: id, actor: actorName });
  return true;
}

function removeItemFromActorInventory(actor, itemId, qtyRaw = 1) {
  const id = lc(itemId);
  const qty = Math.max(0, Math.floor(Number(qtyRaw)));
  if (!id || !isFinite(qty) || qty <= 0) return false;

  const inv = ensureActorInventory(actor);
  const bucket = getActorInvBucket(actor, id);
  if (!bucket) return false;

  const prevCount = bucket.instances.length;

  for (let i = 0; i < qty; i++) {
    if (bucket.instances.length <= 0) break;
    bucket.instances.pop();
  }

  if (bucket.instances.length <= 0) {
    delete inv[id];
  }

  const changed = bucket.instances.length !== prevCount;
  if (changed) {
    const actorName = (actor === player) ? 'Player' : actor?.name;
    if (actorName) emitGameEvent('inventory_change', { item: id, actor: actorName });
  }
  return changed;
}

function removeItemInstanceFromActorInventory(actor, itemId, uid) {
  const id = lc(itemId);
  const wantUid = String(uid || '');
  if (!id || !wantUid) return false;

  const inv = ensureActorInventory(actor);
  const bucket = getActorInvBucket(actor, id);
  if (!bucket || !Array.isArray(bucket.instances)) return false;

  const idx = bucket.instances.findIndex(inst => String(inst?.uid) === wantUid);
  if (idx < 0) return false;

  bucket.instances.splice(idx, 1);
  if (bucket.instances.length <= 0) delete inv[id];

  const actorName = (actor === player) ? 'Player' : actor?.name;
  if (actorName) emitGameEvent('inventory_change', { item: id, actor: actorName });
  return true;
}


function addItemToInventory(itemId, qtyRaw = 1, outUids = null) {
  addItemToActorInventory(player, itemId, qtyRaw, outUids);
}

function removeItemFromInventory(itemId, qtyRaw = 1) {
  removeItemFromActorInventory(player, itemId, qtyRaw);
}


let __lastItemUseError = '';

function __snapshotActorStats(actor) {
  if (!actor || typeof actor !== 'object') return null;
  return JSON.parse(JSON.stringify(actor.stats || {}));
}

function __restoreActorStats(actor, snapshot) {
  if (!actor || snapshot == null) return;
  actor.stats = snapshot;
}

function wouldEffectsChangeAnything(effects, targetActor = null) {
  __lastItemUseError = '';

  if (!Array.isArray(effects) || effects.length === 0) {
    __lastItemUseError = 'That item has no effect.';
    return false;
  }

  if (effects.some(eff => eff && lc(eff.type || '') === 'openmap')) {
    return true;
  }

  const tgt = targetActor || player;

  // Snapshot only what we need for item effects (stats; plus inventory if target is player)
  if (tgt === player) {
    ensurePlayerStats();
    ensurePlayerInventory();
  }

  const statsBefore = __snapshotActorStats(tgt);
  const invBefore = (tgt === player) ? JSON.parse(JSON.stringify(player.inventory || {})) : null;

  // Apply effects to real state, then compare, then revert.
  if (tgt === player) {
    applyPlayerEffects(effects, { source: 'item' }, tgt);
  } else {
    const payload = {
      ...playerPayloadBase(tgt),
      sourceActor: targetActorDescriptorFromActor(player),
      targetActor: targetActorDescriptorFromActor(tgt),
      source: 'item'
    };
    applyRuleEffects({ effects }, payload);
  }

  const statsAfter = __snapshotActorStats(tgt);
  const invAfter = (tgt === player) ? JSON.parse(JSON.stringify(player.inventory || {})) : null;

  // Revert
  __restoreActorStats(tgt, statsBefore);
  if (tgt === player) player.inventory = invBefore;

  const changed =
    JSON.stringify(statsBefore) !== JSON.stringify(statsAfter) ||
    (tgt === player && JSON.stringify(invBefore) !== JSON.stringify(invAfter));

  if (!changed) {
    __lastItemUseError = 'No effect (already full / nothing to change).';
  }
  return changed;
}


function canUseItem(itemId, itemUid = null) {
  const id = lc(itemId);
  if (!id) return false;

  const bucket = getInvBucket(id);
  if (!bucket || !Array.isArray(bucket.instances) || bucket.instances.length <= 0) return false;

  if (itemUid == null) return true;
  const uidStr = String(itemUid);
  return bucket.instances.some((inst) => String(inst?.uid) === uidStr);
}

function canUseActorItem(actor, itemId, itemUid = null) {
  if (!actor) return false;
  if (actor === player) return canUseItem(itemId, itemUid);
  const id = lc(itemId);
  if (!id) return false;
  const bucket = getActorInvBucket(actor, id);
  if (!bucket || !Array.isArray(bucket.instances) || bucket.instances.length <= 0) return false;
  if (itemUid == null) return true;
  const uidStr = String(itemUid);
  return bucket.instances.some((inst) => String(inst?.uid) === uidStr);
}

function consumeItemInstance(itemId, itemUid = null) {
  const id = lc(itemId);
  const def = getItemDef(id);
  if (!def) return false;

  const usesPerItem = getItemUsesPerItem(def);
  if (usesPerItem === 0) return true;

  // IMPORTANT: wouldEffectsChangeAnything() swaps player.inventory during its snapshot/revert.
  // So we must re-grab the bucket AFTER that call (and after applying effects).
  const inv = ensurePlayerInventory();
  const bucket = getInvBucket(id);
  if (!bucket) return false;

  const uidStr = itemUid != null ? String(itemUid) : null;
  let idx = -1;

  if (uidStr == null) {
    idx = bucket.instances.length > 0 ? 0 : -1;
  } else {
    idx = bucket.instances.findIndex((inst) => String(inst?.uid) === uidStr);
  }

  if (idx < 0 || idx >= bucket.instances.length) {
    __lastItemUseError = 'That item instance is no longer available.';
    return false;
  }

  const inst = bucket.instances[idx];
  const prevCount = bucket.instances.length;
  const prevUses = inst?.usesLeft ?? null;

  if (usesPerItem <= 1) {
    bucket.instances.splice(idx, 1);
    if (bucket.instances.length <= 0) delete inv[id];
    emitGameEvent('inventory_change', { item: id });
    return true;
  }

  if (inst.usesLeft == null || !isFinite(inst.usesLeft)) inst.usesLeft = usesPerItem;
  inst.usesLeft = Math.max(0, Math.floor(inst.usesLeft) - 1);

  if (inst.usesLeft <= 0) {
    bucket.instances.splice(idx, 1);
    if (bucket.instances.length <= 0) delete inv[id];
  }

  const nowCount = bucket?.instances?.length ?? 0;
  const nowUses = (idx >= 0 && idx < (bucket.instances?.length ?? 0)) ? (bucket.instances[idx]?.usesLeft ?? null) : null;

  if (nowCount != prevCount || nowUses !== prevUses) {
    emitGameEvent('inventory_change', { item: id });
  }

  return true;
}

function consumeActorItemInstance(actor, itemId, itemUid = null) {
  if (!actor) return false;
  if (actor === player) return consumeItemInstance(itemId, itemUid);

  const id = lc(itemId);
  const def = getItemDef(id);
  if (!def) return false;

  const usesPerItem = getItemUsesPerItem(def);
  if (usesPerItem === 0) return true;
  const inv = ensureActorInventory(actor);
  const bucket = getActorInvBucket(actor, id);
  if (!bucket) return false;

  const uidStr = itemUid != null ? String(itemUid) : null;
  let idx = -1;
  if (uidStr == null) {
    idx = bucket.instances.length > 0 ? 0 : -1;
  } else {
    idx = bucket.instances.findIndex((inst) => String(inst?.uid) === uidStr);
  }
  if (idx < 0 || idx >= bucket.instances.length) {
    __lastItemUseError = 'That item instance is no longer available.';
    return false;
  }

  const inst = bucket.instances[idx];
  const prevCount = bucket.instances.length;
  const prevUses = inst?.usesLeft ?? null;

  if (usesPerItem <= 1) {
    bucket.instances.splice(idx, 1);
    if (bucket.instances.length <= 0) delete inv[id];
    return true;
  }

  const usesLeft = (prevUses == null) ? usesPerItem : Math.max(0, Math.floor(prevUses));
  if (usesLeft <= 1) {
    bucket.instances.splice(idx, 1);
    if (bucket.instances.length <= 0) delete inv[id];
    return true;
  }

  inst.usesLeft = usesLeft - 1;
  return (bucket.instances.length !== prevCount) || (inst.usesLeft !== prevUses);
}

function useItemOnce(itemId, itemUid = null, targetActor = null) {
  const id = lc(itemId);
  if (!canUseItem(id, itemUid)) {
    __lastItemUseError = 'You do not have that item.';
    return false;
  }

  const def = getItemDef(id);
  if (!def) {
    __lastItemUseError = 'Unknown item.';
    return false;
  }

  const tgt = targetActor || player;
  if (!wouldEffectsChangeAnything(def.effects, tgt)) {
    return false;
  }

  if (Array.isArray(def.effects)) {
    if (tgt === player) {
      applyPlayerEffects(def.effects, { source: 'item', item: id }, tgt);
    } else {
      const payload = {
        ...playerPayloadBase(tgt),
        sourceActor: targetActorDescriptorFromActor(player),
        targetActor: targetActorDescriptorFromActor(tgt),
        source: 'item',
        item: id
      };
      applyRuleEffects({ effects: def.effects }, payload);
    }
  }

  const consumed = consumeItemInstance(id, itemUid);
  if (consumed) {
    applyItemGrantsOnUse(player, tgt, id, def);
    emitGameEvent('item_use', {
      item: id,
      sourceActor: targetActorDescriptorFromActor(player),
      targetActor: targetActorDescriptorFromActor(tgt)
    });
  }
  return consumed;
}

function useActorItemOnce(actor, itemId, itemUid = null, targetActor = null) {
  if (!actor) return false;
  if (actor === player) return useItemOnce(itemId, itemUid, targetActor);

  const id = lc(itemId);
  if (!canUseActorItem(actor, id, itemUid)) {
    __lastItemUseError = 'You do not have that item.';
    return false;
  }

  const def = getItemDef(id);
  if (!def) {
    __lastItemUseError = 'Unknown item.';
    return false;
  }

  const tgt = targetActor || actor;
  if (!wouldEffectsChangeAnything(def.effects, tgt)) {
    return false;
  }

  if (Array.isArray(def.effects)) {
    const payload = {
      ...npcPayloadBase(actor, tgt),
      sourceActor: targetActorDescriptorFromActor(actor),
      targetActor: targetActorDescriptorFromActor(tgt),
      source: 'item',
      item: id
    };
    applyRuleEffects({ effects: def.effects }, payload);
  }

  const consumed = consumeActorItemInstance(actor, id, itemUid);
  if (consumed) {
    applyItemGrantsOnUse(actor, tgt, id, def);
    emitGameEvent('item_use', {
      item: id,
      sourceActor: targetActorDescriptorFromActor(actor),
      targetActor: targetActorDescriptorFromActor(tgt)
    });
  }
  return consumed;
}

function useItemOnceOnTargets(itemId, itemUid, targets) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (!list.length) {
    __lastItemUseError = 'No valid targets.';
    return false;
  }

  // If nothing would change on any target, do not consume.
  let anyChange = false;
  const def = getItemDef(itemId);
  const effects = def?.effects || null;
  if (!Array.isArray(effects) || effects.length === 0) {
    __lastItemUseError = 'That item has no effect.';
    return false;
  }
  for (const t of list) {
    if (wouldEffectsChangeAnything(effects, t)) { anyChange = true; break; }
  }
  if (!anyChange) return false;

  // Apply to each target, then consume once.
  for (const t of list) {
    if (!t) continue;
    if (t === player) {
      applyPlayerEffects(effects, { source: 'item', item: lc(itemId) }, t);
    } else {
      const payload = {
        ...playerPayloadBase(t),
        sourceActor: targetActorDescriptorFromActor(player),
        targetActor: targetActorDescriptorFromActor(t),
        source: 'item',
        item: lc(itemId)
      };
      applyRuleEffects({ effects }, payload);
    }
  }

  const consumed = consumeItemInstance(itemId, itemUid);
  if (consumed) {
    for (const t of list) {
      applyItemGrantsOnUse(player, t || player, lc(itemId), def);
    }
    for (const t of list) {
      emitGameEvent('item_use', {
        item: lc(itemId),
        sourceActor: targetActorDescriptorFromActor(player),
        targetActor: targetActorDescriptorFromActor(t || player)
      });
    }
  }
  return consumed;
}

function giveItemToTarget(itemId, itemUid, targetActor) {
  const id = lc(itemId);
  if (!id) return false;
  if (!canUseItem(id, itemUid)) {
    showPlayerMenuError('You do not have that item.');
    return null;
  }
  if (!targetActor) return false;
  if (!canActorReceiveItem(targetActor)) {
    showPlayerMenuError('That target cannot carry items.');
    return null;
  }
  if (!hasActorInventorySpace(targetActor)) {
    showPlayerMenuError('Target inventory is full.');
    return null;
  }

  const srcBucket = getInvBucket(id);
  if (!srcBucket || !Array.isArray(srcBucket.instances)) return null;
  const uidStr = itemUid != null ? String(itemUid) : null;
  let idx = -1;
  if (uidStr == null) idx = srcBucket.instances.length > 0 ? 0 : -1;
  else idx = srcBucket.instances.findIndex((inst) => String(inst?.uid) === uidStr);
  if (idx < 0 || idx >= srcBucket.instances.length) {
    showPlayerMenuError('That item instance is no longer available.');
    return null;
  }

  const inst = srcBucket.instances[idx];
  srcBucket.instances.splice(idx, 1);
  if (srcBucket.instances.length <= 0) {
    const inv = ensurePlayerInventory();
    delete inv[id];
  }
  emitGameEvent('inventory_change', { item: id });

  addItemInstanceToActor(targetActor, id, inst);
  const rec = ensureNpcRecord(targetActor?.name || '');
  if (rec) {
    rec.inventory = targetActor.inventory || rec.inventory;
    rec.inventoryUidCounter = targetActor.inventoryUidCounter || rec.inventoryUidCounter;
  }

  emitGameEvent('item_give', {
    item: id,
    sourceActor: targetActorDescriptorFromActor(player),
    targetActor: targetActorDescriptorFromActor(targetActor)
  });

  return inst?.uid ?? true;
}

function giveItemToTargetFromActor(actor, itemId, itemUid, targetActor) {
  if (!actor) return false;
  if (actor === player) return giveItemToTarget(itemId, itemUid, targetActor);

  const id = lc(itemId);
  if (!id) return false;
  if (!canUseActorItem(actor, id, itemUid)) {
    showPlayerMenuError('You do not have that item.');
    return null;
  }
  if (!targetActor) return false;
  if (!canActorReceiveItem(targetActor)) {
    showPlayerMenuError('That target cannot carry items.');
    return null;
  }
  if (!hasActorInventorySpace(targetActor)) {
    showPlayerMenuError('Target inventory is full.');
    return null;
  }

  const srcBucket = getActorInvBucket(actor, id);
  if (!srcBucket || !Array.isArray(srcBucket.instances)) return null;
  const uidStr = itemUid != null ? String(itemUid) : null;
  let idx = -1;
  if (uidStr == null) idx = srcBucket.instances.length > 0 ? 0 : -1;
  else idx = srcBucket.instances.findIndex((inst) => String(inst?.uid) === uidStr);
  if (idx < 0 || idx >= srcBucket.instances.length) {
    showPlayerMenuError('That item instance is no longer available.');
    return null;
  }

  const inst = srcBucket.instances[idx];
  srcBucket.instances.splice(idx, 1);
  if (srcBucket.instances.length <= 0) {
    const inv = ensureActorInventory(actor);
    delete inv[id];
  }

  addItemInstanceToActor(targetActor, id, inst);
  const rec = ensureNpcRecord(targetActor?.name || '');
  if (rec) {
    rec.inventory = targetActor.inventory || rec.inventory;
    rec.inventoryUidCounter = targetActor.inventoryUidCounter || rec.inventoryUidCounter;
  }

  emitGameEvent('item_give', {
    item: id,
    sourceActor: targetActorDescriptorFromActor(actor),
    targetActor: targetActorDescriptorFromActor(targetActor)
  });

  return inst?.uid ?? true;
}



function getPlayerStatRec(statKeyRaw) {
  ensurePlayerStats();
  const k = normStatKey(statKeyRaw);
  if (!k) return null;
  const def = getStatDef(k);
  if (!def || !statAppliesToActor(k, player)) return null;
  if (!player.stats[k]) {
    ensureStatsSchemaForKind(player.stats, 'player');
  }
  return player.stats[k] || null;
}

function setPlayerStatField(statKeyRaw, fieldRaw, valueRaw) {
  const k = normStatKey(statKeyRaw);
  const def = getStatDef(k);
  const rec = getPlayerStatRec(k);
  if (!def || !rec) return;

  const result = setStatRecField(def, rec, fieldRaw, valueRaw);
  if (!result) return;

  emitGameEvent('stat_change', {
    actor: 'player',
    stat: k,
    field: result.field,
    prev: result.prev,
    next: result.next
  });
}

function handleNpcPassOutIfNeeded(npcActor, statKey, prevVal, nextVal) {
  if (!npcActor || !npcActor.name) return false;
  if (statKey !== 'stamina' && statKey !== 'composure') return false;

  const p = Number(prevVal);
  const n = Number(nextVal);

  if (!isFinite(n)) return false;
  if (n > 0) return false;

  // Only trigger once per pass-out occurrence
  if (npcActor._passedOut) return false;
  if (isFinite(p) && p <= 0) return false;

  npcActor._passedOut = true;

  emitGameEvent('npc_pass_out', {
    area: currentAreaName,
    section: getSectionNameForX(npcActor.worldX),
    npc: npcActor.name,
    stat: statKey,
    before: isFinite(p) ? p : undefined,
    after: n
  });

  // Drop them from the party in-place into the world
  removeNpcFromPartyInternal(npcActor, { toWorld: true, reason: 'pass_out' });

  return true;
}

function ensureMobStats(m) {
  if (!m) return null;
  m.stats = ensureStatsSchemaForKind(m.stats, 'mob');
  return m.stats;
}


function getMobStatRec(m, statKeyRaw) {
  const statKey = normStatKey(statKeyRaw);
  if (!statKey) return null;
  const stats = ensureMobStats(m);
  if (!stats) return null;
  return stats[statKey] || null;
}

function setMobStatField(m, statKeyRaw, fieldRaw, valueRaw) {
  const rec = getMobStatRec(m, statKeyRaw);
  if (!rec) return false;

  const statKey = normStatKey(statKeyRaw);
  const def = getStatDef(statKey);
  if (!def) return false;

  const result = setStatRecField(def, rec, fieldRaw, valueRaw);
  if (!result) return false;

  return true;
}

function addMobStatField(m, statKeyRaw, fieldRaw, deltaRaw) {
  const rec = getMobStatRec(m, statKeyRaw);
  if (!rec) return false;

  const d = Number(deltaRaw);
  if (!isFinite(d) || d === 0) return false;

  const statKey = normStatKey(statKeyRaw);
  const def = getStatDef(statKey);
  if (!def) return false;
  const field = normalizeStatFieldForDef(def, fieldRaw);
  if (def.type === 'depletable') {
    const nextVal = (field === 'max') ? Number(rec.max ?? 0) + d : Number(rec.current ?? 0) + d;
    return setMobStatField(m, statKey, field, nextVal);
  }
  if (def.type === 'scalar') {
    return setMobStatField(m, statKey, 'base', Number(rec.base ?? 0) + d);
  }
  return setMobStatField(m, statKey, 'current', Number(rec.current ?? 0) + d);
}


function applyStatChangeWithFeedback(target, statKeyRaw, op, payload = null) {
  // target: { kind:'player' } | { kind:'npc', name:'Rowyn' } | { kind:'mob', id:'spirit_wisp', instanceId:'...' }
  // op: { mode:'delta'|'set', field:'current'|'base'|'value', delta:number } OR { mode:'set', field:'current'|'base'|'value', value:number }

  const kind = lc(target?.kind || '');
  const statKey = normStatKey(statKeyRaw);
  if (!statKey) return false;

  const mode = lc(op?.mode || 'delta');
  const def = getStatDef(statKey);
  if (!def) return false;
  const field = normalizeStatFieldForDef(def, op?.field);

  // --- PLAYER + NPC (shared path) ---
  if (kind === 'player' || kind === 'npc') {
    const who = (kind === 'player') ? 'player' : target?.name;
    if (!who) return false;

    const getRec = (kind === 'player')
      ? (k) => getPlayerStatRec(k)
      : (k) => {
        ensureNpcStatsShared(who);
        return getActorStatRec(who, k);
      };

    const setField = (kind === 'player')
      ? (k, f, v) => setPlayerStatField(k, f, v)
      : (k, f, v) => {
        ensureNpcStatsShared(who);
        return setActorStatField(who, k, f, v);
      };

    const addField = (kind === 'player')
      ? (k, f, d) => addPlayerStatField(k, f, d)
      : (k, f, d) => {
        ensureNpcStatsShared(who);
        return addActorStatField(who, k, f, d);
      };

    const before = getRec(statKey);
    let prev = null;
    if (def.type === 'depletable') prev = (field === 'max') ? Number(before?.max ?? 0) : Number(before?.current ?? 0);
    else if (def.type === 'scalar') prev = Number(before?.base ?? 0);
    else prev = Number(before?.current ?? 0);

    if (mode === 'set') {
      setField(statKey, field, op?.value);
    } else {
      // shared mitigation helper (player + npc)
      const d = mitigateDeltaForActor(who, statKey, field, op?.delta);
      addField(statKey, field, d);
    }

    const after = getRec(statKey);
    let next = null;
    if (def.type === 'depletable') next = (field === 'max') ? Number(after?.max ?? 0) : Number(after?.current ?? 0);
    else if (def.type === 'scalar') next = Number(after?.base ?? 0);
    else next = Number(after?.current ?? 0);

    if (
      kind === 'npc' &&
      lc(who || '') === 'mira' &&
      (statKey === 'alignment' || statKey === 'affection') &&
      field === 'current'
    ) {
      const prevAlign = (statKey === 'alignment') ? prev : Number(getActorStatValue('Mira', 'alignment', 'current') ?? 0);
      const prevAff = (statKey === 'affection') ? prev : Number(getActorStatValue('Mira', 'affection', 'current') ?? 0);
      const nextAlign = Number(getActorStatValue('Mira', 'alignment', 'current') ?? 0);
      const nextAff = Number(getActorStatValue('Mira', 'affection', 'current') ?? 0);

      const prevSum = Number(prevAlign ?? 0) + Number(prevAff ?? 0);
      const nextSum = Number(nextAlign ?? 0) + Number(nextAff ?? 0);
      const prevRel = prevSum > 0 ? 'ally' : (prevSum < 0 ? 'enemy' : 'neutral');
      const nextRel = nextSum > 0 ? 'ally' : (nextSum < 0 ? 'enemy' : 'neutral');
      const flipped = prevRel !== nextRel ? 'FLIP' : 'same';
      const src = payload?.source || payload?.ability || payload?.rule || payload?.dialog || null;

      console.log(
        `dbg/mira_alignment_change stat=${statKey} prev=${prev} next=${next} sum=${prevSum}->${nextSum} partyRelation=${prevRel}->${nextRel} (${flipped}) source=${src}`
      );
    }

    // Player-only composure fade pulse
    if (kind === 'player' && statKey === 'composure' && field === 'current' && isFinite(prev) && isFinite(next) && next < prev) {
      const base = Number(getActorStatValue('player', 'composure', 'max') ?? 0);

      let alpha = 1;
      if (next > 0 && base > 0) {
        const fracRemaining = Math.max(0, Math.min(1, next / base));
        alpha = 1 - fracRemaining;
      }

      startFadePulse(alpha, 1, 1);
    }

    // NPC-only feedback (head bars + pass-out + icons)
    if (kind === 'npc') {

      const delta =
        (isFinite(prev) && isFinite(next)) ? (next - prev)
        : (mode === 'set') ? (Number(op?.value) - Number(prev))
        : Number(op?.delta || 0);

      const actor = findActorByName(who);

      if (actor && field === 'current') {
        handleNpcPassOutIfNeeded(actor, statKey, prev, next);
      }

      if (actor && field === 'current' && (statKey === 'stamina' || statKey === 'composure') && isFinite(prev) && isFinite(next) && prev !== next) {
        noteNpcHeadStatChanged(actor, statKey, prev, next);
      }

      if (actor) spawnStatChangeIconsForActor(actor, statKey, delta);

      if (
        inConversation &&
        conversationOverlay &&
        conversationOverlay.dataset &&
        conversationOverlay.dataset.mode === 'npc' &&
        lc(conversationOverlay.dataset.speaker || '') === lc(who || '')
      ) {
        spawnStatChangeIconsForDialogPortrait(statKey, delta);
      }
    }

    return true;
  }

  // --- MOB (shared set/delta helpers + routing semantics) ---
  if (kind === 'mob') {
    const mobId = lc(target?.id || '');
    if (!mobId) return false;

    const wantInstanceId = String(target?.instanceId || '');

    for (const m of mobs.slice()) {
      if (!m || lc(m.id) !== mobId) continue;
      if (wantInstanceId && String(m.instanceId) !== wantInstanceId) continue;

      // Ensure mob has proper stats records
      ensureMobStats(m);

      // Snapshot hp for feedback
      const prevHp = Number(m?.stats?.hp?.current ?? m.hp ?? 0);

      // SET: allow hp/endurance/fortitude (base/current)
      if (mode === 'set') {
        if (statKey !== 'hp' && statKey !== 'endurance' && statKey !== 'fortitude') return false;

        const value = Number(op?.value);
        if (!isFinite(value)) return false;

        setMobStatField(m, statKey, field, value);

        if (statKey === 'hp') {
          const nextHp = Number(m?.stats?.hp?.current ?? m.hp ?? 0);
          if (isFinite(prevHp) && isFinite(nextHp) && prevHp !== nextHp) {
            noteMobHpChanged(m, prevHp, nextHp);
          }
          handleMobDefeatIfNeeded(m, { reason: 'setMobHp' });
        }

        continue;
      }

      // DELTA
      const deltaRaw = Number(op?.delta);
      if (!isFinite(deltaRaw) || deltaRaw === 0) return false;

      // Direct endurance/fortitude changes (buffs/debuffs)
      if (statKey === 'endurance' || statKey === 'fortitude') {
        addMobStatField(m, statKey, field, deltaRaw);
        continue;
      }

      // Damage routing:
      // - stamina damage => mitigate by endurance (negative only) then apply to HP
      // - composure damage => mitigate by fortitude (negative only) then apply to HP
      // - hp => apply directly (bypass mitigation)
      if (statKey !== 'stamina' && statKey !== 'composure' && statKey !== 'hp') return false;

      let appliedDelta = deltaRaw;

      if (statKey === 'stamina' && appliedDelta < 0) {
        const end = Number(getStatEffectiveValue(m, 'endurance') ?? 0);
        if (isFinite(end) && end > 0) appliedDelta = Math.min(0, appliedDelta + end);
        else appliedDelta = Math.min(0, appliedDelta);
      } else if (statKey === 'composure' && appliedDelta < 0) {
        const fort = Number(getStatEffectiveValue(m, 'fortitude') ?? 0);
        if (isFinite(fort) && fort > 0) appliedDelta = Math.min(0, appliedDelta + fort);
        else appliedDelta = Math.min(0, appliedDelta);
      } else {
        // hp or positive deltas: no mitigation
      }

      addMobStatField(m, 'hp', 'current', appliedDelta);

      const nextHp = Number(m?.stats?.hp?.current ?? m.hp ?? 0);
      if (isFinite(prevHp) && isFinite(nextHp) && prevHp !== nextHp) {
        noteMobHpChanged(m, prevHp, nextHp);
      }

      handleMobDefeatIfNeeded(m, { reason: 'updateMobHp', statKey, delta: appliedDelta, rawDelta: deltaRaw });
    }

    return true;
  }

  return false;
}

function addPlayerStatField(statKeyRaw, fieldRaw, deltaRaw) {
  const rec = getPlayerStatRec(statKeyRaw);
  if (!rec) return;

  const d = Number(deltaRaw);
  if (!isFinite(d)) return;

  const statKey = normStatKey(statKeyRaw);
  const def = getStatDef(statKey);
  if (!def) return;
  const field = normalizeStatFieldForDef(def, fieldRaw);

  if (def.type === 'depletable') {
    const prev = (field === 'max') ? Number(rec.max ?? 0) : Number(rec.current ?? 0);
    const nextVal = (field === 'max') ? Number(rec.max ?? 0) + d : Number(rec.current ?? 0) + d;
    setPlayerStatField(statKeyRaw, field, nextVal);
    emitGameEvent('stat_change', { actor: 'player', stat: statKey, field, prev, next: (field === 'max') ? Number(rec.max ?? 0) : Number(rec.current ?? 0) });
  } else if (def.type === 'scalar') {
    const prev = Number(rec.base ?? 0);
    setPlayerStatField(statKeyRaw, field, prev + d);
    emitGameEvent('stat_change', { actor: 'player', stat: statKey, field: 'base', prev, next: Number(rec.base ?? 0) });
  } else {
    const prev = Number(rec.current ?? 0);
    setPlayerStatField(statKeyRaw, field, prev + d);
    emitGameEvent('stat_change', { actor: 'player', stat: statKey, field: 'current', prev, next: Number(rec.current ?? 0) });
  }
}


function buildPlayerStatsLabelLine() {
  ensurePlayerStats();

  // Keep display order stable:
  const parts = [];
  for (const k of PLAYER_STAT_ORDER) {
    const def = getStatDef(k);
    const rec = player.stats?.[k];
    if (!def || !rec) continue;
    if (def.type === 'depletable') {
      const cur = Number(rec.current ?? 0);
      const max = Number(getStatEffectiveValue(player, k) ?? rec.max ?? 0);
      parts.push(`${def.shortLabel || k}: ${cur}/${max}`);
    } else if (def.type === 'scalar') {
      const val = Number(getStatEffectiveValue(player, k) ?? rec.base ?? 0);
      parts.push(`${def.shortLabel || k}: ${val}`);
    } else if (def.type === 'variable') {
      const val = Number(getStatEffectiveValue(player, k) ?? rec.current ?? 0);
      parts.push(`${def.shortLabel || k}: ${val}`);
    }
  }
  return parts.join('  ');
}

const HEAD_STAT_BAR_H = 26;
const HEAD_STAT_BAR_GAP = 10;
const HEAD_STAT_BAR_LABEL_Y_PAD = 2;

function drawFixedStatBar(cx, yBottom, label, current, base, opts = {}) {
  const w = Math.floor(Number(opts.w ?? 220));
  const h = Math.floor(Number(opts.h ?? HEAD_STAT_BAR_H));
  const pad = Math.floor(Number(opts.pad ?? 5));

  const x = Math.floor(cx - w / 2);
  const y = Math.floor(yBottom - h);

  const b = Math.max(0, Number(base) || 0);
  const c = Math.max(0, Number(current) || 0);
  const frac = (b > 0) ? Math.max(0, Math.min(1, c / b)) : 0;

  const radius = Math.min(Math.floor(h / 3), Math.floor(Number(opts.radius ?? (h / 2))));

  // background + border
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.stroke();

  // fill (fixed width; only fill amount changes)
  const fillW = Math.floor(w * frac);
  ctx.fillStyle = String(opts.fill ?? 'rgba(120, 220, 120, 0.95)');
  if (fillW > 0) {
    const fillRadius = Math.min(radius, Math.floor(fillW / 2));
    drawRoundedRect(ctx, x, y, fillW, h, fillRadius);
    ctx.fill();
  }

  // label
  ctx.font = uiFont(Math.max(12, Math.round(h * 0.9)));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';

  const ty = Math.floor(y - 4);
  ctx.fillText(String(label), x + pad, ty);

  ctx.restore();

  return h + HEAD_STAT_BAR_GAP + HEAD_STAT_BAR_LABEL_Y_PAD; // vertical space used (for stacking)
}

// ===== Stat change floaters (icons) =====
// Each entry: { statKey, dir, worldX0, worldY0, startMs, durMs, driftY, ampX, waves, phase, size, imgKey }
const STAT_CHANGE_FLOATERS = [];
const STAT_CHANGE_ICON_CACHE = Object.create(null);

// ===== World toast (general purpose, queued) =====
const WORLD_TOASTS = [];
const WORLD_TOAST_DEFAULTS = {
  fadeIn: 140,
  hold: 3700, // total ~4s including fades
  fadeOut: 160
};

function showWorldToast(text, opts = null) {
  const msg = String(text || '').trim();
  if (!msg) return;
  const now = getGameNowMs();
  const fadeIn = Number(opts?.fadeIn ?? WORLD_TOAST_DEFAULTS.fadeIn);
  const hold = Number(opts?.hold ?? WORLD_TOAST_DEFAULTS.hold);
  const fadeOut = Number(opts?.fadeOut ?? WORLD_TOAST_DEFAULTS.fadeOut);
  WORLD_TOASTS.push({
    text: msg,
    start: now,
    fadeIn: isFinite(fadeIn) ? Math.max(0, fadeIn) : 0,
    hold: isFinite(hold) ? Math.max(0, hold) : 0,
    fadeOut: isFinite(fadeOut) ? Math.max(0, fadeOut) : 0
  });
}

function showItemFoundToast(text) {
  showWorldToast(text);
}

function drawWorldToast() {
  if (!WORLD_TOASTS.length) return;

  const now = getGameNowMs();
  const alive = [];
  const lines = [];

  for (const toast of WORLD_TOASTS) {
    if (!toast || !toast.text) continue;
    const t = now - toast.start;
    const total = toast.fadeIn + toast.hold + toast.fadeOut;
    if (t >= total) continue;

    let alpha = 1;
    if (t < toast.fadeIn && toast.fadeIn > 0) {
      alpha = t / toast.fadeIn;
    } else if (t > toast.fadeIn + toast.hold && toast.fadeOut > 0) {
      const outT = t - (toast.fadeIn + toast.hold);
      alpha = 1 - (outT / toast.fadeOut);
    }

    alive.push(toast);
    lines.push({ text: toast.text, alpha: Math.max(0, Math.min(1, alpha)) });
  }

  WORLD_TOASTS.length = 0;
  WORLD_TOASTS.push(...alive);
  if (!lines.length) return;

  const padX = 14;
  const padY = 7;
  const boxH = 30;
  const gapY = 12;
  const baseY = 220; // below menu tabs

  ctx.save();
  ctx.font = uiFont(40, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const textW = ctx.measureText(line.text).width;
    const boxW = Math.ceil(textW) + padX * 2;
    const x = Math.floor((canvas.width - boxW) / 2);
    const y = Math.floor(baseY + i * (boxH + gapY));

    ctx.globalAlpha = line.alpha;
    const r = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + boxW - r, y);
    ctx.quadraticCurveTo(x + boxW, y, x + boxW, y + r);
    ctx.lineTo(x + boxW, y + boxH - r);
    ctx.quadraticCurveTo(x + boxW, y + boxH, x + boxW - r, y + boxH);
    ctx.lineTo(x + r, y + boxH);
    ctx.quadraticCurveTo(x, y + boxH, x, y + boxH - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(line.text, x + boxW / 2, y + boxH / 2);
  }

  ctx.restore();
}

// In-world icon floaters
// Each entry: { itemId, imgKey, worldX0, worldY0, startMs, durMs, driftY, size }
const ITEM_FOUND_FLOATERS = [];
const ITEM_ICON_CACHE = Object.create(null);

function getItemIconKey(itemIdRaw, defOverride = null) {
  const def = defOverride || getItemDef(itemIdRaw);
  const raw = def?.image ?? def?.icon ?? def?.sprite ?? itemIdRaw;
  const key = String(raw || '').trim().toLowerCase();
  return key || null;
}

function __getItemIcon(itemIdRaw, defOverride = null) {
  const key = getItemIconKey(itemIdRaw, defOverride);
  if (!key) return null;

  let entry = ITEM_ICON_CACHE[key];
  if (entry) return entry;

  const img = new Image();
  entry = { img, ready: false, failed: false, key };

  img.onload = () => { entry.ready = true; };
  img.onerror = () => { entry.ready = false; entry.failed = true; };

  img.src = `assets/items/${key}.png`;
  ITEM_ICON_CACHE[key] = entry;
  return entry;
}

function spawnFoundItemFeedback(itemIdRaw, qtyRaw = 1, actor = null) {
  const id = lc(itemIdRaw || '');
  if (!id) return;

  const def = getItemDef(id);
  const name = String(def?.name || id);

  // Text popup
  showItemFoundToast(`Found ${name}`);

  // Icon floater (only if the icon exists; draw loop will skip until loaded)
  const icon = __getItemIcon(id, def);
  if (!icon || icon.failed) return;

  const now = getGameNowMs();

  const src = actor || player;
  const worldX0 = (Number(src?.worldX) || 0) + (Number(src?.w) || 0) / 2;
  const worldY0 = (Number(src?.y) || 0) - 22;

  ITEM_FOUND_FLOATERS.push({
    itemId: id,
    imgKey: icon.key,

    worldX0,
    worldY0,

    startMs: now,
    durMs: 1400,

    driftY: 140,
    size: 200
  });
}

function drawItemFoundFloaters(ctx) {
  const now = getGameNowMs();
  if (!ITEM_FOUND_FLOATERS.length) return;

  for (let i = ITEM_FOUND_FLOATERS.length - 1; i >= 0; i--) {
    const f = ITEM_FOUND_FLOATERS[i];
    const t = (now - f.startMs) / f.durMs;

    if (!(t >= 0 && t <= 1)) {
      ITEM_FOUND_FLOATERS.splice(i, 1);
      continue;
    }

    const icon = ITEM_ICON_CACHE[f.imgKey] || __getItemIcon(f.itemId);
    if (!icon || !icon.ready || icon.failed || !icon.img) continue;

    const wx = f.worldX0;
    const wy = f.worldY0 - (t * f.driftY);

    const sx = Math.floor(wx - (cameraX || 0));
    const sy = Math.floor(wy);

    const s = Math.floor(Number(f.size) || 44);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, 1 - t)); // fade out
    ctx.drawImage(icon.img, sx - Math.floor(s / 2), sy - s, s, s);
    ctx.restore();
  }
}

function drawManualTargetingOverlay() {
  if (!inManualTargeting || !manualTargetingState) return;

  const st = manualTargetingState;
  if (!Array.isArray(st.candidates) || st.candidates.length === 0) return;

  const now = Date.now();

  ctx.save();
  ctx.lineWidth = 3;

  for (let i = 0; i < st.candidates.length; i++) {
    const a = st.candidates[i];
    if (!a) continue;
    const pos = __actorRenderCenter(a);
    if (!pos) continue;

    const r = Math.max(36, Math.min(120, (Number(a.w) || 0) * 0.6));
    const isSel = (i === st.selectedIndex);

    if (st.flashBadUntilMs && now >= st.flashBadUntilMs) {
      st.flashBadUntilMs = 0;
      st.flashBadAtMs = 0;
    }
    let isBadFlash = false;
    if (isSel && st.flashBadUntilMs && now < st.flashBadUntilMs) {
      const pulseMs = Number(st.flashBadPulseMs || 120);
      const phase = Math.floor((now - Number(st.flashBadAtMs || now)) / Math.max(40, pulseMs));
      isBadFlash = (phase % 2 === 0);
    }
    ctx.beginPath();
    ctx.strokeStyle = isBadFlash
      ? 'rgba(255, 60, 60, 0.95)'
      : (isSel ? 'rgba(255, 210, 90, 0.95)' : 'rgba(120, 200, 255, 0.7)');
    ctx.lineWidth = isSel ? 4 : 2.5;
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (isSel) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();

  if (st.errorUntilMs && now < st.errorUntilMs && st.errorMsg) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = uiFont(42);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffdddd';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    const msg = String(st.errorMsg);
    const x = WIDTH / 2;
    const y = Math.max(16, Math.floor(HEIGHT * 0.08));
    ctx.strokeText(msg, x, y);
    ctx.fillText(msg, x, y);
    ctx.restore();
  }
}

// ===== Stat change floaters over dialog portrait (DOM) =====
let CURRENT_DIALOG_SPEAKER_NAME = ''; // updated whenever a phrase is displayed


function __ensureDialogStatIconLayer() {
  if (!conversationOverlay) return null;

  let layer = conversationOverlay.querySelector('.dialogStatChangeIconLayer');
  if (layer) return layer;

  layer = document.createElement('div');
  layer.className = 'dialogStatChangeIconLayer';
  layer.style.position = 'absolute';
  layer.style.left = '0';
  layer.style.top = '0';
  layer.style.width = '100%';
  layer.style.height = '100%';
  layer.style.pointerEvents = 'none';
  layer.style.overflow = 'visible';
  layer.style.zIndex = '9999';

  // Ensure overlay is a positioning context
  const cs = window.getComputedStyle(conversationOverlay);
  if (cs.position === 'static') {
    conversationOverlay.style.position = 'relative';
  }

  conversationOverlay.appendChild(layer);
  return layer;
}

function spawnStatChangeIconsForDialogPortrait(statKeyRaw, deltaRaw) {
  const statKey = String(statKeyRaw || '').trim().toLowerCase();
  const delta = Number(deltaRaw);
  if (!isFinite(delta) || delta === 0) return;

  // Any stat key may try to spawn an icon; missing icons should silently do nothing.

  if (!conversationOverlay || !conversationPortrait) return;


  const layer = __ensureDialogStatIconLayer();
  if (!layer) return;

  const dir = (delta > 0) ? 'up' : 'down';
  const count = Math.max(0, Math.floor(Math.abs(delta) + 1e-9));
  if (count <= 0) return;

  const icon = __getStatChangeIcon(statKey, dir);
  if (!icon || icon.failed || !icon.ready) return;
  const src = `assets/icons/${icon.key}.png`;

  const overlayRect = conversationOverlay.getBoundingClientRect();
  const portraitRect = conversationPortrait.getBoundingClientRect();

  // Spawn near the bottom of the portrait (inside overlay coords)
  const baseX = (portraitRect.left - overlayRect.left) + (portraitRect.width * 0.5);
  //const baseY = (portraitRect.bottom - overlayRect.top) - 6;
  const baseY = (portraitRect.top - overlayRect.top) + (portraitRect.height * 0.2);

  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.style.position = 'absolute';
    img.style.width = '36px';
    img.style.height = '36px';
    img.style.left = `${Math.floor(baseX - 18 + __randBetween(-14, 14))}px`;
    img.style.top = `${Math.floor(baseY - 36 + __randBetween(-6, 6))}px`;
    img.style.opacity = '1';
    img.style.willChange = 'transform, opacity';
    img.style.pointerEvents = 'none';

    layer.appendChild(img);

    // Rise up from the bottom of the window area (portrait region), in front of the portrait
    const delay = i * 120;
    const risePx = 120;

    const anim = img.animate(
      [
        { transform: 'translateY(0px)', opacity: 1 },
        { transform: `translateY(${-risePx}px)`, opacity: 0 }
      ],
      { duration: 1200, easing: 'ease-out', delay, fill: 'forwards' }
    );

    anim.onfinish = () => {
      if (img && img.parentNode) img.parentNode.removeChild(img);
    };
  }
}


function __randBetween(a, b) {
  a = Number(a); b = Number(b);
  if (!isFinite(a)) a = 0;
  if (!isFinite(b)) b = 0;
  return a + Math.random() * (b - a);
}

function __getStatChangeIcon(statKeyRaw, dirRaw) {
  const statKey = String(statKeyRaw || '').trim().toLowerCase();
  const dir = (String(dirRaw || '').trim().toLowerCase() === 'down') ? 'down' : 'up';
  const key = `${statKey}_${dir}`;

  let entry = STAT_CHANGE_ICON_CACHE[key];
  if (entry) return entry;

  const img = new Image();
  entry = { img, ready: false, failed: false, key };

  img.onload = () => { entry.ready = true; entry.failed = false; };
  img.onerror = () => { entry.ready = false; entry.failed = true; };

  img.src = `assets/icons/${key}.png`;
  STAT_CHANGE_ICON_CACHE[key] = entry;
  return entry;
}

function spawnStatChangeIconsForActor(actor, statKeyRaw, deltaRaw) {
  if (!actor) return;

  const statKey = String(statKeyRaw || '').trim().toLowerCase();
  const delta = Number(deltaRaw);
  if (!isFinite(delta) || delta === 0) return;

  // Any stat key may try to spawn an icon; missing icons should silently do nothing.

  const dir = (delta > 0) ? 'up' : 'down';
  const count = Math.max(0, Math.floor(Math.abs(delta) + 1e-9));
  if (count <= 0) return;

  const icon = __getStatChangeIcon(statKey, dir);
  if (!icon || icon.failed || !icon.ready) return;

  const now = getGameNowMs();


  for (let i = 0; i < count; i++) {
    const xJitter = __randBetween(-200, 200);
    const yJitter = __randBetween(-8, 8);

    // “just above the character’s head”
    const worldX0 = (Number(actor.worldX) || 0) + (Number(actor.w) || 0) / 2 + xJitter;
    const worldY0 = (Number(actor.y) || 0) - 18 + yJitter;

    STAT_CHANGE_FLOATERS.push({
      statKey,
      dir,
      imgKey: icon.key,

      worldX0,
      worldY0,

      startMs: now,
      durMs: 3000,

      driftY: 300,     // up by ~300px
      ampX: 50,        // wave -50..+50
      waves: 1.5,      // ~1.5 full waves
      phase: __randBetween(0, Math.PI * 2),

      size: 48
    });
  }
}

function drawStatChangeFloaters(ctx) {
  const now = getGameNowMs();
  if (!STAT_CHANGE_FLOATERS.length) return;

  // prune + draw
  for (let i = STAT_CHANGE_FLOATERS.length - 1; i >= 0; i--) {
    const f = STAT_CHANGE_FLOATERS[i];
    const t = (now - f.startMs) / f.durMs;

    if (!(t >= 0 && t <= 1)) {
      STAT_CHANGE_FLOATERS.splice(i, 1);
      continue;
    }

    const icon = STAT_CHANGE_ICON_CACHE[f.imgKey] || __getStatChangeIcon(f.statKey, f.dir);
    if (!icon?.ready || !icon.img) continue;

    const wave = Math.sin(f.phase + (t * f.waves * Math.PI * 2));
    const wx = f.worldX0 + wave * f.ampX;
    const wy = f.worldY0 - (t * f.driftY);

    // world -> screen (this matches the rest of the head/UI drawing approach in this codebase)
    const sx = Math.floor(wx - (cameraX || 0));
    const sy = Math.floor(wy);

    const s = Math.floor(Number(f.size) || 48);
    ctx.drawImage(icon.img, sx - Math.floor(s / 2), sy - s, s, s);
  }
}

// ===== Head stat bars (shared for player + NPCs + mobs) =====
const HEAD_STAT_BAR_TIMING = {
  holdMs: 500,   // first 0.5s: show old value
  animMs: 500,  // middle 1s: slide old -> new
  totalMs: 1500 // total visible time
};

function __ensureHeadBarState(actor) {
  if (!actor) return null;
  if (!actor._headStatBars) {
    actor._headStatBars = {
      visibleUntilMs: 0,
      entries: Object.create(null)
    };
  }
  return actor._headStatBars;
}

function __getHeadBarEntry(actor, statKey) {
  const bars = __ensureHeadBarState(actor);
  if (!bars) return null;
  const key = lc(statKey);
  if (!bars.entries[key]) {
    bars.entries[key] = { base: 0, from: 0, to: 0, startMs: 0, endMs: 0, hasTween: false };
  }
  return bars.entries[key];
}

function cancelPlayerHeadBarTweens() {
  const bars = __ensureHeadBarState(player);
  if (!bars) return;

  bars.visibleUntilMs = 0;

  // force drawPlayerHeadBars() to use live stat values immediately
  for (const key of Object.keys(bars.entries)) {
    const entry = bars.entries[key];
    entry.hasTween = false;
    entry.startMs = 0;
    entry.endMs = 0;
  }
}

function __lerp(a, b, t) {
  a = Number(a); b = Number(b); t = Number(t);
  if (!isFinite(a)) a = 0;
  if (!isFinite(b)) b = 0;
  if (!isFinite(t)) t = 0;
  t = Math.max(0, Math.min(1, t));
  return a + (b - a) * t;
}

function __getHeadBarDisplayedValue(actor, statKey, nowMs) {
  const entry = __getHeadBarEntry(actor, statKey);
  if (!entry) return null;

  const start = Number(entry.startMs);
  const end = Number(entry.endMs);

  if (!isFinite(start) || !isFinite(end) || end <= start) {
    return Number(entry.to);
  }

  if (nowMs <= start) return Number(entry.from);
  if (nowMs >= end) return Number(entry.to);

  const t = (nowMs - start) / (end - start);
  return __lerp(entry.from, entry.to, t);
}

function noteHeadStatChanged(actor, statKey, prevValue, nextValue) {
  if (!actor) return;

  const key = lc(statKey);
  if (key !== 'stamina' && key !== 'composure' && key !== 'hp') return;

  const now = Date.now();
  const base = Number(actor?.stats?.[key]?.base ?? 0);
  const bars = __ensureHeadBarState(actor);
  const entry = __getHeadBarEntry(actor, key);

  // If we're already showing/animating, start the new tween from the currently displayed value
  const fromVal =
    (now < Number(bars?.visibleUntilMs || 0))
      ? __getHeadBarDisplayedValue(actor, key, now)
      : Number(prevValue);

  entry.base = base;
  entry.from = Number(fromVal);
  entry.to = Number(nextValue);
  entry.startMs = now + HEAD_STAT_BAR_TIMING.holdMs;
  entry.endMs = entry.startMs + HEAD_STAT_BAR_TIMING.animMs;
  entry.hasTween = true;

  bars.visibleUntilMs = Math.max(
    Number(bars.visibleUntilMs || 0),
    now + HEAD_STAT_BAR_TIMING.totalMs
  );
}

function notePlayerHeadStatChanged(statKey, prevValue, nextValue) {
  const key = lc(statKey);
  if (key !== 'stamina' && key !== 'composure') return;
  noteHeadStatChanged(player, key, prevValue, nextValue);
  return;
/*
  const now = Date.now();
  const base = Number(player?.stats?.[key]?.base ?? 0);

  const entry = (key === 'stamina') ? PLAYER_HEAD_STAT_BARS.sta : PLAYER_HEAD_STAT_BARS.com;

  // If we’re already showing/animating, start the new tween from the currently displayed value
  const fromVal =
    (now < PLAYER_HEAD_STAT_BARS.visibleUntilMs)
      ? __getHeadBarDisplayedValue(key, now)
      : Number(prevValue);

  entry.base = base;
  entry.from = Number(fromVal);
  entry.to = Number(nextValue);
  entry.startMs = now + PLAYER_HEAD_STAT_BARS.holdMs;
  entry.endMs = entry.startMs + PLAYER_HEAD_STAT_BARS.animMs;
  entry.hasTween = true;

  PLAYER_HEAD_STAT_BARS.visibleUntilMs = Math.max(
    PLAYER_HEAD_STAT_BARS.visibleUntilMs,
    now + PLAYER_HEAD_STAT_BARS.totalMs
  );
*/
}

function __ensureNpcHeadBarState(npc) {
  if (!npc) return null;
  if (!npc._headStatBars) {
    npc._headStatBars = {
      sta: { from: 0, to: 0, startMs: 0, endMs: 0, showUntilMs: 0, base: 0 },
      com: { from: 0, to: 0, startMs: 0, endMs: 0, showUntilMs: 0, base: 0 }
    };
  }
  return npc._headStatBars;
}

function noteNpcHeadStatChanged(npcActor, statKey, prevValue, nextValue) {
  const key = lc(statKey);
  if (key !== 'stamina' && key !== 'composure') return;

  if (!npcActor) return;
  noteHeadStatChanged(npcActor, key, prevValue, nextValue);
  return;
/*
  const now = Date.now();
  const rec = npcActor?.stats?.[key];
  const base = Number(rec?.base ?? 0);

  const bars = __ensureNpcHeadBarState(npcActor);
  const entry = (key === 'stamina') ? bars.sta : bars.com;

  // Start the new tween from the currently displayed value if already showing
  const fromVal =
    (now < entry.endMs)
      ? __getNpcHeadBarDisplayedValue(npcActor, key, now)
      : Number(prevValue);


  entry.from = Number(fromVal);
  entry.to = Number(nextValue);
  entry.base = base;

  entry.startMs = now;
  entry.endMs = now + 450;
  entry.showUntilMs = now + 1600;
*/
}


function __getNpcHeadBarDisplayedValue(npc, statKey, nowMs) {
  const bars = __ensureNpcHeadBarState(npc);
  const key = lc(statKey);
  const entry = (key === 'stamina') ? bars.sta
              : (key === 'composure') ? bars.com
              : null;
  if (!entry) return 0;

  const start = Number(entry.startMs) || 0;
  const end   = Number(entry.endMs) || 0;

  if (!(end > start)) return Number(entry.to) || 0;
  if (nowMs <= start) return Number(entry.from) || 0;
  if (nowMs >= end)   return Number(entry.to) || 0;

  const t = (nowMs - start) / (end - start);
  return __lerp(entry.from, entry.to, t);
}

function __ensureMobHeadBarState(mob) {
  if (!mob) return null;
  if (!mob._headHpBar) {
    mob._headHpBar = { from: 0, to: 0, startMs: 0, endMs: 0, showUntilMs: 0, base: 0 };
  }
  return mob._headHpBar;
}

function __getMobHpBarDisplayedValue(mob, nowMs) {
  const entry = __ensureMobHeadBarState(mob);
  if (!entry) return 0;

  const start = Number(entry.startMs) || 0;
  const end   = Number(entry.endMs) || 0;

  if (!(end > start)) return Number(entry.to) || 0;
  if (nowMs <= start) return Number(entry.from) || 0;
  if (nowMs >= end)   return Number(entry.to) || 0;

  const t = (nowMs - start) / (end - start);
  return __lerp(entry.from, entry.to, t);
}

function noteMobHpChanged(mob, prevValue, nextValue) {
  if (!mob) return;
  noteHeadStatChanged(mob, 'hp', prevValue, nextValue);
  emitGameEvent('mob_hp_change', {
    ...mobPayloadBase(mob),
    stat: 'hp',
    field: 'current',
    prev: prevValue,
    next: nextValue
  });
  return;
/*
  const now = Date.now();

  const hpRec = mob?.stats?.hp;
  const base = Number(hpRec?.base ?? 0);

  const bar = __ensureMobHeadBarState(mob);

  // If already showing, tween from the currently displayed value
  const fromVal =
    (now < bar.endMs)
      ? __getMobHpBarDisplayedValue(mob, now)
      : Number(prevValue);

  bar.from = Number(fromVal);
  bar.to = Number(nextValue);
  bar.base = base;

  bar.startMs = now;
  bar.endMs = now + 450;
  bar.showUntilMs = now + 1600;
*/
}

function drawMobHeadBars(mob, x, y) {
  if (!mob) return 0;

  const now = Date.now();
  const bars = __ensureHeadBarState(mob);
  const entry = __getHeadBarEntry(mob, 'hp');

  const forceVisible = inManualTargeting || (now < Number(bars?.visibleUntilMs || 0));

  // Same rule as NPC: show when names are toggled (N) OR during recent-change window
  if (!forceVisible && !showNames) return 0;

  const cx = x + mob.w / 2;

  const hpRec = mob?.stats?.hp;
  if (!hpRec) return 0;

  const hpVal = (forceVisible && entry?.hasTween)
    ? Number(__getHeadBarDisplayedValue(mob, 'hp', now))
    : Number(hpRec.current || 0);

  // Center on actor body instead of above head
  const centerY = y + mob.h * 0.45;
  const totalH = HEAD_STAT_BAR_H + HEAD_STAT_BAR_GAP;
  const barsStartYBottom = centerY + (totalH / 2);

  const hpMax = Number(getStatEffectiveValue(mob, 'hp') ?? hpRec.max ?? 0);
  return drawFixedStatBar(cx, barsStartYBottom, 'HP', hpVal, hpMax, {
    fill: 'rgba(255, 120, 120, 0.95)'
  });
}

function drawNpcHeadBars(npc, x, y) {
  if (!npc) return 0;

  const now = Date.now();
  const bars = __ensureHeadBarState(npc);
  const staEntry = __getHeadBarEntry(npc, 'stamina');
  const comEntry = __getHeadBarEntry(npc, 'composure');

  const forceVisible = inManualTargeting || (now < Number(bars?.visibleUntilMs || 0));



  // Match player behavior: show when names are toggled (N) OR during recent-change window
  if (!forceVisible && !showNames) return 0;

  const cx = x + npc.w / 2;

  const staRec = npc.stats?.stamina || { max: 0, current: 0 };
  const comRec = npc.stats?.composure || { max: 0, current: 0 };

  const staVal = (forceVisible && staEntry?.hasTween)
    ? Number(__getHeadBarDisplayedValue(npc, 'stamina', now))
    : Number(staRec.current || 0);

  const comVal = (forceVisible && comEntry?.hasTween)
    ? Number(__getHeadBarDisplayedValue(npc, 'composure', now))
    : Number(comRec.current || 0);

  // Center on actor body instead of above head
  const centerY = y + npc.h * 0.45;
  const totalH = (HEAD_STAT_BAR_H + HEAD_STAT_BAR_GAP) * 2;
  const barsStartYBottom = centerY + (totalH / 2);

  let yBottom = barsStartYBottom;
  let used = 0;

  const comMax = Number(getStatEffectiveValue(npc, 'composure') ?? comRec.max ?? 0);
  const usedCom = drawFixedStatBar(cx, yBottom, 'COM', comVal, comMax, {
    fill: 'rgba(16, 55, 122, 0.95)'
  });
  used += usedCom;
  yBottom -= usedCom;

  const staMax = Number(getStatEffectiveValue(npc, 'stamina') ?? staRec.max ?? 0);
  const usedSta = drawFixedStatBar(cx, yBottom, 'STA', staVal, staMax, {
    fill: 'rgba(8, 112, 8, 0.95)'
  });
  used += usedSta;
  yBottom -= usedSta;

  return used;
}


// (kept for backward compatibility if anything still calls it)
function drawOneNpcHeadBar(_npc, _statKey, _cx, _y, _now) {
  // no-op; NPC bars are drawn by drawNpcHeadBars() as a stacked pair like the player
}



function drawPlayerHeadBars(x, yBottomStart) {
  ensurePlayerStats();

  const now = Date.now();
  const bars = __ensureHeadBarState(player);
  const staEntry = __getHeadBarEntry(player, 'stamina');
  const comEntry = __getHeadBarEntry(player, 'composure');
  const forceVisible = inManualTargeting || (now < Number(bars?.visibleUntilMs || 0));

  // Respect existing logic (pressing N, name display, etc.)
  if (!forceVisible && !showNames) {
    return 0;
  }

  const cx = x + player.w / 2;

  const staRec = player.stats?.stamina || { max: 0, current: 0 };
  const comRec = player.stats?.composure || { max: 0, current: 0 };

  // Only use tweened values during the timed "force visible" window.
  const staVal = (forceVisible && staEntry?.hasTween)
    ? (Number(__getHeadBarDisplayedValue(player, 'stamina', now)))
    : Number(staRec.current || 0);

  const comVal = (forceVisible && comEntry?.hasTween)
    ? (Number(__getHeadBarDisplayedValue(player, 'composure', now)))
    : Number(comRec.current || 0);

  let yBottom = yBottomStart;

  let used = 0;

  // COM (top) then STA (bottom)
  const comMax = Number(getStatEffectiveValue(player, 'composure') ?? comRec.max ?? 0);
  const usedCom = drawFixedStatBar(cx, yBottom, 'COM', comVal, comMax, {
    fill: 'rgba(16, 55, 122, 0.95)'
  });
  used += usedCom;
  yBottom -= usedCom;

  const staMax = Number(getStatEffectiveValue(player, 'stamina') ?? staRec.max ?? 0);
  const usedSta = drawFixedStatBar(cx, yBottom, 'STA', staVal, staMax, {
    fill: 'rgba(8, 112, 8, 0.95)'
  });
  used += usedSta;
  yBottom -= usedSta;

  return used;
}


const player = {
  worldX: 40,
  y: 0,
  w: BASE_CHAR_W * SCALE.characters,
  h: BASE_CHAR_H * SCALE.characters,
  vx: 0,
  vy: 0,
  jumpForce: -7.5,
  onGround: false,
  name: 'Dace',

  // stats per centralized STAT_DEFS
  stats: createStatsForKind('player'),

  // ability framework (future-proof)
  abilities: [],
  autoCastAbilityId: null,
  abilityNextAtMs: Object.create(null),

  // AI targeting (player may use for auto-cast / targeting UI)
  aiTargeting: null,
  aiMovementTargeting: null,

  // Attack targeting (queue + current)
  attackTargetQueue: [],
  attackTargetCurrentKey: null,
  __attackQueueDirty: false,
  __attackResortAtMs: 0,
  __attackTargetActor: null,
  __attackStopRangePx: null,
  __attackPreferredAbilityId: null,

  // Movement targeting (queue + current)
  moveTargetQueue: [],
  moveTargetCurrentKey: null,
  __moveQueueDirty: false,
  __moveResortAtMs: 0,
  __moveTargetActor: null,
  __moveStopRangePx: null
};
globalThis.player = player;

ensurePlayerStats();


function clampStatFloor0(v) {
  v = Number(v);
  if (!isFinite(v)) return 0;
  return Math.max(0, v);
}

function recoverPlayerOnPassOut() {
  for (const k of ['stamina', 'composure']) {
    if (!player.stats[k]) continue;
    player.stats[k].current = clampStatFloor0(player.stats[k].max);
  }
}

function checkPlayerPassOut() {
  const s = player.stats?.stamina?.current ?? 1;
  const c = player.stats?.composure?.current ?? 1;
  if (playerIsPassedOut) return;
  if (s <= 0 || c <= 0) triggerPlayerPassOut();
}



// REGISTRY OF NPCs AND THEIR STATES
// name -> { inParty:boolean, area:string|null, worldX:number|null, stats:{[key]:{base,current}}, rules:Rule[] }
const npcRegistry = {};

function __npcKey(name) {
  const k = lc(String(name || '').trim());
  return k;
}

// REGISTRY OF Mobs AND THEIR STATES
// instanceId -> { area, mobId, worldX, y, vx, vy, facing, onGround, ai*, anchor, attackTarget*, moveTarget*, ... }
const mobRegistry = Object.create(null);

function ensureMobRecord(instanceId, mobId = null) {
  const key = String(instanceId || '').trim();
  if (!key) return null;
  const rec = mobRegistry[key] || (mobRegistry[key] = Object.create(null));
  if (mobId && !rec.mobId) rec.mobId = String(mobId);
  rec.instanceId = key;
  return rec;
}

function initMobRegistryFromDefs(rec, mobId, areaName, worldX, mobDef) {
  if (!rec) return;
  if (mobId && !rec.mobId) rec.mobId = String(mobId);
  if (areaName && !rec.area) rec.area = String(areaName);
  if (Number.isFinite(worldX) && (rec.worldX == null)) rec.worldX = Number(worldX);

  if (mobDef) {
    if (!Array.isArray(rec.tags) && Array.isArray(mobDef.tags)) rec.tags = mobDef.tags.slice();

    if (!rec.stats) {
      const hp0 = Math.max(1, Number(mobDef?.stats?.hp ?? 1) || 1);
      const end0 = Math.max(0, Number(mobDef?.stats?.endurance ?? 0) || 0);
      const fort0 = Math.max(0, Number(mobDef?.stats?.fortitude ?? 0) || 0);
      rec.stats = createStatsForKind('mob');
      if (rec.stats.hp) {
        rec.stats.hp.max = hp0;
        rec.stats.hp.current = hp0;
      }
      if (rec.stats.endurance) rec.stats.endurance.base = end0;
      if (rec.stats.fortitude) rec.stats.fortitude.base = fort0;
    }

    if (rec.autoCastAbilityId === undefined) {
      rec.autoCastAbilityId = null;
    }
  }

  if (!rec.anchor) {
    rec.anchor = { type: 'worldX', x: Number(rec.worldX ?? 0) };
  }
}


const triggeredRuleIds = new Set();
const activeStateRuleIds = new Set();

// ===== Rule Debug API (console helpers) =====
// Usage examples in console:
//   ruleHasFired('some_rule_id')
//   ruleIsActive('some_state_rule_id')
//   enableRuleTrace(true)        // logs rule evaluation per event
//   enableRuleTraceReasons(true) // logs WHY a rule didn't fire
//   dumpRuleStatus()             // summary of fired/active
//   explainRulesForLastEvent()   // detailed evaluation for last emitted event
//   explainRule('rule_id')       // evaluate one rule against last emitted event
let __lastEvent = null;

function ruleHasFired(ruleId) {
  return triggeredRuleIds.has(String(ruleId));
}

function ruleIsActive(ruleId) {
  return activeStateRuleIds.has(String(ruleId));
}

function enableRuleTrace(on = true) {
  window.__traceRules = !!on;
}

function enableRuleTraceReasons(on = true) {
  window.__traceRulesReasons = !!on;
}

function dumpRuleStatus() {
}

function isObjectInteractable(objectName, instanceKey = null) {
  const objectId = lc(objectName);
  if (!objectId) return false;

  // Must be in proximity by TYPE (engine-enforced)
  const typeKey = makeProxTypeKey({ kind: 'object', id: objectId });
  if (!typeKey || !proximityInsideTypes.has(typeKey)) return false;

  // Block interaction while an instance interaction is in progress
  if (instanceKey && activeObjectInteractions.has(instanceKey)) return false;
  if (instanceKey && isObjectInstanceCovered(instanceKey)) return false;
  if (instanceKey) {
    const def = getObjectDef(objectId);
    if (def && isObjectInstanceInactive(instanceKey, def, getGameNowMs())) return false;
  }

  // Must have at least one interaction rule whose state currently passes
  for (const rule of (rulesData || [])) {
    const i = rule?.interaction;
    if (!i) continue;
    if (lc(i.kind) !== 'object') continue;
    if (lc(i.id) !== objectId) continue;

    // IMPORTANT: for interaction rules, evaluate against the focused INSTANCE
    const payload = {
      ...( __lastEvent?.payload || {} ),
      instanceKey: instanceKey || (__lastEvent?.payload?.instanceKey)
    };
    if (evaluateRuleState(rule, payload)) return true;

  }

  // NEW: object-driven interactions (objects.json + party tags)
  const def = getObjectDef(objectId);
  if (def && partyCanInteractWithObjectDef(def)) {
    return true;
  }

  return false;

}



function explainRule(ruleId, eventName = null, payload = null) {
  const rid = String(ruleId || '');
  if (!rid) return console.warn('[RuleDebug] explainRule: missing ruleId');

  const ev = eventName || __lastEvent?.eventName || null;
  const pl = payload || __lastEvent?.payload || null;

  const rule = (rulesData || []).find(r => r && String(r.id) === rid);
  if (!rule) return console.warn('[RuleDebug] explainRule: rule not found:', rid);


  const stateOk = evaluateRuleState(rule, pl);

  // Event-driven?
  const triggers = normalizeTriggerWhen(rule.triggerWhen);
  if (!triggers.length) {
    return;
  }

  if (!ev) {
    return;
  }

  const matching = [];
  const failing = [];

  for (const t of triggers) {
    const ok = triggerMatches(t, ev, pl || {});
    (ok ? matching : failing).push(t);
  }


  // requires?
  if (rule.requires && Array.isArray(rule.requires)) {
    const reqReport = rule.requires.map(req => {
      const c = getEventCount(req, pl, ev);
      return { req, count: c };
    });
  }
}

function explainRulesForLastEvent() {
  if (!__lastEvent) return console.warn('[RuleDebug] No last event recorded yet.');
  const { eventName, payload } = __lastEvent;


  const list = rulesByEvent[eventName] || [];

  for (const entry of list) {
    const rule = entry.rule;
    const trig = entry.trigger;
    if (!rule || !rule.id) continue;

    const ruleId = String(rule.id);

    const blockedOnce = !!(rule.once && triggeredRuleIds.has(ruleId));
    const stateOk = evaluateRuleState(rule, payload);
    const trigOk = triggerMatches(trig, eventName, payload || {});

    let reqOk = true;
    if (rule.requires && Array.isArray(rule.requires)) {
      for (const req of rule.requires) {
        const c = getEventCount(req, payload, eventName);
        if (req.gte !== undefined && !(c >= req.gte)) reqOk = false;
        if (req.lte !== undefined && !(c <= req.lte)) reqOk = false;
        if (req.eq  !== undefined && !(c === req.eq)) reqOk = false;
        if (!reqOk) break;
      }
    }

  }
}

// Expose helpers globally for console use
window.ruleHasFired = ruleHasFired;
window.ruleIsActive = ruleIsActive;
window.enableRuleTrace = enableRuleTrace;
window.enableRuleTraceReasons = enableRuleTraceReasons;
window.dumpRuleStatus = dumpRuleStatus;
window.explainRule = explainRule;
window.explainRulesForLastEvent = explainRulesForLastEvent;
window.enableGoalTrace = function (on = true) {
  window.__traceGoals = !!on;
};



// GLOBAL RULES (loaded from data/rules.json)
let rulesData = [];
let rulesByEvent = Object.create(null); // eventName -> [{rule, trigger}]


// ============================================================================
// Event → State dependency map
// Each event declares which state-dependency keys it may affect.
// This is the SINGLE source of truth for event-driven state evaluation.
// ============================================================================

function depsPlayerInProximity(payload) {
  const kind = lc(payload?.kind);
  const id   = lc(payload?.id);
  const out = (kind && id) ? [`playerInProximity:${kind}:${id}`] : [];
  if (kind === 'npc') out.push('playerInProximity:npc:*');
  return out;
}

function depsNpcProximity(payload) {
  const npc = lc(payload?.npc);
  return npc ? [`playerInProximity:npc:${npc}`] : [];
}

const eventStateDependencies = {

  proximity_enter: depsPlayerInProximity,
  proximity_leave: depsPlayerInProximity,

  npc_proximity: depsNpcProximity,
  npc_proximity_leave: depsNpcProximity,



  party_join: (payload) => {
        const npc = lc(payload?.npc);
    return npc
      ? [`npcInParty:${npc}`, `hasBeenInParty:${npc}`]
      : [];
  },

  party_leave: (payload) => {
    const npc = lc(payload?.npc);
    return npc ? [`npcInParty:${npc}`] : [];
  },

  area_enter: (payload) => {
    const out = [];
    const npc = lc(payload?.npc || '');

    if (payload?.fromArea) out.push(`playerInArea:${lc(payload.fromArea)}`);
    if (payload?.toArea)   out.push(`playerInArea:${lc(payload.toArea)}`);

    // NPC/party mirrors also emit area_enter/leave with npc set
    if (npc && npc !== 'player') {
      if (payload?.fromArea) out.push(`npcInArea:${npc}:${lc(payload.fromArea)}`);
      if (payload?.toArea)   out.push(`npcInArea:${npc}:${lc(payload.toArea)}`);
    }

    return out;
  },

  area_leave: (payload) => {
    const out = [];
    const area = payload?.area;
    const npc = lc(payload?.npc || '');

    if (area) out.push(`playerInArea:${lc(area)}`);

    if (npc && npc !== 'player' && area) {
      out.push(`npcInArea:${npc}:${lc(area)}`);
    }

    return out;
  },


  section_enter: (payload) => {
    const area = lc(payload?.area || '');
    const sec  = String(payload?.section || '');
    if (!sec) return [];
    const out = [`playerInSection:*:${sec}`];
    if (area) out.push(`playerInSection:${area}:${sec}`);

    const npc = lc(payload?.npc);
    if (npc && sec) {
      out.push(`npcInSection:${npc}:*:${sec}`);
      if (area) out.push(`npcInSection:${npc}:${area}:${sec}`);
    }

    return out;
  },

  section_leave: (payload) => {
    const area = lc(payload?.area || '');
    const sec  = String(payload?.section || '');
    if (!sec) return [];
    const out = [`playerInSection:*:${sec}`];
    if (area) out.push(`playerInSection:${area}:${sec}`);

    const npc = lc(payload?.npc);
    if (npc && sec) {
      out.push(`npcInSection:${npc}:*:${sec}`);
      if (area) out.push(`npcInSection:${npc}:${area}:${sec}`);
    }

    return out;
  },

  movement_state: (payload) => {
    const npc = lc(payload?.npc);
    const st = lc(payload?.state);
    if (!npc || !st) return [];
    return [`movementState:${npc}:${st}`];
  },

  // NEW: inventory changed (add/remove/use)
  inventory_change: (payload) => {
    const id = lc(payload?.id || payload?.item || payload?.itemId);
    return id ? [`inventory:${id}`] : [];
  },

  // NEW: any actor stat changed (player or NPC)
  stat_change: (payload) => {
    const actor = lc(payload?.actor || payload?.npc || 'player');
    const stat  = lc(payload?.stat);
    const out = (actor && stat) ? [`stat:${actor}:${stat}`] : [];
    out.push('stat:any');
    return out;
  },

    // NEW: world time events
  time_phase_change: (payload) => {
    const out = [];
    const from = lc(payload?.fromPhase || '');
    const to   = lc(payload?.toPhase || '');
    if (from) out.push(`timePhase:${from}`);
    if (to)   out.push(`timePhase:${to}`);
    // also bump the coarse tick dep so "between A and B" rules can re-evaluate at boundaries
    out.push('timeTick');
    return out;
  },

  time_tick: (_payload) => {
    return ['timeTick'];
  },


  mob_contact_start: (payload) => {
    const mob = lc(payload?.mob);
    return mob ? [`playerInContact:mob:${mob}`] : [];
  },

  mob_contact_end: (payload) => {
    const mob = lc(payload?.mob);
    return mob ? [`playerInContact:mob:${mob}`] : [];
  },

};


// ===== State-rule indexing (so we don't scan everything on every event) =====
// depKey -> Set of "ruleId"
const stateRuleIndex = new Map();
// "ruleId" -> rule
const stateRuleById = new Map();


// A rule can depend on multiple state conditions; we index it under each.
function depKeysForStateCond(s) {
  if (!s || !s.type) return [];

  switch (s.type) {
    case 'playerInProximity': {
      // New preferred shape:
      //   { type:'playerInProximity', kind:'exit'|'npc'|'object'|'area_end', id:'...' }
      // Backward compatible shape:
      //   { type:'playerInProximity', npc:'Rowyn' }  => kind:'npc', id:'rowyn'
      const kind = lc(s.kind || (s.npc ? 'npc' : ''));
      const id   = lc(s.id || s.npc);
      const recruitable = !!s.recruitable;

      const deps = [];
      if (kind && id) deps.push(`playerInProximity:${kind}:${id}`);
      else if (kind) deps.push(`playerInProximity:${kind}:*`);

      if (recruitable) deps.push('stat:any');
      return deps;

      // (Optional) keep old key for any remaining legacy rules that still expect it
      // return id ? [`playerInProximity:${id}`] : [];
    }

    case 'playerInContact': {
      const kind = lc(s.kind || '');
      const id   = lc(s.id || s.mob || '');
      if (!kind || !id) return [];
      return [`playerInContact:${kind}:${id}`];
    }

    case 'npcInArea': {
      const npc = lc(s.npc || '');
      const area = lc(s.area || '');
      if (!npc || !area) return [];
      return [`npcInArea:${npc}:${area}`];
    }


    case 'movementState': {
      const who = lc(s.actor || s.npc);
      const st = lc(s.is);
      if (!who || !st) return [];
      return [`movementState:${who}:${st}`];
    }


    case 'playerInArea': {
      return s.area ? [`playerInArea:${lc(s.area)}`] : [];
    }

    case 'timePhase': {
      const phase = lc(s.is || s.phase || '');
      if (!phase) return [];
      return [`timePhase:${phase}`];
    }

    case 'timeBetween': {
      // Time-between predicates change over time; evaluate them on coarse ticks
      return ['timeTick'];
    }


    case 'playerInSection': {
      const sec = String(s.section || '');
      if (!sec) return [];
      // index both exact (area+section) and area-agnostic (for rules that omit s.area)
      const out = [`playerInSection:*:${sec}`];
      if (s.area) out.push(`playerInSection:${lc(s.area)}:${sec}`);
      return out;
    }

    case 'npcInSection': {
      const npc = lc(s.npc);
      const sec = String(s.section || '');
      if (!npc || !sec) return [];

      // Like playerInSection: index exact and area-agnostic
      const out = [`npcInSection:${npc}:*:${sec}`];
      if (s.area) out.push(`npcInSection:${npc}:${lc(s.area)}:${sec}`);
      return out;
    }


    case 'npcInParty': {
      const npc = lc(s.npc);
      return npc ? [`npcInParty:${npc}`] : [];
    }

    case 'hasBeenInParty': {
      const npc = lc(s.npc);
      return npc ? [`hasBeenInParty:${npc}`] : [];
    }

    case 'inventory': {
      const id = lc(s.id || s.item || s.itemId);
      return id ? [`inventory:${id}`] : [];
    }

  case 'stat': {
    const actor = lc(s.actor || s.npc || 'player');
    const stat  = lc(s.stat);
    return (actor && stat) ? [`stat:${actor}:${stat}`] : [];
  }
  case 'statSum': {
    const actor = lc(s.actor || s.npc || 'player');
    const stats = Array.isArray(s.stats) ? s.stats : [];
    if (!actor || stats.length === 0) return [];
    const out = [];
    for (const st of stats) {
      const stat = lc(st);
      if (stat) out.push(`stat:${actor}:${stat}`);
    }
    return out;
  }

    default:
      return [];
  }
}

function indexStateRule(rule) {
  if (!rule || !rule.id) return;
  if (rule.triggerWhen) return; // state-only rules are those WITHOUT triggerWhen

  const ruleId = String(rule.id);
  stateRuleById.set(ruleId, rule);

  const states = Array.isArray(rule.state) ? rule.state : [];
  for (const s of states) {
    for (const depKey of depKeysForStateCond(s)) {
      if (!stateRuleIndex.has(depKey)) stateRuleIndex.set(depKey, new Set());
      stateRuleIndex.get(depKey).add(ruleId);
    }
  }
}

function bindTriggeredRuleToStateIndex(rule) {
  if (!rule || !rule.id) return;

  const ruleId = String(rule.id);

  // If already bound, don't bind again
  if (stateRuleById.has(ruleId)) return;

  // Add to the same maps used by state-only rules,
  // but only AFTER the triggerWhen rule has fired.
  stateRuleById.set(ruleId, rule);

  const states = Array.isArray(rule.state) ? rule.state : [];
  for (const s of states) {
    for (const depKey of depKeysForStateCond(s)) {
      if (!stateRuleIndex.has(depKey)) stateRuleIndex.set(depKey, new Set());
      stateRuleIndex.get(depKey).add(ruleId);
    }
  }
}


function deindexStateRule(rule) {
  if (!rule || !rule.id) return;
  const ruleId = String(rule.id);

  const states = Array.isArray(rule.state) ? rule.state : [];
  for (const s of states) {
    for (const depKey of depKeysForStateCond(s)) {
      const set = stateRuleIndex.get(depKey);
      if (set) {
        set.delete(ruleId);
        if (set.size === 0) stateRuleIndex.delete(depKey);
      }
    }
  }

  stateRuleById.delete(ruleId);
}



function ensureNpcRecord(name) {
  const rawName = String(name || '').trim();
  const key = __npcKey(rawName);
  if (!key) return null;

  // Merge any legacy mixed-case entry into the normalized key.
  if (rawName && rawName !== key && npcRegistry[rawName]) {
    if (!npcRegistry[key]) {
      npcRegistry[key] = npcRegistry[rawName];
    } else {
      const src = npcRegistry[rawName];
      const dst = npcRegistry[key];
      for (const [k, v] of Object.entries(src)) {
        if (dst[k] === undefined || dst[k] === null) dst[k] = v;
      }
    }
    delete npcRegistry[rawName];
  }

  if (!npcRegistry[key]) {
    npcRegistry[key] = {
      inParty:false,
      hasBeenInParty:false, // NEW: persistent history flag
      _startingStatsApplied:false, // NEW


      // "met / known" tracking
      met:false,
      firstMetAt:null,
      lastSeenArea:null,
      lastSeenWorldX:null,
      lastSeenAt:null,

      // legacy/compat fields still used elsewhere
      area:null,
      worldX:null,

      // Unified stat model (mirrors runtime actor.stats)
      stats: null,

      // Inventory (NPCs default to size 0 unless specified in characters.json)
      inventory: Object.create(null),
      inventoryUidCounter: 1,

      // Abilities learned via items/scenes
      learnedAbilities: [],
      itemGrantProgress: Object.create(null),

      // Goals
      goalsActive: [],
      goalsHistory: Object.create(null),
      goalsRemoved: Object.create(null),
      goalsStateActive: Object.create(null),
      _startingGoalsApplied: false

    };
  }

  // Ensure stats object exists + includes required keys, and migrate legacy flat fields if present.
  if (!npcRegistry[key].name) npcRegistry[key].name = rawName || key;
  ensureNpcRecordStats(rawName || key, npcRegistry[key]);
  ensureNpcRecordGoals(rawName || key, npcRegistry[key]);

  return npcRegistry[key];
}

function __defineRegistryProxy(actor, rec, key) {
  if (!actor || !rec || !key) return;
  try {
    Object.defineProperty(actor, key, {
      configurable: true,
      enumerable: true,
      get() { return rec[key]; },
      set(v) { rec[key] = v; }
    });
  } catch {
    // ignore if defineProperty fails
  }
}

function bindNpcPersistentFields(actor, rec) {
  if (!actor || !rec) return;
  actor.__registryRef = rec;

  if (!rec.stats) ensureNpcRecordStats(rec.name || actor.name, rec);
  if (!rec.inventory) rec.inventory = Object.create(null);
  if (!rec.inventoryUidCounter) rec.inventoryUidCounter = 1;
  if (!Array.isArray(rec.learnedAbilities)) rec.learnedAbilities = [];
  if (!rec.itemGrantProgress || typeof rec.itemGrantProgress !== 'object') rec.itemGrantProgress = Object.create(null);

  if (rec.aiAutoCastRulesDefault === undefined) {
    rec.aiAutoCastRulesDefault = Array.isArray(actor.aiAutoCastRules)
      ? JSON.parse(JSON.stringify(actor.aiAutoCastRules))
      : null;
  }
  if (!Array.isArray(rec.aiAutoCastRules)) rec.aiAutoCastRules = null;
  if (!rec.autoCastRulesMode) rec.autoCastRulesMode = 'default';

  if (!Array.isArray(rec.factions)) rec.factions = actor.factions ? actor.factions.slice() : [];
  if (!rec.allianceByFaction || typeof rec.allianceByFaction !== 'object') rec.allianceByFaction = actor.allianceByFaction ? { ...actor.allianceByFaction } : undefined;
  if (!rec.allianceByInstance || typeof rec.allianceByInstance !== 'object') rec.allianceByInstance = actor.allianceByInstance ? { ...actor.allianceByInstance } : undefined;
  if (!rec.aiTargeting || typeof rec.aiTargeting !== 'object') rec.aiTargeting = actor.aiTargeting ? JSON.parse(JSON.stringify(actor.aiTargeting)) : null;
  if (!rec.aiMovementTargeting || typeof rec.aiMovementTargeting !== 'object') rec.aiMovementTargeting = actor.aiMovementTargeting ? JSON.parse(JSON.stringify(actor.aiMovementTargeting)) : null;

  // Reference persistent objects directly
  actor.stats = rec.stats;
  actor.inventory = rec.inventory;
  actor.inventoryUidCounter = rec.inventoryUidCounter;
  actor.learnedAbilities = rec.learnedAbilities;
  actor.itemGrantProgress = rec.itemGrantProgress;
  actor.factions = rec.factions;
  actor.allianceByFaction = rec.allianceByFaction;
  actor.allianceByInstance = rec.allianceByInstance;
  actor.aiTargeting = rec.aiTargeting;
  actor.aiMovementTargeting = rec.aiMovementTargeting;
  actor.aiAutoCastRules = rec.aiAutoCastRules;
  actor.aiAutoCastRulesDefault = rec.aiAutoCastRulesDefault;

  // Proxy persistent primitive fields
  __defineRegistryProxy(actor, rec, 'autoCastAbilityId');
  __defineRegistryProxy(actor, rec, 'autoCastRulesMode');
  __defineRegistryProxy(actor, rec, 'aiMode');
  __defineRegistryProxy(actor, rec, 'aiGoalX');
  __defineRegistryProxy(actor, rec, 'aiGoalRef');
  __defineRegistryProxy(actor, rec, 'aiAnchorX');
  __defineRegistryProxy(actor, rec, 'aiNextDecisionAtMs');
  __defineRegistryProxy(actor, rec, 'aiPhase');
  __defineRegistryProxy(actor, rec, 'aiMoveTargetX');
  __defineRegistryProxy(actor, rec, 'worldX');
}

function bindMobPersistentFields(mob, rec) {
  if (!mob || !rec) return;
  mob.__registryRef = rec;

  if (!rec.stats || typeof rec.stats !== 'object') rec.stats = mob.stats || createStatsForKind('mob');
  if (!Array.isArray(rec.tags)) rec.tags = Array.isArray(mob.tags) ? mob.tags.slice() : [];
  if (!rec.paramOverrides || typeof rec.paramOverrides !== 'object') rec.paramOverrides = mob.paramOverrides || Object.create(null);
  if (!Array.isArray(rec.attackTargetQueue)) rec.attackTargetQueue = Array.isArray(mob.attackTargetQueue) ? mob.attackTargetQueue : [];
  if (!Array.isArray(rec.moveTargetQueue)) rec.moveTargetQueue = Array.isArray(mob.moveTargetQueue) ? mob.moveTargetQueue : [];
  if (rec.aiAutoCastRulesDefault === undefined) {
    const defRules = mob.def?.ai?.autoCastRules;
    rec.aiAutoCastRulesDefault = Array.isArray(defRules) ? JSON.parse(JSON.stringify(defRules)) : null;
  }
  if (!Array.isArray(rec.aiAutoCastRules)) rec.aiAutoCastRules = null;
  if (!rec.autoCastRulesMode) rec.autoCastRulesMode = 'default';

  mob.stats = rec.stats;
  mob.tags = rec.tags;
  mob.paramOverrides = rec.paramOverrides;
  mob.attackTargetQueue = rec.attackTargetQueue;
  mob.attackTargetCurrentKey = rec.attackTargetCurrentKey ?? mob.attackTargetCurrentKey;
  mob.moveTargetQueue = rec.moveTargetQueue;
  mob.moveTargetCurrentKey = rec.moveTargetCurrentKey ?? mob.moveTargetCurrentKey;
  mob.aiAutoCastRules = rec.aiAutoCastRules;
  mob.aiAutoCastRulesDefault = rec.aiAutoCastRulesDefault;

  __defineRegistryProxy(mob, rec, 'worldX');
  __defineRegistryProxy(mob, rec, 'y');
  __defineRegistryProxy(mob, rec, 'vx');
  __defineRegistryProxy(mob, rec, 'vy');
  __defineRegistryProxy(mob, rec, 'facing');
  __defineRegistryProxy(mob, rec, 'onGround');
  __defineRegistryProxy(mob, rec, 'aiMode');
  __defineRegistryProxy(mob, rec, 'aiAnchorX');
  __defineRegistryProxy(mob, rec, 'aiGoalX');
  __defineRegistryProxy(mob, rec, 'aiPhase');
  __defineRegistryProxy(mob, rec, 'aiNextDecisionAtMs');
  __defineRegistryProxy(mob, rec, 'aiMoveTargetX');
  __defineRegistryProxy(mob, rec, 'anchor');
  __defineRegistryProxy(mob, rec, 'autoCastAbilityId');
  __defineRegistryProxy(mob, rec, 'autoCastRulesMode');
}


function __ensureActorStatRec(statsObj, statKey) {
  const k = lc(statKey || '');
  if (!k) return null;
  if (!statsObj[k] || typeof statsObj[k] !== 'object') {
    const def = getStatDef(k);
    if (!def) return null;
    if (def.type === 'depletable') {
      statsObj[k] = {
        current: Number(def.defaultCurrent ?? def.defaultMax ?? 0),
        max: Number(def.defaultMax ?? def.defaultCurrent ?? 0),
        mods: []
      };
    } else if (def.type === 'scalar') {
      statsObj[k] = { base: Number(def.defaultBase ?? 0), mods: [] };
    } else if (def.type === 'variable') {
      statsObj[k] = { current: Number(def.defaultCurrent ?? 0), mods: [] };
    }
  }
  if (!Array.isArray(statsObj[k].mods)) statsObj[k].mods = [];
  return statsObj[k];
}

function __applyStartingStatsToStats(statsObj, startingStats) {
  if (!statsObj || typeof statsObj !== 'object') return;
  const ss = (startingStats && typeof startingStats === 'object') ? startingStats : null;
  if (!ss) return;

  for (const [rawKey, rawVal] of Object.entries(ss)) {
    const k = lc(rawKey);
    const def = getStatDef(k);
    if (!def) continue;
    const rec = __ensureActorStatRec(statsObj, k);
    if (!rec) continue;

    if (def.type === 'depletable') {
      if (typeof rawVal === 'number' && isFinite(rawVal)) {
        setStatRecField(def, rec, 'max', rawVal);
        setStatRecField(def, rec, 'current', rawVal);
      } else if (rawVal && typeof rawVal === 'object') {
        if (rawVal.max != null) setStatRecField(def, rec, 'max', Number(rawVal.max));
        if (rawVal.current != null) setStatRecField(def, rec, 'current', Number(rawVal.current));
        if (rawVal.max != null && rawVal.current == null) {
          setStatRecField(def, rec, 'current', Number(rawVal.max));
        }
      }
    } else if (def.type === 'scalar') {
      if (typeof rawVal === 'number' && isFinite(rawVal)) {
        setStatRecField(def, rec, 'base', rawVal);
      } else if (rawVal && typeof rawVal === 'object' && rawVal.base != null) {
        setStatRecField(def, rec, 'base', Number(rawVal.base));
      }
    } else if (def.type === 'variable') {
      if (typeof rawVal === 'number' && isFinite(rawVal)) {
        setStatRecField(def, rec, 'current', rawVal);
      } else if (rawVal && typeof rawVal === 'object' && rawVal.current != null) {
        setStatRecField(def, rec, 'current', Number(rawVal.current));
      }
    }
  }
}

function ensureNpcRecordStats(name, rec) {
  if (!rec || typeof rec !== 'object') return;

  const details =
    (npcDetails && npcDetails[name]) ? npcDetails[name]
    : (npcDetailsByLc ? npcDetailsByLc[lc(name)] : null);
  const ss = details?.startingStats || null;
  const hasMinAlign = !!(ss && Object.keys(ss).some(k => lc(k) === 'minalignment'));

  rec.stats = ensureStatsSchemaForKind(rec.stats, 'npc', { skip: hasMinAlign ? [] : ['minalignment'] });
  if (!hasMinAlign && rec.stats && rec.stats.minalignment) {
    delete rec.stats.minalignment;
  }

  // Apply startingStats/min* from characters.json ONCE (case-insensitive)
  if (!rec._startingStatsApplied) {
    if (ss) {
      __applyStartingStatsToStats(rec.stats, ss);
      rec._startingStatsApplied = true;
    }
  }
}

function getActorStatRec(actorName, statKeyRaw) {
  const actor = lc(actorName || 'player');
  const statKey = normStatKey(statKeyRaw);
  if (!statKey) return null;

  if (actor === 'player') {
    return getPlayerStatRec(statKey);
  }

  const rec = ensureNpcRecord(actorName);
  ensureNpcRecordStats(actorName, rec);
  ensureNpcStatsShared(actorName);
  const s = rec?.stats;
  return (s && typeof s === 'object') ? (s[statKey] || null) : null;
}

function setActorStatField(actorName, statKeyRaw, fieldRaw, valueRaw) {
  const k = normStatKey(statKeyRaw);
  const def = getStatDef(k);
  const rec = getActorStatRec(actorName, k);
  if (!def || !rec) return false;

  const result = setStatRecField(def, rec, fieldRaw, valueRaw);
  if (!result) return false;

  // If NPC, keep registry+live actor in sync (shared reference if possible)
  const a = findActorByName(actorName);
  if (a && a !== player && a.stats && a.stats[normStatKey(statKeyRaw)] === rec) {
    // already shared ref; nothing
  }

  return true;
}

function addActorStatField(actorName, statKeyRaw, fieldRaw, deltaRaw) {
  const statKey = normStatKey(statKeyRaw);
  const def = getStatDef(statKey);
  const rec = getActorStatRec(actorName, statKey);
  if (!def || !rec) return false;

  const field = normalizeStatFieldForDef(def, fieldRaw);
  const d = Number(deltaRaw);
  if (!isFinite(d) || d === 0) return false;

  if (def.type === 'depletable') {
    const nextVal = (field === 'max') ? Number(rec.max ?? 0) + d : Number(rec.current ?? 0) + d;
    return setActorStatField(actorName, statKey, field, nextVal);
  }
  if (def.type === 'scalar') {
    return setActorStatField(actorName, statKey, 'base', Number(rec.base ?? 0) + d);
  }
  return setActorStatField(actorName, statKey, 'current', Number(rec.current ?? 0) + d);
}

function mitigateDeltaForActor(actorName, statKey, field, delta) {
  let d = Number(delta);
  if (!isFinite(d)) d = 0;

  // Only affects NEGATIVE deltas to current STA/COM, and cannot become healing.
  if (field === 'current' && d < 0) {
    if (statKey === 'stamina') {
      const end = Number(getActorStatValue(actorName, 'endurance', 'current') ?? 0);
      if (isFinite(end) && end > 0) d = Math.min(0, d + end);
      else d = Math.min(0, d);
    } else if (statKey === 'composure') {
      const fort = Number(getActorStatValue(actorName, 'fortitude', 'current') ?? 0);
      if (isFinite(fort) && fort > 0) d = Math.min(0, d + fort);
      else d = Math.min(0, d);
    }
  }

  return d;
}





function numCompare(n, op, rhs) {
  const a = Number(n);
  const b = Number(rhs);
  if (!isFinite(a) || !isFinite(b)) return false;
  switch (String(op || 'eq')) {
    case 'lt':  return a <  b;
    case 'lte': return a <= b;
    case 'gt':  return a >  b;
    case 'gte': return a >= b;
    case 'neq': return a !== b;
    case 'eq':
    default:    return a === b;
  }
}

function getActorStatValue(actorName, statKey, field) {
  const actor = lc(actorName || 'player');
  const stat  = lc(statKey || '');
  const f     = lc(field || 'current');

  if (!stat) return null;

  const def = getStatDef(stat);
  let statsObj = null;
  if (actor === 'player') {
    ensurePlayerStats();
    statsObj = player.stats;
  } else {
    const rec = ensureNpcRecord(actorName);
    ensureNpcRecordStats(actorName, rec);
    statsObj = rec?.stats;
  }
  if (!statsObj || typeof statsObj !== 'object') return null;
  const st = statsObj[stat];
  if (!st || typeof st !== 'object') return null;

  if (!def) {
    if (f === 'base' || f === 'max') return Number(st.base ?? st.max ?? 0);
    return Number(st.current ?? 0);
  }

  if (def.type === 'depletable') {
    if (f === 'max' || f === 'base') return Number(st.max ?? 0) + sumStatModifiers(st);
    return Number(st.current ?? 0);
  }
  if (def.type === 'scalar') {
    if (f === 'base') return Number(st.base ?? 0);
    return Number(st.base ?? 0) + sumStatModifiers(st);
  }
  if (def.type === 'variable') {
    if (f === 'base') return Number(st.current ?? 0);
    const cur = clampVariableValue(def, st.current ?? 0);
    return cur + sumStatModifiers(st);
  }
  return null;
}


function getInventoryMetric(itemId, measure, actorName = null) {
  const id = lc(itemId || '');
  if (!id) return null;

  const actor = String(actorName || 'player');
  const inv =
    (lc(actor) === 'player')
      ? (player.inventory || Object.create(null))
      : (ensureNpcRecord(actor).inventory || Object.create(null));
  const bucket = inv[id];
  if (!bucket) return 0;

  const insts = Array.isArray(bucket.instances) ? bucket.instances : [];
  const m = lc(measure || 'count');

  const count = insts.length;

  if (m === 'uses') {
    // Total remaining uses across all instances.
    const def = getItemDef(id);
    const usesPerItem = getItemUsesPerItem(def);

    if (usesPerItem <= 1) {
      // Non-uses items: treat each instance as 1 usable unit.
      return count;
    }

    let total = 0;
    for (const inst of insts) {
      const u = Number(inst?.usesLeft);
      total += (isFinite(u) ? Math.max(0, Math.floor(u)) : usesPerItem);
    }
    return total;
  }

  return count;
}

function getPartyInventoryMetric(itemId, measure) {
  let total = 0;
  total += Number(getInventoryMetric(itemId, measure, 'player') || 0);
  for (const m of party) {
    if (!m || !m.name) continue;
    total += Number(getInventoryMetric(itemId, measure, m.name) || 0);
  }
  return total;
}



function evaluateRuleState(rule, payload) {
  // if (rule.id === 'rowyn_forest1_keep_going_prompt') {
  // }

  if (!Array.isArray(rule.state)) return true;



  for (const s of rule.state) {
    if (s && Array.isArray(s.any)) {
      let ok = false;
      for (const sub of s.any) {
        if (evaluateRuleState({ state: [sub] }, payload)) { ok = true; break; }
      }
      if (!ok) return false;
      continue;
    }

    switch (s.type) {
      case 'npcInParty': {
        const inParty = isNpcInPartyByName(s.npc);
        if (inParty !== !!s.is) return false;
        break;
      }

      case 'movementState': {
        const who = s.actor || s.npc;
        const want = lc(s.is);
        if (!who || !want) return false;

        const actual = lc(getActorMovementStateByName(who));
        if (actual !== want) return false;
        break;
      }


      case 'npcInSection': {
        const npcName = String(s.npc || '').trim();
        const wantSection = String(s.section || '').trim();
        const wantArea = (s.area != null) ? String(s.area).trim() : null;

        if (!npcName || !wantSection) return false;

        // Prefer live actor; fall back to registry
        const actor = findActorByName(npcName);
        const rec = ensureNpcRecord(npcName);

        const areaName = (actor && actor.area) ? actor.area : (rec.area || null);
        const worldX = (actor && typeof actor.worldX === 'number') ? actor.worldX : rec.worldX;

        if (!areaName || typeof worldX !== 'number') return false;
        if (wantArea && areaName !== wantArea) return false;

        // Build (cached) area so we can calculate section from worldX
        const areaObj = buildAreaFromDefinition(areaName);
        if (!areaObj || !areaObj.sectionTileWidth || !Array.isArray(areaObj.sections)) return false;

        const idx = Math.floor(worldX / areaObj.sectionTileWidth);
        const secName = areaObj.sections[idx]?.name || null;

        if (secName !== wantSection) return false;
        break;
      }

      case 'npcInArea': {
        const npcName = String(s.npc || (payload && payload.npc) || '').trim();
        const wantArea = String(s.area || '').trim();

        if (!npcName || !wantArea) return false;

        // Prefer live actor; fall back to registry
        const actor = findActorByName(npcName);
        const rec = ensureNpcRecord(npcName);

        const areaName = (actor && actor.area) ? actor.area : (rec.area || null);
        const isIn = (areaName === wantArea);

        if (isIn !== !!s.is) return false;
        break;
      }


      case 'playerInArea': {
        const wantArea = lc(s.area);
        if (!wantArea) return false;

        const expected = ('is' in s) ? !!s.is : true;
        const isIn = (lc(currentAreaName) === wantArea);

        if (expected) {
          if (!isIn) return false;
        } else {
          if (isIn) return false;
        }

        break;
      }


      case 'playerInSection': {
        const wantSection = String(s.section || '').trim();
        if (!wantSection) return false;

        const expected = ('is' in s) ? !!s.is : true;

        // Use event payload if present; otherwise use current player position.
        // IMPORTANT: section_leave payload.section is the section being LEFT, not the current one.
        const curSection = (payload && payload.section && payload.__eventName !== 'section_leave')
          ? String(payload.section)
          : getSectionNameForX(player.worldX);


        const wantArea = lc(s.area);
        const curArea = (payload && payload.area) ? String(payload.area) : String(currentAreaName);

        const isIn = (curSection === wantSection) && (!wantArea || lc(curArea) === wantArea);

        if (expected) {
          if (!isIn) return false;
        } else {
          if (isIn) return false;
        }

        break;
      }


      case 'playerInProximity': {
        const kind = lc(s.kind || (s.npc ? 'npc' : ''));
        const id = lc(s.id || s.npc);
        const recruitable = !!s.recruitable;

        if (!kind) return false;

        if (id) {
          const key = makeProxKey({ kind, id });
          if (!key) return false;
          if (!proximityInside.has(key)) return false;
          if (recruitable && kind === 'npc') {
            const actor = findActorByName(id);
            if (!actor || !canRecruitNpc(actor)) return false;
          }
        } else {
          let any = false;
          for (const t of proximityInsideTypes) {
            if (String(t).startsWith(`${kind}:`)) { any = true; break; }
          }
          if (!any) return false;

          if (recruitable && kind === 'npc') {
            let found = false;
            for (const t of proximityInsideTypes) {
              if (!String(t).startsWith('npc:')) continue;
              const name = String(t).slice(4);
              const actor = findActorByName(name);
              if (!actor) continue;
              if (canRecruitNpc(actor)) { found = true; break; }
            }
            if (!found) return false;
          }
        }
        break;
      }

      case 'tag': {
        const tag = String(s.tag || s.id || '').trim();
        if (!tag) return false;

        const expected = ('is' in s) ? !!s.is : true;
        const who = s.actor || s.npc || 'player';

        let has = false;
        if (lc(String(who)) === '@party') {
          has = partyHasTag(tag);
        } else {
          const actor = (lc(String(who)) === 'player') ? player : findActorByName(who);
          has = actor ? actorHasTag(actor, tag) : false;
        }

        if (has !== expected) return false;
        break;
      }

      case 'playerInContact': {
        // user-facing rules should be TYPE-based for mobs:
        // { "type":"playerInContact", "id":"spirit_wisp" }
        const kind = lc(s.kind || (s.mob || s.id ? 'mob' : ''));
        const id = lc(s.id || s.mob || '');
        if (!kind || !id) return false;

        // mob contact state is tracked by TYPE as "mob:<mobId>"
        if (kind === 'mob') {
          const typeKey = `mob:${id}`;
          if (!contactInsideTypes.has(typeKey)) return false;
          break;
        }

        // fallback for any future kinds (if you ever add them)
        const key = makeContactKey({ kind, id });
        if (!key) return false;

        if (!contactInside.has(key)) return false;
        break;
      }

      case 'timePhase': {
        const want = lc(s.is || s.phase || '');
        if (!want) return false;
        const info = getWorldTimeInfo(WORLD_TIME_MIN);
        if (lc(info.phase) !== want) return false;
        break;
      }

      case 'timeBetween': {
        // Supports "between A and B" as minutes-into-day OR normalized dayT.
        // If range wraps (e.g. 0.85 -> 0.10), it means "or" across midnight.

        const info = getWorldTimeInfo(WORLD_TIME_MIN);

        // Prefer minutes-into-day if provided
        if (s.startMin != null || s.endMin != null) {
          const startMin = Number(s.startMin ?? 0);
          const endMin   = Number(s.endMin   ?? 0);

          const x = Number(info.minutesIntoDay);

          if (!isFinite(startMin) || !isFinite(endMin) || !isFinite(x)) return false;

          const wraps = endMin < startMin;
          const ok = wraps ? (x >= startMin || x <= endMin) : (x >= startMin && x <= endMin);
          if (!ok) return false;
          break;
        }

        // Otherwise use normalized [0..1] across the day
        const startT = Number(s.startT ?? s.startDayT ?? 0);
        const endT   = Number(s.endT   ?? s.endDayT   ?? 0);

        const x = Number(info.dayT);

        if (!isFinite(startT) || !isFinite(endT) || !isFinite(x)) return false;

        const wraps = endT < startT;
        const ok = wraps ? (x >= startT || x <= endT) : (x >= startT && x <= endT);
        if (!ok) return false;

        break;
      }

        
      case 'flag': {
        const scope = String(s.scope || 'global');
        let key = String(s.key || '');

        // Allow ${instanceKey} substitution from the evaluation payload
        if (payload && key.includes('${instanceKey}')) {
          key = key.replaceAll('${instanceKey}', String(payload.instanceKey || ''));
        }

        const actual = (lc(scope) === 'conversation')
          ? __getDialogConversationFlag(key)
          : getFlag(scope, key);

        // expected semantics:
        //   is:true  => flag must be truthy
        //   is:false => flag must be falsy/undefined
        //   is:null  => flag must be unset/undefined
        const expected = ('is' in s) ? s.is : true;

        if (expected === true) {
          if (!actual) return false;
        } else if (expected === false) {
          if (actual) return false;
        } else if (expected === null) {
          if (actual !== undefined) return false;
        } else {
          if (actual !== expected) return false;
        }

        break;
      }

      case 'inventory': {
        const id = s.id || s.item || s.itemId;
        const measure = s.measure || 'count'; // 'count' | 'uses'
        const op = s.op || 'gte';
        const rhs = ('rhs' in s) ? s.rhs : (('value' in s) ? s.value : 1);

        const who = s.actor || s.npc || 'player';
        const v =
          (lc(who) === '@party')
            ? getPartyInventoryMetric(id, measure)
            : getInventoryMetric(id, measure, who);
        if (!numCompare(v, op, rhs)) return false;
        break;
      }

  case 'stat': {
    const actor = s.actor || s.npc || 'player';
    const stat  = s.stat;
    const field = s.field || 'current'; // 'current'|'base' (NPCs ignore field)
    const op    = s.op || 'lt';

        let rhs = null;

        // preferred: rhs can be { field:'base' } to compare within same stat
        if (s.rhs && typeof s.rhs === 'object') {
          if (s.rhs.field) {
            rhs = getActorStatValue(actor, stat, s.rhs.field);
          } else if ('value' in s.rhs) {
            rhs = Number(s.rhs.value);
          }
        } else if ('rhs' in s) {
          rhs = Number(s.rhs);
        } else if ('value' in s) {
          rhs = Number(s.value);
        }

        const left = getActorStatValue(actor, stat, field);
    if (!numCompare(left, op, rhs)) return false;
    break;
  }

  case 'statSum': {
    const actorName = String(s.actor || s.npc || 'player');
    const stats = Array.isArray(s.stats) ? s.stats : [];
    if (!actorName || stats.length === 0) return false;

    const field = s.field || 'current';
    let sum = 0;
    for (const statName of stats) {
      const v = getActorStatValue(actorName, statName, field);
      if (!isFinite(v)) return false;
      sum += Number(v);
    }

    let rhs = null;
    if (s.rhs && typeof s.rhs === 'object') {
      if (s.rhs.field) {
        const rhsStat = s.rhs.stat || stats[0];
        rhs = getActorStatValue(actorName, rhsStat, s.rhs.field);
      } else if ('value' in s.rhs) {
        rhs = Number(s.rhs.value);
      }
    } else if ('rhs' in s) {
      rhs = Number(s.rhs);
    } else if ('value' in s) {
      rhs = Number(s.value);
    }

    if (typeof rhs === 'string') {
      const t = lc(rhs);
      if (t === 'minalignment') rhs = getActorStatValue(actorName, 'minalignment', 'base');
      else if (t === 'minaffection') rhs = getActorStatValue(actorName, 'minaffection', 'base');
      else return false;
    }

    let op = s.op || 'lt';
    if (op === '<') op = 'lt';
    else if (op === '<=') op = 'lte';
    else if (op === '>') op = 'gt';
    else if (op === '>=') op = 'gte';
    else if (op === '==') op = 'eq';
    else if (op === '!=') op = 'neq';
    if (!numCompare(sum, op, rhs)) return false;
    break;
  }


      case 'hasBeenInParty': {
        const rec = ensureNpcRecord(s.npc);
        const has = !!rec.hasBeenInParty;
        if (has !== !!s.is) return false;
        break;
      }

      case 'actorParam': {
        const key = String(s.key || s.param || '');
        const op = lc(s.op || s.compare || 'eq');
        const want = s.value;
        if (!key) return false;

        const spec = normalizeActorSpec(s, payload);
        const actors = resolveActorsFromSpec(spec, payload);
        if (!actors.length) return false;

        let ok = false;
        const __resolveActorParamValue = (actor, raw) => {
          if (raw && typeof raw === 'object' && raw.stat) {
            const statKey = String(raw.stat || '');
            const field = raw.field || 'current';
            if (isMobActor(actor)) {
              if (lc(field) === 'current') return Number(actor?.stats?.[lc(statKey)]?.current);
              if (lc(field) === 'max') return Number(getStatEffectiveValue(actor, statKey));
              if (lc(field) === 'base') return Number(actor?.stats?.[lc(statKey)]?.base ?? actor?.stats?.[lc(statKey)]?.max ?? 0);
              return Number(getStatEffectiveValue(actor, statKey));
            }
            const actorName = (actor === player) ? 'player' : String(actor?.name || '');
            return getActorStatValue(actorName, statKey, field);
          }
          return raw;
        };

        for (const a of actors) {
          const actual = getEffectiveActorParam(a, key);
          const rightVal = __resolveActorParamValue(a, want);

          if (op === 'exists') { if (actual !== undefined) { ok = true; break; } }
          else if (op === 'notexists') { if (actual === undefined) { ok = true; break; } }
          else if (op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte') {
            const left = Number(actual);
            const right = Number(rightVal);
            if (numCompare(left, op, right)) { ok = true; break; }
          }
          else if (op === 'neq') { if (actual !== rightVal) { ok = true; break; } }
          else { if (actual === rightVal) { ok = true; break; } } // default eq
        }

        if (!ok) return false;
        break;
      }


      default:
        return false;
    }
  }

  return true;
}



function normalizeTriggerWhen(triggerWhen) {
  if (!triggerWhen) return [];
  if (Array.isArray(triggerWhen)) return triggerWhen.filter(t => t && t.event);
  if (typeof triggerWhen === 'object' && triggerWhen.event) return [triggerWhen];
  return [];
}

function triggerMatches(triggerWhenObj, eventName, payload) {
  const w = triggerWhenObj;
  if (!w) return false;
  if (w.event !== eventName) return false;

  if ((eventName === 'proximity_enter' || eventName === 'proximity_leave') && w.kind === 'object') {
    const ignoreCover = (w.ignoreCover === true);
    const covered = !!payload.covered;
    const coveredWas = !!payload.coveredWas;
    const rawProximity = !!payload.__rawProximity;

    if (!ignoreCover && covered) return false;
    if (ignoreCover) {
      if (covered && !rawProximity) return false; // ignore cover-induced enter/leave
      if (coveredWas) return false; // avoid double-fire on uncover
    }
  }

  if (w.area && w.area !== payload.area) return false;
  if (w.fromArea && w.fromArea !== payload.fromArea) return false;
  if (w.toArea && w.toArea !== payload.toArea) return false;

  if (w.section && w.section !== payload.section) return false;

  //if (w.direction && payload.direction !== w.direction) return false;

  if (w.npc && lc(w.npc) !== lc(payload?.npc)) return false;

  // generic payload matching (dialog_option, exit_use, etc.)
  for (const key of Object.keys(w)) {
    if (
      key === 'event' ||
      key === 'area' ||
      key === 'section' ||
      key === 'npc' ||
      key === 'party' ||
      key === 'alignment' ||
      key === 'affection' ||
      key === 'option' ||
      key === 'item' ||
      key === 'targetKind' ||
      key === 'targetId' ||
      key === 'targetNpc' ||
      key === 'targetName' ||
      key === 'targetInstanceId' ||
      key === 'sourceKind' ||
      key === 'sourceId' ||
      key === 'sourceNpc' ||
      key === 'sourceName' ||
      key === 'sourceInstanceId' ||
      key === 'ignoreCover'
    ) continue;

    if (payload[key] === undefined) return false;
    if (String(payload[key]) !== String(w[key])) return false;
  }

  // Item targeting (item_use / item_give)
  if (w.item !== undefined) {
    if (lc(String(payload?.item || '')) !== lc(String(w.item))) return false;
  }

  const target = payload?.targetActor;
  if (w.targetKind !== undefined) {
    if (lc(String(target?.kind || '')) !== lc(String(w.targetKind))) return false;
  }
  if (w.targetId !== undefined) {
    const tid = String(target?.id || '');
    if (lc(tid) !== lc(String(w.targetId))) return false;
  }
  if (w.targetNpc !== undefined || w.targetName !== undefined) {
    const want = lc(String(w.targetNpc ?? w.targetName ?? ''));
    const name = lc(String(target?.name || ''));
    if (want && name !== want) return false;
  }
  if (w.targetInstanceId !== undefined) {
    const inst = String(target?.instanceId || '');
    if (String(w.targetInstanceId) !== inst) return false;
  }

  const source = payload?.sourceActor;
  if (w.sourceKind !== undefined) {
    if (lc(String(source?.kind || '')) !== lc(String(w.sourceKind))) return false;
  }
  if (w.sourceId !== undefined) {
    const sid = String(source?.id || '');
    if (lc(sid) !== lc(String(w.sourceId))) return false;
  }
  if (w.sourceNpc !== undefined || w.sourceName !== undefined) {
    const want = lc(String(w.sourceNpc ?? w.sourceName ?? ''));
    const name = lc(String(source?.name || ''));
    if (want && name !== want) return false;
  }
  if (w.sourceInstanceId !== undefined) {
    const inst = String(source?.instanceId || '');
    if (String(w.sourceInstanceId) !== inst) return false;
  }

  // Support "option" in rules (preferred), fallback to optionId
  if (w.option !== undefined) {
    if (String(payload.optionId) !== String(w.option)) return false;
  } else if (w.optionId !== undefined) {
    if (String(payload.optionId) !== String(w.optionId)) return false;
  }

  return true;
}

// ===== Goals (character objectives) =====
function __initGoalStore(store) {
  if (!store || typeof store !== 'object') return;
  if (!Array.isArray(store.goalsActive)) store.goalsActive = [];
  if (!store.goalsHistory || typeof store.goalsHistory !== 'object') store.goalsHistory = Object.create(null);
  if (!store.goalsRemoved || typeof store.goalsRemoved !== 'object') store.goalsRemoved = Object.create(null);
  if (!store.goalsStateActive || typeof store.goalsStateActive !== 'object') store.goalsStateActive = Object.create(null);
  if (!store.goalsProgress || typeof store.goalsProgress !== 'object') store.goalsProgress = Object.create(null);
}

function __normalizeGoalDef(goal) {
  if (!goal || typeof goal !== 'object') return null;
  const id = String(goal.id || '').trim();
  if (!id) return null;
  const maxRaw = (goal.maxCompletions ?? goal.maxTimes ?? goal.maxRepeats ?? 1);
  const max = Number(maxRaw);
  const norm = {
    id,
    name: String(goal.name || id).trim(),
    description: String(goal.description || '').trim(),
    visibility: (lc(goal.visibility || 'public') === 'private') ? 'private' : 'public',
    maxCompletions: (isFinite(max) ? Math.max(0, Math.floor(max)) : 1)
  };
  if (goal.triggerWhen) norm.triggerWhen = goal.triggerWhen;
  if (Array.isArray(goal.state)) norm.state = goal.state;
  if (Array.isArray(goal.effects)) norm.effects = goal.effects;
  if (goal.progress && typeof goal.progress === 'object') norm.progress = goal.progress;
  return norm;
}

function __cloneGoalDef(goal) {
  return JSON.parse(JSON.stringify(goal));
}

function __getGoalMax(goal) {
  const maxRaw = (goal && (goal.maxCompletions ?? goal.maxTimes ?? goal.maxRepeats));
  if (maxRaw == null) return 1;
  const n = Number(maxRaw);
  return isFinite(n) ? Math.max(0, Math.floor(n)) : 1;
}

function __getGoalCount(store, goalId) {
  if (!store || !store.goalsHistory) return 0;
  return Number(store.goalsHistory[goalId] || 0);
}

function __goalCanComplete(store, goal) {
  const max = __getGoalMax(goal);
  if (max === 0) return true;
  const count = __getGoalCount(store, goal.id);
  return count < max;
}

function addGoalToStore(store, goalDef) {
  if (!store) return false;
  __initGoalStore(store);
  const norm = __normalizeGoalDef(goalDef);
  if (!norm) return false;

  const exists = store.goalsActive.some(g => g && g.id === norm.id);
  if (exists) return false;
  if (store.goalsHistory && store.goalsHistory[norm.id]) return false;
  if (store.goalsRemoved && store.goalsRemoved[norm.id]) return false;

  const goal = __cloneGoalDef(norm);
  const count = __getGoalCount(store, goal.id);
  if (goal.maxCompletions !== 0 && count >= goal.maxCompletions) {
    goal._completed = true;
  }

  store.goalsActive.push(goal);

  if (isPublicGoal(goal)) {
    const name = String(goal.name || goal.id || '').trim();
    const desc = String(goal.description || '').trim();
    if (name) {
      const msg = desc ? `NEW GOAL - ${name} - ${desc}` : `NEW GOAL - ${name}`;
      showWorldToast(msg);
    }
  }
  return true;
}

function removeGoalFromStore(store, goalId, outRemoved = null) {
  if (!store) return false;
  __initGoalStore(store);
  const id = String(goalId || '').trim();
  if (!id) return false;

  const idx = store.goalsActive.findIndex(g => g && g.id === id);
  if (idx < 0) return false;

  const [goal] = store.goalsActive.splice(idx, 1);
  if (outRemoved && typeof outRemoved === 'object') outRemoved.goal = goal;
  const count = __getGoalCount(store, id);
  if (count > 0 && lc(goal?.visibility || 'public') !== 'private') {
    store.goalsRemoved[id] = goal;
  }
  return true;
}

function ensureNpcRecordGoals(name, rec) {
  if (!rec || typeof rec !== 'object') return;
  __initGoalStore(rec);
  if (rec._startingGoalsApplied) return;
  if (!npcDetails && !npcDetailsByLc) return;
  const details =
    (npcDetails && npcDetails[name]) ? npcDetails[name]
    : (npcDetailsByLc ? npcDetailsByLc[lc(name)] : null);
  const list = Array.isArray(details?.goals) ? details.goals : [];
  for (const g of list) addGoalToStore(rec, g);
  rec._startingGoalsApplied = true;
}

function ensurePlayerGoals() {
  if (!player || typeof player !== 'object') return;
  __initGoalStore(player);
  if (player._startingGoalsApplied) return;
  if (!npcDetails || !npcDetails.Player) return;
  const list = Array.isArray(npcDetails?.Player?.goals) ? npcDetails.Player.goals : [];
  for (const g of list) addGoalToStore(player, g);
  player._startingGoalsApplied = true;
}

function __resolveGoalTargetStores(who, payload) {
  const out = [];
  const addPlayer = () => { if (player) { __initGoalStore(player); out.push(player); } };
  const addNpcByName = (name) => {
    if (!name) return;
    const rec = ensureNpcRecord(String(name));
    ensureNpcRecordGoals(String(name), rec);
    out.push(rec);
  };

  const w = (who == null) ? 'player' : who;

  if (typeof w === 'string') {
    const k = lc(w);
    if (k === '@party') {
      addPlayer();
      for (const m of party) {
        if (m?.name) addNpcByName(m.name);
      }
      return out;
    }
    if (k === '@self') {
      const sd = payload?.sourceActor;
      if (sd?.kind === 'player') addPlayer();
      else if (sd?.kind === 'npc' && sd?.name) addNpcByName(sd.name);
      return out;
    }
    if (k === '@target') {
      const td = payload?.targetActor;
      if (td?.kind === 'player') addPlayer();
      else if (td?.kind === 'npc' && td?.name) addNpcByName(td.name);
      return out;
    }
    if (k === 'player') {
      addPlayer();
      return out;
    }
    addNpcByName(w);
    return out;
  }

  if (typeof w === 'object') {
    const kind = lc(w.kind || '');
    if (kind === 'player') addPlayer();
    else if (kind === 'npc') addNpcByName(w.name || w.id);
  }

  return out;
}

function __completeGoal(store, goal, payload) {
  if (!store || !goal || !goal.id) return false;
  const id = goal.id;
  const prev = __getGoalCount(store, id);
  const next = prev + 1;
  store.goalsHistory[id] = next;

  const isPublic = isPublicGoal(goal);
  if (isPublic) {
    const owner = (store === player) ? (player?.name || 'Player') : (store?.name || store?.id || 'NPC');
    const label = String(goal.name || goal.id || '').trim();
    if (label) {
      showWorldToast(`${owner} - ${label} - COMPLETE`);
    }
  }

  if (Array.isArray(goal.effects) && goal.effects.length) {
    applyRuleEffects({ effects: goal.effects }, payload || null);
  }

  const max = __getGoalMax(goal);
  if (max !== 0 && next >= max) {
    goal._completed = true;
  }
  return true;
}

function evaluateGoalsForStore(store, eventName, payload) {
  if (!store || !Array.isArray(store.goalsActive) || store.goalsActive.length === 0) return;
  __initGoalStore(store);

  for (const goal of store.goalsActive) {
    if (!goal || !goal.id) continue;
    if (!__goalCanComplete(store, goal)) continue;

    const hasTrigger = !!goal.triggerWhen;
    const hasState = Array.isArray(goal.state) && goal.state.length > 0;

    if (hasTrigger) {
      const triggers = normalizeTriggerWhen(goal.triggerWhen);
      let match = false;
      for (const tw of triggers) {
        if (triggerMatches(tw, eventName, payload || {})) { match = true; break; }
      }
      if (!match) continue;
      if (hasState && !evaluateRuleState(goal, payload)) continue;
      __completeGoal(store, goal, payload);
      continue;
    }

    if (hasState) {
      const shouldBeActive = evaluateRuleState(goal, payload);
      const wasActive = !!store.goalsStateActive[goal.id];
      if (shouldBeActive && !wasActive) {
        __completeGoal(store, goal, payload);
      }
      store.goalsStateActive[goal.id] = shouldBeActive;
    }
  }
}

function evaluateAllGoalsForEvent(eventName, payload) {
  if (!eventName) return;
  if (player) evaluateGoalsForStore(player, eventName, payload);
  for (const rec of Object.values(npcRegistry || {})) {
    if (!rec) continue;
    evaluateGoalsForStore(rec, eventName, payload);
  }
}

// ===== Pathfinding (area + section) for goal progress =====
let __areaGraphCache = null; // { nodesByArea, edges }

function __getAreaSections(areaName) {
  const area = buildAreaFromDefinition(areaName);
  if (!area || !Array.isArray(area.sections)) return null;
  return area.sections;
}

function __getSectionIndexByName(areaName, sectionName) {
  const sections = __getAreaSections(areaName);
  if (!sections || !sectionName) return 0;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i]?.name === sectionName) return i;
  }
  return 0;
}

function __nodeKey(areaName, sectionIndex) {
  return `${String(areaName)}::${Number(sectionIndex) || 0}`;
}

function __ensureAreaGraph() {
  if (__areaGraphCache) return __areaGraphCache;
  if (!areasData || typeof areasData !== 'object') return null;

  const nodesByArea = new Map(); // area -> sectionCount
  const edges = new Map(); // nodeKey -> Set(nodeKey)

  const addEdge = (a, b) => {
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a).add(b);
  };

  for (const areaName of Object.keys(areasData)) {
    const sections = __getAreaSections(areaName);
    if (!sections) continue;
    nodesByArea.set(areaName, sections.length);

    for (let i = 0; i < sections.length; i++) {
      const from = __nodeKey(areaName, i);
      if (i > 0) addEdge(from, __nodeKey(areaName, i - 1));
      if (i < sections.length - 1) addEdge(from, __nodeKey(areaName, i + 1));
    }

    const def = areasData[areaName] || {};
    const left = def.leftarea || null;
    const right = def.rightarea || null;
    if (left) {
      const leftSections = __getAreaSections(left);
      if (leftSections && leftSections.length) {
        const a = __nodeKey(areaName, 0);
        const b = __nodeKey(left, leftSections.length - 1);
        addEdge(a, b);
        addEdge(b, a);
      }
    }
    if (right) {
      const a = __nodeKey(areaName, sections.length - 1);
      const b = __nodeKey(right, 0);
      addEdge(a, b);
      addEdge(b, a);
    }

    // Exits (up/down)
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const exits = Array.isArray(sec?.exits) ? sec.exits : [];
      for (const ex of exits) {
        const target = parseTargetExitString(ex?.target);
        if (!target || !target.area) continue;
        const targetIdx = target.section
          ? __getSectionIndexByName(target.area, target.section)
          : 0;
        addEdge(__nodeKey(areaName, i), __nodeKey(target.area, targetIdx));
      }
    }
  }

  __areaGraphCache = { nodesByArea, edges };
  return __areaGraphCache;
}

function __getDistanceToTarget(areaName, sectionIndex, targetArea, targetSection) {
  const graph = __ensureAreaGraph();
  if (!graph) return null;

  const start = __nodeKey(areaName, sectionIndex);
  const edges = graph.edges;

  const wantArea = String(targetArea || '');
  if (!wantArea) return null;

  const targetNodes = new Set();
  if (targetSection) {
    const idx = __getSectionIndexByName(wantArea, targetSection);
    targetNodes.add(__nodeKey(wantArea, idx));
  } else {
    const count = graph.nodesByArea.get(wantArea) || 0;
    for (let i = 0; i < count; i++) targetNodes.add(__nodeKey(wantArea, i));
  }

  if (targetNodes.has(start)) return 0;

  const q = [start];
  const dist = new Map();
  dist.set(start, 0);

  while (q.length) {
    const cur = q.shift();
    const d = dist.get(cur) || 0;
    const next = edges.get(cur);
    if (!next) continue;
    for (const n of next) {
      if (dist.has(n)) continue;
      const nd = d + 1;
      if (targetNodes.has(n)) return nd;
      dist.set(n, nd);
      q.push(n);
    }
  }

  return null;
}

function __goalProgressTargetActorName(goal, ownerName) {
  const p = goal?.progress || null;
  if (!p || typeof p !== 'object') return ownerName || null;
  const who = p.actor || p.npc || p.who || null;
  if (who == null || who === '') return ownerName || null;
  return String(who);
}

function evaluateGoalProgressForEvent(eventName, payload) {
  if (eventName !== 'section_enter') return;
  const actorName = String(payload?.npc || '');
  if (!actorName) return;
  const area = String(payload?.area || '');
  const section = String(payload?.section || '');
  if (!area || !section) return;

  const curIdx = __getSectionIndexByName(area, section);

  const stores = [];
  if (player) stores.push({ name: player?.name || 'Player', store: player });
  for (const [name, rec] of Object.entries(npcRegistry || {})) {
    if (!rec) continue;
    stores.push({ name, store: rec });
  }

  for (const { name: ownerName, store } of stores) {
    if (!store || !Array.isArray(store.goalsActive)) continue;
    __initGoalStore(store);
    for (const goal of store.goalsActive) {
      const p = goal?.progress;
      if (!p || typeof p !== 'object') continue;
      if (!__goalCanComplete(store, goal)) continue;
      if (lc(p.type || 'location') !== 'location') continue;

      const targetActor = __goalProgressTargetActorName(goal, ownerName);
      if (lc(targetActor) !== lc(actorName)) continue;

      const targetArea = p?.target?.area ?? p?.area ?? null;
      const targetSection = p?.target?.section ?? p?.section ?? null;
      if (!targetArea) continue;

      const dist = __getDistanceToTarget(area, curIdx, targetArea, targetSection);
      if (!isFinite(dist)) continue;

      const perGoal = store.goalsProgress[goal.id] || (store.goalsProgress[goal.id] = Object.create(null));
      const key = lc(targetActor);
      const prev = (perGoal[key] != null) ? Number(perGoal[key]) : null;

      if (prev != null) {
        if (dist < prev && Array.isArray(p.closerEffects) && p.closerEffects.length) {
          const p2 = { ...(payload || {}), __goalId: goal.id, __goalProgress: 'closer' };
          applyRuleEffects({ effects: p.closerEffects }, p2);
        } else if (dist > prev && Array.isArray(p.fartherEffects) && p.fartherEffects.length) {
          const p2 = { ...(payload || {}), __goalId: goal.id, __goalProgress: 'farther' };
          applyRuleEffects({ effects: p.fartherEffects }, p2);
        }
      }

      perGoal[key] = dist;
    }
  }
}


const __eventCounts = {
  global: Object.create(null),
  area: Object.create(null)
};

function stableKey(obj) {
  if (!obj) return '';
  const keys = Object.keys(obj).sort();
  const out = [];
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) out.push(k + ':' + v.join('|'));
    else out.push(k + ':' + String(v));
  }
  return out.join(',');
}

function eventCountKey(req) {
  const match = req.match || {};
  return req.event + '::' + stableKey(match);
}

// NOTE: prereqs are checked BEFORE increment, so this returns the current stored count.
// If req.includeCurrent === true and the CURRENT event matches the req, it adds 1 for the check only.
function getEventCount(req, payload, currentEventName) {
  const scope = (req.scope === 'global') ? 'global' : 'area';
  const key = eventCountKey(req);
  let base = __eventCounts[scope][key] || 0;

  if (req.includeCurrent === true && req.event === currentEventName) {
    // if the current payload matches the req.match, treat it as +1 for evaluation only
    const m = req.match || {};
    let matches = true;
    for (const k of Object.keys(m)) {
      if (k === 'section') {
        if (!payload || payload.section === undefined) { matches = false; break; }
        if (String(payload.section) !== String(m.section)) { matches = false; break; }
      } else {
        if (!payload || payload[k] === undefined) { matches = false; break; }
        if (String(payload[k]) !== String(m[k])) { matches = false; break; }
      }
    }

    if (matches) base += 1;
  }

  return base;
}

function bumpEventCounts(eventName, payload) {
  // We only track counts for rules that ask for them (requires uses req.match)
  // So we just record a “full payload” key AND a “section-aware” key as needed later.
  // For now: record these common shapes:
  const area = payload && payload.area ? String(payload.area) : '';
  const section = payload && payload.section ? String(payload.section) : '';
  const npc = payload && payload.npc ? String(payload.npc) : '';
  const option = payload && payload.option ? String(payload.option) : '';

  const candidates = [
    { scope: 'global', match: {} },
    { scope: 'area',   match: { area } },
    { scope: 'area',   match: { area, sections: section ? [section] : [] } },
    { scope: 'global', match: { npc } },
    { scope: 'global', match: { npc, option } },
    { scope: 'area',   match: { area, npc } },
    { scope: 'area',   match: { area, npc, sections: section ? [section] : [] } }
  ];

  for (const c of candidates) {
    // avoid junk keys
    if (c.match.area === '') delete c.match.area;
    if (c.match.npc === '') delete c.match.npc;
    if (c.match.option === '') delete c.match.option;
    if (c.match.sections && c.match.sections.length === 0) delete c.match.sections;

    const k = eventName + '::' + stableKey(c.match);
    __eventCounts[c.scope][k] = (__eventCounts[c.scope][k] || 0) + 1;
  }
}

function rebuildRulesIndex() {
  rulesByEvent = Object.create(null);

  for (const r of (rulesData || [])) {
    if (!r || !r.id) continue;

    // Index STATE-only rules (those without triggerWhen)
    indexStateRule(r);

    // Index EVENT-driven rules
    const triggers = normalizeTriggerWhen(r.triggerWhen);
    for (const t of triggers) {
      const ev = t.event;
      if (!rulesByEvent[ev]) rulesByEvent[ev] = [];
      rulesByEvent[ev].push({ rule: r, trigger: t });
    }
  }
}

function applyNpcStatDelta(who, stat, deltaRaw, fieldRaw = 'current') {
  const delta = Number(deltaRaw);
  if (!who || !stat || !isFinite(delta)) return;

  const statKey = lc(stat);
  const field = normStatKey(fieldRaw) || 'current';

  const before = getActorStatRec(who, statKey);
  const prev = (field === 'base') ? Number(before?.base) : Number(before?.current);

  const d = mitigateDeltaForActor(who, statKey, field, delta);
  addActorStatField(who, statKey, field, d);

  const after = getActorStatRec(who, statKey);
  const next = (field === 'base') ? Number(after?.base) : Number(after?.current);

  emitGameEvent('stat_change', { actor: who, stat: statKey, field, prev, next });
}


function applyNpcStatSet(who, stat, valueRaw, fieldRaw = 'current') {
  const value = Number(valueRaw);
  if (!who || !stat || !isFinite(value)) return;

  const statKey = lc(stat);
  const field = normStatKey(fieldRaw) || 'current';

  const before = getActorStatRec(who, statKey);
  const prev = (field === 'base') ? Number(before?.base) : Number(before?.current);

  setActorStatField(who, statKey, field, value);

  const after = getActorStatRec(who, statKey);
  const next = (field === 'base') ? Number(after?.base) : Number(after?.current);

  emitGameEvent('stat_change', { actor: who, stat: statKey, field, prev, next });
}



function applyMovementEffect(eff, payload) {
  if (!eff || typeof eff !== 'object') return;

  const who = eff.actor || eff.npc;
  if (!who) return;

  const actor =
    (lc(who) === 'player') ? player :
    getOrCreateNpcByName(who);

  if (!actor) return;

  const mode = lc(eff.mode || eff.aiMode || eff.movement || eff.state || 'stationary');

  // Goal spec can be supplied as:
  //   eff.goal, eff.goalPosition, eff.goalRef
  const goalSpec = eff.goal || eff.goalPosition || eff.goalRef || null;

  if (mode === 'moving') {
    // Prefer a goal spec; fall back to numeric goalX if provided
    let goalRef = null;

    if (goalSpec) {
      goalRef = normalizeGoalSpec(goalSpec, payload, actor);
    } else if (eff.goalX !== undefined && eff.goalX !== null) {
      const x = Number(eff.goalX);
      if (isFinite(x)) goalRef = { type: 'worldX', x };
    }

    if (goalRef) {
      // If it’s a fixed worldX, store as goalX; otherwise store as goalRef (dynamic)
      if (lc(goalRef.type) === 'worldx') {
        setNpcAiMode(actor, 'moving', { goalX: goalRef.x });
      } else {
        setNpcAiMode(actor, 'moving', { goalRef });
      }
    } else {
      // moving with no goal => do nothing but keep mode
      setNpcAiMode(actor, 'moving', {});
    }

    return;
  }

  if (mode === 'waiting') {
    setNpcAiMode(actor, 'waiting', { anchorX: (eff.anchorX !== undefined ? eff.anchorX : actor.worldX) });
    return;
  }

  setNpcAiMode(actor, 'stationary', {});
}

function __actorDescriptorForReset(actor) {
  if (!actor) return null;
  if (typeof targetActorDescriptorFromActor === 'function') {
    return targetActorDescriptorFromActor(actor);
  }
  if (actor === player) return { kind: 'player' };
  if (actor?.name) return { kind: 'npc', name: actor.name };
  if (actor?.id && actor?.instanceId) return { kind: 'mob', id: actor.id, instanceId: actor.instanceId };
  return null;
}

function __snapshotNpcAiState(actor) {
  if (!actor || typeof actor !== 'object') return null;
  return {
    aiMode: actor.aiMode ?? null,
    aiGoalX: actor.aiGoalX ?? null,
    aiGoalRef: actor.aiGoalRef ? JSON.parse(JSON.stringify(actor.aiGoalRef)) : null,
    aiAnchorX: actor.aiAnchorX ?? null,
    aiNextDecisionAtMs: actor.aiNextDecisionAtMs ?? null,
    aiPhase: actor.aiPhase ?? null,
    aiMoveTargetX: actor.aiMoveTargetX ?? null
  };
}

function __restoreNpcAiState(actor, snap) {
  if (!actor || !snap) return false;
  actor.aiMode = snap.aiMode ?? actor.aiMode;
  actor.aiGoalX = snap.aiGoalX ?? null;
  actor.aiGoalRef = snap.aiGoalRef ?? null;
  actor.aiAnchorX = snap.aiAnchorX ?? actor.aiAnchorX;
  actor.aiNextDecisionAtMs = snap.aiNextDecisionAtMs ?? actor.aiNextDecisionAtMs;
  actor.aiPhase = snap.aiPhase ?? actor.aiPhase;
  actor.aiMoveTargetX = snap.aiMoveTargetX ?? actor.aiMoveTargetX;
  return true;
}

function applyRuleEffects(rule, payload) {
  const effects = Array.isArray(rule?.effects) ? rule.effects : [];
  const __effectDurMs = (eff) => {
    const v = Number(eff?.durationMs ?? eff?.ms ?? eff?.duration ?? 0);
    return (isFinite(v) && v > 0) ? Math.floor(v) : 0;
  };
  const resetSpec = payload?.__resetSpec || null;
  const resetCapture = (resetSpec && isFinite(Number(resetSpec.resetMs)) && Number(resetSpec.resetMs) > 0)
    ? payload?.__resetCapture
    : null;
  const __queueResetAction = (action) => {
    if (!resetCapture || !action) return;
    if (!Array.isArray(resetCapture.actions)) resetCapture.actions = [];
    resetCapture.actions.push(action);
  };
  const __queueTagInverse = (actorDesc, tag, inverseType) => {
    if (!actorDesc || !tag || !inverseType) return;
    __queueResetAction({
      type: inverseType,
      npc: actorDesc,
      tag
    });
  };
  const __setTagExpiry = (actor, tag, expiresAtMs) => {
    if (!actor) return;
    if (!actor.tagExpiresAtMs || typeof actor.tagExpiresAtMs !== 'object') {
      actor.tagExpiresAtMs = Object.create(null);
    }
    const k = lc(tag);
    if (!k) return;
    actor.tagExpiresAtMs[k] = expiresAtMs;
  };
  const __clearTagExpiry = (actor, tag) => {
    if (!actor || !actor.tagExpiresAtMs) return;
    const k = lc(tag);
    if (!k) return;
    delete actor.tagExpiresAtMs[k];
  };

  // Snapshot party eligibility BEFORE applying this rule's effects,
  // so we can attribute a drop reason to the threshold crossing.
  const _partyEligBefore = new Map();
  for (const m of party.slice()) {
    const curA0 = Number(getActorStatValue(m?.name || '', 'alignment', 'current') ?? 0);
    const minA0Raw = getActorStatValue(m?.name || '', 'minalignment', 'base');
    const curF0 = Number(getActorStatValue(m?.name || '', 'affection', 'current') ?? 0);

    _partyEligBefore.set(m, {
      belowMinAlignSum: (minA0Raw == null) ? false : ((curA0 + curF0) < Number(minA0Raw))
    });
  }

  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;
    if (eff.type === 'updateStat' && lc(String(eff.npc || '')) === 'mira' && (lc(String(eff.stat || '')) === 'alignment' || lc(String(eff.stat || '')) === 'affection')) {
      const ruleId = rule?.id || null;
      const goalId = payload?.__goalId || null;
      const goalProg = payload?.__goalProgress || null;
      const evt = payload?.__eventName || payload?.event || null;
      const src = payload?.ability || payload?.rule || payload?.dialog || payload?.source || null;
      console.log(
        `dbg/mira_stat_source stat=${eff.stat} delta=${eff.delta} rule=${ruleId || 'null'} goal=${goalId || 'null'} progress=${goalProg || 'null'} event=${evt || 'null'} source=${src || 'null'}`
      );
    }
    if (eff.type === 'setFlag') {
      const scope = eff.scope || 'area';
      const key = eff.key;
      const value = (eff.value !== undefined) ? eff.value : true;
      setFlag(scope, key, value);
      continue;
    }

    if (eff.type === 'setFlagTimed') {
      const scope = eff.scope || 'area';
      const key = eff.key;
      const value = (eff.value !== undefined) ? eff.value : true;
      const durationMs = Number(eff.durationMs || eff.ms || eff.duration || 0);
      setFlagTimed(scope, key, value, durationMs);
      continue;
    }

    if (eff.type === 'restoreNpcAiState') {
      const spec = normalizeActorSpec(eff, payload);
      const actors = resolveActorsFromSpec(spec, payload);
      for (const a of actors) {
        __restoreNpcAiState(a, eff.state || eff.aiState || null);
      }
      continue;
    }

    if (eff.type === 'deleteActorParam') {
      const key = String(eff?.key || eff?.param || '');
      if (!key) continue;
      const spec = normalizeActorSpec(eff, payload);
      const actors = resolveActorsFromSpec(spec, payload);
      for (const a of actors) {
        if (!a) continue;
        const kind = getActorKind(a);
        if (kind === 'mob') {
          if (!a.paramOverrides) continue;
          deleteByDotPath(a.paramOverrides, key);
        } else {
          if ((kind === 'npc' || kind === 'mob') && a.__registryRef) {
            deleteByDotPath(a.__registryRef, key);
          } else {
            deleteByDotPath(a, key);
          }
        }
      }
      continue;
    }

    if (eff.type === 'removeItemInstances') {
      const id = eff.id || eff.item || eff.itemId;
      const uids = Array.isArray(eff.uids) ? eff.uids.map(x => String(x)) : [];
      if (!id || uids.length === 0) continue;
      const spec = normalizeActorSpec({ actor: eff.actor ?? eff.npc ?? eff.target ?? eff.subject }, payload);
      const actors = resolveActorsFromSpec(spec, payload);
      const list = actors.length ? actors : [player];
      for (const a of list) {
        if (!a) continue;
        for (const uid of uids) {
          removeItemInstanceFromActorInventory(a, id, uid);
        }
      }
      continue;
    }

    if (eff.type === 'openMap') {
      setMapOverlayOpen(true, false);
      continue;
    }

    if (eff.type === 'updateStat') {
      let who = (eff.npc == null) ? 'player' : String(eff.npc);
      const statKey = normStatKey(eff.stat);
      const durMs = __effectDurMs(eff);
      const delta = Number(eff.delta || 0);
      const def = getStatDef(statKey);

      // Allow payload targeting: npc:'@self'
      if (lc(who) === '@self') {
        const sd = payload?.sourceActor;
        if (sd && sd.kind === 'npc' && sd.name) who = String(sd.name);
        else if (sd && sd.kind === 'player') who = 'player';
        else if (sd && sd.kind === 'mob' && sd.id && sd.instanceId) who = sd;
        else who = '';
      }

      // Allow payload targeting: npc:'@target'
      if (lc(who) === '@target') {
        const td = payload?.targetActor;
        if (td && td.kind === 'npc' && td.name) who = String(td.name);
        else if (td && td.kind === 'player') who = 'player';
        else if (td && td.kind === 'mob' && td.id && td.instanceId) who = td;
        else who = '';
      }

      if (!who) continue;

      if ((lc(who) === 'player') && statAppliesToActor(statKey, player)) {
        if (durMs > 0 && def && def.type !== 'depletable') {
          addTimedStatModForActor(player, statKey, delta, durMs);
        } else {
          applyStatChangeWithFeedback(
            { kind: 'player' },
            statKey,
            { mode: 'delta', field: (eff.field || 'current'), delta },
            payload
          );
          if (durMs > 0 && isFinite(delta) && delta !== 0) {
            const expiresAtMs = getGameNowMs() + durMs;
            scheduleTimedEffect(expiresAtMs, () => {
              applyStatChangeWithFeedback(
                { kind: 'player' },
                statKey,
                { mode: 'delta', field: (eff.field || 'current'), delta: -delta },
                payload
              );
            });
          }
        }
        continue;
      }
      
      if (who && typeof who === 'object' && lc(who.kind) === 'mob') {
        if (durMs > 0 && def && def.type !== 'depletable') {
          const mobActor = resolveActorFromTargetDescriptor(who);
          if (mobActor) addTimedStatModForActor(mobActor, statKey, delta, durMs);
        } else {
          applyStatChangeWithFeedback(
            who,
            statKey,
            { mode: 'delta', field: (eff.field || 'current'), delta },
            payload
          );
          if (durMs > 0 && isFinite(delta) && delta !== 0) {
            const targetDesc = who;
            const expiresAtMs = getGameNowMs() + durMs;
            scheduleTimedEffect(expiresAtMs, () => {
              applyStatChangeWithFeedback(
                targetDesc,
                statKey,
                { mode: 'delta', field: (eff.field || 'current'), delta: -delta },
                payload
              );
            });
          }
        }
        continue;
      }
      const npcTarget = { kind: 'npc', name: String(who) };
      if (lc(npcTarget.name) === 'mira' && (statKey === 'alignment' || statKey === 'affection') && (eff.field || 'current') === 'current') {
        const src = payload?.ability || payload?.rule || payload?.dialog || payload?.source || null;
        const effJson = JSON.stringify(eff);
        console.log(`dbg/mira_stat_source stat=${statKey} delta=${delta} source=${src} eff=${effJson}`);
      }
      if (durMs > 0 && def && def.type !== 'depletable') {
        const actor = findActorByName(npcTarget.name) || ensureNpcRecord(npcTarget.name);
        if (actor) addTimedStatModForActor(actor, statKey, delta, durMs);
      } else {
        applyStatChangeWithFeedback(
          npcTarget,
          statKey,
          { mode: 'delta', field: (eff.field || 'current'), delta },
          payload
        );
        if (durMs > 0 && isFinite(delta) && delta !== 0) {
          const expiresAtMs = getGameNowMs() + durMs;
          scheduleTimedEffect(expiresAtMs, () => {
            applyStatChangeWithFeedback(
              npcTarget,
              statKey,
              { mode: 'delta', field: (eff.field || 'current'), delta: -delta },
              payload
            );
          });
        }
      }
      continue;
    }

    if (eff.type === 'setStat') {
      let who = (eff.npc == null) ? 'player' : String(eff.npc);
      const statKey = normStatKey(eff.stat);
      const field = normStatKey(eff.field) || 'current';
      const def = getStatDef(statKey);
      const __resolveSetStatValue = (targetActor, raw, targetName = '') => {
        if (raw && typeof raw === 'object' && raw.stat) {
          const sKey = String(raw.stat || '');
          const f = raw.field || 'current';
          if (!sKey) return null;
          if (targetActor && isMobActor(targetActor)) {
            if (lc(f) === 'current') return Number(targetActor?.stats?.[lc(sKey)]?.current);
            if (lc(f) === 'max') return Number(getStatEffectiveValue(targetActor, sKey));
            if (lc(f) === 'base') return Number(targetActor?.stats?.[lc(sKey)]?.base ?? targetActor?.stats?.[lc(sKey)]?.max ?? 0);
            return Number(getStatEffectiveValue(targetActor, sKey));
          }
          const nm = (targetActor === player) ? 'player' : (String(targetActor?.name || targetName || ''));
          return getActorStatValue(nm, sKey, f);
        }
        return raw;
      };

      // Allow payload targeting: npc:'@self'
      if (lc(who) === '@self') {
        const sd = payload?.sourceActor;
        if (sd && sd.kind === 'npc' && sd.name) who = String(sd.name);
        else if (sd && sd.kind === 'player') who = 'player';
        else if (sd && sd.kind === 'mob' && sd.id && sd.instanceId) who = sd;
        else who = '';
      }

      // Allow payload targeting: npc:'@target'
      if (lc(who) === '@target') {
        const td = payload?.targetActor;
        if (td && td.kind === 'npc' && td.name) who = String(td.name);
        else if (td && td.kind === 'player') who = 'player';
        else if (td && td.kind === 'mob' && td.id && td.instanceId) who = td;
        else who = '';
      }

      if (!who) continue;

      if (statKey === 'alignment' && field === 'current') {
        const rawVal = eff.value;
        const isZero = (rawVal === 0 || rawVal === '0' || (rawVal && typeof rawVal === 'object' && Number(rawVal.value) === 0));
        if (isZero && lc(String(who)) === 'mira') {
          console.log('[align-reset]', {
            npc: who,
            value: eff.value,
            payloadSource: payload?.source || null,
            ability: payload?.ability || null,
            rule: payload?.rule || null,
            dialog: payload?.dialog || null
          });
        }
      }

      if ((lc(who) === 'player') && statAppliesToActor(statKey, player)) {
        let prevVal = null;
        if (resetCapture && player?.stats?.[statKey] && def) {
          prevVal = getStatRecFieldValue(def, player.stats[statKey], field);
        }
        const resolvedValue = __resolveSetStatValue(player, eff.value, 'player');
        applyStatChangeWithFeedback(
          { kind: 'player' },
          statKey,
          { mode: 'set', field: (eff.field || 'current'), value: resolvedValue },
          payload
        );
        if (resetCapture && isFinite(prevVal)) {
          __queueResetAction({
            type: 'setStat',
            npc: 'player',
            stat: statKey,
            field: normalizeStatFieldForDef(def, field),
            value: prevVal
          });
        }
        continue;
      }

      if (who && typeof who === 'object' && lc(who.kind) === 'mob') {
        const mobActor = resolveActorFromTargetDescriptor(who);
        const resolvedValue = __resolveSetStatValue(mobActor, eff.value);
        applyStatChangeWithFeedback(
          who,
          statKey,
          { mode: 'set', field: (eff.field || 'current'), value: resolvedValue },
          payload
        );
        continue;
      }

      const npcName = String(who);
      let prevVal = null;
      if (resetCapture) {
        const a = findActorByName(npcName);
        if (a && a.stats && a.stats[statKey] && def) {
          prevVal = getStatRecFieldValue(def, a.stats[statKey], field);
        }
      }
      const npcActor = findActorByName(npcName) || ensureNpcRecord(npcName);
      const resolvedValue = __resolveSetStatValue(npcActor, eff.value, npcName);
      applyStatChangeWithFeedback(
        { kind: 'npc', name: npcName },
        statKey,
        { mode: 'set', field: (eff.field || 'current'), value: resolvedValue },
        payload
      );
      if (resetCapture && isFinite(prevVal)) {
        __queueResetAction({
          type: 'setStat',
          npc: npcName,
          stat: statKey,
          field,
          value: prevVal
        });
      }
      continue;

    }

    if (eff.type === 'addItem') {
      const id = eff.id || eff.item || eff.itemId;
      const qty = (eff.qty !== undefined) ? eff.qty : (eff.count !== undefined ? eff.count : 1);
      const targetDesc = payload?.targetActor || payload?.sourceActor || null;
      const target =
        (targetDesc && targetDesc.kind === 'npc' && targetDesc.name)
          ? findActorByName(targetDesc.name)
          : (targetDesc && targetDesc.kind === 'player')
            ? player
            : null;
      const outUids = resetCapture ? [] : null;
      if (target) {
        addItemToActorInventory(target, id, qty, outUids);
      } else {
        addItemToInventory(id, qty, outUids);
      }
      if (resetCapture && outUids && outUids.length) {
        const desc = target ? __actorDescriptorForReset(target) : { kind: 'player' };
        if (desc) {
          __queueResetAction({
            type: 'removeItemInstances',
            actor: desc,
            id,
            uids: outUids
          });
        }
      }
      continue;
    }

        // ===== World time effects =====
    if (eff.type === 'advanceTime') {
      const minutes = Number(eff.minutes ?? eff.min ?? eff.deltaMin ?? eff.delta ?? 0);
      __advanceWorldTimeByMinutes(minutes, { source: 'rule', ruleId: rule?.id, payload });
      continue;
    }

    if (eff.type === 'setTime') {
      const tMin = Number(eff.tMin ?? eff.minutes ?? eff.min);
      if (isFinite(tMin)) {
        __setWorldTimeMin(tMin, { source: 'effects' });
      }
      continue;
    }


    if (eff.type === 'setTimePhase') {
      const phase = eff.phase ?? eff.is ?? eff.to ?? eff.value;
      if (phase != null) {
        __setWorldTimeToPhase(String(phase), { source: 'rule', ruleId: rule?.id, payload });
      }
      continue;
    }

    if (eff.type === 'skipToPhase') {
      const phase = eff.phase ?? eff.is ?? eff.to ?? eff.value;
      if (phase != null) {
        __skipWorldTimeToNextPhase(String(phase), { source: 'rule', ruleId: rule?.id, payload });
      }
      continue;
    }


    if (eff.type === 'removeItem') {
      const id = eff.id || eff.item || eff.itemId;
      const qty = (eff.qty !== undefined) ? eff.qty : (eff.count !== undefined ? eff.count : 1);
      removeItemFromInventory(id, qty);
      continue;
    }

    if (eff.type === 'addGoal') {
      const goal = eff.goal || eff.value || null;
      if (!goal) continue;
      const targets = __resolveGoalTargetStores((eff.actor ?? eff.npc ?? 'player'), payload);
      for (const t of targets) {
        const added = addGoalToStore(t, goal);
        if (resetCapture && added) {
          const desc = (t === player)
            ? { kind: 'player' }
            : (t?.name ? { kind: 'npc', name: t.name } : null);
          if (desc) {
            const goalId = String(goal.id || goal.goalId || goal.value || goal);
            if (goalId) {
              __queueResetAction({
                type: 'removeGoal',
                actor: desc,
                goalId
              });
            }
          }
        }
      }
      continue;
    }

    if (eff.type === 'removeGoal') {
      const goalId = eff.goalId || eff.id || eff.goal || eff.value;
      if (!goalId) continue;
      const targets = __resolveGoalTargetStores((eff.actor ?? eff.npc ?? 'player'), payload);
      for (const t of targets) {
        const outRemoved = resetCapture ? {} : null;
        const removed = removeGoalFromStore(t, goalId, outRemoved);
        if (resetCapture && removed && outRemoved?.goal) {
          const desc = (t === player)
            ? { kind: 'player' }
            : (t?.name ? { kind: 'npc', name: t.name } : null);
          if (desc) {
            __queueResetAction({
              type: 'addGoal',
              actor: desc,
              goal: outRemoved.goal
            });
          }
        }
      }
      continue;
    }

    if (eff.type === 'setMovement' || eff.type === 'setNpcMovement' || eff.type === 'setNpcAiMode') {
      // Back-compat: setNpcAiMode can pass { npc, mode, goalX } OR the new goal spec
      if (resetCapture) {
        const who = eff.actor || eff.npc;
        if (who) {
          const actor =
            (lc(who) === 'player') ? player :
            getOrCreateNpcByName(who);
          if (actor) {
            const snap = __snapshotNpcAiState(actor);
            const desc = __actorDescriptorForReset(actor);
            if (snap && desc) {
              __queueResetAction({
                type: 'restoreNpcAiState',
                actor: desc,
                state: snap
              });
            }
          }
        }
      }
      applyMovementEffect(eff, payload);
      continue;
    }

    if (eff.type === 'updateMobHp') {
      const mobId = lc(eff?.id || eff?.mob || eff?.mobId || '');
      if (!mobId) continue;

      const useInContact = !!eff?.inContact;
      let wantInstanceId = String(eff?.instanceId || eff?.instance || '');

      if (!wantInstanceId && useInContact) {
        wantInstanceId = String(payload?.mobInstanceId || '');
      }

      const delta = Number(eff.delta ?? eff.value ?? 0);
      if (!isFinite(delta) || delta === 0) continue;

      applyStatChangeWithFeedback(
        { kind: 'mob', id: mobId, instanceId: wantInstanceId },
        'hp',
        { mode: 'delta', field: 'value', delta },
        payload
      );

      continue;
    }


    if (eff.type === 'setMobHp') {
      const mobId = lc(eff?.id || eff?.mob || eff?.mobId || '');
      if (!mobId) continue;

      const useInContact = !!eff?.inContact;
      let wantInstanceId = String(eff?.instanceId || eff?.instance || '');

      if (!wantInstanceId && useInContact) {
        wantInstanceId = String(payload?.mobInstanceId || '');
      }

      const value = Number(eff.value);
      if (!isFinite(value)) continue;

      let prevVal = null;
      if (resetCapture) {
        const m = resolveActorFromTargetDescriptor({ kind: 'mob', id: mobId, instanceId: wantInstanceId });
        prevVal = Number(m?.stats?.hp?.current ?? 0);
      }

      applyStatChangeWithFeedback(
        { kind: 'mob', id: mobId, instanceId: wantInstanceId },
        'hp',
        { mode: 'set', field: 'value', value },
        payload
      );
      if (resetCapture && isFinite(prevVal)) {
        __queueResetAction({
          type: 'setMobHp',
          id: mobId,
          instanceId: wantInstanceId,
          value: prevVal
        });
      }

      continue;
    }

    if (eff.type === 'setActorParam') {
      const key = String(eff?.key || eff?.param || '');
      if (!key) continue;

      const spec = normalizeActorSpec(eff, payload);
      const actors = resolveActorsFromSpec(spec, payload);
      if (!actors.length) continue;

      const kNorm = lc(key);
      const isAiKey = (kNorm === 'mode' || kNorm === 'aimode' || kNorm === 'goalx' || kNorm === 'aigoalx' || kNorm === 'anchorx');
      const isTargetAdd = (kNorm === 'targetadd');
      const isTargetRemove = (kNorm === 'targetremove');

      for (const a of actors) {
        let prevVal = undefined;
        let prevSnap = null;
        let hadTarget = false;

        if (resetCapture) {
          if (isAiKey) {
            prevSnap = __snapshotNpcAiState(a);
          } else if (isTargetAdd || isTargetRemove) {
            const td = (() => {
              const v = eff.value;
              if (typeof v === 'string') {
                const s = lc(v);
                if (s === 'player') return { kind: 'player' };
                return { kind: 'npc', name: String(v) };
              }
              if (v && typeof v === 'object') {
                const kk = lc(v.kind || '');
                if (kk === 'player') return { kind: 'player' };
                if (kk === 'npc') return { kind: 'npc', name: String(v.name || v.id || '') };
                if (kk === 'mob') return { kind: 'mob', id: String(v.id || ''), instanceId: String(v.instanceId || '') };
              }
              return null;
            })();
            if (td && Array.isArray(a.attackTargetQueue)) {
              const k2 = targetKeyFromDescriptor(td);
              hadTarget = a.attackTargetQueue.some(x => targetKeyFromDescriptor(x) === k2);
            }
          } else {
            const kind = getActorKind(a);
            prevVal = (kind === 'mob') ? getEffectiveMobParam(a, key) : getEffectiveActorParam(a, key);
          }
        }

        const ok = applyActorParam(a, key, eff.value);

        if (resetCapture && ok) {
          const desc = __actorDescriptorForReset(a);
          if (desc) {
            if (isAiKey && prevSnap) {
              __queueResetAction({
                type: 'restoreNpcAiState',
                actor: desc,
                state: prevSnap
              });
            } else if (isTargetAdd && !hadTarget) {
              __queueResetAction({
                type: 'setActorParam',
                actor: desc,
                key: 'targetRemove',
                value: eff.value
              });
            } else if (isTargetRemove && hadTarget) {
              __queueResetAction({
                type: 'setActorParam',
                actor: desc,
                key: 'targetAdd',
                value: eff.value
              });
            } else {
              if (prevVal === undefined) {
                if (kNorm === 'autocastabilityid') {
                  __queueResetAction({
                    type: 'setActorParam',
                    actor: desc,
                    key,
                    value: null
                  });
                } else {
                  __queueResetAction({
                    type: 'deleteActorParam',
                    actor: desc,
                    key
                  });
                }
              } else {
                __queueResetAction({
                  type: 'setActorParam',
                  actor: desc,
                  key,
                  value: prevVal
                });
              }
            }
          }
        }
      }
      continue;
    }

    if (eff.type === 'stun') {
      const durMs = __effectDurMs(eff);
      if (!isFinite(durMs) || durMs <= 0) continue;

      const spec = normalizeActorSpec({
        actor: eff.actor ?? eff.target ?? eff.subject ?? eff.npc ?? eff.player ?? null,
        mob: eff.mob ?? eff.mobId ?? eff.id ?? null,
        instanceId: eff.instanceId ?? eff.instance ?? null
      }, payload);
      const actors = resolveActorsFromSpec(spec, payload);
      if (!actors.length) continue;

      const nowMs = getGameNowMs();
      const expiresAtMs = nowMs + durMs;

      for (const a of actors) {
        if (!a) continue;
        if (actorHasTag(a, 'stun_immune')) continue;

        const hadTag = resetCapture ? actorHasTag(a, 'stunned') : false;
        actorAddTag(a, 'stunned');
        __setTagExpiry(a, 'stunned', expiresAtMs);

        if (resetCapture && !hadTag) {
          const desc = __actorDescriptorForReset(a);
          if (desc) __queueTagInverse(desc, 'stunned', 'removeTag');
        }

        scheduleTimedEffect(expiresAtMs, () => {
          const exp = a?.tagExpiresAtMs?.stunned;
          if (isFinite(exp) && Number(exp) !== expiresAtMs) return;
          actorRemoveTag(a, 'stunned');
          __clearTagExpiry(a, 'stunned');
        });

        // Pause movement / AI
        if (a !== player) {
          lockActorMovementUntil(a, expiresAtMs);
        } else {
          player.vx = 0;
          player.vy = 0;
        }

        // Pause interaction-driven movement (resume after stun ends)
        if (a.__interactionMoveActive) {
          a.vx = 0;
          a.vy = 0;
        }

        // Lock facing for the stun duration (keep current facing)
        lockActorFacingUntil(a, expiresAtMs, (a.facing === -1 || a.facing === 1) ? a.facing : null, { override: true });
      }

      continue;
    }

    if (eff.type === 'push') {
      const dist = Number(eff.distance ?? eff.dist ?? eff.px ?? 0);
      if (!isFinite(dist) || dist === 0) continue;

      const dirRaw = lc(eff.direction ?? eff.dir ?? eff.towards ?? eff.away ?? '');
      const speedFactor = Number(eff.speedFactor ?? eff.speed ?? 1);

      const spec = normalizeActorSpec({
        actor: eff.actor ?? eff.target ?? eff.subject ?? eff.npc ?? eff.player ?? null,
        mob: eff.mob ?? eff.mobId ?? eff.id ?? null,
        instanceId: eff.instanceId ?? eff.instance ?? null
      }, payload);
      const actors = resolveActorsFromSpec(spec, payload);
      if (!actors.length) continue;

      const srcActor = payload?.sourceActor ? resolveActorFromTargetDescriptor(payload.sourceActor) : null;

      for (const a of actors) {
        if (!a) continue;
        if (actorHasTag(a, 'push_immune')) continue;

        let dir = 0;
        if (dirRaw === 'left') dir = -1;
        else if (dirRaw === 'right') dir = 1;
        else if (dirRaw === 'towardscaster' || dirRaw === 'towards_caster' || dirRaw === 'towards') {
          if (srcActor) dir = Math.sign((srcActor.worldX || 0) - (a.worldX || 0));
        } else if (dirRaw === 'awayfromcaster' || dirRaw === 'away_from_caster' || dirRaw === 'away') {
          if (srcActor) dir = Math.sign((a.worldX || 0) - (srcActor.worldX || 0));
        }

        if (!dir) continue;

        const targetX = Number(a.worldX || 0) + (dir * dist);
        if (!isFinite(targetX)) continue;

        // Push overrides interaction movement
        if (a.__interactionMoveActive) {
          a.__interactionMoveActive = false;
          a.__interactionMove = null;
        }

        startForcedMove(a, targetX, speedFactor, { source: 'push' });
      }

      continue;
    }

    // ===== Actor tag effects (dynamic tags) =====
    if (eff.type === 'addTag') {
      // Targets: player | npc by name | '@party' | mob descriptor | '@target' (player/npc/mob)
      const tag = eff.tag ?? eff.keyTag ?? eff.value;
      let who = (eff.npc == null) ? 'player' : eff.npc;
      const durMs = __effectDurMs(eff);
      const nowMs = getGameNowMs();

      // Allow payload targeting: npc:'@target'
      if (typeof who === 'string' && lc(who) === '@target') {
        const td = payload?.targetActor;
        if (td && (td.kind === 'player' || td.kind === 'npc' || td.kind === 'mob')) who = td;
        else who = '';
      }

      // Target descriptor support
      if (who && typeof who === 'object') {
        const kind = lc(who.kind || '');
        if (kind === 'mob') {
          const mob = resolveActorFromTargetDescriptor(who);
          if (mob) {
            const hadTag = resetCapture ? actorHasTag(mob, tag) : false;
            actorAddTag(mob, tag);
            if (resetCapture && !hadTag) {
              __queueTagInverse(
                { kind: 'mob', id: mob.id, instanceId: mob.instanceId },
                tag,
                'removeTag'
              );
            }
            if (durMs > 0) {
              const expiresAtMs = nowMs + durMs;
              __setTagExpiry(mob, tag, expiresAtMs);
              scheduleTimedEffect(expiresAtMs, () => {
                actorRemoveTag(mob, tag);
                __clearTagExpiry(mob, tag);
              });
            } else {
              __clearTagExpiry(mob, tag);
            }
          }
          continue;
        }
        if (kind === 'player') {
          const hadTag = resetCapture ? actorHasTag(player, tag) : false;
          actorAddTag(player, tag);
          if (resetCapture && !hadTag) {
            __queueTagInverse({ kind: 'player' }, tag, 'removeTag');
          }
          if (durMs > 0) {
            const expiresAtMs = nowMs + durMs;
            __setTagExpiry(player, tag, expiresAtMs);
            scheduleTimedEffect(expiresAtMs, () => {
              actorRemoveTag(player, tag);
              __clearTagExpiry(player, tag);
            });
          } else {
            __clearTagExpiry(player, tag);
          }
          continue;
        }
        if (kind === 'npc') {
          const name = who.name || who.id || '';
          if (name) {
            let found = null;
            for (const m of party) {
              if (lc(m?.name) === lc(name)) { found = m; break; }
            }
            if (!found) {
              for (const n of npcs) {
                if (lc(n?.name) === lc(name)) { found = n; break; }
              }
            }
            if (found) {
              const hadTag = resetCapture ? actorHasTag(found, tag) : false;
              actorAddTag(found, tag);
              if (resetCapture && !hadTag) {
                __queueTagInverse({ kind: 'npc', name: found.name }, tag, 'removeTag');
              }
              if (durMs > 0) {
                const expiresAtMs = nowMs + durMs;
                __setTagExpiry(found, tag, expiresAtMs);
                scheduleTimedEffect(expiresAtMs, () => {
                  actorRemoveTag(found, tag);
                  __clearTagExpiry(found, tag);
                });
              } else {
                __clearTagExpiry(found, tag);
              }
            }
          }
          continue;
        }
      }

      if (typeof who === 'string' && lc(who) === '@party') {
        const playerHad = resetCapture ? actorHasTag(player, tag) : false;
        actorAddTag(player, tag);
        if (resetCapture && !playerHad) {
          __queueTagInverse({ kind: 'player' }, tag, 'removeTag');
        }
        for (const m of party) {
          if (!m) continue;
          const hadTag = resetCapture ? actorHasTag(m, tag) : false;
          actorAddTag(m, tag);
          if (resetCapture && !hadTag) {
            __queueTagInverse({ kind: 'npc', name: m.name }, tag, 'removeTag');
          }
        }
        if (durMs > 0) {
          const expiresAtMs = nowMs + durMs;
          __setTagExpiry(player, tag, expiresAtMs);
          scheduleTimedEffect(expiresAtMs, () => {
            actorRemoveTag(player, tag);
            __clearTagExpiry(player, tag);
          });
          for (const m of party) {
            if (!m) continue;
            __setTagExpiry(m, tag, expiresAtMs);
            scheduleTimedEffect(expiresAtMs, () => {
              actorRemoveTag(m, tag);
              __clearTagExpiry(m, tag);
            });
          }
        } else {
          __clearTagExpiry(player, tag);
          for (const m of party) __clearTagExpiry(m, tag);
        }
        continue;
      }

      if (typeof who === 'string' && lc(who) === 'player') {
        const hadTag = resetCapture ? actorHasTag(player, tag) : false;
        actorAddTag(player, tag);
        if (resetCapture && !hadTag) {
          __queueTagInverse({ kind: 'player' }, tag, 'removeTag');
        }
        if (durMs > 0) {
          const expiresAtMs = nowMs + durMs;
          __setTagExpiry(player, tag, expiresAtMs);
          scheduleTimedEffect(expiresAtMs, () => {
            actorRemoveTag(player, tag);
            __clearTagExpiry(player, tag);
          });
        } else {
          __clearTagExpiry(player, tag);
        }
        continue;
      }

      // Try party first, then world NPCs
      const want = lc(String(who));
      let found = null;

      for (const m of party) {
        if (lc(m?.name) === want) { found = m; break; }
      }
      if (!found) {
        for (const n of npcs) {
          if (lc(n?.name) === want) { found = n; break; }
        }
      }

      if (found) {
        const hadTag = resetCapture ? actorHasTag(found, tag) : false;
        actorAddTag(found, tag);
        if (resetCapture && !hadTag) {
          __queueTagInverse({ kind: 'npc', name: found.name }, tag, 'removeTag');
        }
        if (durMs > 0) {
          const expiresAtMs = nowMs + durMs;
          __setTagExpiry(found, tag, expiresAtMs);
          scheduleTimedEffect(expiresAtMs, () => {
            actorRemoveTag(found, tag);
            __clearTagExpiry(found, tag);
          });
        } else {
          __clearTagExpiry(found, tag);
        }
      }
      continue;
    }

    if (eff.type === 'removeTag') {
      const tag = eff.tag ?? eff.keyTag ?? eff.value;
      let who = (eff.npc == null) ? 'player' : eff.npc;
      const durMs = __effectDurMs(eff);
      const nowMs = getGameNowMs();

      // Allow payload targeting: npc:'@target'
      if (typeof who === 'string' && lc(who) === '@target') {
        const td = payload?.targetActor;
        if (td && (td.kind === 'player' || td.kind === 'npc' || td.kind === 'mob')) who = td;
        else who = '';
      }

      // Target descriptor support
      if (who && typeof who === 'object') {
        const kind = lc(who.kind || '');
        if (kind === 'mob') {
          const mob = resolveActorFromTargetDescriptor(who);
          if (mob) {
            const hadTag = resetCapture ? actorHasTag(mob, tag) : false;
            actorRemoveTag(mob, tag);
            __clearTagExpiry(mob, tag);
            if (resetCapture && hadTag) {
              __queueTagInverse(
                { kind: 'mob', id: mob.id, instanceId: mob.instanceId },
                tag,
                'addTag'
              );
            }
            if (durMs > 0) {
              const expiresAtMs = nowMs + durMs;
              scheduleTimedEffect(expiresAtMs, () => actorAddTag(mob, tag));
            }
          }
          continue;
        }
        if (kind === 'player') {
          const hadTag = resetCapture ? actorHasTag(player, tag) : false;
          actorRemoveTag(player, tag);
          __clearTagExpiry(player, tag);
          if (resetCapture && hadTag) {
            __queueTagInverse({ kind: 'player' }, tag, 'addTag');
          }
          if (durMs > 0) {
            const expiresAtMs = nowMs + durMs;
            scheduleTimedEffect(expiresAtMs, () => actorAddTag(player, tag));
          }
          continue;
        }
        if (kind === 'npc') {
          const name = who.name || who.id || '';
          if (name) {
            let found = null;
            for (const m of party) {
              if (lc(m?.name) === lc(name)) { found = m; break; }
            }
            if (!found) {
              for (const n of npcs) {
                if (lc(n?.name) === lc(name)) { found = n; break; }
              }
            }
            if (found) {
              const hadTag = resetCapture ? actorHasTag(found, tag) : false;
              actorRemoveTag(found, tag);
              __clearTagExpiry(found, tag);
              if (resetCapture && hadTag) {
                __queueTagInverse({ kind: 'npc', name: found.name }, tag, 'addTag');
              }
              if (durMs > 0) {
                const expiresAtMs = nowMs + durMs;
                scheduleTimedEffect(expiresAtMs, () => actorAddTag(found, tag));
              }
            }
          }
          continue;
        }
      }


      if (typeof who === 'string' && lc(who) === '@party') {
        const playerHad = resetCapture ? actorHasTag(player, tag) : false;
        actorRemoveTag(player, tag);
        if (resetCapture && playerHad) {
          __queueTagInverse({ kind: 'player' }, tag, 'addTag');
        }
        for (const m of party) {
          if (!m) continue;
          const hadTag = resetCapture ? actorHasTag(m, tag) : false;
          actorRemoveTag(m, tag);
          if (resetCapture && hadTag) {
            __queueTagInverse({ kind: 'npc', name: m.name }, tag, 'addTag');
          }
        }
        __clearTagExpiry(player, tag);
        for (const m of party) __clearTagExpiry(m, tag);
        if (durMs > 0) {
          const expiresAtMs = nowMs + durMs;
          scheduleTimedEffect(expiresAtMs, () => actorAddTag(player, tag));
          for (const m of party) {
            if (!m) continue;
            scheduleTimedEffect(expiresAtMs, () => actorAddTag(m, tag));
          }
        }
        continue;
      }

      if (typeof who === 'string' && lc(who) === 'player') {
        const hadTag = resetCapture ? actorHasTag(player, tag) : false;
        actorRemoveTag(player, tag);
        __clearTagExpiry(player, tag);
        if (resetCapture && hadTag) {
          __queueTagInverse({ kind: 'player' }, tag, 'addTag');
        }
        if (durMs > 0) {
          const expiresAtMs = nowMs + durMs;
          scheduleTimedEffect(expiresAtMs, () => actorAddTag(player, tag));
        }
        continue;
      }

      const want = lc(String(who));
      let found = null;

      for (const m of party) {
        if (lc(m?.name) === want) { found = m; break; }
      }
      if (!found) {
        for (const n of npcs) {
          if (lc(n?.name) === want) { found = n; break; }
        }
      }

      if (found) {
        const hadTag = resetCapture ? actorHasTag(found, tag) : false;
        actorRemoveTag(found, tag);
        __clearTagExpiry(found, tag);
        if (resetCapture && hadTag) {
          __queueTagInverse({ kind: 'npc', name: found.name }, tag, 'addTag');
        }
        if (durMs > 0) {
          const expiresAtMs = nowMs + durMs;
          scheduleTimedEffect(expiresAtMs, () => actorAddTag(found, tag));
        }
      }
      continue;
    }

    // Convenience aliases (so Rowyn's veil ability can tag everyone easily)
    if (eff.type === 'addPartyTag') {
      const tag = eff.tag ?? eff.keyTag ?? eff.value;
      const durMs = __effectDurMs(eff);
      const nowMs = getGameNowMs();
      const playerHad = resetCapture ? actorHasTag(player, tag) : false;
      actorAddTag(player, tag);
      if (resetCapture && !playerHad) {
        __queueTagInverse({ kind: 'player' }, tag, 'removeTag');
      }
      for (const m of party) {
        if (!m) continue;
        const hadTag = resetCapture ? actorHasTag(m, tag) : false;
        actorAddTag(m, tag);
        if (resetCapture && !hadTag) {
          __queueTagInverse({ kind: 'npc', name: m.name }, tag, 'removeTag');
        }
      }
      if (durMs > 0) {
        const expiresAtMs = nowMs + durMs;
        __setTagExpiry(player, tag, expiresAtMs);
        scheduleTimedEffect(expiresAtMs, () => {
          actorRemoveTag(player, tag);
          __clearTagExpiry(player, tag);
        });
        for (const m of party) {
          if (!m) continue;
          __setTagExpiry(m, tag, expiresAtMs);
          scheduleTimedEffect(expiresAtMs, () => {
            actorRemoveTag(m, tag);
            __clearTagExpiry(m, tag);
          });
        }
      } else {
        __clearTagExpiry(player, tag);
        for (const m of party) __clearTagExpiry(m, tag);
      }
      continue;
    }

    if (eff.type === 'removePartyTag') {
      const tag = eff.tag ?? eff.keyTag ?? eff.value;
      const durMs = __effectDurMs(eff);
      const nowMs = getGameNowMs();
      const playerHad = resetCapture ? actorHasTag(player, tag) : false;
      actorRemoveTag(player, tag);
      if (resetCapture && playerHad) {
        __queueTagInverse({ kind: 'player' }, tag, 'addTag');
      }
      for (const m of party) {
        if (!m) continue;
        const hadTag = resetCapture ? actorHasTag(m, tag) : false;
        actorRemoveTag(m, tag);
        if (resetCapture && hadTag) {
          __queueTagInverse({ kind: 'npc', name: m.name }, tag, 'addTag');
        }
      }
      __clearTagExpiry(player, tag);
      for (const m of party) __clearTagExpiry(m, tag);
      if (durMs > 0) {
        const expiresAtMs = nowMs + durMs;
        scheduleTimedEffect(expiresAtMs, () => actorAddTag(player, tag));
        for (const m of party) {
          if (!m) continue;
          scheduleTimedEffect(expiresAtMs, () => actorAddTag(m, tag));
        }
      }
      continue;
    }

    // ===== Gate state effects =====
    if (eff.type === 'setGateOpen') {
      let id = String(eff.id ?? eff.instanceId ?? '').trim();
      if (!id && payload?.area && payload?.section && payload?.objectSectionId) {
        id = `${payload.area}.${payload.section}.${payload.objectSectionId}`;
      }
      if (id) {
        if (resetCapture) {
          const prev = getFlag('global', resolveGateFlagKeyFromId(id));
          if (prev === true || prev === false) {
            __queueResetAction({
              type: 'setGateOpen',
              id,
              open: prev
            });
          }
        }
        setGateIsOpenByInstanceId(id, !!eff.open);
      }
      continue;
    }

    if (eff.type === 'toggleGate') {
      let id = String(eff.id ?? eff.instanceId ?? '').trim();
      if (!id && payload?.area && payload?.section && payload?.objectSectionId) {
        id = `${payload.area}.${payload.section}.${payload.objectSectionId}`;
      }
      if (id) {
        if (resetCapture) {
          __queueResetAction({
            type: 'toggleGate',
            id
          });
        }
        toggleGateByInstanceId(id);
      }
      continue;
    }


  }


  // Re-evaluate party eligibility after ANY stat change
  for (const member of party.slice()) {
    const curA = Number(getActorStatValue(member?.name || '', 'alignment', 'current') ?? 0);
    const minARaw = getActorStatValue(member?.name || '', 'minalignment', 'base');

    const curF = Number(getActorStatValue(member?.name || '', 'affection', 'current') ?? 0);

    if (minARaw == null) continue;
    const sum = curA + curF;
    if (sum < Number(minARaw)) {
      const prev = _partyEligBefore.get(member) || { belowMinAlignSum: false };

      // Only drop when crossing from eligible -> ineligible
      if (prev.belowMinAlignSum) continue;

      const reason = 'below_min_alignment';

      removeNpcFromPartyInternal(member, {
        emit: true,
        toWorld: true,
        reason
      });
    }
  }

}

function expireInverseDialogPrompts(eventName, payload) {
  if (!eventName) return;

  for (const rule of rulesData) {
    if (!rule || !rule.id || !rule.triggerWhen || !rule.dialog) continue;

    const tw = rule.triggerWhen;

    if (eventName === 'section_leave') {
      const leavingArea = payload?.area;
      const leavingSection = payload?.section;

      if (tw.event === 'section_enter' && tw.area === leavingArea && tw.section === leavingSection) {
        removeDialogPromptForRule(rule.id);
        activeStateRuleIds.delete(rule.id);
        deindexStateRule(rule);
      }
      continue;
    }

    if (eventName === 'area_leave') {
      const leavingArea = payload?.area;

      if (tw.event === 'area_enter' && tw.area === leavingArea) {
        removeDialogPromptForRule(rule.id);
        activeStateRuleIds.delete(rule.id);
        deindexStateRule(rule);
      }
      continue;
    }

    if (eventName === 'proximity_leave') {
      const leavingKind = lc(payload?.kind);
      const leavingId   = lc(payload?.id);


      if (tw.event === 'proximity_enter') {
        const twKind = lc(tw.kind);
        const twId   = lc(tw.id);

        if (twKind === leavingKind && twId === leavingId) {
          removeDialogPromptForRule(rule.id);
          activeStateRuleIds.delete(rule.id);
          deindexStateRule(rule);
        }
      }

      if (tw.event === 'npc_proximity') {
        const twNpc = lc(tw.npc);
        const leavingNpc = lc(payload?.npc);

        if (leavingNpc && twNpc === leavingNpc) {
          removeDialogPromptForRule(rule.id);
          activeStateRuleIds.delete(rule.id);
          deindexStateRule(rule);
        }
      }
    }
  }
}

function __isTimeTriggerEvent(ev) {
  const e = lc(ev || '');
  return e === 'time_phase_change' || e === 'time_tick' || e.startsWith('time_');
}

function __getPromptTimeoutModeForRule(rule) {
  if (!rule) return 'none';
  const triggers = normalizeTriggerWhen(rule.triggerWhen);
  for (const t of triggers) {
    if (__isTimeTriggerEvent(t?.event)) return 'time';
  }
  return 'none';
}

function applyRulesForEvent(eventName, payload) {
  const list = rulesByEvent[eventName] || [];

  const logReason = (...args) => {
  };



  expireInverseDialogPrompts(eventName, payload);



  for (const entry of list) {
    
    const rule = entry.rule;
    const trig = entry.trigger;

    if (!rule || !rule.id) continue;
    if (rule.disabled) continue;

    const ruleId = String(rule.id);

    // once = global per rule id (since rules are global now)
    if (rule.once && triggeredRuleIds.has(ruleId)) {
      logReason('SKIP once-fired', { eventName, ruleId, payload });
      continue;
    }


    // State gate
    if (ruleId === 'rowyn_forest1_keep_going_prompt' && window.__traceRules) {
    }

    if (ruleId === 'mira_forest_north_return_after_safeplace') {
      const stateOk = evaluateRuleState(rule, payload);
      const miraLive = !!findActorByName('Mira');
      if (!stateOk) {
        logReason('SKIP state-fail', { eventName, ruleId, state: rule.state, payload });
        continue;
      }
    } else if (!evaluateRuleState(rule, payload)) {
      logReason('SKIP state-fail', { eventName, ruleId, state: rule.state, payload });
      continue;
    }



    // Optional prereqs (history counters)
    if (rule.requires && Array.isArray(rule.requires)) {
      let ok = true;
      for (const req of rule.requires) {
        if (!req || !req.event) { ok = false; break; }
        const c = getEventCount(req, payload, eventName);
        if (req.gte !== undefined && !(c >= req.gte)) { ok = false; break; }
        if (req.lte !== undefined && !(c <= req.lte)) { ok = false; break; }
        if (req.eq  !== undefined && !(c === req.eq))  { ok = false; break; }
      }
      if (!ok) logReason('SKIP requires-fail', { eventName, ruleId, requires: rule.requires, payload });

      if (!ok) continue;
    }

    if (!triggerMatches(trig, eventName, payload)) {
      logReason('SKIP trigger-mismatch', { eventName, ruleId, trigger: trig, payload });
      continue;
    }


    // === FIRE ===
    applyRuleEffects(rule, payload);

    // Dialog prompt: rule must specify who is speaking
    if (rule.dialog && rule.dialog.prompt && rule.dialog.start) {
      const speaker = rule.dialog.npc || payload?.npc;
      if (speaker) {
        // If this rule already has an active prompt, don't enqueue another copy.
        if (!activeStateRuleIds.has(ruleId)) {
          enqueueNpcSpeechBubblePrompt(
            speaker,
            rule.dialog.prompt,
            rule.dialog.start,
            ruleId,
            { timeoutMode: __getPromptTimeoutModeForRule(rule), ruleId }
          );

          // IMPORTANT: if this is a triggerWhen rule, bind it to the state system
          // so its prompt will expire when its state becomes false.
          if (rule.triggerWhen && Array.isArray(rule.state) && rule.state.length > 0) {
            bindTriggeredRuleToStateIndex(rule);
            activeStateRuleIds.add(ruleId);
          }
        }
      }

    }

    let startedScene = false;

    if (rule.scene && rule.scene.start) {
      startRuleScene(rule.scene.start, ruleId);
      startedScene = true;
    }

    // For dialog prompts, we defer "once" until the prompt is triggered or times out.
    if (rule.once && !startedScene && !(rule.dialog && rule.dialog.prompt && rule.dialog.start)) {
      triggeredRuleIds.add(ruleId);
    }

  }
}

function handleObjectInteractEvent(payload) {
  const objectId = lc(payload?.id || '');
  if (!objectId) return;

  const def = getObjectDef(objectId);
  if (!def) return;

  // If this object type declares interact tags, require party capability.
  // (Objects with only blockers, like mist, should not be interactable anyway.)
  const hasInteractTags =
    (Array.isArray(def.interact) && def.interact.length) ||
    (Array.isArray(def.interacts) && def.interacts.length) ||
    (Array.isArray(def.interactTags) && def.interactTags.length);

  if (hasInteractTags && !partyCanInteractWithObjectDef(def)) return;

  const wasTypeInteracted = !!payload?.wasTypeInteracted;
  const wasInstanceInteracted = !!payload?.wasInstanceInteracted;

  // Dialog hooks (new object schema)
  const dialogFirstType = def?.dialog?.firstType || null;
  const dialogFirstInstance = def?.dialog?.firstInstance || null;
  const dialogEveryType = def?.dialog?.everyType || null;

  let dialogStart = null;
  if (!wasTypeInteracted && dialogFirstType) {
    dialogStart = dialogFirstType;
  } else if (!wasInstanceInteracted && dialogFirstInstance) {
    dialogStart = dialogFirstInstance;
  } else if (dialogEveryType) {
    dialogStart = dialogEveryType;
  }

  const effectsFirstType =
    Array.isArray(def.effectsFirstType) ? def.effectsFirstType : [];

  const effectsFirstInstance =
    Array.isArray(def.effectsFirstInstance) ? def.effectsFirstInstance : [];

  const effects =
    Array.isArray(def.effects) ? def.effects : [];

  const resetMs = Number(def.resetMs || 0);
  const inactiveMs = Number(def.inactiveMs || 0);
  const interactionsBeforeInactiveRaw = (def.interactionsBeforeInactive != null)
    ? def.interactionsBeforeInactive
    : 1;
  const interactionsBeforeInactive = Math.max(1, Math.floor(Number(interactionsBeforeInactiveRaw)));

  // Start dialog if specified (no dialog if no hook exists)
  if (dialogStart && !loading) {
    startRuleScene(dialogStart, `__object:${objectId}:${(!wasTypeInteracted ? 'first' : 'every')}`);
  }

  // Apply effects (queued for dialog placement)
  const instanceKey = payload.instanceKey;

  // Convert proximity instanceKey ("object:...") into the gate instance id used by gateOpen flags.
  // - new:    "object:<customId>"              -> "<customId>"
  // - legacy: "object:<layer>:<base>:<i>"      -> "<layer>:<base>:<i>"
  const gateInstanceId =
    (() => {
      const area = String(payload?.area || '').trim();
      const section = String(payload?.section || '').trim();
      const objId = String(payload?.objectSectionId || '').trim();
      if (area && section && objId) return `${area}.${section}.${objId}`;

      const raw = String(instanceKey || '');
      if (!raw.startsWith('object:')) return '';

      const parts = raw.split(':');

      // legacy: object:layer:base:i
      if (parts.length === 4) {
        const layer = String(parts[1] || '').trim();
        const base  = lc(parts[2] || '');
        const idx   = String(parts[3] || '').trim();
        if (!layer || !base || !idx) return '';
        return `${layer}:${base}:${idx}`;
      }

      // new: object:customId
      const rest = raw.slice('object:'.length);
      return String(rest || '').trim();
    })();

  // If an object effect is a gate state effect and it doesn't specify an id,
  // assume it targets the interacted instance (using the correct gate instance id).
  const __withGateTarget = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return arr;
    return arr.map(eff => {
      if (!eff || typeof eff !== 'object') return eff;
      if ((eff.type === 'toggleGate' || eff.type === 'setGateOpen') && (eff.id == null) && (eff.instanceId == null)) {
        return gateInstanceId ? { ...eff, instanceId: gateInstanceId } : eff;
      }
      return eff;
    });
  };


  const combinedEffects = [];
  if (!wasTypeInteracted && effectsFirstType.length) combinedEffects.push(...effectsFirstType);
  if (!wasInstanceInteracted && effectsFirstInstance.length) combinedEffects.push(...effectsFirstInstance);
  if (effects.length) combinedEffects.push(...effects);

  const payloadBase = {
    source: 'object',
    objectId,
    instanceKey,
    firstTime: !wasTypeInteracted,
    area: payload?.area || null,
    section: payload?.section || null,
    objectSectionId: payload?.objectSectionId || null,
    interactor: payload?.interactor,
    sourceActor: payload?.sourceActor,
    targetActor: payload?.interactor || payload?.targetActor
  };

  const resetSpec = (isFinite(resetMs) && resetMs > 0)
    ? { resetMs, objectId, instanceKey }
    : null;

  if (pendingObjectInteraction) {
    __flushPendingObjectInteraction('override');
  }

  if (dialogStart) {
    pendingObjectInteraction = {
      instanceKey,
      effects: __withGateTarget(combinedEffects),
      payload: payloadBase,
      releaseLock: true,
      resetSpec
    };
  } else {
    if (combinedEffects.length) {
      __applyObjectInteractionEffects(__withGateTarget(combinedEffects), payloadBase, resetSpec);
    }
    __releaseObjectInteractionLock(instanceKey);
  }


  // Record type + instance interaction
  if (!wasTypeInteracted) {
    setFlag('global', `objectTypeInteracted:${objectId}`, true);
  }

  if (payload.instanceKey) {
    const areaKey = String(payload.area || currentAreaName || '').trim();
    const flagKey = areaKey
      ? `objectInstanceInteracted:${areaKey}:${payload.instanceKey}`
      : `objectInstanceInteracted:${payload.instanceKey}`;
    setFlag('global', flagKey, true);
  }

  // Kick object "_interact" animation (if available) on the specific instance that was interacted with
  if (payload.instanceKey) {
    const inst = findPlacedObjectByInstanceKey(payload.instanceKey);
    if (inst) {
      inst._interactAnimStartMs = getGameNowMs();
    }
  }

  if (payload.instanceKey) {
    const st = getObjectInteractState(payload.instanceKey);
    if (st) {
      st.totalInteractions += 1;
      st.interactionsSinceInactive += 1;
      if (isFinite(inactiveMs) && inactiveMs > 0) {
        if (st.interactionsSinceInactive >= interactionsBeforeInactive) {
          st.inactiveUntilMs = getGameNowMs() + inactiveMs;
          st.interactionsSinceInactive = 0;
        }
      }
    }
  }
}



function emitGameEvent(eventName, payload) {
  if (!payload || typeof payload !== 'object') payload = {};
  payload.__eventName = eventName;

  if (
    (eventName === 'area_enter' || eventName === 'section_enter') &&
    (payload?.area === 'eldertide_forest_shrine_back' || payload?.section === 'forest_shrine_back_middle')
  ) {
    const key = `event:${eventName}:${payload?.area || ''}:${payload?.section || ''}:${payload?.npc || ''}:${payload?.fromArea || ''}:${payload?.toArea || ''}`;
  }

  __lastEvent = { eventName, payload };

  applyRulesForEvent(eventName, payload);
  evaluateAllGoalsForEvent(eventName, payload);
  evaluateGoalProgressForEvent(eventName, payload);

  // Pass-out carry system: after a full day unconscious, auto-move NPCs to nearest safe place + recover
  if (eventName === 'time_tick') {
    __processUnconsciousNpcAutoRecover(payload?.dayIndex);
  }



  if (eventName === 'object_interact') {
    handleObjectInteractEvent(payload);
  }

  // Mark named sections as "visited" the first time the PLAYER enters them
  if (eventName === 'section_enter' && lc(payload?.npc) === 'player') {
    const a = String(payload?.area || '');
    const s = String(payload?.section || '');
    if (a && s) {
      setFlag('global', `visited:${a}:${s}`, true);
    }
  }

  // Mark portals as "used" for map visualization (area + section + object id)
  if (eventName === 'portal_use') {
    const area = String(payload?.area || '').trim();
    const objectId = String(payload?.objectId || '').trim();
    const sectionName = String(payload?.section || '').trim();
    const sectionIndex = Number(payload?.sectionIndex);
    const sectionKey = sectionName || getSectionKeyForIndex(area, sectionIndex);
    if (area && objectId && sectionKey) {
      const usedKey = `portalUsed:${area}:${sectionKey}:${objectId}`;
      setFlag('global', usedKey, true);
    }
  }

  // Mark exits as "used" for map visualization
  if (eventName === 'exit_use') {
    const area = String(payload?.area || '');
    const sectionIndex = Number(payload?.sectionIndex);
    const exitId = String(payload?.exitId || '');
    if (area && isFinite(sectionIndex) && sectionIndex >= 0 && exitId) {
      setFlag('global', `exitUsed:${area}:${sectionIndex}:${exitId}`, true);
    }
  }


  bumpEventCounts(eventName, payload);
  evaluateStateRulesForEvent(eventName, payload);

  // Conditional spawn processing (spawnWhen/spawnIf)
  processPendingSpawns(eventName, payload);

  // UI reactions to events (stat bars, etc.)
  if (eventName === 'stat_change') {
    const actor = lc(payload?.actor);
    const stat = lc(payload?.stat);
    const field = lc(payload?.field);

    // Only player current STA/COM should drive the head bars
    if (actor === 'player' && field === 'current' && (stat === 'stamina' || stat === 'composure')) {
      notePlayerHeadStatChanged(stat, payload?.prev, payload?.next);
    } else if (actor && field === 'current' && (stat === 'stamina' || stat === 'composure')) {
      const a = findActorByName(actor);
      if (a && a !== player) {
        noteHeadStatChanged(a, stat, payload?.prev, payload?.next);
      }
    }

  }

    // Actor animation reactions (mobs + NPCs)
  if (eventName === 'mob_ability') {
    const mobId = payload?.mob || payload?.id || payload?.mobId;
    const inst = payload?.mobInstanceId || payload?.instanceId; // support both keys
    const abilityId = lc(payload?.ability || '');
    if (mobId) {
      // Prefer exact instance when available
      let target = null;
      if (inst != null) {
        target = mobs.find(m => m && lc(m.id) === lc(mobId) && String(m.instanceId) === String(inst)) || null;
      }
      if (!target) {
        target = mobs.find(m => m && lc(m.id) === lc(mobId)) || null;
      }

      if (target) {
        const list = Array.isArray(target?.abilities) ? target.abilities : [];
        const adef = list.find(a => a && lc(a.id || a.name) === abilityId) || null;

        const spec = getActionAnimSpec(adef, 'ability', 520);
        setActorTempAnim(target, spec.type, spec.durationMs);

        if (adef?.stopMoving === true && Number(adef?.castingTimeMs || 0) > 0) {
          lockActorMovementForMs(target, Number(adef.castingTimeMs));
        }
      }
    }
  }

  if (eventName === 'npc_ability_cast') {
    const npcName = payload?.npc;
    const abilityId = lc(payload?.ability || '');
    if (npcName) {
      const want = lc(npcName);
      const target =
        party.find(n => n && lc(n.name) === want) ||
        npcs.find(n => n && lc(n.name) === want) ||
        null;

      if (target) {
        if (abilityId) noteAbilityUseForActor(target, abilityId);
        const list = Array.isArray(target?.abilities) ? target.abilities : [];
        const adef = list.find(a => a && lc(a.id || a.name) === abilityId) || null;

        const spec = getActionAnimSpec(adef, 'ability', 520);
        setActorTempAnim(target, spec.type, spec.durationMs);

        if (adef?.stopMoving === true && Number(adef?.castingTimeMs || 0) > 0) {
          lockActorMovementForMs(target, Number(adef.castingTimeMs));
        }
      }
    }
  }

  if (eventName === 'player_ability_cast') {
    const abilityId = lc(payload?.ability || '');
    if (abilityId) noteAbilityUseForActor(player, abilityId);
  }


  if (eventName === 'mob_defeat') {
    const mobId = payload?.mob || payload?.id || payload?.mobId;
    const inst = payload?.instanceId;
    if (mobId) {
      let target = null;
      if (inst != null) {
        target = mobs.find(m => m && lc(m.id) === lc(mobId) && String(m.instanceId) === String(inst)) || null;
      }
      if (!target) {
        target = mobs.find(m => m && lc(m.id) === lc(mobId)) || null;
      }
      if (target) setActorTempAnim(target, 'despawn', 700);
    }
  }

  // Keep menu tabs in sync with dynamic page visibility
  if (
    eventName === 'party_join' ||
    eventName === 'party_leave' ||
    eventName === 'talk_start' ||
    eventName === 'inventory_change'
  ) {
    renderMenuTabs(menuTopTabs, !inMenu, true);
  }

  if (eventName === 'inventory_change') {
    const who = payload?.actor || payload?.npc || payload?.name || null;
    const actor = who ? findActorByName(who) : player;
    if (actor) rebuildActorItemGrants(actor);
  }

}





function evaluateStateRulesForEvent(eventName, payload) {
  if (!eventName) return;

  const mapper = eventStateDependencies[eventName];
  if (!mapper) return;

  const depKeys = mapper(payload);
  if (!depKeys || depKeys.length === 0) return;

  evaluateStateRulesByDepKeys(depKeys, payload);
}


function evaluateStateRulesByDepKeys(depKeys, payload) {
  const candidates = new Set();

  for (const depKey of depKeys) {
    const set = stateRuleIndex.get(depKey);
    if (!set) continue;
    for (const ruleId of set) candidates.add(ruleId);
  }

  for (const ruleId of candidates) {
    const rule = stateRuleById.get(ruleId);
    if (!rule || !rule.id) continue;
    //if (!rule.dialog) continue;
    if (rule.disabled) continue;

    const isActive = activeStateRuleIds.has(ruleId);
    const shouldBeActive = evaluateRuleState(rule, payload);
    const hasFiredOnce = rule.once && triggeredRuleIds.has(ruleId);

    if (shouldBeActive && !isActive && !hasFiredOnce) {

      let fired = false;

      // ---- effect-based state rule ----
      if (Array.isArray(rule.effects) && rule.effects.length) {
        applyRuleEffects(rule, payload);
        fired = true;
        if (rule.once) {
          triggeredRuleIds.add(ruleId);
        }
      }

      // ---- dialog-based state rule ----
      if (rule.dialog) {
        const speaker = rule.dialog.npc || payload?.npc;
        if (speaker) {
          enqueueNpcSpeechBubblePrompt(
            speaker,
            rule.dialog.prompt,
            rule.dialog.start,
            rule.id,
            { ruleId: rule.id }
          );
          fired = true;
        }
      }

      // ---- scene / action-based state rule ----
      if (!fired && rule.scene && rule.scene.start && !inConversation && !loading) {
        startRuleScene(rule.scene.start, ruleId);
        fired = true;

        if (rule.once) {
          triggeredRuleIds.add(ruleId);
        }
      }

      // Only mark "active" for prompt rules (prevents duplicate prompts).
      // Do NOT mark scenes as active, or they can get stuck "active" without a scene actually starting.
      if (fired && (rule.dialog || (Array.isArray(rule.effects) && rule.effects.length))) {
        activeStateRuleIds.add(ruleId);

        // dialog prompts are NOT fired immediately; handled on trigger/timeout
      }



    }



    if (!shouldBeActive && isActive) {
      removeDialogPromptForRule(rule.id);
      activeStateRuleIds.delete(ruleId);

      // If this rule was only bound for post-trigger expiry, unbind it now.
      if (rule.triggerWhen) {
        deindexStateRule(rule);
      }
    }

  }
}

function evaluateAllStateRules(payload) {
  for (const [ruleId, rule] of stateRuleById.entries()) {
    if (!rule || !rule.id) continue;
    if (rule.disabled) continue;



    const isActive = activeStateRuleIds.has(ruleId);
    const shouldBeActive = evaluateRuleState(rule, payload);
    const hasFiredOnce = rule.once && triggeredRuleIds.has(ruleId);

    if (shouldBeActive && !isActive && !hasFiredOnce) {

      let fired = false;

      // ---- effect-based state rule ----
      if (Array.isArray(rule.effects) && rule.effects.length) {
        applyRuleEffects(rule, payload);
        fired = true;
        if (rule.once) {
          triggeredRuleIds.add(ruleId);
        }
      }

      // ---- dialog-based state rule ----
      if (rule.dialog) {
        const speaker = rule.dialog.npc || payload?.npc;
        if (speaker) {
          enqueueNpcSpeechBubblePrompt(
            speaker,
            rule.dialog.prompt,
            rule.dialog.start,
            rule.id,
            { ruleId: rule.id }
          );
          fired = true;
        }
      }

      // ---- scene / action-based state rule ----
      if (!fired && rule.scene && rule.scene.start && !inConversation && !loading) {
        if (ruleId === 'rowyn_recover_composure_scene') {
        }

        startRuleScene(rule.scene.start, ruleId);
        fired = true;
        if (rule.once) {
          triggeredRuleIds.add(ruleId);
        }
      }

      // Only mark "active" for prompt rules (prevents duplicate prompts).
      // Do NOT mark scenes as active.
      if (fired && (rule.dialog || (Array.isArray(rule.effects) && rule.effects.length))) {
        activeStateRuleIds.add(ruleId);

        // dialog prompts are NOT fired immediately; handled on trigger/timeout
      }


    }


    if (!shouldBeActive && isActive) {
      removeDialogPromptForRule(rule.id);
      activeStateRuleIds.delete(ruleId);
    }

  }

}




//LOAD CHARACTERS
async function loadNPCdetails() {
  try {
    const resp = await fetch(`data/characters.json`);
    if (resp.ok) return await resp.json();
  } catch (err) {
    console.warn("Failed to fetch data/characters.json", err);
  }
  return {};
}

//LOAD MOBS
async function loadMobsJSON() {
  try {
    const resp = await fetch(`data/mobs.json`);
    if (resp.ok) return await resp.json();
  } catch (err) {
    console.warn("Failed to fetch data/mobs.json", err);
  }
  return {};
}


// LOAD RULES
async function loadRulesJSON() {
  try {
    const resp = await fetch(`data/rules.json`);
    if (resp.ok) return await resp.json();
  } catch (err) {
    console.warn("Failed to fetch data/rules.json", err);
  }
  return [];
}

// LOAD ITEMS
async function loadItemsJSON() {
  try {
    const resp = await fetch(`data/items.json`);
    if (resp.ok) return await resp.json();
  } catch (err) {
    console.warn("Failed to fetch data/items.json", err);
  }
  return {};
}

// LOAD ABILITIES
async function loadAbilitiesJSON() {
  try {
    const resp = await fetch(`data/abilities.json`);
    if (resp.ok) return await resp.json();
  } catch (err) {
    console.warn("Failed to fetch data/abilities.json", err);
  }
  return {};
}

// LOAD FACTIONS
async function loadFactionsJSON() {
  try {
    const resp = await fetch(`data/factions.json`);
    if (resp.ok) return await resp.json();
  } catch (err) {
    console.warn("Failed to fetch data/factions.json", err);
  }
  return { baseAlliance: {} };
}

// LOAD OBJECTS
async function loadObjectsJSON() {
  try {
    const resp = await fetch(`data/objects.json`);
    if (resp.ok) return await resp.json();
  } catch (err) {
    console.warn("Failed to fetch data/objects.json", err);
  }
  return {};
}

function validateRulesData(rules) {
  const missing = [];
  for (const r of (rules || [])) {
    if (!r || !r.id) continue;
    if (r.dialog && r.dialog.prompt && r.dialog.start) {
      if (!('npc' in r.dialog)) {
        missing.push({ id: r.id, dialog: r.dialog });
      }
    }
  }
  return missing;
}



const playerSprites = {
  idle: new Image(),
  runLeft: null,
  runRight: null,
  stoppedLeft: null,
  stoppedRight: null,
  stoppedForward: null,
  ready: false,
  requestedExtras: false
};

// Create a single shared promise for NPC details.
const npcDetailsPromise = loadNPCdetails();
const npcSprites = {};
let npcDetails = null;
let npcDetailsByLc = null;
let npcNameList = [];

// Create a single shared promise for Abilities data.
const abilitiesDataPromise = loadAbilitiesJSON();
let abilitiesData = null;
let abilitiesDataByLc = null;

// Create a single shared promise for Factions data.
const factionsDataPromise = loadFactionsJSON();
let factionsData = null;


// Create a single shared promise for Mob details.
const mobDetailsPromise = loadMobsJSON();
let mobDetailsRaw = null;        // raw mobs.json
let mobDetails = null;           // resolved (templates applied)
let mobIdList = [];              // keys of resolved mobs

// Create a single shared promise for Object details.
const objectsDataPromise = loadObjectsJSON();


function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge where:
// - objects merge recursively
// - arrays are REPLACED (no concat)
// - primitives overwrite
function deepMergeReplaceArrays(base, override) {
  if (!isPlainObject(base)) base = {};
  if (!isPlainObject(override)) return { ...base };

  const out = { ...base };
  for (const k of Object.keys(override)) {
    const bv = out[k];
    const ov = override[k];

    if (Array.isArray(ov)) {
      out[k] = ov.slice();
      continue;
    }
    if (isPlainObject(ov) && isPlainObject(bv)) {
      out[k] = deepMergeReplaceArrays(bv, ov);
      continue;
    }
    if (isPlainObject(ov)) {
      out[k] = deepMergeReplaceArrays({}, ov);
      continue;
    }

    out[k] = ov;
  }
  return out;
}

function getAbilityDefById(id) {
  const key = lc(id || '');
  if (!key) return null;
  if (abilitiesDataByLc && abilitiesDataByLc[key]) return abilitiesDataByLc[key];
  if (abilitiesData && abilitiesData[key]) return abilitiesData[key];
  return null;
}

function resolveAbilityEntry(entry) {
  if (!entry) return null;

  if (typeof entry === 'string') {
    const base = getAbilityDefById(entry);
    return base ? deepMergeReplaceArrays({}, base) : null;
  }

  if (typeof entry === 'object') {
    const id = entry.id || entry.name || '';
    const base = getAbilityDefById(id);
    return base ? deepMergeReplaceArrays(base, entry) : deepMergeReplaceArrays({}, entry);
  }

  return null;
}

function resolveAbilityList(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const out = [];
  for (const entry of list) {
    const resolved = resolveAbilityEntry(entry);
    if (resolved) out.push(resolved);
  }
  return out;
}

function abilityIdOf(ability) {
  const id = lc(ability?.id || ability?.name || '');
  return id || '';
}

function mergeAbilityLists(lists) {
  const order = [];
  const map = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      const id = abilityIdOf(a);
      if (!id) continue;
      if (!map.has(id)) order.push(id);
      map.set(id, a);
    }
  }
  return order.map(id => map.get(id)).filter(Boolean);
}

function isMobActor(actor) {
  if (!actor || !actor.instanceId) return false;
  const id = lc(actor.id || '');
  return !!(id && mobDetails && mobDetails[id]);
}

function isPlayerActor(actor) {
  return !!(actor && actor === player);
}

function isPartyActor(actor) {
  if (!actor) return false;
  if (actor === player) return true;
  return Array.isArray(party) && party.includes(actor);
}

function isNpcActor(actor) {
  if (!actor || isPlayerActor(actor) || isMobActor(actor)) return false;
  return !!actor.name;
}

function getActorBaseFactions(actor) {
  if (!actor) return [];
  if (Array.isArray(actor.factions)) return actor.factions.slice();
  if (actor.def && Array.isArray(actor.def.factions)) return actor.def.factions.slice();
  if (actor.def && actor.def.faction) return [String(actor.def.faction)];
  if (actor.faction) return [String(actor.faction)];
  if (isMobActor(actor)) {
    const def = mobDetails?.[lc(actor.id || '')];
    if (def && def.faction) return [String(def.faction)];
  }
  return [];
}

function getActorFactions(actor) {
  const out = new Set();
  for (const f of getActorBaseFactions(actor)) {
    const k = lc(f || '');
    if (k) out.add(k);
  }

  if (isPartyActor(actor)) out.add('party');
  if (isNpcActor(actor)) out.add('npc');
  if (isMobActor(actor)) {
    out.add('mob');
    const id = lc(actor.id || '');
    if (id) out.add(id); // implicit mob type faction
  }

  return Array.from(out.values());
}

function getActorAllianceByFaction(actor, factionKey) {
  if (!actor || !factionKey) return 0;
  const map = actor.allianceByFaction;
  if (!map || typeof map !== 'object') return 0;
  const v = Number(map[factionKey]);
  return isFinite(v) ? v : 0;
}

function getActorAllianceByInstance(actor, instanceKey) {
  if (!actor || !instanceKey) return 0;
  const map = actor.allianceByInstance;
  if (!map || typeof map !== 'object') return 0;
  const v = Number(map[instanceKey]);
  return isFinite(v) ? v : 0;
}

function getActorInstanceAllianceKey(actor) {
  if (!actor) return '';
  if (isMobActor(actor)) return `mob:${lc(actor.id || '')}:${String(actor.instanceId || '')}`;
  if (isPlayerActor(actor)) return 'player';
  if (actor.name) return `npc:${lc(actor.name || '')}`;
  return '';
}

function getActorStatCurrent(actor, keyRaw) {
  if (!actor || !actor.stats) return null;
  const key = lc(keyRaw || '');
  if (!key) return null;
  const v = Number(actor?.stats?.[key]?.current);
  return isFinite(v) ? v : null;
}

function getPartyAllianceSum(targetFactions) {
  if (!Array.isArray(targetFactions) || targetFactions.length === 0) return 0;
  let sum = 0;
  const members = [player, ...(Array.isArray(party) ? party : [])];
  for (const member of members) {
    if (!member) continue;
    for (const f of targetFactions) {
      sum += getActorAllianceByFaction(member, f);
    }
  }
  return sum;
}

function getAllianceScore(caster, target) {
  if (!caster || !target) return 0;

  const casterFactions = getActorFactions(caster);
  const targetFactions = getActorFactions(target);

  let score = 0;

  const base = factionsData?.baseAlliance || {};
  for (const cf of casterFactions) {
    const row = base[cf];
    if (!row || typeof row !== 'object') continue;
    for (const tf of targetFactions) {
      const v = Number(row[tf]);
      if (isFinite(v)) score += v;
    }
  }

  for (const tf of targetFactions) {
    score += getActorAllianceByFaction(caster, tf);
  }

  const instKey = getActorInstanceAllianceKey(target);
  if (instKey) score += getActorAllianceByInstance(caster, instKey);

  if (isPartyActor(caster)) {
    score += getPartyAllianceSum(targetFactions);
  }

  if (isNpcActor(caster) && isPartyActor(target)) {
    const align = getActorStatCurrent(caster, 'alignment');
    const aff = getActorStatCurrent(caster, 'affection');
    if (align != null) score += align;
    if (aff != null) score += aff;
  }

  return score;
}

function getRelation(caster, target) {
  const score = getAllianceScore(caster, target);
  if (score > 0) return 'ally';
  if (score < 0) return 'enemy';
  return 'neutral';
}

function resolveMobTemplates(raw) {
  const src = raw || {};
  const resolved = Object.create(null);
  const visiting = new Set();

  function resolveOne(id) {
    const key = String(id || '');
    if (!key) return null;
    if (resolved[key]) return resolved[key];

    const node = src[key];
    if (!node || typeof node !== 'object') return null;

    if (visiting.has(key)) {
      console.warn('[mobs] Template cycle detected at', key);
      // Break the cycle by treating current node as final
      resolved[key] = { ...node };
      return resolved[key];
    }

    visiting.add(key);

    let base = {};
    const parentId = node.template;
    if (parentId) {
      const parent = resolveOne(parentId);
      if (parent) base = parent;
      else console.warn('[mobs] Missing template', parentId, 'for', key);
    }

    // Apply child overrides on top of base; do not keep "template" in resolved output.
    const child = { ...node };
    delete child.template;

    const merged = deepMergeReplaceArrays(base, child);
    merged.id = merged.id || key;

    resolved[key] = merged;
    visiting.delete(key);
    return merged;
  }

  for (const id of Object.keys(src)) resolveOne(id);
  return resolved;
}


// NPCs & party
const npcs = [];
const party = [];
// World mobs
const mobs = [];
let mobSpawnCounter = 0;

// Pending conditional spawns for the CURRENT area (mobs, NPCs, placed objects)
let pendingSpawns = [];
let __pendingAreaEnterEvents = [];
let __lastSpawnIfEvalAtMs = 0;
const SPAWN_IF_EVAL_INTERVAL_MS = 200;



function lc(v) {
  return String(v || '').toLowerCase();
}

function listHasName(list, name) {
  const n = lc(name);
  return list.some(x => lc(x?.name) === n);
}

function isNpcInPartyByName(name) {
  return listHasName(party, name);
}
function isNpcInWorldByName(name) {
  return listHasName(npcs, name);
}

function getActorMovementStateByName(name) {
  const who = lc(name);
  if (!who) return 'stopped';

  if (who === 'player') {
    return (typeof player.vx === 'number' && Math.abs(player.vx) > 0.1) ? 'moving' : 'stopped';
  }

  const actor = findActorByName(who);
  if (!actor) return 'stopped';

  const mode = lc(actor.aiMode || 'stationary');

  // waiting is a distinct state
  if (mode === 'waiting') return 'waiting';

  // moving can be either "moving" or effectively "stopped" if already at goal
  if (mode === 'moving') {
    if (actor.aiAtGoal) return 'stopped';
    return (typeof actor.vx === 'number' && Math.abs(actor.vx) > 0.1) ? 'moving' : 'moving';
  }

  return 'stopped';
}

function emitMovementStateIfChanged(actor, force = false) {
  if (!actor || !actor.name) return;
  const state = getActorMovementStateByName(actor.name);
  if (!force && actor._lastMoveState === state) return;

  actor._lastMoveState = state;

  emitGameEvent('movement_state', {
    npc: actor.name,   // keep payload.npc for existing triggerMatches behavior
    state
  });
}

function interactionRadius(kind, thingWidth) {
  return (thingWidth * 0.5) + (player.w * INTERACTION[kind]);
}



//CONTROL THE MOVEMENT OF THE PLAYER
function carryPartyWithPlayer(prevPlayerX, newPlayerX) {
  const dx = newPlayerX - prevPlayerX;
  for (let i = 0; i < party.length; i++) {
    const m = party[i];
    // Keep their relative spacing
    m.worldX = Math.max(2, Math.min((m.worldX + dx), currentArea.lengthPx - m.w - 2));
    // Snap to ground
    m.y = groundY - m.h - 8;
  }
}



function animFrameDelayFromSpeed(vx) {
  const speed = Math.abs(vx);

  // Tune these numbers only
  const MIN_DELAY = 20; // slow walk
  const MAX_DELAY = 1;  // full sprint
  const SPEED_AT_MAX = maxMovementSpeed() * 0.6;

  const t = Math.min(speed / SPEED_AT_MAX, 1);
  return MIN_DELAY - t * (MIN_DELAY - MAX_DELAY);
}

function lazyLoadSpriteSetOnce(sprites, entries) {
  if (!sprites || !sprites.ready || sprites.requestedExtras) return;
  sprites.requestedExtras = true;

  for (const e of (entries || [])) {
    if (!e || !e.key || !e.path) continue;
    const img = new Image();
    img.src = e.path;
    img.onload = () => { sprites[e.key] = img; };
    img.onerror = () => {};
  }
}

// ============================================================================
// Mobs: sprite resolution + animation fallback
// ============================================================================

// ============================================================================
// Shared sprite entry helper (used by mobs and NPCs)
// ============================================================================

function ensureSpriteEntry(store, idRaw) {
  const id = lc(idRaw || '');
  if (!id) return null;
  if (store[id]) return store[id];

  const entry = {
    // key -> Image | null (null means “confirmed missing”)
    // key format: `${type}:${dir||''}`
    byKey: Object.create(null),

    // key -> true while a request is in-flight (prevents duplicate Image() storms)
    pending: Object.create(null),

    // Bookkeeping
    ready: false, // becomes true once we have ANY loaded sprite
  };

  store[id] = entry;
  return entry;
}

function spriteAnimKey(type, dir) {
  return `${type}:${dir || ''}`;
}

function actorStoreKey(kind, idRaw) {
  const k = lc(kind || '');
  const id = lc(idRaw || '');
  if (!k || !id) return '';
  return `${k}:${id}`;
}

const ACTOR_SPRITES = Object.create(null); // "mob:<id>" or "npc:<id>" -> sprite entry
const mobSprites = ACTOR_SPRITES; // alias for compatibility in existing mob code


function getMobSpriteChainIds(mobId) {
  const out = [];
  const seen = new Set();
  let cur = lc(mobId || '');
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    const raw = mobDetailsRaw && mobDetailsRaw[cur];
    const t = lc(raw && raw.template);
    cur = t || '';
  }
  return out; // [self, parent, grandparent...]
}

function getMobSpritePreferenceOrder(mobId) {
  // Default: prefer self first, then templates.
  // Optional override (kept minimal): mob def may set spriteTemplateFirst:true to prefer ancestors first.
  const raw = mobDetailsRaw && mobDetailsRaw[lc(mobId || '')];
  const ancestorFirst = raw && raw.spriteTemplateFirst === true;

  const chain = getMobSpriteChainIds(mobId);
  return ancestorFirst ? chain.slice().reverse() : chain;
}

function loadFirstAvailableImage(paths, onOk) {
  const list = (paths || []).filter(Boolean);
  if (list.length === 0) return;

  let i = 0;
  const img = new Image();

  const tryNext = () => {
    if (i >= list.length) return;
    img.onload = () => { onOk(img); };
    img.onerror = () => { i++; tryNext(); };
    img.src = list[i];
  };

  tryNext();
}

function ensureMobSpriteEntry(mobId) {
  return ensureSpriteEntry(ACTOR_SPRITES, actorStoreKey('mob', mobId));
}


// Animation types the engine may request (spec)
const MOB_ANIM_TYPES = new Set([
  'wait',
  'run',
  'move',
  'stopped',
  'stunned',
  'attack',
  'ranged',
  'ability',
  'hurt',
  'spawn',
  'despawn'
]);

function mobAnimKey(type, dir) {
  return spriteAnimKey(type, dir);
}


function mobSpritePath(id, type, dir) {
  // Filenames:
  //   mobId_animationType.png              (for wait/spawn/despawn)
  //   mobId_animationType_direction.png    (for directional)
  if (!dir) return `assets/sprites/mobs/${id}_${type}.png`;
  return `assets/sprites/mobs/${id}_${type}_${dir}.png`;
}

// Global fallback order (fixed). This is “what to try if requested type missing”.
function mobFallbackTypes(type) {
  switch (String(type || '')) {
    case 'stunned': return ['stunned', 'stopped'];
    case 'attack':  return ['attack', 'ranged', 'ability', 'stopped'];
    case 'ranged':  return ['ranged', 'attack', 'ability', 'stopped'];
    case 'ability': return ['ability', 'attack', 'ranged', 'stopped'];
    case 'hurt':    return ['hurt', 'stopped'];
    case 'run':     return ['run', 'move', 'stopped'];
    case 'move':    return ['move', 'run', 'stopped'];
    case 'stopped': return ['stopped', 'wait'];
    case 'spawn':   return ['spawn', 'wait'];
    case 'despawn': return ['despawn', 'wait'];
    case 'wait':
    default:        return ['wait'];
  }
}

// Build candidate paths in the correct search order.
//
// Rule implemented:
// - If mobDetailsRaw[mobId].spriteTemplateFirst === true, we prefer ancestors first overall.
// - Otherwise we prefer self first.
// - And: “Template image inheritance controls whether we prefer ancestor sprites before or after same-mob fallbacks.”
//   We implement that as:
//   - spriteTemplateFirst=true  => try (type fallback) outer, (template chain) inner
//   - spriteTemplateFirst=false => try (template chain) outer, (type fallback) inner
function buildMobSpriteCandidatePaths(mobId, wantType, wantDir) {
  const raw = mobDetailsRaw && mobDetailsRaw[lc(mobId || '')];
  const ancestorFirst = raw && raw.spriteTemplateFirst === true;

  const chain = getMobSpriteChainIds(mobId); // [self, parent, grandparent...]
  const ids = ancestorFirst ? chain.slice().reverse() : chain.slice();

  const types = mobFallbackTypes(wantType);

  const dir = wantDir || '';

  // Direction rules:
  // - wait/spawn/despawn have no direction
  // - left/right may be mirrored by draw code, but we still attempt both
  // - no other substitutions (no up->forward etc.)
  const typeHasDir = (t) => !(t === 'wait' || t === 'spawn' || t === 'despawn');

  const paths = [];

  if (ancestorFirst) {
    // Prefer templates before same-mob fallback types (i.e., for each fallback type, search preferred chain)
    for (const t of types) {
      for (const id of ids) {
        if (!id) continue;
        if (typeHasDir(t)) paths.push(mobSpritePath(id, t, dir));
        else paths.push(mobSpritePath(id, t, ''));
      }
    }
  } else {
    // Prefer same-mob fallbacks before templates (i.e., for each id, try the fallback type order)
    for (const id of ids) {
      if (!id) continue;
      for (const t of types) {
        if (typeHasDir(t)) paths.push(mobSpritePath(id, t, dir));
        else paths.push(mobSpritePath(id, t, ''));
      }
    }
  }

  return paths;
}

// Generic request-or-return sprite loader (shared by mobs + NPCs).
// - kind: "mob" or "npc" (namespaces the shared store key)
// - idRaw: mobId or npcName
// - animTypesSet: Set of allowed animation type strings (lowercase)
// - wantsDirFn: (tLower) => boolean (whether this type uses direction)
// - buildCandidatesFn: (idRaw, tLower, useDirLower) => [path...]
function getOrRequestActorSprite(kind, idRaw, type, dir, animTypesSet, wantsDirFn, buildCandidatesFn) {
  const t = lc(type || '');
  if (!animTypesSet || !animTypesSet.has(t)) return null;

  const wantsDir = wantsDirFn ? !!wantsDirFn(t) : true;
  const useDir = wantsDir ? lc(dir || '') : '';

  const storeKey = actorStoreKey(kind, idRaw);
  if (!storeKey) return null;

  const entry = ensureSpriteEntry(ACTOR_SPRITES, storeKey);
  if (!entry) return null;

  const k = spriteAnimKey(t, useDir);

  // Known result?
  if (Object.prototype.hasOwnProperty.call(entry.byKey, k)) {
    return entry.byKey[k]; // Image or null (confirmed missing)
  }

  // In flight?
  if (entry.pending[k]) return null;

  entry.pending[k] = true;

  const candidates = (typeof buildCandidatesFn === 'function')
    ? buildCandidatesFn(idRaw, t, useDir)
    : [];

  loadFirstAvailableImage(candidates, (img) => {
    entry.byKey[k] = img;
    entry.pending[k] = false;
    entry.ready = true;
  });

  // If none loadFirstAvailableImage succeeds, we never get a callback.
  // Mark as missing after a timeout so we don’t keep re-requesting forever.
  setTimeout(() => {
    if (!Object.prototype.hasOwnProperty.call(entry.byKey, k) && entry.pending[k]) {
      entry.byKey[k] = null;
      entry.pending[k] = false;
    }
  }, 1500);

  return null;
}


function getOrRequestMobSprite(mobId, type, dir) {
  return getOrRequestActorSprite(
    'mob',
    mobId,
    type,
    dir,
    MOB_ANIM_TYPES,
    (t) => !(t === 'wait' || t === 'spawn' || t === 'despawn'),
    buildMobSpriteCandidatePaths
  );
}

function actorHasAnimSprite(kind, idRaw, type) {
  const id = lc(idRaw || '');
  const t = lc(type || '');
  if (!id || !t) return false;

  const storeKey = actorStoreKey(kind, idRaw);
  if (!storeKey) return false;

  const entry = ACTOR_SPRITES[storeKey];
  const k = spriteAnimKey(t, '');
  if (entry && Object.prototype.hasOwnProperty.call(entry.byKey, k)) {
    return !!entry.byKey[k];
  }

  const sheet =
    (lc(kind) === 'mob')
      ? getOrRequestMobSprite(id, t, '')
      : getOrRequestNpcSprite(id, t, '');

  return !!sheet;
}


// Convenience: populate the legacy sprite fields drawActorSprite expects (idle/runLeft/runRight/stoppedLeft/stoppedRight/stoppedForward).
function buildMobLegacySpriteSet(mob) {
  const id = mob && mob.id;
  if (!id) return null;

  // Base (idle) uses wait (no direction)
  const idle = getOrRequestMobSprite(id, 'wait', '');

  // Movement
  const runLeft  = getOrRequestMobSprite(id, 'run', 'left')  || getOrRequestMobSprite(id, 'move', 'left');
  const runRight = getOrRequestMobSprite(id, 'run', 'right') || getOrRequestMobSprite(id, 'move', 'right');

  // Stopped
  const stoppedLeft    = getOrRequestMobSprite(id, 'stopped', 'left');
  const stoppedRight   = getOrRequestMobSprite(id, 'stopped', 'right');
  const stoppedForward = getOrRequestMobSprite(id, 'stopped', 'forward');

  return { idle, runLeft, runRight, stoppedLeft, stoppedRight, stoppedForward };
}

// ============================================================================
// NPCs: sprite resolution (same pattern as mobs; avoids duplication in draw code)
// ============================================================================

const npcSpriteBank = ACTOR_SPRITES; // shared store with mobs (namespaced keys)

const NPC_ANIM_TYPES = new Set([
  'wait',
  'run',
  'move',
  'stopped',
  'stunned',
  'attack',
  'ranged',
  'ability',
  'hurt',
  'spawn',
  'despawn'
]);


function npcSpritePath(id, type, dir) {
  // NPC filenames currently used by the project:
  //   wait:    assets/sprites/npcs/character_sprite_<npc>.png
  //   run:     assets/sprites/npcs/<npc>_run_left.png / <npc>_run_right.png
  //   stopped: assets/sprites/npcs/<npc>_stopped_left.png / _right.png / _forward.png
  if (type === 'wait') return `assets/sprites/npcs/character_sprite_${id}.png`;
  if (!dir) return `assets/sprites/npcs/${id}_${type}.png`;
  return `assets/sprites/npcs/${id}_${type}_${dir}.png`;
}

function npcFallbackTypes(type) {
  switch (String(type || '')) {
    case 'stunned': return ['stunned', 'stopped'];
    case 'attack':  return ['attack', 'ranged', 'ability', 'stopped'];
    case 'ranged':  return ['ranged', 'attack', 'ability', 'stopped'];
    case 'ability': return ['ability', 'attack', 'ranged', 'stopped'];
    case 'hurt':    return ['hurt', 'stopped'];
    case 'run':     return ['run', 'move', 'stopped'];
    case 'move':    return ['move', 'run', 'stopped'];
    case 'stopped': return ['stopped'];
    case 'spawn':   return ['spawn'];
    case 'despawn': return ['despawn'];
    case 'wait':
    default:        return ['wait'];
  }
}


function buildNpcSpriteCandidatePaths(npcName, wantType, wantDir) {
  const id = lc(npcName || '');
  if (!id) return [];

  const types = npcFallbackTypes(wantType);
  const dir = wantDir || '';

const typeHasDir = (t) => !(t === 'wait' || t === 'spawn' || t === 'despawn');

  const paths = [];

  for (const t of types) {
    if (!NPC_ANIM_TYPES.has(t)) continue;

    if (typeHasDir(t)) {
      // For NPCs, directions are explicit in filenames.
      // Also allow move -> run substitution by fallback list already.
      paths.push(npcSpritePath(id, t, dir));
    } else {
      // wait has no direction
      paths.push(npcSpritePath(id, t, ''));
      // Optional alternate naming if you ever add it later:
      // paths.push(`assets/sprites/npcs/${id}_wait.png`);
    }
  }

  return paths;
}

function ensureNpcSpriteEntry(npcName) {
  return ensureSpriteEntry(npcSpriteBank, actorStoreKey('npc', npcName));
}


function getOrRequestNpcSprite(npcName, type, dir) {
  return getOrRequestActorSprite(
    'npc',
    npcName,
    type,
    dir,
    NPC_ANIM_TYPES,
    (t) => !(t === 'wait'),
    buildNpcSpriteCandidatePaths
  );
}


function buildNpcLegacySpriteSet(char) {
  const name = char && char.name;
  if (!name) return null;

  const idle = getOrRequestNpcSprite(name, 'wait', '');

  const runLeft  = getOrRequestNpcSprite(name, 'run', 'left')  || getOrRequestNpcSprite(name, 'move', 'left');
  const runRight = getOrRequestNpcSprite(name, 'run', 'right') || getOrRequestNpcSprite(name, 'move', 'right');

  const stoppedLeft    = getOrRequestNpcSprite(name, 'stopped', 'left');
  const stoppedRight   = getOrRequestNpcSprite(name, 'stopped', 'right');
  const stoppedForward = getOrRequestNpcSprite(name, 'stopped', 'forward');

  return { idle, runLeft, runRight, stoppedLeft, stoppedRight, stoppedForward };
}


//DIALOGS AND CONVERSATIONS
// Dialog storage. Will be filled on demand.
const dialogs = {};
// Conversation state
let inConversation = false;
let isTypingDialog = false;
let cancelDialogTyping = false;

let controlsLocked = false;
let currentNpc = null;
let currentDialog = null;
let currentPhraseId = null;
let currentDialogKey = null; // which dialog file is currently loaded (e.g. "mira", "rowyn", "forest")
let activeDialogPrompts = [];
let firedDialogTriggers = new Map();
let areaFlags = Object.create(null);          // resets on area enter
const globalFlags = Object.create(null);      // persists until page refresh

function resetAreaFlags() {
  areaFlags = Object.create(null);
}

function getFlag(scope, key) {
  if (!key) return undefined;

  if (scope === 'global') return globalFlags[key];

  // scope === 'area' (and default): prefer area flag if explicitly set,
  // otherwise fall back to global.
  if (Object.prototype.hasOwnProperty.call(areaFlags, key)) {
    return areaFlags[key];
  }
  return globalFlags[key];
}


function setFlag(scope, key, value = true) {
  if (!key) return;
  if (scope === 'global') globalFlags[key] = value;
  else areaFlags[key] = value; // default: area
}

// Timed flags (global/area scopes)
const TIMED_FLAGS = new Map(); // fullKey -> { expiresAtMs, scope, key, revertTo }
const TIMED_EFFECTS = []; // { expiresAtMs, fn }

function _timedFlagFullKey(scope, key) {
  return `${lc(scope || 'global')}:${String(key || '')}`;
}

function setFlagTimed(scope, key, value, durationMs, nowMs = null) {
  const dur = Math.max(0, Math.floor(Number(durationMs || 0)));
  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);

  setFlag(scope, key, value);

  const fullKey = _timedFlagFullKey(scope, key);
  const expiresAtMs = now + dur;

  // Refresh semantics: always refresh to now+duration
  TIMED_FLAGS.set(fullKey, {
    expiresAtMs,
    scope: scope || 'global',
    key: String(key || ''),
    revertTo: false
  });
}

function expireTimedFlags(nowMs) {
  const now = Number(nowMs);
  if (!isFinite(now)) return;

  for (const [fullKey, rec] of TIMED_FLAGS.entries()) {
    if (!rec || !isFinite(rec.expiresAtMs)) {
      TIMED_FLAGS.delete(fullKey);
      continue;
    }
    if (now >= rec.expiresAtMs) {
      setFlag(rec.scope, rec.key, rec.revertTo);
      TIMED_FLAGS.delete(fullKey);
    }
  }
}

function scheduleTimedEffect(expiresAtMs, fn) {
  const t = Number(expiresAtMs);
  if (!isFinite(t) || typeof fn !== 'function') return;
  TIMED_EFFECTS.push({ expiresAtMs: t, fn });
}

function processTimedEffects(nowMs) {
  if (!TIMED_EFFECTS.length) return;
  const now = Number(nowMs);
  for (let i = TIMED_EFFECTS.length - 1; i >= 0; i--) {
    const rec = TIMED_EFFECTS[i];
    if (!rec || !isFinite(rec.expiresAtMs)) {
      TIMED_EFFECTS.splice(i, 1);
      continue;
    }
    if (now >= rec.expiresAtMs) {
      TIMED_EFFECTS.splice(i, 1);
      try { rec.fn(); } catch (_) {}
    }
  }
}

function applyEffects(effects, payload = null) {
  if (!Array.isArray(effects) || effects.length === 0) return;
  // Single shared effect engine: treat ad-hoc effects as a synthetic rule.
  applyRuleEffects({ effects }, payload || null);
}



// function applyEffects(effects, payload = null) {
//   if (!Array.isArray(effects)) return;

//   for (const eff of effects) {
//     if (!eff || typeof eff !== 'object') continue;

//     if (eff.type === 'setFlag') {
//       const scope = eff.scope || 'area';
//       const key = eff.key;
//       const value = (eff.value !== undefined) ? eff.value : true;
//       setFlag(scope, key, value);
//       continue;
//     }

//     if (eff.type === 'setFlagTimed') {
//       const scope = eff.scope || 'area';
//       const key = eff.key;
//       const value = (eff.value !== undefined) ? eff.value : true;
//       const durationMs = Number(eff.durationMs || eff.ms || eff.duration || 0);
//       setFlagTimed(scope, key, value, durationMs);
//       continue;
//     }


//     if (eff.type === 'lockControls') {
//       controlsLocked = true;

//       for (const k in keys) {
//         keys[k] = false;
//       }
//       player.vx = 0;

//       continue;
//     }

//     if (eff.type === 'unlockControls') {
//       controlsLocked = false;

//       for (const k in keys) {
//         keys[k] = false;
//       }

//       continue;
//     }

//     if (eff.type === 'updateStat' || eff.type === 'setStat') {
//       applyRuleEffects({ effects: [eff] });
//       continue;
//     }

//     if (eff.type === 'addItem') {
//       const id = eff.id || eff.item || eff.itemId;
//       const qty = (eff.qty !== undefined) ? eff.qty : (eff.count !== undefined ? eff.count : 1);
//       addItemToInventory(id, qty);
//       continue;
//     }

//     if (eff.type === 'removeItem') {
//       const id = eff.id || eff.item || eff.itemId;
//       const qty = (eff.qty !== undefined) ? eff.qty : (eff.count !== undefined ? eff.count : 1);
//       removeItemFromInventory(id, qty);
//       continue;
//     }

//     // ===== Gate state effects (objects/scenes/dialog) =====
//     if (eff.type === 'setGateOpen') {
//       const id = String(eff.id ?? eff.instanceId ?? '').trim();
//       if (id) setGateIsOpenByInstanceId(id, !!eff.open);
//       continue;
//     }

//     if (eff.type === 'toggleGate') {
//       const id = String(eff.id ?? eff.instanceId ?? '').trim();
//       if (id) toggleGateByInstanceId(id);
//       continue;
//     }


//     if (eff.type === 'setMovement' || eff.type === 'setNpcMovement' || eff.type === 'setNpcAiMode') {
//       applyMovementEffect(eff, null);
//       continue;
//     }

//         // ===== World time effects (scenes/dialog/objects) =====
//     if (eff.type === 'advanceTime') {
//       const minutes = Number(eff.minutes ?? eff.min ?? eff.deltaMin ?? eff.delta ?? 0);
//       __advanceWorldTimeByMinutes(minutes, { source: 'effects' });
//       continue;
//     }

//     if (eff.type === 'setTime') {
//       const tMin = Number(eff.tMin ?? eff.minutes ?? eff.min);
//       if (isFinite(tMin)) {
//         __setWorldTimeMin(tMin, { source: 'effects' });
//       }
//       continue;
//     }


//     if (eff.type === 'setTimePhase') {
//       const phase = eff.phase ?? eff.is ?? eff.to ?? eff.value;
//       if (phase != null) {
//         __setWorldTimeToPhase(String(phase), { source: 'effects' });
//       }
//       continue;
//     }

//     if (eff.type === 'skipToPhase') {
//       const phase = eff.phase ?? eff.is ?? eff.to ?? eff.value;
//       if (phase != null) {
//         __skipWorldTimeToNextPhase(String(phase), { source: 'effects' });
//       }
//       continue;
//     }
//   }
//}




let currentTriggeredPromptId = null;
let currentTriggeredPromptRuleId = null;
let currentRuleSceneId = null;
let dialogOptionsMap = null;
let dialogOptionsByKey = null;
const queuedDialogPrompts = [];
let dialogEndQueue = [];
let __dialogEndQueueActive = false;
let dialogConversationFlags = new Set();

// Party prompt numbering: assign lowest unused integer (1..9) to each active prompt id.
// Freed when prompt disappears.
const __partyPromptSlotById = new Map(); // promptId -> slotNum
const __partyPromptUsedSlots = new Set(); // slotNum
const __promptVisibleMsById = new Map(); // promptId -> ms visible (only while player can trigger)
const __promptAnimYById = new Map(); // promptId -> animated y

function __allocLowestUnusedPartyPromptSlot() {
  for (let n = 1; n <= 9; n++) {
    if (!__partyPromptUsedSlots.has(n)) return n;
  }
  return null; // no slots available
}

function __getOrAssignPartyPromptSlot(promptId) {
  if (!promptId) return null;
  if (__partyPromptSlotById.has(promptId)) return __partyPromptSlotById.get(promptId);

  const n = __allocLowestUnusedPartyPromptSlot();
  if (n == null) return null;

  __partyPromptSlotById.set(promptId, n);
  __partyPromptUsedSlots.add(n);
  return n;
}

function __releasePartyPromptSlot(promptId) {
  if (!promptId) return;
  const n = __partyPromptSlotById.get(promptId);
  __partyPromptSlotById.delete(promptId);
  if (Number.isFinite(n)) __partyPromptUsedSlots.delete(n);
}

function __resetDialogEndQueue() {
  dialogEndQueue = [];
  __dialogEndQueueActive = false;
}

function __resetDialogConversationFlags() {
  dialogConversationFlags = new Set();
}

function __setDialogConversationFlag(key, value = true) {
  const k = String(key || '');
  if (!k) return;
  if (value) dialogConversationFlags.add(k);
  else dialogConversationFlags.delete(k);
}

function __getDialogConversationFlag(key) {
  const k = String(key || '');
  if (!k) return undefined;
  return dialogConversationFlags.has(k) ? true : undefined;
}

function __stripAtEndFlag(eff) {
  if (!eff || typeof eff !== 'object') return eff;
  if (!Object.prototype.hasOwnProperty.call(eff, 'atEnd')) return eff;
  const out = { ...eff };
  delete out.atEnd;
  return out;
}

function __splitDialogEffects(effects) {
  const immediate = [];
  const atEnd = [];
  if (!Array.isArray(effects)) return { immediate, atEnd };
  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;
    if (eff.atEnd === true) atEnd.push(__stripAtEndFlag(eff));
    else immediate.push(eff);
  }
  return { immediate, atEnd };
}

function __enqueueDialogEndEffects(effects) {
  if (!Array.isArray(effects) || effects.length === 0) return;
  dialogEndQueue.push({ type: 'effects', effects });
}

function __enqueueDialogEndAction(action) {
  if (!action || typeof action !== 'object') return;
  const out = { ...action };
  delete out.atEnd;
  dialogEndQueue.push({ type: 'action', action: out });
}

function __continueDialogEndQueue() {
  while (dialogEndQueue.length) {
    const item = dialogEndQueue.shift();
    if (!item) continue;
    if (item.type === 'effects') {
      applyEffects(item.effects);
      continue;
    }
    if (item.type === 'action') {
      const phrase = { action: item.action, __endQueue: true };
      startActionPhrase('__dialog_end_queue', phrase);
      return;
    }
  }
  __dialogEndQueueActive = false;
  __finalizeConversationEnd();
}

function __startDialogEndQueue() {
  if (!dialogEndQueue.length) {
    __finalizeConversationEnd();
    return;
  }
  __dialogEndQueueActive = true;
  __continueDialogEndQueue();
}



let inViewMode = false;
let inActionPhrase = false;
// Action phrase runtime state
let activeAction = null; // { phraseId, startedAtMs, done }

// Scene-cancel helper: if a scene includes a camera reset phrase, we must still run it on cancel.
let __cancelScenePending = false;

function __extractNextIdsFromNextField(nextField) {
  const out = [];

  if (!nextField) return out;

  // Common case: "next": "phrase_id"
  if (typeof nextField === 'string') {
    out.push(nextField);
    return out;
  }

  // Conditional next blocks: "next": [ { ... next: "id" ... }, ... ]
  if (Array.isArray(nextField)) {
    for (const blk of nextField) {
      if (!blk) continue;
      const n = blk.next ?? blk.to ?? blk.id ?? blk.phraseId;
      if (typeof n === 'string') out.push(n);
      else if (Array.isArray(n)) out.push(...__extractNextIdsFromNextField(n));
    }
    return out;
  }

  // Some dialogs may use objects: { next: "id" } / { to: "id" } / etc.
  if (typeof nextField === 'object') {
    const n = nextField.next ?? nextField.to ?? nextField.id ?? nextField.phraseId;
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) out.push(...__extractNextIdsFromNextField(n));
    return out;
  }

  return out;
}

function __resolveConditionalNext(nextField, npcCtx) {
  if (!nextField) return null;
  if (typeof nextField === 'string') return nextField;
  if (!nextField || typeof nextField !== 'object') return null;

  const entries = Object.entries(nextField);
  entries.sort((a, b) => {
    const wa = a[1]?.when && Object.keys(a[1].when).length > 0 ? 0 : 1;
    const wb = b[1]?.when && Object.keys(b[1].when).length > 0 ? 0 : 1;
    return wa - wb;
  });

  for (const [branchName, branch] of entries) {
    const w = branch?.when || {};
    if (checkWhenBlock(w, npcCtx)) {
      return branchName;
    }
  }

  return null;
}

function __findCameraResetPhraseId(dialog, startPhraseId) {
  if (!dialog || !dialog.phrases || !startPhraseId) return null;

  const phrases = dialog.phrases;

  const seen = new Set();
  const stack = [startPhraseId];

  // Safety to avoid infinite loops on bad data
  let steps = 0;
  const stepLimit = 5000;

  while (stack.length && steps < stepLimit) {
    steps++;

    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const p = phrases[id];
    if (!p) continue;

    const act = p.action;
    if (act && typeof act === 'object') {
      if (lc(act.type) === 'camera' && (act.reset === true || lc(act.mode) === 'reset')) {
        return id;
      }
    }

    const nextIds = __extractNextIdsFromNextField(p.next);
    for (const nid of nextIds) {
      if (nid && !seen.has(nid)) stack.push(nid);
    }
  }

  return null;
}


function cancelConversation() {
  // View mode: no scene actions to honor
  if (inViewMode) { endConversation(); return; }

  // If dialog isn’t ready, we can only bail out
  if (!currentDialog) { endConversation(); return; }

  const resetId = __findCameraResetPhraseId(currentDialog, currentPhraseId);
  if (!resetId) { endConversation(); return; }

  const phrase = currentDialog.phrases?.[resetId];
  const act = phrase?.action;

  // Safety: if malformed, just end
  if (!phrase || !act || lc(act.type) !== 'camera') { endConversation(); return; }

  // Run exactly one reset action, then end the conversation when it completes
  __cancelScenePending = true;
  currentPhraseId = resetId;
  startActionPhrase(resetId, phrase);
}


// Action-scene helper: remember where someone was in the party so they can rejoin in the same slot.
const rememberedPartyIndex = Object.create(null); // nameLower -> index


// Helper to load a dialog JSON for a given NPC name. Uses fetch and caches the result.
async function loadDialogFor(name) {
  if (loading) await waitForAreaReady();
  name = lc(name);
  if (dialogs[name]) return dialogs[name];
  try {
    const resp = await fetch(`data/dialogs/${name}.json`);
    if (resp.ok) {
      const data = await resp.json();
      dialogs[name] = data;
      return data;
    }
  } catch (err) {
    console.warn("Failed to fetch dialog JSON for", name, err);
  }
  // Fallback: simple greeting and goodbye
  const fallback = {
    start: '0',
    phrases: {
      '0': { speaker: 'npc', text: `Hello, I am ${name}.`, reaction: 'neutral', next: '1' },
      '1': { speaker: 'npc', text: 'Nice to meet you.', reaction: 'neutral', next: null }
    }
  };
  dialogs[name] = fallback;
  return fallback;
}

function parseDialogRef(ref, fallbackKey) {
  // Accept:
  //  - "phraseId" (local)
  //  - "fileId.phraseId" (cross-file)
  // Split on FIRST dot only so phraseId can contain dots.
  const s = String(ref || '');
  const dot = s.indexOf('.');
  if (dot > 0) {
    const fileKey = lc(s.slice(0, dot).trim());
    const phraseId = s.slice(dot + 1); // keep original casing for phrase keys
    return { fileKey, phraseId };
  }
  return { fileKey: lc(fallbackKey), phraseId: s };
}

async function ensureDialogAndGetPhrase(ref) {
  // Uses currentDialogKey as fallback, and switches dialog if needed.
  const { fileKey, phraseId } = parseDialogRef(ref, currentDialogKey);

  if (!fileKey) return { dialog: null, key: null, phraseId: null };

  if (!currentDialog || !currentDialogKey || fileKey !== currentDialogKey) {
    const data = await loadDialogFor(fileKey);
    currentDialog = data;
    currentDialogKey = fileKey;
  }

  return { dialog: currentDialog, key: currentDialogKey, phraseId };
}


function enqueueDialogPrompt(p) {

  if (window.__traceRulesReasons) {
  }

  if (!p || !p.npc) return;

  if (window.__traceRules) {
  }

  queuedDialogPrompts.push(p);

  if (window.__traceRulesReasons) {
  }

}

function __parseDialogStartRef(startRef, defaultNpcName) {
  const s = String(startRef || '').trim();
  if (!s) return { fileKey: lc(defaultNpcName || ''), phraseId: '' };

  const dot = s.indexOf('.');
  if (dot >= 0) {
    return {
      fileKey: lc(s.slice(0, dot)),
      phraseId: s.slice(dot + 1)
    };
  }

  return {
    fileKey: lc(defaultNpcName || ''),
    phraseId: s
  };
}

function __kickDialogWarm(fileKey) {
  const k = lc(fileKey || '');
  if (!k) return;
  if (loading) return;
  if (dialogs?.[k]) return;

  // Fire-and-forget; loadDialogFor caches into dialogs[k]
  void loadDialogFor(k);
}

function __getPromptTextFromStart(startRef, defaultNpcName) {
  const { fileKey, phraseId } = __parseDialogStartRef(startRef, defaultNpcName);
  if (!fileKey || !phraseId) return null;

  const d = dialogs?.[fileKey];
  if (!d) {
    __kickDialogWarm(fileKey);
    return null;
  }

  const ph = d?.phrases?.[phraseId];
  const t = ph?.text;
  return (typeof t === 'string' && t.trim()) ? t : null;
}

function enqueueNpcSpeechBubblePrompt(npcName, promptText, startPhrase, triggerKey, opts = {}) {
  // If promptText isn't supplied, use the text of the start phrase (so you can author short prompt labels in dialog files).
  const autoText = (promptText == null || promptText === '')
    ? __getPromptTextFromStart(startPhrase, npcName)
    : null;

  enqueueDialogPrompt({
    npc: npcName,
    triggerKey: triggerKey || null, // MUST be set for rule-driven prompts
    prompt: (promptText == null || promptText === '') ? (autoText || '…') : promptText,
    start: startPhrase,
    mode: 'npc_bubble',
    timeoutMode: opts.timeoutMode || 'none',
    ruleId: opts.ruleId || null,
    safeplaceId: opts.safeplaceId || null,
    safeplaceArea: opts.safeplaceArea || null
  });
}


// Remove any queued prompts for a specific rule id (triggerKey)
function removeDialogPromptForRule(ruleId) {
  const rid = String(ruleId || '');
  if (!rid) return;

  for (let i = queuedDialogPrompts.length - 1; i >= 0; i--) {
    const p = queuedDialogPrompts[i];
    if (p && String(p.triggerKey || '') === rid) {
      queuedDialogPrompts.splice(i, 1);
    }
  }
}




function getSectionNameForX(xWorld) {
  const idx = Math.floor(xWorld / currentArea.sectionTileWidth);
  return currentArea.sections[idx]?.name || null;
}

let lastPlayerSection = null; // for section_enter events
let lastPlayerSectionIndex = null;
const lastNpcSection = new Map();      // npcKey -> sectionName|null
const lastNpcSectionIndex = new Map(); // npcKey -> idx|null
let lastPlayerAreaEnterEdge = null; // 'left'|'right' (used for first section_enter after area load)
let pendingVerticalTransferFrom = null; // 'up' | 'down' | null


//LOADING NEW AREAS
let loadingMessage = 'Loading...';

const BLOCKING_LOAD_TRACKER = {
  active: false,
  keys: new Set(),
  started: new Set(),
  done: new Set(),
  failed: new Set()
};

function __resetBlockingLoadTracker(keys) {
  BLOCKING_LOAD_TRACKER.active = true;
  BLOCKING_LOAD_TRACKER.keys = new Set(keys || []);
  BLOCKING_LOAD_TRACKER.started.clear();
  BLOCKING_LOAD_TRACKER.done.clear();
  BLOCKING_LOAD_TRACKER.failed.clear();
}

function __endBlockingLoadTracker() {
  BLOCKING_LOAD_TRACKER.active = false;
  BLOCKING_LOAD_TRACKER.keys.clear();
  BLOCKING_LOAD_TRACKER.started.clear();
  BLOCKING_LOAD_TRACKER.done.clear();
  BLOCKING_LOAD_TRACKER.failed.clear();
}

function __getBlockingLoadProgress() {
  const total = BLOCKING_LOAD_TRACKER.keys.size;
  const done = BLOCKING_LOAD_TRACKER.done.size + BLOCKING_LOAD_TRACKER.failed.size;
  const started = BLOCKING_LOAD_TRACKER.started.size;
  return { total, done, started };
}

function __logBlockingLoad(kind, key, extra = '') {
  if (!BLOCKING_LOAD_TRACKER.active) return;
  const suffix = extra ? ` ${extra}` : '';
  console.log(`[asset-load] ${kind} ${key}${suffix}`);
}

function __trackBlockingImage(key, img) {
  if (!BLOCKING_LOAD_TRACKER.active) return;
  if (!BLOCKING_LOAD_TRACKER.keys.has(key)) return;
  if (BLOCKING_LOAD_TRACKER.started.has(key)) return;
  BLOCKING_LOAD_TRACKER.started.add(key);
  __logBlockingLoad('start', key);

  if (!img) {
    BLOCKING_LOAD_TRACKER.failed.add(key);
    __logBlockingLoad('fail', key);
    return;
  }

  const finalize = (ok) => {
    if (BLOCKING_LOAD_TRACKER.done.has(key) || BLOCKING_LOAD_TRACKER.failed.has(key)) return;
    if (ok) {
      BLOCKING_LOAD_TRACKER.done.add(key);
      __logBlockingLoad('done', key);
    } else {
      BLOCKING_LOAD_TRACKER.failed.add(key);
      __logBlockingLoad('fail', key);
    }
  };

  if (img.complete) {
    finalize(!!img.naturalWidth);
    return;
  }

  const onLoad = () => finalize(true);
  const onErr = () => finalize(false);

  img.addEventListener('load', onLoad, { once: true });
  img.addEventListener('error', onErr, { once: true });
}

function __trackBlockingEntry(entry) {
  if (!entry || !entry._assetKey) return;
  __trackBlockingImage(entry._assetKey, entry.img);
  if (entry.ready) {
    if (!BLOCKING_LOAD_TRACKER.done.has(entry._assetKey)) {
      BLOCKING_LOAD_TRACKER.done.add(entry._assetKey);
      __logBlockingLoad('done', entry._assetKey);
    }
  } else if (entry.failed) {
    if (!BLOCKING_LOAD_TRACKER.failed.has(entry._assetKey)) {
      BLOCKING_LOAD_TRACKER.failed.add(entry._assetKey);
      __logBlockingLoad('fail', entry._assetKey);
    }
  }
}

function __buildBlockingLoadKeys() {
  const keys = new Set();
  if (currentArea) {
    if (currentArea.skyEntry && currentArea.skyEntry._assetKey) {
      keys.add(currentArea.skyEntry._assetKey);
    }
    const [i0, i1] = getSectionRangeForLoading(currentArea, 2);
    for (let i = i0; i <= i1; i++) {
      const g = currentArea.groundEntries && currentArea.groundEntries[i];
      if (g && g._assetKey) keys.add(g._assetKey);

      const d = currentArea.distantEntries && currentArea.distantEntries[i];
      if (typeof d === 'string') keys.add(`tile:${d}`);
      else if (d && d._assetKey) keys.add(d._assetKey);

      const b = currentArea.backgroundEntries && currentArea.backgroundEntries[i];
      if (typeof b === 'string') keys.add(`tile:${b}`);
      else if (b && b._assetKey) keys.add(b._assetKey);
    }
  }

  // Objects in range (all layers)
  if (currentArea) {
    const [i0, i1] = getSectionRangeForLoading(currentArea, 2);
    const objLists = [
      currentArea.backObjects,
      currentArea.foreObjects,
      currentArea.groundBackObjects,
      currentArea.groundForeObjects
    ];
    for (const list of objLists) {
      if (!Array.isArray(list)) continue;
      for (const obj of list) {
        if (!obj) continue;
        if (obj._spawned === false) continue;
        const idx = (typeof obj.sectionIndex === 'number') ? obj.sectionIndex : -1;
        if (idx < i0 || idx > i1) continue;
        const base = objectBaseFromKey(obj.key || obj.name || obj.filename);
        if (!base) continue;
        keys.add(`object:${base}`);
      }
    }
  }

  // World items in range
  if (currentArea && Array.isArray(currentArea.worldItems)) {
    const [i0, i1] = getSectionRangeForLoading(currentArea, 2);
    for (const it of currentArea.worldItems) {
      if (!it) continue;
      const idx = (typeof it.sectionIndex === 'number')
        ? it.sectionIndex
        : getSectionIndexForWorldX(currentAreaName, it.worldX);
      if (idx < i0 || idx > i1) continue;
      if (it.itemId) keys.add(`itemIcon:${it.itemId}`);
    }
  }

  // Player + visible NPC sprites are part of the load gate.
  keys.add('playerSprite:idle');
  for (const npc of npcs || []) {
    if (!npc || !npc.name) continue;
    keys.add(`npcSprite:${npc.name}`);
  }

  // NPC + mob sprites referenced by section defs in range
  if (currentArea) {
    const [i0, i1] = getSectionRangeForLoading(currentArea, 2);
    const secDefs = currentArea.raw?.sections || {};
    for (let i = i0; i <= i1; i++) {
      const sdef = currentArea.sections && currentArea.sections[i];
      const secName = sdef?.name || null;
      if (!secName) continue;
      const raw = secDefs[secName] || null;
      if (!raw) continue;

      const chars = raw.characters;
      if (Array.isArray(chars)) {
        for (const c of chars) {
          const nm = String(c?.name || c?.npc || c?.id || '').trim();
          if (nm) keys.add(`npcSprite:${nm}`);
        }
      } else if (chars && typeof chars === 'object') {
        const nm = String(chars.name || chars.npc || chars.id || '').trim();
        if (nm) keys.add(`npcSprite:${nm}`);
      }

      const mobsArr = raw.mobs;
      if (Array.isArray(mobsArr)) {
        for (const m of mobsArr) {
          const id = String(m?.id || m?.mob || m?.name || '').trim();
          if (id) keys.add(`mobSprite:${id}`);
        }
      }
    }
  }

  return [...keys];
}

function __primeBlockingLoadTracking() {
  if (!BLOCKING_LOAD_TRACKER.active) return;

  if (currentArea) {
    if (currentArea.skyEntry) __trackBlockingEntry(currentArea.skyEntry);
    const [i0, i1] = getSectionRangeForLoading(currentArea, 2);
    for (let i = i0; i <= i1; i++) {
      const g = currentArea.groundEntries && currentArea.groundEntries[i];
      if (g) __trackBlockingEntry(g);

      const d = currentArea.distantEntries && currentArea.distantEntries[i];
      if (typeof d === 'string') {
        const entry = loadTileImage(d);
        currentArea.distantEntries[i] = entry;
        __trackBlockingEntry(entry);
      } else if (d) {
        __trackBlockingEntry(d);
      }

      const b = currentArea.backgroundEntries && currentArea.backgroundEntries[i];
      if (typeof b === 'string') {
        const entry = loadTileImage(b);
        currentArea.backgroundEntries[i] = entry;
        __trackBlockingEntry(entry);
      } else if (b) {
        __trackBlockingEntry(b);
      }
    }
  }

  if (currentArea) {
    const [i0, i1] = getSectionRangeForLoading(currentArea, 2);

    const objLists = [
      currentArea.backObjects,
      currentArea.foreObjects,
      currentArea.groundBackObjects,
      currentArea.groundForeObjects
    ];
    for (const list of objLists) {
      if (!Array.isArray(list)) continue;
      for (const obj of list) {
        if (!obj) continue;
        if (obj._spawned === false) continue;
        const idx = (typeof obj.sectionIndex === 'number') ? obj.sectionIndex : -1;
        if (idx < i0 || idx > i1) continue;
        const base = objectBaseFromKey(obj.key || obj.name || obj.filename);
        if (!base) continue;
        const entry = loadObjectImage(base);
        if (entry) {
          entry._assetKey = `object:${base}`;
          __trackBlockingEntry(entry);
        }
      }
    }

    if (Array.isArray(currentArea.worldItems)) {
      for (const it of currentArea.worldItems) {
        if (!it) continue;
        const idx = (typeof it.sectionIndex === 'number')
          ? it.sectionIndex
          : getSectionIndexForWorldX(currentAreaName, it.worldX);
        if (idx < i0 || idx > i1) continue;
        if (!it.itemId) continue;
        const def = getItemDef(it.itemId);
        const icon = __getItemIcon(it.itemId, def);
        if (icon) {
          icon._assetKey = `itemIcon:${it.itemId}`;
          __trackBlockingEntry(icon);
        }
      }
    }
  }

  if (playerSprites && playerSprites.idle) {
    __trackBlockingImage('playerSprite:idle', playerSprites.idle);
    if (playerSprites.ready) {
      BLOCKING_LOAD_TRACKER.done.add('playerSprite:idle');
      __logBlockingLoad('done', 'playerSprite:idle');
    }
  }

  for (const npc of npcs || []) {
    if (!npc || !npc.name) continue;
    const entry = npcSprites[npc.name];
    if (!entry || !entry.idle) continue;
    const key = `npcSprite:${npc.name}`;
    __trackBlockingImage(key, entry.idle);
    if (entry.ready) {
      BLOCKING_LOAD_TRACKER.done.add(key);
      __logBlockingLoad('done', key);
    }
  }

  if (currentArea) {
    const [i0, i1] = getSectionRangeForLoading(currentArea, 2);
    const secDefs = currentArea.raw?.sections || {};
    for (let i = i0; i <= i1; i++) {
      const sdef = currentArea.sections && currentArea.sections[i];
      const secName = sdef?.name || null;
      if (!secName) continue;
      const raw = secDefs[secName] || null;
      if (!raw) continue;

      const chars = raw.characters;
      const trackNpc = (nm) => {
        if (!nm) return;
        const entry = npcSprites[nm];
        if (!entry || !entry.idle) return;
        const key = `npcSprite:${nm}`;
        __trackBlockingImage(key, entry.idle);
        if (entry.ready) {
          BLOCKING_LOAD_TRACKER.done.add(key);
          __logBlockingLoad('done', key);
        }
      };

      if (Array.isArray(chars)) {
        for (const c of chars) {
          const nm = String(c?.name || c?.npc || c?.id || '').trim();
          trackNpc(nm);
        }
      } else if (chars && typeof chars === 'object') {
        const nm = String(chars.name || chars.npc || chars.id || '').trim();
        trackNpc(nm);
      }

      const mobsArr = raw.mobs;
      if (Array.isArray(mobsArr)) {
        for (const m of mobsArr) {
          const id = String(m?.id || m?.mob || m?.name || '').trim();
          if (!id) continue;
          const entry = mobSprites[id];
          if (entry && entry.img) {
            __trackBlockingImage(`mobSprite:${id}`, entry.img);
            if (entry.ready) {
              BLOCKING_LOAD_TRACKER.done.add(`mobSprite:${id}`);
              __logBlockingLoad('done', `mobSprite:${id}`);
            }
          }
        }
      }
    }
  }
}

function beginLoadingForCurrentArea(msg = 'Loading...') {
  loading = true;
  globalThis.loading = true;
  loadingMessage = msg;

  const keys = __buildBlockingLoadKeys();
  __resetBlockingLoadTracker(keys);
  __primeBlockingLoadTracking();
}

async function waitForAreaReady() {
  if (!loading) return;
  while (loading) {
    await sleepMs(50);
  }
}

function getSectionRangeForLoading(area, pad = 2) {
  if (!area) return [0, -1];
  const tileW = area.sectionTileWidth || 128;
  const curIdx = Math.max(0, Math.floor(player.worldX / tileW));
  const i0 = Math.max(0, curIdx - pad);
  const i1 = Math.min(area.sections.length - 1, curIdx + pad);
  return [i0, i1];
}

function __isEntryReadyOrFailed(entry) {
  if (!entry) return true;
  if (entry.ready) return true;
  if (entry.failed) return true;
  return false;
}

function isAreaReadyForSections(area, i0, i1) {
  if (!area) return false;

  // Require sky if defined (ready or failed)
  if (area.skyEntry && !__isEntryReadyOrFailed(area.skyEntry)) return false;

  // Require section layers (ground + distant + background)
  for (let i = i0; i <= i1; i++) {
    const g = area.groundEntries[i];
    if (g && !__isEntryReadyOrFailed(g)) return false;

    const d = area.distantEntries && area.distantEntries[i];
    if (typeof d === 'string') return false;
    if (d && !__isEntryReadyOrFailed(d)) return false;

    const b = area.backgroundEntries && area.backgroundEntries[i];
    if (typeof b === 'string') return false;
    if (b && !__isEntryReadyOrFailed(b)) return false;
  }

  // Objects in range (all layers)
  const objLists = [
    area.backObjects,
    area.foreObjects,
    area.groundBackObjects,
    area.groundForeObjects
  ];
  for (const list of objLists) {
    if (!Array.isArray(list)) continue;
    for (const obj of list) {
      if (!obj) continue;
      if (obj._spawned === false) continue;
      const idx = (typeof obj.sectionIndex === 'number') ? obj.sectionIndex : -1;
      if (idx < i0 || idx > i1) continue;
      const base = objectBaseFromKey(obj.key || obj.name || obj.filename);
      if (!base) continue;
      const entry = loadObjectImage(base);
      if (!__isEntryReadyOrFailed(entry)) return false;
    }
  }

  // World items in range
  if (Array.isArray(area.worldItems)) {
    for (const it of area.worldItems) {
      if (!it) continue;
      const idx = (typeof it.sectionIndex === 'number')
        ? it.sectionIndex
        : getSectionIndexForWorldX(currentAreaName, it.worldX);
      if (idx < i0 || idx > i1) continue;
      const def = getItemDef(it.itemId);
      const icon = __getItemIcon(it.itemId, def);
      if (!__isEntryReadyOrFailed(icon)) return false;
    }
  }

  // NPC + mob sprites for placed entries in range
  const secDefs = area.raw?.sections || {};
  for (let i = i0; i <= i1; i++) {
    const sdef = area.sections && area.sections[i];
    const secName = sdef?.name || null;
    if (!secName) continue;
    const raw = secDefs[secName] || null;
    if (!raw) continue;

    const chars = raw.characters;
    if (Array.isArray(chars)) {
      for (const c of chars) {
        const nm = String(c?.name || c?.npc || c?.id || '').trim();
        if (!nm) continue;
        const sprites = npcSprites[nm];
        if (sprites && !__isEntryReadyOrFailed(sprites)) return false;
      }
    } else if (chars && typeof chars === 'object') {
      const nm = String(chars.name || chars.npc || chars.id || '').trim();
      if (nm) {
        const sprites = npcSprites[nm];
        if (sprites && !__isEntryReadyOrFailed(sprites)) return false;
      }
    }

    const mobsArr = raw.mobs;
    if (Array.isArray(mobsArr)) {
      for (const m of mobsArr) {
        const id = String(m?.id || m?.mob || m?.name || '').trim();
        if (!id) continue;
        const sprite = mobSprites[id];
        if (sprite && !__isEntryReadyOrFailed(sprite)) return false;
      }
    }
  }

  return true;
}



//AREA NAME BANNER
const AREA_BANNER = {
  active: false,
  text: '',
  start: 0,
  // timings in ms
  fadeIn: 400,
  hold: 1400,
  fadeOut: 600
};

function showAreaBanner(name) {
  AREA_BANNER.active = true;
  AREA_BANNER.text = String(name || '').trim();
  AREA_BANNER.start = getGameNowMs();
}

function drawAreaBanner() {
  if (!AREA_BANNER.active || !AREA_BANNER.text) return;

  const now = getGameNowMs();
  const t = now - AREA_BANNER.start;
  const total = AREA_BANNER.fadeIn + AREA_BANNER.hold + AREA_BANNER.fadeOut;

  if (t >= total) {
    AREA_BANNER.active = false;
    return;
  }

  // Compute alpha over time
  let alpha = 1;
  if (t < AREA_BANNER.fadeIn) {
    alpha = t / AREA_BANNER.fadeIn; // fade in
  } else if (t > AREA_BANNER.fadeIn + AREA_BANNER.hold) {
    const outT = t - (AREA_BANNER.fadeIn + AREA_BANNER.hold);
    alpha = 1 - (outT / AREA_BANNER.fadeOut); // fade out
  }

  // Draw centered rounded banner near top
  const padX = 16;
  const padY = 8;
  const text = AREA_BANNER.text;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  ctx.font = uiFont(60, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textW = ctx.measureText(text).width;
  const boxW = Math.ceil(textW) + padX * 2;
  const boxH = 32;
  const x = Math.floor((canvas.width - boxW) / 2);
  const y = 18;

  // rounded rect
  const r = 8;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + boxW - r, y);
  ctx.quadraticCurveTo(x + boxW, y, x + boxW, y + r);
  ctx.lineTo(x + boxW, y + boxH - r);
  ctx.quadraticCurveTo(x + boxW, y + boxH, x + boxW - r, y + boxH);
  ctx.lineTo(x + r, y + boxH);
  ctx.quadraticCurveTo(x, y + boxH, x, y + boxH - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  // subtle outline
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // text
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + boxW / 2, y + boxH / 2);

  ctx.restore();
}

// SECTION NAME BANNER
const SECTION_BANNER = {
  active: false,
  text: '',
  start: 0,
  fadeIn: 220,
  hold: 900,
  fadeOut: 320
};

function showSectionBanner(name) {
  SECTION_BANNER.active = true;
  SECTION_BANNER.text = String(name || '').trim();
  SECTION_BANNER.start = getGameNowMs();
}

function drawSectionBanner() {
  if (!SECTION_BANNER.active || !SECTION_BANNER.text) return;

  const now = getGameNowMs();
  const t = now - SECTION_BANNER.start;
  const total = SECTION_BANNER.fadeIn + SECTION_BANNER.hold + SECTION_BANNER.fadeOut;

  if (t >= total) {
    SECTION_BANNER.active = false;
    return;
  }

  let alpha = 1;
  if (t < SECTION_BANNER.fadeIn) {
    alpha = t / SECTION_BANNER.fadeIn;
  } else if (t > SECTION_BANNER.fadeIn + SECTION_BANNER.hold) {
    const outT = t - (SECTION_BANNER.fadeIn + SECTION_BANNER.hold);
    alpha = 1 - (outT / SECTION_BANNER.fadeOut);
  }

  const padX = 14;
  const padY = 7;
  const text = SECTION_BANNER.text;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  ctx.font = uiFont(46, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textW = ctx.measureText(text).width;
  const boxW = Math.ceil(textW) + padX * 2;
  const boxH = 30;

  // Draw just below the area banner
  const x = Math.floor((canvas.width - boxW) / 2);
  const y = 60;

  const r = 8;
  ctx.fillStyle = 'rgba(0,0,0,0.50)';
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + boxW - r, y);
  ctx.quadraticCurveTo(x + boxW, y, x + boxW, y + r);
  ctx.lineTo(x + boxW, y + boxH - r);
  ctx.quadraticCurveTo(x + boxW, y + boxH, x + boxW - r, y + boxH);
  ctx.lineTo(x + r, y + boxH);
  ctx.quadraticCurveTo(x, y + boxH, x, y + boxH - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + boxW / 2, y + boxH / 2);

  ctx.restore();
}


// ******************* ASSET HELPERS **************************
function loadGroundTile(key) {
  if (!key) return null;
  if (groundImages.has(key)) return groundImages.get(key);
  const img = new Image();
  const entry = { img, ready: false, w: 0, h: 0 };
  entry._assetKey = `ground:${String(key)}`;
  img.onload = () => {
    entry.ready = true;
    entry.w = img.width;
    entry.h = img.height;
    // NEW: once a tile is ready, fix geometry if this area is active
    if (currentArea) recalcCurrentAreaGeometry();
  };

  img.onerror = () => {
    console.warn("Failed to load ground tile:", key);
  };
  img.src = `assets/tiles/${key}.png`;
  groundImages.set(key, entry);
  return entry;
}

function getTileDrawWidth(entry) {
  if (!entry || !entry.ready || entry.h === 0) return 128; // fallback
  return Math.floor(TILE_DRAW_HEIGHT() * (entry.w / entry.h));
}

// Poisson(λ) sampler (Knuth)
function samplePoisson(lambda) {
  if (!lambda || lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// Generic tile loader for assets/tiles/*
const tileImages = new Map(); // name -> {img, ready, w, h}
function loadTileImage(name) {
  if (!name) return null;
  const key = String(name).trim();
  if (tileImages.has(key)) return tileImages.get(key);
  const img = new Image();
  const entry = { img, ready: false, w: 0, h: 0 };
  entry._assetKey = `tile:${key}`;
  img.onload = () => { entry.ready = true; entry.w = img.width; entry.h = img.height; };
  img.onerror = () => console.warn('Failed to load tile image:', key);
  // Allow names with or without extension
  const src = key.includes('.') ? key : `${key}.png`;
  img.src = `assets/tiles/${src}`;
  tileImages.set(key, entry);
  return entry;
}

// ===== Background asset warming (non-blocking) =====
const ASSET_WARM_ENQUEUED = new Set();
const ASSET_WARM_QUEUE = [];

// Enqueue small, cheap “start a load” tasks; processed a few per frame.
function enqueueAssetWarm(keyRaw, fn) {
  const key = String(keyRaw || '').trim();
  if (!key || typeof fn !== 'function') return;
  if (ASSET_WARM_ENQUEUED.has(key)) return;
  ASSET_WARM_ENQUEUED.add(key);
  ASSET_WARM_QUEUE.push(fn);
}

function processAssetWarmQueue(maxPerFrame = 3) {
  const n = Math.max(0, Math.floor(Number(maxPerFrame) || 0));
  for (let i = 0; i < n && ASSET_WARM_QUEUE.length; i++) {
    const fn = ASSET_WARM_QUEUE.shift();
    try { fn(); } catch (e) { console.warn('[assetWarm] task failed', e); }
  }
}


// ===== Portrait images (assets/portraits/*) with cache + awaitable readiness =====
const PORTRAIT_IMAGE_CACHE = Object.create(null);

function __getPortraitEntryBySrc(srcRaw) {
  const src = String(srcRaw || '').trim();
  if (!src) return null;

  let entry = PORTRAIT_IMAGE_CACHE[src];
  if (entry) return entry;

  const img = new Image();
  entry = { img, ready: false, failed: false, _waiters: [] };

  img.onload = () => {
    entry.ready = true;
    entry.failed = false;
    const ws = entry._waiters.splice(0);
    for (const w of ws) w(true);
  };

  img.onerror = () => {
    entry.ready = false;
    entry.failed = true;
    const ws = entry._waiters.splice(0);
    for (const w of ws) w(false);
  };

  img.src = src;
  PORTRAIT_IMAGE_CACHE[src] = entry;
  return entry;
}

function __waitPortraitEntry(entry) {
  return new Promise((resolve) => {
    if (!entry) return resolve(false);
    if (entry.ready) return resolve(true);
    if (entry.failed) return resolve(false);
    entry._waiters.push(resolve);
  });
}

async function ensurePortraitSrcLoaded(portraitPath, fallbackPath) {
  const main = __getPortraitEntryBySrc(portraitPath);
  const okMain = await __waitPortraitEntry(main);
  if (okMain) return portraitPath;

  const fb = __getPortraitEntryBySrc(fallbackPath);
  await __waitPortraitEntry(fb);
  return fallbackPath;
}


// ===== Object images (assets/objects/*) =====
const objectImages = new Map(); // name -> {img, ready, w, h}
const OBJECT_ANIM_FRAME_MS = 100;          // 10 fps
const OBJECT_INTERACT_FALLBACK_MS = 700;   // if we can't infer duration from frames
const OBJECT_TRANSITION_FALLBACK_MS = 900; // opening/closing fallback

function loadObjectImage(name) {
  if (!name) return null;

  const key = String(name).trim();
  if (!key) return null;

  if (objectImages.has(key)) return objectImages.get(key);

  const img = new Image();

  // NOTE: "frames" auto-detected for simple horizontal spritesheets:
  // If width > height, we assume N frames where N ~= width/height.
  const entry = { img, ready: false, failed: false, w: 0, h: 0, frames: 1, frameW: 0, frameH: 0 };

  img.onload = () => {
    entry.ready = true;
    entry.failed = false;
    entry.w = img.width;
    entry.h = img.height;

    // Prefer explicit per-object frame size (non-square allowed)
    const spec = _getObjectAnimFrameSpecForImageKey(key);

    if (spec) {
      const fw = Math.floor(spec.w);
      const fh = Math.floor(spec.h);

      const frames = Math.max(1, Math.floor((img.width || 1) / Math.max(1, fw)));

      entry.frames = frames;
      entry.frameW = fw;
      entry.frameH = fh;
      return;
    }

    // Fallback: old square-ish heuristic (frame ~= image height)
    const h = Math.max(1, img.height || 1);
    const approx = Math.round((img.width || 1) / h);
    const frames = (approx >= 2 && (img.width > img.height)) ? approx : 1;

    entry.frames = Math.max(1, frames);
    entry.frameW = Math.floor((img.width || 1) / entry.frames);
    entry.frameH = Math.floor(img.height || 1);
  };


  img.onerror = () => {
    entry.ready = false;
    entry.failed = true;
    console.warn('Failed to load object image:', key);
  };

  const src = key.includes('.') ? key : `${key}.png`;
  img.src = `assets/objects/${src}`;

  objectImages.set(key, entry);
  return entry;
}

// layer token used by instanceKey: "object:<layer>:<base>:<i>"
function _getObjectBucketListByLayerToken(layerToken) {
  const t = lc(layerToken);
  if (!currentArea) return null;

  if (t === 'back')  return currentArea.backObjects;
  if (t === 'fore')  return currentArea.foreObjects;
  if (t === 'gback') return currentArea.groundBackObjects;
  if (t === 'gfore') return currentArea.groundForeObjects;

  return null;
}

function findPlacedObjectByInstanceKey(instanceKey) {
  // Supports:
  //   legacy: "object:<layer>:<base>:<i>"
  //   new:    "object:<customId>"  (where placed object has o.instanceId = "<customId>")
  const raw = String(instanceKey || '');
  if (!raw) return null;

  if (!raw.startsWith('object:')) return null;

  const rest = raw.slice('object:'.length);
  const parts = raw.split(':');

  // --- New format: object:<customId> ---
  // (We treat anything that is not the 4-part legacy format as a custom id.)
  if (parts.length !== 4) {
    const wantId = String(rest || '').trim();
    if (!wantId || !currentArea) return null;

    const buckets = [
      currentArea.backObjects,
      currentArea.foreObjects,
      currentArea.groundBackObjects,
      currentArea.groundForeObjects
    ];

    for (const list of buckets) {
      if (!Array.isArray(list)) continue;
      for (const o of list) {
        if (!o) continue;
        if (String(o.instanceId || '').trim() === wantId) return o;
      }
    }

    return null;
  }

  // --- Legacy format: object:<layer>:<base>:<i> ---
  if (lc(parts[0]) !== 'object') return null;

  const layer = parts[1];
  const base = lc(parts[2]);
  const idx = Math.floor(Number(parts[3]));

  const list = _getObjectBucketListByLayerToken(layer);
  if (!Array.isArray(list)) return null;
  if (!isFinite(idx) || idx < 0 || idx >= list.length) return null;

  const o = list[idx];
  if (!o) return null;

  const gotBase = objectBaseFromKey(o.key || o.name || o.filename);
  if (lc(gotBase) !== base) return null;

  return o;
}


function _objectImageUsable(key) {
  const e = loadObjectImage(key);
  return !!(e && !e.failed);
}

function _objectBaseFromImageKey(imageKey) {
  // imageKey might be: "section_mist_opening", "tua_bush_interact", etc.
  const base0 = lc(objectBaseFromKey(imageKey));
  return base0.replace(/_(open|closed|opening|closing|interact)$/i, '');
}

function _getObjectAnimFrameSpecForImageKey(imageKey) {
  const base = _objectBaseFromImageKey(imageKey);
  const def = getObjectDef(base) || null;

  const w = Number(def?.animFramePx?.w);
  const h = Number(def?.animFramePx?.h);

  if (isFinite(w) && isFinite(h) && w > 0 && h > 0) return { w, h };
  return null;
}

function _estimateObjectAnimDurationMs(entry, fallbackMs) {
  if (entry && entry.ready && !entry.failed && entry.frames && entry.frames > 1) {
    return Math.max(1, entry.frames) * OBJECT_ANIM_FRAME_MS;
  }
  return fallbackMs;
}

function _resolveStickyObjectRender(obj, out) {
  if (!obj || !out) return out;

  const e = out.entry;

  // If the desired render is ready, accept it and (if looped) remember it as the sticky fallback.
  if (e && e.ready && !e.failed) {
    if (out.loop) obj._stickyObjectKey = out.key;
    return out;
  }

  // Otherwise, keep drawing the last known-good looped key (prevents “disappear while loading”).
  const stickyKey = String(obj._stickyObjectKey || '');
  if (stickyKey) {
    const se = loadObjectImage(stickyKey);
    if (se && se.ready && !se.failed) {
      return { key: stickyKey, entry: se, loop: true, nonLoopKind: null };
    }
  }

  return out;
}


function resolvePlacedObjectRender(obj, baseId, nowMs) {
  // Returns:
  // { key, entry, loop, nonLoopKind } where nonLoopKind is 'opening'|'closing'|'interact'|null
  const base = lc(baseId || objectBaseFromKey(obj?.key));
  if (!base) return { key: '', entry: null, loop: true, nonLoopKind: null };

  const def = getObjectDef(base) || null;

  // ---- 1) Interact animation has priority for interactables ----
  if (obj && isFinite(obj._interactAnimStartMs) && obj._interactAnimStartMs > 0) {
    const k = `${base}_interact`;
    const e = loadObjectImage(k);

    // If the file doesn't exist, cancel immediately and fall through to normal render.
    if (e && e.failed) {
      obj._interactAnimStartMs = 0;
      obj._interactAnimPlayMs = 0;
    } else if (e && e.ready && !e.failed) {
      // Start the interact animation only once the spritesheet is actually ready.
      if (!isFinite(obj._interactAnimPlayMs) || obj._interactAnimPlayMs <= 0) {
        obj._interactAnimPlayMs = nowMs;
      }

      const dur = _estimateObjectAnimDurationMs(e, OBJECT_INTERACT_FALLBACK_MS);
      if ((nowMs - obj._interactAnimPlayMs) >= dur) {
        obj._interactAnimStartMs = 0;
        obj._interactAnimPlayMs = 0;
      } else {
        return _resolveStickyObjectRender(obj, { key: k, entry: e, loop: false, nonLoopKind: 'interact' });
      }
    }
    // If e exists but isn't ready yet: keep current sticky render (handled by later returns).
  }

  if (obj && isFinite(obj._interactAnimStartMs) && obj._interactAnimStartMs > 0) {
    const k = `${base}_interact`;
    const e = loadObjectImage(k);

    // If the file doesn't exist, cancel immediately and fall through to normal render.
    if (e && e.failed) {
      obj._interactAnimStartMs = 0;
    } else if (e) {
      const dur = _estimateObjectAnimDurationMs(e, OBJECT_INTERACT_FALLBACK_MS);
      if ((nowMs - obj._interactAnimStartMs) >= dur) {
        obj._interactAnimStartMs = 0;
      } else {
        return { key: k, entry: e, loop: false, nonLoopKind: 'interact' };
      }
    }
  }

    // ---- 2) Obstacles: blocker + gate open/closed + opening/closing transitions ----
  const blocker = def?.blocker || null;
  const gate = def?.gate || null;

  if (blocker || gate) {
    let passableNow = true;

    if (gate) {
      // Gate is passable only if open
      const fallbackInstanceId = String(obj?.instanceId || '').trim();
      passableNow = getGateIsOpenForObjectInstance(obj, def, fallbackInstanceId);
    } else if (blocker) {
      // Blocker is passable for rendering if the PLAYER/PARTY has the required tag
      passableNow = shouldPlayerSeeBlockerAsOpen(blocker);
    }

    if (obj._obstaclePassable == null) obj._obstaclePassable = passableNow;

    // Start transition if state changed and we aren't already transitioning
    if (!obj._obstacleTransition && passableNow !== obj._obstaclePassable) {
      obj._obstacleTransition = {
        kind: passableNow ? 'opening' : 'closing',
        startMs: nowMs,
        playMs: 0,
        toPassable: passableNow
      };
    }

    // If transitioning, try to play opening/closing if available
    if (obj._obstacleTransition) {
      const kind = obj._obstacleTransition.kind;
      const k = `${base}_${kind}`;
      const e = loadObjectImage(k);

      // If missing, snap state and stop transitioning
      if (e && e.failed) {
        obj._obstaclePassable = !!obj._obstacleTransition.toPassable;
        obj._obstacleTransition = null;
      } else if (e && e.ready && !e.failed) {
        // Start the transition animation only once the spritesheet is ready.
        if (!isFinite(obj._obstacleTransition.playMs) || obj._obstacleTransition.playMs <= 0) {
          obj._obstacleTransition.playMs = nowMs;
        }

        const dur = _estimateObjectAnimDurationMs(e, OBJECT_TRANSITION_FALLBACK_MS);
        if ((nowMs - obj._obstacleTransition.playMs) >= dur) {
          obj._obstaclePassable = !!obj._obstacleTransition.toPassable;
          obj._obstacleTransition = null;
        } else {
          return _resolveStickyObjectRender(obj, { key: k, entry: e, loop: false, nonLoopKind: kind });
        }
      }
    }

    // Stable open/closed (prefer suffix if present, fallback to base)
    const stableKey = `${base}_${(passableNow ? 'open' : 'closed')}`;
    const stableEntry = loadObjectImage(stableKey);

    if (stableEntry && stableEntry.failed) {
      const baseEntry = loadObjectImage(base);
      return _resolveStickyObjectRender(obj, { key: base, entry: baseEntry, loop: true, nonLoopKind: null });
    }

    return _resolveStickyObjectRender(obj, { key: stableKey, entry: stableEntry, loop: true, nonLoopKind: null });
  }

  // ---- 3) Default ----
  const entry = loadObjectImage(base);
  return _resolveStickyObjectRender(obj, { key: base, entry, loop: true, nonLoopKind: null });

}

function drawObjectImageEntry(entry, sx, dy, targetW, targetH, nowMs, startMs, loop) {
  if (!entry || !entry.ready || entry.failed) return;

  // Not a spritesheet => plain draw
  if (!entry.frames || entry.frames <= 1 || !entry.frameW) {
    ctx.drawImage(entry.img, sx, dy, targetW, targetH);
    return;
  }

  const t0 = isFinite(startMs) ? Number(startMs) : 0;
  const elapsed = Math.max(0, nowMs - t0);
  const frame = Math.floor(elapsed / OBJECT_ANIM_FRAME_MS);

  const idx = loop ? (frame % entry.frames) : Math.min(entry.frames - 1, frame);

  const sw = Math.max(1, entry.frameW);
  const sh = Math.max(1, entry.frameH);
  const sxSheet = Math.max(0, Math.floor(idx * sw));

  ctx.drawImage(entry.img, sxSheet, 0, sw, sh, sx, dy, targetW, targetH);
}



function parseList(csv) {
  if (!csv) return [];
  return String(csv)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}


function recalcCurrentAreaGeometry() {
  if (!currentArea) return;

  // Prefer a ready ground entry to compute tile width
  let entry = currentArea.groundEntries.find(e => e && e.ready) || null;
  if (!entry && currentArea.sections.length > 0) {
    entry = loadGroundTile(currentArea.sections[0].groundKey);
  }

  // --- NEW: remember old geometry so we can rescale sprinkled objects
  const oldTileW = currentArea.sectionTileWidth || getTileDrawWidth(entry) || 128;
  const oldLen   = currentArea.lengthPx || (currentArea.sections.length * oldTileW);

  let tileW = getTileDrawWidth(entry);
  if (!tileW || tileW <= 0) tileW = 128; // safe fallback

  const newLen = currentArea.sections.length * tileW;

  currentArea.sectionTileWidth = tileW;
  currentArea.lengthPx = newLen;

  // Rebuild world exits with correct absolute X
  const exitsWorld = [];
  for (let i = 0; i < currentArea.sections.length; i++) {
    const s = currentArea.sections[i];
    const startX = i * tileW;
    for (const ex of s.exits) {
      exitsWorld.push({
        ...ex,
        sectionIndex: i,
        worldX: startX + (Number(ex.posLocal) || 0)
      });
    }
  }
  currentArea.exitsWorld = exitsWorld;
  worldExits = exitsWorld;

  // Rebuild world safe places with correct absolute X
  const safePlacesWorld = [];
  for (let i = 0; i < currentArea.sections.length; i++) {
    const s = currentArea.sections[i];
    const startX = i * tileW;
    for (const sp of (s.safePlaces || [])) {
      safePlacesWorld.push({
        ...sp,
        sectionIndex: i,
        worldX: startX + (Number(sp.posLocal) || 0)
      });
    }
  }
  currentArea.safePlacesWorld = safePlacesWorld;
  worldSafePlaces = safePlacesWorld;



  // --- NEW: recompute section-anchored objects exactly (sectionIndex * tileW + posLocal)
  function recomputeAnchored(arr) {
    if (!arr) return;
    for (const o of arr) {
      if (o && o.anchorToSection && typeof o.sectionIndex === 'number' && typeof o.posLocal === 'number') {
        o.worldX = (o.sectionIndex * tileW) + o.posLocal;
      }
    }
  }

  // Anything built from a section-local "position" should be recomputed, not scaled.
  recomputeAnchored(currentArea.backObjects);
  recomputeAnchored(currentArea.foreObjects);
  recomputeAnchored(currentArea.groundBackObjects);
  recomputeAnchored(currentArea.groundForeObjects);

  // --- NEW: rescale sprinkled positions to preserve even distribution
  const scale = (oldLen > 0) ? (newLen / oldLen) : 1;
  if (scale && isFinite(scale) && scale !== 1) {
    function scaleArrayPositions(arr) {
      if (!arr) return;
      for (const o of arr) {
        if (o && typeof o.worldX === 'number' && !o.anchorToSection) {
          o.worldX *= scale;
        }
      }
    }
    scaleArrayPositions(currentArea.backObjects);  // your background objects
    scaleArrayPositions(currentArea.foreObjects);  // your foreground objects
    scaleArrayPositions(currentArea.groundBackObjects);
    scaleArrayPositions(currentArea.groundForeObjects);
    scaleArrayPositions(trees);
    scaleArrayPositions(bushes);
    scaleArrayPositions(rocks);
    // (We deliberately do NOT rescale NPCs or registry positions.)
  }


  // Update bounds & clamp player/camera
  worldMax = currentArea.lengthPx;
  // DO NOT clamp player here — edge transfers depend on overshoot

  //player.worldX = Math.max(0, Math.min(player.worldX, currentArea.lengthPx - player.w));
  cameraX = Math.max(0, Math.min(cameraX, Math.max(0, currentArea.lengthPx - canvas.width)));
}





// ===== Areas JSON loader =====
async function loadAreasJSON() {
  const candidates = ['data/areas.json', 'areas.json', '/areas.json'];
  for (const url of candidates) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        return data;
      }
    } catch (e) {
      // try next
    }
  }
  console.warn("Could not load areas.json from any known path.");
  return {};
}

// ===== Build Area =====
function normalizeExits(exitsObj) {
  // exitsObj like {"1": {direction, Position, targetexit?}, ...}
  // Return array of {id, direction, posLocal, target}
  const arr = [];
  if (!exitsObj) return arr;
  for (const [id, ex] of Object.entries(exitsObj)) {
    if (!ex) continue;
    const dir = lc(ex.direction); // "up"/"down"
    const pos = ex.Position ?? ex.position ?? 0;
    arr.push({ id, direction: dir, posLocal: Number(pos) || 0, target: ex.targetexit || null });
  }
  return arr;
}

function normalizeSafePlaces(safeObj) {
  // safeObj like {"rowyn_spawn": {Position}, ...}
  // Return array of {id, posLocal}
  const arr = [];
  if (!safeObj) return arr;
  for (const [id, sp] of Object.entries(safeObj)) {
    if (!sp) continue;
    const pos = sp.Position ?? sp.position ?? 0;
    arr.push({ id: String(id), posLocal: Number(pos) || 0 });
  }
  return arr;
}

function normalizeItems(itemsObj) {
  // itemsObj can be:
  //  - [{ item: "map", position: 1200, id?: "instance" }, ...]
  //  - { "map": { Position: 1200, id?: "instance" }, ... }
  // Return array of { itemId, posLocal, qty, instanceId }
  const arr = [];
  if (!itemsObj) return arr;

  const pushItem = (itemIdRaw, entry) => {
    const itemId = String(itemIdRaw || '').trim();
    if (!itemId) return;
    const pos = entry?.Position ?? entry?.position ?? entry?.pos ?? 0;
    const qtyRaw = entry?.qty ?? entry?.quantity ?? entry?.count ?? 1;
    const qty = Math.max(1, Math.floor(Number(qtyRaw || 1)));
    const instanceIdRaw = entry?.instanceId ?? entry?.id ?? null;
    const instanceId = (instanceIdRaw != null && instanceIdRaw !== '')
      ? String(instanceIdRaw)
      : null;
    arr.push({
      itemId,
      posLocal: Number(pos) || 0,
      qty,
      instanceId
    });
  };

  if (Array.isArray(itemsObj)) {
    for (const it of itemsObj) {
      if (!it) continue;
      if (typeof it === 'string') {
        pushItem(it, {});
        continue;
      }
      if (typeof it === 'object') {
        let itemId = it.item ?? it.itemId ?? it.name ?? it.itemName ?? null;
        let instanceId = it.instanceId ?? it.inst ?? it.instance ?? null;
        if (!itemId && it.id) {
          itemId = it.id;
        } else if (itemId && it.id != null && instanceId == null) {
          instanceId = it.id;
        }
        pushItem(itemId, { ...it, instanceId });
      }
    }
    return arr;
  }

  if (typeof itemsObj === 'object') {
    for (const [itemId, entry] of Object.entries(itemsObj)) {
      pushItem(itemId, entry);
    }
  }

  return arr;
}

function worldItemInstanceId(areaName, sectionIndex, itemId, instanceId, idx) {
  const a = lc(areaName || '');
  const s = String(sectionIndex ?? '');
  const id = lc(itemId || '');
  const inst = (instanceId != null && instanceId !== '') ? String(instanceId) : String(idx);
  if (!a || !id) return '';
  return `${a}:${s}:${id}:${inst}`;
}

function worldItemPickedFlagKey(instanceKey) {
  const k = String(instanceKey || '').trim();
  return k ? `worldItemPicked:${k}` : '';
}

function asArrayMaybe(objOrArray) {
  if (!objOrArray) return [];
  if (Array.isArray(objOrArray)) return objOrArray;
  // Allow {name, position} single object
  return [objOrArray];
}

function resetSceneryForArea(areaLengthPx) {
  trees.length = 0;
  bushes.length = 0;
  rocks.length = 0;
  // Simple: sprinkle per 2 sections
  const count = Math.max(4, Math.floor(areaLengthPx / 300));
  for (let i = 0; i < count; i++) {
    const x = Math.random() * areaLengthPx;
    trees.push({ worldX: x, trunkH: 20 + Math.random() * 20, trunkW: 4 + Math.random() * 2, leavesH: 14 + Math.random() * 8, leavesW: 20 + Math.random() * 16 });
    bushes.push({ worldX: Math.max(0, x - 40 + Math.random() * 80), w: 16 + Math.random() * 12, h: 8 + Math.random() * 4 });
    rocks.push({ worldX: Math.max(0, x - 40 + Math.random() * 80), size: 6 + Math.random() * 6 });
  }
}

function spawnNpcFromSectionDef(name, atX, c, rec, sectionStartX) {
  // Initialize registry first
  rec.area = currentAreaName;
  rec.worldX = Number.isFinite(atX) ? atX : rec.worldX;

  // Auto-cast override from areas.json (max one)
  if (c && Object.prototype.hasOwnProperty.call(c, 'autoCastRules')) {
    const raw = c.autoCastRules;
    if (raw === 'default' || raw === 'disabled') {
      rec.autoCastRulesMode = String(raw).toLowerCase();
    } else if (Array.isArray(raw)) {
      rec.aiAutoCastRules = raw;
      rec.autoCastRulesMode = 'custom';
    } else if (raw && typeof raw === 'object') {
      const mode = String(raw.mode || raw.state || 'custom').toLowerCase();
      if (mode === 'default' || mode === 'disabled') {
        rec.autoCastRulesMode = mode;
      } else {
        if (Array.isArray(raw.rules)) rec.aiAutoCastRules = raw.rules;
        rec.autoCastRulesMode = 'custom';
      }
    }
  } else if (c && Object.prototype.hasOwnProperty.call(c, 'autoCastAbility')) {
    const raw = c.autoCastAbility;
    if (raw === null || raw === false || (typeof raw === 'string' && lc(raw) === 'none')) {
      rec.autoCastAbilityId = null;
    } else if (typeof raw === 'string') {
      rec.autoCastAbilityId = lc(raw);
    }
  }

  // ===== Spawn AI mode (areas.json) =====
  const modeRaw = (c.ai && c.ai.mode) ? c.ai.mode : (c.mode ?? c.aiMode ?? 'stationary');
  const mode = lc(modeRaw);

  if (mode === 'waiting') {
    rec.aiMode = 'waiting';
    rec.aiAnchorX = (rec.aiAnchorX !== undefined && rec.aiAnchorX !== null) ? rec.aiAnchorX : rec.worldX;
  } else if (mode === 'moving') {
    let goalX = null;
    if (c.ai && (c.ai.goalWorldX !== undefined && c.ai.goalWorldX !== null)) {
      goalX = Number(c.ai.goalWorldX);
    } else if (c.goalWorldX !== undefined && c.goalWorldX !== null) {
      goalX = Number(c.goalWorldX);
    } else if (c.ai && (c.ai.goalPosition !== undefined && c.ai.goalPosition !== null)) {
      goalX = sectionStartX + Number(c.ai.goalPosition);
    } else if (c.goalPosition !== undefined && c.goalPosition !== null) {
      goalX = sectionStartX + Number(c.goalPosition);
    }

    if (isFinite(goalX)) {
      rec.aiMode = 'moving';
      rec.aiGoalX = goalX;
    } else {
      rec.aiMode = 'stationary';
    }
  } else {
    rec.aiMode = 'stationary';
  }

  // Spawn after registry is ready
  spawnNpc(name, atX);
  const spawned = npcs.find(n => n.name === name);
  if (spawned) bindNpcPersistentFields(spawned, rec);
}


function spawnPredefinedNPCs(sectionIndex, sectionStartX, sectionDef, areaName) {
  const list = asArrayMaybe(sectionDef.characters);
  for (const c of list) {
    if (!c || !c.name) continue;
    const name = c.name;
    const rec = ensureNpcRecord(name);

    const spawnWhen = normalizeTriggerWhen(c.spawnWhen);
    const spawnIf = c.spawnIf;
    const despawnWhen = normalizeTriggerWhen(c.despawnWhen);
    const despawnIf = c.despawnIf;

    const hasSpawnWhen = !!(spawnWhen && spawnWhen.length);
    const hasDespawnWhen = !!(despawnWhen && despawnWhen.length);
    const hasSpawnIf = !!spawnIf;
    const hasDespawnIf = !!despawnIf;
    const hasAnyConditional = hasSpawnWhen || hasDespawnWhen || hasSpawnIf || hasDespawnIf;

    // If NPC is in party, never spawn in world
    if (rec.inParty) continue;

    // If NPC has a saved location in another area, don't spawn here
    if (rec.area && rec.area !== areaName) continue;

    // No record yet — adopt the predefined position
    const posLocal = Number(c.position || 0);
    const defaultAtX = sectionStartX + posLocal;
    const atX = (rec.area === areaName && typeof rec.worldX === 'number') ? rec.worldX : defaultAtX;
    if (!rec.area) rec.area = areaName;
    if (!isFinite(rec.worldX)) rec.worldX = defaultAtX;

    if (hasAnyConditional) {
      pendingSpawns.push({
        kind: 'npc',
        name,
        atX,
        c,
        rec,
        sectionStartX,
        spawnWhen,
        spawnIf,
        despawnWhen,
        despawnIf
      });

      // If there is no spawn trigger/state, spawn immediately but keep the spec for despawn.
      if (!hasSpawnWhen && !hasSpawnIf) {
        spawnNpcFromSectionDef(name, atX, c, rec, sectionStartX);
      }

      continue;
    }

    // If NPC already fixed to this area, spawn at saved worldX
    if (rec.area === areaName && typeof rec.worldX === 'number') {
      spawnNpc(name, rec.worldX);
      continue;
    }

    spawnNpcFromSectionDef(name, atX, c, rec, sectionStartX);

  }
}

function isMobInWorldById(mobId) {
  const id = lc(mobId);
  if (!id) return false;
  return mobs.some(m => lc(m?.id) === id);
}

function buildActorRuntimeBase(opts = {}) {
  const worldX = Number(opts.worldX) || 0;
  const y = Number(opts.y) || 0;
  const w = Number(opts.w) || 0;
  const h = Number(opts.h) || 0;
  const onGround = (opts.onGround !== undefined) ? !!opts.onGround : true;
  const facing = (opts.facing === -1 || opts.facing === 1) ? opts.facing : 1;

  const innateAbilities = Array.isArray(opts.innateAbilities) ? opts.innateAbilities : [];
  const learnedAbilities = Array.isArray(opts.learnedAbilities) ? opts.learnedAbilities : [];

  return {
    worldX,
    y,
    w,
    h,

    // motion state
    vx: 0,
    vy: 0,
    onGround,
    facing,

    // animation bookkeeping
    animFrame: 0,
    animTimer: 0,
    lastMoveTime: getGameNowMs(),
    hasEverMoved: false,

    // shared stats
    stats: opts.stats,

    // abilities
    innateAbilities,
    learnedAbilities,
    heldAbilities: [],
    abilities: [],
    autoCastAbilityId: opts.autoCastAbilityId || null,

    // factions / relations
    factions: Array.isArray(opts.factions) ? opts.factions.slice() : [],
    allianceByFaction: (opts.allianceByFaction && typeof opts.allianceByFaction === 'object')
      ? { ...opts.allianceByFaction }
      : undefined,
    allianceByInstance: (opts.allianceByInstance && typeof opts.allianceByInstance === 'object')
      ? { ...opts.allianceByInstance }
      : undefined,

    // Attack targeting (queue + current)
    attackTargetQueue: [],
    attackTargetCurrentKey: null,
    __attackQueueDirty: false,
    __attackResortAtMs: 0,
    __attackTargetActor: null,
    __attackStopRangePx: null,
    __attackPreferredAbilityId: null,

    // Movement targeting (queue + current)
    moveTargetQueue: [],
    moveTargetCurrentKey: null,
    __moveQueueDirty: false,
    __moveResortAtMs: 0,
    __moveTargetActor: null,
    __moveStopRangePx: null,

    abilityNextAtMs: Object.create(null)
  };
}

function createMob(mobId, worldX, opts = {}) {
  const id = lc(mobId);
  const def = mobDetails?.[id] || null;

  // Body sizing (v1: treat body.w/h as the actual on-screen/world size in px)
  const bw = Number(def?.body?.w);
  const bh = Number(def?.body?.h);

  const w = (isFinite(bw) && bw > 0) ? bw : Math.max(10, Math.floor(player.w * 0.25));
  const h = (isFinite(bh) && bh > 0) ? bh : Math.max(10, Math.floor(player.h * 0.25));

  const locomotionMode = lc(def?.locomotion?.mode || 'ground');
  const yGround = groundY - h - 8;

  let y0 = yGround;
  if (locomotionMode === 'hover') y0 = yGround - 18;
  else if (locomotionMode === 'fly') y0 = yGround - 60;
  else if (locomotionMode === 'burrow') y0 = yGround + Math.floor(h * 0.65);


  const forcedInst = (opts && opts.instanceId != null) ? String(opts.instanceId) : '';
  const instanceId = forcedInst.trim() ? forcedInst.trim() : `${id}:${++mobSpawnCounter}`;

  // ===== mob stats (v2) =====
  const hp0 = Math.max(1, Number(def?.stats?.hp ?? 1) || 1);
  const end0 = Math.max(0, Number(def?.stats?.endurance ?? 0) || 0);
  const fort0 = Math.max(0, Number(def?.stats?.fortitude ?? 0) || 0);

  const innateAbilities = resolveAbilityList(def?.abilities);
  let autoCastAbilityId = null;

  const stats = createStatsForKind('mob');
  if (stats.hp) {
    stats.hp.max = hp0;
    stats.hp.current = hp0;
  }
  if (stats.endurance) stats.endurance.base = end0;
  if (stats.fortitude) stats.fortitude.base = fort0;

  const base = buildActorRuntimeBase({
    worldX,
    y: y0,
    w,
    h,
    onGround: (locomotionMode !== 'hover' && locomotionMode !== 'fly'),
    stats,
    innateAbilities,
    learnedAbilities: [],
    autoCastAbilityId,
    factions: def?.factions,
    allianceByFaction: def?.allianceByFaction,
    allianceByInstance: def?.allianceByInstance
  });

  const mob = {
    // identity
    id,                 // archetype id (from mobs.json key)
    instanceId,         // unique per-spawn instance key
    name: id,           // keep “name” as archetype id (rules use mob.id, not instance)
    displayName: def?.name || id,
    tags: Array.isArray(def?.tags) ? def.tags.slice() : [],

    // locomotion + ai mode
    locomotionMode,     // 'ground' | 'hover' | 'fly' | 'burrow' (behavior added later)
    aiMode: 'stationary',
    aiAnchorX: null,
    aiGoalX: null,
    aiGoalRef: null,
    aiAtGoal: false,
    aiPhase: 'idle',
    aiNextDecisionAtMs: null,
    aiMoveTargetX: null,

    // ===== Targeting / anchor runtime (v1) =====
    // Anchor can be a fixed worldX (default: spawn), or a goalRef-like object (actor/object/section position).
    anchor: { type: 'worldX', x: Number(worldX) },

    // runtime overrides applied by rules (actorParam/setActorParam)
    paramOverrides: Object.create(null),

    // contact/ability runtime
    contactNextTickAtMs: 0,

    // keep definition reference for later steps (hitboxes/abilities/drops)
    def

  };
  Object.assign(mob, base);

  // Mobs don't carry items yet, but keep ability composition consistent.
  rebuildActorAbilities(mob);
  return mob;
}

function spawnMob(mobId, atX, opts = {}) {
  const id = lc(mobId);
  if (!id) return null;
  if (!mobDetails?.[id]) {
    console.warn('[mobs] spawnMob: unknown id', mobId);
    return null;
  }
  //if (isMobInWorldById(id)) return;

  // Prevent duplicates when restoring + when a spawnIf-only pending spawn fires on re-entry
  const wantInst = (opts && opts.instanceId != null) ? String(opts.instanceId) : null;
  if (wantInst && mobs.some(m => m && String(m.instanceId) === wantInst)) return null;

  const def = mobDetails?.[id] || null;
  const instKey = wantInst || `${id}:${mobSpawnCounter + 1}`;
  const rec = ensureMobRecord(instKey, id);
  if (rec) {
    initMobRegistryFromDefs(rec, id, currentAreaName, atX, def);
  }

  const mob = createMob(id, atX, { instanceId: wantInst });
  if (mob) {
    const boundRec = ensureMobRecord(mob.instanceId, mob.id);
    if (boundRec) bindMobPersistentFields(mob, boundRec);
  }

  // Add to list before AI mode emits movement events to avoid re-entrant spawn loops.
  mobs.push(mob);


  // initial AI mode from section spawn (same idea as NPC “mode” in areas.json)
  const mode = lc(opts.mode || 'stationary');
  if (mode === 'waiting' || mode === 'moving' || mode === 'stationary') {
    setNpcAiMode(mob, mode, {}); // reusing existing mode setter (fields align)
  } else {
    setNpcAiMode(mob, 'stationary', {});
  }

  // play spawn anim briefly (skip when restoring)
  if (!opts.noSpawnAnim) setActorTempAnim(mob, 'spawn', 520);
  return mob;
}


function spawnPredefinedMobs(sectionIndex, sectionStartX, sectionName, sectionDef, areaName, spawnedInstanceIds) {
  const list = asArrayMaybe(sectionDef.mobs);

  for (let mi = 0; mi < list.length; mi++) {
    const m = list[mi];
    if (!m) continue;

    const mobId = lc(m.id || m.mob || m.name || '');
    if (!mobId) continue;

    const posLocal = Number(m.position || 0);
    const atX = sectionStartX + posLocal;

    // Deterministic instance id for placed mobs (so registry restoration can match them)
    // If the area json explicitly provides one, prefer it.
    const explicitInst = (m.instanceId != null) ? String(m.instanceId).trim() : '';
    const instanceId = explicitInst ? explicitInst : `pre:${areaName}:${sectionName}:${mobId}:${mi}`;

    // If we already restored this instance from registry, do not spawn again
    if (spawnedInstanceIds && spawnedInstanceIds.has(instanceId)) continue;

    const def = mobDetails?.[mobId] || null;
    const rec = ensureMobRecord(instanceId, mobId);
    if (rec) initMobRegistryFromDefs(rec, mobId, areaName, atX, def);

    if (m && Object.prototype.hasOwnProperty.call(m, 'autoCastRules') && rec) {
      const raw = m.autoCastRules;
      if (raw === 'default' || raw === 'disabled') {
        rec.autoCastRulesMode = String(raw).toLowerCase();
      } else if (Array.isArray(raw)) {
        rec.aiAutoCastRules = raw;
        rec.autoCastRulesMode = 'custom';
      } else if (raw && typeof raw === 'object') {
        const mode = String(raw.mode || raw.state || 'custom').toLowerCase();
        if (mode === 'default' || mode === 'disabled') {
          rec.autoCastRulesMode = mode;
        } else {
          if (Array.isArray(raw.rules)) rec.aiAutoCastRules = raw.rules;
          rec.autoCastRulesMode = 'custom';
        }
      }
    }

    const spawnWhen = normalizeTriggerWhen(m.spawnWhen);
    const spawnIf = m.spawnIf;
    const despawnWhen = normalizeTriggerWhen(m.despawnWhen);
    const despawnIf = m.despawnIf;

    const hasSpawnWhen = !!(spawnWhen && spawnWhen.length);
    const hasDespawnWhen = !!(despawnWhen && despawnWhen.length);
    const hasSpawnIf = !!spawnIf;
    const hasDespawnIf = !!despawnIf;
    const hasAnyConditional = hasSpawnWhen || hasDespawnWhen || hasSpawnIf || hasDespawnIf;

    if (hasAnyConditional) {
      pendingSpawns.push({
        kind: 'mob',
        mobId,
        atX,
        mode: m.mode,
        spawnWhen,
        spawnIf,
        despawnWhen,
        despawnIf,
        instanceId
      });

      // If there is no spawn trigger/state, spawn immediately but keep the spec for despawn.
      if (!hasSpawnWhen && !hasSpawnIf) {
        spawnMob(mobId, atX, { mode: m.mode, instanceId });
      }

      continue;
    }

    spawnMob(mobId, atX, { mode: m.mode, instanceId });
  }
}


function populateMobsForCurrentArea() {
  mobs.length = 0;

  const spawnedInstanceIds = new Set();

  // 1) Restore all mobs whose registry says they live in this area
  //    (includes spawnWhen/spawnIf mobs that were previously spawned)
  for (const [inst, rec] of Object.entries(mobRegistry || {})) {
    if (!rec || rec.area !== currentAreaName) continue;

    // If you track "alive"/"defeated" in the registry, respect it
    if (rec.alive === false || rec.defeated === true) continue;

    const def = mobDetails?.[lc(rec.mobId || rec.id || '')] || null;
    if (def) initMobRegistryFromDefs(rec, rec.mobId || rec.id || null, currentAreaName, rec.worldX, def);
    const x = (typeof rec.worldX === 'number') ? rec.worldX : 0;

    // Restore with the same instanceId and no spawn animation
    spawnMob(rec.mobId || rec.id, x, {
      mode: rec.aiMode || 'stationary',
      instanceId: inst,
      noSpawnAnim: true
    });

    const mob = mobs.find(m => m && String(m.instanceId) === String(inst));
    if (mob) {
      // Restore core runtime fields (only if present)
      if (typeof rec.y === 'number') mob.y = rec.y;
      if (typeof rec.vx === 'number') mob.vx = rec.vx;
      if (typeof rec.vy === 'number') mob.vy = rec.vy;
      if (typeof rec.facing === 'number') mob.facing = rec.facing;
      if (typeof rec.onGround === 'boolean') mob.onGround = rec.onGround;

      if (rec.anchor && typeof rec.anchor === 'object') mob.anchor = rec.anchor;

      if (Array.isArray(rec.attackTargetQueue)) mob.attackTargetQueue = rec.attackTargetQueue;
      if (rec.attackTargetCurrentKey != null) mob.attackTargetCurrentKey = rec.attackTargetCurrentKey;
      if (Array.isArray(rec.moveTargetQueue)) mob.moveTargetQueue = rec.moveTargetQueue;
      if (rec.moveTargetCurrentKey != null) mob.moveTargetCurrentKey = rec.moveTargetCurrentKey;

      if (rec.paramOverrides && typeof rec.paramOverrides === 'object') {
        mob.paramOverrides = rec.paramOverrides;
      }
      if (Array.isArray(rec.tags)) mob.tags = rec.tags;

      if (rec.stats && typeof rec.stats === 'object') {
        mob.stats = rec.stats;
      }

      // AI internals (if you stored them)
      if (rec.aiGoalRef != null) mob.aiGoalRef = rec.aiGoalRef;
      if (rec.aiAnchorX != null) mob.aiAnchorX = rec.aiAnchorX;
      if (rec.aiGoalX != null) mob.aiGoalX = rec.aiGoalX;
      if (rec.aiAtGoal != null) mob.aiAtGoal = rec.aiAtGoal;
      if (rec.aiPhase != null) mob.aiPhase = rec.aiPhase;
      if (rec.aiNextDecisionAtMs != null) mob.aiNextDecisionAtMs = rec.aiNextDecisionAtMs;
      if (rec.aiMoveTargetX != null) mob.aiMoveTargetX = rec.aiMoveTargetX;

      // Force a re-resolve of current target actor on next tick
      mob.__attackQueueDirty = true;
      mob.__attackTargetActor = null;
      mob.__attackResortAtMs = 0;

      mob.__moveQueueDirty = true;
      mob.__moveTargetActor = null;
      mob.__moveResortAtMs = 0;

      bindMobPersistentFields(mob, rec);

    }

    spawnedInstanceIds.add(String(inst));
  }

  // 2) Spawn any placed mobs that do not yet exist in registry for this area
  const definedSections = currentArea.raw.sections || {};
  for (let i = 0; i < currentArea.sections.length; i++) {
    const section = currentArea.sections[i];
    if (!section.name) continue;

    const secDefRaw = definedSections[section.name] || {};
    const startX = i * currentArea.sectionTileWidth;

    spawnPredefinedMobs(i, startX, section.name, secDefRaw, currentAreaName, spawnedInstanceIds);
  }

  currentArea.mobs = [...mobs];
}



// After changing areas, rebuild world NPCs from registry first, then fill any new ones defined
function populateNPCsForCurrentArea() {
  npcs.length = 0;

  // 1) Spawn all NPCs whose registry says they live in this area (and not in party)
for (const [name, rec] of Object.entries(npcRegistry)) {
  if (!rec.inParty && rec.area === currentAreaName && typeof rec.worldX === 'number') {
    spawnNpc(name, Math.max(2, Math.min(currentArea.lengthPx - player.w - 2, rec.worldX)));
    const spawned = npcs.find(n => n.name === name);
    if (spawned) bindNpcPersistentFields(spawned, rec);
  }
}

  // 2) Ensure predefined section NPCs are registered/spawned if they had no record yet
  const definedSections = currentArea.raw.sections || {};
  for (let i = 0; i < currentArea.sections.length; i++) {
    const section = currentArea.sections[i];
    if (!section.name) continue;
    const secDefRaw = definedSections[section.name] || {};
    const startX = i * currentArea.sectionTileWidth;
    spawnPredefinedNPCs(i, startX, secDefRaw, currentAreaName);
  }
  currentArea.npcs = [...npcs];
}

function normalizeSpawnIfArray(spawnIf, implicitNpcName) {
  if (!spawnIf) return null;
  const arr = Array.isArray(spawnIf) ? spawnIf : [spawnIf];

  if (!implicitNpcName) return arr;

  return arr.map(s => {
    if (!s || typeof s !== 'object') return s;
    const t = lc(s.type || '');
    if ((t === 'npcinsection' || t === 'npcinarea') && !s.npc) {
      return { ...s, npc: implicitNpcName };
    }
    return s;
  });
}

function isSpawnIfSatisfied(spawnIf, implicitNpcName, payload) {
  const stateArr = normalizeSpawnIfArray(spawnIf, implicitNpcName);
  if (!stateArr) return true;
  return evaluateRuleState({ state: stateArr }, payload);
}

function wouldObjectSpawnOnAreaLoad(obj, payload = null) {
  if (!obj) return false;
  const hasSpawnWhen = !!obj.spawnWhen;
  const hasSpawnIf = !!obj.spawnIf;
  const hasDespawnIf = !!obj.despawnIf;

  // spawnWhen-only objects should NOT exist on initial area load.
  if (hasSpawnWhen && !hasSpawnIf && !hasDespawnIf) return false;

  const spawnIfOk = hasSpawnIf ? isSpawnIfSatisfied(obj.spawnIf, null, payload || {}) : true;
  const despawnIfOk = hasDespawnIf ? isSpawnIfSatisfied(obj.despawnIf, null, payload || {}) : false;
  return (spawnIfOk && !despawnIfOk);
}

function initConditionalSpawnsForCurrentArea() {
  if (!currentArea) return;

  // 1) Initialize placed objects (in-area arrays) that have spawnWhen/spawnIf
  const objectBuckets = [
    currentArea.backObjects,
    currentArea.foreObjects,
    currentArea.groundBackObjects,
    currentArea.groundForeObjects
  ];

  for (const list of objectBuckets) {
    if (!Array.isArray(list)) continue;

    for (const obj of list) {
      if (!obj) continue;

      const hasSpawnWhen = !!obj.spawnWhen;
      const hasSpawnIf = !!obj.spawnIf;
      const hasDespawnWhen = !!obj.despawnWhen;
      const hasDespawnIf = !!obj.despawnIf;

      if (!hasSpawnWhen && !hasSpawnIf && !hasDespawnWhen && !hasDespawnIf) continue;

      obj._spawned = wouldObjectSpawnOnAreaLoad(obj, {});

      const whenArr = normalizeTriggerWhen(obj.spawnWhen);
      const despawnWhenArr = normalizeTriggerWhen(obj.despawnWhen);

      pendingSpawns.push({
        kind: 'object',
        obj,
        spawnWhen: whenArr,
        spawnIf: obj.spawnIf,
        despawnWhen: despawnWhenArr,
        despawnIf: obj.despawnIf
      });
    }
  }

  // 2) Immediately apply any spawnIf/despawnIf conditions that are already satisfied
  processPendingSpawns(null, {}, { allowIfOnly: true });
}

function processPendingSpawns(eventName, payload, opts = null) {
  if (!pendingSpawns || pendingSpawns.length === 0) return;

  const allowIfOnly = !!(opts && opts.allowIfOnly);
  const hasEvent = !!eventName;

  for (let i = pendingSpawns.length - 1; i >= 0; i--) {
    const spec = pendingSpawns[i];
    if (!spec) { pendingSpawns.splice(i, 1); continue; }

    const spawnWhenArr = Array.isArray(spec.spawnWhen) ? spec.spawnWhen : [];
    const despawnWhenArr = Array.isArray(spec.despawnWhen) ? spec.despawnWhen : [];

    let spawnWhenMatched = false;
    if (spawnWhenArr.length) {
      if (!hasEvent) {
        spawnWhenMatched = false;
      } else {
        for (const w of spawnWhenArr) {
          if (triggerMatches(w, eventName, payload || {})) { spawnWhenMatched = true; break; }
        }
      }
    }

    let despawnWhenMatched = false;
    if (despawnWhenArr.length) {
      if (!hasEvent) {
        despawnWhenMatched = false;
      } else {
        for (const w of despawnWhenArr) {
          if (triggerMatches(w, eventName, payload || {})) { despawnWhenMatched = true; break; }
        }
      }
    }

    const hasSpawnIf = (spec.spawnIf != null);
    const hasDespawnIf = (spec.despawnIf != null);
    const hasAnyIf = hasSpawnIf || hasDespawnIf;

    // If we only want event-driven evaluation, skip if there is no event and we don't need IF checks.
    if (!hasEvent && !allowIfOnly) continue;
    if (!hasEvent && !hasAnyIf) continue;

    const spawnIfOk = hasSpawnIf ? isSpawnIfSatisfied(spec.spawnIf, spec.name || null, payload || {}) : true;
    const despawnIfOk = hasDespawnIf ? isSpawnIfSatisfied(spec.despawnIf, spec.name || null, payload || {}) : false;
    const wantsExistNow = (!hasSpawnIf || spawnIfOk) && (!hasDespawnIf || !despawnIfOk);


    if (spec._blocked && (despawnWhenMatched || (hasDespawnIf && despawnIfOk))) {
      spec._blocked = false;
    }

    if (spec.kind === 'object') {
      const obj = spec.obj;
      if (!obj) { pendingSpawns.splice(i, 1); continue; }

      const isSpawned = (obj._spawned !== false);
      const shouldDespawn = despawnWhenMatched || (hasDespawnIf && despawnIfOk);
      const shouldSpawn =
        !isSpawned &&
        !spec._blocked &&
        (
          (spawnWhenArr.length ? (spawnWhenMatched && (!hasSpawnIf || spawnIfOk) && (!hasDespawnIf || !despawnIfOk)) : false) ||
          (!spawnWhenArr.length && hasAnyIf && wantsExistNow)
        );

      if (isSpawned && shouldDespawn) {
        obj._spawned = false;
      } else if (!isSpawned && shouldSpawn) {
        obj._spawned = true;
      }

      // Keep specs only if they have any conditional behavior
      if (!spawnWhenArr.length && !despawnWhenArr.length && !hasAnyIf) {
        pendingSpawns.splice(i, 1);
      }
      continue;
    }

    if (spec.kind === 'mob') {
      const wantInst = String(spec.instanceId || '');
      const liveMob = wantInst ? mobs.find(m => m && String(m.instanceId) === wantInst) : null;
      const isSpawned = !!liveMob;

      const shouldDespawn = isSpawned && (despawnWhenMatched || (hasDespawnIf && despawnIfOk));
      const shouldSpawn =
        !isSpawned &&
        !spec._blocked &&
        (
          (spawnWhenArr.length ? (spawnWhenMatched && (!hasSpawnIf || spawnIfOk) && (!hasDespawnIf || !despawnIfOk)) : false) ||
          (!spawnWhenArr.length && hasAnyIf && wantsExistNow)
        );

      if (shouldDespawn && liveMob) {
        despawnMobInstance(liveMob);
        currentArea.mobs = [...mobs];
      } else if (shouldSpawn) {
        const mob = spawnMob(spec.mobId, spec.atX, { mode: spec.mode, instanceId: spec.instanceId });
        if (mob) mob.__spawnSpec = spec;
        currentArea.mobs = [...mobs];
      }

      // Keep specs only if they have any conditional behavior
      if (!spawnWhenArr.length && !despawnWhenArr.length && !hasAnyIf) {
        pendingSpawns.splice(i, 1);
      }
      continue;
    }

    if (spec.kind === 'npc') {
      const nameLc = lc(spec.name || '');
      const inParty = party.some(p => p && lc(p.name) === nameLc);
      if (inParty) continue;

      const liveNpc = npcs.find(n => n && lc(n.name) === nameLc) || null;
      const isSpawned = !!liveNpc;

      const shouldDespawn = isSpawned && (despawnWhenMatched || (hasDespawnIf && despawnIfOk));
      const shouldSpawn =
        !isSpawned &&
        !spec._blocked &&
        (
          (spawnWhenArr.length ? (spawnWhenMatched && (!hasSpawnIf || spawnIfOk) && (!hasDespawnIf || !despawnIfOk)) : false) ||
          (!spawnWhenArr.length && hasAnyIf && wantsExistNow)
        );

      if (shouldDespawn && liveNpc) {
        despawnNpcInstance(liveNpc);
        currentArea.npcs = [...npcs];
      } else if (shouldSpawn) {
        spawnNpcFromSectionDef(spec.name, spec.atX, spec.c, spec.rec, spec.sectionStartX);
        currentArea.npcs = [...npcs];
      }

      // Keep specs only if they have any conditional behavior
      if (!spawnWhenArr.length && !despawnWhenArr.length && !hasAnyIf) {
        pendingSpawns.splice(i, 1);
      }
      continue;
    }
  }
}


function warmAreaAssets(areaName) {
  if (!areasData || !areaName) return;

  // Build (or fetch cached) area
  const area = buildAreaFromDefinition(areaName);
  if (!area) return;

  // --- Sky ---
  if (area.skyEntry) {
    // access triggers load
    void area.skyEntry.ready;
  }

  // --- Ground tiles ---
  for (const entry of area.groundEntries || []) {
    if (entry) void entry.ready;
  }

  // --- Backgrounds ---
  const warmTileList = (list) => {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i] === 'string') {
        list[i] = loadTileImage(list[i]);
      }
    }
  };

  warmTileList(area.distantEntries);
  warmTileList(area.backgroundEntries);

  // --- Objects ---
  const warmObjects = (list) => {
    if (!list) return;
    for (const obj of list) {
      if (obj && obj.key && !obj.entry) {
        const base = objectBaseFromKey(obj.key);
        const def = base ? getObjectDef(base) : null;
        const hasObstacle = !!(def && (def.blocker || def.gate));

        if (hasObstacle && base) {
          const suffixes = ['', '_closed', '_open', '_opening', '_closing'];
          for (const sfx of suffixes) {
            loadObjectImage(`${base}${sfx}`);
          }
          obj.entry = loadObjectImage(base);
        } else {
          obj.entry = loadObjectImage(obj.key);
        }
      }
    }
  };

  warmObjects(area.backObjects);
  warmObjects(area.foreObjects);
    // ground-locked overlays/objects (move with ground)
  warmObjects(area.groundBackObjects);
  warmObjects(area.groundForeObjects);

  // --- World items (icons) ---
  if (Array.isArray(area.worldItems)) {
    for (const it of area.worldItems) {
      if (!it || !it.itemId) continue;
      const def = getItemDef(it.itemId);
      __getItemIcon(it.itemId, def);
    }
  }
}

function warmAreaActorAssets(areaName) {
  if (!areasData || !areaName) return;

  const def = areasData[areaName];
  if (!def) return;

  const sections = def.sections || {};

  const npcNames = new Set();
  const mobIds = new Set();

  // Collect NPCs and mobs explicitly mentioned in sections
  for (const sdef of Object.values(sections)) {
    if (!sdef) continue;

    const ch = sdef.characters;
    if (Array.isArray(ch)) {
      for (const c of ch) {
        const nm = String((c && (c.name || c.npc || c.id)) || '').trim();
        if (nm) npcNames.add(nm);
      }
    } else if (ch && typeof ch === 'object') {
      const nm = String(ch.name || ch.npc || ch.id || '').trim();
      if (nm) npcNames.add(nm);
    }

    const mobsArr = sdef.mobs;
    if (Array.isArray(mobsArr)) {
      for (const m of mobsArr) {
        const id = String((m && (m.id || m.name || m.mob)) || '').trim();
        if (id) mobIds.add(id);
      }
    }
  }

  // Also accept a few possible area-level spellings (harmless if absent)
  const areaChars = def.characters || def.npcs;
  if (Array.isArray(areaChars)) {
    for (const c of areaChars) {
      const nm = String((c && (c.name || c.npc || c.id)) || '').trim();
      if (nm) npcNames.add(nm);
    }
  } else if (areaChars && typeof areaChars === 'object') {
    const nm = String(areaChars.name || areaChars.npc || areaChars.id || '').trim();
    if (nm) npcNames.add(nm);
  }

  // Preload ALL NPC portraits (best-effort) + all animations
  const PORTRAIT_REACTIONS = [
    'neutral', 'happy', 'sad', 'worried', 'angry', 'surprised',
    'smile', 'serious', 'confused', 'thinking', 'shy'
  ];

  const DIRS = ['left', 'right', 'forward'];

  for (const npcNameRaw of npcNames) {
    const speakerName = lc(String(npcNameRaw || ''));

    for (const rx of PORTRAIT_REACTIONS) {
      const portraitPath = `assets/portraits/character_portrait_${speakerName}_${rx}.png`;
      const fallback = `assets/portraits/character_portrait_${speakerName}_neutral.png`;

      enqueueAssetWarm(`portrait:${speakerName}:${rx}`, () => {
        __getPortraitEntryBySrc(portraitPath);
        __getPortraitEntryBySrc(fallback);
      });
    }

    for (const t of NPC_ANIM_TYPES) {
      // Queue sprite requests (non-blocking); missing files are fine.
      if (t === 'wait') {
        enqueueAssetWarm(`npcSprite:${speakerName}:${t}`, () => getOrRequestNpcSprite(npcNameRaw, t, ''));
      } else {
        for (const d of DIRS) {
          enqueueAssetWarm(`npcSprite:${speakerName}:${t}:${d}`, () => getOrRequestNpcSprite(npcNameRaw, t, d));
        }
      }
    }
  }

  // Preload all mob animations
  for (const mobId of mobIds) {
    for (const t of MOB_ANIM_TYPES) {
      if (t === 'wait') {
        enqueueAssetWarm(`mobSprite:${mobId}:${t}`, () => getOrRequestMobSprite(mobId, t, ''));
      } else {
        for (const d of DIRS) {
          enqueueAssetWarm(`mobSprite:${mobId}:${t}:${d}`, () => getOrRequestMobSprite(mobId, t, d));
        }
      }
    }
  }

  // Preload object state images + animations for any placed objects (area build is already cached)
  const built = buildAreaFromDefinition(areaName);
  if (built) {
    const allObjLists = []
      .concat(built.backObjects || [])
      .concat(built.foreObjects || [])
      .concat(built.groundBackObjects || [])
      .concat(built.groundForeObjects || []);

    for (const o of allObjLists) {
      const base = lc(objectBaseFromKey(o?.key || o?.name || o?.filename));
      if (!base) continue;

      // base + state variants used by blockers/interactions
      const def = getObjectDef(base) || null;
      const hasBlockerOrGate = !!(def?.blocker || def?.gate);
      const hasInteract = !!(
        (Array.isArray(def?.interact) && def.interact.length) ||
        (Array.isArray(def?.interacts) && def.interacts.length) ||
        (Array.isArray(def?.interactTags) && def.interactTags.length)
      );

      const keys = [base];
      if (hasBlockerOrGate) {
        keys.push(
          `${base}_open`,
          `${base}_closed`,
          `${base}_opening`,
          `${base}_closing`
        );
      }
      if (hasInteract) {
        keys.push(`${base}_interact`);
      }

      for (const k of keys) {
        enqueueAssetWarm(`objImg:${k}`, () => loadObjectImage(k));
      }
    }
  }

  // Preload stat-change icons (used in dialog + above-head floaters)
  // Missing files are fine; they’ll mark failed and be skipped.
  const statKeysToWarm = ['affection', 'alignment', 'stamina', 'composure', 'endurance', 'fortitude'];
  for (const sk of statKeysToWarm) {
    enqueueAssetWarm(`statIcon:${sk}:up`, () => __getStatChangeIcon(sk, 'up'));
    enqueueAssetWarm(`statIcon:${sk}:down`, () => __getStatChangeIcon(sk, 'down'));
  }
}


function startBackgroundPreloadForArea(areaName) {
  // Existing warm (sky/tiles/backgrounds/objects base) stays as-is
  warmAreaAssets(areaName);

  // New warm: portraits + actor sprites + object state variants
  warmAreaActorAssets(areaName);
}



function buildAreaFromDefinition(areaName) {
  // NEW: return cached build if we already made this area (stable scenery & geometry)
  if (areaCache.has(areaName)) return areaCache.get(areaName);

  const def = areasData[areaName];
  if (!def) {
    console.warn(`Area "${areaName}" not found in areas.json`);
    return null;
  }

  const skyKey = def.sky || null;
  const distantList = parseList(def.distantbackrounds || def.distantbackgrounds); // accept both spellings
  const backgroundList = parseList(def.backgrounds);
  //const backObjList = parseList(def.backobjects);

  // Accept either an array of objects [{name, height}] or CSV/array of strings
  const backObjListRaw = def.backobjects || [];
  const foreObjListRaw = def.foreobjects || [];

  const defaultBackH = Math.floor(TILE_DRAW_HEIGHT() * 0.55);
  const defaultForeH = Math.floor(TILE_DRAW_HEIGHT() * 0.7); // fallback per-item height

  // Accept [{name,height,density}] OR ["name","name2"] OR "name,name2"
  function normalizeImageItems(arrOrCsv, defaultH) {
    if (Array.isArray(arrOrCsv)) {
      return arrOrCsv
        .map(it => {
          if (!it) return null;
          if (typeof it === 'string') return { name: it.trim(), height: defaultH };
          const spawnWhenRaw = it.spawnWhen ?? it.spawnwhen ?? null;
          const spawnIfRaw = it.spawnIf ?? it.spawnif ?? null;
          const despawnWhenRaw = it.despawnWhen ?? it.despawnwhen ?? null;
          const despawnIfRaw = it.despawnIf ?? it.despawnif ?? null;

          return {
            name: String(it.name || '').trim(),
            height: Number(it.height) || defaultH,
            density: (it.density != null && it.density !== '') ? Number(it.density) : undefined,
            position: (it.position != null && it.position !== '') ? Number(it.position) : undefined,

            // NEW: optional per-instance identity + gate starting state
            objectId: (it.id != null && it.id !== '') ? String(it.id) : ((it.instanceId != null && it.instanceId !== '') ? String(it.instanceId) : null),
            open: (it.open != null && it.open !== '') ? !!it.open : null,
            portal: (it.portal != null && it.portal !== '') ? it.portal : null,

            spawnWhen: spawnWhenRaw || null,
            spawnIf: spawnIfRaw || null,
            despawnWhen: despawnWhenRaw || null,
            despawnIf: despawnIfRaw || null,
            _spawned: !(spawnWhenRaw || spawnIfRaw)
          };

        })
        .filter(it => it && it.name);
    }
    // CSV fallback
    return parseList(arrOrCsv).map(name => ({ name, height: defaultH }));
  }


  const backObjList = normalizeImageItems(backObjListRaw, defaultBackH);
  const foreObjList = normalizeImageItems(foreObjListRaw, defaultForeH);

  // Section slots: 1..sectioncount
  const sectionCount = Math.max(1, Number(def.sectioncount || 1));
  const defaultGroundKey = def.defaultground || 'ground';

  // Pre-load default ground image for width reference
  const defaultGroundEntry = loadGroundTile(defaultGroundKey);

  // Collect pre-defined sections by (1-based) position
  const definedSections = def.sections || {};
  // Per-section effective lists = section override OR area default
  function getSectionLists(sectionName) {
    const sdef = (definedSections && definedSections[sectionName]) || {};

    const areaDistant = parseList(def.distantbackrounds || def.distantbackgrounds); // accept both spellings
    const areaBacks   = parseList(def.backgrounds);
    
    const defaultBackObjH = Math.floor(TILE_DRAW_HEIGHT() * 0.55);
    const defaultForeObjH = Math.floor(TILE_DRAW_HEIGHT() * 0.70);

    const areaBackObjs = normalizeImageItems(def.backobjects || [], defaultBackObjH);
    const areaForeObjs = normalizeImageItems(def.foreobjects || [], defaultForeObjH);

    // Nground-locked object layers (accept a few key spellings)
    const areaGroundBackObjs = normalizeImageItems(
      def.groundBackObjects || def.groundBackobjects || [],
      defaultForeObjH
    );

    const areaGroundForeObjs = normalizeImageItems(
      def.groundForeObjects || def.groundForeobjects || def.groundFrontObjects || def.groundFrontobjects || [],
      defaultForeObjH
    );


    const secDistant = parseList(sdef.distantbackrounds || sdef.distantbackgrounds);
    const secBacks   = parseList(sdef.backgrounds);

    const secBackObjs = normalizeImageItems(sdef.backobjects || [], defaultBackObjH);
    const secForeObjs = normalizeImageItems(sdef.foreobjects || [], defaultForeObjH);

    // section-level ground-locked object layers (accept a few key spellings)
    const secGroundBackObjs = normalizeImageItems(
      sdef.groundBackObjects || sdef.groundBackobjects || [],
      defaultForeObjH
    );

    const secGroundForeObjs = normalizeImageItems(
      sdef.groundForeObjects || sdef.groundForeobjects || sdef.groundFrontObjects || sdef.groundFrontobjects || [],
      defaultForeObjH
    );


    return {
      distantList: (secDistant.length ? secDistant : areaDistant),
      backgroundList: (secBacks.length ? secBacks : areaBacks),
      backObjList: (secBackObjs.length ? secBackObjs : areaBackObjs),
      foreObjList: (secForeObjs.length ? secForeObjs : areaForeObjs),

      // ground-locked layers (merged behavior preserved for density/no-density spawning)
      groundBackObjList: (secGroundBackObjs.length ? secGroundBackObjs : areaGroundBackObjs),
      groundForeObjList: (secGroundForeObjs.length ? secGroundForeObjs : areaGroundForeObjs),

      // NEW: expose raw lists so we can treat "position" differently by origin
      areaGroundBackObjList: areaGroundBackObjs,
      secGroundBackObjList: secGroundBackObjs,
      areaGroundForeObjList: areaGroundForeObjs,
      secGroundForeObjList: secGroundForeObjs
    };

  }


  const positioned = new Map();
  for (const [secName, secDef] of Object.entries(definedSections)) {
    const pos = Number(secDef.position || 0);
    const exits = normalizeExits(secDef.exits);
    const safePlaces = normalizeSafePlaces(secDef.safeplaces || secDef.safePlaces);
    const items = normalizeItems(secDef.items);

    positioned.set(secName, { name: secName, pos, groundKey: secDef.groundimage || defaultGroundKey, exits, safePlaces, items, raw: secDef });
  }

  // Prepare flat sections array (index 0..sectionCount-1)
  const sections = Array(sectionCount).fill(null).map(() => ({
    name: null,
    groundKey: defaultGroundKey,
    exits: [],
    safePlaces: [],
    items: [],
    timeOfDay: null
  }));



  // Place those with a fixed position (1-based)
  for (const sec of positioned.values()) {
    if (sec.pos > 0 && sec.pos <= sectionCount) {
      sections[sec.pos - 1] = {
        name: sec.name,
        groundKey: sec.groundKey || defaultGroundKey,
        exits: sec.exits || [],
        safePlaces: sec.safePlaces || [],
        items: sec.items || [],
        timeOfDay: (sec.raw && sec.raw.timeOfDay) ? sec.raw.timeOfDay : null
      };


    }
  }

  // Place any remaining named sections without a fixed pos (rare). Just fill from left.
  for (const sec of positioned.values()) {
    if (sec.pos && sec.pos > 0) continue;
    const idx = sections.findIndex(s => s.name === null && s.exits.length === 0 && s.groundKey === defaultGroundKey);
    if (idx >= 0) {
      sections[idx] = {
        name: sec.name,
        groundKey: sec.groundKey || defaultGroundKey,
        exits: sec.exits || [],
        safePlaces: sec.safePlaces || [],
        items: sec.items || [],
        timeOfDay: (sec.raw && sec.raw.timeOfDay) ? sec.raw.timeOfDay : null
      };


      }
    }

  // Calculate per-section tile widths (after images load we’ll compute)
  const groundEntries = sections.map(s => loadGroundTile(s.groundKey));

  // After images resolve, we know area pixel length
  let sectionTileWidth = getTileDrawWidth(defaultGroundEntry);
  // If some section has a defined width, prefer the first ready one
  for (const ge of groundEntries) {
    if (ge && ge.ready) { sectionTileWidth = getTileDrawWidth(ge); break; }
  }
  const areaLengthPx = sectionCount * sectionTileWidth;
  // Foreground parallax requires extended world span
  const foreParallax = PARALLAX.foreground;
  const forePadPx = Math.ceil((foreParallax - 1) * areaLengthPx);
  const foreSpawnMinX = -forePadPx;
  const foreSpawnMaxX = areaLengthPx + forePadPx;

  // --- Prevent random FOREGROUND objects from obscuring important ground/NPC spots ---
  const protectedViewSpots = []; // { worldX, widthPx }

  function addProtectedViewSpot(worldX, widthPx) {
    const x = Number(worldX);
    if (!Number.isFinite(x)) return;
    protectedViewSpots.push({
      worldX: x,
      widthPx: Math.max(8, Math.floor(Number(widthPx) || 0))
    });
  }

  function estimateObjectDrawWidthPx(key, heightPx, defaultHeightFactor = 0.70) {
    const entry = key ? loadObjectImage(key) : null;

    const targetH = Math.floor(
      (Number(heightPx) || (TILE_DRAW_HEIGHT() * defaultHeightFactor)) * SCALE.objects
    );

    let ratio = 1;
    if (entry && entry.ready && entry.h > 0) ratio = (entry.w / entry.h);

    return Math.max(8, Math.floor(targetH * ratio));
  }

  function resolvePlacedObjectHeightPx(obj, key, defaultHeightFactor = 0.70) {
    let base = null;
    if (obj && obj.height != null) {
      const pct = Number(obj.height);
      if (isFinite(pct)) {
        base = (HEIGHT / SCALE.objects) * (pct / 100);
      }
    }

    if (base == null) {
      const def = key ? getObjectDef(key) : null;
      const h = Number(def?.animFramePx?.h);
      if (isFinite(h)) base = h;
    }

    if (base == null) {
      const entry = key ? loadObjectImage(key) : null;
      if (entry && entry.ready && isFinite(entry.h)) base = Number(entry.h);
    }

    if (base == null) {
      base = TILE_DRAW_HEIGHT() * defaultHeightFactor;
    }
    return base;
  }

  function clampLocal(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function wouldForegroundOverlapProtectedAtSpot(candidateForeWorldX, candidateForeW, spot) {
    // Assume "player near the spot" => camera centered on the spot (clamped)
    const maxCam = Math.max(0, areaLengthPx - WIDTH);
    const camX0 = clampLocal(spot.worldX - (WIDTH * 0.5), 0, maxCam);

    const foreL = (candidateForeWorldX - (camX0 * PARALLAX.foreground));
    const foreR = foreL + candidateForeW;

    const spotL = (spot.worldX - camX0); // ground parallax == 1
    const spotR = spotL + (spot.widthPx || 0);

    const margin = 24;
    return (foreL < (spotR + margin)) && (foreR > (spotL - margin));
  }

  function pickForegroundWorldXAvoidingProtected(key, heightPx) {
    const w = estimateObjectDrawWidthPx(key, heightPx, 0.70);

    let x = foreSpawnMinX + Math.random() * (foreSpawnMaxX - foreSpawnMinX);

    // Retry a few times to avoid overlaps near protected spots
    for (let tries = 0; tries < 40; tries++) {
      let ok = true;
      for (let i = 0; i < protectedViewSpots.length; i++) {
        if (wouldForegroundOverlapProtectedAtSpot(x, w, protectedViewSpots[i])) {
          ok = false;
          break;
        }
      }
      if (ok) return x;
      x = foreSpawnMinX + Math.random() * (foreSpawnMaxX - foreSpawnMinX);
    }

    // Fallback: accept last (rare)
    return x;
  }


  // NEW: pre-load sky
  const skyEntry = skyKey ? loadTileImage(skyKey) : null;

  // Choose per-section images (section override > area default)
  const distantEntries = Array(sectionCount).fill(null).map((_, i) => {
    const sname = sections[i].name;
    const { distantList } = getSectionLists(sname);
    if (!distantList || distantList.length === 0) return null;
    const pick = distantList[Math.floor(Math.random() * distantList.length)];
    return pick; // store key string; load later
  });


  const backgroundEntries = Array(sectionCount).fill(null).map((_, i) => {
    const sname = sections[i].name;
    const { backgroundList } = getSectionLists(sname);
    if (!backgroundList || backgroundList.length === 0) return null;
    const pick = backgroundList[Math.floor(Math.random() * backgroundList.length)];
    return pick; // store key string; load later
  });

  // --- DUPLICATE EDGE BACKGROUNDS ---
  if (backgroundEntries.length > 0) {
    backgroundEntries.unshift(backgroundEntries[0]);                 // left duplicate
    backgroundEntries.push(backgroundEntries[backgroundEntries.length - 1]); // right duplicate
  }


  // NEW: sprinkle BACKGROUND objects (behind ground), each with its own height
  function pushBackObjects(list, outArr, densityPx, yJitter, baseBelowTop) {
    if (!list || list.length === 0) return;
    const count = Math.max(2, Math.floor(areaLengthPx / densityPx));
    for (let i = 0; i < count; i++) {
      const x = Math.random() * areaLengthPx;
      const pick = list[Math.floor(Math.random() * list.length)]; // { name, height }
      //const entry = loadObjectImage(pick.name);
      const entry = null;
      const heightPx = resolvePlacedObjectHeightPx(pick, pick.name, 0.55);
      outArr.push({
        worldX: x,
        key: pick.name,
        entry,
        heightPx,
        yJitter,
        baseBelowTop
      });
    }
  }

  // NEW: sprinkle FOREGROUND objects (in front of ground), each with its own height
  function pushForeObjects(list, outArr, densityPx, yJitter, baseBelowTop) {
    if (!list || list.length === 0) return;
    const count = Math.max(2, Math.floor(areaLengthPx / densityPx));
    for (let i = 0; i < count; i++) {
      const x = Math.random() * areaLengthPx;
      const pick = list[Math.floor(Math.random() * list.length)]; // { name, height }
      //const entry = loadObjectImage(pick.name);
      const entry = null;
      const heightPx = resolvePlacedObjectHeightPx(pick, pick.name, 0.70);

      outArr.push({
        worldX: x,
        key: pick.name,
        entry,
        heightPx,
        yJitter,
        baseBelowTop
      });
    }
  }


  const backObjects = [];
  const foreObjects = [];
  const groundBackObjects = [];
  const groundForeObjects = [];


  // These are only used for "density-free" items as a baseline
  const DENSITY_BACK = 420;
  const DENSITY_FORE = 520;

  
  const DENSITY_GROUND_BACK = 520;
  const DENSITY_GROUND_FORE = 520;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const startX = i * sectionTileWidth;
    const endX = startX + sectionTileWidth;

    // Protect NPC spawn points in this section (so random FORE objects never cover them)
    const sdefRawForProtection = (definedSections && definedSections[sec.name]) || {};
    const charsForProtection = asArrayMaybe(sdefRawForProtection.characters);
    for (const c of charsForProtection) {
      if (!c || !c.name) continue;
      const posLocal = Number(c.position || 0);
      const atX = startX + posLocal;

      // Use player.w as a reasonable “spawn point” width on screen
      addProtectedViewSpot(atX, player.w);
    }


    const {
      backObjList, foreObjList,
      groundBackObjList, groundForeObjList,
      areaGroundBackObjList, secGroundBackObjList,
      areaGroundForeObjList, secGroundForeObjList
    } = getSectionLists(sec.name);

    // Split each list into "density-defined" vs "density-free"
    // const backWithDensity = (backObjList || []).filter(o => o && o.density > 0);
    // const backNoDensity   = (backObjList || []).filter(o => !o || !o.density);
    const backWithDensity = (backObjList || []).filter(
      o => o && o.density > 0 && o.position == null
    );
    const backNoDensity   = (backObjList || []).filter(
      o => o && o.position == null && !o.density
    );


    const foreWithDensity = (foreObjList || []).filter(
      o => o && o.density > 0 && o.position == null
    );
    const foreNoDensity = (foreObjList || []).filter(
      o => o && o.position == null && !o.density
    );
    const groundBackWithDensity = (groundBackObjList || []).filter(
      o => o && o.density > 0 && o.position == null
    );
    const groundBackNoDensity = (groundBackObjList || []).filter(
      o => o && o.position == null && !o.density
    );

    const groundForeWithDensity = (groundForeObjList || []).filter(
      o => o && o.density > 0 && o.position == null
    );
    const groundForeNoDensity = (groundForeObjList || []).filter(
      o => o && o.position == null && !o.density
    );

    // --- BACKGROUND OBJECTS WITH EXPLICIT POSITION ---
    const backWithPosition = (backObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of backWithPosition) {
      const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.55);
      backObjects.push({
        worldX: startX + obj.position,
        anchorToSection: true,
        sectionIndex: i,
        posLocal: obj.position,
        key: obj.name,
        entry: null,
        heightPx,
        yJitter: -8,
        baseBelowTop: 14,

        // NEW
        objectId: obj.objectId || null,
        startOpen: (obj.open != null) ? !!obj.open : null,
        portal: obj.portal || null,

        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        despawnWhen: obj.despawnWhen || null,
        despawnIf: obj.despawnIf || null,
        _spawned: (obj._spawned !== false),
        __needsId: true
      });


    }

    
    // --- FOREGROUND OBJECTS WITH EXPLICIT POSITION ---
    const foreWithPosition = (foreObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of foreWithPosition) {
      const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.70);
      foreObjects.push({
        worldX: startX + obj.position,
        anchorToSection: true,
        sectionIndex: i,
        posLocal: obj.position,
        key: obj.name,
        entry: null,
        heightPx,
        yJitter: 0,
        baseBelowTop: 0,

        // NEW
        objectId: obj.objectId || null,
        startOpen: (obj.open != null) ? !!obj.open : null,
        portal: obj.portal || null,

        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        despawnWhen: obj.despawnWhen || null,
        despawnIf: obj.despawnIf || null,
        _spawned: (obj._spawned !== false),
        __needsId: true
      });


    }

    // --- GROUND-BACK OBJECTS WITH EXPLICIT POSITION ---
    // Section-defined positions are relative to section start
    const groundBackWithPositionSection = (secGroundBackObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of groundBackWithPositionSection) {
      const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.70);
      groundBackObjects.push({
        worldX: startX + obj.position,
        anchorToSection: true,
        sectionIndex: i,
        posLocal: obj.position,
        key: obj.name,
        entry: null,
        heightPx,
        yJitter: 0,
        baseBelowTop: 0,

        // NEW
        objectId: obj.objectId || null,
        startOpen: (obj.open != null) ? !!obj.open : null,
        portal: obj.portal || null,

        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        despawnWhen: obj.despawnWhen || null,
        despawnIf: obj.despawnIf || null,
        _spawned: (obj._spawned !== false),
        __needsId: true
      });


      addProtectedViewSpot(
        startX + obj.position,
        estimateObjectDrawWidthPx(obj.name, heightPx, 0.70)
      );

    }

    // Area-defined positions are absolute within the whole area
    const groundBackWithPositionArea = (areaGroundBackObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of groundBackWithPositionArea) {
      const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.70);
      groundBackObjects.push({
        worldX: obj.position,
        key: obj.name,
        entry: null,
        heightPx,
        yJitter: 0,
        baseBelowTop: 0,

        // NEW
        objectId: obj.objectId || null,
        startOpen: (obj.open != null) ? !!obj.open : null,
        portal: obj.portal || null,
        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        despawnWhen: obj.despawnWhen || null,
        despawnIf: obj.despawnIf || null,
        _spawned: (obj._spawned !== false),
        __needsId: true
      });

      addProtectedViewSpot(
        obj.position,
        estimateObjectDrawWidthPx(obj.name, heightPx, 0.70)
      );

    }


    // --- GROUND-FORE OBJECTS WITH EXPLICIT POSITION ---
    // Section-defined positions are relative to section start
    const groundForeWithPositionSection = (secGroundForeObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of groundForeWithPositionSection) {
      const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.70);
      groundForeObjects.push({
        worldX: startX + obj.position,
        anchorToSection: true,
        sectionIndex: i,
        posLocal: obj.position,
        key: obj.name,
        entry: null,
        heightPx,
        yJitter: 0,
        baseBelowTop: 0,

        // NEW
        objectId: obj.objectId || null,
        startOpen: (obj.open != null) ? !!obj.open : null,
        portal: obj.portal || null,

        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        despawnWhen: obj.despawnWhen || null,
        despawnIf: obj.despawnIf || null,
        _spawned: (obj._spawned !== false),
        __needsId: true
      });


      addProtectedViewSpot(
        startX + obj.position,
        estimateObjectDrawWidthPx(obj.name, heightPx, 0.70)
      );

    }

    // --- BACKGROUND OBJECTS (behind ground) ---
    // 1) Density-defined: spawn Poisson(lambda) of that exact object
    for (const obj of backWithDensity) {
      const k = samplePoisson(obj.density);
      for (let t = 0; t < k; t++) {
        //const entry = loadObjectImage(obj.name);
        const entry = null;
        const x = startX + Math.random() * (endX - startX);
        const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.55);
        backObjects.push({
          worldX: x,
          key: obj.name,
          entry,
          heightPx,
          yJitter: -8,
          baseBelowTop: 14
        });
      }
    }
    // 2) Density-free: sprinkle a small number, choosing randomly from this pool
    if (backNoDensity.length) {
      const countBack = Math.max(1, Math.round(sectionTileWidth / DENSITY_BACK));
      for (let k = 0; k < countBack; k++) {
        const pick = backNoDensity[Math.floor(Math.random() * backNoDensity.length)]; // {name,height}
        //const entry = loadObjectImage(pick.name);
        const entry = null;
        const x = startX + Math.random() * (endX - startX);
        const heightPx = resolvePlacedObjectHeightPx(pick, pick.name, 0.55);
        backObjects.push({
          worldX: x,
          key: pick.name,
          entry,
          heightPx,
          yJitter: -8,
          baseBelowTop: 14
        });
      }
    }

    // --- FOREGROUND OBJECTS (in front of ground) ---
    // 1) Density-defined: Poisson per specific object
    for (const obj of foreWithDensity) {
      const k = samplePoisson(obj.density);
      for (let t = 0; t < k; t++) {
        //const entry = loadObjectImage(obj.name);
        const entry = null;
        const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.70);
        const x = pickForegroundWorldXAvoidingProtected(obj.name, heightPx);
        foreObjects.push({
          worldX: x,
          key: obj.name,
          random: true,
          entry,
          heightPx,
          yJitter: 0,
          baseBelowTop: 0
        });
      }
    }
    // 2) Density-free: baseline sprinkle from the pool
    if (foreNoDensity.length) {
      const countFore = Math.max(1, Math.round(sectionTileWidth / DENSITY_FORE));
      for (let k = 0; k < countFore; k++) {
        const pick = foreNoDensity[Math.floor(Math.random() * foreNoDensity.length)];
        //const entry = loadObjectImage(pick.name);
        const entry = null;
        const heightPx = resolvePlacedObjectHeightPx(pick, pick.name, 0.70);
        const x = pickForegroundWorldXAvoidingProtected(pick.name, heightPx);
        foreObjects.push({
          worldX: x,
          random: true,
          key: pick.name,
          entry,
          heightPx,
          yJitter: 0,
          baseBelowTop: 0
        });
      }
    }

    // --- GROUND-BACK OBJECTS (move with ground, BEHIND characters) ---
    for (const obj of groundBackWithDensity) {
      const k = samplePoisson(obj.density);
      for (let t = 0; t < k; t++) {
        const entry = null;
        const x = startX + Math.random() * (endX - startX);
        const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.70);
        groundBackObjects.push({
          worldX: x,
          key: obj.name,
          entry,
          heightPx,
          yJitter: 0,
          baseBelowTop: 0
        });
      }
    }
    if (groundBackNoDensity.length) {
      const count = Math.max(1, Math.round(sectionTileWidth / DENSITY_GROUND_BACK));
      for (let k = 0; k < count; k++) {
        const pick = groundBackNoDensity[Math.floor(Math.random() * groundBackNoDensity.length)];
        const entry = null;
        const x = startX + Math.random() * (endX - startX);
        const heightPx = resolvePlacedObjectHeightPx(pick, pick.name, 0.70);
        groundBackObjects.push({
          worldX: x,
          key: pick.name,
          entry,
          heightPx,
          yJitter: 0,
          baseBelowTop: 0
        });
      }
    }

    // --- GROUND-FORE OBJECTS (move with ground, IN FRONT of characters) ---
    for (const obj of groundForeWithDensity) {
      const k = samplePoisson(obj.density);
      for (let t = 0; t < k; t++) {
        const entry = null;
        const x = startX + Math.random() * (endX - startX);
        const heightPx = resolvePlacedObjectHeightPx(obj, obj.name, 0.70);
        groundForeObjects.push({
          worldX: x,
          key: obj.name,
          entry,
          heightPx,
          yJitter: 0,
          baseBelowTop: 0
        });
      }
    }
    if (groundForeNoDensity.length) {
      const count = Math.max(1, Math.round(sectionTileWidth / DENSITY_GROUND_FORE));
      for (let k = 0; k < count; k++) {
        const pick = groundForeNoDensity[Math.floor(Math.random() * groundForeNoDensity.length)];
        const entry = null;
        const x = startX + Math.random() * (endX - startX);
        groundForeObjects.push({
          worldX: x,
          key: pick.name,
          entry,
          heightPx: resolvePlacedObjectHeightPx(pick, pick.name, 0.70),
          yJitter: 0,
          baseBelowTop: 0
        });
      }
    }


  }




  function __ensureSectionObjectIds(list) {
    if (!Array.isArray(list) || list.length === 0) return;

    const bySection = new Map(); // idx -> { used:Set, counters:Map }
    const getRec = (idx) => {
      if (!bySection.has(idx)) {
        bySection.set(idx, { used: new Set(), counters: new Map() });
      }
      return bySection.get(idx);
    };

    for (const obj of list) {
      if (!obj || (!obj.__needsId && !obj.portal)) continue;
      const idx = (typeof obj.sectionIndex === 'number')
        ? obj.sectionIndex
        : Math.floor((Number(obj.worldX || 0)) / sectionTileWidth);
      obj.sectionIndex = idx;
      if (!isFinite(idx) || idx < 0) continue;
      if (obj.objectId) getRec(idx).used.add(String(obj.objectId));
    }

    for (const obj of list) {
      if (!obj || (!obj.__needsId && !obj.portal)) continue;
      if (obj.objectId) continue;
      const idx = (typeof obj.sectionIndex === 'number')
        ? obj.sectionIndex
        : Math.floor((Number(obj.worldX || 0)) / sectionTileWidth);
      obj.sectionIndex = idx;
      if (!isFinite(idx) || idx < 0) continue;

      const base = objectBaseFromKey(obj.key || obj.name || obj.filename) || 'obj';
      const rec = getRec(idx);
      let n = rec.counters.get(base) || 1;
      let candidate = `${base}_${n}`;
      while (rec.used.has(candidate)) {
        n += 1;
        candidate = `${base}_${n}`;
      }
      rec.counters.set(base, n + 1);
      rec.used.add(candidate);
      obj.objectId = candidate;
    }
  }

  __ensureSectionObjectIds(backObjects);
  __ensureSectionObjectIds(foreObjects);
  __ensureSectionObjectIds(groundBackObjects);
  __ensureSectionObjectIds(groundForeObjects);


  // Build worldExits absolute positions
  const exitsWorld = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const startX = i * sectionTileWidth;

    // NOTE: NPCs are NOT spawned here anymore (persistence owns that).
    // Characters from predefined sections will be handled in populateNPCsForCurrentArea().

    // Exits (if any)
    for (const ex of section.exits) {
      exitsWorld.push({
        ...ex,
        sectionIndex: i,
        worldX: startX + (Number(ex.posLocal) || 0)
      });
    }
  }

  // Build worldSafePlaces absolute positions
  const safePlacesWorld = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const startX = i * sectionTileWidth;

    for (const sp of (section.safePlaces || [])) {
      safePlacesWorld.push({
        ...sp,
        sectionIndex: i,
        worldX: startX + (Number(sp.posLocal) || 0)
      });
    }
  }

  // Build worldItems absolute positions (centered on posLocal)
  const worldItems = [];
  const worldItemByKey = new Map();
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const startX = i * sectionTileWidth;
    const items = Array.isArray(section.items) ? section.items : [];

    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      const itemId = lc(it?.itemId || '');
      if (!itemId) continue;
      if (!getItemDef(itemId)) continue;

      const instanceId = worldItemInstanceId(areaName, i, itemId, it.instanceId, j);
      if (!instanceId) continue;
      const instanceKey = `item:${instanceId}`;

      const pickedKey = worldItemPickedFlagKey(instanceKey);
      const picked = !!(pickedKey && getFlag('global', pickedKey));

      if (picked) continue;

      const entry = {
        itemId,
        instanceKey,
        instanceId,
        qty: (it.qty != null) ? Math.max(1, Math.floor(Number(it.qty))) : 1,
        sectionIndex: i,
        posLocal: Number(it.posLocal) || 0,
        worldX: startX + (Number(it.posLocal) || 0),
        _picked: false,
        _drawIndex: worldItems.length
      };

      worldItems.push(entry);
      worldItemByKey.set(instanceKey, entry);
    }
  }


  // Minimal scenery per area (done once because we cache the build)
  resetSceneryForArea(areaLengthPx);

  // NEW: store the built object in cache before returning
  const built = {
    name: areaName,
    sections,
    groundEntries,
    sectionTileWidth,
    lengthPx: areaLengthPx,
    leftarea: def.leftarea || null,
    rightarea: def.rightarea || null,
    timeOfDay: def.timeOfDay || null,
    raw: def,
    exitsWorld,
    safePlacesWorld,
    worldItems,
    worldItemByKey,
    skyEntry,
    distantEntries,
    backgroundEntries,
    backObjects,
    foreObjects,
    groundBackObjects,
    groundForeObjects,
    protectedViewSpots,
  };

  areaCache.set(areaName, built); // cache it

  return built;
}


// ===== Area loading / transferring =====
async function tryResolveAreasData() {
  if (areasData) return areasData;
  areasData = await loadAreasJSON();
  return areasData;
}

function placePlayerAtAreaEdge(area, edge) {
  // edge: 'left' or 'right'
  if (edge === 'left') {
    player.worldX = 2; // just inside
  } else {
    player.worldX = Math.max(2, area.lengthPx - player.w - 2);
  }
  // snap to ground
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
  player.y = groundY - player.h;
  // center camera appropriately (clamped in update)
  cameraX = Math.max(0, Math.min(player.worldX - WIDTH * 0.5, Math.max(0, area.lengthPx - WIDTH)));
}

function buildAndEnterArea(areaName, spawnEdge = 'left') {
  const fromArea = currentAreaName; // FIX
  // Determine horizontal entry direction for events
  // spawnEdge = where the player appears
  // from = where they came FROM
  let from = null;
  if (spawnEdge === 'left') from = 'right';
  else if (spawnEdge === 'right') from = 'left';


  const area = buildAreaFromDefinition(areaName);

  // ===== IMPORTANT: flush section_leave before swapping areas =====
  // Otherwise section-enter prompts never expire if the player changes area from inside a section.
  if (fromArea) {
    // Player leaves their last known named section (if any)
    if (lastPlayerSection) {
      emitGameEvent('section_leave', {
        area: fromArea,
        section: lastPlayerSection,
        from: null,
        npc: 'Player'
      });
    }

    // Party members leave their last known named sections (if any)
    for (const member of party) {
      if (!member || !member.name) continue;
      const k = lc(member.name);
      const lastSec = lastNpcSection.get(k) || null;

      if (lastSec) {
        emitGameEvent('section_leave', {
          area: fromArea,
          section: lastSec,
          from: null,
          npc: member.name
        });
      }
    }
  }


  queuedDialogPrompts.length = 0;
  activeDialogPrompts.length = 0;



  if (!area) return;
  lastPlayerSection = null;
  lastPlayerSectionIndex = null;
  lastNpcSection.clear();
  lastNpcSectionIndex.clear();

  currentAreaName = areaName;
  firedDialogTriggers.clear();
  resetAreaFlags();
  currentArea = area;
  worldMin = 0;
  worldMax = currentArea.lengthPx;
  worldExits = currentArea.exitsWorld;
  worldSafePlaces = (currentArea && currentArea.safePlacesWorld) ? currentArea.safePlacesWorld : [];
  lastPlayerAreaEnterEdge = spawnEdge;

  placePlayerAtAreaEdge(currentArea, spawnEdge);


  const areaRegion = area?.raw?.region ? String(area.raw.region).trim() : '';
  const areaDisplayName = area?.raw?.name ? String(area.raw.name).trim() : String(areaName || '').trim();
  const loadingLabel = areaRegion ? `${areaRegion} - ${areaDisplayName}` : areaDisplayName || `Loading ${areaName}...`;
  beginLoadingForCurrentArea(loadingLabel);

  // Non-blocking: preload portraits + animations for anything referenced by this area.
  startBackgroundPreloadForArea(areaName);


  // area_leave event (for the previous area, if any)
  if (fromArea) {
    emitGameEvent('area_leave', { fromArea, toArea: areaName, area: fromArea, from: pendingVerticalTransferFrom ?? from, npc: 'Player' });
  }
  // Defer area_enter until after load gate so spawnWhen/rules are registered.
  __pendingAreaEnterEvents = [];
  __pendingAreaEnterEvents.push({
    fromArea,
    toArea: areaName,
    area: areaName,
    edge: spawnEdge,
    from: pendingVerticalTransferFrom ?? from,
    npc: 'Player'
  });

  // Mirror area enter for party members (same event names; includes npc)
  for (const member of party) {
    if (!member || !member.name) continue;
    __pendingAreaEnterEvents.push({
      fromArea,
      toArea: areaName,
      area: areaName,
      edge: spawnEdge,
      from: pendingVerticalTransferFrom ?? from,
      npc: member.name
    });
  }

}


// Transfer from left/right boundary
function transferToAdjacentArea(direction) {
  if (!currentArea) return;

  // NEW: if a fade/transfer is already active, ignore additional triggers
  if (FADE.active) return;

  const prevX = player.worldX;

  const nextName = (direction === 'left') ? currentArea.leftarea : currentArea.rightarea;
  if (!nextName) {
    // Edge bounce (no transfer)
    if (direction === 'left') { player.worldX = 0; } 
    else { player.worldX = currentArea.lengthPx - player.w; }
    player.vx = 0;
    return;
  }

  const spawnEdge = (direction === 'left') ? 'right' : 'left';
  startAreaTransfer({
    areaName: nextName,
    spawnEdge,
    prevX,
    nudgeParty: true,
    nudgePartyFrom: spawnEdge
  });


}


function nudgePartyBehind(direction) {
  // direction == 'left' means we arrived from left edge (moving right),
  // so place party slightly to the left; and vice versa.
  const base = (direction === 'left') ? -36 : 36;
  for (let i = 0; i < party.length; i++) {
    const m = party[i];
    const off = base * (i + 1);
    m.worldX = Math.max(2, Math.min(currentArea.lengthPx - m.w - 2, player.worldX - off));
    m.y = groundY - m.h - 8;
  }
}

function scatterPartyNearPlayer(maxDx = 500) {
  const range = Math.max(0, Number(maxDx) || 0);

  for (let i = 0; i < party.length; i++) {
    const m = party[i];
    if (!m) continue;

    // random in [-range, +range]
    const dx = (Math.random() * 2 - 1) * range;

    // clamp inside area bounds
    const minX = 2;
    const maxX = Math.max(minX, (currentArea?.lengthPx ?? 0) - (m.w ?? 0) - 2);

    m.worldX = Math.max(minX, Math.min(maxX, (player.worldX || 0) + dx));
    m.vx = 0;
    m.vy = 0;
    m.y = groundY - m.h - 8;
  }
}

// ===== Exit interaction & resolution =====
function startAreaTransfer(opts) {
  const destAreaName = String(opts?.areaName || '').trim();
  if (!destAreaName) return false;

  const destWorldX = (opts && isFinite(opts.worldX)) ? Number(opts.worldX) : null;
  const spawnEdge = String(opts?.spawnEdge || 'left');
  const prevX = (opts && isFinite(opts.prevX)) ? Number(opts.prevX) : null;

  const setFrom = (opts && typeof opts.fromDirection === 'string') ? opts.fromDirection : null;
  const nudgeFrom = String(opts?.nudgePartyFrom || spawnEdge);
  const doNudge = (opts?.nudgeParty === true);
  const doCarry = (opts?.carryParty !== false);
  const snapPartyToPlayer = (opts?.snapPartyToPlayer === true);
  const skipBuildIfSameArea = (opts?.skipBuildIfSameArea !== false);

  startFadeTransfer(() => {
    snapshotNPCsToRegistry();                 // persist NPCs
    snapshotMobsToRegistry({ stripPlayerTargets: true }); // persist mobs + drop player target

    if (setFrom) pendingVerticalTransferFrom = setFrom;

    const sameArea = (destAreaName === currentAreaName);
    if (!sameArea || !skipBuildIfSameArea) {
      buildAndEnterArea(destAreaName, spawnEdge);
    }

    if (destWorldX != null) {
      const clamped = Math.max(2, Math.min(currentArea.lengthPx - player.w - 2, destWorldX));
      player.worldX = clamped;
    }

    player.vx = 0;
    player.vy = 0;
    player.onGround = true;
    player.y = groundY - player.h;
    resetActorTeleportState(player);
    cameraX = Math.max(0, Math.min(player.worldX - canvas.width * 0.5, Math.max(0, currentArea.lengthPx - canvas.width)));

    if (doCarry && prevX != null) {
      carryPartyWithPlayer(prevX, player.worldX);
    }
    if (snapPartyToPlayer) {
      for (const m of party) {
        if (!m) continue;
        m.worldX = player.worldX;
        m.vx = 0;
        m.vy = 0;
        m.y = groundY - m.h - 8;
        resetActorTeleportState(m);
      }
    }
    if (doNudge) {
      nudgePartyBehind(nudgeFrom);
    }

    // Keep live party actors tied to the actual destination area (not currentAreaName fallback).
    for (const m of party) {
      if (!m || !m.name) continue;
      m.area = destAreaName;
      const rec = ensureNpcRecord(m.name);
      rec.area = destAreaName;
      if (typeof m.worldX === 'number') rec.worldX = m.worldX;
    }
  });

  return true;
}

function parseTargetExitString(s) {
  if (!s) return { area: null, section: null, exitId: null };
  const parts = String(s).split('.');
  if (parts.length === 1) return { area: parts[0], section: null, exitId: null };
  if (parts.length === 2) return { area: parts[0], section: parts[1], exitId: null };
  return { area: parts[0], section: parts[1], exitId: parts[2] };
}

function findExitWorldPosition(target) {
  // target: {area, section, exitId}
  if (!areasData || !target.area) return null;
  const areaDef = areasData[target.area];
  if (!areaDef) return null;

  const built = buildAreaFromDefinition(target.area);
  if (!built) return null;

  if (!target.section) {
    // Only Area: spawn at left edge
    return { areaName: target.area, worldX: 2 };
  }

  // Need to locate the section's position index
  const secDef = (areaDef.sections && areaDef.sections[target.section]) || null;
  if (!secDef) {
    // Section missing → default to left edge of Area
    return { areaName: target.area, worldX: 2 };
  }
  const sectionPos = Number(secDef.position || 0);
  if (sectionPos <= 0) {
    // No fixed pos → fallback to left edge
    return { areaName: target.area, worldX: 2 };
  }

  // Build exits listing for the chosen Area to find exitId
  const targetBuilt = built; // already built
  const secIndex = sectionPos - 1;
  const secStart = secIndex * targetBuilt.sectionTileWidth;

  if (!target.exitId) {
    return { areaName: target.area, worldX: 2 };
  }

  const exitsInThisSec = normalizeExits((areaDef.sections[target.section] || {}).exits);
  const ex = exitsInThisSec.find(e => String(e.id) === String(target.exitId));
  if (!ex) return null;

  const destX = secStart + (Number(ex.posLocal) || 0);
  return { areaName: target.area, worldX: destX };
}

function _isNumericTargetPart(s) {
  if (s == null) return false;
  const str = String(s).trim();
  if (!str) return false;
  const n = Number(str);
  return isFinite(n) && String(n) === str;
}

function _areaExists(areaName) {
  return !!(areasData && areasData[areaName]);
}

function _sectionExists(areaName, sectionName) {
  if (!areaName || !sectionName) return false;
  const def = areasData && areasData[areaName];
  return !!(def && def.sections && Object.prototype.hasOwnProperty.call(def.sections, sectionName));
}

function _getFirstSectionName(areaName) {
  const def = areasData && areasData[areaName];
  if (!def || !def.sections) return null;

  let best = null;
  let bestPos = Infinity;

  for (const [name, s] of Object.entries(def.sections)) {
    if (!name) continue;
    const pos = Number(s?.position || 0);
    if (pos > 0 && pos < bestPos) {
      bestPos = pos;
      best = name;
    }
  }

  if (best) return best;

  const keys = Object.keys(def.sections);
  return keys.length ? keys[0] : null;
}

function _sectionStartWorldXForArea(areaName, sectionName) {
  if (!areaName || !sectionName) return null;
  const built = buildAreaFromDefinition(areaName);
  if (!built) return null;

  const idx = built.sections.findIndex(s => s && s.name === sectionName);
  if (idx < 0) return null;

  const w = Number(built.sectionTileWidth);
  if (!isFinite(w) || w <= 0) return null;

  return idx * w;
}

function _sectionStartWorldXForAreaIndex(areaName, sectionIndex) {
  if (!areaName) return null;
  const built = buildAreaFromDefinition(areaName);
  if (!built) return null;

  const w = Number(built.sectionTileWidth);
  if (!isFinite(w) || w <= 0) return null;

  const idx = Math.max(0, Math.floor(Number(sectionIndex) || 0));
  return idx * w;
}

function _sectionNameForWorldXInArea(areaObj, worldX) {
  if (!areaObj || !Array.isArray(areaObj.sections)) return null;
  const w = Number(areaObj.sectionTileWidth);
  if (!isFinite(w) || w <= 0) return null;
  const idx = Math.max(0, Math.floor(Number(worldX || 0) / w));
  return areaObj.sections[idx]?.name || null;
}

function _findObjectInstanceInArea(areaName, objectId, sectionName = null, opts = null) {
  if (!areaName || !objectId) return null;
  const built = buildAreaFromDefinition(areaName);
  if (!built) return null;

  const includeDespawned = !!(opts && opts.includeDespawned);
  const includeObject = !!(opts && opts.includeObject);

  const objectBuckets = [
    { layer: 'back',   list: built.backObjects },
    { layer: 'fore',   list: built.foreObjects },
    { layer: 'gback',  list: built.groundBackObjects },
    { layer: 'gfore',  list: built.groundForeObjects }
  ];

  for (const bucket of objectBuckets) {
    const list = bucket.list;
    if (!Array.isArray(list)) continue;

    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      if (!includeDespawned && o._spawned === false) continue;

      const raw = String(o.key || o.name || o.filename || '').trim();
      if (!raw) continue;
      const base = raw.replace(/\.[^/.]+$/, '').trim();
      if (!base) continue;

      const instanceId = _objectInstanceIdForBucket(o, bucket.layer, base, i);
      const objId = (o.objectId != null && o.objectId !== '') ? String(o.objectId)
        : ((o.id != null && o.id !== '') ? String(o.id) : null);
      if (!objId) continue;
      if (String(objId) !== String(objectId)) continue;

      let secName = null;
      if (typeof o.sectionIndex === 'number') {
        secName = built.sections[o.sectionIndex]?.name || null;
      } else {
        secName = _sectionNameForWorldXInArea(built, o.worldX);
      }
      if (sectionName && secName !== sectionName) continue;

      return {
        areaName,
        worldX: Number(o.worldX || 0),
        instanceKey: `object:${instanceId}`,
        sectionName: secName,
        obj: includeObject ? o : undefined
      };
    }
  }

  return null;
}

function resolvePortalTarget(targetRaw) {
  const raw = String(targetRaw || '').trim();
  if (!raw) return null;

  const parts = raw.split('.').map(p => String(p || '').trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const curArea = String(currentAreaName || '').trim();

  const resolveObjectTarget = (areaName, sectionName, objectId) => {
    const found = _findObjectInstanceInArea(areaName, objectId, sectionName, { includeDespawned: true, includeObject: true });
    if (!found) return null;
    if (found.obj && found.obj._spawned === false) {
      const payload = { area: found.areaName, section: found.sectionName };
      const ok = wouldObjectSpawnOnAreaLoad(found.obj, payload);
      if (!ok) return null;
    }
    return { areaName: found.areaName, worldX: found.worldX, instanceKey: found.instanceKey };
  };

  if (parts.length === 1) {
    const objectId = parts[0];
    const foundHere = resolveObjectTarget(curArea, null, objectId);
    if (foundHere) return foundHere;

    const keys = Object.keys(areasData || {});
    for (const a of keys) {
      if (a === curArea) continue;
      const found = resolveObjectTarget(a, null, objectId);
      if (found) return found;
    }
    return null;
  }

  if (parts.length === 2) {
    const [p1, p2] = parts;

    if (_areaExists(p1) && _sectionExists(p1, p2)) {
      const start = _sectionStartWorldXForArea(p1, p2);
      if (start == null) return null;
      return { areaName: p1, worldX: start + 0 };
    }

    if (_isNumericTargetPart(p2)) {
      const xLocal = Number(p2);
      if (_areaExists(p1)) {
        const sec = _getFirstSectionName(p1);
        const start = sec
          ? _sectionStartWorldXForArea(p1, sec)
          : _sectionStartWorldXForAreaIndex(p1, 0);
        if (start == null) return null;
        return { areaName: p1, worldX: start + xLocal };
      }

      if (curArea && _sectionExists(curArea, p1)) {
        const start = _sectionStartWorldXForArea(curArea, p1);
        if (start == null) return null;
        return { areaName: curArea, worldX: start + xLocal };
      }
    }

    if (_areaExists(p1)) {
      const found = resolveObjectTarget(p1, null, p2);
      if (found) return found;
    }

    if (curArea && _sectionExists(curArea, p1)) {
      const found = resolveObjectTarget(curArea, p1, p2);
      if (found) return found;
    }

    return null;
  }

  if (parts.length === 3) {
    const [areaName, sectionName, third] = parts;
    if (!_areaExists(areaName) || !_sectionExists(areaName, sectionName)) return null;

    if (_isNumericTargetPart(third)) {
      const start = _sectionStartWorldXForArea(areaName, sectionName);
      if (start == null) return null;
      return { areaName, worldX: start + Number(third) };
    }

    return resolveObjectTarget(areaName, sectionName, third);
  }

  return null;
}

function tryUseExit(exitObj) {
  // exitObj has: direction ('up'|'down'), target (string or null)
  const needKey = exitObj.direction === 'up' ? 'ArrowUp' : 'ArrowDown';
  // We'll be called from key handler after verifying the correct key is pressed
  const target = parseTargetExitString(exitObj.target);

  if (!exitObj.target) {
    console.warn("Exit has no target; ignoring.", exitObj);
    return;
  }

  const dest = findExitWorldPosition(target);
  if (!dest || !dest.areaName) {
    console.warn("Exit target could not be resolved:", exitObj.target);
    return;
  }
  const prevX = player.worldX;

  emitGameEvent('exit_use', {
    area: currentAreaName,
    section: getSectionNameForX(player.worldX),
    sectionIndex: exitObj.sectionIndex,
    exitId: exitObj.id,
    direction: exitObj.direction,
    target: exitObj.target,
    toArea: dest.areaName
  });

  startAreaTransfer({
    areaName: dest.areaName,
    worldX: dest.worldX,
    spawnEdge: 'left',
    prevX,
    fromDirection: (exitObj.direction === 'up') ? 'down'
      : (exitObj.direction === 'down') ? 'up'
      : null,
    nudgeParty: true,
    nudgePartyFrom: 'left'
  });
}

// ===== NPC autonomous movement (world NPCs only) =====
const NPC_AI_DEFAULTS = {
  waiting: {
    avgMoveDistancePx: 140,  // average “short walk” distance
    avgIdleMs: 900,          // average idle time between walks
    speedPxPerSec: 90        // walking speed in px/s
  },
  moving: {
    speedPxPerSec: 120
  }
};

function getNpcAiConfig(name) {
  const d = (npcDetails && npcDetails[name]) ? npcDetails[name] : null;

  // Allow either nested ai blocks or flat fields
  const wait = d?.ai?.waiting || d?.ai?.wait || {};
  const move = d?.ai?.moving || d?.ai?.move || {};

  const waitingAvgMoveDistancePx = Number(
    d?.waitingAvgMoveDistancePx ?? wait?.avgMoveDistancePx ?? wait?.avgMoveDistance ?? wait?.distancePx
  );
  const waitingAvgIdleMs = Number(
    d?.waitingAvgIdleMs ?? wait?.avgIdleMs ?? wait?.idleMs
  );
  const waitingSpeedPxPerSec = Number(
    d?.waitingSpeedPxPerSec ?? wait?.speedPxPerSec ?? wait?.speed
  );

  const movingSpeedPxPerSec = Number(
    d?.movingSpeedPxPerSec ?? move?.speedPxPerSec ?? move?.speed
  );

  return {
    waiting: {
      avgMoveDistancePx: isFinite(waitingAvgMoveDistancePx) ? waitingAvgMoveDistancePx : NPC_AI_DEFAULTS.waiting.avgMoveDistancePx,
      avgIdleMs: isFinite(waitingAvgIdleMs) ? waitingAvgIdleMs : NPC_AI_DEFAULTS.waiting.avgIdleMs,
      speedPxPerSec: isFinite(waitingSpeedPxPerSec) ? waitingSpeedPxPerSec : NPC_AI_DEFAULTS.waiting.speedPxPerSec
    },
    moving: {
      speedPxPerSec: isFinite(movingSpeedPxPerSec) ? movingSpeedPxPerSec : NPC_AI_DEFAULTS.moving.speedPxPerSec
    }
  };
}

function sectionStartWorldX(areaObj, sectionName) {
  if (!areaObj || !Array.isArray(areaObj.sections)) return null;
  const sec = String(sectionName || '');
  if (!sec) return null;

  const idx = areaObj.sections.findIndex(s => s && s.name === sec);
  if (idx < 0) return null;

  const w = Number(areaObj.sectionTileWidth);
  if (!isFinite(w) || w <= 0) return null;

  return idx * w;
}

function goalLeftXForActor(actor, targetCenterX) {
  if (!actor || !isFinite(targetCenterX)) return null;
  return targetCenterX - (actor.w * 0.5);
}

function findAnyObjectInstanceByBaseIdNear(baseId, nearWorldX) {
  const want = lc(baseId);
  if (!want) return null;

  let best = null;
  let bestDx = Infinity;

  for (const [key, t] of proximityTargetByKey.entries()) {
    if (!t || t.kind !== 'object') continue;
    if (lc(t.id) !== want) continue;

    const dx = Math.abs(Number(t.worldX) - Number(nearWorldX));
    if (dx < bestDx) {
      bestDx = dx;
      best = { instanceKey: key, target: t };
    }
  }

  return best ? best.instanceKey : null;
}

function findAnyMobInstanceByIdNear(mobId, nearWorldX) {
  const want = lc(mobId);
  if (!want) return null;

  let best = null;
  let bestDx = Infinity;

  for (const m of mobs) {
    if (!m || !m.id || !m.instanceId) continue;
    if (lc(m.id) !== want) continue;

    const hb = getMobHitboxWorldRect(m);
    const cx = (hb && isFinite(hb.x) && isFinite(hb.w)) ? (Number(hb.x) + Number(hb.w) * 0.5) : null;
    if (!isFinite(cx)) continue;

    const dx = Math.abs(cx - Number(nearWorldX));
    if (dx < bestDx) {
      bestDx = dx;
      best = m;
    }
  }

  return best ? best.instanceId : null;
}


// Normalized goal ref shapes:
//  - { type:'worldX', x:number }  (absolute left-x)
//  - { type:'player' }
//  - { type:'npc', npc:'Rowyn' }
//  - { type:'objectInstance', instanceKey:'gfore:letta_bush:0' }
//  - { type:'object', id:'letta_bush' }  (resolved to nearest instance each tick)
//  - { type:'sectionPos', area?:'forest1', section:'grove_1', x:number } (absolute left-x inside section)
function normalizeGoalSpec(goal, payload, actor) {
  if (!goal || typeof goal !== 'object') return null;

  const t = lc(goal.type);

  if (t === 'worldx') {
    const x = Number(goal.x);
    return isFinite(x) ? { type: 'worldX', x } : null;
  }

  if (t === 'player') return { type: 'player' };

  if (t === 'npc') {
    const n = goal.npc || goal.name;
    return n ? { type: 'npc', npc: String(n) } : null;
  }

  if (t === 'activeobject') {
    // Prefer instanceKey from the triggering payload (object_interact provides it)
    const instanceKey = payload?.instanceKey ? String(payload.instanceKey) : null;
    if (instanceKey) return { type: 'objectInstance', instanceKey };

    // Fallback: last active object type flag (set on Space interact)
    const baseId = getFlag('global', 'activeObjectType');
    if (baseId) return { type: 'object', id: String(baseId) };

    return null;
  }

  if (t === 'objectinstance') {
    const k = goal.instanceKey || goal.key;
    return k ? { type: 'objectInstance', instanceKey: String(k) } : null;
  }

  if (t === 'object') {
    const id = goal.id || goal.baseId || goal.filename;
    return id ? { type: 'object', id: String(id) } : null;
  }

  if (t === 'sectionpos' || t === 'section') {
    const area = goal.area ? String(goal.area) : null;
    const section = goal.section ? String(goal.section) : '';
    const x = Number(goal.x);
    if (!section || !isFinite(x)) return null;
    return { type: 'sectionPos', area, section, x };
  }

  if (t === 'currentsectionpos' || t === 'mysectionpos') {
    const x = Number(goal.x);
    if (!isFinite(x)) return null;

    const sec = getSectionNameForX(actor?.worldX ?? player.worldX);
    return sec ? { type: 'sectionPos', area: currentAreaName, section: sec, x } : null;
  }

  return null;
}

function resolveGoalRefToWorldLeftX(actor, goalRef) {
  if (!actor || !goalRef || typeof goalRef !== 'object') return null;

  const t = lc(goalRef.type);

  if (t === 'worldx') {
    const x = Number(goalRef.x);
    return isFinite(x) ? x : null;
  }

  if (t === 'player') {
    const cx = player.worldX + player.w * 0.5;
    return goalLeftXForActor(actor, cx);
  }

  if (t === 'npc') {
    const other = findActorByName(goalRef.npc);
    if (other && typeof other.worldX === 'number') {
      const cx = other.worldX + other.w * 0.5;
      return goalLeftXForActor(actor, cx);
    }

    // fallback to registry if in this area
    const rec = ensureNpcRecord(goalRef.npc);
    if (rec && rec.area === currentAreaName && typeof rec.worldX === 'number') {
      const cx = rec.worldX + (actor.w * 0.5);
      return goalLeftXForActor(actor, cx);
    }

    return null;
  }

  if (t === 'objectinstance') {
    const key = String(goalRef.instanceKey || '');
    const target = proximityTargetByKey.get(key);
    if (!target) return null;
    return goalLeftXForActor(actor, Number(target.worldX));
  }

  if (t === 'object') {
    // Resolve dynamically to a currently-known instance near the actor
    const base = lc(goalRef.id);
    const instKey = findAnyObjectInstanceByBaseIdNear(base, actor.worldX);
    if (!instKey) return null;

    const target = proximityTargetByKey.get(instKey);
    if (!target) return null;
    return goalLeftXForActor(actor, Number(target.worldX));
  }

  if (t === 'sectionpos') {
    // Only supports current world (same area). If area differs, no-op.
    if (goalRef.area && String(goalRef.area) !== String(currentAreaName)) return null;

    const startX = sectionStartWorldX(currentArea, goalRef.section);
    if (!isFinite(startX)) return null;

    const local = Number(goalRef.x);
    if (!isFinite(local)) return null;

    return startX + local;
  }

  return null;
}

function setNpcAiMode(npc, modeRaw, opts = {}) {
  if (!npc) return;

  const mode = lc(modeRaw || 'stationary');
  npc.aiMode = mode;

  // Reset goal bookkeeping when switching modes
  npc.aiAtGoal = false;

  if (mode === 'waiting') {
    npc.aiGoalRef = null;
    npc.aiGoalX = null;

    // Anchor is: spawn point OR last position before switching to waiting
    npc.aiAnchorX = (opts.anchorX !== undefined && opts.anchorX !== null) ? Number(opts.anchorX) : Number(npc.worldX);
    npc.aiNextDecisionAtMs = getGameNowMs(); // decide immediately
    npc.aiPhase = 'idle'; // 'idle' or 'move'
    npc.aiMoveTargetX = null;

    emitMovementStateIfChanged(npc, true);
    return;
  }

  if (mode === 'moving') {
    // Either fixed goalX, OR a dynamic goalRef (player/npc/object/section)
    if (opts.goalRef) {
      npc.aiGoalRef = opts.goalRef;
      const gx = resolveGoalRefToWorldLeftX(npc, npc.aiGoalRef);
      npc.aiGoalX = (gx != null) ? Number(gx) : null;
    } else if (opts.goalX !== undefined && opts.goalX !== null) {
      npc.aiGoalRef = null;
      npc.aiGoalX = Number(opts.goalX);
    }

    emitMovementStateIfChanged(npc, true);
    return;
  }

  // stationary
  npc.aiGoalRef = null;
  npc.aiGoalX = null;
  npc.aiPhase = 'idle';
  npc.aiMoveTargetX = null;

  emitMovementStateIfChanged(npc, true);
}

function chooseWaitingTargetX(npc, cfg) {
  const anchor = Number(npc.aiAnchorX);
  const cur = Number(npc.worldX);

  const avg = Math.max(10, Number(cfg.waiting.avgMoveDistancePx) || 100);

  // Bias towards anchor if not at anchor:
  // - if left of anchor, offset is mostly positive
  // - if right of anchor, offset is mostly negative
  const dirToAnchor = Math.sign(anchor - cur);

  let offset;
  if (dirToAnchor === 0) {
    offset = (Math.random() * 2 - 1) * avg;
  } else {
    const mag = (0.25 + Math.random()) * avg; // [0.25..1.25]*avg
    offset = dirToAnchor * mag;
  }

  // Target is near anchor, not “keep walking forever”
  return anchor + offset;
}

function updateWorldNpcAutonomy(npc, dt, activeObjectBlockers, nowMs) {
  if (!npc) return;
  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);

  // Freeze autonomous movement only when world time is frozen
  const worldLocked = shouldFreezeWorldTime();
  if (worldLocked) {
    npc.vx = 0;
    return;
  }

  // Stop-moving lock (abilities/attacks)
  {
    const until = Number(npc.__stopMoveUntilMs || 0);
    if (isFinite(until) && until > now) {
      npc.vx = 0;
      npc.vy = 0;
      // keep snapped to ground
      npc.y = groundY - npc.h - 8;
      return;
    }
  }

  // Targeting update (attack + movement)
  updateActorTargeting(npc, now, 'attack');
  updateActorTargeting(npc, now, 'move');

  const cfg = getNpcAiConfig(npc.name);

  const mode = lc(npc.aiMode || 'stationary');

  if (mode === 'stationary') {
    // let friction damp existing velocity
    npc.vx *= Math.pow(friction, dt * 60);
    if (Math.abs(npc.vx) < 0.05) npc.vx = 0;
    return;
  }

  if (mode === 'waiting') {
    if (!isFinite(npc.aiAnchorX)) npc.aiAnchorX = npc.worldX;
    if (!npc.aiPhase) npc.aiPhase = 'idle';

    if (npc.aiPhase === 'idle') {
      // Decide to move when timer elapses
      if (!isFinite(npc.aiNextDecisionAtMs)) npc.aiNextDecisionAtMs = now;

      if (now >= npc.aiNextDecisionAtMs) {
        npc.aiMoveTargetX = chooseWaitingTargetX(npc, cfg);
        npc.aiPhase = 'move';
      } else {
        npc.vx *= Math.pow(friction, dt * 60);
        if (Math.abs(npc.vx) < 0.05) npc.vx = 0;
        return;
      }
    }

    if (npc.aiPhase === 'move') {
      const targetX = Number(npc.aiMoveTargetX);
      const spd = Number(cfg.waiting.speedPxPerSec) || NPC_AI_DEFAULTS.waiting.speedPxPerSec;

      if (!isFinite(targetX) || !isFinite(spd) || spd <= 0) {
        npc.aiPhase = 'idle';
        npc.aiNextDecisionAtMs = now + (Number(cfg.waiting.avgIdleMs) || 600);
        npc.vx = 0;
        return;
      }

      const prevX = npc.worldX;
      const dx = targetX - npc.worldX;
      const step = Math.sign(dx) * spd * dt;

      if (Math.abs(step) >= Math.abs(dx)) {
        npc.worldX = targetX;
        npc.vx = 0;
        npc.aiPhase = 'idle';
        // Randomize idle around avg
        const avgIdle = Math.max(150, Number(cfg.waiting.avgIdleMs) || 700);
        const jitter = (Math.random() * 2 - 1) * (avgIdle * 0.35);
        npc.aiNextDecisionAtMs = now + (avgIdle + jitter);
        npc.aiMoveTargetX = null;
      } else {
        npc.worldX += step;
        npc.vx = step / dt;
        // Facing resolved centrally after movement updates.
        npc.lastMoveTime = now;
        npc.hasEverMoved = true;
      }

      // Clamp inside area
      npc.worldX = Math.max(2, Math.min(currentArea.lengthPx - npc.w - 2, npc.worldX));
      resolveActorVsBlockers(npc, prevX, activeObjectBlockers);

      npc.y = groundY - npc.h - 8;
      return;
    }
  }

  if (mode === 'moving') {
    // Re-resolve dynamic goals every tick (player / npc / object / etc.)
    if (npc.aiGoalRef) {
      const gx = resolveGoalRefToWorldLeftX(npc, npc.aiGoalRef);
      npc.aiGoalX = (gx != null) ? Number(gx) : null;
    }

    // Dynamic targeting goal: chase the current target actor (if present)
    let goalX = Number(npc.aiGoalX);
    let stopRangePx = Number(npc.__moveStopRangePx);

    if (npc.__moveTargetActor) {
      const a = npc.__moveTargetActor;
      goalX = actorCenterX(a) - (Number(npc.w) || 0) * 0.5;
      if (!isFinite(stopRangePx) || stopRangePx <= 0) stopRangePx = 0;
    } else {
      stopRangePx = 0;
    }

    const spd = Number(cfg.moving.speedPxPerSec) || NPC_AI_DEFAULTS.moving.speedPxPerSec;

    if (!isFinite(goalX) || !isFinite(spd) || spd <= 0) {
      npc.vx = 0;

      // If we have no goal, we are effectively stopped
      npc.aiAtGoal = true;
      emitMovementStateIfChanged(npc);
      return;
    }
    const prevX = npc.worldX;
    const dx = goalX - npc.worldX;

    const wasAtGoal = !!npc.aiAtGoal;
    const atGoalNow = (isFinite(stopRangePx) && stopRangePx > 0) ? (Math.abs(dx) <= stopRangePx) : (Math.abs(dx) <= 1);
    npc.aiAtGoal = atGoalNow;

    // Fire goal event on transition into "at goal"
    if (!wasAtGoal && atGoalNow) {
      emitGameEvent('npc_goal_reached', {
        npc: npc.name,
        goalX: goalX,
        goalRef: npc.aiGoalRef || null
      });
    }

    // If at goal and the target is still there, do not drift.
    // When stopRange is used, hold position instead of snapping to goalX.
    if (atGoalNow) {
      if (!(isFinite(stopRangePx) && stopRangePx > 0)) {
        npc.worldX = goalX;
      }
      npc.vx = 0;
      npc.y = groundY - npc.h - 8;

      emitMovementStateIfChanged(npc);
      return;
    }

    const step = Math.sign(dx) * spd * dt;
    if (Math.abs(step) >= Math.abs(dx)) {
      npc.worldX = goalX;
      npc.vx = 0;
    } else {
      npc.worldX += step;
      npc.vx = step / dt;
      // Facing resolved centrally after movement updates.
      npc.lastMoveTime = now;
      npc.hasEverMoved = true;
    }

    npc.worldX = Math.max(2, Math.min(currentArea.lengthPx - npc.w - 2, npc.worldX));
    resolveActorVsBlockers(npc, prevX, activeObjectBlockers);

    npc.y = groundY - npc.h - 8;

    emitMovementStateIfChanged(npc);
    return;
  }
}

const MOB_AI_DEFAULTS = {
  waiting: { avgMoveDistancePx: 120, avgIdleMs: 900, speedPxPerSec: 120 },
  moving: { speedPxPerSec: 140 }
};

function getMobAiConfig(mob) {
  const def = mob?.def || mobDetails?.[lc(mob?.id)] || null;

  const wait = def?.ai?.waiting || def?.ai?.wait || {};
  const move = def?.ai?.moving || def?.ai?.move || {};

  const waitingAvgMoveDistancePx = Number(wait?.avgMoveDistancePx ?? wait?.avgMoveDistance ?? wait?.distancePx);
  const waitingAvgIdleMs = Number(wait?.avgIdleMs ?? wait?.idleMs);
  const waitingSpeedPxPerSec = Number(wait?.speedPxPerSec ?? wait?.speed);

  // If ai.moving speed not provided, fall back to locomotion speed if present
  const locSpeed = Number(def?.locomotion?.speedPxPerSec);
  const movingSpeedPxPerSec = Number(move?.speedPxPerSec ?? move?.speed);

  return {
    waiting: {
      avgMoveDistancePx: isFinite(waitingAvgMoveDistancePx) ? waitingAvgMoveDistancePx : MOB_AI_DEFAULTS.waiting.avgMoveDistancePx,
      avgIdleMs: isFinite(waitingAvgIdleMs) ? waitingAvgIdleMs : MOB_AI_DEFAULTS.waiting.avgIdleMs,
      speedPxPerSec: isFinite(waitingSpeedPxPerSec) ? waitingSpeedPxPerSec : (isFinite(locSpeed) ? locSpeed : MOB_AI_DEFAULTS.waiting.speedPxPerSec)
    },
    moving: {
      speedPxPerSec: isFinite(movingSpeedPxPerSec) ? movingSpeedPxPerSec : (isFinite(locSpeed) ? locSpeed : MOB_AI_DEFAULTS.moving.speedPxPerSec)
    }
  };
}


// ===== Mob Targeting / Anchor (generalized v1) =====

function actorCenterX(a) {
  return (Number(a?.worldX) || 0) + (Number(a?.w) || 0) * 0.5;
}

function mobCenterX(m) {
  return (Number(m?.worldX) || 0) + (Number(m?.w) || 0) * 0.5;
}

function targetKindForActor(a) {
  if (!a) return '';
  if (a.kind === 'object' || a._targetKind === 'object') return 'object';
  if (a === player) return 'player';
  if (party.includes(a)) return 'party';
  if (npcs.includes(a)) return 'npc';
  if (mobs.includes(a)) return 'mob';
  return '';
}

function targetKeyFromDescriptor(td) {
  if (!td || typeof td !== 'object') return '';
  const k = lc(td.kind || '');
  if (k === 'player') return 'player';
  if (k === 'npc') return `npc:${lc(td.name || td.id || '')}`;
  if (k === 'mob') return `mob:${lc(td.id || '')}:${String(td.instanceId || '')}`;
  if (k === 'object') return `object:${lc(td.id || '')}`;
  return `${k}:${lc(td.name || td.id || '')}`;
}

function resolveActorFromTargetDescriptor(td) {
  if (!td || typeof td !== 'object') return null;

  const k = lc(td.kind || '');
  if (k === 'player') return player;

  if (k === 'npc') {
    const name = String(td.name || td.id || '');
    if (!name) return null;

    // Prefer party instance first; else world NPC
    const want = lc(name);
    for (const p of party) {
      if (p && lc(p.name) === want) return p;
    }
    for (const n of npcs) {
      if (n && lc(n.name) === want) return n;
    }
    return null;
  }

  if (k === 'mob') {
    const wantId = lc(td.id || '');
    const wantInst = String(td.instanceId || '');
    if (!wantId || !wantInst) return null;

    for (const m of mobs) {
      if (!m) continue;
      if (lc(m.id) === wantId && String(m.instanceId) === wantInst) return m;
    }
    return null;
  }

  return null;
}

function isActorUnconscious(a) {
  if (!a) return true;

  // If the actor has stamina/composure stats, use those (player + NPCs)
  const hasSt = (a?.stats && a.stats.stamina && a.stats.composure);
  if (hasSt) {
    const st = Number(a?.stats?.stamina?.current ?? 0);
    const co = Number(a?.stats?.composure?.current ?? 0);
    return (st <= 0) || (co <= 0);
  }

  // Otherwise, if it looks like a mob, use HP
  const hp = Number(a?.stats?.hp?.current ?? 0);
  if (isFinite(hp)) return (hp <= 0);


  // Unknown actor type: assume conscious
  return false;
}


function normalizeTargetKindList(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(x => lc(String(x || '').trim())).filter(Boolean);
}

function normalizeTargetingDef(def) {
  if (!def || typeof def !== 'object') return null;

  const remove = (def.remove && typeof def.remove === 'object') ? def.remove : Object.create(null);
  const action = (def.action && typeof def.action === 'object') ? def.action : Object.create(null);
  const onEmpty = (def.onEmpty && typeof def.onEmpty === 'object') ? def.onEmpty : Object.create(null);

  const sort = Array.isArray(def.sort) ? def.sort : (Array.isArray(def.prioritize) ? def.prioritize : []);
  const resort = (def.resort && typeof def.resort === 'object') ? def.resort : Object.create(null);

  let priority = normalizeTargetKindList(def.priority);
  let allowed = normalizeTargetKindList(def.allowed);
  let excluded = normalizeTargetKindList(def.excluded);
  if (priority.length && !allowed.length) allowed = [...priority];
  if (allowed.length && !priority.length) priority = [...allowed];

  const withinPx = Number(def.withinPx ?? def.rangePx ?? def.range ?? 0);

  return {
    priority,
    allowed,
    excluded,
    withinPx: (isFinite(withinPx) && withinPx > 0) ? withinPx : null,
    area: def.area || null,
    section: def.section || null,
    fixedTarget: lc(def.fixedTarget || ''),
    remove,
    sort,
    resort,
    action,
    onEmpty
  };
}

function getAbilityTargetingDef(ability) {
  if (!ability || typeof ability !== 'object') return null;
  return normalizeTargetingDef(ability.targeting || null);
}

function getAbilityRangePx(ability, tdef) {
  const raw =
    (tdef && tdef.withinPx != null && isFinite(tdef.withinPx)) ? tdef.withinPx
    : (tdef && (tdef.rangePx ?? tdef.range) != null) ? (tdef.rangePx ?? tdef.range)
    : (ability?.rangePx ?? ability?.range);
  const v = Number(raw);
  return (isFinite(v) && v > 0) ? v : null;
}

function getActorAutoCastRules(actor) {
  if (!actor) return null;
  const mode = String(actor.autoCastRulesMode || 'default').toLowerCase();
  if (mode === 'disabled') return [];
  if (mode === 'custom') return Array.isArray(actor.aiAutoCastRules) ? actor.aiAutoCastRules : [];
  // default
  if (Array.isArray(actor.aiAutoCastRulesDefault)) return actor.aiAutoCastRulesDefault;
  if (actor.def && actor.def.ai && Array.isArray(actor.def.ai.autoCastRules)) return actor.def.ai.autoCastRules;
  if (Array.isArray(actor.aiAutoCastRules)) return actor.aiAutoCastRules;
  return null;
}

function resolveActorAbilityById(actor, abilityId) {
  if (!actor || !abilityId) return null;
  const want = lc(abilityId);
  const list = Array.isArray(actor.abilities) ? actor.abilities : [];
  return list.find(a => a && lc(a.id || a.name || '') === want) || null;
}

function actorParamValue(actor, key) {
  if (!actor || !key) return undefined;
  const kind = getActorKind(actor);
  if (kind === 'mob') return getEffectiveMobParam(actor, key);
  return getEffectiveActorParam(actor, key);
}

function checkAutoCastRuleCondition(actor, rule, nowMs) {
  if (!actor || !rule) return false;
  const when = rule.when || rule.if || rule.condition || rule.cond || null;
  if (!when || typeof when !== 'object') return false;

  if (when.else === true) return true;

  if (when.actorParam && typeof when.actorParam === 'object') {
    const key = String(when.actorParam.key || when.actorParam.param || '');
    const op = lc(when.actorParam.op || when.actorParam.compare || 'eq');
    const want = when.actorParam.value;
    if (!key) return false;
    const actual = actorParamValue(actor, key);
    if (op === 'exists') return actual !== undefined;
    if (op === 'notexists') return actual === undefined;
    if (op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte') {
      const left = Number(actual);
      const right = Number(want);
      return numCompare(left, op, right);
    }
    if (op === 'neq') return actual !== want;
    return actual === want;
  }

  if (when.eligibleTargetWithinPx != null) {
    const withinPx = Number(when.eligibleTargetWithinPx ?? when.distancePx ?? when.withinPx ?? 0);
    if (!isFinite(withinPx) || withinPx <= 0) return false;

    const abId = String(rule.ability || rule.abilityId || '');
    if (!abId) return false;
    const ability = resolveActorAbilityById(actor, abId);
    if (!ability) return false;

    const tdef = getAbilityTargetingDef(ability);
    if (!tdef) return false;

    const candidates = __getTargetCandidates(actor, tdef, {
      priorityOnly: false,
      rangePx: withinPx
    });
    return candidates.length > 0;
  }

  function __getActorStatValueFromActor(a, statKey, field) {
    if (!a || !statKey) return null;
    const stat = lc(statKey);
    const f = lc(field || 'current');

    if (a === player) {
      const rec = player.stats?.[stat];
      if (!rec) return null;
      if (f === 'base' || f === 'max') return Number(rec.base ?? rec.max ?? 0);
      return Number(rec.current ?? rec.value ?? 0);
    }

    if (a.stats && typeof a.stats === 'object') {
      const rec = a.stats[stat];
      if (rec && typeof rec === 'object') {
        if (f === 'base' || f === 'max') return Number(rec.base ?? rec.max ?? 0);
        return Number(rec.current ?? rec.value ?? 0);
      }
      if (typeof rec === 'number') return Number(rec);
    }

    if (a.name) return getActorStatValue(a.name, stat, f);
    return null;
  }

  function __compareActorStat(a, cond) {
    if (!cond || typeof cond !== 'object') return false;
    const stat = cond.stat;
    const field = cond.field || 'current';
    const op = cond.op || cond.compare || 'eq';

    const left = __getActorStatValueFromActor(a, stat, field);
    if (!isFinite(left)) return false;

    let rhs = null;
    if (cond.rhs && typeof cond.rhs === 'object') {
      if (cond.rhs.field) {
        const rhsStat = cond.rhs.stat || stat;
        rhs = __getActorStatValueFromActor(a, rhsStat, cond.rhs.field);
      } else if ('value' in cond.rhs) {
        rhs = Number(cond.rhs.value);
      }
    } else if ('rhs' in cond) {
      rhs = Number(cond.rhs);
    } else if ('value' in cond) {
      rhs = Number(cond.value);
    }

    if (!isFinite(rhs)) return false;
    return numCompare(left, op, rhs);
  }

  function __getEligibleTargetsForAutoCast() {
    const abId = String(rule.ability || rule.abilityId || '');
    if (!abId) return null;
    const ability = resolveActorAbilityById(actor, abId);
    if (!ability) return null;

    const tdef = getAbilityTargetingDef(ability);
    if (!tdef) return null;

    const rangePx = getAbilityRangePx(ability, tdef);
    return __getTargetCandidates(actor, tdef, {
      priorityOnly: false,
      rangePx
    });
  }

  if (when.eligibleTargetInAbilityRangeStat && typeof when.eligibleTargetInAbilityRangeStat === 'object') {
    const candidates = __getEligibleTargetsForAutoCast();
    if (!candidates || candidates.length === 0) return false;
    return candidates.some(a => __compareActorStat(a, when.eligibleTargetInAbilityRangeStat));
  }

  if (when.allEligibleTargetsInAbilityRangeStat && typeof when.allEligibleTargetsInAbilityRangeStat === 'object') {
    const candidates = __getEligibleTargetsForAutoCast();
    if (!candidates || candidates.length === 0) return true;
    return candidates.every(a => __compareActorStat(a, when.allEligibleTargetsInAbilityRangeStat));
  }

  if (when.eligibleTargetInAbilityRange === true) {
    const abId = String(rule.ability || rule.abilityId || '');
    if (!abId) return false;
    const ability = resolveActorAbilityById(actor, abId);
    if (!ability) return false;

    const tdef = getAbilityTargetingDef(ability);
    if (!tdef) return false;

    const rangePx = getAbilityRangePx(ability, tdef);
    const candidates = __getTargetCandidates(actor, tdef, {
      priorityOnly: false,
      rangePx
    });
    return candidates.length > 0;
  }

  return false;
}

function applyAutoCastRules(actor, nowMs) {
  const rules = getActorAutoCastRules(actor);
  if (!Array.isArray(rules) || rules.length === 0) return null;

  const lockInfo = actor && actor.__autoCastLock;
  if (lockInfo && lockInfo.abilityId) {
    if (lockInfo.until && typeof lockInfo.until === 'object') {
      const shouldUnlock = checkAutoCastRuleCondition(actor, { when: lockInfo.until, ability: lockInfo.abilityId }, nowMs);
      if (shouldUnlock) {
        actor.__autoCastLock = null;
      } else {
        applyActorParam(actor, 'autoCastAbilityId', lockInfo.abilityId);
        return lockInfo.sortOverride || null;
      }
    } else {
      applyActorParam(actor, 'autoCastAbilityId', lockInfo.abilityId);
      return lockInfo.sortOverride || null;
    }
  }

  let matched = false;
  let sortOverride = null;
  let abilityId = null;
  let lockUntil = null;

  for (const rule of rules) {
    if (!rule) continue;
    const when = rule.when || rule.if || rule.condition || rule.cond || null;
    if (!when || typeof when !== 'object') continue;

    if (when.else === true) {
      if (matched) continue;
      abilityId = String(rule.ability || rule.abilityId || '');
      sortOverride = Array.isArray(rule.sort) ? rule.sort : null;
      lockUntil = rule.lockUntil || null;
      matched = true;
      break;
    }

    if (checkAutoCastRuleCondition(actor, rule, nowMs)) {
      abilityId = String(rule.ability || rule.abilityId || '');
      sortOverride = Array.isArray(rule.sort) ? rule.sort : null;
      lockUntil = rule.lockUntil || null;
      matched = true;
      break;
    }
  }

  if (!matched) return null;

  if (abilityId) {
    applyActorParam(actor, 'autoCastAbilityId', abilityId);
    if (lockUntil && typeof lockUntil === 'object') {
      actor.__autoCastLock = {
        abilityId,
        until: lockUntil,
        sortOverride
      };
    }
  }

  return sortOverride;
}

function __getSortStatValue(actor, statKeyRaw) {
  if (!actor) return null;
  const statKey = lc(statKeyRaw || '');
  if (!statKey) return null;

  const def = getStatDef(statKey);
  if (def) {
    if (def.type === 'depletable') {
      const v = Number(actor?.stats?.[statKey]?.current);
      if (isFinite(v)) return v;
    } else {
      const v = Number(getStatEffectiveValue(actor, statKey));
      if (isFinite(v)) return v;
    }
  } else {
    const v = Number(actor?.stats?.[statKey]?.current);
    if (isFinite(v)) return v;
  }

  // Mobs use HP; map stamina/composure to hp for sorting parity
  if ((statKey === 'stamina' || statKey === 'composure') && actor?.stats?.hp) {
    const hp = Number(actor?.stats?.hp?.current);
    if (isFinite(hp)) return hp;
  }

  return null;
}

function __compareWithSortRules(a, b, rules, src) {
  if (!Array.isArray(rules) || rules.length === 0) return 0;
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const by = lc(rule.by || '');
    if (!by) continue;

    let va = null;
    let vb = null;

    if (by === 'distance') {
      const ax = actorCenterX(a);
      const bx = actorCenterX(b);
      const sx = actorCenterX(src);
      va = Math.abs(ax - sx);
      vb = Math.abs(bx - sx);
    } else {
      va = __getSortStatValue(a, by);
      vb = __getSortStatValue(b, by);
    }

    const hasA = isFinite(va);
    const hasB = isFinite(vb);
    if (!hasA && !hasB) continue;
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;

    if (va === vb) continue;
    const order = lc(rule.order || 'asc');
    return order === 'desc' ? (vb - va) : (va - vb);
  }
  return 0;
}

function sortTargetsByKindPriority(candidates, tdef, actor, getKindFn = null) {
  if (!Array.isArray(candidates) || candidates.length <= 1) return candidates;
  const priority = Array.isArray(tdef?.priority) ? tdef.priority : [];
  const allowed = Array.isArray(tdef?.allowed) ? tdef.allowed : [];
  const prioritySet = new Set(priority.map(lc));
  const allowedSet = new Set(allowed.map(lc));

  let targetOrder = null;
  if (actor && Array.isArray(actor.attackTargetQueue) && actor.attackTargetQueue.length) {
    targetOrder = new Map();
    for (let i = 0; i < actor.attackTargetQueue.length; i++) {
      const k = targetKeyFromDescriptor(actor.attackTargetQueue[i]);
      if (k) targetOrder.set(k, i);
    }
  }

  candidates.sort((a, b) => {
    const ka = getKindFn ? getKindFn(a) : targetKindForActor(a);
    const kb = getKindFn ? getKindFn(b) : targetKindForActor(b);
    const aIsPriority = prioritySet.has(ka);
    const bIsPriority = prioritySet.has(kb);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    const sortCmp = __compareWithSortRules(a, b, tdef?.sort || null, actor);
    if (sortCmp !== 0) return sortCmp;

    // If both are in allowed but not priority, keep them below priority and sorted by rules.
    const aIsAllowed = allowedSet.has(ka);
    const bIsAllowed = allowedSet.has(kb);
    if (aIsAllowed !== bIsAllowed) return aIsAllowed ? -1 : 1;

    if (targetOrder) {
      const ta = targetKeyFromDescriptor(targetActorDescriptorFromActor(a));
      const tb = targetKeyFromDescriptor(targetActorDescriptorFromActor(b));
      const ia = targetOrder.has(ta) ? targetOrder.get(ta) : 9999;
      const ib = targetOrder.has(tb) ? targetOrder.get(tb) : 9999;
      if (ia !== ib) return ia - ib;
    }

    return 0;
  });

  return candidates;
}

function getActorTargetingRaw(actor, channel = 'attack') {
  if (!actor) return null;
  const wantMove = (lc(channel) === 'move' || lc(channel) === 'movement');

  // Mobs: targeting lives on def.ai
  if (actor.def && typeof actor.def === 'object') {
    const ai = actor.def.ai || null;
    if (!ai || typeof ai !== 'object') return null;
    if (wantMove) return ai.movementTargeting || ai.targeting || null;
    return ai.targeting || null;
  }

  // NPCs: targeting lives on runtime actor fields (from characters.json ai block)
  if (wantMove) return actor.aiMovementTargeting || actor.aiTargeting || null;
  return actor.aiTargeting || null;
}

function resolveActorAnchorWorldX(actor) {
  if (!actor) return 0;
  // If an actor has an anchor object, reuse the existing mob anchor resolver
  if (actor.anchor) return resolveMobAnchorWorldX(actor);
  return Number(actor.worldX) || 0;
}


function resolveMobAnchorWorldX(mob) {
  const a = mob?.anchor;
  if (!a) return Number(mob?.worldX) || 0;

  // Fixed worldX
  if (a.type === 'worldX') {
    const x = Number(a.x);
    return isFinite(x) ? x : (Number(mob?.worldX) || 0);
  }

  // GoalRef-like anchor (actor/object/section position)
  const gx = resolveGoalRefToWorldLeftX(mob, a);
  if (gx != null) return Number(gx);

  return Number(mob?.worldX) || 0;
}

function passesTargetingFilters(src, actor, tdef) {
  if (!src || !actor) return false;

  // Mobs should never add targets that are in safeplaces.
  // (NPC targeting must still be able to include safeplace actors.)
  if (src.def && actor._inSafeplace) return false;

  // area/section filters (optional)
  if (tdef?.area) {
    const wantArea = lc(tdef.area);
    if (wantArea !== 'currentarea' && wantArea !== lc(currentAreaName)) return false;
  }

  if (tdef?.section) {
    const actorSec = getSectionNameForX(actor.worldX);
    const wantRaw = lc(tdef.section);

    // Special scopes (source-relative)
    let wantSec = null;
    if (wantRaw === 'currentsection') {
      wantSec = getSectionNameForX(src.worldX);
    } else if (wantRaw === 'anchorsection') {
      const ax = resolveActorAnchorWorldX(src);
      wantSec = getSectionNameForX(ax);
    } else if (wantRaw === 'currentarea') {
      // no section restriction at all
      wantSec = null;
    } else {
      // literal section name
      wantSec = tdef.section;
    }

    if (wantSec != null && lc(actorSec) !== lc(wantSec)) return false;
  }

  // distance filter (optional)
  const withinPx = Number(tdef?.withinPx ?? 0);
  if (isFinite(withinPx) && withinPx > 0) {
    const dx = Math.abs(actorCenterX(actor) - actorCenterX(src));
    if (dx > withinPx) return false;
  }

  return true;
}


function shouldRemoveTarget(src, actor, remove, tdef) {
  if (!src || !actor) return true;

  // Mobs should always drop safeplace actors from their target lists.
  // (NPCs can still target safeplace actors for healing, etc.)
  if (src.def && actor._inSafeplace) return true;

  if (remove.unconscious) {
    if (isActorUnconscious(actor)) return true;
  }

  if (remove.leaveArea) {
    const srcArea = (src && src.area) ? String(src.area) : String(currentAreaName);
    const actorArea = (actor && actor.area) ? String(actor.area) : String(currentAreaName);
    if (srcArea && actorArea && srcArea !== actorArea) return true;
  }

  // If section is set, a common removal rule is "leave that section"
  if (remove.leaveSection && tdef && tdef.section) {
    const actorSec = getSectionNameForX(actor.worldX);
    const wantRaw = lc(tdef.section);

    let wantSec = null;
    if (wantRaw === 'currentsection') {
      wantSec = getSectionNameForX(src.worldX);
    } else if (wantRaw === 'anchorsection') {
      const ax = resolveActorAnchorWorldX(src);
      wantSec = getSectionNameForX(ax);
    } else if (wantRaw === 'currentarea') {
      wantSec = null; // no section restriction
    } else {
      wantSec = tdef.section; // literal section name
    }

    if (wantSec != null && lc(actorSec) !== lc(wantSec)) return true;
  }

  const maxDistancePx = Number(remove.maxDistancePx ?? remove.maxRangePx ?? 0);
  if (isFinite(maxDistancePx) && maxDistancePx > 0) {
    const dx = Math.abs(actorCenterX(actor) - actorCenterX(src));
    if (dx > maxDistancePx) return true;
  }

  return false;
}

function sortValueForRule(rule, src, actor) {
  if (!rule || typeof rule !== 'object') return 0;

  const by = lc(rule.by || rule.type || '');
  if (by === 'distance' || by === 'closest') {
    return Math.abs(actorCenterX(actor) - actorCenterX(src));
  }

  if (by === 'stat' || by === 'loweststat' || by === 'lowest_stat') {
    const statKey = lc(rule.stat || '');
    const v = Number(actor?.stats?.[statKey]?.current ?? 0);
    return v;
  }

  // Default: treat "by" as a stat key (e.g. "stamina")
  if (by) {
    const v = Number(actor?.stats?.[by]?.current ?? 0);
    return v;
  }

  if (by === 'lastdamager' || by === 'last_damager') {
    const k = targetKeyFromDescriptor(targetActorDescriptorFromActor(actor));
    return (src && src.__lastDamagedByKey && src.__lastDamagedByKey === k) ? -1 : 0;
  }

  return 0;
}

function compareBySortRules(sortRules, src, aActor, bActor) {
  for (const r of sortRules) {
    const dir = (r && (r.desc === true || lc(r.order) === 'desc')) ? -1 : 1;
    const av = sortValueForRule(r, src, aActor);
    const bv = sortValueForRule(r, src, bActor);
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
  }
  return 0;
}

function updateActorTargeting(actor, nowMs, channel = 'attack') {
  const tdefRaw = getActorTargetingRaw(actor, channel);
  const tdef = normalizeTargetingDef(tdefRaw);
  if (!tdef) return;

  const wantMove = (lc(channel) === 'move' || lc(channel) === 'movement');
  const queueKey = wantMove ? 'moveTargetQueue' : 'attackTargetQueue';
  const currentKeyKey = wantMove ? 'moveTargetCurrentKey' : 'attackTargetCurrentKey';
  const actorKey = wantMove ? '__moveTargetActor' : '__attackTargetActor';
  const stopRangeKey = wantMove ? '__moveStopRangePx' : '__attackStopRangePx';
  const resortAtKey = wantMove ? '__moveResortAtMs' : '__attackResortAtMs';
  const preferredKey = wantMove ? null : '__attackPreferredAbilityId';

  // Attack-only: allow auto-cast rules to override sort for this tick.
  let sortOverride = null;
  if (!wantMove) {
    sortOverride = applyAutoCastRules(actor, nowMs);
  }

  if (!Array.isArray(actor[queueKey])) actor[queueKey] = [];

  const remove = tdef.remove || Object.create(null);
  const coverList = __getCoverRectsForCurrentArea();

  // Candidate pool: player + party + world NPCs + mobs (all optional)
  const poolBuilt = __buildTargetPoolFromKinds(Array.from(new Set([...(tdef.priority || []), ...(tdef.allowed || [])])), actor);
  const pool = poolBuilt.pool;
  const relationMap = poolBuilt.relationMap;
  const kinds = Array.from(new Set([...(tdef.priority || []), ...(tdef.allowed || [])]));
  const hasKinds = kinds.length > 0;

  if (!hasKinds) {
    if (actor[queueKey].length) actor[queueKey].length = 0;
    actor[currentKeyKey] = null;
  }

  const prevKeys = new Set(actor[queueKey].map(targetKeyFromDescriptor));
  let changed = false;
  const getKind = (a) => {
    if (!a) return '';
    if (a === actor) return 'self';
    if (relationMap && relationMap.has(a)) return relationMap.get(a);
    return targetKindForActor(a);
  };

  // Add pass
  for (const a of pool) {
    if (!a) continue;
    if (tdef?.excluded && tdef.excluded.length) {
      const k = getKind(a);
      if (tdef.excluded.includes(k)) continue;
    }
    if (a !== actor && isTargetCovered(a, coverList)) continue;
    if (!passesTargetingFilters(actor, a, tdef)) continue;

    const td = targetActorDescriptorFromActor(a);
    const k = targetKeyFromDescriptor(td);
    if (!k || prevKeys.has(k)) continue;

    actor[queueKey].push(td);
    prevKeys.add(k);
    changed = true;
  }

  // Remove pass
  for (let i = actor[queueKey].length - 1; i >= 0; i--) {
    const td = actor[queueKey][i];
    const a = resolveActorFromTargetDescriptor(td);
    if (!a || (a !== actor && isTargetCovered(a, coverList)) || shouldRemoveTarget(actor, a, remove, tdef)) {
      actor[queueKey].splice(i, 1);
      changed = true;
    }
  }

  // Determine whether to resort
  const resortWhen = lc(tdef.resort?.when || 'drop'); // 'drop'|'onchange'|'interval'|'always'
  const everyMs = Math.max(50, Number(tdef.resort?.everyMs ?? tdef.resort?.ms ?? 0) || 0);

  const currentKey = String(actor[currentKeyKey] || '');
  const stillHasCurrent = currentKey && actor[queueKey].some(td => targetKeyFromDescriptor(td) === currentKey);

  let doResort = false;
  if (resortWhen === 'always') doResort = true;
  else if (resortWhen === 'onchange') doResort = changed;
  else if (resortWhen === 'interval') {
    if (!isFinite(actor[resortAtKey]) || actor[resortAtKey] <= 0) actor[resortAtKey] = nowMs;
    if (nowMs >= actor[resortAtKey]) {
      doResort = true;
      actor[resortAtKey] = nowMs + everyMs;
    }
  } else {
    // default 'drop': only when current disappears
    doResort = !stillHasCurrent;
  }

  // Resort + pick current
  if (doResort) {
    const sortRules = Array.isArray(sortOverride) ? sortOverride : (Array.isArray(tdef.sort) ? tdef.sort : []);
    if (sortRules.length) {
      actor[queueKey].sort((aTd, bTd) => {
        const aActor = resolveActorFromTargetDescriptor(aTd);
        const bActor = resolveActorFromTargetDescriptor(bTd);
        if (!aActor && !bActor) return 0;
        if (!aActor) return 1;
        if (!bActor) return -1;
        return compareBySortRules(sortRules, actor, aActor, bActor);
      });
    }

    const first = actor[queueKey].length ? actor[queueKey][0] : null;
    actor[currentKeyKey] = first ? targetKeyFromDescriptor(first) : null;
  }

  // Manual target hold (for auto-cast): keep forced target at the front (attack-only)
  if (!wantMove) {
    const forcedKey = String(actor.__forcedTargetKey || '');
    if (forcedKey) {
      const forcedAbility = lc(actor.__forcedTargetAbilityId || '');
      const autoId = lc(actor.autoCastAbilityId || '');

      if (!forcedAbility || forcedAbility !== autoId) {
        actor.__forcedTargetKey = null;
        actor.__forcedTargetAbilityId = null;
      } else {
        const idx = actor[queueKey].findIndex(td => targetKeyFromDescriptor(td) === forcedKey);
        if (idx >= 0) {
          const td = actor[queueKey].splice(idx, 1)[0];
          actor[queueKey].unshift(td);
          actor[currentKeyKey] = forcedKey;
        } else {
          actor.__forcedTargetKey = null;
          actor.__forcedTargetAbilityId = null;
        }
      }
    }
  }

  // Resolve current actor + derive action intent
  const curTd = actor[queueKey].length ? actor[queueKey][0] : null;
  const curActor = curTd ? resolveActorFromTargetDescriptor(curTd) : null;
  actor[actorKey] = curActor;

  // Action intent (movement channel only)
  if (curActor) {
    const action = tdef.action || Object.create(null);
    const stopRangePx = Number(action.stopRangePx ?? action.preferredRangePx ?? 0);
    actor[stopRangeKey] = (isFinite(stopRangePx) && stopRangePx > 0) ? stopRangePx : null;

    if (preferredKey) actor[preferredKey] = null;

    if (wantMove) {
      // Only force aiMode for non-following actors (party followers should not have their aiMode hijacked here)
      // NPCs default to NOT chasing unless explicitly enabled; mobs default to chasing.
      const chaseTarget = actor.def ? (action.chaseTarget !== false) : (action.chaseTarget === true);
      if (!actor.isFollowing && chaseTarget) actor.aiMode = 'moving';

      // Mobs: any active target cancels "return to anchor" state
      if (actor.def) actor.__returnToAnchor = false;
    }
  } else {
    actor[stopRangeKey] = null;
    if (preferredKey) actor[preferredKey] = null;

    if (!wantMove) return;

    const emptyType = lc(tdef.onEmpty?.type || 'idle');

    // Mobs: enforce onEmpty rules only for mobs (NPCs keep existing behavior)
    if (actor.def && !actor.isFollowing) {
      if ((emptyType === 'returntoanchor' || emptyType === 'return_to_anchor')) {
        const ax = resolveActorAnchorWorldX(actor);
        actor.__returnToAnchor = true;
        actor.aiMode = 'moving';
        actor.aiGoalX = Number(ax);
      } else {
        // No return-to-anchor: anchor resets to current position and wait
        actor.__returnToAnchor = false;
        actor.anchor = { type: 'worldX', x: Number(actor.worldX) };
        setNpcAiMode(actor, 'waiting', { anchorX: actor.worldX });
      }
      return;
    }

    // NPCs: keep existing behavior
    if ((emptyType === 'returntoanchor' || emptyType === 'return_to_anchor') && !actor.isFollowing) {
      const ax = resolveActorAnchorWorldX(actor);
      actor.aiMode = 'moving';
      actor.aiGoalX = Number(ax);
    }
  }
}

function getByDotPath(obj, path) {

  if (!obj || !path) return undefined;
  const parts = String(path).split('.').map(s => s.trim()).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function deleteByDotPath(obj, path) {
  if (!obj || !path) return false;
  const parts = String(path).split('.').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return false;

  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') return false;
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (!(last in cur)) return false;
  delete cur[last];
  return true;
}

function setByDotPath(obj, path, value) {
  if (!obj || !path) return false;
  const parts = String(path).split('.').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return false;

  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = Object.create(null);
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return true;
}

function normalizeActorSpec(s, payload) {
  if (!s || typeof s !== 'object') return null;

  let spec = null;
  const actorField = s.actor ?? s.target ?? s.subject;

  if (actorField && typeof actorField === 'object' && actorField.kind) {
    spec = { ...actorField };
  } else if (typeof actorField === 'string') {
    const v = lc(actorField);
    if (v === 'player') spec = { kind: 'player' };
    else if (v === '@target' || v === '@self') spec = { kind: v };
    else spec = { kind: 'npc', name: actorField };
  }

  if (!spec) {
    if (s.mob || s.mobId || s.id) {
      spec = { kind: 'mob', id: String(s.mob || s.mobId || s.id || '') };
    } else if (s.npc) {
      spec = { kind: 'npc', name: String(s.npc) };
    } else if (s.player) {
      spec = { kind: 'player' };
    }
  }

  if (spec && spec.kind && (spec.kind === 'mob' || spec.kind === 'npc')) {
    const inst = String(s.instanceId || s.instance || spec.instanceId || '');
    if (inst) spec.instanceId = inst;
  }

  if (spec && typeof spec.instanceId === 'string') {
    const v = lc(spec.instanceId);
    if (v === '@event' || v === '@payload') {
      spec.instanceId = String(payload?.mobInstanceId || '');
    }
  }

  return spec;
}

function resolveActorsFromSpec(spec, payload) {
  if (!spec) return [];

  const k = lc(spec.kind || '');

  if (k === '@target') {
    const td = payload?.targetActor;
    const a = td ? resolveActorFromTargetDescriptor(td) : null;
    return a ? [a] : [];
  }

  if (k === '@self') {
    const sd = payload?.sourceActor;
    const a = sd ? resolveActorFromTargetDescriptor(sd) : null;
    return a ? [a] : [];
  }

  if (k === 'player') return [player];

  if (k === 'npc') {
    const name = String(spec.name || spec.id || '').trim();
    if (!name) return [];
    const want = lc(name);
    const out = [];
    for (const p of party) if (p && lc(p.name) === want) out.push(p);
    for (const n of npcs) if (n && lc(n.name) === want) out.push(n);
    return out;
  }

  if (k === 'mob') {
    const wantId = lc(spec.id || '');
    const wantInst = String(spec.instanceId || '');
    const out = [];
    for (const m of mobs) {
      if (!m) continue;
      if (wantId && lc(m.id) !== wantId) continue;
      if (wantInst && String(m.instanceId) !== wantInst) continue;
      out.push(m);
    }
    return out;
  }

  return [];
}

function getEffectiveActorParam(actor, key) {
  if (!actor || !key) return undefined;
  const k = String(key);

  if (k === 'autoCastAbilityId') return actor.autoCastAbilityId;
  if (k === 'mode' || k === 'aiMode') return actor.aiMode;
  if (k === 'goalX' || k === 'aiGoalX') return actor.aiGoalX;

  // stat-style access (hp/stamina/composure/etc)
  if (actor.stats && actor.stats[k]) {
    const def = getStatDef(k);
    if (def && def.type === 'depletable') {
      return Number(actor.stats[k].current);
    }
    const v = getStatEffectiveValue(actor, k);
    if (isFinite(v)) return Number(v);
  }

  return getByDotPath(actor, k);
}

function getEffectiveMobParam(mob, key) {
  if (!mob || !key) return undefined;

  const k = String(key);

  // Direct fields (common, non-dot keys)
  if (k === 'mode' || k === 'aiMode') return mob.aiMode;
  if (k === 'goalX' || k === 'aiGoalX') return mob.aiGoalX;
  if (k === 'locomotionMode') return mob.locomotionMode;
  if (k === 'hp') return Number(mob?.stats?.hp?.current ?? 0);
  if (k === 'autoCastAbilityId') return mob.autoCastAbilityId;

  if (mob.stats && mob.stats[k]) {
    const def = getStatDef(k);
    if (def && def.type === 'depletable') {
      return Number(mob.stats[k].current);
    }
    const v = getStatEffectiveValue(mob, k);
    if (isFinite(v)) return Number(v);
  }

  // Override-first, then def
  const fromOverride = getByDotPath(mob.paramOverrides, k);
  if (fromOverride !== undefined) return fromOverride;

  return getByDotPath(mob.def, k);
}

function applyMobParam(mob, key, value) {
  if (!mob || !key) return false;

  const k = String(key);
  if (k === 'section' || k === 'sectionX') {
    if (!mob.sectionParams) mob.sectionParams = { section: null, sectionX: 0 };
    if (k === 'section') {
      mob.sectionParams.section = (value != null) ? String(value) : null;
      if (mob.sectionParams.sectionX == null) mob.sectionParams.sectionX = 0;
    } else {
      const n = Number(value);
      if (!isFinite(n)) return false;
      mob.sectionParams.sectionX = n;
    }

    const sec = mob.sectionParams.section;
    if (sec) {
      const startX = _sectionStartWorldXForArea(currentAreaName, sec);
      if (!isFinite(startX)) return false;
      const local = Number(mob.sectionParams.sectionX || 0);
      mob.worldX = startX + local;
      return true;
    }
  }

  if (k === 'autoCastRules') {
    if (value === 'default') {
      mob.autoCastRulesMode = 'default';
      return true;
    }
    if (value === 'disabled') {
      mob.autoCastRulesMode = 'disabled';
      mob.autoCastAbilityId = null;
      return true;
    }
    if (Array.isArray(value)) {
      mob.aiAutoCastRules = value;
      mob.autoCastRulesMode = 'custom';
      return true;
    }
    if (value && typeof value === 'object') {
      const mode = String(value.mode || value.state || 'custom').toLowerCase();
      if (mode === 'default') {
        mob.autoCastRulesMode = 'default';
        return true;
      }
      if (mode === 'disabled') {
        mob.autoCastRulesMode = 'disabled';
        mob.autoCastAbilityId = null;
        return true;
      }
      if (Array.isArray(value.rules)) {
        mob.aiAutoCastRules = value.rules;
      }
      mob.autoCastRulesMode = 'custom';
      return true;
    }
  }

  // Direct fields / behaviour hooks
  if (k === 'mode' || k === 'aiMode') {
    const mode = lc(value);
    if (mode === 'waiting' || mode === 'moving' || mode === 'stationary') {
      setNpcAiMode(mob, mode, {}); // reuse existing
      return true;
    }
    return false;
  }

  if (k === 'autoCastAbilityId') {
    if (value == null || value === false || (typeof value === 'string' && lc(value) === 'none')) {
      mob.autoCastAbilityId = null;
      return true;
    }

    const want = lc(String(value));
    const has = Array.isArray(mob.abilities) && mob.abilities.some(a => a && lc(a.id || a.name) === want);
    mob.autoCastAbilityId = has ? want : null;
    return true;
  }

  if (k === 'goalX' || k === 'aiGoalX') {
    const n = Number(value);
    if (!isFinite(n)) return false;
    mob.aiGoalX = n;
    return true;
  }

  // ===== Anchor / targeting controls =====

  if (k === 'anchorX') {
    const n = Number(value);
    if (!isFinite(n)) return false;
    mob.anchor = { type: 'worldX', x: n };
    return true;
  }

  if (k === 'anchor') {
    // Accept either {type:'worldX',x:...} OR a goalRef-like object (actor/object/section pos)
    if (!value || typeof value !== 'object') return false;
    mob.anchor = value;
    return true;
  }

  if (k === 'targetClear') {
    mob.attackTargetQueue = [];
    mob.attackTargetCurrentKey = null;
    mob.__attackTargetActor = null;
    mob.__attackStopRangePx = null;
    mob.__attackPreferredAbilityId = null;

    mob.moveTargetQueue = [];
    mob.moveTargetCurrentKey = null;
    mob.__moveTargetActor = null;
    mob.__moveStopRangePx = null;
    return true;
  }

  if (k === 'targetAdd') {
    // Accept: 'player' | 'Rowyn' | {kind:'npc',name:'Rowyn'} | {kind:'player'} | {kind:'mob',id:'...',instanceId:'...'}
    let td = null;

    if (typeof value === 'string') {
      const s = lc(value);
      if (s === 'player') td = { kind: 'player' };
      else td = { kind: 'npc', name: String(value) };
    } else if (value && typeof value === 'object') {
      const kk = lc(value.kind || '');
      if (kk === 'player') td = { kind: 'player' };
      else if (kk === 'npc') td = { kind: 'npc', name: String(value.name || value.id || '') };
      else if (kk === 'mob') td = { kind: 'mob', id: String(value.id || ''), instanceId: String(value.instanceId || '') };
    }

    if (!td) return false;
    if (!Array.isArray(mob.attackTargetQueue)) mob.attackTargetQueue = [];

    const k2 = targetKeyFromDescriptor(td);
    if (!k2) return false;

    // No duplicates
    for (const ex of mob.attackTargetQueue) {
      if (targetKeyFromDescriptor(ex) === k2) return true;
    }

    mob.attackTargetQueue.push(td);
    return true;
  }

  if (k === 'targetRemove') {
    let td = null;

    if (typeof value === 'string') {
      const s = lc(value);
      if (s === 'player') td = { kind: 'player' };
      else td = { kind: 'npc', name: String(value) };
    } else if (value && typeof value === 'object') {
      const kk = lc(value.kind || '');
      if (kk === 'player') td = { kind: 'player' };
      else if (kk === 'npc') td = { kind: 'npc', name: String(value.name || value.id || '') };
    }

    if (!td || !Array.isArray(mob.attackTargetQueue)) return false;
    const k2 = targetKeyFromDescriptor(td);
    if (!k2) return false;

    for (let i = mob.attackTargetQueue.length - 1; i >= 0; i--) {
      if (targetKeyFromDescriptor(mob.attackTargetQueue[i]) === k2) {
        mob.attackTargetQueue.splice(i, 1);
      }
    }
    return true;
  }


  if (k === 'locomotionMode') {
    const mode = lc(value);
    if (!mode) return false;
    mob.locomotionMode = mode;
    mob.onGround = (mode !== 'hover' && mode !== 'fly');
    return true;
  }

  if (k === 'hp') {
    const n = Number(value);
    if (!isFinite(n)) return false;

    const prevHp = Number(mob?.stats?.hp?.current ?? 0);

    mob.stats.hp.current = Math.max(0, n);
    if (isFinite(mob.stats.hp.max)) {
      mob.stats.hp.current = Math.min(mob.stats.hp.current, Number(mob.stats.hp.max));
    }

    const nextHp = Number(mob?.stats?.hp?.current ?? 0);
    if (isFinite(prevHp) && isFinite(nextHp) && prevHp !== nextHp) {
      noteMobHpChanged(mob, prevHp, nextHp);
    }

    handleMobDefeatIfNeeded(mob, { reason: 'setHp' });
    return true;
  }

  // Generic override (dot paths encouraged, e.g. "ai.waiting.speedPxPerSec")
  if (!mob.paramOverrides) mob.paramOverrides = Object.create(null);
  return setByDotPath(mob.paramOverrides, k, value);
}

function applyActorParam(actor, key, value) {
  if (!actor || !key) return false;
  const kind = getActorKind(actor);
  if (!kind) return false;

  if (kind === 'mob') return applyMobParam(actor, key, value);

  const k = String(key);
  if (k === 'section' || k === 'sectionX') {
    if (!actor.sectionParams) actor.sectionParams = { section: null, sectionX: 0 };
    if (k === 'section') {
      actor.sectionParams.section = (value != null) ? String(value) : null;
      if (actor.sectionParams.sectionX == null) actor.sectionParams.sectionX = 0;
    } else {
      const n = Number(value);
      if (!isFinite(n)) return false;
      actor.sectionParams.sectionX = n;
    }

    const sec = actor.sectionParams.section;
    if (sec) {
      const startX = _sectionStartWorldXForArea(currentAreaName, sec);
      if (!isFinite(startX)) return false;
      const local = Number(actor.sectionParams.sectionX || 0);
      const worldX = startX + local;
      actor.worldX = worldX;
      const rec = ensureNpcRecord(actor.name);
      rec.area = actor.area || currentAreaName || rec.area;
      rec.worldX = actor.worldX;
      return true;
    }
  }

  if (k === 'autoCastRules') {
    if (value === 'default') {
      actor.autoCastRulesMode = 'default';
      return true;
    }
    if (value === 'disabled') {
      actor.autoCastRulesMode = 'disabled';
      actor.autoCastAbilityId = null;
      return true;
    }
    if (Array.isArray(value)) {
      actor.aiAutoCastRules = value;
      actor.autoCastRulesMode = 'custom';
      return true;
    }
    if (value && typeof value === 'object') {
      const mode = String(value.mode || value.state || 'custom').toLowerCase();
      if (mode === 'default') {
        actor.autoCastRulesMode = 'default';
        return true;
      }
      if (mode === 'disabled') {
        actor.autoCastRulesMode = 'disabled';
        actor.autoCastAbilityId = null;
        return true;
      }
      if (Array.isArray(value.rules)) {
        actor.aiAutoCastRules = value.rules;
      }
      actor.autoCastRulesMode = 'custom';
      return true;
    }
  }

  if (k === 'autoCastAbilityId') {
    if (value == null || value === false || (typeof value === 'string' && lc(value) === 'none')) {
      actor.autoCastAbilityId = null;
      return true;
    }

    const want = lc(String(value));
    const has = Array.isArray(actor.abilities) && actor.abilities.some(a => a && lc(a.id || a.name) === want);
    actor.autoCastAbilityId = has ? want : null;
    return true;
  }

  if (k === 'mode' || k === 'aiMode') {
    if (kind !== 'npc') return false;
    const mode = lc(value);
    if (mode === 'waiting' || mode === 'moving' || mode === 'stationary') {
      setNpcAiMode(actor, mode, {});
      return true;
    }
    return false;
  }

  if (k === 'goalX' || k === 'aiGoalX') {
    if (kind !== 'npc') return false;
    const n = Number(value);
    if (!isFinite(n)) return false;
    actor.aiGoalX = n;
    return true;
  }

  if (k === 'anchorX') {
    if (kind !== 'npc') return false;
    const n = Number(value);
    if (!isFinite(n)) return false;
    setNpcAiMode(actor, 'waiting', { anchorX: n });
    return true;
  }

  if (k === 'targetClear') {
    if (!Array.isArray(actor.attackTargetQueue)) return false;
    actor.attackTargetQueue = [];
    actor.attackTargetCurrentKey = null;
    actor.__attackTargetActor = null;
    actor.__attackStopRangePx = null;
    actor.__attackPreferredAbilityId = null;

    actor.moveTargetQueue = [];
    actor.moveTargetCurrentKey = null;
    actor.__moveTargetActor = null;
    actor.__moveStopRangePx = null;
    return true;
  }

  if (k === 'targetAdd') {
    if (!Array.isArray(actor.attackTargetQueue)) return false;
    let td = null;

    if (typeof value === 'string') {
      const s = lc(value);
      if (s === 'player') td = { kind: 'player' };
      else td = { kind: 'npc', name: String(value) };
    } else if (value && typeof value === 'object') {
      const kk = lc(value.kind || '');
      if (kk === 'player') td = { kind: 'player' };
      else if (kk === 'npc') td = { kind: 'npc', name: String(value.name || value.id || '') };
      else if (kk === 'mob') td = { kind: 'mob', id: String(value.id || ''), instanceId: String(value.instanceId || '') };
    }

    if (!td) return false;
    const k2 = targetKeyFromDescriptor(td);
    if (!k2) return false;

    for (const ex of actor.attackTargetQueue) {
      if (targetKeyFromDescriptor(ex) === k2) return true;
    }

    actor.attackTargetQueue.push(td);
    return true;
  }

  if (k === 'targetRemove') {
    if (!Array.isArray(actor.attackTargetQueue)) return false;
    let td = null;

    if (typeof value === 'string') {
      const s = lc(value);
      if (s === 'player') td = { kind: 'player' };
      else td = { kind: 'npc', name: String(value) };
    } else if (value && typeof value === 'object') {
      const kk = lc(value.kind || '');
      if (kk === 'player') td = { kind: 'player' };
      else if (kk === 'npc') td = { kind: 'npc', name: String(value.name || value.id || '') };
    }

    if (!td) return false;
    const k2 = targetKeyFromDescriptor(td);
    if (!k2) return false;

    for (let i = actor.attackTargetQueue.length - 1; i >= 0; i--) {
      if (targetKeyFromDescriptor(actor.attackTargetQueue[i]) === k2) {
        actor.attackTargetQueue.splice(i, 1);
      }
    }
    return true;
  }

  const ok = setByDotPath(actor, k, value);
  if (ok && kind === 'npc') {
    const rec = ensureNpcRecord(actor.name);
    if ((k === 'worldX' || k === 'area') && !actor.area) {
      actor.area = currentAreaName;
    }
    if (k === 'worldX' || k === 'area') {
      rec.area = actor.area || currentAreaName || rec.area;
      if (typeof actor.worldX === 'number') rec.worldX = actor.worldX;
    }
  }
  return ok;
}

function applyMobLocomotionY(mob, dt, nowMs = null) {
  if (!mob) return;

  const def = mob.def || mobDetails?.[lc(mob.id)] || null;

  // Allow rules to override locomotion mode via setActorParam:
  //   { "type":"setActorParam","actor":{kind:"mob",id:"x"},"key":"locomotionMode","value":"hover" }
  // Or via dot path:
  //   { "type":"setActorParam","actor":{kind:"mob",id:"x"},"key":"locomotion.mode","value":"hover" }
  let mode = lc(getEffectiveMobParam(mob, 'locomotion.mode') ?? getEffectiveMobParam(mob, 'locomotionMode') ?? mob.locomotionMode ?? def?.locomotion?.mode ?? 'ground');
  if (!mode) mode = 'ground';

  const yGround = groundY - mob.h - 8;
  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);

  if (!isFinite(mob._bobSeed)) mob._bobSeed = Math.random() * 100000;

  if (mode === 'hover' || mode === 'fly') {
    mob.onGround = false;

    const heightPx = Number(getEffectiveMobParam(mob, 'locomotion.heightPx') ?? def?.locomotion?.heightPx ?? (mode === 'hover' ? 18 : 60));
    const bobAmpPx = Number(getEffectiveMobParam(mob, 'locomotion.bobAmpPx') ?? def?.locomotion?.bobAmpPx ?? (mode === 'hover' ? 4 : 6));
    const bobPeriodMs = Number(getEffectiveMobParam(mob, 'locomotion.bobPeriodMs') ?? def?.locomotion?.bobPeriodMs ?? (mode === 'hover' ? 1800 : 2400));

    const H = (isFinite(heightPx) ? heightPx : (mode === 'hover' ? 18 : 60));
    const A = (isFinite(bobAmpPx) ? bobAmpPx : (mode === 'hover' ? 4 : 6));
    const P = Math.max(250, isFinite(bobPeriodMs) ? bobPeriodMs : (mode === 'hover' ? 1800 : 2400));

    const phase = ((now + mob._bobSeed) % P) / P * Math.PI * 2;
    mob.y = yGround - H + Math.sin(phase) * A;

    // Keep a sane vy for anything that might read it later
    mob.vy = 0;
    mob.locomotionMode = mode;
    return;
  }

  if (mode === 'burrow') {
    // Burrowed mobs sit “under” the ground line (partially hidden)
    mob.onGround = true;

    const depthPx = Number(getEffectiveMobParam(mob, 'locomotion.depthPx') ?? def?.locomotion?.depthPx);
    const D = (isFinite(depthPx) ? depthPx : Math.floor(mob.h * 0.65));

    mob.y = yGround + Math.max(1, D);
    mob.vy = 0;
    mob.locomotionMode = mode;
    return;
  }

  // ground default
  mob.onGround = true;
  mob.y = yGround;
  mob.vy = 0;
  mob.locomotionMode = 'ground';
}


function updateWorldMobAutonomy(mob, dt, activeObjectBlockers, nowMs) {
  if (!mob) return;
  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);

  // Freeze while despawning (lets animation render cleanly)
  if (mob._removeAtMs) {
    mob.vx = 0;
    mob.vy = 0;
    return;
  }


  // Freeze autonomous movement only when world time is frozen
  const worldLocked = shouldFreezeWorldTime();
  if (worldLocked) {
    mob.vx = 0;
    mob.vy = 0;
    return;
  }

  // Stop-moving lock (abilities/attacks)
  {
    const until = Number(mob.__stopMoveUntilMs || 0);
    if (isFinite(until) && until > now) {
      mob.vx = 0;
      mob.vy = 0;
      applyMobLocomotionY(mob, dt, now);
      return;
    }
  }

  // Targeting update (attack + movement)
  {
    updateActorTargeting(mob, now, 'attack');
    updateActorTargeting(mob, now, 'move');

    // If the chosen movement target is in a safeplace, instantly clear it (safeplace actors are untargetable)
    const t = mob.__moveTargetActor || null;
    if (t && t._inSafeplace) {
      mob.attackTargetQueue = [];
      mob.attackTargetCurrentKey = null;
      mob.__attackTargetActor = null;
      mob.__attackStopRangePx = null;
      mob.__attackPreferredAbilityId = null;

      mob.moveTargetQueue = [];
      mob.moveTargetCurrentKey = null;
      mob.__moveTargetActor = null;
      mob.__moveStopRangePx = null;

      // Stop chasing this tick
      mob.aiGoalX = null;
      mob.vx = 0;
    }
  }


  const cfg = getMobAiConfig(mob);
  const mode = lc(mob.aiMode || 'stationary');


  if (mode === 'stationary') {
    mob.vx *= Math.pow(friction, dt * 60);
    if (Math.abs(mob.vx) < 0.05) mob.vx = 0;
    applyMobLocomotionY(mob, dt);
    return;
  }

  if (mode === 'waiting') {

    if (!isFinite(mob.aiAnchorX)) mob.aiAnchorX = mob.worldX;
    if (!mob.aiPhase) mob.aiPhase = 'idle';

    if (mob.aiPhase === 'idle') {
      if (!isFinite(mob.aiNextDecisionAtMs)) mob.aiNextDecisionAtMs = now;

      if (now >= mob.aiNextDecisionAtMs) {
        // reuse same “waiting target” chooser used by NPCs
        mob.aiMoveTargetX = chooseWaitingTargetX(mob, cfg);
        mob.aiPhase = 'move';
      } else {
        mob.vx *= Math.pow(friction, dt * 60);
        if (Math.abs(mob.vx) < 0.05) mob.vx = 0;
        applyMobLocomotionY(mob, dt, now);
        return;
      }
    }

    if (mob.aiPhase === 'move') {
      const targetX = Number(mob.aiMoveTargetX);
      const spd = Number(cfg.waiting.speedPxPerSec) || MOB_AI_DEFAULTS.waiting.speedPxPerSec;

      if (!isFinite(targetX) || !isFinite(spd) || spd <= 0) {
        mob.aiPhase = 'idle';
        mob.aiNextDecisionAtMs = now + (Number(cfg.waiting.avgIdleMs) || 600);
        mob.vx = 0;
        applyMobLocomotionY(mob, dt, now);
        return;
      }

      const prevX = mob.worldX;
      const dx = targetX - mob.worldX;
      const step = Math.sign(dx) * spd * dt;

      if (Math.abs(step) >= Math.abs(dx)) {
        mob.worldX = targetX;
        mob.vx = 0;
        mob.aiPhase = 'idle';

        const avgIdle = Math.max(150, Number(cfg.waiting.avgIdleMs) || 700);
        const jitter = (Math.random() * 2 - 1) * (avgIdle * 0.35);
        mob.aiNextDecisionAtMs = now + (avgIdle + jitter);
        mob.aiMoveTargetX = null;
      } else {
        mob.worldX += step;
        mob.vx = step / dt;
        // Facing resolved centrally after movement updates.
        mob.lastMoveTime = now;
        mob.hasEverMoved = true;
      }

      mob.worldX = Math.max(2, Math.min(currentArea.lengthPx - mob.w - 2, mob.worldX));
      resolveActorVsBlockers(mob, prevX, activeObjectBlockers);
      mob.worldX = Math.max(2, Math.min(currentArea.lengthPx - mob.w - 2, mob.worldX));

      applyMobLocomotionY(mob, dt, now);
      return;


    }
  }

  if (mode === 'moving') {
    // Dynamic targeting goal: chase the current target actor (if present)
    let goalX = Number(mob.aiGoalX);
    let stopRangePx = Number(mob.__moveStopRangePx);

    if (mob.__moveTargetActor) {
      const a = mob.__moveTargetActor;
      goalX = actorCenterX(a) - (Number(mob.w) || 0) * 0.5;
      if (!isFinite(stopRangePx) || stopRangePx <= 0) stopRangePx = 0;
    } else {
      stopRangePx = 0;
    }

    const spd = Number(cfg.moving.speedPxPerSec) || MOB_AI_DEFAULTS.moving.speedPxPerSec;

    if (!isFinite(goalX) || !isFinite(spd) || spd <= 0) {
      mob.vx = 0;
      applyMobLocomotionY(mob, dt, now);
      return;
    }

    const prevX = mob.worldX;
    const dx = goalX - mob.worldX;

    // If we are close enough (stop range), do not drift into the target
    if (isFinite(stopRangePx) && stopRangePx > 0 && Math.abs(dx) <= stopRangePx) {
      mob.vx = 0;
      // Facing resolved centrally after movement updates.

      // If this was a "return to anchor" move and we have no target, switch to waiting at anchor
      if (mob.__returnToAnchor) {
        const ax = resolveActorAnchorWorldX(mob);
        mob.__returnToAnchor = false;
        setNpcAiMode(mob, 'waiting', { anchorX: ax });
      }

      applyMobLocomotionY(mob, dt, now);
      return;
    }

    const step = Math.sign(dx) * spd * dt;

    if (Math.abs(step) >= Math.abs(dx)) {
      mob.worldX = goalX;
      mob.vx = 0;
    } else {
      mob.worldX += step;
      mob.vx = step / dt;
      // Facing resolved centrally after movement updates.
      mob.lastMoveTime = now;
      mob.hasEverMoved = true;
    }

    mob.worldX = Math.max(2, Math.min(currentArea.lengthPx - mob.w - 2, mob.worldX));
    resolveActorVsBlockers(mob, prevX, activeObjectBlockers);
    mob.worldX = Math.max(2, Math.min(currentArea.lengthPx - mob.w - 2, mob.worldX));

    applyMobLocomotionY(mob, dt, now);
    return;


  }
}


// ===== NPC handling (kept compatible) =====
const npcPalettes = [
  { hat: '#5a3a22', hatBand: '#c68b59', face: '#eac9a7', shirt: '#4b7094', pants: '#2f3d4e', boots: '#503d2c' },
  { hat: '#2a434c', hatBand: '#89654b', face: '#f1d0b2', shirt: '#3d8b6e', pants: '#413a5a', boots: '#362d22' },
  { hat: '#483662', hatBand: '#b288b2', face: '#e9c89c', shirt: '#6c5b7b', pants: '#2e3647', boots: '#44312b' },
  { hat: '#4d4028', hatBand: '#a77948', face: '#e7c399', shirt: '#7a893f', pants: '#2c4151', boots: '#473e2c' }
];



function createNpc(name, worldX) {
  const spriteEntry = npcSprites[name];
  const sprite = spriteEntry ? spriteEntry.img : null;
  const w = player.w;
  const h = player.h;
  const y = groundY - h - 8;
  const palette = npcPalettes[Math.floor(Math.random() * npcPalettes.length)];

  // Ensure registry record exists and provides the canonical stats object
  const rec = ensureNpcRecord(name);
  const stats = ensureNpcStatsShared(name) || rec.stats;

  const details = npcDetails && npcDetails[name] ? npcDetails[name] : null;
  const innateAbilities = resolveAbilityList(details?.abilities);
  const aiConfig = (details?.ai && typeof details.ai === 'object') ? details.ai : null;
  const aiTargeting = (rec.aiTargeting && typeof rec.aiTargeting === 'object')
    ? JSON.parse(JSON.stringify(rec.aiTargeting))
    : ((aiConfig?.targeting && typeof aiConfig.targeting === 'object') ? { ...aiConfig.targeting } : null);
  const aiMovementTargeting = (rec.aiMovementTargeting && typeof rec.aiMovementTargeting === 'object')
    ? JSON.parse(JSON.stringify(rec.aiMovementTargeting))
    : ((aiConfig?.movementTargeting && typeof aiConfig.movementTargeting === 'object')
      ? { ...aiConfig.movementTargeting }
      : null);
  const aiAutoCastRules = Array.isArray(rec.aiAutoCastRules)
    ? JSON.parse(JSON.stringify(rec.aiAutoCastRules))
    : (Array.isArray(aiConfig?.autoCastRules) ? aiConfig.autoCastRules.slice() : null);
  const inventorySize = (details?.inventorySize != null && isFinite(Number(details.inventorySize)))
    ? Math.max(0, Math.floor(Number(details.inventorySize)))
    : 0;
  if (!Array.isArray(rec.learnedAbilities)) rec.learnedAbilities = [];
  const learnedAbilities = rec.learnedAbilities;

  // Auto-cast defaults are now per-actor only
  let autoCastAbilityId = null;
  if (Object.prototype.hasOwnProperty.call(rec, 'autoCastAbilityId')) {
    autoCastAbilityId = rec.autoCastAbilityId;
  }

  const base = buildActorRuntimeBase({
    worldX,
    y,
    w,
    h,
    onGround: true,
    stats,
    innateAbilities,
    learnedAbilities,
    autoCastAbilityId,
    factions: Array.isArray(rec.factions) ? rec.factions : details?.factions,
    allianceByFaction: (rec.allianceByFaction && typeof rec.allianceByFaction === 'object')
      ? rec.allianceByFaction
      : details?.allianceByFaction,
    allianceByInstance: (rec.allianceByInstance && typeof rec.allianceByInstance === 'object')
      ? rec.allianceByInstance
      : details?.allianceByInstance
  });

  const actor = {
    worldX, y, w, h, name, sprite, palette,
    facing: 1, // 1 = right, -1 = left
    isFollowing: false,
    // logical interaction radius (gameplay only)
    interactionRadius: null,

    aiTargeting,
    aiMovementTargeting,
    aiAutoCastRules,
    inventory: rec.inventory || Object.create(null),
    inventoryUidCounter: rec.inventoryUidCounter || 1,
    inventorySize,

    // ===== AI (world NPCs) =====
    aiMode: 'stationary',     // 'stationary' | 'waiting' | 'moving'
    aiAnchorX: null,          // waiting anchor
    aiGoalX: null,            // moving goal
    aiPhase: 'idle',          // waiting internal phase
    aiNextDecisionAtMs: null, // waiting timer
    aiMoveTargetX: null       // waiting current short-walk target
  };
  Object.assign(actor, base);

  bindNpcPersistentFields(actor, rec);

  // Restore persisted AI runtime state if available
  if (rec.aiMode != null) actor.aiMode = rec.aiMode;
  if (rec.aiGoalX != null) actor.aiGoalX = rec.aiGoalX;
  if (rec.aiGoalRef != null) actor.aiGoalRef = rec.aiGoalRef;
  if (rec.aiAnchorX != null) actor.aiAnchorX = rec.aiAnchorX;
  if (rec.aiNextDecisionAtMs != null) actor.aiNextDecisionAtMs = rec.aiNextDecisionAtMs;
  if (rec.aiPhase != null) actor.aiPhase = rec.aiPhase;
  if (rec.aiMoveTargetX != null) actor.aiMoveTargetX = rec.aiMoveTargetX;

  rebuildActorItemGrants(actor);
  return actor;
}

function spawnNpc(name, atX) {
  // Choose name if blank, but only from those not already in party or world
  if (!name || name === "") {
    const pool = npcNameList.filter(n => !isNpcInPartyByName(n) && !isNpcInWorldByName(n));
    if (pool.length === 0) return; // nothing valid to spawn
    const elementNumber = Math.floor(Math.random() * pool.length);
    name = pool[elementNumber];
  } else {
    // If a specific name is requested, bail if it's already present or in party
    if (isNpcInPartyByName(name) || isNpcInWorldByName(name)) return;
  }

  const npc = createNpc(name, atX);
  npcs.push(npc);

  // Keep registry location in sync so npcInArea/npcInSection can work reliably
  const rec = ensureNpcRecord(name);
  rec.inParty = false;
  rec.area = currentAreaName;
  rec.worldX = npc.worldX;

  // play spawn anim briefly
  setActorTempAnim(npc, 'spawn', 520);

  loadDialogFor(name);


}

function snapshotNPCsToRegistry() {
  // world NPCs
  for (const n of npcs) {
    const rec = ensureNpcRecord(n.name);
    rec.inParty = false;
    rec.area = currentAreaName;
    rec.worldX = Math.max(2, Math.min(currentArea.lengthPx - n.w - 2, n.worldX));
    // persistent fields are registry-backed via bindNpcPersistentFields
    rec.stats = n.stats || rec.stats;
    rec.inventory = n.inventory || rec.inventory;
    rec.inventoryUidCounter = n.inventoryUidCounter || rec.inventoryUidCounter;
    ensureNpcRecordStats(n.name, rec);
  }
  // party NPCs
  for (const p of party) {
    const rec = ensureNpcRecord(p.name);
    rec.inParty = true;
    rec.area = p.area ?? rec.area ?? null;
    if (typeof p.worldX === 'number') rec.worldX = p.worldX;
    // persistent fields are registry-backed via bindNpcPersistentFields
    rec.stats = p.stats || rec.stats;
    rec.inventory = p.inventory || rec.inventory;
    rec.inventoryUidCounter = p.inventoryUidCounter || rec.inventoryUidCounter;
    ensureNpcRecordStats(p.name, rec);
  }

}

function snapshotMobsToRegistry(opts = null) {
  const stripPlayerTargets = !!(opts && opts.stripPlayerTargets);

  for (const m of mobs) {
    if (!m || !m.instanceId) continue;
    if (m._despawning) continue;

    const key = String(m.instanceId);
    const rec = mobRegistry[key] || (mobRegistry[key] = Object.create(null));

    rec.instanceId = key;
    rec.area = currentAreaName;
    rec.mobId = m.id;

    rec.alive = true;

    // kinematics
    rec.worldX = Number(m.worldX) || 0;
    rec.y = Number(m.y) || 0;
    rec.vx = Number(m.vx) || 0;
    rec.vy = Number(m.vy) || 0;
    rec.facing = (Number(m.facing) === -1) ? -1 : 1;
    rec.onGround = !!m.onGround;

    // Persistent fields are registry-backed via bindMobPersistentFields
    rec.aiMode = m.aiMode || rec.aiMode || 'stationary';
    rec.aiAnchorX = (m.aiAnchorX !== undefined) ? m.aiAnchorX : rec.aiAnchorX;
    rec.aiGoalX = (m.aiGoalX !== undefined) ? m.aiGoalX : rec.aiGoalX;
    rec.aiPhase = (m.aiPhase !== undefined) ? m.aiPhase : rec.aiPhase;
    rec.aiNextDecisionAtMs = (m.aiNextDecisionAtMs !== undefined) ? m.aiNextDecisionAtMs : rec.aiNextDecisionAtMs;
    rec.aiMoveTargetX = (m.aiMoveTargetX !== undefined) ? m.aiMoveTargetX : rec.aiMoveTargetX;

    if (m.anchor && typeof m.anchor === 'object') rec.anchor = m.anchor;
    rec.tags = Array.isArray(m.tags) ? m.tags : rec.tags;
    rec.attackTargetQueue = Array.isArray(m.attackTargetQueue) ? m.attackTargetQueue : rec.attackTargetQueue;
    rec.attackTargetCurrentKey = (m.attackTargetCurrentKey !== undefined) ? m.attackTargetCurrentKey : (rec.attackTargetCurrentKey ?? null);
    rec.moveTargetQueue = Array.isArray(m.moveTargetQueue) ? m.moveTargetQueue : rec.moveTargetQueue;
    rec.moveTargetCurrentKey = (m.moveTargetCurrentKey !== undefined) ? m.moveTargetCurrentKey : (rec.moveTargetCurrentKey ?? null);
    rec.stats = m.stats || rec.stats;

    // If we’re leaving this area, player must be removed from targets (but NPCs like Rowyn stay)
    if (stripPlayerTargets && Array.isArray(rec.attackTargetQueue) && rec.attackTargetQueue.length) {
      rec.attackTargetQueue = rec.attackTargetQueue.filter(t => lc(t?.kind || '') !== 'player');
      if (lc(rec.attackTargetCurrentKey || '') === 'player') rec.attackTargetCurrentKey = null;
    }
    if (stripPlayerTargets && Array.isArray(rec.moveTargetQueue) && rec.moveTargetQueue.length) {
      rec.moveTargetQueue = rec.moveTargetQueue.filter(t => lc(t?.kind || '') !== 'player');
      if (lc(rec.moveTargetCurrentKey || '') === 'player') rec.moveTargetCurrentKey = null;
    }
  }
}


resizeCanvas();
window.addEventListener('resize', resizeCanvas);
window.addEventListener('resize', () => {
  if (inMenu && playerMenuContent) syncAbilityCardPortraits(playerMenuContent);
});

// ===== Init =====
async function initGame() {
  // Ensure canvas fonts are loaded before first render loop
  if (document?.fonts?.load) {
    try { await document.fonts.load('16px "Parchment MF"'); } catch {}
  }

  // ===== Player sprite preload (NPC-style) =====
  playerSprites.idle.src = 'assets/sprites/player/dace.png';
  playerSprites.idle.onload = () => { playerSprites.ready = true; };


  npcDetails = await npcDetailsPromise;

  // Build case-insensitive lookup for NPC keys in characters.json
  npcDetailsByLc = {};
  for (const [k, v] of Object.entries(npcDetails || {})) {
    npcDetailsByLc[lc(k)] = v;
  }

  npcNameList = Object.keys(npcDetails || {});


  // Ensure abilities data is loaded before resolving Player/NPC abilities.
  if (!abilitiesData) {
    abilitiesData = await abilitiesDataPromise;
    abilitiesDataByLc = {};
    for (const [k, v] of Object.entries(abilitiesData || {})) {
      abilitiesDataByLc[lc(k)] = v;
    }
  }

  // Optional: apply Player startingStats + abilities/targeting from characters.json
  if (npcDetails && npcDetails.Player) {
    if (npcDetails.Player.startingStats) {
      const ss = npcDetails.Player.startingStats;
      ensurePlayerStats();
      __applyStartingStatsToStats(player.stats, ss);
    }

    const pAbilities = resolveAbilityList(npcDetails.Player.abilities);
    player.innateAbilities = pAbilities;
    ensureActorLearnedAbilities(player);
    player.heldAbilities = [];
    player.abilities = [];
    player.factions = Array.isArray(npcDetails.Player.factions) ? npcDetails.Player.factions.slice() : [];
    player.allianceByFaction = (npcDetails.Player.allianceByFaction && typeof npcDetails.Player.allianceByFaction === 'object')
      ? { ...npcDetails.Player.allianceByFaction }
      : undefined;
    player.allianceByInstance = (npcDetails.Player.allianceByInstance && typeof npcDetails.Player.allianceByInstance === 'object')
      ? { ...npcDetails.Player.allianceByInstance }
      : undefined;

    if (npcDetails.Player.ai && typeof npcDetails.Player.ai === 'object') {
      if (npcDetails.Player.ai.targeting && typeof npcDetails.Player.ai.targeting === 'object') {
        player.aiTargeting = { ...npcDetails.Player.ai.targeting };
      }
      if (npcDetails.Player.ai.movementTargeting && typeof npcDetails.Player.ai.movementTargeting === 'object') {
        player.aiMovementTargeting = { ...npcDetails.Player.ai.movementTargeting };
      }
    }
    if (npcDetails.Player.inventorySize != null && isFinite(Number(npcDetails.Player.inventorySize))) {
      player.inventorySize = Math.max(0, Math.floor(Number(npcDetails.Player.inventorySize)));
    }

    player.autoCastAbilityId = player.autoCastAbilityId ?? null;
  }

  ensurePlayerGoals();


  for (const name of npcNameList) {
    ensureNpcRecord(name);
  }

  mobDetailsRaw = await mobDetailsPromise;
  mobDetails = resolveMobTemplates(mobDetailsRaw);
  mobIdList = Object.keys(mobDetails || {});

  if (!abilitiesData) {
    abilitiesData = await abilitiesDataPromise;
    abilitiesDataByLc = {};
    for (const [k, v] of Object.entries(abilitiesData || {})) {
      abilitiesDataByLc[lc(k)] = v;
    }
  }

  factionsData = await factionsDataPromise;


  itemsData = await loadItemsJSON();
  objectsData = await objectsDataPromise;

  rulesData = await loadRulesJSON();

  // Item grants (abilities/features) depend on items data.
  rebuildActorItemGrants(player);
  for (const p of party) {
    if (p) rebuildActorItemGrants(p);
  }

  // Kick off stat-change icon loads early so first dialog changes show immediately
  __getStatChangeIcon('affection', 'up');
  __getStatChangeIcon('affection', 'down');
  __getStatChangeIcon('alignment', 'up');
  __getStatChangeIcon('alignment', 'down');


  validateRulesData(rulesData);
  rebuildRulesIndex();





  // Preload NPC sprites
  npcNameList.forEach((name) => {
    const base = lc(name);

    const entry = {
      idle: new Image(),
      runLeft: null,
      runRight: null,
      stoppedLeft: null,
      stoppedRight: null,
      stoppedForward: null,
      ready: false,
      requestedExtras: false // NEW
    };

    entry.idle.src = `assets/sprites/npcs/character_sprite_${base}.png`;
    entry.idle.onload = () => { entry.ready = true; };


    npcSprites[name] = entry;

    // Warm the new NPC sprite resolver as well (prevents first-draw pop-in)
    getOrRequestNpcSprite(name, 'wait', '');

  });

  // Precreate mob sprite entries (actual images are lazy-loaded on draw)
  for (const id of (mobIdList || [])) {
    ensureMobSpriteEntry(id);
  }


  // Load Areas
  await tryResolveAreasData();

  // Choose a starting Area (first key, or 'Grove' if present)
  const keys = Object.keys(areasData || {});
  const startArea = areasData['Grove'] ? 'Grove' : (keys[0] || null);
  if (!startArea) {
    console.warn("No Areas defined. Falling back to a single default ground span.");
    // Minimal fake area so game runs
    areasData = {
      Default: { defaultground: 'ground', sectioncount: 12, sections: {}, leftarea: null, rightarea: null }
    };
  }
  const areaToUse = startArea || 'Default';
  buildAndEnterArea(areaToUse, 'left');

  // Refresh menu tabs now that player/NPC/items data has loaded
  renderMenuTabs(menuTopTabs, true, true);

  requestAnimationFrame(gameLoop);
}
initGame();

// ===== Conversation controls (unchanged core) =====
async function startConversation(npc) {
  if (loading) await waitForAreaReady();
  if (!npc || isActorUnconscious(npc)) return;
  __resetDialogStackState();
  __resetDialogEndQueue();
  __resetDialogConversationFlags();
  wasMenuOpenBeforeDialog = !!inMenu;
  if (inMenu) closePlayerMenu();
  hideMenuTabsForDialog();
  inConversation = true;
  currentNpc = npc;

  // Mark NPC as met + update last known
  const rec = ensureNpcRecord(npc.name);
  if (!rec.firstMetAt) rec.firstMetAt = Date.now();
  rec.met = true;
  rec.lastSeenArea = currentAreaName;
  rec.lastSeenWorldX = npc.worldX;
  rec.lastSeenAt = Date.now();

  emitGameEvent('talk_start', { area: currentAreaName, section: getSectionNameForX(player.worldX), npc: npc.name });

  promptEl.style.display = 'none';

  // show UI immediately
  conversationOverlay.style.display = 'block';
  __setDialogBoxText('Loading...');
  optionsBox.innerHTML = '';
  conversationPortrait.src = '';

  const fileKey = lc(npc.name);
  const data = await loadDialogFor(fileKey);

  currentDialog = data;
  currentDialogKey = fileKey;

  const overrideStart = String(npc?.dialogStart || '').trim();
  currentPhraseId = overrideStart || data.start;
  await loadPhrase(currentPhraseId);

}

async function startRuleScene(startRef, ruleId) {
  if (loading) await waitForAreaReady();
  __resetDialogStackState();
  __resetDialogEndQueue();
  __resetDialogConversationFlags();
  wasMenuOpenBeforeDialog = !!inMenu;
  if (inMenu) closePlayerMenu();
  hideMenuTabsForDialog();
  // Remember which rule started this scene (so once-rules can be marked fired on endConversation)
  currentRuleSceneId = ruleId || null;

  // Scenes are dialog-driven action chains
  inConversation = true;
  inViewMode = false;
  currentNpc = null;

  // Show conversation overlay (actions may hide it again)
  conversationOverlay.style.display = 'none';
  __setDialogBoxText('');
  optionsBox.innerHTML = '';
  conversationPortrait.src = '';

  // Allow cross-file refs like "forest1.mist_entry_branch"
  currentDialog = null;
  currentDialogKey = null;

  currentPhraseId = startRef;
  await loadPhrase(startRef);
}



// === Shared condition evaluator for 'when' blocks ===
function checkWhenBlock(w, npc) {
  if (!w || typeof w !== 'object') return true;

  function checkStat(statName, rule) {
    if (!rule || typeof rule !== 'object') return true;

    const k = lc(statName || '');
    const npcVal = Number(getActorStatValue(npc?.name || '', k, 'current'));

    if (!isFinite(npcVal)) return false;

    for (const op of Object.keys(rule)) {
      let target = rule[op];

      // allow symbolic values: minalignment / minaffection (thresholds)
      if (typeof target === 'string') {
        const t = lc(target);
      if (t === 'minalignment') target = getActorStatValue(npc?.name || '', 'minalignment', 'base');
      else if (t === 'minaffection') target = getActorStatValue(npc?.name || '', 'minaffection', 'base');
      else return false;
    }

      if (typeof target !== 'number') return false;

      switch (op) {
        case '>':  if (!(npcVal > target)) return false; break;
        case '>=': if (!(npcVal >= target)) return false; break;
        case '<':  if (!(npcVal < target)) return false; break;
        case '<=': if (!(npcVal <= target)) return false; break;
        case '==': if (!(npcVal == target)) return false; break;
        case '!=': if (!(npcVal != target)) return false; break;
        default: return false;
      }
    }

    return true;
  }

  function checkStatSum(rule) {
    if (!rule || typeof rule !== 'object') return true;

    const actorName = String(rule.actor || rule.npc || (npc && npc.name) || 'player');
    const stats = Array.isArray(rule.stats) ? rule.stats : [];
    if (!actorName || stats.length === 0) return false;

    const field = rule.field || 'current';
    let sum = 0;
    for (const statName of stats) {
      const v = getActorStatValue(actorName, statName, field);
      if (!isFinite(v)) return false;
      sum += Number(v);
    }

    let target = null;
    if (rule.rhs && typeof rule.rhs === 'object') {
      if (rule.rhs.field) {
        const rhsStat = rule.rhs.stat || stats[0];
        target = getActorStatValue(actorName, rhsStat, rule.rhs.field);
      } else if ('value' in rule.rhs) {
        target = Number(rule.rhs.value);
      }
    } else if ('rhs' in rule) {
      target = rule.rhs;
    } else if ('value' in rule) {
      target = rule.value;
    }

    if (typeof target === 'string') {
      const t = lc(target);
      if (t === 'minalignment') target = getActorStatValue(actorName, 'minalignment', 'base');
      else if (t === 'minaffection') target = getActorStatValue(actorName, 'minaffection', 'base');
      else return false;
    }

    const rhs = Number(target);
    if (!isFinite(rhs)) return false;

    let op = lc(rule.op || rule.compare || rule.cmp || 'lt');
    if (op === '<') op = 'lt';
    else if (op === '<=') op = 'lte';
    else if (op === '>') op = 'gt';
    else if (op === '>=') op = 'gte';
    else if (op === '==') op = 'eq';
    else if (op === '!=') op = 'neq';

    switch (op) {
      case 'lt':  return sum < rhs;
      case 'lte': return sum <= rhs;
      case 'gt':  return sum > rhs;
      case 'gte': return sum >= rhs;
      case 'eq':  return sum === rhs;
      case 'neq': return sum !== rhs;
      default: return false;
    }
  }

  // AREA
  if (w.area && w.area !== currentAreaName) return false;

  // SECTIONS
  if (w.sections && currentArea?.sections) {
    const idx = Math.floor(player.worldX / currentArea.sectionTileWidth);
    const sec = currentArea.sections[idx]?.name;
    if (!w.sections.includes(sec)) return false;
  }

    // TIME OF DAY
  // Supports:
  //   w.timePhase: "night" | "evening" | "day" | "morning" (string)
  //   w.timeBetween: { startMin, endMin }  (minutes-into-day, inclusive)
  //   w.timeBetween: { startT, endT }      (normalized 0..1 dayT, inclusive)
  if (w.timePhase !== undefined) {
    const want = lc(
      (typeof w.timePhase === 'string') ? w.timePhase
      : (w.timePhase && typeof w.timePhase === 'object') ? (w.timePhase.is || w.timePhase.phase || '')
      : ''
    );
    if (!want) return false;

    const info = getWorldTimeInfo(WORLD_TIME_MIN);
    if (lc(info.phase) !== want) return false;
  }

  if (w.timeBetween && typeof w.timeBetween === 'object') {
    const info = getWorldTimeInfo(WORLD_TIME_MIN);

    // Prefer minutes-into-day if provided
    if (w.timeBetween.startMin != null || w.timeBetween.endMin != null) {
      const startMin = Number(w.timeBetween.startMin ?? 0);
      const endMin   = Number(w.timeBetween.endMin   ?? 0);
      const x = Number(info.minutesIntoDay);

      if (!isFinite(startMin) || !isFinite(endMin) || !isFinite(x)) return false;

      const wraps = endMin < startMin;
      const ok = wraps ? (x >= startMin || x <= endMin) : (x >= startMin && x <= endMin);
      if (!ok) return false;
    } else {
      // Otherwise use normalized [0..1] across the day
      const startT = Number(w.timeBetween.startT ?? w.timeBetween.startDayT ?? 0);
      const endT   = Number(w.timeBetween.endT   ?? w.timeBetween.endDayT   ?? 0);
      const x = Number(info.dayT);

      if (!isFinite(startT) || !isFinite(endT) || !isFinite(x)) return false;

      const wraps = endT < startT;
      const ok = wraps ? (x >= startT || x <= endT) : (x >= startT && x <= endT);
      if (!ok) return false;
    }
  }


  // PARTY COMPOSITION
  // w.party supports:
  //   - boolean (existing): whether THIS npc is in party
  //   - array: list of npc names that must ALL be in party
  //   - object: { hasAll:[], hasAny:[], lacks:[] }
  if (w.party !== undefined) {
    if (typeof w.party === 'boolean') {
      const inParty = party.includes(npc);
      if (w.party !== inParty) return false;
    } else if (Array.isArray(w.party)) {
      // "all of these must be in party"
      for (const name of w.party) {
        if (!isNpcInPartyByName(name)) return false;
      }
    } else if (w.party && typeof w.party === 'object') {
      const hasAll = w.party.hasAll || w.party.all;
      const hasAny = w.party.hasAny || w.party.any;
      const lacks  = w.party.lacks  || w.party.not;

      if (Array.isArray(hasAll)) {
        for (const name of hasAll) {
          if (!isNpcInPartyByName(name)) return false;
        }
      }

      if (Array.isArray(lacks)) {
        for (const name of lacks) {
          if (isNpcInPartyByName(name)) return false;
        }
      }

      if (Array.isArray(hasAny) && hasAny.length) {
        let ok = false;
        for (const name of hasAny) {
          if (isNpcInPartyByName(name)) { ok = true; break; }
        }
        if (!ok) return false;
      }
    } else {
      return false; // invalid type
    }
  }

  // FLAGS
  // Supports:
  //   w.flags: { area:{k:true}, global:{k:true} }
  //   w.areaFlags: {k:true}
  //   w.globalFlags: {k:true}
  function requireFlags(scope, obj) {
  if (!obj || typeof obj !== 'object') return true;

    for (const [k, expected] of Object.entries(obj)) {
      const actual = getFlag(scope, k);

      // expected: true  => flag must be truthy
      // expected: false => flag must be falsy/undefined
      // expected: null  => flag must be unset/undefined
      if (expected === true) {
        if (!actual) return false;
      } else if (expected === false) {
        if (actual) return false;
      } else if (expected === null) {
        if (actual !== undefined) return false;
      } else {
        if (actual !== expected) return false;
      }
    }

    return true;
  }


  if (w.flags && typeof w.flags === 'object') {
    if (!requireFlags('area', w.flags.area)) return false;
    if (!requireFlags('global', w.flags.global)) return false;
  }
  if (!requireFlags('area', w.areaFlags)) return false;
  if (!requireFlags('global', w.globalFlags)) return false;


  // STATS
  if (w.statSum) {
    const list = Array.isArray(w.statSum) ? w.statSum : [w.statSum];
    for (const rule of list) {
      if (!checkStatSum(rule)) return false;
    }
  }
  if (w.alignment && !checkStat('alignment', w.alignment)) return false;
  if (w.affection && !checkStat('affection', w.affection)) return false;

  return true;
}

function _dialogOptionFlagKey(phraseId, optionId) {
  const dialogKey = String(currentDialogKey || '');
  const phrase = String(phraseId || currentPhraseId || '');
  const opt = String(optionId || '');
  return `dialogOptionChosen:${dialogKey}:${phrase}:${opt}`;
}

function clearAllKeys() {
  for (const k in keys) keys[k] = false;
}

function findActorByName(name) {
  if (!name) return null;

  const n = lc(name);;
  if (n === 'player' || n === 'dace') return player;

  // Party first, then world npcs
  const p = party.find(x => lc(x?.name) === n);
  if (p) return p;

  const w = npcs.find(x => lc(x?.name) === n);
  if (w) return w;

  return null;
}

function getOrCreateNpcByName(name) {
  if (!name) return null;
  const n = lc(name);;

  // If already present (party/world), return it
  let actor = findActorByName(n);
  if (actor && actor !== player) return actor;

  // Not present: build a live NPC from registry (so actions can join/leave even off-screen)
  const rec = ensureNpcRecord(name);

  // Pick a spawn X:
  // - If registry has a world position in this area, use it
  // - else spawn near player
  let spawnX = player.worldX;
  if (rec.area === currentAreaName && typeof rec.worldX === 'number') {
    spawnX = rec.worldX;
  }

  // Create + push into world npcs
  const npc = createNpc(name, spawnX);
  npc.stats = rec.stats;
  npcs.push(npc);


  return npc;
}


function startActionPhrase(phraseId, phrase) {
  inActionPhrase = true;
  __dialogActionSinceLastPhrase = true;
  __clearDialogStack();

  // Default: lock player movement during actions
  const lockPlayer = phrase.lockPlayer !== false;
  const lockPartyFollow = (phrase.allowPartyFollow === true) ? false : (phrase.lockPartyFollow !== false);
  const timeFrozen = !!(phrase?.action?.timeFrozen ?? phrase?.timeFrozen);

  controlsLocked = lockPlayer;

  clearAllKeys();
  if (lockPlayer) {
    player.vx = 0;
  }

  // Hide dialog UI during action
  conversationOverlay.style.display = 'none';

  activeAction = {
    phraseId,
    startedAtMs: performance.now(),
    done: false,
    phrase,
    lockPlayer,
    lockPartyFollow,
    timeFrozen
  };
}


function stopActionPhrase() {
  inActionPhrase = false;
  activeAction = null;

  // Re-show dialog UI if we are still in a conversation (next phrase might be dialog)
  if (inConversation) {
    conversationOverlay.style.display = 'block';
  }
}

function getLastTravelDir(actor) {
  if (!actor) return 1;

  // Prefer actual motion if currently moving
  if (typeof actor.vx === 'number' && Math.abs(actor.vx) > 0.1) {
    return Math.sign(actor.vx) || 1;
  }

  // Player already has explicit tracking
  if (actor === player) {
    return (lastDirection === -1) ? -1 : 1;
  }

  // For NPCs/party, fall back to facing (which you already update while moving)
  if (typeof actor.facing === 'number' && (actor.facing === 1 || actor.facing === -1)) {
    return actor.facing;
  }

  return 1;
}

function isPlayerDrivenByActionMoveTo() {
  if (!inConversation || !inActionPhrase || !activeAction?.phrase?.action) return false;
  const act = activeAction.phrase.action;
  if (lc(act.type) !== 'moveto') return false;
  return lc(act.actor) === 'player';
}

function applyForcedMoveStep(actor, targetX, dt, speedFactor = 1) {
  if (!actor) return { done: true };

  // Base speed: actor's normal movement speed
  const baseSpeed = actor.maxMovementSpeed || 240;

  // Multiplier from JSON (default 1)
  const factor = Number(speedFactor ?? 1);

  // Final speed
  const spd = baseSpeed * factor;

  if (!isFinite(targetX) || !isFinite(spd) || spd <= 0) {
    return { done: true };
  }

  const dx = targetX - actor.worldX;
  const step = Math.sign(dx) * spd * dt;

  if (Math.abs(step) >= Math.abs(dx)) {
    actor.worldX = targetX;
    actor.vx = 0;
    return { done: true };
  }

  actor.worldX += step;
  actor.vx = step / dt;
  actor.lastMoveTime = getGameNowMs();
  actor.hasEverMoved = true;

  return { done: false };
}

function isActorDrivenByForcedMove(actor) {
  return !!(actor && actor.__forcedMoveActive);
}

function __clearForcedMove(actor) {
  if (!actor) return;
  actor.__forcedMoveActive = false;
  actor.__forcedMove = null;
}

function resetActorTeleportState(actor) {
  if (!actor) return;
  __clearForcedMove(actor);
  if (actor.__interactionMoveActive) {
    actor.__interactionMoveActive = false;
    actor.__interactionMove = null;
  }
  actor.vx = 0;
  actor.vy = 0;
}

function startForcedMove(actor, targetX, speedFactor = 1, opts = {}) {
  if (!actor) return false;
  const tx = Number(targetX);
  if (!isFinite(tx)) return false;

  actor.__forcedMoveActive = true;
  actor.__forcedMove = {
    targetX: tx,
    speedFactor: Number(speedFactor ?? 1),
    startedAtMs: getGameNowMs(),
    source: opts?.source || null,
    dir: (opts && (opts.dir === 1 || opts.dir === -1)) ? opts.dir : null,
    sourceX: (opts && isFinite(Number(opts.sourceX))) ? Number(opts.sourceX) : null,
    startX: Number(actor.worldX)
  };

  return true;
}

function updateForcedMoves(dt, nowMs, activeObjectBlockers) {
  const list = [player, ...(Array.isArray(party) ? party : []), ...(Array.isArray(npcs) ? npcs : []), ...(Array.isArray(mobs) ? mobs : [])];
  if (!list.length) return;

  for (const actor of list) {
    if (!actor || !actor.__forcedMoveActive) continue;

    const move = actor.__forcedMove;
    if (!move || !isFinite(move.targetX)) {
      __clearForcedMove(actor);
      continue;
    }

    const prevX = actor.worldX;
    const res = applyForcedMoveStep(actor, move.targetX, dt, move.speedFactor);

    // Keep grounded (matches moveTo + interaction rules)
    actor.y = groundY - actor.h - (actor === player ? 0 : 8);

    if (activeObjectBlockers) {
      resolveActorVsBlockers(actor, prevX, activeObjectBlockers);
    }

    const moved = Math.abs(Number(actor.worldX) - Number(prevX)) > 0.01;
    const remaining = Math.abs(Number(move.targetX) - Number(actor.worldX));

    if (!moved && remaining > 0.5) {
      actor.vx = 0;
      __clearForcedMove(actor);
      continue;
    }

    if (res.done) {
      __clearForcedMove(actor);
      continue;
    }
  }
}

function isPlayerStunned() {
  return !!(player && actorHasTag(player, 'stunned'));
}


// Minimal action set for now:
// - wait: { type:"wait", durationMs: 800 }
// - moveTo: { type:"moveTo", actor:"Rowyn", worldX: 1200, speedFactor: 2 }
// - moveTo: { type:"moveTo", actor:"player", left: 200, speedFactor: 2 }      // left by 200 (negative moves right)
// - moveTo: { type:"moveTo", actor:"player", forward: 200, speedFactor: 2 }   // forward by 200 (negative reverses)

// - face: { type:"face", actor:"Rowyn", facing: -1 }
function runActiveAction(dt) {
  if (!activeAction || !activeAction.phrase) return;

  const phrase = activeAction.phrase;
  const act = phrase.action;

  // If no action block, treat as instantly complete
  if (!act || typeof act !== 'object') {
    activeAction.done = true;
  } else if (act.type === 'wait') {
    const dur = Number(act.durationMs || 0);
    const elapsed = performance.now() - activeAction.startedAtMs;
    if (elapsed >= dur) activeAction.done = true;
  } else if (act.type === 'face') {
    const actor = findActorByName(act.actor);
    if (actor) {
      const f = Number(act.facing);
      if (f === 1 || f === -1) actor.facing = f;
    }
    activeAction.done = true;

  } else if (act.type === 'faceto') {
    const actor = findActorByName(act.actor);
    if (actor) {
      const spec = __resolveActionTargetSpec(act);
      const targetX = spec ? __getTargetCenterXFromSpecNearActor(spec, actor) : null;
      if (isFinite(targetX)) {
        const dir = Math.sign(Number(targetX) - Number(actor.worldX || 0));
        if (dir === 1 || dir === -1) actor.facing = dir;
      }
    }
    activeAction.done = true;

  } else if (act.type === 'fade') {
    // One-time init per action phrase
    if (!activeAction._fadeInit) {
      activeAction._fadeInit = true;

      // Accept either 0..1 or 0..100
      let op = Number(act.opacity ?? act.alpha ?? act.target ?? act.percent ?? 0);
      if (isFinite(op) && op > 1) op = op / 100;

      const durMs = Number(act.durationMs ?? act.timeMs ?? 0);
      const durSec = (isFinite(durMs) ? durMs : 0) / 1000;

      activeAction._fadeId = startFadeTo(op, durSec);
    }

    // Done when that tween completes or something else replaced it
    if (!FADE.active || FADE.id !== activeAction._fadeId) {
      activeAction.done = true;
    }

  } else if (act.type === 'camera') {


    // One-time init per action phrase
    if (!activeAction._camInit) {
      activeAction._camInit = true;

      const dur = Number(act.durationMs ?? act.timeMs ?? 0);

      // Reset shortcut: follow player, zoom 1
      if (act.reset === true || lc(act.mode) === 'reset') {
        activeAction._camTweenId = startCameraTween({
          endMode: 'follow',
          endTargetSpec: { type: 'player' },
          endManualCenterX: null,
          endZoom: 1,
          durationMs: dur
        });

      } else {
        // Zoom target (optional)
        const z = Number(act.zoom ?? act.zoomMult ?? act.multiplier);
        const endZoom = (isFinite(z) && z > 0) ? z : cameraZoom;

        // Focus/target spec (optional)
        // Supported:
        //  - { type:'worldX', x:1234 } (center)
        //  - { type:'player' }
        //  - { type:'npc', npc:'Rowyn' }
        //  - { type:'object', id:'letta_bush' }
        //  - { type:'objectInstance', instanceKey:'gfore:letta_bush:0' }
        //  - { type:'activeObject' }
        //  - { type:'sectionPos', section:'grove_1', x:200, area?:'Forest1' }
        //  - { type:'mob', id:'spirit_wisp' }                 // nearest instance
        //  - { type:'mobInstance', instanceId:'spirit_wisp:0' }

        const spec = act.focus || act.target || act.follow || null;

        let endMode = 'follow';
        let endTargetSpec = { type: 'player' };
        let endManualCenterX = null;

        if (spec && typeof spec === 'object') {
          const tt = lc(spec.type);

          // Manual centers
          if (tt === 'worldx' || tt === 'sectionpos') {
            const cx = getTargetCenterXFromSpec(spec);
            if (isFinite(cx)) {
              endMode = 'manual';
              endManualCenterX = Number(cx);
            }
          } else {
            // Follow targets
            endMode = 'follow';
            endTargetSpec = spec;
          }
        } else if (typeof spec === 'string' && spec) {
          // convenience: "player"
          endMode = 'follow';
          endTargetSpec = { type: String(spec) };
        }

        activeAction._camTweenId = startCameraTween({
          endMode,
          endTargetSpec,
          endManualCenterX,
          endZoom,
          durationMs: dur
        });
      }
    }

    // Complete when the tween finishes (or instantly if it snapped)
    if (!CAMERA_TWEEN.active) {
      activeAction.done = true;
    }
  } else if (act.type === 'interactionEffect') {
    __flushPendingObjectInteraction('action');
    activeAction.done = true;
  } else if (act.type === 'moveTo') {
    const actor = findActorByName(act.actor);
    const actor2 = findActorByName(act.toChar);
    if (!actor) {
      activeAction.done = true;
    } else {
      // Cache move target so relative moves don't "rebase" every tick.
      // (Without this, left/forward will chase a moving target forever.)
      let targetX = (activeAction._moveTargetX !== undefined) ? activeAction._moveTargetX : null;

      if (targetX === null) {
        const spec = __resolveActionTargetSpec(act);
        if (spec) {
          targetX = __getTargetCenterXFromSpecNearActor(spec, actor);
        }

        // Target currently active interactable object
        if (act.toActiveObject === true) {
          if (!currentObjectInteract) {
            activeAction.done = true;
            return;
          }

          const t = proximityTargetByKey.get(currentObjectInteract.instanceKey);
          if (!t || !isFinite(t.worldX)) {
            activeAction.done = true;
            return;
          }

          const actorHalfW = actor.w * 0.5;
          const offset = actor.w * 0.5;
          const dir = getLastTravelDir(actor);

          targetX = Number(t.worldX) - actorHalfW + (dir * offset);

        }

        // Absolute target
        else if (act.worldX !== undefined && act.worldX !== null) {
          targetX = Number(act.worldX);

        // Relative: move LEFT by N (negative N moves right)
        } else if (act.left !== undefined && act.left !== null) {
          const d = Number(act.left);
          if (isFinite(d)) targetX = actor.worldX - d;

        // Relative: move FORWARD by N in last travel direction (negative reverses)
        } else if (act.forward !== undefined && act.forward !== null) {
          const d = Number(act.forward);
          const dir = getLastTravelDir(actor);
          if (isFinite(d)) targetX = actor.worldX + (dir * d);


        } else if (actor2 !== undefined && actor2 !== null) {
          targetX = Number(actor2.worldX);
        }

        // Freeze target for the rest of this action step
        activeAction._moveTargetX = targetX;
      }



      // Base speed: actor's normal movement speed
      const res = applyForcedMoveStep(actor, targetX, dt, act.speedFactor);
      if (res.done) {
        activeAction.done = true;
      } else {
        // Keep them grounded (same rule you use elsewhere)
        actor.y = groundY - actor.h - (actor === player ? 0 : 8);
      }
    }
    } else if (act.type === 'leaveParty') {
    const whoName = act.actor || act.npc; // allow either key
    const who = whoName ? findActorByName(whoName) : null;

    // Options
    const emit = act.emit !== false;          // default true
    const toWorld = act.toWorld !== false;    // default true (they remain in the world unless you say otherwise)
    const rememberIndex = act.rememberIndex !== false; // default true

    if (!who || who === player) {
      activeAction.done = true;
    } else {
      // Only meaningful if they are currently in party
      const idx = party.indexOf(who);
      if (idx >= 0 && rememberIndex) {
        rememberedPartyIndex[lc(who.name)] = idx;
      }

      removeNpcFromPartyInternal(who, { emit, toWorld });

      // If you explicitly do NOT want them in world either, also clear registry location
      if (!toWorld) {
        const rec = ensureNpcRecord(who.name);
        rec.inParty = false;
        rec.area = null;
        rec.worldX = null;
      }

      activeAction.done = true;
    }
    } else if (act.type === 'joinParty') {
    const whoName = act.actor || act.npc;
    if (!whoName) {
      activeAction.done = true;
    } else {
      const who = getOrCreateNpcByName(whoName);
      if (!who || who === player) {
        activeAction.done = true;
      } else {
        const emit = act.emit !== false;               // default true
        const bypassChecks = act.bypassChecks === true; // default false
        const fromWorld = act.fromWorld !== false;     // default true

        // Index handling:
        // - act.index can be a number
        // - OR act.index === "remembered" to reinsert where they were when they left
        let index = null;
        if (typeof act.index === 'number') {
          index = act.index;
        } else if (act.index === 'remembered') {
          const k = lc(who.name);
          if (rememberedPartyIndex[k] !== undefined) index = rememberedPartyIndex[k];
        } else if (act.index === 'end') {
          index = party.length;
        }

        addNpcToPartyInternal(who, { index, emit, bypassChecks, fromWorld });

        activeAction.done = true;
      }
    }
  } else {
    // Unknown action type: complete immediately so we don't softlock
    activeAction.done = true;
  }

  // When the action completes, advance to next phrase (or end)
  if (activeAction.done) {
    const phraseNow = currentDialog?.phrases?.[currentPhraseId];
    const next = phraseNow?.next;

    const isEndQueue = !!activeAction?.phrase?.__endQueue;
    stopActionPhrase();
    if (isEndQueue) {
      __continueDialogEndQueue();
      return;
    }

    // Apply effects on the action phrase when it completes (optional but consistent)
    const split = __splitDialogEffects(phraseNow?.effects);
    if (split.atEnd.length) __enqueueDialogEndEffects(split.atEnd);
    applyEffects(split.immediate);

    // If the player cancelled the scene, do NOT continue the scene graph.
    // We only ran this action to restore camera control, so now we exit to gameplay.
    if (__cancelScenePending) {
      __cancelScenePending = false;
      endConversation();
      return;
    }


    if (typeof next === 'string') {
      loadPhrase(next);
    } else if (next && typeof next === 'object') {
      // same branch semantics as dialog phrases
      const entries = Object.entries(next);
      entries.sort((a, b) => {
        const wa = a[1]?.when && Object.keys(a[1].when).length > 0 ? 0 : 1;
        const wb = b[1]?.when && Object.keys(b[1].when).length > 0 ? 0 : 1;
        return wa - wb;
      });

      for (const [branchName, branch] of entries) {
        const w = branch?.when || {};
        if (checkWhenBlock(w, currentNpc)) {
          loadPhrase(branchName);
          return;
        }
      }

      endConversation();
    } else {
      endConversation();
    }
  }
}

function getDialogLayoutModeForPhrase(phrase) {
  const raw = (phrase && Object.prototype.hasOwnProperty.call(phrase, 'speaker')) ? phrase.speaker : undefined;
  const s = (typeof raw === 'string') ? lc(raw) : '';
  const playerName = lc(player?.name || '');

  if (s === 'player' || (playerName && s === playerName)) return 'player';
  if (s === 'narrator') return 'narrator';
  if (s === 'guide') return 'guide';

  // guide / null / missing speaker
  if (!s) {
    // If we're in an NPC conversation with no explicit speaker, treat as NPC layout
    if (currentNpc && currentNpc.name) return 'npc';
    return 'guide';
  }

  return 'npc';
}

function resetConversationOverlayLayout() {
  if (conversationOverlay) conversationOverlay.dataset.mode = '';

  if (conversationPortrait) {
    conversationPortrait.style.display = 'none';
  }

  if (dialogBox) {
    dialogBox.style.left = '';
    dialogBox.style.top = '';
    dialogBox.style.right = '';
    dialogBox.style.bottom = '';
    dialogBox.style.width = '';
    dialogBox.style.maxWidth = '';
    dialogBox.style.height = '';
    dialogBox.style.minHeight = '';
    dialogBox.style.transform = '';
    dialogBox.style.textAlign = '';
    dialogBox.style.fontStyle = '';
    dialogBox.style.fontWeight = '';
    dialogBox.style.color = '';
  }

  if (optionsBox) {
    optionsBox.style.left = '';
    optionsBox.style.right = '';
    optionsBox.style.top = '';
    optionsBox.style.bottom = '';
    optionsBox.style.width = '';
    optionsBox.style.maxWidth = '';
    optionsBox.style.transform = '';
    optionsBox.style.textAlign = '';
  }
}

function setDialogMinHeightForLines(lineCount = 4) {
  if (!dialogBox) return;
  const cs = window.getComputedStyle(dialogBox);
  const lh = parseFloat(cs.lineHeight);
  const pt = parseFloat(cs.paddingTop);
  const pb = parseFloat(cs.paddingBottom);

  const lineH = isFinite(lh) ? lh : (parseFloat(cs.fontSize) * 1.2);
  const pad = (isFinite(pt) ? pt : 0) + (isFinite(pb) ? pb : 0);

  dialogBox.style.minHeight = `${Math.ceil(lineH * lineCount + pad)}px`;
}

function setDialogHeightForText(fullText) {
  if (!dialogBox) return;
  if (dialogBox.style.display === 'none') return;
  const text = String(fullText ?? '');
  const cs = window.getComputedStyle(dialogBox);
  const pt = parseFloat(cs.paddingTop);
  const pb = parseFloat(cs.paddingBottom);
  const pad = (isFinite(pt) ? pt : 0) + (isFinite(pb) ? pb : 0);

  const meas = document.createElement('div');
  meas.className = 'dialogText';
  meas.style.position = 'absolute';
  meas.style.visibility = 'hidden';
  meas.style.pointerEvents = 'none';
  meas.style.left = '0';
  meas.style.top = '0';
  const w = dialogBox.getBoundingClientRect().width || dialogBox.clientWidth || __lastDialogBoxWidth || 0;
  if (!w) return;
  meas.style.width = `${w}px`;
  meas.innerHTML = text;
  dialogBox.appendChild(meas);

  const h = Math.ceil(meas.scrollHeight + pad);
  dialogBox.removeChild(meas);
  dialogBox.style.minHeight = '';
  dialogBox.style.height = `${h}px`;
  __dialogHeightLocked = true;

  if (__lastDialogLayoutMode === 'npc' && !__lastDialogHasPortrait && currentNpc) {
    // Ensure layout has applied before positioning the pointer
    dialogBox.getBoundingClientRect();
    const host = __dialogFirstNpcBoxEl || dialogBox;
    __setDialogPointerVisible(true, host);
    requestAnimationFrame(() => __positionDialogPointerToActor(currentNpc));
  }
  const r = dialogBox.getBoundingClientRect();
  //   h: r.height,
  //   top: r.top,
  //   left: r.left,
  //   bottom: r.bottom
  // });
}

async function prepareDialogBoxForText(text) {
  if (!dialogBox) return;
  dialogBox.style.display = '';
  for (let i = 0; i < 3; i++) {
    const w = dialogBox.getBoundingClientRect().width || dialogBox.clientWidth || 0;
    if (w > 0) {
      setDialogHeightForText(text);
      break;
    }
    await new Promise(r => requestAnimationFrame(r));
  }
  // Ensure the box is painted before typing begins
  await new Promise(r => requestAnimationFrame(r));
}

function scheduleDialogHeightForText(text) {
  requestAnimationFrame(() => setDialogHeightForText(text));
}

let __dialogPointerEl = null;
let __dialogTextEl = null;
let __dialogHeightLocked = false;
let __lastDialogPortraitWidth = 0;
let __lastDialogLayoutMode = null;
let __lastDialogHasPortrait = false;
let __lastDialogBoxWidth = 0;
let __dialogHasShownPhrase = false;
let __dialogLastSpeakerName = '';
let __dialogActionSinceLastPhrase = false;
let __dialogStackPending = false;
let __dialogStackPrevRect = null;
let __dialogStackTarget = null;
const __dialogStackItems = [];
let __dialogOptionRowHeight = null;
let __dialogOptionsPadHeight = null;
const __dialogChoiceItems = [];
const __dialogChoiceOffsetX = 40;
let __dialogCarryChoiceText = null;
let __dialogCarryChoiceRect = null;

// ===== Dialog stack (overhaul) =====
const DIALOG_STACK = [];
let __dialogStackContainer = null;
let __dialogStackTopPx = 0;
let __dialogStackLeftPx = 0;
let __dialogStackWidthPx = 0;
let __dialogLastNpcSpeaker = '';
let __dialogPendingChoiceText = null;
let __dialogFirstNpcBoxEl = null;

function __resetDialogStackState() {
  __clearDialogStackAll();
  __clearDialogChoiceStack();
  __dialogHasShownPhrase = false;
  __dialogLastSpeakerName = '';
  __dialogActionSinceLastPhrase = false;
}

function __clearDialogStack() {
  for (const el of __dialogStackItems.splice(0)) {
    if (el?.el && el.el.parentElement) el.el.parentElement.removeChild(el.el);
  }
  __dialogStackPending = false;
  __dialogStackPrevRect = null;
  __dialogStackTarget = null;
  __attachDialogPointerToActiveBox();
  __removeDialogStackUpPointer();
  __removeDialogStackRectLink();
  __clearDialogChoiceStack();
}

function __clearDialogChoiceStack() {
  for (const el of __dialogChoiceItems.splice(0)) {
    if (el?.el && el.el.parentElement) el.el.parentElement.removeChild(el.el);
  }
  __dialogCarryChoiceRect = null;
}

function __addChoiceBox(text) {
  if (!conversationOverlay || !dialogBox) return;
  const label = String(text || '').trim();
  if (!label) return;

  const overlayRect = conversationOverlay.getBoundingClientRect();
  const activeRectAbs = dialogBox.getBoundingClientRect();
  const stackRect = (__dialogStackItems.length ? __dialogStackItems[__dialogStackItems.length - 1].rect : null);
  const lastChoiceRect = (__dialogChoiceItems.length ? __dialogChoiceItems[__dialogChoiceItems.length - 1].rect : null);

  const candidates = [];
  if (activeRectAbs.width > 0 && activeRectAbs.height > 0) {
    candidates.push({
      left: activeRectAbs.left - overlayRect.left,
      top: activeRectAbs.top - overlayRect.top,
      width: activeRectAbs.width,
      height: activeRectAbs.height
    });
  }
  if (stackRect) candidates.push(stackRect);
  if (lastChoiceRect) candidates.push(lastChoiceRect);

  const baseRect = candidates.reduce((best, cur) => {
    if (!best) return cur;
    const bestBottom = best.top + best.height;
    const curBottom = cur.top + cur.height;
    return curBottom > bestBottom ? cur : best;
  }, null) || {
    left: activeRectAbs.left - overlayRect.left,
    top: activeRectAbs.top - overlayRect.top,
    width: activeRectAbs.width,
    height: activeRectAbs.height
  };

  const baseLeft = baseRect.left;
  const baseTop = baseRect.top;
  const baseWidth = baseRect.width;
  const baseHeight = baseRect.height;

  const clone = document.createElement('div');
  clone.className = 'dialogChoiceItem';
  clone.textContent = label;
  conversationOverlay.appendChild(clone);

  const gap = 8;
  const left = Math.round(baseLeft + __dialogChoiceOffsetX);
  const top = Math.round(baseTop + baseHeight + gap);
  const width = Math.max(180, Math.round(baseWidth - __dialogChoiceOffsetX));

  clone.style.left = `${left}px`;
  clone.style.top = `${top}px`;
  clone.style.width = `${width}px`;

  const rect = clone.getBoundingClientRect();
  __dialogChoiceItems.push({
    el: clone,
    rect: {
      left: rect.left - overlayRect.left,
      top: rect.top - overlayRect.top,
      width: rect.width,
      height: rect.height
    }
  });

}

function __addChoiceBoxAtTop(text, baseRect) {
  if (!conversationOverlay) return null;
  const label = String(text || '').trim();
  if (!label) return null;
  if (!baseRect) return null;

  const clone = document.createElement('div');
  clone.className = 'dialogChoiceItem';
  clone.textContent = label;
  conversationOverlay.appendChild(clone);

  const left = Math.round(baseRect.left + __dialogChoiceOffsetX);
  const top = Math.round(baseRect.top);
  const width = Math.max(180, Math.round(baseRect.width - __dialogChoiceOffsetX));

  clone.style.left = `${left}px`;
  clone.style.top = `${top}px`;
  clone.style.width = `${width}px`;

  const overlayRect = conversationOverlay.getBoundingClientRect();
  const rect = clone.getBoundingClientRect();
  const stored = {
    left: rect.left - overlayRect.left,
    top: rect.top - overlayRect.top,
    width: rect.width,
    height: rect.height
  };

  __dialogChoiceItems.push({ el: clone, rect: stored });
  __dialogCarryChoiceRect = stored;
  return stored;
}

function __ensureDialogStackContainer() {
  if (!conversationOverlay) return null;
  if (__dialogStackContainer && __dialogStackContainer.parentElement === conversationOverlay) return __dialogStackContainer;
  const el = document.createElement('div');
  el.id = 'dialogStackContainer';
  el.style.position = 'absolute';
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.pointerEvents = 'none';
  conversationOverlay.appendChild(el);
  __dialogStackContainer = el;
  return el;
}

function __clearDialogStackAll({ keepPendingChoice = false } = {}) {
  DIALOG_STACK.length = 0;
  __dialogLastNpcSpeaker = '';
  if (!keepPendingChoice) {
    __dialogPendingChoiceText = null;
  }
  __dialogFirstNpcBoxEl = null;
  if (__dialogStackContainer) __dialogStackContainer.innerHTML = '';
}

function __computeDialogStackLayout() {
  const touchLayout = document.documentElement.classList.contains('touch-enabled');
  // The mobile game viewport excludes the reserved menu tab strip.
  const W = touchLayout ? conversationOverlay.clientWidth : (window.innerWidth || 0);
  const H = touchLayout ? conversationOverlay.clientHeight : (window.innerHeight || 0);
  const pad = 12;

  const hasPortrait = !!(conversationPortrait && conversationPortrait.naturalWidth > 0);
  __lastDialogHasPortrait = hasPortrait;

  const pr = conversationPortrait ? conversationPortrait.getBoundingClientRect() : { width: 0 };
  let portraitW = Math.ceil(pr.width || 0);
  const fallbackPortraitW = Math.round((832 / 1248) * H);
  if (portraitW >= fallbackPortraitW) {
    __lastDialogPortraitWidth = portraitW;
  } else if (__lastDialogPortraitWidth >= fallbackPortraitW) {
    portraitW = __lastDialogPortraitWidth;
  } else {
    portraitW = fallbackPortraitW;
  }

  const leftX = Math.ceil(portraitW + pad);
  const avail = Math.max(0, W - leftX - pad);
  // Desktop retains its original layout. Mobile dialogue and options occupy
  // separate columns, so even a long list of options cannot cover the speech.
  const columnGap = 12;
  const boxW = touchLayout
    ? Math.max(140, Math.min(Math.floor(H * 0.9), Math.floor((avail - columnGap) * 0.52)))
    : Math.max(200, Math.min(avail, H));
  __dialogStackLeftPx = leftX;
  __dialogStackWidthPx = Math.floor(boxW);
  __dialogStackTopPx = Math.round(H * (touchLayout ? 0.13 : 0.2));

  if (optionsBox) {
    if (touchLayout) {
      const optionsLeft = leftX + __dialogStackWidthPx + columnGap;
      const optionsWidth = Math.max(1, W - optionsLeft - pad);
      optionsBox.style.left = `${optionsLeft}px`;
      optionsBox.style.top = `${__dialogStackTopPx}px`;
      optionsBox.style.bottom = 'auto';
      optionsBox.style.width = `${optionsWidth}px`;
      optionsBox.style.maxWidth = `${optionsWidth}px`;
      optionsBox.style.maxHeight = `${Math.max(60, H - __dialogStackTopPx - pad)}px`;
      optionsBox.style.overflowY = 'auto';
      optionsBox.style.overscrollBehavior = 'contain';
    } else {
      optionsBox.style.left = `${__dialogStackLeftPx}px`;
      optionsBox.style.bottom = `${pad}px`;
      optionsBox.style.width = `${__dialogStackWidthPx}px`;
      optionsBox.style.maxWidth = `${Math.floor(H)}px`;
    }
    optionsBox.style.transform = '';
    optionsBox.style.textAlign = 'left';
  }
}

function __measureStackHeight(items) {
  const container = __ensureDialogStackContainer();
  if (!container) return 0;
  const temp = document.createElement('div');
  temp.style.position = 'absolute';
  temp.style.left = '-9999px';
  temp.style.top = '0px';
  temp.style.visibility = 'hidden';
  container.appendChild(temp);

  let total = 0;
  const gap = 8;

  for (const it of items) {
    const box = document.createElement('div');
    box.className = it.kind === 'player' ? 'dialogStackItem dialogStackPlayer' : 'dialogStackItem dialogStackNpc';
    box.style.width = `${__dialogStackWidthPx}px`;
    box.textContent = it.text || '';
    temp.appendChild(box);
    const h = box.getBoundingClientRect().height || box.offsetHeight || 0;
    total += h;
    total += gap;
  }

  if (total > 0) total -= gap;
  container.removeChild(temp);
  return total;
}

function __getDialogStackTextWidth(textEl, contentOverride = null) {
  if (!textEl) return 0;
  let restore = null;
  if (contentOverride != null) {
    restore = textEl.textContent;
    textEl.textContent = contentOverride;
  }
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const rects = range.getClientRects();
  let maxW = 0;
  for (let i = 0; i < rects.length; i++) {
    const w = rects[i].width;
    if (w > maxW) maxW = w;
  }
  if (!maxW) {
    const r = textEl.getBoundingClientRect();
    if (r && r.width) maxW = r.width;
  }
  if (restore != null) textEl.textContent = restore;
  return maxW;
}

function __fitDialogStackBoxWidth(box, textEl, maxWidth) {
  if (!box || !textEl) return maxWidth;
  const cs = window.getComputedStyle(box);
  const pl = parseFloat(cs.paddingLeft || '0') || 0;
  const pr = parseFloat(cs.paddingRight || '0') || 0;
  const pad = pl + pr;
  const textW = __getDialogStackTextWidth(textEl);
  const minTextW = __getDialogStackTextWidth(textEl, 'nnnn');
  const minW = Math.ceil(minTextW + pad);
  const desired = Math.min(maxWidth, Math.ceil(textW + pad));
  return Math.max(Math.ceil(pad + 2), desired, minW);
}

function __canAddToStack(pendingItems) {
  const items = DIALOG_STACK.concat(pendingItems || []);
  const height = __measureStackHeight(items);
  const { row, pad } = __getDialogOptionRowHeight();
  const minOptionsHeight = pad + row * 4;
  const overlayH = conversationOverlay?.getBoundingClientRect().height || window.innerHeight || 0;
  // On mobile the options are beside, not below, the dialogue stack.
  const mobileSideOptions = document.documentElement.classList.contains('touch-enabled');
  const available = Math.max(0, overlayH - (mobileSideOptions ? 0 : minOptionsHeight) - __dialogStackTopPx - 12);
  return height <= available;
}

function __renderDialogStack(typingIndex = null) {
  const container = __ensureDialogStackContainer();
  if (!container) return null;
  container.innerHTML = '';

  let y = __dialogStackTopPx;
  const gap = 8;
  const boxes = [];
  const npcIndices = [];
  let typingEl = null;

  for (let i = 0; i < DIALOG_STACK.length; i++) {
    const it = DIALOG_STACK[i];
    const box = document.createElement('div');
    box.className = it.kind === 'player' ? 'dialogStackItem dialogStackPlayer' : 'dialogStackItem dialogStackNpc';
    const maxWidth = __dialogStackWidthPx;
    const rightEdge = __dialogStackLeftPx + maxWidth +
      (document.documentElement.classList.contains('touch-enabled') ? 0 : __dialogChoiceOffsetX);
    const left = __dialogStackLeftPx + (it.kind === 'player' ? __dialogChoiceOffsetX : 0);
    box.style.left = `${left}px`;
    box.style.top = `${y}px`;
    box.style.width = `${maxWidth}px`;

    const textEl = document.createElement('div');
    textEl.className = 'dialogStackText';
    textEl.textContent = it.text || '';
    box.appendChild(textEl);
    container.appendChild(box);

    const fittedWidth = __fitDialogStackBoxWidth(box, textEl, maxWidth);
    if (it.kind === 'player') {
      box.style.left = `${Math.round(rightEdge - fittedWidth)}px`;
    } else {
      box.style.left = `${__dialogStackLeftPx}px`;
    }
    box.style.width = `${fittedWidth}px`;

    if (typingIndex === i) {
      textEl.textContent = '';
    }

    const rect = box.getBoundingClientRect();
    boxes.push({ el: box, rect });
    if (it.kind === 'npc') npcIndices.push(i);
    if (typingIndex === i) typingEl = textEl;

    y = Math.round(y + rect.height + gap);
  }

  // Pointer for first NPC box
  if (npcIndices.length) {
    const firstNpcIdx = npcIndices[0];
    const host = boxes[firstNpcIdx]?.el || null;
    if (host) {
      __dialogFirstNpcBoxEl = host;
      __setDialogPointerVisible(true, host);
      if (!__lastDialogHasPortrait && currentNpc) {
        __positionDialogPointerToActor(currentNpc, host);
      } else {
        __resetDialogPointerToDefault(host);
      }
    }
  } else {
    __setDialogPointerVisible(false);
    __dialogFirstNpcBoxEl = null;
  }

  // Connectors between NPC boxes
  for (let i = 1; i < npcIndices.length; i++) {
    const curIdx = npcIndices[i];
    const prevIdx = npcIndices[i - 1];
    const curBox = boxes[curIdx];
    const prevBox = boxes[prevIdx];
    if (!curBox || !prevBox) continue;

    let link = curBox.el.querySelector('.dialogStackRectLink');
    if (!link) {
      link = document.createElement('div');
      link.className = 'dialogStackRectLink';
      curBox.el.appendChild(link);
    }
    const gapPx = Math.round(curBox.rect.top - (prevBox.rect.top + prevBox.rect.height));
    const linkH = Math.max(0, gapPx + 2);
    link.style.left = `16px`;
    link.style.top = `-${linkH}px`;
    link.style.height = `${linkH}px`;
  }

  return typingEl;
}

function __updateDialogPointerForPortrait() {
  if (!__dialogFirstNpcBoxEl) return;
  if (!__lastDialogHasPortrait && currentNpc) {
    __positionDialogPointerToActor(currentNpc, __dialogFirstNpcBoxEl);
  } else {
    __resetDialogPointerToDefault(__dialogFirstNpcBoxEl);
  }
}

function __ensureDialogStackPointer() {
  if (!dialogBox) return null;
  let el = dialogBox.querySelector('.dialogStackPointer');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'dialogStackPointer';
  el.style.pointerEvents = 'none';
  dialogBox.appendChild(el);
  return el;
}

function __removeDialogStackPointer() {
  if (!dialogBox) return;
  const el = dialogBox.querySelector('.dialogStackPointer');
  if (el && el.parentElement) el.parentElement.removeChild(el);
}

function __attachDialogPointerToStackTop() {
  if (!__dialogStackItems.length) return false;
  const top = __dialogStackItems[0]?.el;
  if (!top) return false;
  const el = __ensureDialogPointerEl(top);
  if (el && el.parentElement !== top) {
    top.appendChild(el);
  }
  __resetDialogPointerToDefault(top);
  return true;
}

function __attachDialogPointerToActiveBox() {
  if (!dialogBox) return false;
  const el = __ensureDialogPointerEl(dialogBox);
  if (el && el.parentElement !== dialogBox) {
    dialogBox.appendChild(el);
  }
  __resetDialogPointerToDefault(dialogBox);
  return true;
}

function __ensureDialogStackUpPointer() {
  if (!dialogBox) return null;
  let el = dialogBox.querySelector('.dialogStackUpPointer');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'dialogStackUpPointer';
  el.style.pointerEvents = 'none';
  dialogBox.appendChild(el);
  return el;
}

function __removeDialogStackUpPointer() {
  if (!dialogBox) return;
  const el = dialogBox.querySelector('.dialogStackUpPointer');
  if (el && el.parentElement) el.parentElement.removeChild(el);
}

function __ensureDialogStackRectLink() {
  if (!dialogBox) return null;
  let el = dialogBox.querySelector('.dialogStackRectLink');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'dialogStackRectLink';
  el.style.pointerEvents = 'none';
  dialogBox.appendChild(el);
  return el;
}

function __removeDialogStackRectLink() {
  if (!dialogBox) return;
  const el = dialogBox.querySelector('.dialogStackRectLink');
  if (el && el.parentElement) el.parentElement.removeChild(el);
}

function __getDialogOptionRowHeight() {
  if (__dialogOptionRowHeight != null && __dialogOptionsPadHeight != null) {
    return { row: __dialogOptionRowHeight, pad: __dialogOptionsPadHeight };
  }
  if (!optionsBox) return { row: 60, pad: 16 };

  const temp = document.createElement('div');
  temp.className = 'dialogOption';
  temp.style.visibility = 'hidden';
  temp.style.position = 'absolute';
  temp.textContent = 'Option';
  optionsBox.appendChild(temp);

  const rect = temp.getBoundingClientRect();
  const cs = window.getComputedStyle(temp);
  const mt = parseFloat(cs.marginTop || '0') || 0;
  const mb = parseFloat(cs.marginBottom || '0') || 0;
  const row = rect.height + mt + mb;
  optionsBox.removeChild(temp);

  const csBox = window.getComputedStyle(optionsBox);
  const pt = parseFloat(csBox.paddingTop || '0') || 0;
  const pb = parseFloat(csBox.paddingBottom || '0') || 0;
  __dialogOptionRowHeight = Math.max(1, row);
  __dialogOptionsPadHeight = pt + pb;
  return { row: __dialogOptionRowHeight, pad: __dialogOptionsPadHeight };
}

function __cloneDialogBoxToStack() {
  if (!conversationOverlay || !dialogBox) return null;
  const overlayRect = conversationOverlay.getBoundingClientRect();
  const rect = dialogBox.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const clone = document.createElement('div');
  clone.className = 'dialogBoxStackItem';
  clone.style.left = `${Math.round(rect.left - overlayRect.left)}px`;
  clone.style.top = `${Math.round(rect.top - overlayRect.top)}px`;
  clone.style.width = `${Math.round(rect.width)}px`;
  clone.style.height = `${Math.round(rect.height)}px`;

  const textEl = __dialogTextEl;
  clone.innerHTML = textEl ? textEl.innerHTML : '';
  if (__dialogStackItems.length > 0) {
    const svgs = clone.querySelectorAll('svg');
    svgs.forEach(el => el.parentElement && el.parentElement.removeChild(el));
  }
  conversationOverlay.appendChild(clone);
  __dialogStackItems.push({ el: clone, rect: {
    left: rect.left - overlayRect.left,
    top: rect.top - overlayRect.top,
    width: rect.width,
    height: rect.height
  }});

  return {
    left: rect.left - overlayRect.left,
    top: rect.top - overlayRect.top,
    width: rect.width,
    height: rect.height
  };
}

function __finalizeDialogStackLayout() {
  if (!conversationOverlay || !dialogBox || !__dialogStackPending || !__dialogStackPrevRect) {
    __dialogStackPending = false;
    __dialogStackPrevRect = null;
    __dialogStackTarget = null;
    __removeDialogStackPointer();
    __removeDialogStackUpPointer();
    __removeDialogStackRectLink();
    return;
  }

  const overlayRect = conversationOverlay.getBoundingClientRect();
  const newRect = dialogBox.getBoundingClientRect();
  const baseNpcRect = __dialogStackPrevRect;
  let prev = __dialogStackPrevRect;
  const lastChoice = __dialogChoiceItems.length ? __dialogChoiceItems[__dialogChoiceItems.length - 1].rect : null;
  if (lastChoice) {
    const prevBottom = prev.top + prev.height;
    const choiceBottom = lastChoice.top + lastChoice.height;
    if (choiceBottom > prevBottom) {
      prev = lastChoice;
    }
  }
  const gap = 8;

  const { row, pad } = __getDialogOptionRowHeight();
  const minOptionsHeight = pad + row * 4;
  const maxBottom = overlayRect.height - minOptionsHeight - 12;
  const nextTop = prev.top + prev.height + gap;
  const nextBottom = nextTop + newRect.height;

  if (nextBottom > maxBottom) {
    __clearDialogStack();
    return;
  }

  __dialogStackTarget = {
    top: Math.round(nextTop),
    left: Math.round(baseNpcRect.left),
    width: Math.round(baseNpcRect.width)
  };

  dialogBox.style.top = `${__dialogStackTarget.top}px`;
  dialogBox.style.bottom = '';
  dialogBox.style.transform = '';
  dialogBox.style.left = `${__dialogStackTarget.left}px`;
  dialogBox.style.width = `${__dialogStackTarget.width}px`;
  dialogBox.style.maxWidth = `${__dialogStackTarget.width}px`;

  // Move speaker pointer to the top-most stacked box.
  __attachDialogPointerToStackTop();

  // Maintain rectangular connectors for all stacked boxes.
  for (let i = 0; i < __dialogStackItems.length; i++) {
    const item = __dialogStackItems[i];
    if (!item || !item.el || !item.rect) continue;
    const nextRect = (i + 1 < __dialogStackItems.length)
      ? __dialogStackItems[i + 1].rect
      : __dialogStackTarget;

    if (!nextRect) continue;
    let link = item.el.querySelector('.dialogStackLink');
    if (!link) {
      link = document.createElement('div');
      link.className = 'dialogStackLink';
      item.el.appendChild(link);
    }
    const linkLeft = 16;
    const linkTop = Math.round(item.rect.height - 1);
    const gap = Math.round(nextRect.top - (item.rect.top + item.rect.height));
    const linkH = Math.max(0, gap + 2);
    link.style.left = `${linkLeft}px`;
    link.style.top = `${linkTop}px`;
    link.style.height = `${linkH}px`;
  }

  // Active stacked box: rectangle connector at top-left to previous box.
  __removeDialogStackUpPointer();
  const rectLink = __ensureDialogStackRectLink();
  if (rectLink && __dialogStackTarget) {
    const leftAnchor = prev.left + 18;
    const linkLeft = Math.round(leftAnchor - __dialogStackTarget.left);
    const gap = Math.round(__dialogStackTarget.top - (prev.top + prev.height));
    const linkH = Math.max(0, gap + 2);
    rectLink.style.left = `${Math.max(6, linkLeft)}px`;
    rectLink.style.top = `-${linkH}px`;
    rectLink.style.height = `${linkH}px`;
  }

  __dialogStackPending = false;
  __dialogStackPrevRect = null;
}

function __ensureDialogPointerEl(host = null) {
  const parent = host || dialogBox;
  if (!parent) return null;
  if (__dialogPointerEl) {
    if (__dialogPointerEl.parentElement !== parent) {
      parent.appendChild(__dialogPointerEl);
    }
    return __dialogPointerEl;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.left = '-60px';
  svg.style.top = 'calc(90% - 28px)';
  svg.style.transform = '';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '0';
  svg.style.overflow = 'visible';

  const pointerW = 60;
  const pointerH = 10;
  const tipOffsetY = -5; // tilt up slightly without rotating the base
  svg.setAttribute('width', String(pointerW));
  svg.setAttribute('height', String(pointerH * 2));
  svg.setAttribute('viewBox', `0 0 ${pointerW} ${pointerH * 2}`);

  // Fill only (no outline)
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute(
    'points',
    `${pointerW},0 ${pointerW},${pointerH * 2} 0,${pointerH + tipOffsetY}`
  );
  poly.setAttribute('fill', '#ffffff');
  poly.setAttribute('stroke', 'none');
  svg.appendChild(poly);
  svg.__poly = poly;

  parent.appendChild(svg);
  __dialogPointerEl = svg;
  return svg;
}

function __setDialogPointerVisible(on, host = null) {
  const el = __ensureDialogPointerEl(host);
  if (!el) return;
  el.style.display = on ? '' : 'none';
}

function __resetDialogPointerToDefault(host = null) {
  const el = __ensureDialogPointerEl(host);
  if (!el) return;
  const pointerW = 60;
  const pointerH = 10;
  const tipOffsetY = -5;

  el.style.left = '-60px';
  el.style.top = 'calc(90% - 28px)';
  el.style.width = `${pointerW}px`;
  el.style.height = `${pointerH * 2}px`;
  el.setAttribute('width', String(pointerW));
  el.setAttribute('height', String(pointerH * 2));
  el.setAttribute('viewBox', `0 0 ${pointerW} ${pointerH * 2}`);

  let poly = el.__poly;
  if (!poly) {
    poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('fill', '#ffffff');
    el.appendChild(poly);
    el.__poly = poly;
  }

  poly.setAttribute(
    'points',
    `${pointerW},0 ${pointerW},${pointerH * 2} 0,${pointerH + tipOffsetY}`
  );

  if (el.__line1 && el.__line1.parentElement) el.__line1.parentElement.removeChild(el.__line1);
  if (el.__line2 && el.__line2.parentElement) el.__line2.parentElement.removeChild(el.__line2);
  el.__line1 = null;
  el.__line2 = null;
}

function __renderToScreenX(rx) {
  const cx = WIDTH * 0.5;
  return (Number(rx) - cx) * cameraZoom + cx;
}

function __renderToScreenY(ry) {
  const cy = HEIGHT * 0.5;
  return (Number(ry) - cy) * cameraZoom + cy;
}

function __positionDialogPointerToActor(actor, host = null) {
  const boxHost = host || dialogBox;
  if (!boxHost || !actor) return;
  const resolveActor = (a) => {
    if (a && isFinite(Number(a.worldX)) && isFinite(Number(a.y))) return a;
    const name = a?.name;
    if (!name) return null;
    const lcName = lc(name);
    const found = npcs.find(n => lc(n?.name || '') === lcName);
    return found || null;
  };
  const worldActor = resolveActor(actor);
  if (!worldActor) return;
  const el = __ensureDialogPointerEl(boxHost);
  if (!el) return;

  const boxRect = boxHost.getBoundingClientRect();
  if (!boxRect || !boxRect.width || !boxRect.height) return;

  const center = __actorRenderCenter(worldActor);
  if (!center) return;

  const canvasRect = canvas.getBoundingClientRect();
  const scaleX = canvasRect.width / Math.max(1, WIDTH);
  const scaleY = canvasRect.height / Math.max(1, HEIGHT);

  const actorTopY = canvasRect.top + (Number(worldActor.y) * scaleY);
  const actorCenterX = canvasRect.left + (Number(center.x) * scaleX);
  const targetCenterY = actorTopY + (Number(worldActor.h) * 0.10 * scaleY);
  const targetCenterX = actorCenterX;

  const radius = Math.max(0, Number(worldActor.h) * 0.05 * scaleY);

  // Aim at the target center, but stop at the circle boundary (radius)
  const boxW = boxRect.width;
  const boxH = boxRect.height;
  const baseCenterX = boxRect.left + boxW / 2;
  const baseCenterY = boxRect.top + boxH;
  const vx = targetCenterX - baseCenterX;
  const vy = targetCenterY - baseCenterY;
  const vlen = Math.hypot(vx, vy) || 1;
  const tipXRaw = targetCenterX - (vx / vlen) * radius;
  const tipYRaw = targetCenterY - (vy / vlen) * radius;
  if (!isFinite(tipXRaw) || !isFinite(tipYRaw)) return;
  const tipX = Math.max(canvasRect.left + 4, Math.min(canvasRect.right - 4, tipXRaw));
  const tipY = Math.max(canvasRect.top + 4, Math.min(canvasRect.bottom - 4, tipYRaw));

  // boxW/boxH already set above
  const pad = 4;
  const pointerH = 50;
  const baseHalf = 10;
  const cornerRadius = 12;
  const edgeOffset = boxW * 0.05;

  const baseY = boxRect.top + boxH;
  const centerX = boxRect.left + boxW / 2;

  const minBaseX = Math.max(boxRect.left + edgeOffset, boxRect.left + cornerRadius + baseHalf);
  const maxBaseX = Math.min(boxRect.left + boxW - edgeOffset, boxRect.left + boxW - cornerRadius - baseHalf);

  const rel = (tipX - boxRect.left) / boxW; // owner center within bubble (0..1)
  const playerSx = canvasRect.left + ((player.worldX - cameraX + (Number(player.w) || 0) * 0.5) * scaleX);
  const playerOnLeft = playerSx < tipX;

  // Angle the pointer ~30 degrees off vertical; tip stays at owner.
  const angleRad = Math.PI / 6; // 30 degrees
  const horizOffset = Math.tan(angleRad) * Math.max(0, tipY - baseY);

  let baseX = centerX;

  if (rel >= 0.45 && rel <= 0.55) {
    baseX = boxRect.left + boxW * (playerOnLeft ? 0.45 : 0.55);
  } else if (rel >= 0.05 && rel <= 0.95) {
    const dir = playerOnLeft ? -1 : 1;
    baseX = tipX + dir * horizOffset;
  } else {
    baseX = (rel < 0.05) ? (boxRect.left + boxW * 0.05) : (boxRect.left + boxW * 0.95);
  }

  baseX = Math.max(minBaseX, Math.min(maxBaseX, baseX));

  const baseXLocal = baseX - boxRect.left;
  const baseYLocal = baseY - boxRect.top;
  const tipXLocal = tipX - boxRect.left;
  const tipYLocal = tipY - boxRect.top;
  //   boxTop: boxRect.top,
  //   boxH: boxRect.height,
  //   baseY,
  //   tipY
  // });

  const svgW = Math.ceil(boxW);
  const svgH = Math.ceil(Math.max(pointerH * 2, tipYLocal + pad));

  el.style.left = '0px';
  el.style.top = '0px';
  el.style.width = `${svgW}px`;
  el.style.height = `${svgH}px`;
  el.setAttribute('width', String(svgW));
  el.setAttribute('height', String(svgH));
  el.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  let poly = el.__poly;
  let line1 = el.__line1;
  let line2 = el.__line2;
  if (!poly) {
    poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('fill', '#ffffff');
    el.appendChild(poly);
    el.__poly = poly;
  }
  if (line1 && line1.parentElement) line1.parentElement.removeChild(line1);
  if (line2 && line2.parentElement) line2.parentElement.removeChild(line2);
  el.__line1 = null;
  el.__line2 = null;

  const p1x = baseXLocal - baseHalf;
  const p1y = baseYLocal;
  const p2x = baseXLocal + baseHalf;
  const p2y = baseYLocal;
  const p3x = tipXLocal;
  const p3y = tipYLocal;

  poly.setAttribute('points', `${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`);
}

function __ensureDialogTextEl() {
  if (!dialogBox) return null;
  if (__dialogTextEl && __dialogTextEl.parentElement === dialogBox) return __dialogTextEl;

  const el = document.createElement('div');
  el.className = 'dialogText';
  dialogBox.appendChild(el);
  __dialogTextEl = el;
  return el;
}

function __setDialogBoxText(text) {
  const el = __ensureDialogTextEl();
  if (!el) return;
  el.textContent = String(text ?? '');
}

function refreshConversationOverlayLayout(phrase) {
  if (!conversationOverlay || !dialogBox || !optionsBox) return;

  // Defaults
  resetConversationOverlayLayout();

  const mode = getDialogLayoutModeForPhrase(phrase);
  conversationOverlay.dataset.mode = mode;
  __lastDialogLayoutMode = mode;

  // Narrator/guide should not inherit the NPC dialog stack.
  if (mode === 'narrator' || mode === 'guide') {
    __clearDialogStackAll();
    __clearDialogStack();
  }

  // Track current speaker name so stat-change feedback can mirror into the dialog portrait
  // (best-effort: supports a few common phrase shapes)
  CURRENT_DIALOG_SPEAKER_NAME = String(
    (phrase && (phrase.speaker ?? phrase.npc ?? phrase.actor ?? phrase.name ?? phrase.who)) || ''
  ).trim();
  if (conversationOverlay) {
    conversationOverlay.dataset.speaker = CURRENT_DIALOG_SPEAKER_NAME;
  }


  const W = window.innerWidth || 0;
  const H = window.innerHeight || 0;
  const pad = 12;

  if (mode === 'narrator') {
    __setDialogPointerVisible(false);
    // 50% width, centered both axes, italic
    dialogBox.style.width = '50%';
    dialogBox.style.left = '50%';
    dialogBox.style.top = '50%';
    dialogBox.style.transform = 'translate(-50%, -50%)';


    // options stays bottom-center (so "continue" appears consistently)
    optionsBox.style.width = '50%';
    optionsBox.style.left = '50%';
    optionsBox.style.bottom = `${pad}px`;
    optionsBox.style.transform = 'translateX(-50%)';
    optionsBox.style.textAlign = 'left';

    dialogBox.style.background = 'transparent';
    dialogBox.style.border = 'none';
    dialogBox.style.color = '#fff';
    dialogBox.style.fontStyle = 'italic';

    return;
  }

  if (mode === 'guide') {
    __setDialogPointerVisible(false);
    // 50% width, centered, top of window, italic bold centered blue, auto height
    dialogBox.style.width = '50%';
    dialogBox.style.left = '50%';
    dialogBox.style.top = '20%';
    dialogBox.style.transform = 'translateX(-50%)';

    // let it size to text; no forced 4-line min
    dialogBox.style.minHeight = '';

    optionsBox.style.width = '50%';
    optionsBox.style.left = '50%';
    optionsBox.style.bottom = `${pad}px`;
    optionsBox.style.transform = 'translateX(-50%)';
    optionsBox.style.textAlign = 'left';

    dialogBox.style.background = 'transparent';
    dialogBox.style.border = 'none';
    dialogBox.style.color = '#66aaff';
    dialogBox.style.fontStyle = '';

    return;
  }

  if (mode === 'player') {
    __setDialogPointerVisible(false);
    // 50% width, centered horizontally, 4 lines min, sits above optionsBox
    dialogBox.style.width = '50%';
    dialogBox.style.left = '50%';
    dialogBox.style.transform = 'translateX(-50%)';
    if (!__dialogHeightLocked) setDialogMinHeightForLines(4);

    optionsBox.style.width = '50%';
    optionsBox.style.left = '50%';
    optionsBox.style.bottom = `${pad}px`;
    optionsBox.style.transform = 'translateX(-50%)';
    optionsBox.style.textAlign = 'left';

    // Position dialogBox bottom just above optionsBox (after options are rendered)
    const optRect = optionsBox.getBoundingClientRect();
    const bottomGap = pad;
    const bottomPx = Math.max(pad, Math.ceil(H - optRect.top + bottomGap));
    dialogBox.style.bottom = `${bottomPx}px`;

    return;
  }

  // mode === 'npc'
  if (conversationPortrait) {
    conversationPortrait.style.display = 'block';
  }
  __computeDialogStackLayout();
  __renderDialogStack(null);
  return;
}

window.addEventListener('resize', () => {
  if (!inConversation) return;
  // Best-effort refresh with whatever current phrase object is visible.
  // loadPhrase() calls refreshConversationOverlayLayout() with the actual phrase.
  // Here we just reflow current DOM positions.
  refreshConversationOverlayLayout({ speaker: dialogBox?.dataset?.speaker ?? undefined });
});


function resolveSpeakerNameForPhrase(phrase) {
  // Explicit speaker takes priority
  if (phrase.speaker && typeof phrase.speaker === 'string') {
    return phrase.speaker;
  }

  // Fallback: dialog owner (currentNpc)
  if (currentNpc && currentNpc.name) {
    return currentNpc.name;
  }

  return null;
}

async function typeDialogText(element, text) {
  const target = (element === dialogBox) ? __ensureDialogTextEl() : element;
  if (!target) return;
  target.innerHTML = '';
  if (!text) return;

  isTypingDialog = true;
  cancelDialogTyping = false;

  const delay = 1000 / dialogCharsPerSecond;

  let htmlBuffer = '';

  let i = 0;
  while (i < text.length) {
    if (!inConversation) return;

    if (cancelDialogTyping) {
      target.innerHTML = text;
      break;
    }

    // If this is an HTML tag, append it instantly
    if (text[i] === '<') {
      const end = text.indexOf('>', i);
      if (end !== -1) {
        htmlBuffer += text.slice(i, end + 1);
        target.innerHTML = htmlBuffer;
        i = end + 1;
        continue;
      }
    }

    // Visible character: animate it
    htmlBuffer += text[i];
    target.innerHTML = htmlBuffer;
    i++;

    await new Promise(resolve => setTimeout(resolve, delay));
  }

  isTypingDialog = false;
}

let __dialogPhraseLoadSeq = 0;
let __dialogAwaitingPortrait = false;


async function loadPhrase(id) {
  if (!inConversation) return;

  const mySeq = ++__dialogPhraseLoadSeq;
  __dialogHeightLocked = false;

  const resolved = await ensureDialogAndGetPhrase(id);
  if (!resolved.dialog) { endConversation(); return; }

  const phrase = resolved.dialog.phrases[resolved.phraseId];
  currentPhraseId = resolved.phraseId;

  const resolvedSpeaker = resolveSpeakerNameForPhrase(phrase);
  const speakerKey = lc(String(resolvedSpeaker || ''));

  // Ensure dialog layout metadata is available before effects fire
  if (conversationOverlay) {
    const mode = getDialogLayoutModeForPhrase(phrase);
    conversationOverlay.dataset.mode = mode;
    const speakerName = String(
      (phrase && (phrase.speaker ?? phrase.npc ?? phrase.actor ?? phrase.name ?? phrase.who)) || ''
    ).trim();
    conversationOverlay.dataset.speaker = speakerName;
  }


  // ACTION PHRASE:
  // If phrase has an `action` object, treat it as a scene/action step.
  // - Hide dialog UI
  // - Lock world + dialog inputs
  // - Keep world updating (handled in update())
  const actionObj = (phrase.action && typeof phrase.action === 'object') ? phrase.action : null;
  if (actionObj && actionObj.atEnd === true) {
    __enqueueDialogEndAction(actionObj);
  } else if (actionObj) {
    startActionPhrase(id, phrase);
    return;
  }

  // Apply dialog phrase effects ON ENTER (so they run once when shown)
  const split = __splitDialogEffects(phrase?.effects);
  if (split.atEnd.length) __enqueueDialogEndEffects(split.atEnd);
  applyEffects(split.immediate);

  const hasText = (typeof phrase.text === 'string' && phrase.text.trim().length > 0);
  const hasOptions = !!(phrase.options && typeof phrase.options === 'object');
  if (!hasText && !hasOptions) {
    const next = __resolveConditionalNext(phrase.next || null, currentNpc);
    if (next) {
      void loadPhrase(next);
    } else {
      endConversation();
    }
    return;
  }

  const layoutMode = getDialogLayoutModeForPhrase(phrase);


  // Ensure overlay is visible once we know there's renderable content
  conversationOverlay.style.display = 'block';

  // NPC stack mode
  if (layoutMode === 'npc') {
    __dialogAwaitingPortrait = false;
    conversationPortrait.style.display = 'block';
    if (dialogBox) dialogBox.style.display = 'none';

    const speakerName = lc(String(phrase.speaker || ''));
    const reaction = phrase.reaction || 'neutral';

    const portraitPath =
      `assets/portraits/character_portrait_${speakerName}_${reaction}.png`;
    const fallback =
      `assets/portraits/character_portrait_${speakerName}_neutral.png`;

    const loadPromise = ensurePortraitSrcLoaded(portraitPath, fallback);
    const portraitTimeoutMs = 5000;

    const speakerChanged = !!(__dialogLastNpcSpeaker && lc(__dialogLastNpcSpeaker) !== lc(resolvedSpeaker || ''));
    if (speakerChanged) {
      conversationPortrait.src = '';
      conversationPortrait.style.display = 'none';
      __lastDialogHasPortrait = false;
      __updateDialogPointerForPortrait();
    }

    const applyIfReady = (src) => {
      if (!src) return;
      if (!inConversation || mySeq !== __dialogPhraseLoadSeq) return;
      conversationPortrait.src = src;
      __lastDialogHasPortrait = true;
      conversationPortrait.style.display = 'block';
      __updateDialogPointerForPortrait();
    };

    Promise.race([
      loadPromise,
      sleepMs(portraitTimeoutMs).then(() => null)
    ]).then(applyIfReady);
    loadPromise.then(applyIfReady);

    __computeDialogStackLayout();

    const pending = [];
    if (__dialogPendingChoiceText) {
      pending.push({ text: __dialogPendingChoiceText, speaker: 'player', kind: 'player' });
    }
    pending.push({ text: phrase.text || '', speaker: resolvedSpeaker || '', kind: 'npc' });

    const shouldClear =
      !__dialogHasShownPhrase ||
      __dialogActionSinceLastPhrase ||
      speakerChanged ||
      !__canAddToStack(pending);

    if (shouldClear) {
      __clearDialogStackAll({ keepPendingChoice: !!__dialogPendingChoiceText });
      if (__dialogPendingChoiceText) {
        DIALOG_STACK.push({ text: __dialogPendingChoiceText, speaker: 'player', kind: 'player' });
      }
    }

    const npcIndex = DIALOG_STACK.length;
    DIALOG_STACK.push({ text: phrase.text || '', speaker: resolvedSpeaker || '', kind: 'npc' });

    const typingEl = __renderDialogStack(npcIndex);
    if (typingEl) {
      await typeDialogText(typingEl, phrase.text);
    }

    __dialogHasShownPhrase = true;
    __dialogLastNpcSpeaker = String(resolvedSpeaker || '');
    __dialogPendingChoiceText = null;
    __dialogActionSinceLastPhrase = false;
  } else {
    // Non-NPC modes: existing layout
    conversationPortrait.style.display = 'none';
    __dialogAwaitingPortrait = false;
    if (dialogBox) dialogBox.style.display = '';
    refreshConversationOverlayLayout(phrase);
  }




  optionsBox.innerHTML = '';
  dialogOptionsMap = null;
  dialogOptionsByKey = null;

  if (layoutMode !== 'npc') {
    await prepareDialogBoxForText(phrase.text);
    // Reflow pointer now that box height is final, before typing begins
    refreshConversationOverlayLayout(phrase);
    await typeDialogText(dialogBox, phrase.text);
  }

  if (phrase.options) {
    dialogOptionsMap = {};
    dialogOptionsByKey = {};
    let idx = 1;
    for (const key in phrase.options) {
      const opt = phrase.options[key];
      const optFlagKey = _dialogOptionFlagKey(currentPhraseId, key);
      const wasChosen = !!getFlag('global', optFlagKey);

      // NEW: conditional visibility
      if (opt.when && !checkWhenBlock(opt.when, currentNpc)) {
        continue; // hide this option
      }
      if (opt.state && !evaluateRuleState({ state: opt.state }, __lastEvent?.payload || null)) {
        continue; // hide this option
      }
      if (opt.hideIfChosen) {
        const mode = lc(opt.hideIfChosen);
        const convoChosen = !!__getDialogConversationFlag(optFlagKey);
        if (mode === 'conversation' || mode === 'perconversation') {
          if (convoChosen) continue; // hide after chosen in this conversation
        } else {
          if (wasChosen) continue; // hide after chosen globally (default)
        }
      }

      const optDiv = document.createElement('div');
      optDiv.dataset.optionIndex = String(idx);
      optDiv.dataset.optionKey = String(key);
      optDiv.className = 'dialogOption';
      const textSpan = document.createElement('span');
      textSpan.className = 'dialogOptionText';
      textSpan.textContent = opt.text;
      optDiv.appendChild(textSpan);
      attachHotkeyBadge(optDiv, idx);
      optDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDialogOptionByKey(String(key));
      });
      optDiv.addEventListener('mousedown', (e) => e.stopPropagation());
      optionsBox.appendChild(optDiv);

      dialogOptionsMap[idx] = {
        ...opt,
        optionId: key,
        _dialogOptionFlagKey: optFlagKey,
        _dialogOptionWasChosen: wasChosen
      };
      dialogOptionsByKey[String(key)] = {
        ...opt,
        optionId: key,
        _dialogOptionFlagKey: optFlagKey,
        _dialogOptionWasChosen: wasChosen
      };
      idx++;
    }

  } else {
    const p = document.createElement('div');
    p.textContent = 'Press any key to continue...';
    optionsBox.appendChild(p);
  }
  // Final layout pass (now that optionsBox has its real height)
  if (layoutMode !== 'npc') {
    refreshConversationOverlayLayout(phrase);
  }
  // keep height fixed during typing; do not resize here

  __dialogHasShownPhrase = true;
  __dialogLastSpeakerName = String(resolvedSpeaker || '');
  __dialogActionSinceLastPhrase = false;

}

function selectDialogOptionByIndex(idx) {
  if (!dialogOptionsMap || Object.keys(dialogOptionsMap).length === 0) return false;
  const opt = dialogOptionsMap[idx];
  if (!opt) return false;
  return selectDialogOption(opt);
}

function selectDialogOptionByKey(key) {
  if (!dialogOptionsByKey || Object.keys(dialogOptionsByKey).length === 0) return false;
  const opt = dialogOptionsByKey[String(key)];
  if (!opt) return false;
  return selectDialogOption(opt);
}

function selectDialogOption(opt) {
  if (!opt) return false;

  const choiceText = String(opt.text || '').trim();
  if (choiceText) {
    __computeDialogStackLayout();
    const pending = [{ text: choiceText, speaker: 'player', kind: 'player' }];
    if (!__canAddToStack(pending)) {
      __clearDialogStackAll();
    }
    DIALOG_STACK.push({ text: choiceText, speaker: 'player', kind: 'player' });
    __dialogPendingChoiceText = choiceText;
    __renderDialogStack(null);
  }

  optionsBox.innerHTML = '';
  dialogOptionsMap = null;
  dialogOptionsByKey = null;

  if (opt._dialogOptionFlagKey) {
    setFlag('global', opt._dialogOptionFlagKey, true);
    __setDialogConversationFlag(opt._dialogOptionFlagKey, true);
  }

  // APPLY EFFECTS (dialog option)
  const merged = [];
  if (Array.isArray(opt.effects)) {
    if (!opt.effectsOnce || !opt._dialogOptionWasChosen) {
      merged.push(...opt.effects);
    }
  }

  applyEffects(merged);

  emitGameEvent('dialog_option', {
    area: currentAreaName,
    section: getSectionNameForX(player.worldX),
    npc: currentNpc ? currentNpc.name : null,
    phrase: currentPhraseId,
    optionId: opt.optionId
  });

  // HANDLE NEXT
  let next = opt.next;

  if (typeof next === 'string') {
    optionsBox.innerHTML = '';
    dialogOptionsMap = null;
    void loadPhrase(next);
    return true;
  }

  if (next && typeof next === 'object') {
    const entries = Object.entries(next);
    entries.sort((a, b) => {
      const wa = a[1]?.when && Object.keys(a[1].when).length > 0 ? 0 : 1;
      const wb = b[1]?.when && Object.keys(b[1].when).length > 0 ? 0 : 1;
      return wa - wb;
    });

    for (const [branchName, branch] of entries) {
      const w = branch?.when || {};
      if (checkWhenBlock(w, currentNpc)) {
        optionsBox.innerHTML = '';
        dialogOptionsMap = null;
        void loadPhrase(branchName);
        return true;
      }
    }

    endConversation();
    return true;
  }

  endConversation();
  return true;
}

async function startTriggeredDialog(index) {
  const p = activeDialogPrompts[index];
  if (!p) return;
  if (p.npc && isActorUnconscious(p.npc)) return;

  __resetDialogStackState();
  let promptId = p.__promptId || null;
  if (!promptId) {
    let triggerKey = p.triggerKey || null;
    if (!triggerKey) {
      const who = lc(p.npc?.name || p.npc || '');
      const start = lc(p.start || '');
      const text = lc(p.prompt || '');
      triggerKey = `legacy:${who}:${start}:${text}`;
    }
    promptId = `${lc(p.npc.name)}:${triggerKey}`;
  }
  // Remove prompt immediately when triggered so it doesn't render during dialog
  activeDialogPrompts.splice(index, 1);
  __releasePartyPromptSlot(promptId);
  __promptVisibleMsById.delete(promptId);
  __promptAnimYById.delete(promptId);

  // Mark as "fired" only AFTER the conversation completes
  currentTriggeredPromptId = promptId;
  currentTriggeredPromptRuleId = p.ruleId || null;

  wasMenuOpenBeforeDialog = !!inMenu;
  if (inMenu) closePlayerMenu();
  hideMenuTabsForDialog();

  inConversation = true;
  currentNpc = p.npc;

  // Mark NPC as met + update last known (mirror startConversation)
  const rec = ensureNpcRecord(currentNpc.name);
  if (!rec.firstMetAt) rec.firstMetAt = Date.now();
  rec.met = true;
  rec.lastSeenArea = currentAreaName;
  rec.lastSeenWorldX = currentNpc.worldX;
  rec.lastSeenAt = Date.now();

  emitGameEvent('talk_start', {
    area: currentAreaName,
    section: getSectionNameForX(player.worldX),
    npc: currentNpc.name
  });


  promptEl.style.display = 'none';
  document.getElementById('dialogPromptContainer').innerHTML = '';

  // Show UI immediately (mirror startConversation)
  conversationOverlay.style.display = 'block';
  __setDialogBoxText('Loading...');
  optionsBox.innerHTML = '';
  conversationPortrait.src = '';


  const fileKey = lc(currentNpc.name);
  const data = await loadDialogFor(fileKey);
  if (!data) { endConversation(); return; }

  currentDialog = data;
  currentDialogKey = fileKey;

  // p.start can be "phraseId" OR "fileId.phraseId"
  currentPhraseId = p.start || data.start;
  await loadPhrase(currentPhraseId);


}


function __finalizeConversationEnd() {

  const npc = currentNpc;
  const wasViewMode = inViewMode;

  // Always restore control state when a conversation/scene ends
  inActionPhrase = false;
  activeAction = null;
  controlsLocked = false;

  for (const k in keys) keys[k] = false;
  player.vx = 0;

  inConversation = false;
  __dialogAwaitingPortrait = false;
  __resetDialogStackState();
  currentNpc = null;

  currentDialog = null;
  currentPhraseId = null;
  dialogOptionsMap = null;
  inViewMode = false;
  conversationOverlay.style.display = 'none';

  // Flush any queued interaction effects if a dialog ended without an explicit action.
  __flushPendingObjectInteraction('dialog_end');
  if (wasMenuOpenBeforeDialog) {
    wasMenuOpenBeforeDialog = false;
    openPlayerMenu(activeMenuPageId);
  } else {
    showMenuTabsAfterDialog();
  }

  // NPC must exist and must not be in view-only mode
  if (!npc || wasViewMode) {
    // Even without an NPC, state-only rules may now be eligible to fire.

    if (currentRuleSceneId) {
      const rid = String(currentRuleSceneId);
      triggeredRuleIds.add(rid);

      // Don't clear prompt-active state for prompt rules that also started a scene.
      const r = stateRuleById.get(rid);
      if (!(r && r.dialog)) {
        activeStateRuleIds.delete(rid);
      }

      currentRuleSceneId = null;
    }


    evaluateAllStateRules({
      area: currentAreaName,
      section: getSectionNameForX(player.worldX),
      npc: null
    });
    return;
  }

  // If this conversation was started from a triggered prompt, mark it fired now
  if (currentTriggeredPromptId) {
    const rid = String(currentTriggeredPromptRuleId || '').trim();
    const rule = rid ? stateRuleById.get(rid) : null;
    const persistenceRaw = rule?.dialog?.persistence;
    const persistence = (persistenceRaw == null) ? 1 : Number(persistenceRaw);
    const isInfinite = (isFinite(persistence) && persistence === 0);
    if (!isInfinite && isFinite(persistence)) {
      const prev = firedDialogTriggers.get(currentTriggeredPromptId) || 0;
      firedDialogTriggers.set(currentTriggeredPromptId, prev + 1);
    }
    if (rid) {
      activeStateRuleIds.delete(rid);
    }
    currentTriggeredPromptId = null;
    currentTriggeredPromptRuleId = null;
  }

  // IMPORTANT: some state-only scene rules get unblocked only after conversations end
  if (currentRuleSceneId) {
    const rid = String(currentRuleSceneId);
    triggeredRuleIds.add(rid);

    // Don't clear prompt-active state for prompt rules that also started a scene.
    const r = stateRuleById.get(rid);
    if (!(r && r.dialog)) {
      activeStateRuleIds.delete(rid);
    }

    currentRuleSceneId = null;
  }
    

  evaluateAllStateRules({
    area: currentAreaName,
    section: getSectionNameForX(player.worldX),
    npc: npc.name
  });

}

function endConversation() {
  if (__dialogEndQueueActive) return;
  if (dialogEndQueue && dialogEndQueue.length) {
    __startDialogEndQueue();
    return;
  }
  __resetDialogConversationFlags();
  __finalizeConversationEnd();
}

function canRecruitNpc(npc) {
  if (!npc) return false;
  if (party.includes(npc)) return false;
  if (party.length >= 3) return false;

  const aCur = Number(getActorStatValue(npc?.name || '', 'alignment', 'current') ?? 0);
  const aMinRaw = getActorStatValue(npc?.name || '', 'minalignment', 'base');
  if (aMinRaw == null) return false;
  const aMin = Number(aMinRaw);
  const fCur = Number(getActorStatValue(npc?.name || '', 'affection', 'current') ?? 0);
  return (aCur + fCur) >= aMin;
}


function emitProximityEvent(isEnter, t, extra = null) {
  const ev = isEnter ? 'proximity_enter' : 'proximity_leave';

  if (isEnter && t && t.kind === 'safeplace') {
    lastSafePlace = {
      area: currentAreaName,
      section: getSectionNameForX(t.worldX),
      id: t.id,
      worldX: t.worldX
    };

    // Visiting a safe place clears the "carry these unconscious party members with me if I pass out" list.
    // (Does NOT move or recover them.)
    unconsciousPartyMembers.length = 0;
  }



  const isObject = t && t.kind === 'object';
  const instanceKey = isObject ? makeProxKey(t) : null;
  const canInteract = isObject ? isObjectInteractable(t.id, instanceKey) : undefined;
  const objDef = isObject ? getObjectDef(t.id) : null;
  const hasInteracts = isObject ? partyCanInteractWithObjectDef(objDef) : undefined;

  emitGameEvent(ev, {
    area: currentAreaName,
    section: getSectionNameForX(player.worldX),
    kind: t.kind,
    id: t.id,
    from: (playerCenterX() < t.worldX) ? 'left' : 'right',
    target: t.target,
    npc: (t.kind === 'npc') ? t.id : undefined,
    interactable: canInteract,
    interactsOk: hasInteracts,
    covered: (extra && extra.covered !== undefined) ? !!extra.covered : undefined,
    coveredWas: (extra && extra.coveredWas !== undefined) ? !!extra.coveredWas : undefined,
    __rawProximity: (extra && extra.rawProximity) ? true : undefined
  });


  if (t.kind === 'npc') {
    emitGameEvent(isEnter ? 'npc_proximity' : 'npc_proximity_leave', {
      area: currentAreaName,
      section: getSectionNameForX(player.worldX),
      npc: t.id
    });
  }
}

function emitMobContactEvent(isEnter, mob, targetActor) {
  const ev = isEnter ? 'mob_contact_start' : 'mob_contact_end';

  const td = targetActorDescriptorFromActor(targetActor);

  emitGameEvent(ev, {
    area: currentAreaName,
    section: getSectionNameForX((targetActor && isFinite(targetActor.worldX)) ? targetActor.worldX : player.worldX),
    mob: mob.id,
    mobInstanceId: mob.instanceId,
    targetActor: td,
    npc: (td && td.kind === 'npc') ? td.name : undefined,
    mobState: getActorMovementStateByName(mob.name || mob.instanceId || '') // best-effort; safe if empty
  });
}

function mobPayloadBase(mob, targetActor = null) {
  const td = targetActor ? targetActorDescriptorFromActor(targetActor) : null;

  return {
    area: currentAreaName,
    section: getSectionNameForX((targetActor && isFinite(targetActor.worldX)) ? targetActor.worldX : player.worldX),
    mob: mob.id,
    mobInstanceId: mob.instanceId,
    targetActor: td,
    npc: (td && td.kind === 'npc') ? td.name : undefined
  };
}

// Apply effects using the existing rule/effect pipeline.
function applyMobEffects(effects, mob, extraPayload = null, targetActor = null) {
  if (!Array.isArray(effects) || effects.length === 0) return;
  const payload = {
    ...mobPayloadBase(mob, targetActor),
    sourceActor: targetActorDescriptorFromActor(mob),
    ...(extraPayload || {})
  };
  applyRuleEffects({ effects }, payload);
}

function npcPayloadBase(npc, targetActor = null) {
  const td = targetActor ? targetActorDescriptorFromActor(targetActor) : null;

  return {
    area: currentAreaName,
    section: getSectionNameForX((targetActor && isFinite(targetActor.worldX)) ? targetActor.worldX : player.worldX),
    npc: npc.name,
    targetActor: td
  };
}

function playerPayloadBase(targetActor = null) {
  const td = targetActor ? targetActorDescriptorFromActor(targetActor) : null;
  return {
    area: currentAreaName,
    section: getSectionNameForX((targetActor && isFinite(targetActor.worldX)) ? targetActor.worldX : player.worldX),
    targetActor: td
  };
}

function applyNpcEffects(effects, npc, extraPayload = null, targetActor = null) {
  if (!Array.isArray(effects) || effects.length === 0) return;
  const payload = {
    ...npcPayloadBase(npc, targetActor),
    sourceActor: targetActorDescriptorFromActor(npc),
    ...(extraPayload || {})
  };
  applyRuleEffects({ effects }, payload);
}

function applyPlayerEffects(effects, extraPayload = null, targetActor = null) {
  if (!Array.isArray(effects) || effects.length === 0) return;
  const payload = {
    ...playerPayloadBase(targetActor),
    sourceActor: targetActorDescriptorFromActor(player),
    ...(extraPayload || {})
  };
  applyRuleEffects({ effects }, payload);
}

function getActorKind(actor) {
  if (!actor) return '';
  if (actor === player || lc(actor?.name) === 'player') return 'player';
  if (actor && actor.instanceId && actor.id) return 'mob';
  if (actor && actor.name) return 'npc';
  return '';
}

function tryActorAbilities(actor, nowMs) {
  const list = actor?.abilities;
  if (!Array.isArray(list) || list.length === 0) return;
  if (actorHasTag(actor, 'stunned')) return;

  const autoId = lc(actor.autoCastAbilityId || '');
  if (!autoId) return;

  const kind = getActorKind(actor);
  if (!kind) return;
  const lockUntil = Number(actor.__abilityLockUntilMs || 0);
  if (lockUntil > nowMs) return;

  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a) continue;

    const abilityId = lc(a.id || a.name || `ability_${i}`);
    if (abilityId !== autoId) continue;

    const nextAt = Number(actor.abilityNextAtMs?.[abilityId] || 0);
    if (nowMs < nextAt) continue;

    const fixedTargetsRaw = resolveAbilityFixedTargets(actor, a);
    const tdef = getAbilityTargetingDef(a);

    let target = actor.__attackTargetActor || null;
    if (!fixedTargetsRaw) {
      const candidates = __getAbilityTargetCandidates(actor, a, { priorityOnly: true });
      if (!candidates.length) continue;
      if (target && candidates.includes(target)) {
        // keep
      } else {
        target = candidates[0] || null;
      }
    }

    if (!target && !fixedTargetsRaw && kind === 'mob') target = player;
    if (!target && !fixedTargetsRaw && kind === 'npc') continue;

    const requiresContact = !!(a.requiresContact || a.inContact);
    let contactTargetActor = null;

    if (fixedTargetsRaw) {
      let fixedTargets = fixedTargetsRaw.slice();

      if (requiresContact && kind === 'mob') {
        fixedTargets = fixedTargets.filter(t => {
          const pairKey = contactPairKey(actor.instanceId, t);
          return pairKey && contactInsidePairs.has(pairKey);
        });
      }

      const rangePx = getAbilityRangePx(a, tdef);
      if (isFinite(rangePx) && rangePx > 0) {
        const actorCx = actorCenterX(actor);
        fixedTargets = fixedTargets.filter(t => Math.abs(actorCenterX(t) - actorCx) <= rangePx);
      }

      if (!fixedTargets.length) continue;

      for (const t of fixedTargets) {
        if (!t) continue;
        if (kind === 'mob') {
          emitGameEvent('mob_ability', { ...mobPayloadBase(actor, t), ability: abilityId });
        } else if (kind === 'npc') {
          emitGameEvent('npc_ability', { ...npcPayloadBase(actor, t), ability: abilityId });
        } else if (kind === 'player') {
          emitGameEvent('player_ability', { ...playerPayloadBase(t), ability: abilityId });
        }
      }

      const ok = __applyAbilityEffectsWithTiming(kind, actor, a, fixedTargets, null, nowMs);
      if (!ok) continue;

      if (lc(actor.__forcedTargetAbilityId || '') === abilityId) {
        actor.__forcedTargetKey = null;
        actor.__forcedTargetAbilityId = null;
      }
      return; // one ability per tick per actor
    }

    if (requiresContact) {
      if (kind !== 'mob') {
        if (!target) continue;
      } else {
        const pref = target || player;
        const candidates = [pref, player, ...party];
        for (const cand of candidates) {
          if (!cand) continue;
          const pairKey = contactPairKey(actor.instanceId, cand);
          if (pairKey && contactInsidePairs.has(pairKey)) {
            contactTargetActor = cand;
            break;
          }
        }
      if (!contactTargetActor) continue;
      }
    }

    const rangePx = getAbilityRangePx(a, tdef);
    if (isFinite(rangePx) && rangePx > 0) {
      const actorCx = actorCenterX(actor);
      const tgt = contactTargetActor || target;
      if (!tgt) continue;
      const dx = Math.abs(actorCenterX(tgt) - actorCx);
      if (dx > rangePx) continue;
    }

    if (kind === 'mob') {
      emitGameEvent('mob_ability', { ...mobPayloadBase(actor, contactTargetActor || target), ability: abilityId });
    } else if (kind === 'npc') {
      emitGameEvent('npc_ability', { ...npcPayloadBase(actor, target), ability: abilityId });
    } else if (kind === 'player') {
      emitGameEvent('player_ability', { ...playerPayloadBase(target), ability: abilityId });
    }

    const ok = __applyAbilityEffectsWithTiming(kind, actor, a, contactTargetActor || target, null, nowMs);
    if (!ok) continue;

    if (lc(actor.__forcedTargetAbilityId || '') === abilityId) {
      actor.__forcedTargetKey = null;
      actor.__forcedTargetAbilityId = null;
    }
    return; // one ability per tick per actor
  }
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!isFinite(n)) n = lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function rollInt(min, max) {
  min = clampInt(min, -999999999, 999999999);
  max = clampInt(max, -999999999, 999999999);
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(Math.random() * (max - min + 1));
}

function removeMobInstance(mob) {
  if (!mob) return;

  // If it was in contact, force per-(mob,actor) end events + onEnd hook, and clean up contact state
  const contactActors = [player, ...party];

  // Determine whether this instance currently had ANY contact (for type-level bookkeeping)
  let hadAnyContact = false;

  // Emit end events first (while pair keys still exist)
  for (const a of contactActors) {
    if (!a) continue;

    const pairKey = contactPairKey(mob.instanceId, a);
    if (!pairKey) continue;
    if (!contactInsidePairs.has(pairKey)) continue;

    hadAnyContact = true;

    // emit per (mob,actor) leave
    emitMobContactEvent(false, mob, a);
  }

  // Run onEnd hook while contactInsidePairs still contains the pairs
  if (hadAnyContact) {
    mob.contactNextTickAtMs = 0;
    runMobContactHook(mob, 'end');
  }

  // Now delete all pair keys and decrement pair/type counts
  for (const a of contactActors) {
    if (!a) continue;

    const pairKey = contactPairKey(mob.instanceId, a);
    if (!pairKey) continue;
    if (!contactInsidePairs.has(pairKey)) continue;

    contactInsidePairs.delete(pairKey);

    const typePairKey = `mob:${lc(mob.id)}|${contactActorKeyFromActor(a)}`;
    const prevP = contactTypeCountPairs.get(typePairKey) || 0;
    const nextP = Math.max(0, prevP - 1);
    if (nextP === 0) contactTypeCountPairs.delete(typePairKey);
    else contactTypeCountPairs.set(typePairKey, nextP);
  }

  // Keep TYPE-level rule-facing state in sync (ANY actor counts)
  if (hadAnyContact) {
    const typeKey = `mob:${lc(mob.id)}`;
    const prevT = contactTypeCount.get(typeKey) || 0;
    const nextT = Math.max(0, prevT - 1);
    if (nextT === 0) {
      contactTypeCount.delete(typeKey);
      contactInsideTypes.delete(typeKey);
    } else {
      contactTypeCount.set(typeKey, nextT);
      contactInsideTypes.add(typeKey);
    }
  }

  // Remove from runtime mobs list
  const idx = mobs.indexOf(mob);
  if (idx >= 0) mobs.splice(idx, 1);

  // Best-effort: also remove from the area’s mob list if you keep one there
  if (currentArea && Array.isArray(currentArea.mobs)) {
    const j = currentArea.mobs.indexOf(mob);
    if (j >= 0) currentArea.mobs.splice(j, 1);
  }
}

function despawnMobInstance(mob) {
  if (!mob) return false;

  const now = getGameNowMs();
  const canAnim = actorHasAnimSprite('mob', mob.id, 'despawn');

  // Prevent registry persistence for time-based despawns
  if (mob.instanceId && mobRegistry && mobRegistry[mob.instanceId]) {
    delete mobRegistry[mob.instanceId];
  }

  if (canAnim) {
    setActorTempAnim(mob, 'despawn', 700, now);
    lockActorMovementForMs(mob, 700, now);
    mob._despawning = true;
    mob._removeAtMs = now + 700;
    mob.vx = 0;
    mob.vy = 0;
  } else {
    removeMobInstance(mob);
  }

  return true;
}

function removeWorldNpcInstance(npc) {
  if (!npc) return false;
  const idx = npcs.indexOf(npc);
  if (idx >= 0) npcs.splice(idx, 1);
  if (currentArea && Array.isArray(currentArea.npcs)) {
    const j = currentArea.npcs.indexOf(npc);
    if (j >= 0) currentArea.npcs.splice(j, 1);
  }
  return true;
}

function despawnNpcInstance(npc) {
  if (!npc) return false;
  const now = getGameNowMs();

  // Preserve NPC state in registry
  const rec = ensureNpcRecord(npc.name);
  rec.inParty = false;
  rec.area = currentAreaName;
  rec.worldX = npc.worldX;
  rec.stats = npc.stats || rec.stats;
  rec.inventory = npc.inventory || rec.inventory;
  rec.inventoryUidCounter = npc.inventoryUidCounter || rec.inventoryUidCounter;
  ensureNpcRecordStats(npc.name, rec);

  const canAnim = actorHasAnimSprite('npc', npc.name, 'despawn');
  if (canAnim) {
    setActorTempAnim(npc, 'despawn', 700, now);
    lockActorMovementForMs(npc, 700, now);
    npc._removeAtMs = now + 700;
    npc.vx = 0;
    npc.vy = 0;
  } else {
    removeWorldNpcInstance(npc);
  }

  return true;
}


function applyMobDrops(mob) {
  const drops = mob?.def?.drops;
  if (!Array.isArray(drops) || drops.length === 0) return;

  for (const d of drops) {
    if (!d) continue;

    const itemId = d.id || d.item || d.itemId;
    if (!itemId) continue;

    const chance = Number(d.chance ?? 1);
    if (!isFinite(chance) || chance <= 0) continue;
    if (chance < 1 && Math.random() > chance) continue;

    const qty =
      (d.qty !== undefined) ? Number(d.qty) :
      (d.count !== undefined) ? Number(d.count) :
      rollInt(d.min ?? 1, d.max ?? 1);

    if (!isFinite(qty) || qty <= 0) continue;

    addItemToInventory(itemId, Math.floor(qty));
  }
}

function markSpawnSpecDefeated(mob) {
  if (!mob) return;
  const inst = String(mob.instanceId || '');
  if (!inst) return;
  for (const spec of pendingSpawns || []) {
    if (spec && spec.kind === 'mob' && String(spec.instanceId || '') === inst) {
      spec._blocked = true;
      return;
    }
  }
}

function handleMobDefeatIfNeeded(mob, extraPayload = null) {
  if (!mob) return false;

  const hp = Number(mob?.stats?.hp?.current ?? 0);
  if (!isFinite(hp)) return false;
  if (hp > 0) return false;


  // prevent double-processing
  if (mob._defeated) return true;
  mob._defeated = true;
  markSpawnSpecDefeated(mob);

  emitGameEvent('mob_defeat', { ...mobPayloadBase(mob), ...(extraPayload || {}) });

  // onDefeat effects (support either key)
  const onDefeatEffects =
    (Array.isArray(mob?.def?.onDefeatEffects) ? mob.def.onDefeatEffects : null) ||
    (Array.isArray(mob?.def?.onDefeat) ? mob.def.onDefeat : null);

  if (onDefeatEffects) {
    applyMobEffects(onDefeatEffects, mob, { hook: 'defeat' });
  }

  applyMobDrops(mob);
  
  // Delay removal to allow despawn animation to render
  const now = getGameNowMs();
  mob._removeAtMs = now + 700;
  mob.vx = 0;
  mob.vy = 0;
  return true;

}

function getMobContactEffectsDef(mob) {
  // Support either "contactEffects" (preferred) or "contact" (legacy/alias if you ever used it).
  return mob?.def?.contactEffects || mob?.def?.contact || null;
}

function getContactTickSpec(ce) {
  const ot = ce?.onTick;
  if (!ot) return null;

  // Allow onTick: [effects...] with a default interval
  if (Array.isArray(ot)) {
    return { everyMs: 350, effects: ot };
  }

  // Allow onTick: { everyMs, effects }
  const everyMs = Math.max(50, Number(ot.everyMs ?? ot.ms ?? 350) || 350);
  const effects = Array.isArray(ot.effects) ? ot.effects : null;
  if (!effects || effects.length === 0) return null;
  return { everyMs, effects };
}

function runMobContactHook(mob, hook) {
  const ce = getMobContactEffectsDef(mob);
  if (!ce) return;

  const effects =
    (hook === 'start' && Array.isArray(ce.onStart)) ? ce.onStart :
    (hook === 'end' && Array.isArray(ce.onEnd)) ? ce.onEnd :
    null;

  if (!effects || effects.length === 0) return;

  // Apply per contacted actor so payload.targetActor is correct (player vs specific NPC).
  const targets = [player, ...party];
  for (const a of targets) {
    const pairKey = contactPairKey(mob.instanceId, a);
    if (!pairKey) continue;
    if (!contactInsidePairs.has(pairKey)) continue;

    applyMobEffects(
      effects,
      mob,
      { hook: (hook === 'start') ? 'contactStart' : 'contactEnd' },
      a
    );
  }
}


function runMobContactTick(mob, nowMs) {
  const ce = getMobContactEffectsDef(mob);
  const spec = getContactTickSpec(ce);
  if (!spec) return;

  // Tick while in-contact with ANY actor (pair-level)
  let hasAnyContact = false;
  const targets = [player, ...party];

  for (const a of targets) {
    const pairKey = contactPairKey(mob.instanceId, a);
    if (!pairKey) continue;
    if (!contactInsidePairs.has(pairKey)) continue;
    hasAnyContact = true;
    break;
  }

  if (!hasAnyContact) return;

  if (!isFinite(mob.contactNextTickAtMs) || mob.contactNextTickAtMs <= 0) {
    mob.contactNextTickAtMs = nowMs + spec.everyMs;
    return;
  }

  if (nowMs < mob.contactNextTickAtMs) return;

  // Apply to each contacted actor
  for (const a of targets) {
    const pairKey = contactPairKey(mob.instanceId, a);
    if (!pairKey) continue;
    if (!contactInsidePairs.has(pairKey)) continue;
    applyMobEffects(spec.effects, mob, { hook: 'contactTick' }, a);
  }

  mob.contactNextTickAtMs = nowMs + spec.everyMs;
}


function tryMobAbilities(mob, nowMs) {
  return tryActorAbilities(mob, nowMs);
}


function addNpcToPartyInternal(npc, opts = {}) {
  if (!npc) return false;

  const {
    index = null,          // null => push at end
    emit = true,
    bypassChecks = false,  // used by action scenes
    fromWorld = true       // remove from npcs by name
  } = opts;

  // Already in party?
  if (party.includes(npc)) return false;

  // If they were previously knocked out, re-recruiting clears any "unconscious" tracking
  __listRemoveName(unconsciousPartyMembers, npc.name);
  unconsciousNpcFalls.delete(lc(npc.name));
  npc._passedOut = false;


  if (!bypassChecks) {
    if (!canRecruitNpc(npc)) return false;
  }


  // Remove from world list (by instance + any other copies by name)
  if (fromWorld) {
    const idx = npcs.indexOf(npc);
    if (idx >= 0) npcs.splice(idx, 1);

    const npcKey = lc(npc.name);
    for (let i = npcs.length - 1; i >= 0; i--) {
      if (lc(npcs[i]?.name) === npcKey) {
        npcs.splice(i, 1);
      }
    }

  }

  npc.isChasing = false;
  npc.followSpeed = 0;
  // Party members should not auto-cast by default
  npc.autoCastAbilityId = null;

  // Insert at index (or push)
  if (index === null || index === undefined || index < 0 || index > party.length) {
    party.push(npc);
  } else {
    party.splice(index, 0, npc);
  }

  // Keep your existing offset behavior
  npc.offsetX = 24 + party.length * 24;

  // Registry + event
  const rec = ensureNpcRecord(npc.name);
  rec.inParty = true;
  rec.hasBeenInParty = true; // NEW: once they join, this stays true forever

  rec.met = true;
  if (!rec.firstMetAt) rec.firstMetAt = Date.now();
  rec.lastSeenArea = currentAreaName ?? rec.lastSeenArea ?? null;
  rec.lastSeenWorldX = (npc && typeof npc.worldX === 'number') ? npc.worldX : (rec.lastSeenWorldX ?? null);
  rec.lastSeenAt = Date.now();

  rec.stats = npc.stats || rec.stats;
  ensureNpcRecordStats(npc.name, rec);

  rebuildActorItemGrants(npc);



  if (emit) {
    emitGameEvent('party_join', { area: currentAreaName, npc: npc.name });

    // Let the joining NPC react to existing party members
    // for (const p of party) {
    //   if (p.name === npc.name) continue;
    //   applyRulesForNpc(npc.name, 'party_join', { npc: p.name });
    // }
  }

  return true;
}

function getInteractableInstance(kind, id) {
  const typeKey = makeProxTypeKey({ kind, id });
  const instanceKey = proximityInteractFocus.get(typeKey);
  if (!instanceKey) return null;
  return instanceKey;
}


// Returns the previous index in party (or -1 if not in party)
function removeNpcFromPartyInternal(npc, opts = {}) {
  if (!npc) return -1;

  const {
    emit = true,
    toWorld = true,
    reason = null
  } = opts;

  const idx = party.indexOf(npc);
  if (idx < 0) return -1;

  party.splice(idx, 1);

  // Update registry
  const rec = ensureNpcRecord(npc.name);
  rec.inParty = false;

  rec.met = true;
  if (!rec.firstMetAt) rec.firstMetAt = Date.now();
  rec.lastSeenArea = currentAreaName;
  rec.lastSeenWorldX = npc.worldX;
  rec.lastSeenAt = Date.now();

  rec.area = currentAreaName;
  rec.worldX = npc.worldX;
  rec.stats = npc.stats || rec.stats;
  ensureNpcRecordStats(npc.name, rec);

  // If they passed out, remember them as an "unconscious party member" until the player visits a safe place.
  // Also start the "left unconscious for a full day" timer regardless of safe-place visits.
  if (reason === 'pass_out') {
    if (!__listHasName(unconsciousPartyMembers, npc.name)) {
      unconsciousPartyMembers.push(npc.name);
    }

    const info = getWorldTimeInfo(WORLD_TIME_MIN);
    unconsciousNpcFalls.set(lc(npc.name), {
      name: npc.name,
      area: currentAreaName,
      worldX: npc.worldX,
      dayIndex: info?.dayIndex
    });
  }


  if (toWorld) {
    // Put the NPC back into world NPCs at their current position
    npcs.push(npc);
  }

  if (emit) {
    emitGameEvent('party_leave', {
      area: currentAreaName,
      npc: npc.name,
      reason
    });
  }

  // Reset chase behavior so they don't auto-follow anymore
  npc.isChasing = false;
  npc.followSpeed = 0;
  npc.offsetX = 0;

  return idx;
}


function recruitNpcToParty(npc) {
  addNpcToPartyInternal(npc, {
    index: null,
    emit: true,
    bypassChecks: false,
    fromWorld: true
  });
}


function removeNpcFromParty(npc) {
  removeNpcFromPartyInternal(npc, {
    emit: true,
    toWorld: true
  });
}


function isMovementKeyCode(code) {
  return (
    code === 'ArrowLeft' || code === 'ArrowRight' ||
    code === 'ArrowUp'   || code === 'ArrowDown'
  );
}

function triggerCurrentObjectInteract() {
  if (!currentObjectInteract) {
    return false;
  }
  const nowMs = getGameNowMs();
  if (nowMs < nextObjectInteractAtMs) return false;
  const ok = __beginObjectInteraction(currentObjectInteract.typeId, currentObjectInteract.instanceKey);
  if (ok) nextObjectInteractAtMs = nowMs + OBJECT_INTERACT_COOLDOWN_MS;
  return ok;
}

function pickupWorldItem(instanceKey) {
  const item = getWorldItemByInstanceKey(instanceKey);
  if (!item || !isWorldItemAvailable(item)) return false;

  if (!hasActorInventorySpace(player)) {
    showPlayerMenuError('Inventory is full.');
    return false;
  }

  const qty = Math.max(1, Math.floor(Number(item.qty || 1)));
  const added = addItemToActorInventory(player, item.itemId, qty);
  if (!added) return false;

  const flagKey = worldItemPickedFlagKey(item.instanceKey);
  if (flagKey) setFlag('global', flagKey, true);
  item._picked = true;

  const instKey = item.instanceKey;
  if (instKey && proximityInside.has(instKey)) {
    proximityInside.delete(instKey);
    proximityInsideRaw.delete(instKey);
    proximityTargetByKey.delete(instKey);

    const typeKey = makeProxTypeKey({ kind: 'item', id: item.itemId });
    if (proximityInteractFocus.get(typeKey) === instKey) {
      proximityInteractFocus.delete(typeKey);
    }

    const prev = proximityTypeCount.get(typeKey) || 0;
    const next = Math.max(0, prev - 1);
    if (next === 0) {
      proximityTypeCount.delete(typeKey);
      proximityInsideTypes.delete(typeKey);
    } else {
      proximityTypeCount.set(typeKey, next);
    }
  }

  if (currentItemInteract && currentItemInteract.instanceKey === instKey) {
    currentItemInteract = null;
  }
  return true;
}

function triggerCurrentItemInteract() {
  if (!currentItemInteract) return false;
  return pickupWorldItem(currentItemInteract.instanceKey);
}

function triggerCurrentInteract() {
  if (currentObjectInteract && triggerCurrentObjectInteract()) return true;
  if (currentItemInteract && triggerCurrentItemInteract()) return true;
  return false;
}



// ===== Key handling =====
const keys = {};
window.addEventListener('keydown', (e) => {

  if (e.code === 'Enter') {
    const evt = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      repeat: e.repeat,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(evt);
    e.preventDefault();
    return;
  }

  if (inConversation && isTypingDialog) {
    cancelDialogTyping = true;
    e.preventDefault();
    return;
  }

  if (mapOverlayOpen) {
    if (e.code === 'Escape' || e.code === 'KeyM' || e.code === 'KeyX') {
      setMapOverlayOpen(false, false);
    }
    if (e.code === 'ArrowLeft') { mapPanX += 40; }
    if (e.code === 'ArrowRight') { mapPanX -= 40; }
    if (e.code === 'ArrowUp') { mapPanY += 40; }
    if (e.code === 'ArrowDown') { mapPanY -= 40; }
    if (e.code === 'KeyM' && e.shiftKey) { setMapOverlayOpen(true, true); }
    e.preventDefault();
    return;
  }

  if (e.code === 'KeyM' && !inMenu && !inConversation && !inActionPhrase && !controlsLocked && !isPlayerStunned()) {
    if (!e.shiftKey && !canOpenMapOverlay()) return;
    setMapOverlayOpen(true, !!e.shiftKey);
    e.preventDefault();
    return;
  }

  // Menu input eats keys (prevents movement, recruiting, exits, etc.)
  if (inMenu) {
    if (inManualTargeting) {
      // Cancel / exit
      if (e.code === 'Escape' || e.code === 'KeyX') {
        endManualTargeting({ closeAll: true });
        e.preventDefault();
        return;
      }

      // Return to menu pages
      if (e.code === 'KeyM' && isMenuPageVisible('party')) { endManualTargeting({ openMenuPageId: 'party' }); e.preventDefault(); return; }
      if (e.code === 'KeyP' && isMenuPageVisible('party')) { endManualTargeting({ openMenuPageId: 'party' }); e.preventDefault(); return; }
      if (e.code === 'KeyA' && isMenuPageVisible('abilities')) { endManualTargeting({ openMenuPageId: 'abilities' }); e.preventDefault(); return; }
      if (e.code === 'KeyI' && isMenuPageVisible('items')) { endManualTargeting({ openMenuPageId: 'items' }); e.preventDefault(); return; }
      if (e.code === 'KeyC' && isMenuPageVisible('npcs')) { endManualTargeting({ openMenuPageId: 'npcs' }); e.preventDefault(); return; }
      if (e.code === 'KeyJ' && isMenuPageVisible('journal')) { endManualTargeting({ openMenuPageId: 'journal' }); e.preventDefault(); return; }

      // Confirm
      if (e.code === 'Enter' || e.code === 'Space') {
        confirmManualTargetingSelection();
        e.preventDefault();
        return;
      }

      // Cycle targets
      if (manualTargetingState && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
        const dir = (e.code === 'ArrowLeft' || e.code === 'ArrowUp') ? -1 : 1;
        const len = manualTargetingState.candidates.length;
        if (len > 0) {
          const cur = manualTargetingState.selectedIndex || 0;
          manualTargetingState.selectedIndex = (cur + dir + len) % len;
        }
        e.preventDefault();
        return;
      }

      e.preventDefault();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyX') {
      closePlayerMenu();
      e.preventDefault();
      return;
    }

    // Left/Right: cycle elements on active page
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const dir = (e.code === 'ArrowRight') ? 1 : -1;
      if (activeMenuPageId === 'party') {
        const members = [player].concat(Array.isArray(party) ? party : []);
        const len = members.length;
        if (len > 0) {
          partyMenuSelectedIndex = (partyMenuSelectedIndex + dir + len) % len;
          partyMenuCardIndex = 0;
          renderPlayerMenu();
        }
      } else if (activeMenuPageId === 'npcs') {
        const entries = Object.entries(npcRegistry || {})
          .filter(([_, rec]) => !!(rec?.met || rec?.hasBeenInParty));
        const names = entries.map(([name]) => name).filter(n => lc(n) !== 'player');
        names.sort((a, b) => a.localeCompare(b));
        const len = names.length;
        if (len > 0) {
          npcMenuSelectedIndex = (npcMenuSelectedIndex + dir + len) % len;
          npcMenuCardIndex = 0;
          renderPlayerMenu();
        }
      }
      e.preventDefault();
      return;
    }

    // Up/Down: cycle character sub-cards
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      if (activeMenuPageId === 'party') {
        const dir = (e.code === 'ArrowDown') ? 1 : -1;
        partyMenuPrevCardIndex = partyMenuCardIndex;
        partyMenuCardSlideDir = dir;
        partyMenuCardIndex = (partyMenuCardIndex + dir + 4) % 4;
        partyMenuCardAnimUntilMs = performance.now() + 1000;
        renderPlayerMenu();
      } else if (activeMenuPageId === 'npcs') {
        const dir = (e.code === 'ArrowDown') ? 1 : -1;
        npcMenuPrevCardIndex = npcMenuCardIndex;
        npcMenuCardSlideDir = dir;
        npcMenuCardIndex = (npcMenuCardIndex + dir + 4) % 4;
        npcMenuCardAnimUntilMs = performance.now() + 1000;
        renderPlayerMenu();
      } else if (activeMenuPageId === 'abilities') {
        const len = abilitiesMenuEntries.length;
        if (len > 0) {
          const dir = (e.code === 'ArrowDown') ? 1 : -1;
          abilitiesMenuSelectedIndex = (abilitiesMenuSelectedIndex + dir + len) % len;
          renderPlayerMenu();
        }
      }
      e.preventDefault();
      return;
    }

    if ((e.code === 'Enter' || e.code === 'Space') && activeMenuPageId === 'abilities') {
      const entry = abilitiesMenuEntries[abilitiesMenuSelectedIndex];
      triggerAbilityFromEntry(entry);
      e.preventDefault();
      return;
    }

    // Open menu directly to Items
    if (e.code === 'KeyI') {
      if (!isMenuPageVisible('items')) { e.preventDefault(); return; }
      if (activeMenuPageId === 'items') { closePlayerMenu(); e.preventDefault(); return; }
      setActiveMenuPage('items');
      e.preventDefault();
      return;
    }

    // Open menu directly to Party
    if (e.code === 'KeyP') {
      if (!isMenuPageVisible('party')) { e.preventDefault(); return; }
      if (activeMenuPageId === 'party') { closePlayerMenu(); e.preventDefault(); return; }
      setActiveMenuPage('party');
      e.preventDefault();
      return;
    }

    // Open menu directly to Abilities
    if (e.code === 'KeyA') {
      if (!isMenuPageVisible('abilities')) { e.preventDefault(); return; }
      if (activeMenuPageId === 'abilities') { closePlayerMenu(); e.preventDefault(); return; }
      setActiveMenuPage('abilities');
      e.preventDefault();
      return;
    }

    // Open menu directly to Characters
    if (e.code === 'KeyC') {
      if (!isMenuPageVisible('npcs')) { e.preventDefault(); return; }
      if (activeMenuPageId === 'npcs') { closePlayerMenu(); e.preventDefault(); return; }
      setActiveMenuPage('npcs');
      e.preventDefault();
      return;
    }

    // Open menu directly to Journal
    if (e.code === 'KeyJ') {
      if (!isMenuPageVisible('journal')) { e.preventDefault(); return; }
      if (activeMenuPageId === 'journal') { closePlayerMenu(); e.preventDefault(); return; }
      setActiveMenuPage('journal');
      e.preventDefault();
      return;
    }

    if (activeMenuPageId === 'items' && e.code.startsWith('Digit')) {
      const n = parseInt(e.code.replace('Digit', ''), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 9) {
        const slot = itemsMenuHotkeys[n - 1];

        if (!slot || !slot.id) {
          showPlayerMenuError('No item assigned to that slot.');
        } else {
          if (e.shiftKey) {
            const res = beginManualItemGiveTargeting(slot.id, slot.uid);
            if (!res) showPlayerMenuError('No valid targets to give to.');
          } else {
            tryUseItemWithFeedback(slot.id, slot.uid);
          }
        }

        e.preventDefault();
        return;
      }
    }

    if (activeMenuPageId === 'party' && partyMenuCardIndex === 1 && e.code.startsWith('Digit')) {
      const n = parseInt(e.code.replace('Digit', ''), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 9) {
        const members = [player].concat(Array.isArray(party) ? party : []);
        const actor = members[partyMenuSelectedIndex];
        const abilities = Array.isArray(actor?.abilities) ? actor.abilities : [];
        const ability = abilities[n - 1];
        if (!actor || !ability || !ability.id) {
          e.preventDefault();
          return;
        }

        if (e.shiftKey) {
          toggleActorAutoCast(actor, ability.id);
          renderPlayerMenu();
        } else {
          const actorName = (actor === player) ? 'player' : actor.name;
          const res = beginManualTargeting(actorName, ability.id);
          if (res === 'started') {
            e.preventDefault();
            return;
          }
          if (res === 'casted') {
            closePlayerMenu();
            renderPlayerMenu();
            e.preventDefault();
            return;
          }
        }
        e.preventDefault();
        return;
      }
    }

    if (activeMenuPageId === 'party' && partyMenuCardIndex === 2 && e.code.startsWith('Digit')) {
      const n = parseInt(e.code.replace('Digit', ''), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 9) {
        const members = [player].concat(Array.isArray(party) ? party : []);
        const actor = members[partyMenuSelectedIndex];
        const cards = getActorInventoryCards(actor);
        const entry = cards[n - 1];
        if (!entry || !entry.id) {
          showPlayerMenuError('No item assigned to that slot.');
          e.preventDefault();
          return;
        }

        if (e.shiftKey) {
          const res = beginManualItemGiveTargetingForActor(actor, entry.id, entry.uid);
          if (!res) showPlayerMenuError('No valid targets to give to.');
        } else {
          const def = getItemDef(entry.id);
          const hasTargeting = !!(def && (def.fixedTarget || def?.targeting));
          if (hasTargeting) {
            const res = beginManualItemTargetingForActor(actor, entry.id, entry.uid);
            if (res === 'casted') {
              renderPlayerMenu();
            }
          } else {
            const ok = tryUseActorItemWithFeedback(actor, entry.id, entry.uid);
            if (ok) renderPlayerMenu();
          }
        }

        e.preventDefault();
        return;
      }
    }

    if (activeMenuPageId === 'abilities' && e.code.startsWith('Digit')) {
      const n = parseInt(e.code.replace('Digit', ''), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 9) {
        const slot = abilitiesMenuHotkeys[n - 1];
        if (!slot || !slot.abilityId || !slot.actorName) {
          e.preventDefault();
          return;
        }

        if (e.shiftKey) {
          const actor =
            (lc(slot.actorName) === 'player' || lc(slot.actorName) === lc(player?.name || ''))
              ? player
              : party.find(n => n && lc(n.name) === lc(slot.actorName));
          toggleActorAutoCast(actor, slot.abilityId);
          renderPlayerMenu();
        } else {
          const res = beginManualTargeting(slot.actorName, slot.abilityId);
          if (res === 'started') {
            e.preventDefault();
            return;
          }
          if (res === 'casted') {
            closePlayerMenu();
            renderPlayerMenu();
            e.preventDefault();
            return;
          }
        }
        e.preventDefault();
        return;
      }
    }


    e.preventDefault();
    return;
  }



  // During action phrases, treat gameplay keys as completely dead:
  // don't even set keys[e.code] = true, because update() reads it.
  if (inConversation && inActionPhrase) {
  // Only block gameplay keys if this action locks the player
    if (activeAction?.lockPlayer !== false) {
      e.preventDefault();
      return;
    }
    // else: allow key state to be recorded for movement
  }

  
  keys[e.code] = true;
  if (loading) return;

  if ((controlsLocked || isPlayerStunned()) && !inConversation) return;

  // Triggered dialog prompts:
  // - Party NPC prompts: Digit1..Digit9 (assigned 1,2,3...)
  // - World NPC prompts: handled by T (see below)
  if (!inConversation && !e.shiftKey && e.code.startsWith('Digit')) {
    const n = parseInt(e.code.replace('Digit', ''), 10);
    if (!Number.isFinite(n) || n <= 0) return;

    let count = 0;
    for (let i = 0; i < activeDialogPrompts.length; i++) {
      const p = activeDialogPrompts[i];
      if (!p || !p.npc) continue;

      // Digits only apply to NPCs currently in the party
      if (!party.includes(p.npc)) continue;

      if (Number.isFinite(p.keyNum) && p.keyNum === n) {
        void startTriggeredDialog(i);
        return;
      }
    }


    return;
  }

  

  if (inConversation) {
    if (inActionPhrase) {
      // During action phrases, ignore all key input (no skipping / no advancing)
      return;
    }

    // If a rule-triggered scene is still loading its dialog JSON, ignore key-repeat.
    if (!currentDialog) {
      return;
    }
    
    // While we are waiting for the next portrait to load, ignore everything except X
    if (__dialogAwaitingPortrait) {
      if (e.code === 'KeyX') { cancelConversation(); return; }
      e.preventDefault();
      return;
    }

    if (e.code === 'KeyX') { cancelConversation(); return; }

    if (dialogOptionsMap && Object.keys(dialogOptionsMap).length > 0) {
      if (e.code.startsWith('Digit')) {
        const idx = parseInt(e.code.replace('Digit', ''));
        if (Number.isFinite(idx)) {
          selectDialogOptionByIndex(idx);
          return;
        }
        const opt = dialogOptionsMap[idx];
        if (!opt) return;
        optionsBox.innerHTML = '';
        dialogOptionsMap = null;

        //
        // APPLY EFFECTS (dialog option)
        //
        if (currentNpc) {
          // Backward-compat: convert legacy fields into effects
          const merged = [];

          if (Array.isArray(opt.effects)) merged.push(...opt.effects);

          applyEffects(merged);

          emitGameEvent('dialog_option', {
            area: currentAreaName,
            section: getSectionNameForX(player.worldX),
            npc: currentNpc.name,
            phrase: currentPhraseId,
            optionId: opt.optionId
          });
        }



        //
        // HANDLE NEXT
        //
        let next = opt.next;

        // CASE 1 — simple string
        if (typeof next === 'string') {
          optionsBox.innerHTML = '';
          dialogOptionsMap = null;
          void loadPhrase(next);
          return;

        }


        // CASE 2 — branching object (evaluate conditional branches first)
        if (next && typeof next === 'object') {
          const entries = Object.entries(next);

          // Put branches that have a non-empty `when` first; empty/no-when last (fallback)
          entries.sort((a, b) => {
            const wa = a[1]?.when && Object.keys(a[1].when).length > 0 ? 0 : 1;
            const wb = b[1]?.when && Object.keys(b[1].when).length > 0 ? 0 : 1;
            return wa - wb;
          });

          for (const [branchName, branch] of entries) {
            const w = branch?.when || {};
            if (checkWhenBlock(w, currentNpc)) {
              optionsBox.innerHTML = '';
              dialogOptionsMap = null;
              void loadPhrase(branchName);
              return;
            }
          }

          endConversation();
          return;
        }


        // CASE 3 — no next
        endConversation();
        return;
      }
    } else {
      if (inViewMode) { endConversation(); return; }
      else if (currentDialog && currentPhraseId) {
        // Don't let movement keys count as "press any key to continue"
        if (!dialogOptionsMap || Object.keys(dialogOptionsMap).length === 0) {
          if (isMovementKeyCode(e.code)) return;
        }

        const phrase = currentDialog.phrases[currentPhraseId];
        const next = phrase?.next;

        //applyEffects(phrase?.effects);

        // CASE 1 — simple string
        if (typeof next === 'string') {
          optionsBox.innerHTML = '';
          dialogOptionsMap = null;
          void loadPhrase(next);
          return;
        }


        // CASE 2 — conditional branches (evaluate conditional branches first)
        if (next && typeof next === 'object') {
          const entries = Object.entries(next);

          // Put branches that have a non-empty `when` first; empty/no-when last (fallback)
          entries.sort((a, b) => {
            const wa = a[1]?.when && Object.keys(a[1].when).length > 0 ? 0 : 1;
            const wb = b[1]?.when && Object.keys(b[1].when).length > 0 ? 0 : 1;
            return wa - wb;
          });

          for (const [branchName, branch] of entries) {
            const w = branch?.when || {};
            if (checkWhenBlock(w, currentNpc)) {
              optionsBox.innerHTML = '';
              dialogOptionsMap = null;
              void loadPhrase(branchName);
              return;
            }

          }

          endConversation();
          return;
        }


        // CASE 3 — no next
        endConversation();
      }
      else endConversation();
    }
    return;
  }
  
  // NEW: hard block all gameplay controls when locked
  if ((controlsLocked || isPlayerStunned()) && !inConversation) {
    return;
  }


  // Not in conversation: game controls
  if (e.code === 'KeyT') {
    // If any WORLD NPC (not in party) has a dialog prompt, trigger the closest one.
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < activeDialogPrompts.length; i++) {
      const p = activeDialogPrompts[i];
      if (!p || !p.npc) continue;

      // Only world NPCs (not in party) use T
      if (party.includes(p.npc)) continue;

      const dx = Math.abs(
        (player.worldX + player.w * 0.5) - (p.npc.worldX + p.npc.w * 0.5)
      );

      if (dx < bestDist) {
        bestDist = dx;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      void startTriggeredDialog(bestIdx);
      return;
    }

    // Fallback: if no world prompt exists, keep old behavior (talk to currentTrigger)
    if (currentTrigger) {
      startConversation(currentTrigger);
      return;
    }
  }

  // Object interaction (Space / Enter)
  if (e.code === 'Space' || e.code === 'Enter') {
    if (!currentObjectInteract && !currentItemInteract) {
      // no interact target => allow Space to be used for jump as usual
    } else {
      if (triggerCurrentInteract()) {
        e.preventDefault();
        return;
      }
    }
  }



  if (e.code === 'KeyV' && currentTrigger) {
    wasMenuOpenBeforeDialog = !!inMenu;
    if (inMenu) closePlayerMenu();
    hideMenuTabsForDialog();
    inViewMode = true;
    inConversation = true;
    currentNpc = currentTrigger;
    promptEl.style.display = 'none';
    conversationPortrait.src = `assets/portraits/character_portrait_${lc(currentNpc.name)}_neutral.png`;
    __setDialogBoxText(
      `Name: ${currentNpc.name}\nAlignment: ${Number(getActorStatValue(currentNpc?.name || '', 'alignment', 'current') ?? 0)} / ${Number(getActorStatValue(currentNpc?.name || '', 'minalignment', 'base') ?? 0)}\nAffection: ${Number(getActorStatValue(currentNpc?.name || '', 'affection', 'current') ?? 0)} / ${Number(getActorStatValue(currentNpc?.name || '', 'minaffection', 'base') ?? 0)}`
    );
    optionsBox.innerHTML = '<div>Press X to close</div>';
    conversationOverlay.style.display = 'block';
    return;
  }

  // Recruit with R
  if (e.code === 'KeyR' && currentTrigger) {
    recruitNpcToParty(currentTrigger);
    currentTrigger = null;
    promptEl.style.display = 'none';
  }


  if (e.code === 'KeyN') {
    if (e.shiftKey) {
      showNames = true;
      showRangeIndicators = true;
    } else {
      showNames = !showNames;
      if (showRangeIndicators) showRangeIndicators = false;
    }
  }

  // Open menu directly to Items
  if (!inConversation && !loading && e.code === 'KeyI') {
    if (!isMenuPageVisible('items')) return;
    togglePlayerMenu('items');
    e.preventDefault();
    return;
  }

  // Open menu directly to Party
  if (!inConversation && !loading && e.code === 'KeyP') {
    if (!isMenuPageVisible('party')) return;
    togglePlayerMenu('party');
    e.preventDefault();
    return;
  }

  // Open menu directly to Abilities
  if (!inConversation && !loading && e.code === 'KeyA') {
    if (!isMenuPageVisible('abilities')) return;
    togglePlayerMenu('abilities');
    e.preventDefault();
    return;
  }

  // Open menu directly to Characters
  if (!inConversation && !loading && e.code === 'KeyC') {
    if (!isMenuPageVisible('npcs')) return;
    togglePlayerMenu('npcs');
    e.preventDefault();
    return;
  }

  // Open menu directly to Journal
  if (!inConversation && !loading && e.code === 'KeyJ') {
    if (!isMenuPageVisible('journal')) return;
    togglePlayerMenu('journal');
    e.preventDefault();
    return;
  }


  if (e.shiftKey) {
    let removeIndex = null;
    if (e.code === 'Digit1') removeIndex = 0;
    else if (e.code === 'Digit2') removeIndex = 1;
    else if (e.code === 'Digit3') removeIndex = 2;
    if (removeIndex !== null && removeIndex < party.length) {
    
      const removed = party[removeIndex];
      removeNpcFromParty(removed);

      if (currentTrigger === removed) {
        currentTrigger = null;
        promptEl.style.display = 'none';
      }

    }
  }

  // Exit usage keys (when near exits)
  if (e.code === 'ArrowUp' && currentExitUp) {
    tryUseExit(currentExitUp);
  }
  if (e.code === 'ArrowDown' && currentExitDown) {
    tryUseExit(currentExitDown);
  } 

});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Enter') {
    const evt = new KeyboardEvent('keyup', {
      code: 'Space',
      key: ' ',
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(evt);
    e.preventDefault();
    return;
  }
  keys[e.code] = false;
});
window.addEventListener('resize', () => {
  renderMenuTabs(menuTopTabs, !inMenu, true);
  if (inMenu) renderPlayerMenu();
});

// Minimum 44 CSS-pixel tap areas for world-space icons on touchscreens.
function canvasHitTest(sx, sy, r) {
  if (!r) return false;
  let padX = 0, padY = 0;
  if (document.documentElement.classList.contains('touch-enabled')) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width && rect.height) {
      padX = Math.max(0, (44 * canvas.width / rect.width - r.w) / 2);
      padY = Math.max(0, (44 * canvas.height / rect.height - r.h) / 2);
    }
  }
  return sx >= r.x - padX && sx <= r.x + r.w + padX &&
         sy >= r.y - padY && sy <= r.y + r.h + padY;
}

window.addEventListener('mousemove', (e) => {
  if (!manualTargetingDragTile) return;
  const rect = viewportEl?.getBoundingClientRect();
  if (rect) {
    manualTargetingDragTile.style.left = `${e.clientX - rect.left + 8}px`;
    manualTargetingDragTile.style.top = `${e.clientY - rect.top + 8}px`;
  } else {
    manualTargetingDragTile.style.left = `${e.clientX + 8}px`;
    manualTargetingDragTile.style.top = `${e.clientY + 8}px`;
  }

  if (canvas) {
    const cRect = canvas.getBoundingClientRect();
    const sx = (e.clientX - cRect.left) * (canvas.width / cRect.width);
    const sy = (e.clientY - cRect.top) * (canvas.height / cRect.height);
    manualTargetingMouse.x = sx;
    manualTargetingMouse.y = sy;
    manualTargetingMouse.has = true;
    if (inManualTargeting) updateManualTargetingHover();
  }
});

window.addEventListener('mouseup', (e) => {
  if (!manualTargetingDragTile) return;
  const st = manualTargetingState;
  const hoverOk = !!st && Number.isFinite(st.hoverIndex) && st.hoverIndex >= 0;
  if (hoverOk) {
    confirmManualTargetingSelection();
  } else if (st) {
    endManualTargeting({ openMenuPageId: st.returnPageId });
  }
  hideManualTargetingDragTile();
  e.preventDefault();
});

if (canvas) {
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    manualTargetingMouse.x = sx;
    manualTargetingMouse.y = sy;
    manualTargetingMouse.has = true;
    if (inManualTargeting) updateManualTargetingHover();
  });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (inManualTargeting) {
      manualTargetingMouse.x = sx;
      manualTargetingMouse.y = sy;
      manualTargetingMouse.has = true;
      updateManualTargetingHover();
      confirmManualTargetingSelection();
      e.preventDefault();
      return;
    }

    // Prompt bubble click => talk
    for (const p of __lastPromptLayouts) {
      if (!p) continue;
      if (canvasHitTest(sx, sy, p)) {
        if (Number.isFinite(p.promptIndex)) {
          void startTriggeredDialog(p.promptIndex);
          e.preventDefault();
          return;
        }
      }
    }

    // Recruit icon click
    for (const r of __lastRecruitIcons) {
      if (!r) continue;
      if (canvasHitTest(sx, sy, r)) {
        recruitNpcToParty(r.npc);
        e.preventDefault();
        return;
      }
    }

    // Interaction icon/object click
    if (__lastInteractIconRect) {
      const r = __lastInteractIconRect;
      if (canvasHitTest(sx, sy, r)) {
        if (triggerCurrentInteract()) {
          e.preventDefault();
          return;
        }
      }
    }
    if (__lastInteractObjectRect) {
      const r = __lastInteractObjectRect;
      if (canvasHitTest(sx, sy, r)) {
        if (triggerCurrentInteract()) {
          e.preventDefault();
          return;
        }
      }
    }
    if (__lastInteractItemRect) {
      const r = __lastInteractItemRect;
      if (canvasHitTest(sx, sy, r)) {
        if (triggerCurrentInteract()) {
          e.preventDefault();
          return;
        }
      }
    }

    // Exits can be tapped directly on their existing world icons.
    if (document.documentElement.classList.contains('touch-enabled') &&
        __lastExitIconRect && canvasHitTest(sx, sy, __lastExitIconRect)) {
      const exit = currentExitUp || currentExitDown;
      if (exit) {
        tryUseExit(exit);
        e.preventDefault();
        return;
      }
    }

    // NPC click => talk (prefer prompt if available)
    const clickActors = [];
    for (const npc of npcs) if (npc) clickActors.push(npc);
    for (const p of party) if (p && p !== player) clickActors.push(p);

    for (const npc of clickActors) {
      const x = npc.worldX - cameraX;
      const y = npc.y;
      const w = Number(npc.w) || 0;
      const h = Number(npc.h) || 0;
      if (sx >= x && sx <= x + w && sy >= y && sy <= y + h) {
        let bestIdx = -1;
        let bestKey = Infinity;
        for (let i = 0; i < activeDialogPrompts.length; i++) {
          const p = activeDialogPrompts[i];
          if (!p || p.npc !== npc) continue;
          const keyNum = Number.isFinite(p.keyNum) ? p.keyNum : 9999;
          if (keyNum < bestKey) {
            bestKey = keyNum;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0) {
          void startTriggeredDialog(bestIdx);
        } else if (npcs.includes(npc)) {
          startConversation(npc);
        }
        e.preventDefault();
        return;
      }
    }
  });
}

function updateCamera() {
  if (!currentArea) return;

  // If a camera tween is active, it fully controls cameraX + cameraZoom
  if (CAMERA_TWEEN.active) {
    updateCameraTween();
    return;
  }

  const vw = cameraViewportW();
  const screenCenterX = vw * 0.5;
  const deadZone = vw * 0.05;

  // Manual camera: stay centered on the chosen world center
  if (cameraMode === 'manual' && isFinite(cameraManualCenterX)) {
    cameraX = clampCameraX(Number(cameraManualCenterX) - vw * 0.5);
    return;
  }

  // Follow camera: follow chosen target (default player)
  const targetCenterX = getTargetCenterXFromSpec(cameraTargetSpec);
  if (!isFinite(targetCenterX)) {
    cameraTargetSpec = { type: 'player' };
  }
  const cX = isFinite(targetCenterX) ? targetCenterX : (player.worldX + player.w * 0.5);

  const minX = cameraX + (screenCenterX - deadZone);
  const maxX = cameraX + (screenCenterX + deadZone);

  if (cX < minX) {
    cameraX = cX - (screenCenterX - deadZone);
  } else if (cX > maxX) {
    cameraX = cX - (screenCenterX + deadZone);
  }

  cameraX = clampCameraX(cameraX);
}

function __dialogHasPhrase(startRef, defaultNpcName) {
  const { fileKey, phraseId } = __parseDialogStartRef(startRef, defaultNpcName);
  if (!fileKey || !phraseId) return false;
  const d = dialogs?.[fileKey];
  if (!d) return false;
  return !!d?.phrases?.[phraseId];
}

function __resolvePendingPassoutRescuePrompt() {
  const job = __pendingPassoutRescue;
  if (!job) return;

  // Warm all candidate dialogs
  for (const nm of (job.candidates || [])) {
    __kickDialogWarm(lc(nm));
  }

  // Who is eligible right now (i.e., dialog is loaded AND phrase exists)
  const eligible = [];
  for (const nm of (job.candidates || [])) {
    const startRef = `${lc(nm)}.${job.phraseId}`;
    if (__dialogHasPhrase(startRef, nm)) eligible.push(nm);
  }

  if (eligible.length) {
    const rescuer = eligible[rollInt(0, eligible.length - 1)];
    enqueueNpcSpeechBubblePrompt(
      rescuer,
      null, // prompt text comes from the start phrase text
      `${lc(rescuer)}.${job.phraseId}`,
      job.triggerKey,
      {
        timeoutMode: 'postSafeplaceExit',
        safeplaceId: __passoutSafeplaceId,
        safeplaceArea: __passoutSafeplaceArea
      }
    );
    __pendingPassoutRescue = null;
    return;
  }

  // If all candidate dialogs are now loaded (or have fallen back), and still nobody has the phrase -> narrator fallback
  let anyStillLoading = false;
  for (const nm of (job.candidates || [])) {
    const k = lc(nm);
    if (!dialogs?.[k]) { anyStillLoading = true; break; }
  }

  if (!anyStillLoading) {
    startRuleScene('narrator.passout_alone_start', job.triggerKey);
    __pendingPassoutRescue = null;
  }
}

// ===== Safeplace regen / untargetable =====
const SAFEPLACE_REGEN_EVERY_MS = 5000;

function __safeplaceCenterX(sp) {
  if (!sp) return NaN;
  // tolerate a few possible shapes
  const x =
    (sp.worldX != null) ? Number(sp.worldX) :
    (sp.x != null) ? Number(sp.x) :
    (sp.position != null) ? Number(sp.position) :
    (sp.pos != null) ? Number(sp.pos) :
    (sp.centerX != null) ? Number(sp.centerX) :
    NaN;
  return x;
}

function __actorMovedThisFrame(actor) {
  if (!actor) return false;
  const x = Number(actor.worldX) || 0;
  const prev = Number(actor.__safeplacePrevX);
  const moved = isFinite(prev) ? (Math.abs(x - prev) > 0.25) : false;
  actor.__safeplacePrevX = x;
  return moved;
}

function __isActorInAnySafeplace(actor) {
  if (!actor) return false;
  if (!Array.isArray(worldSafePlaces) || worldSafePlaces.length === 0) return false;

  const r = interactionRadius('safeplace', 0);
  const cx = (Number(actor.worldX) || 0) + (Number(actor.w) || 0) * 0.5;

  for (const sp of worldSafePlaces) {
    const sx = __safeplaceCenterX(sp);
    if (!isFinite(sx)) continue;
    if (Math.abs(cx - sx) <= r) return true;
  }
  return false;
}

function __isActorInSafeplaceById(actor, safeplaceId, areaName) {
  if (!actor) return false;
  const wantId = String(safeplaceId || '');
  if (!wantId) return false;
  if (areaName && String(areaName) !== String(currentAreaName)) return false;
  if (!Array.isArray(worldSafePlaces) || worldSafePlaces.length === 0) return false;

  const r = interactionRadius('safeplace', 0);
  const cx = (Number(actor.worldX) || 0) + (Number(actor.w) || 0) * 0.5;

  for (const sp of worldSafePlaces) {
    if (!sp || String(sp.id || '') !== wantId) continue;
    const sx = __safeplaceCenterX(sp);
    if (!isFinite(sx)) continue;
    return Math.abs(cx - sx) <= r;
  }

  return false;
}

function __tickSafeplaceRegenForActor(actor, nowMs, inSafeplace) {
  if (!actor) return;

  const moved = __actorMovedThisFrame(actor);

  const wasIn = !!actor._inSafeplace;
  actor._inSafeplace = !!inSafeplace;

  // Leaving safeplace clears the timer
  if (!actor._inSafeplace) {
    actor.__safeplaceNextRegenAtMs = 0;
    return;
  }

  // Entering OR moving resets the 5s timer
  if (!wasIn || moved || !isFinite(Number(actor.__safeplaceNextRegenAtMs)) || Number(actor.__safeplaceNextRegenAtMs) <= 0) {
    actor.__safeplaceNextRegenAtMs = nowMs + SAFEPLACE_REGEN_EVERY_MS;
    return;
  }

  if (nowMs < actor.__safeplaceNextRegenAtMs) return;

  // Regen disabled
  // if (actor === player) {
  //   addPlayerStatField('stamina', 'current', 1);
  //   addPlayerStatField('composure', 'current', 1);
  // } else if (actor.name) {
  //   applyNpcStatDelta(actor.name, 'stamina', 1, 'current');
  //   applyNpcStatDelta(actor.name, 'composure', 1, 'current');
  // }
  //
  // actor.__safeplaceNextRegenAtMs = nowMs + SAFEPLACE_REGEN_EVERY_MS;
}

function updateSafeplaceRegenAndFlags(nowMs) {
  const playerIn = __isActorInAnySafeplace(player);

  // Player
  __tickSafeplaceRegenForActor(player, nowMs, playerIn);

  // Party: if player is in a safeplace, ALL party members count as in it too
  for (const m of party) {
    if (!m) continue;
    const inSafe = playerIn || __isActorInAnySafeplace(m);
    __tickSafeplaceRegenForActor(m, nowMs, inSafe);
  }

  // World NPCs (non-party)
  for (const npc of npcs) {
    if (!npc) continue;
    if (party.includes(npc)) continue;
    const inSafe = __isActorInAnySafeplace(npc);
    __tickSafeplaceRegenForActor(npc, nowMs, inSafe);
  }
}

// ===== Update / Draw =====
function update(dt, realDt = null) {

  if (!currentArea) return;
  // Portrait is not a playable mode on touch devices: pause simulation too.
  if (document.documentElement.classList.contains('touch-enabled') &&
      window.matchMedia('(orientation: portrait)').matches) return;
  const nowMs = getGameNowMs();

  // Timed flags
  expireTimedFlags(nowMs);
  processTimedEffects(nowMs);
  processObjectResetQueues(nowMs);

  // Background asset warming (silent; a few per frame)
  processAssetWarmQueue(4);
  __resolvePendingPassoutRescuePrompt();

  if (loading) {
    const visibleNpcsReady = npcs.every(npc => {
      const sprites = npcSprites[npc.name];
      return sprites && sprites.ready;
    });

    // player sprite readiness (you currently have playerSprite, not player.sprite)
    const playerReady = playerSprites && playerSprites.ready;


    // area readiness (sections within range)
    const [i0, i1] = getSectionRangeForLoading(currentArea, 2);
    const bgReady = isAreaReadyForSections(currentArea, i0, i1);

    if (playerReady && visibleNpcsReady && bgReady) {
      pendingSpawns = [];
      populateNPCsForCurrentArea();
      populateMobsForCurrentArea();
      initConditionalSpawnsForCurrentArea();
      if (__pendingAreaEnterEvents && __pendingAreaEnterEvents.length) {
        for (const ev of __pendingAreaEnterEvents) {
          emitGameEvent('area_enter', ev);
        }
        __pendingAreaEnterEvents = [];
      }
      loading = false;
      globalThis.loading = false;
      __endBlockingLoadTracker();
      renderMenuTabs(menuTopTabs, !inMenu, true);


      // Initialize world time cache after first successful load gate
      if (!__lastWorldTimeInfo) __lastWorldTimeInfo = getWorldTimeInfo(WORLD_TIME_MIN);
      if (__lastWorldTimeTickBucket == null) __lastWorldTimeTickBucket = Math.floor(WORLD_TIME_MIN / Math.max(1e-6, WORLD_TIME_TICK_MIN));

    } else {
      return; // block update + input
    }

  }

  // If we're in an action phrase, run the action each frame.
  if (inConversation && inActionPhrase && !inMenu && !mapOverlayOpen) {
    runActiveAction(dt);
  }

  if (inActionPhrase && activeAction?.lockPlayer && !isPlayerDrivenByActionMoveTo()) {
    player.vx = 0;
  }

  if (inConversation && __lastDialogLayoutMode === 'npc' && !__lastDialogHasPortrait && currentNpc) {
    const host = __dialogFirstNpcBoxEl || dialogBox;
    __setDialogPointerVisible(true, host);
    __positionDialogPointerToActor(currentNpc, host);
  }

  // Pause all world-time simulation while time is frozen
  if (shouldFreezeWorldTime()) return;

  const dtReal = (realDt == null ? dt : realDt);

  updateItemGrantHoldProgress(dtReal);

  // ===== World time progression (dt-driven, deterministic pausing rules) =====
  if (shouldAdvanceWorldTime()) {
    advanceWorldTime(dtReal);
  }

  if (pendingSpawns && pendingSpawns.length > 0) {
    if (nowMs - __lastSpawnIfEvalAtMs >= SPAWN_IF_EVAL_INTERVAL_MS) {
      __lastSpawnIfEvalAtMs = nowMs;
      processPendingSpawns(null, {}, { allowIfOnly: true });
    }
  }


  const playerAbilityStop = (Number(player?.__stopMoveUntilMs || 0) > nowMs);
  const playerMovementLocked =
    (inActionPhrase ? !!activeAction?.lockPlayer : inConversation) ||
    inMenu ||
    mapOverlayOpen ||
    isPlayerStunned() ||
    playerAbilityStop;
  const partyFollowLocked = (inActionPhrase ? !!activeAction?.lockPartyFollow : inConversation) || inMenu || mapOverlayOpen || isPlayerStunned();
  const playerDrivenByAction = isPlayerDrivenByActionMoveTo();
  const activeObjectBlockers = getActiveObjectBlockers();

  // Update interaction-driven movement before player input/follow systems.
  updateForcedMoves(dt, nowMs, activeObjectBlockers);
  updateInteractionMoves(dt, nowMs, activeObjectBlockers);

  const playerDrivenByInteraction = isActorDrivenByInteractionMove(player);
  const playerDrivenByForcedMove = isActorDrivenByForcedMove(player);
  const playerDrivenByScript = playerDrivenByAction || playerDrivenByInteraction || playerDrivenByForcedMove;

  if (!playerDrivenByScript) {
    // Movement
    if (!loading) {

      // Dialog already freezes world by returning early.
      // Action phrases keep world running, so we must explicitly disable player input here.

      if (!playerMovementLocked) {
        if (keys['ArrowLeft']) {
          player.vx -= movementSpeed() * dt;
        }
        if (keys['ArrowRight']) {
          player.vx += movementSpeed() * dt;
        }
      } else {
        player.vx = 0; // belt-and-braces
      }

      player.vx = Math.max(
        Math.min(player.vx, maxMovementSpeed()),
        -maxMovementSpeed()
      );

    }

    player.vy += gravity;
    if (player.onGround) {
      player.vx *= Math.pow(friction, dt * 60);
    }

    player.vx = Math.max(
      Math.min(player.vx, maxMovementSpeed()),
      -maxMovementSpeed()
    );

    const prevPlayerX = player.worldX;
    player.worldX += player.vx * dt;
    player.y += player.vy * dt;

    resolveActorVsBlockers(player, prevPlayerX, activeObjectBlockers);


    if (player.vx !== 0) {
      player.hasEverMoved = true;
      player.lastMoveTime = nowMs;
    }

    if (player.y < 0) { player.y = 0; player.vy = 0; }
    if (player.y + player.h >= groundY) {
      player.y = groundY - player.h;
      player.vy = 0;
      player.onGround = true;
    }
  } else {
    // Player is being moved by action phrase (moveTo) or interaction movement.
    // runActiveAction() updates player.worldX and player.vx; we only update facing bookkeeping here.
    if (player.vx !== 0) {
      player.hasEverMoved = true;
      player.lastMoveTime = nowMs;
    }

    // Keep the same grounding rule used elsewhere (moveTo also does this, but belt-and-braces)
    player.y = groundY - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  // ----- Facing update (single authoritative place) -----
  updateActorFacing(player, nowMs);
  for (const m of party) {
    updateActorFacing(m, nowMs);
  }
  for (const n of npcs) {
    updateActorFacing(n, nowMs);
  }
  for (const m of mobs) {
    updateActorFacing(m, nowMs);
  }

  // Portal contact handling (edge-trigger, uses collision rects)
  if (handlePortalContacts()) return;

  // Area edge handling — transfer FIRST, clamp only if no transfer
  if (!FADE.active) {
    if (player.worldX < 0) {
      transferToAdjacentArea('left');
      return;
    }

    if (player.worldX + player.w > currentArea.lengthPx) {
      transferToAdjacentArea('right');
      return;
    }
  }

    // --- Party follow (player-style movement) ---
  // Only run party-follow when the player is not movement-locked.
  // Otherwise (dialog/menu/etc.), party members should hold position.
  if (!partyFollowLocked) {
    for (let i = 0; i < party.length; i++) {
      const m = party[i];
      if (m && (m.__interactionMoveActive || m.__forcedMoveActive)) continue;

      // Stop-moving lock (abilities/attacks)
      {
        const until = Number(m.__stopMoveUntilMs || 0);
        if (isFinite(until) && until > nowMs) {
          m.isFollowing = false; // ok while locked; will be recalculated next tick when unlocked
          m.vx = 0;
          m.vy = 0;
          m.onGround = true;
          m.y = groundY - m.h;
          continue;
        }
      }

      const target = getPartyFollowTargetForIndex(i, nowMs);

      const dx =
        (target.worldX + target.w * 0.5) -
        (m.worldX + m.w * 0.5);


      const dist = Math.abs(dx);

      const startDist = followStartDistance(i);
      const stopDist  = followStopDistance(i);

      // Follow state (hysteresis)
      if (!m.isFollowing && dist > startDist) {
        m.isFollowing = true;
      }
      if (m.isFollowing && dist < stopDist) {
        m.isFollowing = false;
      }

      // Simulated input
      let moveDir = 0;
      if (m.isFollowing) {
        moveDir = Math.sign(dx);
      }

      // Apply "input" exactly like player
      if (moveDir !== 0) {
        m.vx += moveDir * movementSpeed() * dt;
      }

      // Gravity
      m.vy += gravity;

      // Friction (same rule as player)
      if (m.onGround) {
        m.vx *= Math.pow(friction, dt * 60);
      }

      // Clamp speed (same clamp as player)
      m.vx = Math.max(
        Math.min(m.vx, maxMovementSpeed()),
        -maxMovementSpeed()
      );

      // Move
      const prevMx = m.worldX;
      m.worldX += m.vx * dt;
      m.y += m.vy * dt;

      resolveActorVsBlockers(m, prevMx, activeObjectBlockers);


      // Ground resolution (same as player)
      if (m.y + m.h >= groundY) {
        m.y = groundY - m.h;
        m.vy = 0;
        m.onGround = true;
      }

      // Facing / animation
      if (Math.abs(m.vx) > 0.1) {
        // Facing resolved centrally after movement updates.
        m.lastMoveTime = nowMs;
        m.hasEverMoved = true;
      }
    }
  } else {
    // Disable party-follow during locks, but allow scripted movement
    for (const m of party) {
      m.isFollowing = false;
    }
  }


  
  // --- World NPC autonomy (non-party NPCs) ---
  for (const npc of npcs) {
    updateWorldNpcAutonomy(npc, dt, activeObjectBlockers, nowMs);
  }

  // --- Safeplace regen + inSafeplace flags (must run after actors moved this frame) ---
  updateSafeplaceRegenAndFlags(nowMs);

  // Remove mobs whose despawn delay has completed
  {
    for (let i = mobs.length - 1; i >= 0; i--) {
      const m = mobs[i];
      const t = Number(m?._removeAtMs);
      if (isFinite(t) && t > 0 && nowMs >= t) {
        removeMobInstance(m);
      }
    }
  }

  // Remove NPCs whose despawn delay has completed
  {
    for (let i = npcs.length - 1; i >= 0; i--) {
      const n = npcs[i];
      const t = Number(n?._removeAtMs);
      if (isFinite(t) && t > 0 && nowMs >= t) {
        removeWorldNpcInstance(n);
      }
    }
  }


    // --- World mob autonomy ---
  for (const mob of mobs) {
    updateWorldMobAutonomy(mob, dt, activeObjectBlockers, nowMs);
  }




  updateCamera();

  
  // --- Pre-warm adjacent areas when approaching edges ---
  const EDGE_WARM_DISTANCE = player.w * 2;

  if (player.worldX < EDGE_WARM_DISTANCE && currentArea.leftarea) {
    warmAreaAssets(currentArea.leftarea);
    warmAreaActorAssets(currentArea.leftarea);
  }

  if (
    player.worldX + player.w >
    currentArea.lengthPx - EDGE_WARM_DISTANCE &&
    currentArea.rightarea
  ) {
    warmAreaAssets(currentArea.rightarea);
    warmAreaActorAssets(currentArea.rightarea);
  }



  // ===== Proximity scan (single pass) =====
  // - Sets currentTrigger (nearest WORLD npc in radius)
  // - Fires proximity_enter/leave once on entering/leaving radius for multiple target kinds
  let closestDist = Infinity;
  let trigger = null;
  const coverList = __getCoverRectsForCurrentArea();

  // Collect proximity targets for this frame
  const targets = [];
  // Track nearest exits in-range (so exits use the SAME proximity system as everything else)
  let closestUpDx = Infinity;
  let closestDownDx = Infinity;
  let nextExitUp = null;
  let nextExitDown = null;


  // --- NPC targets (world + party) ---
  const proximityList = [...npcs, ...party];
  for (const npc of proximityList) {
    if (!npc || !npc.name) continue;

    const radius = interactionRadius('npc', npc.w);
    targets.push({
      kind: 'npc',
      id: npc.name,
      worldX: (npc.worldX + npc.w * 0.5),
      radius,
      _npcRef: npc
    });
  }

  // --- Exit targets (up/down exits) ---
  // You already build worldExits and you already scan them for currentExitUp/Down.
  // Here we also treat each exit as a proximity target.
  for (const ex of worldExits) {
    if (!ex) continue;
    const targetParsed = ex.target ? parseTargetExitString(ex.target) : null;
    const targetResolved = targetParsed ? findExitWorldPosition(targetParsed) : null;
    if (!targetResolved || !targetResolved.areaName) continue;

    // Make a stable id. If your ex already has an id, use it; otherwise use a composite.
    const exId = ex.id
      ? String(ex.id)
      : `${String(ex.direction || '')}:${String(ex.target || '')}:${String(ex.worldX || '')}`;


    targets.push({
      kind: 'exit',
      id: exId,
      worldX: ex.worldX,
      radius: interactionRadius('exit', 0),
      direction: ex.direction,
      target: ex.target,
      _resolvedTarget: targetResolved,
      _exitRef: ex
    });

  }

  // Add each safe place as a proximity target.
  for (const sp of worldSafePlaces) {
    if (!sp) continue;

    targets.push({
      kind: 'safeplace',
      id: String(sp.id),
      worldX: sp.worldX,
      radius: interactionRadius('safeplace', 0),
      _safeRef: sp
    });
  }


  // --- Area end targets (left/right edge of area) ---
  // currentArea.lengthPx is used elsewhere in this same function.
  // Use a small radius so it triggers as you approach the edge.
  targets.push({
    kind: 'area_end',
    id: 'left',
    worldX: 0,
    radius: interactionRadius('area_end', 0)
  });

  targets.push({
    kind: 'area_end',
    id: 'right',
    worldX: currentArea.lengthPx,
    radius: interactionRadius('area_end', 0)
  });

  // --- Object instance targets ---
  // Use the already-spawned object instance arrays stored on currentArea.
  // Each entry already has a worldX and a key (filename base) in your renderer logic.

  const objectBuckets = [
    { layer: 'back',   list: currentArea.backObjects },
    { layer: 'fore',   list: currentArea.foreObjects },
    { layer: 'gback',  list: currentArea.groundBackObjects },
    { layer: 'gfore',  list: currentArea.groundForeObjects }
  ];

  for (const bucket of objectBuckets) {
    const list = bucket.list;
    if (!Array.isArray(list)) continue;

    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      if (o._spawned === false) continue;


      // Prefer o.key if present (your object template key / filename base)
      const raw = String(o.key || o.name || o.filename || '').trim();
      if (!raw) continue;

      // Rule-facing id should be the filename base WITHOUT extension
      const base = raw.replace(/\.[^/.]+$/, '').trim();
      if (!base) continue;

      // Ensure we have an image entry (lets us compute the same width as rendering)
      const resolved = resolvePlacedObjectRender(o, base, nowMs);
      const entry = resolved.entry;

      // Match the draw functions' default sizing per layer
      const defaultHMult = (bucket.layer === 'back') ? 0.55 : 0.70;

      const targetH = Math.floor(
        (o.heightPx || (TILE_DRAW_HEIGHT() * defaultHMult)) * SCALE.objects
      );

      let targetW = Math.floor(player.w); // safe fallback
      const def = getObjectDef(base) || null;
      const fw = Number(def?.animFramePx?.w);
      const fh = Number(def?.animFramePx?.h);
      if (isFinite(fw) && isFinite(fh) && fh > 0) {
        // Prefer declared anim frame dimensions for stability (avoids flicker when render frames swap)
        targetW = Math.floor(targetH * (fw / fh));
      } else if (entry && entry.ready) {
        const srcW = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameW) : Math.max(1, entry.w);
        const srcH = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameH) : Math.max(1, entry.h);
        if (srcH > 0) targetW = Math.floor(targetH * (srcW / srcH));
      }

      const instanceId = String(o.instanceId || `${bucket.layer}:${base}:${i}`).trim(); // unique per placed object

      targets.push({
        kind: 'object',
        id: base,
        objectSectionId: (o.objectId != null && o.objectId !== '') ? String(o.objectId) : ((o.id != null && o.id !== '') ? String(o.id) : null),
        instanceId,
        worldX: o.worldX + (targetW * 0.5),
        radius: interactionRadius('object', targetW),
        filename: base
      });



    }
  }

  // --- World item targets ---
  if (currentArea && Array.isArray(currentArea.worldItems)) {
    for (const item of currentArea.worldItems) {
      if (!isWorldItemAvailable(item)) continue;

      const m = getWorldItemDrawMetrics(item);
      const targetW = m ? m.targetW : player.w;

      targets.push({
        kind: 'item',
        id: item.itemId,
        instanceId: item.instanceId,
        worldX: Number(item.worldX) || 0,
        radius: interactionRadius('object', targetW),
        _itemRef: item
      });
    }
  }

  for (const t of targets) {
    const key = makeProxKey(t);          // instance key (objects use instanceId)
    const typeKey = makeProxTypeKey(t);  // rule-facing key (kind + base id)
    if (!key || !typeKey) continue;

    // keep latest target lookup for distance checks (used by object interaction focus)
    proximityTargetByKey.set(key, t);

    let isInside = inRadius(t.worldX, t.radius);
    const wasInside = proximityInside.has(key);
    let covered = false;
    const isObjectLike = (t.kind === 'object' || t.kind === 'item');
    const rawWasInside = isObjectLike ? proximityInsideRaw.has(key) : false;
    const rawInside = isObjectLike ? isInside : false;

    if (isObjectLike && isInside) {
      covered = (t.kind === 'object')
        ? isObjectInstanceCoveredWithCoverList(key, coverList)
        : isWorldItemCoveredWithCoverList(key, coverList);
    }

    // Raw proximity tracking for objects/items (ignores cover)
    if (isObjectLike) {
      if (rawInside && !rawWasInside) {
        proximityInsideRaw.add(key);
        if (covered) {
          emitProximityEvent(true, t, { covered: true, rawProximity: true });
        }
      } else if (!rawInside && rawWasInside) {
        proximityInsideRaw.delete(key);
        if (covered) {
          emitProximityEvent(false, t, { covered: true, rawProximity: true });
        }
      }
    }

    if (isObjectLike && covered) {
      isInside = false;
    }

    // Interaction target: choose nearest WORLD npc only (not party members)
    if (t.kind === 'npc' && isInside) {
      const npcRef = t._npcRef;
      if (npcRef && !party.includes(npcRef)) {
        const dx = playerDistX(t.worldX);
        if (dx < closestDist) {
          trigger = npcRef;
          closestDist = dx;
        }
      }
    }

    // Exit interaction target: choose nearest UP and DOWN exits while in range
    if (t.kind === 'exit' && isInside) {
      const dx = playerDistX(t.worldX);

      // pre-warm destination area while in range (same behavior as the old exit scan)
      if (t.target) {
        const target = parseTargetExitString(t.target);
        if (target && target.area) {
          warmAreaAssets(target.area);
        }
      }

      if (t.direction === 'up') {
        if (dx < closestUpDx) { closestUpDx = dx; nextExitUp = t._exitRef; }
      } else if (t.direction === 'down') {
        if (dx < closestDownDx) { closestDownDx = dx; nextExitDown = t._exitRef; }
      }
    }


    if (isInside && !wasInside) {
      proximityInside.add(key);

      // Set interaction focus if none exists yet for this type,
      // or if the current focus is no longer inside.
      const curFocus = proximityInteractFocus.get(typeKey);
      if (!curFocus || !proximityInside.has(curFocus)) {
        proximityInteractFocus.set(typeKey, key);
      }


      // Keep type-level proximity in sync for STATE rules
      if (isObjectLike) {
        const prev = proximityTypeCount.get(typeKey) || 0;
        const next = prev + 1;
        proximityTypeCount.set(typeKey, next);

        if (next === 1) {
          // first instance entered => type becomes "in proximity"
          proximityInsideTypes.add(typeKey);
        }

        if (next !== 1) {
          // already inside at least one instance; don't emit enter again
          continue;
        }
      } else {
        // non-object targets: type === instance effectively
        proximityInsideTypes.add(typeKey);
      }


      emitProximityEvent(true, t, { covered, coveredWas: (covered === false && isObjectLike && rawWasInside) });


    } else if (!isInside && wasInside) {
      proximityInside.delete(key);

      // If this instance was the interaction focus, clear it
      if (proximityInteractFocus.get(typeKey) === key) {
        proximityInteractFocus.delete(typeKey);
      }


      // Keep type-level proximity in sync for STATE rules
      if (isObjectLike) {
        const prev = proximityTypeCount.get(typeKey) || 0;
        const next = Math.max(0, prev - 1);

        if (next === 0) {
          proximityTypeCount.delete(typeKey);
          // last instance exited => type no longer "in proximity"
          proximityInsideTypes.delete(typeKey);
        } else {
          proximityTypeCount.set(typeKey, next);
          // still inside at least one instance; don't emit leave yet
          continue;
        }
      } else {
        proximityInsideTypes.delete(typeKey);
      }


      emitProximityEvent(false, t, { covered });

    }

  }

  currentTrigger = trigger;
  // Commit exit targets selected by the unified proximity scan
  currentExitUp = nextExitUp;
  currentExitDown = nextExitDown;

  // ===== Mob contact scan (AABB overlap with player + party NPCs) =====
  const contactActors = [player, ...party];

  for (const mob of mobs) {
    if (!mob || !mob.id || !mob.instanceId) continue;

    const typeKey = `mob:${lc(mob.id)}`;
    const hb = getMobHitboxWorldRect(mob);

    let anyInsideNow = false;
    let anyInsideWas = false;

    for (const a of contactActors) {
      if (!a) continue;

      const pairKey = contactPairKey(mob.instanceId, a);
      if (!pairKey) continue;

      const isInside = aabbOverlap(
        a.worldX, a.y, a.w, a.h,
        hb.x, hb.y, hb.w, hb.h
      );

      const wasInside = contactInsidePairs.has(pairKey);

      if (isInside) anyInsideNow = true;
      if (wasInside) anyInsideWas = true;

      if (isInside && !wasInside) {
        contactInsidePairs.add(pairKey);

        const typePairKey = `mob:${lc(mob.id)}|${contactActorKeyFromActor(a)}`;
        const prevP = contactTypeCountPairs.get(typePairKey) || 0;
        contactTypeCountPairs.set(typePairKey, prevP + 1);

        // emit per (mob,actor) enter
        emitMobContactEvent(true, mob, a);

        // start tick timer fresh (shared timer; ok for v1)
        mob.contactNextTickAtMs = 0;

      } else if (!isInside && wasInside) {
        contactInsidePairs.delete(pairKey);

        const typePairKey = `mob:${lc(mob.id)}|${contactActorKeyFromActor(a)}`;
        const prevP = contactTypeCountPairs.get(typePairKey) || 0;
        const nextP = Math.max(0, prevP - 1);
        if (nextP === 0) contactTypeCountPairs.delete(typePairKey);
        else contactTypeCountPairs.set(typePairKey, nextP);

        // emit per (mob,actor) leave
        emitMobContactEvent(false, mob, a);
        mob.contactNextTickAtMs = 0;
      }
    }

    // Keep the old TYPE-level rule-facing state in sync (ANY actor counts)
    if (anyInsideNow && !anyInsideWas) {
      const prev = contactTypeCount.get(typeKey) || 0;
      const next = prev + 1;
      contactTypeCount.set(typeKey, next);
      if (next === 1) contactInsideTypes.add(typeKey);
      runMobContactHook(mob, 'start');
    } else if (!anyInsideNow && anyInsideWas) {
      const prev = contactTypeCount.get(typeKey) || 0;
      const next = Math.max(0, prev - 1);
      if (next === 0) {
        contactTypeCount.delete(typeKey);
        contactInsideTypes.delete(typeKey);
      } else {
        contactTypeCount.set(typeKey, next);
      }
      runMobContactHook(mob, 'end');
    }
  }


  // ===== Mob contact ticks + abilities =====
  const nowMobMs = nowMs;

  for (const mob of mobs) {
    if (!mob || !mob.id || !mob.instanceId) continue;

    runMobContactTick(mob, nowMobMs);
    tryActorAbilities(mob, nowMobMs);
  }

  // ===== NPC targeting + abilities (party + world NPCs) =====
  const nowNpcMs = nowMs;
  for (const npc of [...party, ...npcs]) {
    if (!npc || !npc.name) continue;

    // Keep targeting updated even for party NPCs (but updateActorTargeting will not hijack aiMode when isFollowing)
    updateActorTargeting(npc, nowNpcMs, 'attack');
    updateActorTargeting(npc, nowNpcMs, 'move');

    tryActorAbilities(npc, nowNpcMs);
  }

  // ===== Player abilities (future-proof) =====
  tryActorAbilities(player, nowNpcMs);


  // Pick ONE focused interactable object for KeyI (nearest eligible type-focus)
  currentObjectInteract = null;
  let bestDx = Infinity;

  for (const typeKey of proximityInsideTypes) {
    const [kind, id] = String(typeKey).split(':');
    if (kind !== 'object') continue;
    
    const instanceKey = proximityInteractFocus.get(typeKey);
    if (!instanceKey) continue;

    if (!isObjectInteractable(id, instanceKey)) continue;


    const t = proximityTargetByKey.get(instanceKey);
    if (!t) continue;

    const dx = playerDistX(t.worldX);
    if (dx < bestDx) {
      bestDx = dx;
      currentObjectInteract = { typeId: id, instanceKey };
    }
  }

  // Pick ONE focused world item for interaction (nearest eligible type-focus)
  currentItemInteract = null;
  let bestItemDx = Infinity;

  for (const typeKey of proximityInsideTypes) {
    const [kind, id] = String(typeKey).split(':');
    if (kind !== 'item') continue;

    const instanceKey = proximityInteractFocus.get(typeKey);
    if (!instanceKey) continue;
    if (!isWorldItemInteractable(instanceKey)) continue;

    const t = proximityTargetByKey.get(instanceKey);
    if (!t) continue;

    const dx = playerDistX(t.worldX);
    if (dx < bestItemDx) {
      bestItemDx = dx;
      currentItemInteract = { itemId: id, instanceKey };
    }
  }


  // ===== section_enter event =====
  const idx = Math.floor(player.worldX / currentArea.sectionTileWidth);
  const nowSection = currentArea.sections[idx]?.name || null;

  // Detect any section-index change (including unnamed sections)
  if (lastPlayerSectionIndex === null || idx !== lastPlayerSectionIndex) {
    
    let from = null;

    if (pendingVerticalTransferFrom) {
      from = pendingVerticalTransferFrom;
    } else if (lastPlayerSectionIndex !== null) {
      from = idx > lastPlayerSectionIndex ? 'left' : 'right';
    } else {
      // first section_enter after loading/transferring into an area
      from = lastPlayerAreaEnterEdge; // 'left' or 'right'
    }


    // Mark section index as visited for map discovery (handles unnamed sections)
    if (currentAreaName != null && idx != null) {
      setFlag('global', `visitedIdx:${currentAreaName}:${idx}`, true);
    }

    // NEW: section_leave for the previous named section
    if (lastPlayerSection) {
      emitGameEvent('section_leave', {
        area: currentAreaName,
        section: lastPlayerSection,
        from,
        npc: 'Player'
      });

    }

    // Only emit section_enter if the *new* section has a name
    if (nowSection) {
      emitGameEvent('section_enter', {
        area: currentAreaName,
        section: nowSection,
        from,
        npc: 'Player'
      });
      pendingVerticalTransferFrom = null;
    }

    
    
    // ALWAYS update section memory (even when nowSection is null)
    lastPlayerSection = nowSection;        // may become null
    lastPlayerSectionIndex = idx;


  }

  // ===== section_enter/leave for NPCs (world + party) =====
  // Uses lastNpcSection / lastNpcSectionIndex maps declared near getSectionNameForX()

  for (const npc of [...npcs, ...party]) {
    if (!npc || !npc.name) continue;

    const key = lc(npc.name);

    const idxNpc = Math.floor(npc.worldX / currentArea.sectionTileWidth);
    const nowNpcSection = currentArea.sections[idxNpc]?.name || null;

    const prevIdx = lastNpcSectionIndex.has(key) ? lastNpcSectionIndex.get(key) : null;
    const prevSection = lastNpcSection.has(key) ? lastNpcSection.get(key) : null;

    // Only do work on the first observation OR when their section index changes
    if (prevIdx === null || idxNpc !== prevIdx) {
      let from = null;

      if (prevIdx !== null) {
        from = idxNpc > prevIdx ? 'left' : 'right';
      }


      // Leave old named section (if any)
      if (prevSection) {
        emitGameEvent('section_leave', {
          area: currentAreaName,
          section: prevSection,
          from,
          npc: npc.name
        });

      }

      // Enter new named section (if any)
      if (nowNpcSection) {
        emitGameEvent('section_enter', {
          area: currentAreaName,
          section: nowNpcSection,
          from,
          npc: npc.name
        });

      }

      lastNpcSectionIndex.set(key, idxNpc);
      lastNpcSection.set(key, nowNpcSection);
    }
  }


  // Prompt text (EXITS ONLY)
  if (currentExitUp || currentExitDown) {
    let text = '';
    if (currentExitUp) text += '↑: Use Exit  ';
    if (currentExitDown) text += '↓: Use Exit  ';
    // promptEl.textContent suppressed (exit label disabled)
    promptEl.style.display = 'none';
  } else {
    promptEl.style.display = 'none';
  }


  //const dialogPromptContainer = document.getElementById('dialogPromptContainer');

  activeDialogPrompts.length = 0;

  const __stillActivePromptIds = new Set();
  const __canTriggerPrompts = (!inConversation && !inMenu && !loading && !(inActionPhrase && activeAction?.lockPlayer));
  const __promptDtMs = Math.max(0, Number(dtReal) * 1000);

  for (const p of queuedDialogPrompts) {

    const want = lc(p.npc);
    const npc =
      party.find(n => lc(n?.name) === want) ||
      npcs.find(n => lc(n?.name) === want);


    if (!npc) continue;


    // Only show the prompt while the player is within this NPC's interaction radius
    //const dx = Math.abs((player.worldX + player.w * 0.5) - (npc.worldX + npc.w * 0.5));
    //const radius = npc.interactionRadius || npcInteractionDistance();
    //if (dx >= radius) continue;

    let triggerKey = p.triggerKey || null;

    // Back-compat: if a prompt was enqueued without a triggerKey, synthesize one so it can render.
    if (!triggerKey) {
      const who = lc(p.npc);
      const start = lc(p.start || '');
      const text = lc(p.prompt || '');
      triggerKey = `legacy:${who}:${start}:${text}`;
    }

    const promptId = `${lc(npc.name)}:${triggerKey}`;
    const firedId = promptId;
    const ruleId = p.ruleId || (stateRuleById.has(String(triggerKey || '')) ? String(triggerKey) : null);
    let persistence = 1;
    if (ruleId) {
      const rule = stateRuleById.get(String(ruleId));
      const raw = rule?.dialog?.persistence;
      persistence = (raw == null) ? 1 : Number(raw);
    }
    const count = firedDialogTriggers.get(firedId) || 0;
    if (isFinite(persistence) && persistence !== 0 && count >= persistence) continue;

    let keyNum = null;
    if (party.includes(npc)) {
      keyNum = __getOrAssignPartyPromptSlot(promptId);
    }
    __stillActivePromptIds.add(promptId);

    activeDialogPrompts.push({
      npc,
      triggerKey,
      prompt: p.prompt,
      start: p.start,
      keyNum,
      __promptId: promptId,
      ruleId
    });

    // Track visible time for TIME-based prompts only; expire after 5s of actual availability.
    if (p.timeoutMode === 'time' && __canTriggerPrompts && __promptDtMs > 0) {
      const prev = __promptVisibleMsById.get(promptId) || 0;
      const next = prev + __promptDtMs;
      __promptVisibleMsById.set(promptId, next);

      if (next >= 5000) {
        // Time-based prompts disappear after 5s but do NOT mark rule triggered.
        removeDialogPromptForRule(p.ruleId || triggerKey);
        __promptVisibleMsById.delete(promptId);
      }
    }
    // Post-passout prompts: keep visible until 5s after the player LEAVES the safeplace they woke up in.
    if (p.timeoutMode === 'postSafeplaceExit' && __canTriggerPrompts && __promptDtMs > 0) {
      const spId = p.safeplaceId || __passoutSafeplaceId;
      const spArea = p.safeplaceArea || __passoutSafeplaceArea;

      if (!p.__exitStartedAtMs) {
        const stillIn = __isActorInSafeplaceById(player, spId, spArea);
        if (!stillIn) p.__exitStartedAtMs = getGameNowMs();
      }

      if (p.__exitStartedAtMs) {
        const prev = __promptVisibleMsById.get(promptId) || 0;
        const next = prev + __promptDtMs;
        __promptVisibleMsById.set(promptId, next);

        if (next >= 5000) {
          removeDialogPromptForRule(p.ruleId || triggerKey);
          __promptVisibleMsById.delete(promptId);
        }
      }
    }
  }
  
  // Free any party prompt slots that disappeared this frame
  for (const [pid] of __partyPromptSlotById) {
    if (!__stillActivePromptIds.has(pid)) {
      __releasePartyPromptSlot(pid);
    }
  }

  // Clear timers for prompts no longer visible
  for (const [pid] of __promptVisibleMsById) {
    if (!__stillActivePromptIds.has(pid)) {
      __promptVisibleMsById.delete(pid);
    }
  }

  // If stamina/composure hit 0 this frame, trigger pass-out flow.
  checkPlayerPassOut();
}

function isPlayerWithinNpcRadius(npc) {
  const dx = Math.abs((player.worldX + player.w * 0.5) - (npc.worldX + npc.w * 0.5));

  // Preserve NPC-specific overrides exactly.
  if (typeof npc?.interactionRadius === 'number') return dx < npc.interactionRadius;

  // Otherwise use the same radius formula used elsewhere, but with npc.w.
  return dx < interactionRadius('npc', npc.w);
}



function drawRecruitIconForNpc(npc, yOffset = 0) {
  const sx = npc.worldX - cameraX + npc.w / 2;
  const sy = npc.y - 10 - yOffset;

  if (recruitIcon.ready && recruitIcon.img) {
    const img = recruitIcon.img;
    const x = Math.floor(sx - img.width / 2);
    const y = Math.floor(sy - img.height);

    ctx.drawImage(img, x, y);
    drawKeyBadgeAttached(ctx, { x, y, w: img.width, h: img.height }, 'R');
    __lastRecruitIcons.push({ npc, x, y, w: img.width, h: img.height });
    return img.height + 6;
  }

  // Fallback: plain "R" only if image missing
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.font = uiFont(40);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('R', sx, sy);
  ctx.restore();

  const fw = 26;
  const fh = 26;
  __lastRecruitIcons.push({ npc, x: Math.floor(sx - fw / 2), y: Math.floor(sy - fh), w: fw, h: fh });
  return 26;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

const KEYBADGE_DEFAULT_OVERLAP_X_MULT = 0.2;
const KEYBADGE_DEFAULT_OVERLAP_Y_MULT = 1.8;
const KEYBADGE_DOM_SCALE = 0.55;

function getKeyBadgeLayout(label, opts = {}) {
  if (!label) return null;
  const r = Number(opts.r || 26);
  const overlapX = (opts.overlapX != null) ? Number(opts.overlapX) : r * KEYBADGE_DEFAULT_OVERLAP_X_MULT;
  const overlapY = (opts.overlapY != null) ? Number(opts.overlapY) : r * KEYBADGE_DEFAULT_OVERLAP_Y_MULT;
  const fontPx = Number(opts.fontPx || 48);
  const insetX = Math.max(0, r - overlapX);
  const insetY = Math.max(0, r - overlapY);
  return { r, overlapX, overlapY, fontPx, insetX, insetY };
}

function applyKeyBadgeDefaultsToCss() {
  const root = document.documentElement;
  if (!root) return;
  root.style.setProperty('--keybadge-overlap-x-mult', String(KEYBADGE_DEFAULT_OVERLAP_X_MULT));
  root.style.setProperty('--keybadge-overlap-y-mult', String(KEYBADGE_DEFAULT_OVERLAP_Y_MULT));
}

applyKeyBadgeDefaultsToCss();

function drawKeyBadge(ctx, cx, cy, label, opts = {}) {
  if (!label) return;
  const r = Number(opts.r || 26);
  const fontPx = Number(opts.fontPx || 48);

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = uiFont(fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(label), cx, cy + 1);
  ctx.restore();
}

function attachHotkeyBadge(el, hotKey, opts = {}) {
  if (!el || hotKey == null) return null;
  const badge = document.createElement('div');
  badge.className = 'hotkeyBadge';
  badge.textContent = String(hotKey);
  const baseR = (opts && opts.r != null) ? Number(opts.r) : 26;
  const domR = baseR * KEYBADGE_DOM_SCALE;
  const baseFontPx = (opts && opts.fontPx != null) ? Number(opts.fontPx) : 48;
  const resolved = {
    r: domR,
    fontPx: baseFontPx * KEYBADGE_DOM_SCALE,
    overlapX: (opts && opts.overlapX != null)
      ? Number(opts.overlapX) * KEYBADGE_DOM_SCALE
      : (opts && opts.overlapXMult != null ? (Number(opts.overlapXMult) * domR) : undefined),
    overlapY: (opts && opts.overlapY != null)
      ? Number(opts.overlapY) * KEYBADGE_DOM_SCALE
      : (opts && opts.overlapYMult != null ? (Number(opts.overlapYMult) * domR) : undefined)
  };
  const layout = getKeyBadgeLayout(hotKey, resolved);
  if (layout) {
    badge.style.setProperty('--badge-r', `${Number(layout.r)}px`);
    badge.style.setProperty('--badge-overlap-x', `${Number(layout.overlapX)}px`);
    badge.style.setProperty('--badge-overlap-y', `${Number(layout.overlapY)}px`);
    badge.style.setProperty('--badge-font-size', `${Number(layout.fontPx)}px`);
  }
  el.appendChild(badge);
  return badge;
}

function drawKeyBadgeAttached(ctx, elementRect, label, opts = {}) {
  if (!label || !elementRect) return;
  const layout = getKeyBadgeLayout(label, opts);
  if (!layout) return;
  const cx = elementRect.x - layout.r + layout.overlapX;
  const cy = elementRect.y - layout.r + layout.overlapY;
  drawKeyBadge(ctx, cx, cy, label, layout);
  return layout;
}


function buildPromptBubbleMetrics(text, keyLabel) {
  const fontPx = 48;
  const pointerH = 50;
  ctx.save();
  ctx.font = uiFont(fontPx);
  const paddingX = 16;
  const paddingY = 10;
  const fullText = text;
  const textW = ctx.measureText(fullText).width;
  const boxW = Math.ceil(textW + paddingX * 2);
  const boxH = Math.ceil(fontPx + paddingY * 2);
  ctx.restore();
  return { fontPx, paddingX, paddingY, fullText, boxW, boxH, pointerH };
}

function drawSpeechBubbleForNpc(npc, text, keyLabel, yOffset = 0, opts = {}) {
  const sx = npc.worldX - cameraX + npc.w / 2;
  const sy = npc.y - 10 - yOffset;

  ctx.save();

  const metrics = opts.metrics || buildPromptBubbleMetrics(text, keyLabel);
  const { fontPx, paddingX, paddingY, fullText, boxW, boxH, pointerH } = metrics;
  const badge = getKeyBadgeLayout(keyLabel, opts.badge || {});

  ctx.font = uiFont(fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let x = (opts.x != null) ? Math.floor(opts.x) : Math.floor(sx - boxW / 2);
  let y = (opts.y != null) ? Math.floor(opts.y) : Math.floor(sy - boxH);

  // Clamp prompt fully on-screen
  const pad = 4;
  const badgeInsetX = badge ? badge.insetX : 0;
  const badgeInsetY = badge ? badge.insetY : 0;
  const leftPad = pad + badgeInsetX;
  if (x < leftPad) x = leftPad;
  if (x + boxW > WIDTH - pad) x = Math.max(leftPad, WIDTH - boxW - pad);
  if (y < pad + badgeInsetY) y = pad + badgeInsetY;
  if (y + boxH + pointerH > HEIGHT - pad) y = Math.max(pad, HEIGHT - boxH - pointerH - pad);

  // Optional tag (icon or name) when NPC is off-screen
  let tagH = 0;
  if (opts && opts.tag) {
    const tag = opts.tag;
    const tagMargin = 4;
    const iconSize = 40;
    const textSize = 28;

    // Ensure space for tag above bubble
    tagH = iconSize;
    if (y - tagH - tagMargin < pad) {
      y = Math.min(HEIGHT - boxH - pad, pad + tagH + tagMargin);
    }

    if (tag.icon && tag.icon.ready && tag.icon.img) {
      const ix = Math.floor(x + (boxW / 2) - (iconSize / 2));
      const iy = Math.floor(y - tagH - tagMargin);
      ctx.drawImage(tag.icon.img, ix, iy, iconSize, iconSize);
    } else if (tag.name) {
      const iy = Math.floor(y - textSize - tagMargin);
      ctx.save();
      ctx.font = uiFont(textSize);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 6;
      ctx.strokeText(tag.name, x + boxW / 2, iy + textSize);
      ctx.fillText(tag.name, x + boxW / 2, iy + textSize);
      ctx.restore();
      tagH = textSize;
    }
  }

  // Bubble (opaque white with 6px black border)
  const cornerRadius = 12; // increase for rounder corners

  drawRoundedRect(ctx, x, y, boxW, boxH, cornerRadius);

  ctx.fillStyle = '#ffffff';
  ctx.fill();

  drawKeyBadgeAttached(ctx, { x, y, w: boxW, h: boxH }, keyLabel, opts.badge || {});

  // Pointer (white triangle pointing to NPC)
  const baseY = y + boxH;
  const baseHalf = 10;
  const edgeOffset = boxW * 0.05;
  const minBaseX = Math.max(x + edgeOffset, x + cornerRadius + baseHalf);
  const maxBaseX = Math.min(x + boxW - edgeOffset, x + boxW - cornerRadius - baseHalf);
  const centerX = x + boxW / 2;

  const tipX = Math.max(pad, Math.min(WIDTH - pad, sx));
  const tipY = Math.max(baseY + pointerH, Math.min(sy, HEIGHT - pad));

  const rel = (tipX - x) / boxW; // owner center within bubble (0..1)
  const playerSx = player.worldX - cameraX + player.w / 2;
  const playerOnLeft = playerSx < tipX;

  // Angle the pointer ~30 degrees off vertical; tip stays at owner.
  const angleRad = Math.PI / 6; // 30 degrees
  const horizOffset = Math.tan(angleRad) * Math.max(0, tipY - baseY);

  let baseX = centerX;

  // Case A: owner within middle 45%..55% of bubble width
  if (rel >= 0.45 && rel <= 0.55) {
    baseX = x + boxW * (playerOnLeft ? 0.45 : 0.55);
  // Case B: owner within 5%..45% or 55%..95% (but not centered)
  } else if (rel >= 0.05 && rel <= 0.95) {
    const dir = playerOnLeft ? -1 : 1;
    baseX = tipX + dir * horizOffset;
  // Case C: owner outside 5%..95%
  } else {
    baseX = (rel < 0.05) ? (x + boxW * 0.05) : (x + boxW * 0.95);
  }

  baseX = Math.max(minBaseX, Math.min(maxBaseX, baseX));

  ctx.beginPath();
  ctx.moveTo(baseX - baseHalf, baseY);
  ctx.lineTo(baseX + baseHalf, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Text (black)
  ctx.fillStyle = '#000000';
  const textX = x + boxW / 2;
  ctx.fillText(fullText, textX, y + boxH / 2);

  ctx.restore();
  return boxH + 6 + (tagH ? (tagH + 4) : 0);
}


function drawInteractionIcon(x, y, label = 'I') {
  // Primary: image icon
  if (interactIcon.ready && interactIcon.img) {
    const img = interactIcon.img;
    const ix = Math.floor(x - img.width / 2);
    const iy = Math.floor(y - img.height);
    ctx.drawImage(img, ix, iy);
    drawKeyBadgeAttached(ctx, { x: ix, y: iy, w: img.width, h: img.height }, '↵');
    return { x: ix, y: iy, w: img.width, h: img.height };
  }

  // Fallback: text icon
  ctx.save();

  ctx.font = uiFont(28);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.fillText(String(label || 'I'), x, y + 1);

  ctx.restore();
  return { x: Math.floor(x - 14), y: Math.floor(y - 14), w: 28, h: 28 };
}

function drawExitProximityIcon() {
  __lastExitIconRect = null;
  // Prefer Up if both happen to be present
  const ex = currentExitUp || currentExitDown;
  if (!ex) return;

  const useUp = !!currentExitUp;
  const icon = useUp ? exitUpIcon : exitDownIcon;
  if (!icon.ready || !icon.img) return;

  const worldCenterX = Number(ex.worldX) + Number(ex.w || 0) * 0.5;
  const sx = worldToScreenX(worldCenterX, PARALLAX.ground);

  const img = icon.img;

  // Hide the exit icon if the exit is under cover
  const coverList = __getCoverRectsForCurrentArea();
  if (coverList.length) {
    const targetW = img.width;
    const targetH = img.height;
    const target = {
      _targetKind: 'object',
      _screenX: Math.floor(sx - targetW * 0.5),
      _screenY: Math.floor((Number(groundY) || 0) - targetH),
      _screenW: targetW,
      _screenH: targetH,
      _layer: 'gfore',
      _drawIndex: 0,
      instanceId: '__exit_icon'
    };
    if (isTargetCovered(target, coverList)) return;
  }

  // Vertically fixed to the middle of the screen (still within world-render layer)
  const sy = Math.floor(HEIGHT * 0.5);

  ctx.drawImage(
    img,
    Math.floor(sx - img.width * 0.5),
    Math.floor(sy - img.height * 0.5)
  );
  __lastExitIconRect = {
    x: Math.floor(sx - img.width * 0.5),
    y: Math.floor(sy - img.height * 0.5),
    w: img.width, h: img.height
  };
}


// ============================================================================
// Actor animation request (shared by mobs + NPCs)
// ============================================================================

function setActorTempAnim(actor, type, durationMs = 450, nowMs = null) {
  if (!actor) return false;
  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);
  const t = lc(type || '');
  if (!t) return false;

  actor.__tempAnimType = t;
  actor.__tempAnimUntilMs = now + Math.max(0, Number(durationMs || 0));
  // reset sheet frame when switching anim types
  actor.animFrame = 0;
  actor.animTimer = 0;
  return true;
}

function lockActorMovementUntil(actor, untilMs) {
  if (!actor) return false;
  const t = Number(untilMs);
  if (!isFinite(t) || t <= 0) return false;

  const prev = Number(actor.__stopMoveUntilMs || 0);
  actor.__stopMoveUntilMs = Math.max(prev, t);

  // Stop immediately
  actor.vx = 0;
  actor.vy = 0;

  // If this is a mob AI move, we also clear transient move target so it doesn't “snap” forward on unlock
  if (actor.aiMoveTargetX !== undefined) actor.aiMoveTargetX = null;

  // If this actor is in the party, temporarily detach them from the follow chain
  // so later party members "skip" them while they're stopped.
  const pIdx = party.indexOf(actor);
  if (pIdx >= 0) {
    actor.__followChainDetached = true;
    actor.__followChainDetachedUntilMs = actor.__stopMoveUntilMs;
  }

  return true;
}


function lockActorMovementForMs(actor, durationMs, nowMs = null) {
  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);
  const dur = Math.max(0, Number(durationMs || 0));
  return lockActorMovementUntil(actor, now + dur);
}

function __clearActorFacingLockIfExpired(actor, nowMs = null) {
  if (!actor) return;
  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);
  const until = Number(actor.__facingLockUntilMs || 0);
  if (isFinite(until) && until > 0 && now >= until) {
    actor.__facingLockUntilMs = 0;
    actor.__facingLockDir = null;
  }
}

function lockActorFacingUntil(actor, untilMs, facing = null, opts = {}) {
  if (!actor) return false;
  const t = Number(untilMs);
  if (!isFinite(t) || t <= 0) return false;

  const now = getGameNowMs();
  __clearActorFacingLockIfExpired(actor, now);

  const prevUntil = Number(actor.__facingLockUntilMs || 0);
  const override = opts && opts.override === true;

  if (override || !isFinite(prevUntil) || prevUntil <= 0 || t >= prevUntil) {
    actor.__facingLockUntilMs = t;
  }

  if (facing === 1 || facing === -1) {
    actor.__facingLockDir = facing;
    actor.facing = facing;
    if (actor === player) lastDirection = facing;
  } else if (actor.__facingLockDir == null && (actor.facing === 1 || actor.facing === -1)) {
    actor.__facingLockDir = actor.facing;
  }

  return true;
}

function applyActorFacingOverride(actor, nowMs = null) {
  if (!actor) return false;
  __clearActorFacingLockIfExpired(actor, nowMs);

  const until = Number(actor.__facingLockUntilMs || 0);
  if (isFinite(until) && until > 0) {
    if (actor.__facingLockDir === 1 || actor.__facingLockDir === -1) {
      actor.facing = actor.__facingLockDir;
      if (actor === player) lastDirection = actor.__facingLockDir;
    }
    return true;
  }

  return false;
}

function updateActorFacing(actor, nowMs = null) {
  if (!actor) return false;
  const now = (nowMs == null) ? getGameNowMs() : Number(nowMs);

  if (applyActorFacingOverride(actor, now)) return true;

  const vx = Number(actor.vx || 0);
  if (Math.abs(vx) > 0.01) {
    const dir = Math.sign(vx) || actor.facing || 1;
    actor.facing = dir;
    if (actor === player) lastDirection = dir;
    return true;
  }

  if (actor.facing === -1 || actor.facing === 1) {
    if (actor === player) lastDirection = actor.facing;
  }
  return true;
}

function getActionAnimSpec(actionDef, fallbackType = 'ability', fallbackMs = 520) {
  const t = lc(actionDef?.animation ?? actionDef?.anim ?? fallbackType);
  const ms = Number(
    actionDef?.animationMs ??
    actionDef?.animMs ??
    actionDef?.castingTimeMs ??
    actionDef?.timeMs ??
    fallbackMs
  );

  return {
    type: t || lc(fallbackType || 'ability'),
    durationMs: (isFinite(ms) && ms >= 0) ? ms : fallbackMs
  };
}


function getActorRequestedAnimType(actor, stoppedLongEnough, nowMs) {
  const now = Number(nowMs);

  if (actorHasTag(actor, 'stunned')) return 'stunned';
  const tempType = lc(actor?.__tempAnimType || '');
  const until = Number(actor?.__tempAnimUntilMs || 0);

  if (tempType && isFinite(until) && until > now) return tempType;

  const moving = Math.abs(actor?.vx || 0) > 0.1;
  if (moving) return 'run';

  // stopped vs wait behavior matches your existing drawActorSprite logic
  if (!actor?.hasEverMoved || stoppedLongEnough) return 'stopped';
  return 'stopped';
}

// Draw a single resolved sheet (either 1-frame or sprite-sheet)
function drawResolvedActorSheet({ actor, sheet, x, y, flip = false, freezeAnim = false }) {
  if (!sheet) return false;

  // 1-frame fallback
  if (!sheet.width || sheet.width <= sheet.height) {
    if (flip) {
      ctx.save(); ctx.scale(-1, 1);
      ctx.drawImage(sheet, -(x + actor.w), y, actor.w, actor.h);
      ctx.restore();
      return true;
    }

    const scale = actor.h / sheet.height;
    const drawH = actor.h;
    const drawW = Math.floor(sheet.width * scale);
    const drawX = Math.floor(x + (actor.w - drawW) / 2);
    const drawY = Math.floor(y);

    ctx.drawImage(sheet, drawX, drawY, drawW, drawH);
    return true;
  }

  // Sprite-sheet (square frames)
  const FRAME_H = sheet.height;
  const FRAME_W = FRAME_H;
  const FRAMES = Math.max(1, Math.floor(sheet.width / FRAME_W));

  const delay = animFrameDelayFromSpeed(actor.vx);

  if (!freezeAnim) {
    actor.animTimer = (actor.animTimer || 0) + 1;
    if (actor.animTimer >= delay) {
      actor.animFrame = ((actor.animFrame || 0) + 1) % FRAMES;
      actor.animTimer = 0;
    }
  }

  const scale = actor.h / FRAME_H;
  const drawH = actor.h;
  const drawW = Math.floor(FRAME_W * scale);
  const drawX = Math.floor(x + (actor.w - drawW) / 2);
  const drawY = Math.floor(y);

  ctx.save();
  if (flip) {
    ctx.translate(drawX + drawW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      sheet,
      (actor.animFrame || 0) * FRAME_W, 0, FRAME_W, FRAME_H,
      0, drawY, drawW, drawH
    );
  } else {
    ctx.drawImage(
      sheet,
      (actor.animFrame || 0) * FRAME_W, 0, FRAME_W, FRAME_H,
      drawX, drawY, drawW, drawH
    );
  }
  ctx.restore();
  return true;
}

function resolveActorSheetForDraw(kind, id, actor, facing, animType, nowMs) {
  const t = lc(animType || 'wait');

  // Choose direction key for directional anims
  const dir =
    (t === 'wait' || t === 'spawn' || t === 'despawn')
      ? ''
      : (facing < 0 ? 'left' : 'right');

  let sheet = null;

  if (lc(kind) === 'mob') sheet = getOrRequestMobSprite(id, t, dir);
  else sheet = getOrRequestNpcSprite(id, t, dir);

  // Mirroring fallback: if left missing but right exists (or vice versa), use it and flip.
  let flip = false;
  if (!sheet && dir) {
    const otherDir = (dir === 'left') ? 'right' : 'left';
    const other =
      (lc(kind) === 'mob')
        ? getOrRequestMobSprite(id, t, otherDir)
        : getOrRequestNpcSprite(id, t, otherDir);

    if (other) {
      sheet = other;
      flip = true;
    }
  }

  if (!sheet && t === 'stunned') {
    const fallbackType = 'stopped';
    sheet = (lc(kind) === 'mob')
      ? getOrRequestMobSprite(id, fallbackType, dir)
      : getOrRequestNpcSprite(id, fallbackType, dir);

    if (!sheet && dir) {
      const otherDir = (dir === 'left') ? 'right' : 'left';
      const other =
        (lc(kind) === 'mob')
          ? getOrRequestMobSprite(id, fallbackType, otherDir)
          : getOrRequestNpcSprite(id, fallbackType, otherDir);

      if (other) {
        sheet = other;
        flip = true;
      }
    }
  }

  return { sheet, flip };
}


function drawActorSprite({ actor, sprites, x, y, facing, stoppedLongEnough, freezeAnim = false }) {
  // Legacy compatibility wrapper: keep your old callers working.
  // Prefer directional run/stop; fall back to idle.
  const moving = Math.abs(actor.vx || 0) > 0.1;

  let sheet = sprites.idle;
  let flip = false;

  if (moving) {
    if (facing < 0) {
      if (sprites.runLeft) sheet = sprites.runLeft;
      else if (sprites.runRight) { sheet = sprites.runRight; flip = true; }
    } else {
      if (sprites.runRight) sheet = sprites.runRight;
      else if (sprites.runLeft) { sheet = sprites.runLeft; flip = true; }
    }
  } else {
    if (!actor.hasEverMoved || stoppedLongEnough) {
      if (sprites.stoppedForward) sheet = sprites.stoppedForward;
    } else {
      if (facing < 0) {
        if (sprites.stoppedLeft) sheet = sprites.stoppedLeft;
        else if (sprites.stoppedRight) { sheet = sprites.stoppedRight; flip = true; }
      } else {
        if (sprites.stoppedRight) sheet = sprites.stoppedRight;
        else if (sprites.stoppedLeft) { sheet = sprites.stoppedLeft; flip = true; }
      }
    }
  }

  drawResolvedActorSheet({ actor, sheet, x, y, flip, freezeAnim });
}


function drawPlayer() {
  const sx = player.worldX - cameraX;
  if (sx + player.w < -50 || sx - player.w > WIDTH + 50) return;

  const x = Math.floor(sx);
  const y = Math.floor(player.y);

  const sprites = playerSprites;

  // Lazy-load extra player sheets (same pattern as NPCs)
  lazyLoadSpriteSetOnce(sprites, [
    { key: 'stoppedLeft', path: 'assets/sprites/player/dace_stopped_left.png' },

    // Future files — safe to add later without code changes
    { key: 'runLeft', path: 'assets/sprites/player/dace_run_left.png' },
    { key: 'runRight', path: 'assets/sprites/player/dace_run_right.png' },
    { key: 'stoppedRight', path: 'assets/sprites/player/dace_stopped_right.png' },
    { key: 'stoppedForward', path: 'assets/sprites/player/dace_stopped_forward.png' },
  ]);

  if (!sprites || !sprites.ready) return;

  const now = getGameNowMs();
  const stoppedLongEnough = now - (player.lastMoveTime || 0) > 10000;

  drawActorSprite({
    actor: player,
    sprites,
    x,
    y,
    facing: lastDirection,
    stoppedLongEnough,
    freezeAnim: shouldFreezeWorldTime()
  });


  // Player head bars (STA/COM only) — draw even when names are hidden (force-visible window)
  const cx = x + player.w / 2;
  const centerY = y + player.h * 0.45;
  const totalH = (HEAD_STAT_BAR_H + HEAD_STAT_BAR_GAP) * 2;
  const barsStartYBottom = centerY + (totalH / 2);
  __pendingHeadBars.push({ kind: 'player', x, yBottom: barsStartYBottom });

  // Name label (draw later so we can place above prompts)
  if (showNames && player.name) {
    __pendingNameLabels.push({
      actor: player,
      label: `${player.name}`,
      cx,
      defaultY: y - 6,
      fontPx: 48,
      showStroke: true
    });
  }
}

function drawCharacter(char) {
  const sx = char.worldX - cameraX;
  if (sx + char.w < -50 || sx - char.w > WIDTH + 50) return;

  const x = Math.floor(sx);
  const y = Math.floor(char.y);

  const now = getGameNowMs();
  const stoppedLongEnough = now - (char.lastMoveTime || 0) > 10000;

  const wantType = getActorRequestedAnimType(char, stoppedLongEnough, now);
  const res = resolveActorSheetForDraw(
    'npc',
    char.name,
    char,
    char.facing,
    wantType,
    now
  );

  if (res.sheet) {
    drawResolvedActorSheet({
      actor: char,
      sheet: res.sheet,
      x,
      y,
      flip: res.flip,
      freezeAnim: shouldFreezeWorldTime()
    });
  } else {
    // Fallback: legacy set while requested sheet loads
    const legacy = buildNpcLegacySpriteSet(char);
    if (legacy && (legacy.idle || legacy.runLeft || legacy.runRight || legacy.stoppedLeft || legacy.stoppedRight || legacy.stoppedForward)) {
      drawActorSprite({
        actor: char,
        sprites: {
          idle: legacy.idle || legacy.stoppedForward || legacy.stoppedRight || legacy.stoppedLeft || legacy.runRight || legacy.runLeft,
          runLeft: legacy.runLeft,
          runRight: legacy.runRight,
          stoppedLeft: legacy.stoppedLeft,
          stoppedRight: legacy.stoppedRight,
          stoppedForward: legacy.stoppedForward
        },
        x,
        y,
        facing: char.facing,
        stoppedLongEnough,
        freezeAnim: shouldFreezeWorldTime()
      });
    } else {
      const p = char.palette || {};
      ctx.fillStyle = p.hat || '#444';
      ctx.fillRect(x, y, char.w, char.h);
    }
  }

  __pendingHeadBars.push({ kind: 'npc', actor: char, x, y });


  if (showNames && char.name) {
    const label = `${char.name}`;
    const cx = x + char.w / 2;
    __pendingNameLabels.push({
      actor: char,
      label,
      cx,
      defaultY: y - 6,
      fontPx: 60,
      showStroke: true
    });
  }

}


function drawMob(mob) {
  const sx = mob.worldX - cameraX;
  if (sx + mob.w < -50 || sx - mob.w > WIDTH + 50) return;

  const x = Math.floor(sx);
  const y = Math.floor(mob.y);

  const now = getGameNowMs();
  const stoppedLongEnough = now - (mob.lastMoveTime || 0) > 10000;

  const wantType = getActorRequestedAnimType(mob, stoppedLongEnough, now);
  const res = resolveActorSheetForDraw('mob', mob.id, mob, mob.facing || 1, wantType, now);

  if (res.sheet) {
    drawResolvedActorSheet({
      actor: mob,
      sheet: res.sheet,
      x,
      y,
      flip: res.flip,
      freezeAnim: shouldFreezeWorldTime()
    });
  } else {
    // Fallback: try legacy set (so you still see something while the requested sheet loads)
    const legacy = buildMobLegacySpriteSet(mob);
    if (legacy && (legacy.idle || legacy.runLeft || legacy.runRight || legacy.stoppedLeft || legacy.stoppedRight || legacy.stoppedForward)) {
      drawActorSprite({
        actor: mob,
        sprites: {
          idle: legacy.idle || legacy.stoppedForward || legacy.stoppedRight || legacy.stoppedLeft || legacy.runRight || legacy.runLeft,
          runLeft: legacy.runLeft,
          runRight: legacy.runRight,
          stoppedLeft: legacy.stoppedLeft,
          stoppedRight: legacy.stoppedRight,
          stoppedForward: legacy.stoppedForward
        },
        x,
        y,
        facing: mob.facing || 1,
        stoppedLongEnough,
        freezeAnim: shouldFreezeWorldTime()
      });
    } else {
      ctx.fillStyle = '#444';
      ctx.fillRect(x, y, mob.w, mob.h);
    }
  }
  __pendingHeadBars.push({ kind: 'mob', actor: mob, x, y });

}

function getActorAutoCastAbility(actor) {
  if (!actor) return null;
  const autoId = lc(actor.autoCastAbilityId || '');
  if (!autoId) return null;
  const list = Array.isArray(actor.abilities) ? actor.abilities : [];
  for (const a of list) {
    if (!a) continue;
    const abId = lc(a.id || a.name || '');
    if (abId === autoId) return a;
  }
  return null;
}

function drawActorAbilityRangeIndicator(actor) {
  if (!actor) return;
  const ability = getActorAutoCastAbility(actor);
  if (!ability) return;
  const tdef = getAbilityTargetingDef(ability);
  const rangePx = getAbilityRangePx(ability, tdef);
  if (!isFinite(rangePx) || rangePx <= 0) return;

  const cx = actorCenterX ? actorCenterX(actor) : (actor.worldX + (actor.w || 0) * 0.5);
  const left = Math.floor((cx - rangePx) - cameraX);
  const width = Math.ceil(rangePx * 2);
  const height = HEIGHT / Math.max(1e-6, cameraZoom || 1);

  ctx.fillStyle = 'rgba(255,0,0,0.4)';
  ctx.fillRect(left, 0, width, height);
}

function drawAbilityRangeIndicators() {
  if (!showRangeIndicators) return;

  drawActorAbilityRangeIndicator(player);
  for (const npc of npcs) drawActorAbilityRangeIndicator(npc);
  for (const p of party) drawActorAbilityRangeIndicator(p);
  for (const m of mobs) drawActorAbilityRangeIndicator(m);
}

function drawCharacters() {
  // Draw world mobs
  for (const mob of mobs) {
    drawMob(mob);
  }


  // Draw world NPCs
  for (const npc of npcs) {
    drawCharacter(npc);
  }

  // Draw party members back-to-front
  for (let i = party.length - 1; i >= 0; i--) {
    drawCharacter(party[i]);
  }
}



function drawScenery() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (!currentArea) {
    // Fallback plain sky
    ctx.fillStyle = '#4f5d75';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }

  const tileW = currentArea.sectionTileWidth;
  const hGround = TILE_DRAW_HEIGHT();

  // --- SKY (full height, no parallax, screen-space tiling) ---
  if (currentArea.skyEntry && currentArea.skyEntry.ready) {
    const entry = currentArea.skyEntry;
    const H = HEIGHT;
    const scaledW = Math.floor(H * (entry.w / Math.max(1, entry.h)));
    if (scaledW > 0) {
      // Since parallax is 0, we tile in SCREEN space (not world), so sky does not move.
      for (let x = 0; x < WIDTH + scaledW; x += scaledW) {
        ctx.drawImage(entry.img, x, 0, scaledW, H);
      }
    }
  } else {
    // Simple gradient fallback
    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, '#283046');
    grad.addColorStop(1, '#4f5d75');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // --- Time-of-day sky tint (post-sky overlay) ---
  drawSkyTimeOverlay();


  function drawStripBySection(entries, parallax) {
    if (!entries || entries.length === 0) return;

    const sectionW = currentArea.sectionTileWidth;

    for (let i = 0; i < entries.length; i++) {
      let entry = entries[i];
      if (!entry) continue;

      if (typeof entry === 'string') {
        entry = entries[i] = loadTileImage(entry);
      }
      if (!entry || !entry.ready) continue;

      // Background tile width in WORLD space
      const worldW = sectionW;

      // Scale image so its WORLD width == section width
      const scale = worldW / entry.w;
      const drawW = worldW;
      const drawH = entry.h * scale;

      const worldX = (i - 1) * sectionW;

      // Parallax applied ONLY here
      const screenX = worldToScreenX(worldX, parallax);

      const screenY = Math.floor(HEIGHT - drawH);

      ctx.drawImage(entry.img, screenX, screenY, drawW, drawH);
    }
  }



  // --- DISTANT BACKGROUNDS (full height, tiny parallax) ---
  //drawStripFullHeight(currentArea.distantEntries, PARALLAX.distant);
  drawStripBySection(currentArea.distantEntries, PARALLAX.distant);

  // --- BACKGROUNDS (full height, middling parallax) ---
  //drawStripFullHeight(currentArea.backgroundEntries, PARALLAX.background);
  drawStripBySection(currentArea.backgroundEntries, PARALLAX.background);

  drawBackgroundObjects();  // NEW: behind ground

  // --- Time-of-day darkening: Group A (sky + background layers/objects) ---
  drawTimeDarkenOverlay('A');


  // --- GROUND (existing per-section loop) ---
  if (currentArea.sections) {
    const h = TILE_DRAW_HEIGHT();
    for (let i = 0; i < currentArea.sections.length; i++) {
      const s = currentArea.sections[i];
      const entry = currentArea.groundEntries[i] || loadGroundTile(s.groundKey);
      const startX = i * tileW;
      if (entry && entry.ready) {
        const screenX = worldToScreenX(startX, PARALLAX.ground);
        ctx.drawImage(entry.img, screenX, HEIGHT - h, tileW, h);
      } else {
        const screenX = worldToScreenX(startX, PARALLAX.ground);
        ctx.fillStyle = (i % 2 === 0) ? '#5c7a53' : '#4d6a46';
        ctx.fillRect(screenX, HEIGHT - h, tileW, h);
      }
    }
  }

  drawSafeplaceMarkers();

  drawGroundBackObjects(); // NEW: moves with ground, but behind characters
  drawWorldItems();


  // (Characters & player are drawn in other functions)
}

function drawSafeplaceMarkers() {
  if (!currentArea || !currentArea.safePlacesWorld || currentArea.safePlacesWorld.length === 0) return;

  const entry = loadObjectImage('safeplace');
  if (!entry || !entry.ready || entry.failed) return;

  const srcW = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameW) : Math.max(1, entry.w);
  const srcH = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameH) : Math.max(1, entry.h);
  if (!isFinite(srcW) || !isFinite(srcH) || srcH <= 0) return;

  const targetH = HEIGHT;
  const targetW = Math.floor(targetH * (srcW / srcH));
  const y = 0;

  for (const sp of currentArea.safePlacesWorld) {
    if (!sp) continue;
    const sx = worldToScreenX(Number(sp.worldX) || 0, PARALLAX.ground);
    const x = Math.floor(sx - (targetW / 2));
    ctx.drawImage(entry.img, x, y, targetW, targetH);
  }
}

function drawParallaxObjectLayer(list, parallax, defaultHeightFactor, dyFn) {
  if (!list || list.length === 0) return;

  const nowMs = getGameNowMs();

  for (const obj of list) {
    if (obj && obj._spawned === false) continue;
    const base = objectBaseFromKey(obj.key || obj.name || obj.filename);

    const resolved = resolvePlacedObjectRender(obj, base, nowMs);

    let entry = resolved.entry;
    let loop = resolved.loop;
    let nonLoopKind = resolved.nonLoopKind;

    if (!entry || !entry.ready || entry.failed) {
      const fallback = loadObjectImage(base);
      if (fallback && fallback.ready && !fallback.failed) {
        entry = fallback;
        loop = true;
        nonLoopKind = null;
      } else {
        continue;
      }
    }

    const sx = worldToScreenX(obj.worldX, parallax);

    const targetH = Math.floor(
      (obj.heightPx || (TILE_DRAW_HEIGHT() * defaultHeightFactor)) * SCALE.objects
    );

    // Use frame aspect if spritesheet (frameW/frameH), otherwise entry w/h
    const srcW = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameW) : Math.max(1, entry.w);
    const srcH = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameH) : Math.max(1, entry.h);

    const targetW = Math.floor(targetH * (srcW / srcH));

    const dy = Math.floor(dyFn(obj, targetH));
    const startMs =
      (nonLoopKind === 'interact') ? (obj._interactAnimPlayMs || obj._interactAnimStartMs || 0)
      : (nonLoopKind === 'opening' || nonLoopKind === 'closing') ? (obj._obstacleTransition?.playMs || obj._obstacleTransition?.startMs || 0)
      : 0;

    drawObjectImageEntry(entry, sx, dy, targetW, targetH, nowMs, startMs, loop);

  }
}


function drawBackgroundObjects() {
  if (!currentArea || !currentArea.backObjects || currentArea.backObjects.length === 0) return;

  drawParallaxObjectLayer(
    currentArea.backObjects,
    PARALLAX.backObjects,
    0.55,
    (obj, targetH) => {
      const baseY = HEIGHT - TILE_DRAW_HEIGHT();
      return baseY - targetH + (obj.yJitter || 0) - (obj.baseBelowTop || 0);
    }
  );
}

function objectBaseFromKey(key) {
  return lc(
    String(key || '')
      .split('/')
      .pop()
      .replace(/\.[a-z0-9]+$/i, '')
  );
}


function drawGroundObjectLayer(list, instancePrefix, dyOffset) {
  if (!list || list.length === 0) return;

  for (let i = 0; i < list.length; i++) {
    const obj = list[i];
    if (!obj) continue;
    if (obj._spawned === false) continue;

    const nowMs = getGameNowMs();


    const base = objectBaseFromKey(obj.key || obj.name || obj.filename);
    const resolved = resolvePlacedObjectRender(obj, base, nowMs);

    let entry = resolved.entry;
    let loop = resolved.loop;
    let nonLoopKind = resolved.nonLoopKind;

    // Never let a transient not-ready/missing state make the object disappear.
    if (!entry || !entry.ready || entry.failed) {
      const fallback = loadObjectImage(base);
      if (fallback && fallback.ready && !fallback.failed) {
        entry = fallback;
        loop = true;
        nonLoopKind = null;
      } else {
        continue;
      }
    }



    const sx = worldToScreenX(obj.worldX, PARALLAX.ground);

    const targetH = Math.floor(
      (obj.heightPx || (TILE_DRAW_HEIGHT() * 0.70)) * SCALE.objects
    );
    const srcW = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameW) : Math.max(1, entry.w);
    const srcH = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameH) : Math.max(1, entry.h);
    const targetW = Math.floor(targetH * (srcW / srcH));

    const dy = Math.floor(HEIGHT - targetH + dyOffset);
    const startMs =
      (nonLoopKind === 'interact') ? (obj._interactAnimPlayMs || obj._interactAnimStartMs || 0)
      : (nonLoopKind === 'opening' || nonLoopKind === 'closing') ? (obj._obstacleTransition?.playMs || obj._obstacleTransition?.startMs || 0)
      : 0;

    drawObjectImageEntry(entry, sx, dy, targetW, targetH, nowMs, startMs, loop);



    drawObjectImageEntry(entry, sx, dy, targetW, targetH, nowMs, startMs, resolved.loop);

    // ---- interaction icon (object) ----
    //const base = objectBaseFromKey(obj.key);
    const instanceId = String(obj.instanceId || `${instancePrefix}:${base}:${i}`).trim();

    const instanceKey = makeProxKey({ kind: 'object', instanceId });
    const typeKey = makeProxTypeKey({ kind: 'object', id: base });

    const isFocused = (proximityInteractFocus.get(typeKey) === instanceKey);
    const canInteract = isObjectInteractable(base, instanceKey);

    if (isFocused && canInteract) {
      __lastInteractObjectRect = {
        x: sx,
        y: dy,
        w: targetW,
        h: targetH,
        instanceKey
      };
      __pendingInteractIcon = {
        x: sx + Math.floor(targetW * 0.5),
        y: dy - 16,
        label: 'Space'
      };
    }
  }
}


function drawGroundBackObjects() {
  if (!currentArea || !currentArea.groundBackObjects || currentArea.groundBackObjects.length === 0) return;
  drawGroundObjectLayer(currentArea.groundBackObjects, 'gback', -250);
}

function drawWorldItems() {
  if (!currentArea || !Array.isArray(currentArea.worldItems) || currentArea.worldItems.length === 0) return;

  const coverList = __getCoverRectsForCurrentArea();

  for (const item of currentArea.worldItems) {
    if (!isWorldItemAvailable(item)) continue;

    const m = getWorldItemDrawMetrics(item);
    if (!m) continue;

    const { icon, targetW, targetH, sx, sy } = m;

    if (icon && icon.ready && icon.img && !icon.failed) {
      ctx.drawImage(icon.img, Math.floor(sx), Math.floor(sy), targetW, targetH);
    } else {
      const cx = Math.floor(sx + targetW * 0.5);
      const cy = Math.floor(sy + targetH * 0.75);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(6, Math.floor(targetH * 0.12)), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const isFocused = !!(currentItemInteract && currentItemInteract.instanceKey === item.instanceKey);
    const canInteract = isFocused && !isWorldItemCoveredWithCoverList(item.instanceKey, coverList);

    if (isFocused && canInteract && !currentObjectInteract) {
      __lastInteractItemRect = {
        x: Math.floor(sx),
        y: Math.floor(sy),
        w: Math.floor(targetW),
        h: Math.floor(targetH),
        instanceKey: item.instanceKey
      };
      __pendingInteractIcon = {
        x: Math.floor(sx + targetW * 0.5),
        y: Math.floor(sy - 16),
        label: 'Space'
      };
    }
  }
}

function drawGroundForeObjects() {
  if (!currentArea || !currentArea.groundForeObjects || currentArea.groundForeObjects.length === 0) return;
  drawGroundObjectLayer(currentArea.groundForeObjects, 'gfore', 0);
}


function drawForegroundObjects() {
  if (!currentArea || !currentArea.foreObjects || currentArea.foreObjects.length === 0) return;

  const spots = currentArea.protectedViewSpots || [];
  const hasSpots = spots.length > 0;

  // Only cull random-placed foreground objects; explicitly-positioned ones remain unchanged
  const list = (!hasSpots) ? currentArea.foreObjects : currentArea.foreObjects.filter(obj => {
    if (!obj || !obj.random) return true;

    const nearPx = Math.floor(WIDTH * 0.75);
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      if (!s) continue;

      // Only enforce when player is near the protected point
      if (Math.abs((player.worldX || 0) - s.worldX) > nearPx) continue;

      // Estimate draw rect for foreground object (screen space)
      const nowMs = getGameNowMs();
      const base = objectBaseFromKey(obj.key || obj.name || obj.filename);
      const resolved = resolvePlacedObjectRender(obj, base, nowMs);
      const entry = resolved.entry;

      const targetH = Math.floor(
        (obj.heightPx || (TILE_DRAW_HEIGHT() * 0.70)) * SCALE.objects
      );

      let ratio = 1;
      if (entry && entry.ready) {
        const srcW = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameW) : Math.max(1, entry.w);
        const srcH = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameH) : Math.max(1, entry.h);
        if (srcH > 0) ratio = (srcW / srcH);
      }
      const targetW = Math.max(8, Math.floor(targetH * ratio));

      const foreL = worldToScreenX(obj.worldX, PARALLAX.foreground);
      const foreR = foreL + targetW;

      const spotL = worldToScreenX(s.worldX, PARALLAX.ground);
      const spotR = spotL + (s.widthPx || player.w || 0);

      const margin = 24;
      const overlaps = (foreL < (spotR + margin)) && (foreR > (spotL - margin));
      if (overlaps) return false;
    }

    return true;
  });

  drawParallaxObjectLayer(
    list,
    PARALLAX.foreground,
    0.70,
    (_obj, targetH) => (HEIGHT - targetH)
  );
}



window.debugRules = function (npcName = null) {
  const result = {};

  for (const [name, rec] of Object.entries(npcRegistry)) {
    if (npcName && name !== npcName) continue;

    result[name] = {
      inParty: rec.inParty,
      area: rec.area,
      ruleCount: rec.rules?.length || 0,
      rules: (rec.rules || []).map(r => ({
        id: r.id,
        // active: !!r._active,
        // scopeWhen: r.scopeWhen || null,
        // descopeWhen: r.descopeWhen || null,
        triggerWhen: r.triggerWhen || null
      }))
    };
  }

  console.table(
    Object.entries(result).map(([name, data]) => ({
      npc: name,
      inParty: data.inParty,
      area: data.area,
      rules: data.ruleCount
    }))
  );

  return result;
};




function startFadeTransfer(callbackMid) {
  FADE.id++;
  FADE.active = true;
  FADE.kind = 'transfer';
  FADE.phase = 'out';
  FADE.t = 0;
  FADE.onMid = callbackMid;

  // start from current alpha (usually 0)
  FADE.startAlpha = FADE.alpha;
  FADE.targetAlpha = 1;
  return FADE.id;
}

function startFadeTo(targetAlpha, durationSeconds = 0) {
  const a = Math.max(0, Math.min(1, Number(targetAlpha)));
  const dur = Math.max(0, Number(durationSeconds) || 0);

  FADE.id++;
  FADE.kind = 'tween';
  FADE.active = true;
  FADE.phase = 'idle';
  FADE.onMid = null;

  FADE.t = 0;
  FADE.startAlpha = FADE.alpha;
  FADE.targetAlpha = a;
  FADE.dur = dur;

  if (FADE.dur <= 0) {
    FADE.alpha = FADE.targetAlpha;
    FADE.active = false;
    FADE.kind = 'none';
    FADE.t = 0;
  }

  return FADE.id;
}

function startFadePulse(targetAlpha, outSeconds = 1, inSeconds = 1) {
  const a = Math.max(0, Math.min(1, Number(targetAlpha) || 0));
  const outDur = Math.max(0, Number(outSeconds) || 0);
  const inDur = Math.max(0, Number(inSeconds) || 0);

  const id = startFadeTo(a, outDur);

  // Only fade back in if nothing else has started a new fade in the meantime.
  setTimeout(() => {
    if (FADE.id !== id) return;
    startFadeTo(0, inDur);
  }, Math.floor(outDur * 1000));

  return id;
}

function __listHasName(arr, name) {
  const want = lc(name || '');
  if (!want) return false;
  for (const v of (arr || [])) {
    if (lc(v) === want) return true;
  }
  return false;
}

function __listRemoveName(arr, name) {
  const want = lc(name || '');
  if (!want || !Array.isArray(arr)) return;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (lc(arr[i]) === want) arr.splice(i, 1);
  }
}

function __recoverStatsVitals(stats) {
  if (!stats || typeof stats !== 'object') return;
  for (const k of ['stamina', 'composure']) {
    const rec = stats[k];
    if (!rec || typeof rec !== 'object') continue;
    const b = Number(rec.base);
    if (isFinite(b)) rec.current = b;
  }
}

// Best-effort: recover an NPC everywhere it might exist + clear pass-out flags + clear fall timer
function __recoverNpcEverywhere(npcName) {
  if (!npcName) return;

  // Registry
  const r = ensureNpcRecord(npcName);
  ensureNpcRecordStats(npcName, r);
  __recoverStatsVitals(r.stats);

  // In-world instance(s)
  const want = lc(npcName);
  for (const a of party) {
    if (a && lc(a.name) === want) {
      __recoverStatsVitals(a.stats);
      a._passedOut = false;
    }
  }
  for (const a of npcs) {
    if (a && lc(a.name) === want) {
      __recoverStatsVitals(a.stats);
      a._passedOut = false;
    }
  }

  // Clear fall timer
  unconsciousNpcFalls.delete(want);
}

function __getSafePlacesWorldForArea(areaName) {
  const aKey = String(areaName || '').trim();
  const a = areasData ? areasData[aKey] : null;
  if (!a || !Array.isArray(a.sections)) return [];

  const tileW = a.sectionTileWidth || 128;
  const out = [];

  for (let i = 0; i < a.sections.length; i++) {
    const s = a.sections[i];
    const startX = i * tileW;
    for (const sp of (s.safePlaces || [])) {
      out.push({
        ...sp,
        sectionIndex: i,
        worldX: startX + (Number(sp.posLocal) || 0)
      });
    }
  }

  return out;
}

function __pickNearestSafePlace(areaName, worldX) {
  const list = __getSafePlacesWorldForArea(areaName);
  if (!list.length) return null;

  let best = null;
  let bestD = Infinity;

  const x = Number(worldX) || 0;
  for (const sp of list) {
    const d = Math.abs((Number(sp.worldX) || 0) - x);
    if (d < bestD) {
      bestD = d;
      best = sp;
    }
  }

  if (!best) return null;

  const aKey = String(areaName || '').trim();
  const a = areasData ? areasData[aKey] : null;
  const tileW = a?.sectionTileWidth || 128;
  const idx = Math.max(0, Math.min((a?.sections?.length || 1) - 1, Math.floor((Number(best.worldX) || 0) / tileW)));
  const secName = a?.sections?.[idx]?.name || null;

  return {
    area: aKey,
    section: secName,
    id: best.id,
    worldX: Number(best.worldX) || 0
  };
}

function __moveNpcRegistryTo(areaName, worldX, npcName) {
  const rec = ensureNpcRecord(npcName);
  rec.inParty = false;
  rec.area = areaName;
  rec.worldX = worldX;

  rec.met = true;
  if (!rec.firstMetAt) rec.firstMetAt = Date.now();
  rec.lastSeenArea = areaName;
  rec.lastSeenWorldX = worldX;
  rec.lastSeenAt = Date.now();

  ensureNpcRecordStats(npcName, rec);
}

function __scatterX(baseX, radiusPx) {
  const r = Math.max(0, Number(radiusPx) || 0);
  if (r <= 0) return Number(baseX) || 0;
  return (Number(baseX) || 0) + rollInt(-Math.floor(r), Math.floor(r));
}


function __processUnconsciousNpcAutoRecover(currentDayIndex) {
  const day = Number(currentDayIndex);
  if (!isFinite(day)) return;

  for (const [k, info] of unconsciousNpcFalls.entries()) {
    if (!info) continue;
    const fellDay = Number(info.dayIndex);
    if (!isFinite(fellDay)) continue;

    // "a full day" -> next day or later
    if ((day - fellDay) < 1) continue;

    const area = String(info.area || '').trim();
    const x = Number(info.worldX) || 0;

    // Nearest safe place in THAT area; fallback to lastSafePlace if needed
    const sp =
      __pickNearestSafePlace(area, x) ||
      (lastSafePlace ? { ...lastSafePlace } : null);

    if (!sp || !sp.area) {
      // Can't place them; keep timer.
      continue;
    }

    const nm = info.name || k;

    // Move them to safe place as a recovered world NPC
    __moveNpcRegistryTo(sp.area, __scatterX(sp.worldX, 220), nm);
    __recoverNpcEverywhere(nm);

    // They should no longer be considered "unconscious party members"
    __listRemoveName(unconsciousPartyMembers, nm);

    // Timer cleared by __recoverNpcEverywhere(), but belt-and-braces:
    unconsciousNpcFalls.delete(k);
  }
}


function triggerPlayerPassOut() {
  if (playerIsPassedOut) return;
  playerIsPassedOut = true;
  cancelPlayerHeadBarTweens();

  // Snapshot who can "explain" the rescue
  const partyNamesAtPassout = party.map(n => n?.name).filter(Boolean);
  const unconsciousNamesAtPassout = Array.isArray(unconsciousPartyMembers) ? [...unconsciousPartyMembers] : [];

  // Decide which post-wake dialog prompt we will create
  let rescuerName = null;
  let rescuerMode = null;

  if (partyNamesAtPassout.length > 0) {
    rescuerName = partyNamesAtPassout[rollInt(0, partyNamesAtPassout.length - 1)];
    rescuerMode = 'party';
  } else if (unconsciousNamesAtPassout.length > 0) {
    rescuerName = unconsciousNamesAtPassout[rollInt(0, unconsciousNamesAtPassout.length - 1)];
    rescuerMode = 'unconscious';
  } else {
    rescuerName = null;
    rescuerMode = 'narrator';
  }

  startFadeTransfer(() => {
    // Pass-out time skip happens during the fade midpoint.
    __advanceWorldTimeByMinutes(30, { source: 'passout' });

    // If we have no known safe place yet, fall back to the first safe place in this area (if any)
    if (!lastSafePlace && Array.isArray(worldSafePlaces) && worldSafePlaces.length) {
      const sp = worldSafePlaces[0];
      lastSafePlace = {
        area: currentAreaName,
        section: getSectionNameForX(sp.worldX),
        id: sp.id,
        worldX: sp.worldX
      };
    }

    // Hard fallback: do nothing if we still don't know a safe place
    if (!lastSafePlace || !lastSafePlace.area) {
      recoverPlayerOnPassOut();
      playerIsPassedOut = false;
      return;
    }

    // Remember where the player woke up (for prompt expiry timing)
    __passoutSafeplaceId = lastSafePlace.id || null;
    __passoutSafeplaceArea = lastSafePlace.area || null;

    // Move to safe place area, then pin exact X
    snapshotNPCsToRegistry();
    snapshotMobsToRegistry({ stripPlayerTargets: true });


    // ALSO move any "unconscious party members" to the safe place as recovered world NPCs
    if (unconsciousNamesAtPassout.length) {
      for (const nm of unconsciousNamesAtPassout) {
        __moveNpcRegistryTo(lastSafePlace.area, __scatterX(lastSafePlace.worldX, 240), nm);
        __recoverNpcEverywhere(nm);
      }
    }

    buildAndEnterArea(lastSafePlace.area, 'left');
    player.worldX = lastSafePlace.worldX;
    player.vx = 0;
    player.vy = 0;
    resetActorTeleportState(player);

    // Bring party to the safe place too (random positions within 500 worldX)
    scatterPartyNearPlayer(500);
    for (const m of party) {
      if (!m) continue;
      resetActorTeleportState(m);
    }

    // Recover PLAYER + all current party members
    recoverPlayerOnPassOut();
    cancelPlayerHeadBarTweens();

    for (const n of party) {
      if (!n) continue;
      __recoverStatsVitals(n.stats);
      n._passedOut = false;

      const r = ensureNpcRecord(n.name);
      ensureNpcRecordStats(n.name, r);
      __recoverStatsVitals(r.stats);
    }

    // Force section enter/leave to refresh cleanly after teleport
    lastPlayerSection = null;
    lastPlayerSectionIndex = null;
    pendingVerticalTransferFrom = null;
    lastPlayerAreaEnterEdge = null;

    // Add the post-wake prompt / scene (data/dialogs/*.json)
    // if (rescuerMode === 'party' && rescuerName) {
    //   const k = lc(rescuerName);
    //   enqueueNpcSpeechBubblePrompt(
    //     rescuerName,
    //     'Talk',
    //     `${k}.passout_rescue_start`,
    //     `__passout_rescue:${__passoutPromptSeq++}`
    //   );
    // } else if (rescuerMode === 'unconscious' && rescuerName) {
    //   const k = lc(rescuerName);
    //   enqueueNpcSpeechBubblePrompt(
    //     rescuerName,
    //     'Talk',
    //     `${k}.passout_mystery_start`,
    //     `__passout_mystery:${__passoutPromptSeq++}`
    //   );
    // } else {
    //   startRuleScene(
    //     'narrator.passout_alone_start',
    //     `__passout_alone:${__passoutPromptSeq++}`
    //   );
    // }
    // Post-wake prompt/scene:
    // - If an NPC is available AND has the required phrase, give them a prompt whose label is the start phrase text.
    // - Otherwise fall back to narrator.passout_alone_start.
    if (partyNamesAtPassout.length > 0) {
      __pendingPassoutRescue = {
        kind: 'party',
        candidates: [...partyNamesAtPassout],
        phraseId: 'passout_rescue_start',
        triggerKey: `__passout_rescue:${__passoutPromptSeq++}`
      };
    } else if (unconsciousNamesAtPassout.length > 0) {
      __pendingPassoutRescue = {
        kind: 'unconscious',
        candidates: [...unconsciousNamesAtPassout],
        phraseId: 'passout_mystery_start',
        triggerKey: `__passout_mystery:${__passoutPromptSeq++}`
      };
    } else {
      startRuleScene('narrator.passout_alone_start', `__passout_alone:${__passoutPromptSeq++}`);
    }


    playerIsPassedOut = false;
  });
}



function updateFade(dt) {
  if (!FADE.active) return;

  FADE.t += dt;

  if (FADE.kind === 'transfer') {
    // out: alpha -> 1
    if (FADE.phase === 'out') {
      const a = (FADE.durOut > 0) ? Math.min(1, FADE.t / FADE.durOut) : 1;
      FADE.alpha = (FADE.startAlpha ?? 0) + (1 - (FADE.startAlpha ?? 0)) * a;

      if (FADE.t >= FADE.durOut) {
        if (typeof FADE.onMid === 'function') FADE.onMid();
        FADE.phase = 'in';
        FADE.t = 0;

        // in always goes from full black
        FADE.alpha = 1;
        FADE.startAlpha = 1;
      }
      return;
    }

    // in: alpha -> 0
    if (FADE.phase === 'in') {
      const a = (FADE.durIn > 0) ? Math.min(1, FADE.t / FADE.durIn) : 1;
      FADE.alpha = 1 - a;

      if (FADE.t >= FADE.durIn) {
        FADE.alpha = 0;
        FADE.active = false;
        FADE.kind = 'none';
        FADE.phase = 'idle';
        FADE.t = 0;
        FADE.onMid = null;
      }
      return;
    }

    return;
  }

  if (FADE.kind === 'tween') {
    const a = (FADE.dur > 0) ? Math.min(1, FADE.t / FADE.dur) : 1;
    FADE.alpha = (FADE.startAlpha ?? 0) + ((FADE.targetAlpha ?? 0) - (FADE.startAlpha ?? 0)) * a;

    if (a >= 1) {
      FADE.alpha = (FADE.targetAlpha ?? 0);
      FADE.active = false;
      FADE.kind = 'none';
      FADE.t = 0;
    }
  }
}


function drawFadeOverlay() {
  const a = Math.max(0, Math.min(1, Number(FADE.alpha) || 0));
  if (a <= 0) return;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}



const MAX_PHYSICS_DT = 1 / 30; // clamp physics to avoid tunneling on long pauses

function gameLoop(ts) {
  if (!lastTs) {
    lastTs = ts;
    __gameNowMs = performance.now();
  }
  const dtReal = (ts - lastTs) / 1000;
  const dt = Math.min(dtReal, MAX_PHYSICS_DT);
  lastTs = ts;

  if (!shouldFreezeWorldTime()) {
    __gameNowMs += dtReal * 1000;
  }

  update(dt, dtReal);
  updateFade(dtReal);       // NEW: advance fade state

    // ===== World render (affected by camera zoom) =====
  ctx.save();
  applyCameraZoomTransform();
  __lastInteractIconRect = null;
  __lastInteractObjectRect = null;
  __lastInteractItemRect = null;
  __pendingInteractIcon = null;

  drawScenery();

  if (loading) {

    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = uiFont(60);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(loadingMessage || 'Loading...', WIDTH / 2, HEIGHT / 2);

    const prog = __getBlockingLoadProgress();
    if (prog.total > 0) {
      const barW = Math.min(WIDTH * 0.6, 520);
      const barH = 14;
      const barX = (WIDTH - barW) / 2;
      const barY = (HEIGHT / 2) + 60;
      const frac = Math.max(0, Math.min(1, prog.done / prog.total));

      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#fff';
      ctx.fillRect(barX, barY, barW * frac, barH);

      ctx.font = uiFont(24);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`Loading ${prog.done}/${prog.total}`, WIDTH / 2, barY + barH + 10);
    }
    ctx.restore();

    drawFadeOverlay();
    requestAnimationFrame(gameLoop);
    return;
  }

  __pendingNameLabels = [];
  __pendingHeadBars = [];

  drawAbilityRangeIndicators();
  drawCharacters();
  drawPlayer();

  drawGroundForeObjects(); // moves with ground, in front of characters (but behind UI)

  // --- Time-of-day darkening: Group B (ground + actors + groundForeObjects) ---
  drawTimeDarkenOverlay('B');

  // --- Time-of-day darkening: Group C (true foreground objects) ---
  drawTimeDarkenOverlay('C');

  drawForegroundObjects();

  // ===== Above-head UI (recruit icons + dialog prompt bubbles) =====
  const headStack = new Map(); // npc -> current yOffset used
  __lastRecruitIcons = [];
  __lastPromptLayouts = [];

  if (__pendingInteractIcon) {
    __lastInteractIconRect = drawInteractionIcon(
      __pendingInteractIcon.x,
      __pendingInteractIcon.y,
      __pendingInteractIcon.label
    );
  }

  drawExitProximityIcon();
  drawManualTargetingOverlay();
  drawStatChangeFloaters(ctx);
  drawItemFoundFloaters(ctx);

  // Head bars (above all world objects)
  for (const hb of __pendingHeadBars) {
    if (!hb) continue;
    if (hb.kind === 'player') drawPlayerHeadBars(hb.x, hb.yBottom);
    else if (hb.kind === 'npc') drawNpcHeadBars(hb.actor, hb.x, hb.y);
    else if (hb.kind === 'mob') drawMobHeadBars(hb.actor, hb.x, hb.y);
  }

  // 1) Recruit icon for recruitable WORLD NPCs within interaction radius
  for (const npc of npcs) {
    if (!npc) continue;
    if (party.includes(npc)) continue;
    if (!isPlayerWithinNpcRadius(npc)) continue;
    if (!canRecruitNpc(npc)) continue;

    const yOffset = headStack.get(npc) || 0;

    const used = drawRecruitIconForNpc(npc, yOffset);
    headStack.set(npc, yOffset + used);
  }

  // 2) Dialog prompt speech bubbles (stack above anything already drawn)
  const promptLayouts = [];

  for (let i = 0; i < activeDialogPrompts.length; i++) {
    const p = activeDialogPrompts[i];
    if (!p || !p.npc) continue;

    const actor = p.npc;
    if (isActorUnconscious(actor)) continue;
    let yOffset = headStack.get(actor) || 0;

    let keyLabel = 'T';
    if (party.includes(actor)) {
      keyLabel = (Number.isFinite(p.keyNum) && p.keyNum > 0) ? String(p.keyNum) : null;
    }

    const metrics = buildPromptBubbleMetrics(p.prompt, keyLabel);
    const sx = actor.worldX - cameraX + actor.w / 2;
    const sy = actor.y - 10 - yOffset;

    let x = Math.floor(sx - metrics.boxW / 2);
    let y = Math.floor(sy - metrics.boxH);

    const pad = 4;
    if (x < pad) x = pad;
    if (x + metrics.boxW > WIDTH - pad) x = Math.max(pad, WIDTH - metrics.boxW - pad);
    if (y < pad) y = pad;
    if (y + metrics.boxH > HEIGHT - pad) y = Math.max(pad, HEIGHT - metrics.boxH - pad);

    const offscreen = (sx < 0 || sx > WIDTH);
    let tag = null;
    let tagH = 0;
    if (offscreen) {
      const icon = getPromptIconEntry(actor.name);
      const showName = !icon || icon.failed || !icon.ready;
      tag = { icon: icon && icon.ready ? icon : null, name: showName ? actor.name : null };
      tagH = tag.icon ? 40 : (tag.name ? 28 : 0);

      const tagMargin = 4;
      if (y - tagH - tagMargin < pad) {
        y = Math.min(HEIGHT - metrics.boxH - pad, pad + tagH + tagMargin);
      }
    }

    const totalH = metrics.boxH + metrics.pointerH + 6 + (tagH ? (tagH + 4) : 0);

    promptLayouts.push({
      p,
      actor,
      promptIndex: i,
      keyLabel,
      metrics,
      x,
      y,
      w: metrics.boxW,
      h: totalH,
      tag
    });

    headStack.set(actor, yOffset + totalH);
  }

  // Resolve overlaps: lower trigger ids are higher
  promptLayouts.sort((a, b) => {
    const ida = String(a.p.triggerKey || a.p.__promptId || '');
    const idb = String(b.p.triggerKey || b.p.__promptId || '');
    return ida.localeCompare(idb);
  });

  const placed = [];
  for (const item of promptLayouts) {
    for (const prev of placed) {
      const overlapX = !(item.x + item.w <= prev.x || item.x >= prev.x + prev.w);
      const overlapY = !(item.y + item.h <= prev.y || item.y >= prev.y + prev.h);
      if (overlapX && overlapY) {
        item.y = prev.y + prev.h + 6;
      }
    }
    placed.push(item);
  }

  const promptTopByActor = new Map();
  for (const item of placed) {
    if (!item.actor) continue;
    const prev = promptTopByActor.get(item.actor);
    const top = Number(item.y);
    if (!isFinite(top)) continue;
    if (prev == null || top < prev) promptTopByActor.set(item.actor, top);
  }

  // Draw with smooth vertical slide
  const visiblePromptIds = new Set();
  for (const item of promptLayouts) {
    const promptId = item.p.__promptId || `${lc(item.actor.name)}:${item.p.triggerKey || ''}`;
    visiblePromptIds.add(promptId);

    const prevY = __promptAnimYById.has(promptId) ? __promptAnimYById.get(promptId) : item.y;
    const easedY = prevY + (item.y - prevY) * 0.2;
    __promptAnimYById.set(promptId, easedY);

    __lastPromptLayouts.push({
      promptIndex: item.promptIndex,
      x: item.x,
      y: easedY,
      w: item.w,
      h: item.h
    });

    const used = drawSpeechBubbleForNpc(
      item.actor,
      item.p.prompt,
      item.keyLabel,
      0,
      { x: item.x, y: easedY, tag: item.tag, metrics: item.metrics }
    );

    headStack.set(item.actor, used);
  }

  // Clear animations for prompts no longer visible
  for (const [pid] of __promptAnimYById) {
    if (!visiblePromptIds.has(pid)) __promptAnimYById.delete(pid);
  }

  // Draw character names after prompts so they can sit above any visible prompt bubbles
  if (__pendingNameLabels.length > 0) {
    for (const info of __pendingNameLabels) {
      if (!info) continue;
      let nameY = Number(info.defaultY);
      const top = promptTopByActor.get(info.actor);
      if (isFinite(top)) {
        nameY = Math.min(nameY, Math.floor(top) - 6);
      }

      ctx.save();
      ctx.font = uiFont(Number(info.fontPx) || 48);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#fff';
      if (info.showStroke) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeText(String(info.label), info.cx, nameY);
      }
      ctx.fillText(String(info.label), info.cx, nameY);
      ctx.restore();
    }
  }

  ctx.restore(); // end world zoom render

  // ===== Screen-space overlays (NOT affected by zoom) =====
  // ===== Screen-space overlays (NOT affected by zoom) =====
  drawTimeOfDayWidget();
  drawMiniMap();
  drawFullMapOverlay();

  drawWorldToast();
  drawFadeOverlay();



  requestAnimationFrame(gameLoop);

}
