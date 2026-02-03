// Veil

// Grab HTML elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const promptEl = document.getElementById('prompt');

// Conversation overlay elements
const conversationOverlay = document.getElementById('conversationOverlay');
const conversationPortrait = document.getElementById('conversationPortrait');
const dialogBox = document.getElementById('dialogBox');
const optionsBox = document.getElementById('optionsBox');

// Player menu elements
const playerMenuOverlay = document.getElementById('playerMenuOverlay');
const playerMenuTabs = document.getElementById('playerMenuTabs');
const playerMenuContent = document.getElementById('playerMenuContent');
const playerMenuError = document.getElementById('playerMenuError');

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

    renderPlayerMenu();
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

function tryCastPartyAbility(npcName, abilityId) {
  const wantNpc = lc(npcName);
  const wantAb = lc(abilityId);
  if (!wantNpc || !wantAb) return false;

  if (loading) return false;
  if (inConversation || inActionPhrase) return false;
  if (controlsLocked) return false;

  const caster = party.find(n => n && lc(n.name) === wantNpc);
  if (!caster) return false;

  const ability = (Array.isArray(caster.abilities) ? caster.abilities : []).find(a => a && lc(a.id) === wantAb);
  if (!ability) return false;

  const now = performance.now();
  const nextAt = Number(caster.abilityNextAtMs?.[wantAb] || 0);
  if (nextAt > now) {
    showPlayerMenuError('Ability is on cooldown.');
    return false;
  }

  const effects = Array.isArray(ability.effects) ? ability.effects : [];
  if (effects.length) {
    applyEffects(effects, { source: 'ability', npc: caster.name, ability: ability.id });
  }

  const cdMs = Number(ability.cooldownMs || 0);
  if (!caster.abilityNextAtMs) caster.abilityNextAtMs = Object.create(null);
  caster.abilityNextAtMs[wantAb] = now + Math.max(0, cdMs);

  emitGameEvent('npc_ability_cast', { npc: caster.name, ability: ability.id });

  return true;
}


// UI flags
let showNames = false; //don't show character names by default
// Menu state
let inMenu = false;
let activeMenuPageId = 'pc';

const MENU_PAGES = []; // { id, label, render() }
function registerMenuPage(id, label, renderFn) {
  MENU_PAGES.push({ id: String(id), label: String(label), render: renderFn });
}

function setActiveMenuPage(id) {
  activeMenuPageId = String(id || 'pc');
  renderPlayerMenu();
}

function openPlayerMenu(pageId = null) {
  if (!playerMenuOverlay) return;
  inMenu = true;
  clearPlayerMenuError();

  if (pageId) activeMenuPageId = String(pageId);

  playerMenuOverlay.style.display = 'block';
  renderPlayerMenu();
}

function closePlayerMenu() {
  if (!playerMenuOverlay) return;
  inMenu = false;
  playerMenuOverlay.style.display = 'none';
}

function togglePlayerMenu(pageId = null) {
  if (inMenu) closePlayerMenu();
  else openPlayerMenu(pageId);
}

function renderPlayerMenu() {
  if (!playerMenuOverlay || !playerMenuTabs || !playerMenuContent) return;

  // Tabs
  playerMenuTabs.innerHTML = '';
  for (const p of MENU_PAGES) {
    const btn = document.createElement('button');
    btn.className = 'playerMenuTabBtn' + (p.id === activeMenuPageId ? ' active' : '');
    btn.textContent = p.label;
    btn.addEventListener('click', () => setActiveMenuPage(p.id));
    playerMenuTabs.appendChild(btn);
  }

  // Content
  const page = MENU_PAGES.find(p => p.id === activeMenuPageId) || MENU_PAGES[0];
  playerMenuContent.innerHTML = '';
  if (page && typeof page.render === 'function') {
    const node = page.render();
    if (node) playerMenuContent.appendChild(node);
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
  for (const d of PLAYER_STAT_DEFS) {
    const k = String(d.key).toLowerCase();
    const rec = player.stats?.[k] || { base: 0, current: 0 };
    statRows.push([d.label, `${rec.current} / ${rec.base}`]);
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
      ['Alignment', Number(m?.stats?.alignment?.current ?? 0)],
      ['Affection', Number(m?.stats?.affection?.current ?? 0)],
      ['Min Align Recruit', Number(m?.stats?.alignment?.base ?? 0)],
      ['Min Aff Recruit', Number(m?.stats?.affection?.base ?? 0)]
    ];
    wrap.appendChild(makeMenuCard(m.name || 'Party Member', rows));
  }

  return wrap;
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
      String(Number(rec?.stats?.alignment?.current ?? 0)),
      String(Number(rec?.stats?.affection?.current ?? 0)),
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

function renderMenuPage_Journal() {
  const wrap = document.createElement('div');
  wrap.className = 'playerMenuCard';

  const h = document.createElement('div');
  h.className = 'playerMenuCardTitle';
  h.textContent = 'Journal (placeholder)';
  wrap.appendChild(h);

  const t = document.createElement('div');
  t.className = 'playerMenuMuted';
  t.textContent = 'Future: quest log, recent scenes, key flags, discovered lore.';
  wrap.appendChild(t);

  return wrap;
}

let itemsMenuHotkeys = []; // index 0..8 => itemId

let abilitiesMenuHotkeys = []; // index 0..8 => { npcName, abilityId }

function getPartyAbilityList() {
  const out = [];
  for (const npc of party) {
    if (!npc) continue;
    const abs = Array.isArray(npc.abilities) ? npc.abilities : [];
    for (const a of abs) {
      if (!a || !a.id) continue;
      out.push({ npc, ability: a });
    }
  }
  return out;
}

function renderMenuPage_Abilities() {
  const wrap = document.createElement('div');
  wrap.className = 'playerMenuGrid';

  const rows = [];

  abilitiesMenuHotkeys = [];

  const list = getPartyAbilityList();
  const now = performance.now();

  for (let i = 0; i < list.length; i++) {
    const { npc, ability } = list[i];
    const abId = String(ability.id);
    const abName = String(ability.name || ability.id);
    const desc = String(ability.description || '');
    const cdMs = Number(ability.cooldownMs || 0);

    const nextAt = Number(npc.abilityNextAtMs?.[lc(abId)] || 0);
    const remainingMs = Math.max(0, nextAt - now);
    const remainingSec = Math.ceil(remainingMs / 1000);

    const hotKey = (i < 9) ? (i + 1) : null;
    if (hotKey) {
      abilitiesMenuHotkeys[hotKey - 1] = { npcName: npc.name, abilityId: abId };
    }

    const label = hotKey
      ? `${hotKey}. ${npc.name} — ${abName}`
      : `${npc.name} — ${abName}`;

    const cooldownTxt = (cdMs > 0 && remainingMs > 0) ? ` (CD: ${remainingSec}s)` : '';
    rows.push([label + cooldownTxt, desc]);
  }

  wrap.appendChild(makeMenuCard('Abilities', rows.length ? rows : [['—', 'No abilities available.']]));
  return wrap;
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
    const { id, uid, inst } = cards[idx];

    const def = getItemDef(id) || {};
    const usesPerItem = Math.max(1, Math.floor(Number(def.usesPerItem ?? 1)));

    const tile = document.createElement('div');
    tile.className = 'playerMenuItemTile';
    tile.dataset.itemId = lc(id);
    tile.dataset.itemUid = String(uid);

    tile.addEventListener('click', () => {
      if (canUseItem(id, uid)) {
        tryUseItemWithFeedback(id, uid, tile);
      }
    });

    // Name
    const nameLine = document.createElement('div');
    nameLine.className = 'playerMenuItemName';
    nameLine.textContent = def.name ? String(def.name) : id;
    tile.appendChild(nameLine);

    // Image box (always present; if image missing we keep the square)
    const imgBox = document.createElement('div');
    imgBox.className = 'playerMenuItemImgBox';

    const img = document.createElement('img');
    img.className = 'playerMenuItemImg';
    img.alt = def.name ? String(def.name) : id;
    img.src = `assets/items/${lc(id)}.png`;

    img.onerror = () => {
      // Keep the box, just hide the broken image.
      img.style.display = 'none';
      imgBox.classList.add('playerMenuItemImgBoxMissing');
    };

    imgBox.appendChild(img);
    tile.appendChild(imgBox);

    // Uses line (only for items that define uses)
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

    // Hotkey label
    if (idx < 9) {
      const keyHint = document.createElement('div');
      keyHint.className = 'playerMenuItemKey';
      keyHint.textContent = String(idx + 1);
      tile.appendChild(keyHint);
    }

    // Description overlay
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


// Register default pages (modular: add new ones by adding a new registerMenuPage call)
registerMenuPage('pc', 'PC', renderMenuPage_PC);
registerMenuPage('party', 'Party', renderMenuPage_Party);
registerMenuPage('items', 'Items', renderMenuPage_Items);
registerMenuPage('abilities', 'Abilities', renderMenuPage_Abilities);
registerMenuPage('npcs', 'NPCs', renderMenuPage_NPCs);
registerMenuPage('journal', 'Journal', renderMenuPage_Journal);

// Click outside frame closes
if (playerMenuOverlay) {
  playerMenuOverlay.addEventListener('click', (e) => {
    if (e.target === playerMenuOverlay) closePlayerMenu();
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

  const ICON_W = 500;
  const ICON_H = 250;

  const x = WIDTH - ICON_W;
  const y = HEIGHT - ICON_H;

  // 1) Draw night base (always)
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(timeNightIcon.img, x, y, ICON_W, ICON_H);

  // 2) Draw day overlay with phase-based opacity
  const dayA = __clamp01(__getTimeDayOverlayOpacity());
  if (dayA > 0 && timeDayIcon?.ready && timeDayIcon.img) {
    ctx.globalAlpha = dayA;
    ctx.drawImage(timeDayIcon.img, x, y, ICON_W, ICON_H);
  }

  // 3) Draw the sun in front of both icons
  const angDeg = __getSunAngleDegForPhase();
  if (angDeg != null) {
    const SUN_R = 21.75;        // sun radius (tuned to match the timing/visibility constraints)
    const ORBIT_R = ICON_W / 3;

    const cx = x + (ICON_W / 2);  // horizontal center of time icon
    const cy = y + ICON_H;        // vertical bottom of time icon (== screen bottom)

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
  //   morning: 120, // fade night -> day
  //   day:     480,
  //   evening: 120, // fade day -> night
  //   night:   480
  // }

    phases: {
    morning: 300, // fade night -> day
    day:     3300,
    evening: 30, // fade day -> night
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
function shouldAdvanceWorldTime() {
  // No time progression while menus are open
  if (inMenu) return false;

  // No time progression during dialog/conversations,
  // BUT action phrases run while inConversation and should still advance time.
  if (inConversation && !inActionPhrase) return false;

  // Otherwise, time advances (including action scenes even if player is locked)
  return true;
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

  // IMPORTANT: area geometry depends on SCALE.world (tile draw width), so rebuild it.
  if (currentArea) recalcCurrentAreaGeometry();
}

function resizeCanvasResolution() {
  canvas.height = WORLD_HEIGHT;
  canvas.width  = Math.floor(WORLD_HEIGHT * (window.innerWidth / window.innerHeight));

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
  baseStart: 1.8, // multiples of character width
  baseStop:  1.5  // MUST be smaller than baseStart
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
  CAMERA_TWEEN.startedAtMs = performance.now();
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

  const now = performance.now();
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
const BASE_TILE_DRAW_HEIGHT = 110;
function TILE_DRAW_HEIGHT() {
  return Math.floor(BASE_TILE_DRAW_HEIGHT * SCALE.world);
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


let lastProximityNpc = null;

// Track which proximity targets are currently within interaction radius (edge-trigger)
// NOTE: for objects, this is INSTANCE-based because makeProxKey prefers instanceId.
const proximityInside = new Set();

// Track "rule-facing" proximity by TYPE (kind + base id), eg "object:letta_bush"
const proximityInsideTypes = new Set();

// Which instance is currently interactable per type (kind:id → instanceKey)
const proximityInteractFocus = new Map();

// Per-frame target lookup (instanceKey -> target)
const proximityTargetByKey = new Map();

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
  if (actor === player || lc(actor?.name) === 'player') return { kind: 'player' };
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

function getGateIsOpenForObjectInstance(o, def, fallbackInstanceId) {
  const gate = def?.gate || null;
  if (!gate) return false;

  const instanceId = String(o?.instanceId || fallbackInstanceId || '').trim();
  const k = gateFlagKeyForInstance(instanceId);
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
  const k = gateFlagKeyForInstance(instanceId);
  if (!k) return false;
  setFlag('global', k, !!open);
  return true;
}

function toggleGateByInstanceId(instanceId) {
  const k = gateFlagKeyForInstance(instanceId);
  if (!k) return false;
  const cur = getFlag('global', k);
  const next = !(cur === true);
  setFlag('global', k, next);
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

// ===== Player stats =====
// Flexible: add new stats by adding entries here.
const PLAYER_STAT_DEFS = [
  { key: 'stamina',    label: 'STA', base: 5, clampToBase: true  }, // physical HP-like
  { key: 'composure',  label: 'COM', base: 5, clampToBase: true  }, // mental HP-like
  { key: 'endurance',  label: 'END', base: 0, clampToBase: false }, // physical resistance-like (can exceed base via buffs)
  { key: 'fortitude',  label: 'FOR', base: 1, clampToBase: false }  // mental resistance-like (can exceed base via buffs)
];

const PLAYER_STAT_DEF_MAP = Object.create(null); // key -> def
for (const d of PLAYER_STAT_DEFS) PLAYER_STAT_DEF_MAP[String(d.key).toLowerCase()] = d;

function createStatsFromDefs(defs) {
  const out = Object.create(null);
  for (const d of (defs || [])) {
    if (!d || !d.key) continue;
    const k = String(d.key).toLowerCase();
    const base = Number(d.base ?? 0);
    out[k] = { base, current: base };
  }
  return out;
}

function normStatKey(k) {
  return String(k || '').trim().toLowerCase();
}

function ensurePlayerStats() {
  if (!player.stats || typeof player.stats !== 'object') {
    player.stats = createStatsFromDefs(PLAYER_STAT_DEFS);
  } else {
    // ensure any newly-added defs exist
    for (const d of PLAYER_STAT_DEFS) {
      const k = String(d.key).toLowerCase();
      if (!player.stats[k]) {
        const base = Number(d.base ?? 0);
        player.stats[k] = { base, current: base };
      }
    }
  }
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

function getNpcInteractTags(npcName) {
  const name = String(npcName || '');
  const def = (npcDetails && npcDetails[name]) ? npcDetails[name] : null;
  const raw = def?.interacts || def?.interactTags || def?.interact || null;
  if (!Array.isArray(raw)) return [];
  return raw.map(x => lc(x)).filter(Boolean);
}

function getPlayerInteractTags() {
  // Prefer explicit Player record in characters.json; fall back to current player character name.
  const def =
    (npcDetails && npcDetails['Player']) ? npcDetails['Player']
    : (npcDetails && npcDetails[player?.name]) ? npcDetails[player?.name]
    : null;

  const raw = def?.interacts || def?.interactTags || def?.interact || null;
  if (!Array.isArray(raw)) return [];
  return raw.map(x => lc(x)).filter(Boolean);
}

function partyHasInteractTag(tag) {
  const want = lc(tag);
  if (!want) return false;

  // Player alone should still be able to interact if Player has the tag.
  const pTags = getPlayerInteractTags();
  if (pTags.includes(want)) return true;

  for (const p of (party || [])) {
    const nm = p?.name;
    if (!nm) continue;
    const tags = getNpcInteractTags(nm);
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

function getItemDef(itemId) {
  const id = lc(itemId);
  if (!id || !itemsData) return null;

  // Support either { items: { id: def } } OR { id: def }
  const root = itemsData.items && typeof itemsData.items === 'object' ? itemsData.items : itemsData;
  return root && typeof root === 'object' ? (root[id] || root[itemId] || null) : null;
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

function getInvBucket(itemId) {
  const inv = ensurePlayerInventory();
  const id = lc(itemId);
  if (!id) return null;

  // Bucket schema:
  //   inv[id] = { instances: [ { uid: '...', usesLeft: number|null } ] }
  // Back-compat: if older saves used { count, usesLeft }, migrate on the fly.
  if (!inv[id]) inv[id] = { instances: [] };

  const bucket = inv[id];

  // Migrate legacy format
  if (!Array.isArray(bucket.instances) && (bucket.count != null || bucket.usesLeft != null)) {
    const def = getItemDef(id);
    const usesPerItem = Math.max(1, Math.floor(Number(def?.usesPerItem ?? 1)));

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


function addItemToInventory(itemId, qtyRaw = 1) {
  const id = lc(itemId);
  const qty = Math.max(0, Math.floor(Number(qtyRaw)));
  if (!id || !isFinite(qty) || qty <= 0) return;

  const def = getItemDef(id);
  const usesPerItem = Math.max(1, Math.floor(Number(def?.usesPerItem ?? 1)));

  const bucket = getInvBucket(id);
  if (!bucket) return;

  const prevCount = bucket.instances.length;

  for (let i = 0; i < qty; i++) {
    bucket.instances.push({
      uid: nextInventoryUid(),
      usesLeft: usesPerItem > 1 ? usesPerItem : null
    });
  }

  if (bucket.instances.length !== prevCount) {
    emitGameEvent('inventory_change', { item: id });
    spawnFoundItemFeedback(id, qty);
  }
}

function removeItemFromInventory(itemId, qtyRaw = 1) {
  const id = lc(itemId);
  const qty = Math.max(0, Math.floor(Number(qtyRaw)));
  if (!id || !isFinite(qty) || qty <= 0) return;

  const inv = ensurePlayerInventory();
  const bucket = getInvBucket(id);
  if (!bucket) return;

  const prevCount = bucket.instances.length;

  for (let i = 0; i < qty; i++) {
    if (bucket.instances.length <= 0) break;
    bucket.instances.pop();
  }

  if (bucket.instances.length <= 0) {
    delete inv[id];
  }

  if (bucket.instances.length !== prevCount) {
    emitGameEvent('inventory_change', { item: id });
  }
}


let __lastItemUseError = '';

function wouldEffectsChangeAnything(effects) {
  __lastItemUseError = '';

  if (!Array.isArray(effects) || effects.length === 0) {
    __lastItemUseError = 'That item has no effect.';
    return false;
  }

  // Snapshot only what we need for item effects (currently: player stats + inventory)
  ensurePlayerStats();
  ensurePlayerInventory();

  const statsBefore = JSON.parse(JSON.stringify(player.stats || {}));
  const invBefore = JSON.parse(JSON.stringify(player.inventory || {}));

  // Apply effects to real state, then compare, then revert.
  applyEffects(effects);

  const statsAfter = JSON.parse(JSON.stringify(player.stats || {}));
  const invAfter = JSON.parse(JSON.stringify(player.inventory || {}));

  // Revert
  player.stats = statsBefore;
  player.inventory = invBefore;

  const changed =
    JSON.stringify(statsBefore) !== JSON.stringify(statsAfter) ||
    JSON.stringify(invBefore) !== JSON.stringify(invAfter);

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

function useItemOnce(itemId, itemUid = null) {
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

  const usesPerItem = Math.max(1, Math.floor(Number(def.usesPerItem ?? 1)));

  if (!wouldEffectsChangeAnything(def.effects)) {
    return false;
  }

  if (Array.isArray(def.effects)) {
    applyEffects(def.effects);
  }

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



function getPlayerStatRec(statKeyRaw) {
  ensurePlayerStats();
  const k = normStatKey(statKeyRaw);
  if (!k) return null;
  if (!player.stats[k]) {
    player.stats[k] = { base: 0, current: 0 };
  }
  return player.stats[k];
}

function setPlayerStatField(statKeyRaw, fieldRaw, valueRaw) {
  const rec = getPlayerStatRec(statKeyRaw);
  if (!rec) return;

  const k = normStatKey(statKeyRaw);
  const def = PLAYER_STAT_DEF_MAP[k];

  const field = normStatKey(fieldRaw) || 'current';
  const v = Number(valueRaw);
  if (!isFinite(v)) return;

  if (field === 'base') {
    const prevBase = rec.base;
    const prevCurrent = rec.current;

    rec.base = v;

    if (def?.clampToBase && rec.current > rec.base) {
      rec.current = rec.base;
    }

    emitGameEvent('stat_change', {
      actor: 'player',
      stat: k,
      field: 'base',
      prev: prevBase,
      next: rec.base
    });

    if (rec.current !== prevCurrent) {
      emitGameEvent('stat_change', {
        actor: 'player',
        stat: k,
        field: 'current',
        prev: prevCurrent,
        next: rec.current
      });
    }

    return;
  }

  const prev = rec.current;
  rec.current = v;

  if (def?.clampToBase) {
    rec.current = Math.max(0, Math.min(rec.current, rec.base));
  }

  if (rec.current !== prev) {
    emitGameEvent('stat_change', {
      actor: 'player',
      stat: k,
      field: 'current',
      prev,
      next: rec.current
    });
  }
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



function applyStatChangeWithFeedback(target, statKeyRaw, op, payload = null) {
  // target: { kind:'player' } | { kind:'npc', name:'Rowyn' } | { kind:'mob', id:'spirit_wisp', instanceId:'...', ... }
  // op: { mode:'delta', field:'current'|'base'|'value', delta:number } OR { mode:'set', field:'current'|'base'|'value', value:number }

  const kind = lc(target?.kind || '');
  const statKey = normStatKey(statKeyRaw);

  // --- PLAYER ---
  if (kind === 'player') {
    const field = normStatKey(op?.field) || 'current';

    const before = getPlayerStatRec(statKey);
    const prev = (field === 'base') ? Number(before?.base) : Number(before?.current);

    if (lc(op?.mode) === 'set') {
      setPlayerStatField(statKey, field, op.value);
    } else {
      // Endurance/Fortitude mitigation (shared helper):
      const d = mitigateDeltaForActor('player', statKey, field, op?.delta);
      addPlayerStatField(statKey, field, d);

    }
    //handleNpcPassOutIfNeeded(npcActor, statKey, prev, next);


    const after = getPlayerStatRec(statKey);
    const next = (field === 'base') ? Number(after?.base) : Number(after?.current);

    // TEST CASE: losing composure => fade pulse based on remaining composure
    if (statKey === 'composure' && field === 'current' && isFinite(prev) && isFinite(next) && next < prev) {
      const base = Number(after?.base) || 0;

      // If <= 0 => full black. Otherwise opacity increases as composure approaches 0.
      let alpha = 1;
      if (next > 0 && base > 0) {
        const fracRemaining = Math.max(0, Math.min(1, next / base));
        alpha = 1 - fracRemaining;
      }

      startFadePulse(alpha, 1, 1);
    }

    return true;
  }

  // --- NPC ---
  if (kind === 'npc') {
    const who = target?.name;
    if (!who) return false;

    const field = normStatKey(op?.field) || 'current';

    const before = getActorStatRec(who, statKey);
    const prev = (field === 'base') ? Number(before?.base) : Number(before?.current);

    if (lc(op?.mode) === 'set') {
      setActorStatField(who, statKey, field, op.value);
    } else {
      const d = mitigateDeltaForActor(who, statKey, field, op?.delta);
      addActorStatField(who, statKey, field, d);
    }

    const after = getActorStatRec(who, statKey);
    const next = (field === 'base') ? Number(after?.base) : Number(after?.current);
    console.log('[NPC STAT]', who, statKey, field, prev, '->', next);

    const delta =
      (isFinite(prev) && isFinite(next)) ? (next - prev)
      : (lc(op?.mode) === 'set') ? (Number(op?.value) - Number(prev))
      : Number(op?.delta || 0);

    // Existing world-space stat change floaters (above NPC head)
    const actor = findActorByName(who);
    // Pass-out check needs the runtime actor (world placement)
    if (actor && field === 'current') {
      handleNpcPassOutIfNeeded(actor, statKey, prev, next);
    }
        
    // Trigger head bars for NPC stamina/composure changes (current only)
    if (actor && field === 'current' && (statKey === 'stamina' || statKey === 'composure') && isFinite(prev) && isFinite(next) && prev !== next) {
      noteNpcHeadStatChanged(actor, statKey, prev, next);
    }


    if (actor) spawnStatChangeIconsForActor(actor, statKey, delta);

    // If a dialog is up, and this NPC is the current phrase speaker, also float icons over the dialog portrait
    if (
      inConversation &&
      conversationOverlay &&
      conversationOverlay.dataset &&
      conversationOverlay.dataset.mode === 'npc' &&
      lc(CURRENT_DIALOG_SPEAKER_NAME) === lc(who)
    ) {
      spawnStatChangeIconsForDialogPortrait(statKey, delta);
    }

    return true;
  }



  // --- MOB (currently: HP only via mob.hp, but routed through the same entrypoint) ---
  if (kind === 'mob') {
    if (statKey !== 'hp') return false;

    const mobId = lc(target?.id || '');
    if (!mobId) return false;

    const wantInstanceId = String(target?.instanceId || '');

    if (lc(op?.mode) === 'set') {
      const value = Number(op.value);
      if (!isFinite(value)) return false;

      for (const m of mobs.slice()) {
        if (!m || lc(m.id) !== mobId) continue;
        if (wantInstanceId && String(m.instanceId) !== wantInstanceId) continue;

        m.hp = value;
        handleMobDefeatIfNeeded(m, { reason: 'setMobHp' });
      }

      return true;
    }

    const delta = Number(op.delta);
    if (!isFinite(delta) || delta === 0) return false;

    for (const m of mobs.slice()) {
      if (!m || lc(m.id) !== mobId) continue;
      if (wantInstanceId && String(m.instanceId) !== wantInstanceId) continue;

      const prev = Number(m.hp);
      m.hp = (isFinite(prev) ? prev : 0) + delta;

      handleMobDefeatIfNeeded(m, { reason: 'updateMobHp', delta });
    }

    return true;
  }

  return false;
}


function addPlayerStatField(statKeyRaw, fieldRaw, deltaRaw) {
  const rec = getPlayerStatRec(statKeyRaw);
  if (!rec) return;

  const field = normStatKey(fieldRaw) || 'current';
  const d = Number(deltaRaw);
  if (!isFinite(d)) return;

  const statKey = normStatKey(statKeyRaw);

  if (field === 'base') {
    const prev = rec.base;
    setPlayerStatField(statKeyRaw, 'base', rec.base + d);
    emitGameEvent('stat_change', {
      actor: 'player',
      stat: statKey,
      field: 'base',
      prev,
      next: rec.base
    });
  } else {
    const prev = rec.current;
    setPlayerStatField(statKeyRaw, 'current', rec.current + d);
    emitGameEvent('stat_change', {
      actor: 'player',
      stat: statKey,
      field: 'current',
      prev,
      next: rec.current
    });
  }
}


function buildPlayerStatsLabelLine() {
  ensurePlayerStats();

  // Keep display order stable:
  const parts = [];
  for (const d of PLAYER_STAT_DEFS) {
    const k = String(d.key).toLowerCase();
    const rec = player.stats[k] || { base: 0, current: 0 };
    parts.push(`${d.label}: ${rec.current}/${rec.base}`);
  }
  return parts.join('  ');
}

function drawFixedStatBar(cx, yBottom, label, current, base, opts = {}) {
  const w = Math.floor(Number(opts.w ?? 220));
  const h = Math.floor(Number(opts.h ?? 14));
  const pad = Math.floor(Number(opts.pad ?? 4));

  const x = Math.floor(cx - w / 2);
  const y = Math.floor(yBottom - h);

  const b = Math.max(0, Number(base) || 0);
  const c = Math.max(0, Number(current) || 0);
  const frac = (b > 0) ? Math.max(0, Math.min(1, c / b)) : 0;

  // background + border
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  // fill (fixed width; only fill amount changes)
  const fillW = Math.floor(w * frac);
  ctx.fillStyle = String(opts.fill ?? 'rgba(120, 220, 120, 0.95)');
  if (fillW > 0) ctx.fillRect(x, y, fillW, h);

  // label
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;

  const ty = Math.floor(y + h / 2);
  ctx.strokeText(String(label), x + pad, ty);
  ctx.fillText(String(label), x + pad, ty);

  ctx.restore();

  return h + 6; // vertical space used (for stacking)
}

// ===== Stat change floaters (icons) =====
// Each entry: { statKey, dir, worldX0, worldY0, startMs, durMs, driftY, ampX, waves, phase, size, imgKey }
const STAT_CHANGE_FLOATERS = [];
const STAT_CHANGE_ICON_CACHE = Object.create(null);

// ===== Item found feedback (toast + icon floater) =====
const ITEM_FOUND_TOAST = {
  active: false,
  text: '',
  start: 0,
  fadeIn: 140,
  hold: 950,
  fadeOut: 520
};

function showItemFoundToast(text) {
  ITEM_FOUND_TOAST.active = true;
  ITEM_FOUND_TOAST.text = String(text || '').trim();
  ITEM_FOUND_TOAST.start = performance.now();
}

function drawItemFoundToast() {
  if (!ITEM_FOUND_TOAST.active || !ITEM_FOUND_TOAST.text) return;

  const now = performance.now();
  const t = now - ITEM_FOUND_TOAST.start;
  const total = ITEM_FOUND_TOAST.fadeIn + ITEM_FOUND_TOAST.hold + ITEM_FOUND_TOAST.fadeOut;

  if (t >= total) {
    ITEM_FOUND_TOAST.active = false;
    return;
  }

  let alpha = 1;
  if (t < ITEM_FOUND_TOAST.fadeIn) {
    alpha = t / ITEM_FOUND_TOAST.fadeIn;
  } else if (t > ITEM_FOUND_TOAST.fadeIn + ITEM_FOUND_TOAST.hold) {
    const outT = t - (ITEM_FOUND_TOAST.fadeIn + ITEM_FOUND_TOAST.hold);
    alpha = 1 - (outT / ITEM_FOUND_TOAST.fadeOut);
  }

  const text = ITEM_FOUND_TOAST.text;

  const padX = 14;
  const padY = 7;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  ctx.font = 'bold 40px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textW = ctx.measureText(text).width;
  const boxW = Math.ceil(textW) + padX * 2;
  const boxH = 30;

  const x = Math.floor((canvas.width - boxW) / 2);
  const y = 100; // below area/section banners

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
  ctx.fillText(text, x + boxW / 2, y + boxH / 2);

  ctx.restore();
}

// In-world icon floaters
// Each entry: { itemId, imgKey, worldX0, worldY0, startMs, durMs, driftY, size }
const ITEM_FOUND_FLOATERS = [];
const ITEM_ICON_CACHE = Object.create(null);

function __getItemIcon(itemIdRaw) {
  const id = String(itemIdRaw || '').trim().toLowerCase();
  if (!id) return null;

  let entry = ITEM_ICON_CACHE[id];
  if (entry) return entry;

  const img = new Image();
  entry = { img, ready: false, failed: false, key: id };

  img.onload = () => { entry.ready = true; };
  img.onerror = () => { entry.ready = false; entry.failed = true; };

  img.src = `assets/items/${id}.png`;
  ITEM_ICON_CACHE[id] = entry;
  return entry;
}

function spawnFoundItemFeedback(itemIdRaw, qtyRaw = 1) {
  const id = lc(itemIdRaw || '');
  if (!id) return;

  const def = getItemDef(id);
  const name = String(def?.name || id);

  // Text popup
  showItemFoundToast(`Found ${name}`);

  // Icon floater (only if the icon exists; draw loop will skip until loaded)
  const icon = __getItemIcon(id);
  if (!icon || icon.failed) return;

  const now = performance.now();

  const worldX0 = (Number(player?.worldX) || 0) + (Number(player?.w) || 0) / 2;
  const worldY0 = (Number(player?.y) || 0) - 22;

  ITEM_FOUND_FLOATERS.push({
    itemId: id,
    imgKey: id,

    worldX0,
    worldY0,

    startMs: now,
    durMs: 1400,

    driftY: 140,
    size: 200
  });
}

function drawItemFoundFloaters(ctx) {
  const now = performance.now();
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

  const now = performance.now();


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
  const now = performance.now();
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

// ===== Player head stat bars (show for 2s; animate fill in middle 1s) =====
const PLAYER_HEAD_STAT_BARS = {
  visibleUntilMs: 0,
  holdMs: 500,   // first 0.5s: show old value
  animMs: 1000,  // middle 1s: slide old -> new
  totalMs: 2000, // total visible time
  // per stat: { base, from, to, startMs, endMs, hasTween }
  sta: { base: 0, from: 0, to: 0, startMs: 0, endMs: 0, hasTween: false },
  com: { base: 0, from: 0, to: 0, startMs: 0, endMs: 0, hasTween: false }
};

function cancelPlayerHeadBarTweens() {
  PLAYER_HEAD_STAT_BARS.visibleUntilMs = 0;

  // force drawPlayerHeadBars() to use live stat values immediately
  PLAYER_HEAD_STAT_BARS.sta.hasTween = false;
  PLAYER_HEAD_STAT_BARS.com.hasTween = false;

  // reset timing (defensive)
  PLAYER_HEAD_STAT_BARS.sta.startMs = 0;
  PLAYER_HEAD_STAT_BARS.sta.endMs = 0;
  PLAYER_HEAD_STAT_BARS.com.startMs = 0;
  PLAYER_HEAD_STAT_BARS.com.endMs = 0;
}

function __lerp(a, b, t) {
  a = Number(a); b = Number(b); t = Number(t);
  if (!isFinite(a)) a = 0;
  if (!isFinite(b)) b = 0;
  if (!isFinite(t)) t = 0;
  t = Math.max(0, Math.min(1, t));
  return a + (b - a) * t;
}

function __getHeadBarDisplayedValue(statKey, nowMs) {
  const key = lc(statKey);
  const entry = (key === 'stamina') ? PLAYER_HEAD_STAT_BARS.sta
              : (key === 'composure') ? PLAYER_HEAD_STAT_BARS.com
              : null;
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

function notePlayerHeadStatChanged(statKey, prevValue, nextValue) {
  const key = lc(statKey);
  if (key !== 'stamina' && key !== 'composure') return;

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


function drawNpcHeadBars(npc, x, y) {
  if (!npc) return 0;

  const now = Date.now();
  const bars = __ensureNpcHeadBarState(npc);

  const forceVisible =
    now < Math.max(Number(bars?.sta?.showUntilMs || 0), Number(bars?.com?.showUntilMs || 0));

  // Match player behavior: show when names are toggled (N) OR during recent-change window
  if (!forceVisible && !showNames) return 0;

  const cx = x + npc.w / 2;

  const staRec = npc.stats?.stamina || { base: 0, current: 0 };
  const comRec = npc.stats?.composure || { base: 0, current: 0 };

  const staVal = (forceVisible && now < (bars.sta.showUntilMs || 0))
    ? Number(__getNpcHeadBarDisplayedValue(npc, 'stamina', now))
    : Number(staRec.current || 0);

  const comVal = (forceVisible && now < (bars.com.showUntilMs || 0))
    ? Number(__getNpcHeadBarDisplayedValue(npc, 'composure', now))
    : Number(comRec.current || 0);

  // Bars start just above the NPC head; they stack upward (same as player)
  const y0 = y - 2;
  const barsStartYBottom = y0 - 4;

  let yBottom = barsStartYBottom;
  let used = 0;

  const usedCom = drawFixedStatBar(cx, yBottom, 'COM', comVal, comRec.base, {
    fill: 'rgba(120, 170, 255, 0.95)'
  });
  used += usedCom;
  yBottom -= usedCom;

  const usedSta = drawFixedStatBar(cx, yBottom, 'STA', staVal, staRec.base, {
    fill: 'rgba(140, 240, 140, 0.95)'
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
  const forceVisible = now < PLAYER_HEAD_STAT_BARS.visibleUntilMs;

  // Respect existing logic (pressing N, name display, etc.)
  if (!forceVisible && !showNames) return 0;

  const cx = x + player.w / 2;

  const staRec = player.stats?.stamina || { base: 0, current: 0 };
  const comRec = player.stats?.composure || { base: 0, current: 0 };

  // Only use tweened values during the timed "force visible" window.
  const staVal = (forceVisible && PLAYER_HEAD_STAT_BARS.sta.hasTween)
    ? (Number(__getHeadBarDisplayedValue('stamina', now)))
    : Number(staRec.current || 0);

  const comVal = (forceVisible && PLAYER_HEAD_STAT_BARS.com.hasTween)
    ? (Number(__getHeadBarDisplayedValue('composure', now)))
    : Number(comRec.current || 0);


  let yBottom = yBottomStart;

  let used = 0;

  // COM (top) then STA (bottom)
  const usedCom = drawFixedStatBar(cx, yBottom, 'COM', comVal, comRec.base, {
    fill: 'rgba(120, 170, 255, 0.95)'
  });
  used += usedCom;
  yBottom -= usedCom;

  const usedSta = drawFixedStatBar(cx, yBottom, 'STA', staVal, staRec.base, {
    fill: 'rgba(140, 240, 140, 0.95)'
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

  // base/current per stat
  stats: createStatsFromDefs(PLAYER_STAT_DEFS)
};

ensurePlayerStats();


function clampStatFloor0(v) {
  v = Number(v);
  if (!isFinite(v)) return 0;
  return Math.max(0, v);
}

function recoverPlayerOnPassOut() {
  for (const k of ['stamina', 'composure']) {
    if (!player.stats[k]) continue;
    player.stats[k].current = clampStatFloor0(player.stats[k].base);
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

// REGISTRY OF Mobs AND THEIR STATES
// instanceId -> { area, mobId, worldX, y, vx, vy, facing, onGround, ai*, anchor, targetQueue, targetCurrentKey, ... }
const mobRegistry = Object.create(null);


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
  console.log('[RuleDebug] __traceRules =', window.__traceRules);
}

function enableRuleTraceReasons(on = true) {
  window.__traceRulesReasons = !!on;
  console.log('[RuleDebug] __traceRulesReasons =', window.__traceRulesReasons);
}

function dumpRuleStatus() {
  console.log('[RuleDebug] fired rule ids:', Array.from(triggeredRuleIds.values()));
  console.log('[RuleDebug] active state rule ids:', Array.from(activeStateRuleIds.values()));
  console.log('[RuleDebug] last event:', __lastEvent);
}

function isObjectInteractable(objectName, instanceKey = null) {
  const objectId = lc(objectName);
  if (!objectId) return false;

  // Must be in proximity by TYPE (engine-enforced)
  const typeKey = makeProxTypeKey({ kind: 'object', id: objectId });
  if (!typeKey || !proximityInsideTypes.has(typeKey)) return false;

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
    if (def.oncePerInstance && instanceKey) {
      const flagKey = `objectInstanceInteracted:${instanceKey}`;
      if (getFlag('global', flagKey) === true) return false;
    }
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

  console.log('--- [RuleDebug] explainRule ---');
  console.log('ruleId=', rid);
  console.log('event=', ev);
  console.log('payload=', pl);
  console.log('once=', !!rule.once, 'hasFiredOnce=', !!(rule.once && triggeredRuleIds.has(rid)));
  console.log('disabled=', !!rule.disabled);

  const stateOk = evaluateRuleState(rule, pl);
  console.log('stateOk=', stateOk, 'state=', rule.state);

  // Event-driven?
  const triggers = normalizeTriggerWhen(rule.triggerWhen);
  if (!triggers.length) {
    console.log('triggerWhen: (none) => state-only rule (fires via evaluateStateRulesByDepKeys)');
    return;
  }

  if (!ev) {
    console.log('No eventName provided and no __lastEvent recorded yet.');
    return;
  }

  const matching = [];
  const failing = [];

  for (const t of triggers) {
    const ok = triggerMatches(t, ev, pl || {});
    (ok ? matching : failing).push(t);
  }

  console.log('matching triggers:', matching);
  console.log('failing triggers:', failing);

  // requires?
  if (rule.requires && Array.isArray(rule.requires)) {
    const reqReport = rule.requires.map(req => {
      const c = getEventCount(req, pl, ev);
      return { req, count: c };
    });
    console.log('requires counts:', reqReport);
  }
}

function explainRulesForLastEvent() {
  if (!__lastEvent) return console.warn('[RuleDebug] No last event recorded yet.');
  const { eventName, payload } = __lastEvent;

  console.log('--- [RuleDebug] explainRulesForLastEvent ---');
  console.log('event=', eventName, 'payload=', payload);

  const list = rulesByEvent[eventName] || [];
  console.log('candidates (rulesByEvent):', list.map(x => x?.rule?.id));

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

    console.log(
      `[RuleDebug] ${ruleId}`,
      { blockedOnce, stateOk, reqOk, trigOk, once: !!rule.once }
    );
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
  return (kind && id) ? [`playerInProximity:${kind}:${id}`] : [];
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
    return (actor && stat) ? [`stat:${actor}:${stat}`] : [];
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

  mob_param_change: (payload) => {
    const mob = lc(payload?.mob);
    const key = String(payload?.key || '');
    if (!mob || !key) return [];
    return [`mobParam:${mob}:${key}`, `mobParam:*:${key}`];
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

      if (kind && id) return [`playerInProximity:${kind}:${id}`];

      // (Optional) keep old key for any remaining legacy rules that still expect it
      // return id ? [`playerInProximity:${id}`] : [];
      return [];
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

    case 'mobParam': {
      const mob = lc(s.id || s.mob || s.mobId || '');
      const key = String(s.key || s.param || '');
      if (!key) return [];
      if (mob) return [`mobParam:${mob}:${key}`, `mobParam:*:${key}`];
      return [`mobParam:*:${key}`];
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
  if (!npcRegistry[name]) {
    npcRegistry[name] = {
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
      stats: null

    };
  }

  // Ensure stats object exists + includes required keys, and migrate legacy flat fields if present.
  ensureNpcRecordStats(name, npcRegistry[name]);

  return npcRegistry[name];
}


function __ensureActorStatRec(statsObj, statKey, baseDefault = 0, currentDefault = null) {
  const k = lc(statKey || '');
  if (!k) return null;
  if (!statsObj[k] || typeof statsObj[k] !== 'object') {
    const b = Number(baseDefault ?? 0);
    const c = (currentDefault == null) ? b : Number(currentDefault);
    statsObj[k] = { base: (isFinite(b) ? b : 0), current: (isFinite(c) ? c : 0) };
  }
  if (!isFinite(statsObj[k].base)) statsObj[k].base = 0;
  if (!isFinite(statsObj[k].current)) statsObj[k].current = 0;
  return statsObj[k];
}

function __applyStartingStatsToStats(statsObj, startingStats) {
  if (!statsObj || typeof statsObj !== 'object') return;

  const ss = (startingStats && typeof startingStats === 'object') ? startingStats : null;

  // Core stats: allow startingStats.<stat> as a number (sets base; current = base)
  for (const d of PLAYER_STAT_DEFS) {
    const k = lc(d.key);
    const v = ss ? ss[k] : undefined;
    if (typeof v === 'number' && isFinite(v)) {
      const r = __ensureActorStatRec(statsObj, k, v, v);
      if (r) { r.base = v; r.current = v; }
    }
  }



  // alignment/affection: base comes from min*, current starts at 0 (unless overridden explicitly)
  const minA =
    (ss && typeof ss.minalignment === 'number' && isFinite(ss.minalignment)) ? ss.minalignment
    : 0;

  const minF =
    (ss && typeof ss.minaffection === 'number' && isFinite(ss.minaffection)) ? ss.minaffection
    : 0;


  // If explicitly specified as numbers, treat them as the BASE (threshold).
  const ar = __ensureActorStatRec(statsObj, 'alignment', minA, 0);
  if (ar) { ar.base = minA; ar.current = 0; }

  const fr = __ensureActorStatRec(statsObj, 'affection', minF, 0);
  if (fr) { fr.base = minF; fr.current = 0; }


  // Optional explicit starting currents (if you ever add them later)
  if (ss) {
    if (typeof ss.alignment === 'number' && isFinite(ss.alignment)) statsObj.alignment.current = ss.alignment;
    if (typeof ss.affection === 'number' && isFinite(ss.affection)) statsObj.affection.current = ss.affection;
  }
}

function ensureNpcRecordStats(name, rec) {
  if (!rec || typeof rec !== 'object') return;

  if (!rec.stats || typeof rec.stats !== 'object') {
    rec.stats = createStatsFromDefs(PLAYER_STAT_DEFS);
  } else {
    // Ensure any newly-added defs exist
    for (const d of PLAYER_STAT_DEFS) {
      const k = String(d.key).toLowerCase();
      if (!rec.stats[k] || typeof rec.stats[k] !== 'object') {
        const base = Number(d.base ?? 0);
        rec.stats[k] = { base, current: base };
      }
    }
  }

  // Apply startingStats/min* from characters.json ONCE (case-insensitive)
  if (!rec._startingStatsApplied) {
    const details =
      (npcDetails && npcDetails[name]) ? npcDetails[name]
      : (npcDetailsByLc ? npcDetailsByLc[lc(name)] : null);

    const ss = details?.startingStats || null;

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
    return player.stats?.[statKey] || null;
  }

  const rec = ensureNpcRecord(actorName);
  const s = rec?.stats;
  return (s && typeof s === 'object') ? (s[statKey] || null) : null;
}

function setActorStatField(actorName, statKeyRaw, fieldRaw, valueRaw) {
  const rec = getActorStatRec(actorName, statKeyRaw);
  if (!rec) return false;

  const field = normStatKey(fieldRaw) || 'current';
  const v = Number(valueRaw);
  if (!isFinite(v)) return false;

  if (field === 'base') rec.base = v;
  else rec.current = v;

  // Clamp to base for clampToBase stats (STA/COM)
  if (field !== 'base') {
    const def = PLAYER_STAT_DEF_MAP[normStatKey(statKeyRaw)];
    if (def && def.clampToBase) {
      const b = Number(rec.base ?? 0);
      if (isFinite(b)) rec.current = Math.max(0, Math.min(b, Number(rec.current ?? 0)));
    } else {
      rec.current = Math.max(0, Number(rec.current ?? 0));
    }
  } else {
    rec.base = Math.max(0, Number(rec.base ?? 0));
    const def = PLAYER_STAT_DEF_MAP[normStatKey(statKeyRaw)];
    if (def && def.clampToBase) {
      const b = Number(rec.base ?? 0);
      rec.current = Math.max(0, Math.min(b, Number(rec.current ?? 0)));
    }
  }

  // If NPC, keep registry+live actor in sync (shared reference if possible)
  const a = findActorByName(actorName);
  if (a && a !== player && a.stats && a.stats[normStatKey(statKeyRaw)] === rec) {
    // already shared ref; nothing
  }

  return true;
}

function addActorStatField(actorName, statKeyRaw, fieldRaw, deltaRaw) {
  const rec = getActorStatRec(actorName, statKeyRaw);
  if (!rec) return false;

  const field = normStatKey(fieldRaw) || 'current';
  const d = Number(deltaRaw);
  if (!isFinite(d) || d === 0) return false;

  if (field === 'base') return setActorStatField(actorName, statKeyRaw, 'base', Number(rec.base ?? 0) + d);
  return setActorStatField(actorName, statKeyRaw, 'current', Number(rec.current ?? 0) + d);
}

function mitigateDeltaForActor(actorName, statKey, field, delta) {
  let d = Number(delta);
  if (!isFinite(d)) d = 0;

  // Only affects NEGATIVE deltas to current STA/COM, and cannot become healing.
  if (field === 'current' && d < 0) {
    if (statKey === 'stamina') {
      const endRec = getActorStatRec(actorName, 'endurance');
      const end = Number(endRec?.current ?? 0);
      if (isFinite(end) && end > 0) d = Math.min(0, d + end);
      else d = Math.min(0, d);
    } else if (statKey === 'composure') {
      const fortRec = getActorStatRec(actorName, 'fortitude');
      const fort = Number(fortRec?.current ?? 0);
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

  if (actor === 'player') {
    const rec = player.stats?.[stat];
    if (!rec) return null;
    if (f === 'base' || f === 'max') return rec.base;
    return rec.current;
  }

  const rec = ensureNpcRecord(actorName);
  const s = rec?.stats;
  const st = s && typeof s === 'object' ? s[stat] : null;
  if (!st || typeof st !== 'object') return null;

  if (f === 'base' || f === 'max') return Number(st.base ?? 0);
  return Number(st.current ?? 0);
}


function getInventoryMetric(itemId, measure) {
  const id = lc(itemId || '');
  if (!id) return null;

  const inv = player.inventory || Object.create(null);
  const bucket = inv[id];
  if (!bucket) return 0;

  const insts = Array.isArray(bucket.instances) ? bucket.instances : [];
  const m = lc(measure || 'count');

  const count = insts.length;

  if (m === 'uses') {
    // Total remaining uses across all instances.
    const def = getItemDef(id);
    const usesPerItem = Math.max(1, Math.floor(Number(def?.usesPerItem ?? 1)));

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



function evaluateRuleState(rule, payload) {
  // if (rule.id === 'rowyn_forest1_keep_going_prompt') {
  //   console.log('[STATE CHECK]', JSON.parse(JSON.stringify(rule.state)));
  // }

  if (!Array.isArray(rule.state)) return true;

  for (const s of rule.state) {
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

        if (!kind || !id) return false;

        const key = makeProxKey({ kind, id });
        if (!key) return false;

        if (!proximityInside.has(key)) return false;
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

        const actual = getFlag(scope, key);

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

        const v = getInventoryMetric(id, measure);
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


      case 'hasBeenInParty': {
        const rec = ensureNpcRecord(s.npc);
        const has = !!rec.hasBeenInParty;
        if (has !== !!s.is) return false;
        break;
      }

      case 'mobParam': {
        const mobId = lc(s.id || s.mob || s.mobId || '');
        const key = String(s.key || s.param || '');
        const op = lc(s.op || s.compare || 'eq');
        const want = s.value;

        if (!key) return false;

        // If mobId provided: ANY instance of that mob can satisfy the condition.
        // If no mobId: ANY mob instance can satisfy it.
        let ok = false;

        for (const m of mobs) {
          if (!m) continue;
          if (mobId && lc(m.id) !== mobId) continue;

          const actual = getEffectiveMobParam(m, key);

          if (op === 'exists') { if (actual !== undefined) { ok = true; break; } }
          else if (op === 'notexists') { if (actual === undefined) { ok = true; break; } }
          else if (op === 'neq') { if (actual !== want) { ok = true; break; } }
          else { if (actual === want) { ok = true; break; } } // default eq
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
      key === 'option'
    ) continue;

    if (payload[key] === undefined) return false;
    if (String(payload[key]) !== String(w[key])) return false;
  }

  // Support "option" in rules (preferred), fallback to optionId
  if (w.option !== undefined) {
    if (String(payload.optionId) !== String(w.option)) return false;
  } else if (w.optionId !== undefined) {
    if (String(payload.optionId) !== String(w.optionId)) return false;
  }

  return true;
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

function applyRuleEffects(rule, payload) {
  const effects = Array.isArray(rule?.effects) ? rule.effects : [];

  // Snapshot party eligibility BEFORE applying this rule's effects,
  // so we can attribute a drop reason to the stat that crossed the threshold.
  const _partyEligBefore = new Map();
  for (const m of party.slice()) {
    const curA0 = Number(m?.stats?.alignment?.current ?? 0);
    const minA0 = Number(m?.stats?.alignment?.base ?? 0);
    const curF0 = Number(m?.stats?.affection?.current ?? 0);
    const minF0 = Number(m?.stats?.affection?.base ?? 0);

    _partyEligBefore.set(m, {
      badAlignment: curA0 < minA0,
      badAffection: curF0 < minF0
    });
  }

  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;

    if (eff.type === 'updateStat') {
      let who = (eff.npc == null) ? 'player' : String(eff.npc);
      const statKey = normStatKey(eff.stat);

      // Allow mob contact payload targeting: npc:'@target'
      if (lc(who) === '@target') {
        const td = payload?.targetActor;
        if (td && td.kind === 'npc' && td.name) who = String(td.name);
        else if (td && td.kind === 'player') who = 'player';
        else who = '';
      }

      if (!who) continue;

      if ((lc(who) === 'player') && PLAYER_STAT_DEF_MAP[statKey]) {
        applyStatChangeWithFeedback(
          { kind: 'player' },
          statKey,
          { mode: 'delta', field: (eff.field || 'current'), delta: eff.delta },
          payload
        );
        continue;
      }

      applyStatChangeWithFeedback(
        { kind: 'npc', name: String(who) },
        statKey,
        { mode: 'delta', field: (eff.field || 'current'), delta: eff.delta },
        payload
      );
      continue;
    }

    if (eff.type === 'setStat') {
      let who = (eff.npc == null) ? 'player' : String(eff.npc);
      const statKey = normStatKey(eff.stat);

      // Allow mob contact payload targeting: npc:'@target'
      if (lc(who) === '@target') {
        const td = payload?.targetActor;
        if (td && td.kind === 'npc' && td.name) who = String(td.name);
        else if (td && td.kind === 'player') who = 'player';
        else who = '';
      }

      if (!who) continue;

      if ((lc(who) === 'player') && PLAYER_STAT_DEF_MAP[statKey]) {
        applyStatChangeWithFeedback(
          { kind: 'player' },
          statKey,
          { mode: 'set', field: (eff.field || 'current'), value: eff.value },
          payload
        );
        continue;
      }

      applyStatChangeWithFeedback(
        { kind: 'npc', name: String(who) },
        statKey,
        { mode: 'set', field: (eff.field || 'current'), value: eff.value },
        payload
      );
      continue;
    }

    if (eff.type === 'addItem') {
      const id = eff.id || eff.item || eff.itemId;
      const qty = (eff.qty !== undefined) ? eff.qty : (eff.count !== undefined ? eff.count : 1);
      addItemToInventory(id, qty);
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

    if (eff.type === 'setMovement' || eff.type === 'setNpcMovement' || eff.type === 'setNpcAiMode') {
      // Back-compat: setNpcAiMode can pass { npc, mode, goalX } OR the new goal spec
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

      applyStatChangeWithFeedback(
        { kind: 'mob', id: mobId, instanceId: wantInstanceId },
        'hp',
        { mode: 'set', field: 'value', value },
        payload
      );

      continue;
    }

    // ===== Actor tag effects (dynamic tags) =====
    if (eff.type === 'addTag') {
      // Targets: player | npc by name | '@party'
      const tag = eff.tag ?? eff.keyTag ?? eff.value;
      let who = (eff.npc == null) ? 'player' : String(eff.npc);

      if (lc(who) === '@party') {
        actorAddTag(player, tag);
        for (const m of party) actorAddTag(m, tag);
        continue;
      }

      if (lc(who) === 'player') {
        actorAddTag(player, tag);
        continue;
      }

      // Try party first, then world NPCs
      const want = lc(who);
      let found = null;

      for (const m of party) {
        if (lc(m?.name) === want) { found = m; break; }
      }
      if (!found) {
        for (const n of npcs) {
          if (lc(n?.name) === want) { found = n; break; }
        }
      }

      if (found) actorAddTag(found, tag);
      continue;
    }

    if (eff.type === 'removeTag') {
      const tag = eff.tag ?? eff.keyTag ?? eff.value;
      let who = (eff.npc == null) ? 'player' : String(eff.npc);

      if (lc(who) === '@party') {
        actorRemoveTag(player, tag);
        for (const m of party) actorRemoveTag(m, tag);
        continue;
      }

      if (lc(who) === 'player') {
        actorRemoveTag(player, tag);
        continue;
      }

      const want = lc(who);
      let found = null;

      for (const m of party) {
        if (lc(m?.name) === want) { found = m; break; }
      }
      if (!found) {
        for (const n of npcs) {
          if (lc(n?.name) === want) { found = n; break; }
        }
      }

      if (found) actorRemoveTag(found, tag);
      continue;
    }

    // Convenience aliases (so Rowyn's veil ability can tag everyone easily)
    if (eff.type === 'addPartyTag') {
      const tag = eff.tag ?? eff.keyTag ?? eff.value;
      actorAddTag(player, tag);
      for (const m of party) actorAddTag(m, tag);
      continue;
    }

    if (eff.type === 'removePartyTag') {
      const tag = eff.tag ?? eff.keyTag ?? eff.value;
      actorRemoveTag(player, tag);
      for (const m of party) actorRemoveTag(m, tag);
      continue;
    }

    // ===== Gate state effects =====
    if (eff.type === 'setGateOpen') {
      const id = String(eff.id ?? eff.instanceId ?? '').trim();
      if (id) setGateIsOpenByInstanceId(id, !!eff.open);
      continue;
    }

    if (eff.type === 'toggleGate') {
      const id = String(eff.id ?? eff.instanceId ?? '').trim();
      if (id) toggleGateByInstanceId(id);
      continue;
    }


  }


  // Re-evaluate party eligibility after ANY stat change
  for (const member of party.slice()) {
    const curA = Number(member?.stats?.alignment?.current ?? 0);
    const minA = Number(member?.stats?.alignment?.base ?? 0);

    const curF = Number(member?.stats?.affection?.current ?? 0);
    const minF = Number(member?.stats?.affection?.base ?? 0);

    const badAlignment = curA < minA;
    const badAffection = curF < minF;

    // Only drop if BOTH are below minimum
    if (badAlignment && badAffection) {
      const prev = _partyEligBefore.get(member) || { badAlignment: false, badAffection: false };

      // Attribute the "cause" to whichever stat crossed from not-bad -> bad
      const alignBecameBad = !prev.badAlignment && badAlignment;
      const affBecameBad = !prev.badAffection && badAffection;

      let reason = 'low_both';
      if (alignBecameBad && !affBecameBad) reason = 'low_alignment';
      else if (!alignBecameBad && affBecameBad) reason = 'low_affection';

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

function applyRulesForEvent(eventName, payload) {
  const list = rulesByEvent[eventName] || [];

  if (window.__traceRules) {
    for (const entry of list) {
      console.log('[applyRulesForEvent]', 'event=', eventName, 'rule=', entry?.rule?.id, 'payload=', payload);
    }
  }

  const logReason = (...args) => {
    if (window.__traceRulesReasons) console.log('[RuleTrace]', ...args);
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
      console.log('[rowyn_forest1_keep_going_prompt] pre-state payload=', payload);
    }

    if (!evaluateRuleState(rule, payload)) {
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
            ruleId
          );

          // IMPORTANT: if this is a triggerWhen rule, bind it to the state system
          // so its prompt will expire when its state becomes false.
          if (rule.triggerWhen && Array.isArray(rule.state) && rule.state.length > 0) {
            bindTriggeredRuleToStateIndex(rule);
            activeStateRuleIds.add(ruleId);
          }
        }
      }

      if (window.__traceRulesReasons) {
        console.log('[RuleTrace] dialog speaker resolve', {
          ruleId,
          requestedNpc: rule.dialog.npc,
          speakerFound: !!speaker,
          party: party.map(n => n.name),
          npcs: npcs.map(n => n.name)
        });
      }
    }

    let startedScene = false;

    if (rule.scene && rule.scene.start) {
      startRuleScene(rule.scene.start, ruleId);
      startedScene = true;
    }

    if (rule.once && !startedScene) triggeredRuleIds.add(ruleId);

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

  // Support several field names (keep current objects.json working)
  const sceneFirst =
    def.sceneFirst || def.sceneFirstTime || def.firstScene || def.firstInteractScene || null;

  const sceneEvery =
    def.sceneEveryTime || def.sceneEvery || def.scene || def.interactScene || null;

  const effectsFirst =
    Array.isArray(def.effectsFirstTime) ? def.effectsFirstTime
    : Array.isArray(def.effectsFirst) ? def.effectsFirst
    : [];

  const effects =
    Array.isArray(def.effects) ? def.effects : [];

  const oncePerInstance = !!def.oncePerInstance;

  // Choose ONE scene to run (your bush scene handles first-vs-repeat internally via flags)
  const sceneToRun = (!wasTypeInteracted && sceneFirst) ? sceneFirst : sceneEvery;

  if (sceneToRun && sceneToRun.start && !loading) {
    startRuleScene(sceneToRun.start, `__object:${objectId}:${(!wasTypeInteracted ? 'first' : 'every')}`);
  }

  // Apply effects (only when interaction actually happens)
  const instanceKey = payload.instanceKey;

  // Convert proximity instanceKey ("object:...") into the gate instance id used by gateOpen flags.
  // - new:    "object:<customId>"              -> "<customId>"
  // - legacy: "object:<layer>:<base>:<i>"      -> "<layer>:<base>:<i>"
  const gateInstanceId =
    (() => {
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


  if (!wasTypeInteracted && effectsFirst.length) {
    applyEffects(__withGateTarget(effectsFirst), { source: 'object', objectId, instanceKey, firstTime: true });
  }
  if (effects.length) {
    applyEffects(__withGateTarget(effects), { source: 'object', objectId, instanceKey, firstTime: !wasTypeInteracted });
  }


  // Record type + instance interaction
  if (!wasTypeInteracted) {
    setFlag('global', `objectTypeInteracted:${objectId}`, true);
  }

  if (oncePerInstance && payload.instanceKey) {
    setFlag('global', `objectInstanceInteracted:${payload.instanceKey}`, true);
  }

  // Kick object "_interact" animation (if available) on the specific instance that was interacted with
  if (payload.instanceKey) {
    const inst = findPlacedObjectByInstanceKey(payload.instanceKey);
    if (inst) {
      inst._interactAnimStartMs = performance.now();
    }
  }
}



function emitGameEvent(eventName, payload) {
  if (!payload || typeof payload !== 'object') payload = {};
  payload.__eventName = eventName;

  __lastEvent = { eventName, payload };

  applyRulesForEvent(eventName, payload);

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
        const list = Array.isArray(target?.def?.abilities) ? target.def.abilities : [];
        const adef = list.find(a => a && lc(a.id || a.name) === abilityId) || null;

        const spec = getActionAnimSpec(adef, 'ability', 520);
        setActorTempAnim(target, spec.type, spec.durationMs);

        if (adef?.stopMoving === true) {
          lockActorMovementForMs(target, spec.durationMs);
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
        const list = Array.isArray(target?.abilities) ? target.abilities : [];
        const adef = list.find(a => a && lc(a.id || a.name) === abilityId) || null;

        const spec = getActionAnimSpec(adef, 'ability', 520);
        setActorTempAnim(target, spec.type, spec.durationMs);

        if (adef?.stopMoving === true) {
          lockActorMovementForMs(target, spec.durationMs);
        }
      }
    }
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

      // ---- dialog-based state rule ----
      if (rule.dialog) {
        const speaker = rule.dialog.npc || payload?.npc;
        if (speaker) {
          enqueueNpcSpeechBubblePrompt(
            speaker,
            rule.dialog.prompt,
            rule.dialog.start,
            rule.id
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
      if (fired && rule.dialog) {
        activeStateRuleIds.add(ruleId);

        // dialog prompts are "fired" immediately
        if (rule.once) {
          triggeredRuleIds.add(ruleId);
        }
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


  
    if (ruleId === 'rowyn_recover_composure_scene') {
      console.log('[DEBUG][recover] seen in evaluateAllStateRules', {
        inConversation,
        loading,
        isActive: activeStateRuleIds.has(ruleId),
        hasFiredOnce: (rule.once && triggeredRuleIds.has(ruleId)),
        shouldBeActive: evaluateRuleState(rule, payload),
        sceneStart: rule?.scene?.start
      });
    }

    if (shouldBeActive && !isActive && !hasFiredOnce) {

      let fired = false;

      // ---- dialog-based state rule ----
      if (rule.dialog) {
        const speaker = rule.dialog.npc || payload?.npc;
        if (speaker) {
          enqueueNpcSpeechBubblePrompt(
            speaker,
            rule.dialog.prompt,
            rule.dialog.start,
            rule.id
          );
          fired = true;
        }
      }

      // ---- scene / action-based state rule ----
      if (!fired && rule.scene && rule.scene.start && !inConversation && !loading) {
        if (ruleId === 'rowyn_recover_composure_scene') {
          console.log('[DEBUG][recover] FIRING scene now');
        }

        startRuleScene(rule.scene.start, ruleId);
        fired = true;
        if (rule.once) {
          triggeredRuleIds.add(ruleId);
        }
      }

      // Only mark "active" for prompt rules (prevents duplicate prompts).
      // Do NOT mark scenes as active.
      if (fired && rule.dialog) {
        activeStateRuleIds.add(ruleId);

        if (rule.once) {
          triggeredRuleIds.add(ruleId);
        }
      }


    }


    if (!shouldBeActive && isActive) {
      removeDialogPromptForRule(rule.id);
      activeStateRuleIds.delete(ruleId);
    }
  }
  console.log('[DEBUG] stateRuleById size', stateRuleById.size);

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
let firedDialogTriggers = new Set();
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

function _timedFlagFullKey(scope, key) {
  return `${lc(scope || 'global')}:${String(key || '')}`;
}

function setFlagTimed(scope, key, value, durationMs, nowMs = null) {
  const dur = Math.max(0, Math.floor(Number(durationMs || 0)));
  const now = (nowMs == null) ? performance.now() : Number(nowMs);

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
let currentRuleSceneId = null;
let dialogOptionsMap = null;
const queuedDialogPrompts = [];

// Party prompt numbering: assign lowest unused integer (1..9) to each active prompt id.
// Freed when prompt disappears.
const __partyPromptSlotById = new Map(); // promptId -> slotNum
const __partyPromptUsedSlots = new Set(); // slotNum

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
    console.log('[PromptQueue] enqueue', p, 'queuedLen(before)=', queuedDialogPrompts.length);
  }

  if (!p || !p.npc) return;

  if (window.__traceRules) {
    console.log('[enqueueDialogPrompt]', p);
  }

  queuedDialogPrompts.push(p);

  if (window.__traceRulesReasons) {
    console.log('[PromptQueue] queuedLen(after)=', queuedDialogPrompts.length);
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

function enqueueNpcSpeechBubblePrompt(npcName, promptText, startPhrase, triggerKey) {
  // If promptText isn't supplied, use the text of the start phrase (so you can author short prompt labels in dialog files).
  const autoText = (promptText == null || promptText === '')
    ? __getPromptTextFromStart(startPhrase, npcName)
    : null;

  enqueueDialogPrompt({
    npc: npcName,
    triggerKey: triggerKey || null, // MUST be set for rule-driven prompts
    prompt: (promptText == null || promptText === '') ? (autoText || '…') : promptText,
    start: startPhrase,
    mode: 'npc_bubble'
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

function beginLoadingForCurrentArea(msg = 'Loading...') {
  loading = true;
  loadingMessage = msg;
}

function getVisibleSectionRange(area) {
  // cameraX is already set when we enter the area (placePlayerAtAreaEdge)
  const tileW = area.sectionTileWidth || 128;
  const startX = cameraX;
  const endX = cameraX + cameraViewportW();

  const i0 = Math.max(0, Math.floor(startX / tileW));
  const i1 = Math.min(area.sections.length - 1, Math.floor(endX / tileW));
  return [i0, i1];
}

function isAreaBackgroundReady(area) {
  if (!area) return false;

  // Require sky if defined
  if (area.skyEntry && !area.skyEntry.ready) return false;

  // Require visible section layers (ground + distant + background)
  const [i0, i1] = getVisibleSectionRange(area);

  for (let i = i0; i <= i1; i++) {
    const g = area.groundEntries[i];
    if (g && !g.ready) return false;

    const d = area.distantEntries && area.distantEntries[i];
    if (typeof d === 'string') return false;
    if (d && !d.ready) return false;

    const b = area.backgroundEntries && area.backgroundEntries[i];
    if (typeof b === 'string') return false;
    if (b && !b.ready) return false;

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
  AREA_BANNER.start = performance.now();
}

function drawAreaBanner() {
  if (!AREA_BANNER.active || !AREA_BANNER.text) return;

  const now = performance.now();
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

  ctx.font = 'bold 60px monospace';
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
  SECTION_BANNER.start = performance.now();
}

function drawSectionBanner() {
  if (!SECTION_BANNER.active || !SECTION_BANNER.text) return;

  const now = performance.now();
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

  ctx.font = 'bold 46px monospace';
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
        console.log("Loaded Areas from", url);
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
  spawnNpc(name, atX);
  // NEW: apply saved stats onto the instance
  const spawned = npcs.find(n => n.name === name);
  if (spawned) {
    spawned.stats = rec.stats;


    // ===== Spawn AI mode (areas.json) =====
    const modeRaw = (c.ai && c.ai.mode) ? c.ai.mode : (c.mode ?? c.aiMode ?? 'stationary');
    const mode = lc(modeRaw);

    if (mode === 'waiting') {
      // Anchor is spawn point (or saved point if they spawned from registry earlier)
      setNpcAiMode(spawned, 'waiting', { anchorX: spawned.worldX });
    } else if (mode === 'moving') {
      // Goal can be absolute (goalWorldX) or local-to-section (goalPosition)
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

      if (isFinite(goalX)) setNpcAiMode(spawned, 'moving', { goalX });
      else setNpcAiMode(spawned, 'stationary');
    } else {
      setNpcAiMode(spawned, 'stationary');
    }
  }
}


function spawnPredefinedNPCs(sectionIndex, sectionStartX, sectionDef, areaName) {
  const list = asArrayMaybe(sectionDef.characters);
  for (const c of list) {
    if (!c || !c.name) continue;
    const name = c.name;
    const rec = ensureNpcRecord(name);

    // If NPC is in party, never spawn in world
    if (rec.inParty) continue;

    // If NPC has a saved location in another area, don't spawn here
    if (rec.area && rec.area !== areaName) continue;

    // If NPC already fixed to this area, spawn at saved worldX
    if (rec.area === areaName && typeof rec.worldX === 'number') {
      spawnNpc(name, rec.worldX);
      continue;
    }

    // No record yet — adopt the predefined position
    const posLocal = Number(c.position || 0);
    const atX = sectionStartX + posLocal;

    console.log(
      '[NPC SPAWN]',
      'area=', areaName,
      'npc=', name,
      'sectionTileWidth=', currentArea.sectionTileWidth,
      'sectionIndex=', sectionIndex,
      'sectionStartX=', sectionStartX,
      'posLocal=', posLocal,
      'atX=', atX,
      'groundReady=', currentArea.groundEntries?.[sectionIndex]?.ready
    );


    const spawnWhen = normalizeTriggerWhen(c.spawnWhen);
    const spawnIf = c.spawnIf;

    if ((spawnWhen && spawnWhen.length) || spawnIf) {
      pendingSpawns.push({
        kind: 'npc',
        name,
        atX,
        c,
        rec,
        sectionStartX,
        spawnWhen,
        spawnIf
      });
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

  return {
    // identity
    id,                 // archetype id (from mobs.json key)
    instanceId,         // unique per-spawn instance key
    name: id,           // keep “name” as archetype id (rules use mob.id, not instance)
    displayName: def?.name || id,
    tags: Array.isArray(def?.tags) ? def.tags.slice() : [],


    // world placement
    worldX: Number(worldX) || 0,
    y: y0,
    w, h,

    // motion state
    vx: 0,
    vy: 0,
    onGround: (locomotionMode !== 'hover' && locomotionMode !== 'fly'),
    facing: 1,

    // animation bookkeeping (even though sprites aren’t wired yet)
    animFrame: 0,
    animTimer: 0,
    lastMoveTime: performance.now(),
    hasEverMoved: false,

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

    // Queue of target descriptors (see targetActorDescriptorFromActor)
    targetQueue: [],
    targetCurrentKey: null,

    // targeting scheduling + resolved current target
    __targetQueueDirty: false,
    __targetResortAtMs: 0,
    __targetActor: null,

    // movement intent derived from targeting
    __targetGoalActor: null,
    __targetStopRangePx: null,
    __targetPreferredAbilityId: null,

    // runtime overrides applied by rules (setMobParam)
    paramOverrides: Object.create(null),



    // combat/stat placeholders (no combat system; effects later)
    hp: Number(def?.stats?.hp ?? def?.hp ?? 1),

    // contact/ability runtime
    contactNextTickAtMs: 0,
    abilityNextAtMs: Object.create(null),

    // keep definition reference for later steps (hitboxes/abilities/drops)
    def

  };
}

function spawnMob(mobId, atX, opts = {}) {
  const id = lc(mobId);
  if (!id) return;
  if (!mobDetails?.[id]) {
    console.warn('[mobs] spawnMob: unknown id', mobId);
    return;
  }
  //if (isMobInWorldById(id)) return;

  // Prevent duplicates when restoring + when a spawnIf-only pending spawn fires on re-entry
  const wantInst = (opts && opts.instanceId != null) ? String(opts.instanceId) : null;
  if (wantInst && mobs.some(m => m && String(m.instanceId) === wantInst)) return;

  const mob = createMob(id, atX, { instanceId: wantInst });

  // initial AI mode from section spawn (same idea as NPC “mode” in areas.json)
  const mode = lc(opts.mode || 'stationary');
  if (mode === 'waiting' || mode === 'moving' || mode === 'stationary') {
    setNpcAiMode(mob, mode, {}); // reusing existing mode setter (fields align)
  } else {
    setNpcAiMode(mob, 'stationary', {});
  }

  mobs.push(mob);

  // play spawn anim briefly (skip when restoring)
  if (!opts.noSpawnAnim) setActorTempAnim(mob, 'spawn', 520);
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

    const spawnWhen = normalizeTriggerWhen(m.spawnWhen);
    const spawnIf = m.spawnIf;

    if ((spawnWhen && spawnWhen.length) || spawnIf) {
      pendingSpawns.push({
        kind: 'mob',
        mobId,
        atX,
        mode: m.mode,
        spawnWhen,
        spawnIf,
        instanceId
      });
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

      if (Array.isArray(rec.targetQueue)) mob.targetQueue = rec.targetQueue.slice();
      if (rec.targetCurrentKey != null) mob.targetCurrentKey = rec.targetCurrentKey;

      if (rec.paramOverrides && typeof rec.paramOverrides === 'object') {
        mob.paramOverrides = { ...rec.paramOverrides };
      }
      if (typeof rec.hp === 'number') mob.hp = rec.hp;

      // AI internals (if you stored them)
      if (rec.aiGoalRef != null) mob.aiGoalRef = rec.aiGoalRef;
      if (rec.aiAnchorX != null) mob.aiAnchorX = rec.aiAnchorX;
      if (rec.aiGoalX != null) mob.aiGoalX = rec.aiGoalX;
      if (rec.aiAtGoal != null) mob.aiAtGoal = rec.aiAtGoal;
      if (rec.aiPhase != null) mob.aiPhase = rec.aiPhase;
      if (rec.aiNextDecisionAtMs != null) mob.aiNextDecisionAtMs = rec.aiNextDecisionAtMs;
      if (rec.aiMoveTargetX != null) mob.aiMoveTargetX = rec.aiMoveTargetX;

      // Force a re-resolve of current target actor on next tick
      mob.__targetQueueDirty = true;
      mob.__targetActor = null;
      mob.__targetResortAtMs = 0;
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
    // NEW: apply saved stats onto the newly spawned instance
    const spawned = npcs.find(n => n.name === name);
  if (spawned) { spawned.stats = rec.stats; }
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

      const hasWhen = !!obj.spawnWhen;
      const hasIf = !!obj.spawnIf;

      if (!hasWhen && !hasIf) continue;

      // Start hidden until spawned, unless it is spawnIf-only and already satisfied
      obj._spawned = false;

      const whenArr = normalizeTriggerWhen(obj.spawnWhen);

      if ((!whenArr || !whenArr.length) && hasIf) {
        if (isSpawnIfSatisfied(obj.spawnIf, null, {})) {
          obj._spawned = true;
          continue;
        }
      }

      pendingSpawns.push({
        kind: 'object',
        obj,
        spawnWhen: whenArr,
        spawnIf: obj.spawnIf
      });
    }
  }

  // 2) Immediately spawn any queued mob/NPC specs that are spawnIf-only and already satisfied
  processPendingSpawns(null, {});
}

function processPendingSpawns(eventName, payload) {
  if (!pendingSpawns || pendingSpawns.length === 0) return;

  for (let i = pendingSpawns.length - 1; i >= 0; i--) {
    const spec = pendingSpawns[i];
    if (!spec) { pendingSpawns.splice(i, 1); continue; }

    const whenArr = Array.isArray(spec.spawnWhen) ? spec.spawnWhen : [];
    if (whenArr.length) {
      if (!eventName) continue;
      let matched = false;
      for (const w of whenArr) {
        if (triggerMatches(w, eventName, payload || {})) { matched = true; break; }
      }
      if (!matched) continue;
    }

    if (spec.spawnIf && !isSpawnIfSatisfied(spec.spawnIf, spec.name || null, payload || {})) {
      continue;
    }

    if (spec.kind === 'object') {
      if (spec.obj) spec.obj._spawned = true;
      pendingSpawns.splice(i, 1);
      continue;
    }

    if (spec.kind === 'mob') {
      spawnMob(spec.mobId, spec.atX, { mode: spec.mode, instanceId: spec.instanceId });
      currentArea.mobs = [...mobs];
      pendingSpawns.splice(i, 1);
      continue;
    }


    if (spec.kind === 'npc') {
      spawnNpcFromSectionDef(spec.name, spec.atX, spec.c, spec.rec, spec.sectionStartX);
      currentArea.npcs = [...npcs];
      pendingSpawns.splice(i, 1);
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
        obj.entry = loadObjectImage(obj.key);
      }
    }
  };

  warmObjects(area.backObjects);
  warmObjects(area.foreObjects);
    // ground-locked overlays/objects (move with ground)
  warmObjects(area.groundBackObjects);
  warmObjects(area.groundForeObjects);
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
      const keys = [
        base,
        `${base}_open`,
        `${base}_closed`,
        `${base}_opening`,
        `${base}_closing`,
        `${base}_interact`
      ];

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

          return {
            name: String(it.name || '').trim(),
            height: Number(it.height) || defaultH,
            density: (it.density != null && it.density !== '') ? Number(it.density) : undefined,
            position: (it.position != null && it.position !== '') ? Number(it.position) : undefined,

            // NEW: optional per-instance identity + gate starting state
            id: (it.id != null && it.id !== '') ? String(it.id) : ((it.instanceId != null && it.instanceId !== '') ? String(it.instanceId) : null),
            open: (it.open != null && it.open !== '') ? !!it.open : null,

            spawnWhen: spawnWhenRaw || null,
            spawnIf: spawnIfRaw || null,
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

    positioned.set(secName, { name: secName, pos, groundKey: secDef.groundimage || defaultGroundKey, exits, safePlaces, raw: secDef });
  }

  // Prepare flat sections array (index 0..sectionCount-1)
  const sections = Array(sectionCount).fill(null).map(() => ({
    name: null,
    groundKey: defaultGroundKey,
    exits: [],
    safePlaces: [],
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
      outArr.push({
        worldX: x,
        key: pick.name,
        entry,
        heightPx: pick.height, // assigned height
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

      outArr.push({
        worldX: x,
        key: pick.name,
        entry,
        heightPx: pick.height,
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
      backObjects.push({
        worldX: startX + obj.position,
        anchorToSection: true,
        sectionIndex: i,
        posLocal: obj.position,
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: -8,
        baseBelowTop: 14,

        // NEW
        instanceId: obj.id || null,
        startOpen: (obj.open != null) ? !!obj.open : null,

        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        _spawned: (obj._spawned !== false)
      });


    }

    
    // --- FOREGROUND OBJECTS WITH EXPLICIT POSITION ---
    const foreWithPosition = (foreObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of foreWithPosition) {
      foreObjects.push({
        worldX: startX + obj.position,
        anchorToSection: true,
        sectionIndex: i,
        posLocal: obj.position,
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: 0,
        baseBelowTop: 0,

        // NEW
        instanceId: obj.id || null,
        startOpen: (obj.open != null) ? !!obj.open : null,

        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        _spawned: (obj._spawned !== false)
      });


    }

    // --- GROUND-BACK OBJECTS WITH EXPLICIT POSITION ---
    // Section-defined positions are relative to section start
    const groundBackWithPositionSection = (secGroundBackObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of groundBackWithPositionSection) {
      groundBackObjects.push({
        worldX: startX + obj.position,
        anchorToSection: true,
        sectionIndex: i,
        posLocal: obj.position,
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: 0,
        baseBelowTop: 0,

        // NEW
        instanceId: obj.id || null,
        startOpen: (obj.open != null) ? !!obj.open : null,

        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        _spawned: (obj._spawned !== false)
      });


      addProtectedViewSpot(
        startX + obj.position,
        estimateObjectDrawWidthPx(obj.name, obj.height, 0.70)
      );

    }

    // Area-defined positions are absolute within the whole area
    const groundBackWithPositionArea = (areaGroundBackObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of groundBackWithPositionArea) {
      groundBackObjects.push({
        worldX: obj.position,
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: 0,
        baseBelowTop: 0,

        // NEW
        instanceId: obj.id || null,
        startOpen: (obj.open != null) ? !!obj.open : null
      });

      addProtectedViewSpot(
        obj.position,
        estimateObjectDrawWidthPx(obj.name, obj.height, 0.70)
      );

    }


    // --- GROUND-FORE OBJECTS WITH EXPLICIT POSITION ---
    // Section-defined positions are relative to section start
    const groundForeWithPositionSection = (secGroundForeObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of groundForeWithPositionSection) {
      groundForeObjects.push({
        worldX: startX + obj.position,
        anchorToSection: true,
        sectionIndex: i,
        posLocal: obj.position,
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: 0,
        baseBelowTop: 0,

        // NEW
        instanceId: obj.id || null,
        startOpen: (obj.open != null) ? !!obj.open : null,

        spawnWhen: obj.spawnWhen || null,
        spawnIf: obj.spawnIf || null,
        _spawned: (obj._spawned !== false)
      });


      addProtectedViewSpot(
        startX + obj.position,
        estimateObjectDrawWidthPx(obj.name, obj.height, 0.70)
      );

    }

    // Area-defined positions are absolute within the whole area
    if (i === 0) {
      const groundBackWithPositionArea = (areaGroundBackObjList || []).filter(o =>
        o && typeof o.position === 'number'
      );

      for (const obj of groundBackWithPositionArea) {
        groundBackObjects.push({
          worldX: obj.position,
          key: obj.name,
          entry: null,
          heightPx: obj.height,
          yJitter: 0,
          baseBelowTop: 0,

          // NEW
          instanceId: obj.id || null,
          startOpen: (obj.open != null) ? !!obj.open : null
        });
      }

    }


    // --- BACKGROUND OBJECTS (behind ground) ---
    // 1) Density-defined: spawn Poisson(lambda) of that exact object
    for (const obj of backWithDensity) {
      const k = samplePoisson(obj.density);
      for (let t = 0; t < k; t++) {
        //const entry = loadObjectImage(obj.name);
        const entry = null;
        const x = startX + Math.random() * (endX - startX);
        backObjects.push({
          worldX: x,
          key: obj.name,
          entry,
          heightPx: obj.height,
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
        backObjects.push({
          worldX: x,
          key: pick.name,
          entry,
          heightPx: pick.height,
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
        const x = pickForegroundWorldXAvoidingProtected(obj.name, obj.height);
        foreObjects.push({
          worldX: x,
          key: obj.name,
          random: true,
          entry,
          heightPx: obj.height,
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
        const x = pickForegroundWorldXAvoidingProtected(pick.name, pick.height);
        foreObjects.push({
          worldX: x,
          random: true,
          key: pick.name,
          entry,
          heightPx: pick.height,
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
        groundBackObjects.push({
          worldX: x,
          key: obj.name,
          entry,
          heightPx: obj.height,
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
        groundBackObjects.push({
          worldX: x,
          key: pick.name,
          entry,
          heightPx: pick.height,
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
        groundForeObjects.push({
          worldX: x,
          key: obj.name,
          entry,
          heightPx: obj.height,
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
          heightPx: pick.height,
          yJitter: 0,
          baseBelowTop: 0
        });
      }
    }


  }





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

  if (window.__traceRulesReasons) {
    console.log('[PromptQueue] build active', {
      queuedLen: queuedDialogPrompts.length,
      firedLen: firedDialogTriggers.size,
      party: party.map(n => n.name),
      npcs: npcs.map(n => n.name)
    });
  }


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


  showAreaBanner(areaName);         // show name of area when entering
  beginLoadingForCurrentArea(`Loading ${areaName}...`);

  // Non-blocking: preload portraits + animations for anything referenced by this area.
  startBackgroundPreloadForArea(areaName);


  // area_leave event (for the previous area, if any)
  if (fromArea) {
    emitGameEvent('area_leave', { fromArea, toArea: areaName, area: fromArea, from: pendingVerticalTransferFrom ?? from, npc: 'Player' });
  }
  // NEW: area_enter event
  emitGameEvent('area_enter', { fromArea, toArea: areaName, area: areaName, edge: spawnEdge, from: pendingVerticalTransferFrom ?? from, npc: 'Player' });

  // Mirror area enter/leave for party members (same event names; includes npc)
  for (const member of party) {
    if (!member || !member.name) continue;

    if (fromArea) {
      emitGameEvent('area_leave', { fromArea, toArea: areaName, area: fromArea, from: pendingVerticalTransferFrom ?? from, npc: member.name });
    }
    emitGameEvent('area_enter', { fromArea, toArea: areaName, area: areaName, edge: spawnEdge, from: pendingVerticalTransferFrom ?? from, npc: member.name });
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

  startFadeTransfer(() => {
    snapshotNPCsToRegistry();                 // persist NPCs
    snapshotMobsToRegistry({ stripPlayerTargets: true }); // persist mobs + drop player target
    const spawnEdge = (direction === 'left') ? 'right' : 'left';
    buildAndEnterArea(nextName, spawnEdge);
    carryPartyWithPlayer(prevX, player.worldX);
    nudgePartyBehind(spawnEdge);
  }
  );


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
    direction: exitObj.direction,
    target: exitObj.target,
    toArea: dest.areaName
  });

  startFadeTransfer(() => {
    snapshotNPCsToRegistry();                 // persist NPCs
    snapshotMobsToRegistry({ stripPlayerTargets: true }); // persist mobs + drop player target
    // record vertical transfer origin for upcoming events
    if (exitObj.direction === 'up') pendingVerticalTransferFrom = 'down';
    else if (exitObj.direction === 'down') pendingVerticalTransferFrom = 'up';

    buildAndEnterArea(dest.areaName, 'left'); // target area built
    player.worldX = Math.max(2, Math.min(currentArea.lengthPx - player.w - 2, dest.worldX || 2));
    player.vx = 0; player.vy = 0; player.onGround = true; player.y = groundY - player.h;
    cameraX = Math.max(0, Math.min(player.worldX - canvas.width * 0.5, Math.max(0, currentArea.lengthPx - canvas.width)));

    // Party comes along + nudge behind (arriving from left edge is a safe default here)
    carryPartyWithPlayer(prevX, player.worldX);
    nudgePartyBehind('left');
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
    npc.aiNextDecisionAtMs = performance.now(); // decide immediately
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

function updateWorldNpcAutonomy(npc, dt, activeObjectBlockers) {
  if (!npc) return;

  // Freeze autonomous movement during conversation/menu/action-lock
  const worldLocked = inConversation || inMenu || (inActionPhrase && activeAction?.lockPlayer);
  if (worldLocked) {
    npc.vx = 0;
    return;
  }

  // Stop-moving lock (abilities/attacks)
  {
    const now = performance.now();
    const until = Number(npc.__stopMoveUntilMs || 0);
    if (isFinite(until) && until > now) {
      npc.vx = 0;
      npc.vy = 0;
      // keep snapped to ground
      npc.y = groundY - npc.h - 8;
      return;
    }
  }

  const cfg = getNpcAiConfig(npc.name);

  const mode = lc(npc.aiMode || 'stationary');

  if (mode === 'stationary') {
    // let friction damp existing velocity
    npc.vx *= Math.pow(friction, dt * 60);
    if (Math.abs(npc.vx) < 0.05) npc.vx = 0;
    return;
  }

  if (mode === 'waiting') {
    const now = performance.now();

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
        npc.facing = Math.sign(dx) || npc.facing || 1;
        npc.lastMoveTime = performance.now();
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

    const goalX = Number(npc.aiGoalX);
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
    const atGoalNow = Math.abs(dx) <= 1;
    npc.aiAtGoal = atGoalNow;

    // Fire goal event on transition into "at goal"
    if (!wasAtGoal && atGoalNow) {
      emitGameEvent('npc_goal_reached', {
        npc: npc.name,
        goalX: goalX,
        goalRef: npc.aiGoalRef || null
      });
    }

    // If at goal and the target is still there, do not drift
    if (atGoalNow) {
      npc.worldX = goalX;
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
      npc.facing = Math.sign(dx) || npc.facing || 1;
      npc.lastMoveTime = performance.now();
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

  // Future: mobs/objects/locations can be added without changing queue format
  return null;
}

function isActorUnconscious(a) {
  const st = Number(a?.stats?.stamina?.current ?? 0);
  const co = Number(a?.stats?.composure?.current ?? 0);
  return (st <= 0) || (co <= 0);
}

function normalizeMobTargetingDef(def) {
  if (!def || typeof def !== 'object') return null;

  const add = (def.add && typeof def.add === 'object') ? def.add : Object.create(null);
  const remove = (def.remove && typeof def.remove === 'object') ? def.remove : Object.create(null);
  const action = (def.action && typeof def.action === 'object') ? def.action : Object.create(null);
  const onEmpty = (def.onEmpty && typeof def.onEmpty === 'object') ? def.onEmpty : Object.create(null);

  const sort = Array.isArray(def.sort) ? def.sort : (Array.isArray(def.prioritize) ? def.prioritize : []);
  const resort = (def.resort && typeof def.resort === 'object') ? def.resort : Object.create(null);

  return {
    add,
    remove,
    sort,
    resort,
    action,
    onEmpty
  };
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

function passesAddCriteria(mob, actor, add) {
  if (!mob || !actor) return false;

  // area/section filters (optional)
  if (add.area) {
    const wantArea = lc(add.area);
    if (wantArea !== 'currentarea' && wantArea !== lc(currentAreaName)) return false;
  }

  if (add.section) {
    const actorSec = getSectionNameForX(actor.worldX);
    const wantRaw = lc(add.section);

    // Special scopes (instance-relative)
    let wantSec = null;
    if (wantRaw === 'currentsection') {
      wantSec = getSectionNameForX(mob.worldX);
    } else if (wantRaw === 'anchorsection') {
      const ax = resolveMobAnchorWorldX(mob);
      wantSec = getSectionNameForX(ax);
    } else if (wantRaw === 'currentarea') {
      // no section restriction at all
      wantSec = null;
    } else {
      // literal section name
      wantSec = add.section;
    }

    if (wantSec != null && lc(actorSec) !== lc(wantSec)) return false;
  }


  // distance filter (optional)
  const withinPx = Number(add.withinPx ?? add.rangePx ?? add.withinRangePx);
  if (isFinite(withinPx) && withinPx > 0) {
    const dx = Math.abs(actorCenterX(actor) - mobCenterX(mob));
    if (dx > withinPx) return false;
  }

  return true;
}

function shouldRemoveTarget(mob, actor, remove, add) {
  if (!mob || !actor) return true;

  if (remove.unconscious) {
    if (isActorUnconscious(actor)) return true;
  }

  // If add.section is set, a common removal rule is "leave that section"
  if (remove.leaveSection && add && add.section) {
    const actorSec = getSectionNameForX(actor.worldX);
    const wantRaw = lc(add.section);

    let wantSec = null;
    if (wantRaw === 'currentsection') {
      wantSec = getSectionNameForX(mob.worldX);
    } else if (wantRaw === 'anchorsection') {
      const ax = resolveMobAnchorWorldX(mob);
      wantSec = getSectionNameForX(ax);
    } else if (wantRaw === 'currentarea') {
      wantSec = null; // no section restriction
    } else {
      wantSec = add.section; // literal section name
    }

    if (wantSec != null && lc(actorSec) !== lc(wantSec)) return true;
  }


  const maxDistancePx = Number(remove.maxDistancePx ?? remove.beyondPx);
  if (isFinite(maxDistancePx) && maxDistancePx > 0) {
    const dx = Math.abs(actorCenterX(actor) - mobCenterX(mob));
    if (dx > maxDistancePx) return true;
  }

  return false;
}

function sortValueForRule(rule, mob, actor) {
  if (!rule || typeof rule !== 'object') return 0;

  const by = lc(rule.by || rule.type || '');
  if (by === 'distance' || by === 'closest') {
    return Math.abs(actorCenterX(actor) - mobCenterX(mob));
  }

  if (by === 'stat' || by === 'loweststat' || by === 'lowest_stat') {
    const statKey = lc(rule.stat || '');
    const v = Number(actor?.stats?.[statKey]?.current ?? 0);
    return v;
  }

  if (by === 'lastdamager' || by === 'last_damager') {
    const k = targetKeyFromDescriptor(targetActorDescriptorFromActor(actor));
    return (mob && mob.__lastDamagedByKey && mob.__lastDamagedByKey === k) ? -1 : 0;
  }

  return 0;
}

function compareBySortRules(sortRules, mob, aActor, bActor) {
  for (const r of sortRules) {
    const dir = (r && (r.desc === true || lc(r.order) === 'desc')) ? -1 : 1;
    const av = sortValueForRule(r, mob, aActor);
    const bv = sortValueForRule(r, mob, bActor);
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
  }
  return 0;
}

function updateMobTargeting(mob, nowMs) {
  const tdefRaw = mob?.def?.targeting;
  const tdef = normalizeMobTargetingDef(tdefRaw);
  if (!tdef) return;

  if (!Array.isArray(mob.targetQueue)) mob.targetQueue = [];

  const add = tdef.add || Object.create(null);
  const remove = tdef.remove || Object.create(null);

  // Candidate pool (v1 actors): player + party (+ optional world NPCs)
  const pool = [];
  const includePlayer = (add.includePlayer !== undefined) ? !!add.includePlayer : true;
  const includeParty = (add.includeParty !== undefined) ? !!add.includeParty : true;
  const includeWorldNPCs = (add.includeWorldNPCs !== undefined) ? !!add.includeWorldNPCs : false;

  if (includePlayer) pool.push(player);
  if (includeParty) {
    for (const p of party) pool.push(p);
  }
  if (includeWorldNPCs) {
    for (const n of npcs) pool.push(n);
  }


  const prevKeys = new Set(mob.targetQueue.map(targetKeyFromDescriptor));
  let changed = false;

  // Add pass
  for (const a of pool) {
    if (!a) continue;
    if (!passesAddCriteria(mob, a, add)) continue;

    const td = targetActorDescriptorFromActor(a);
    const k = targetKeyFromDescriptor(td);
    if (!k || prevKeys.has(k)) continue;

    mob.targetQueue.push(td);
    prevKeys.add(k);
    changed = true;
  }

  // Remove pass
  for (let i = mob.targetQueue.length - 1; i >= 0; i--) {
    const td = mob.targetQueue[i];
    const a = resolveActorFromTargetDescriptor(td);
    if (!a || shouldRemoveTarget(mob, a, remove, add)) {
      mob.targetQueue.splice(i, 1);
      changed = true;
    }
  }

  // Determine whether to resort
  const resortWhen = lc(tdef.resort?.when || 'drop'); // 'drop'|'onchange'|'interval'|'always'
  const everyMs = Math.max(50, Number(tdef.resort?.everyMs ?? tdef.resort?.ms ?? 0) || 0);

  const currentKey = String(mob.targetCurrentKey || '');
  const stillHasCurrent = currentKey && mob.targetQueue.some(td => targetKeyFromDescriptor(td) === currentKey);

  let doResort = false;
  if (resortWhen === 'always') doResort = true;
  else if (resortWhen === 'onchange') doResort = changed;
  else if (resortWhen === 'interval') {
    if (!isFinite(mob.__targetResortAtMs) || mob.__targetResortAtMs <= 0) mob.__targetResortAtMs = nowMs;
    if (nowMs >= mob.__targetResortAtMs) {
      doResort = true;
      mob.__targetResortAtMs = nowMs + everyMs;
    }
  } else {
    // default 'drop': only when current disappears
    doResort = !stillHasCurrent;
  }

  // Resort + pick current
  if (doResort) {
    const sortRules = Array.isArray(tdef.sort) ? tdef.sort : [];
    if (sortRules.length) {
      mob.targetQueue.sort((aTd, bTd) => {
        const aActor = resolveActorFromTargetDescriptor(aTd);
        const bActor = resolveActorFromTargetDescriptor(bTd);
        if (!aActor && !bActor) return 0;
        if (!aActor) return 1;
        if (!bActor) return -1;
        return compareBySortRules(sortRules, mob, aActor, bActor);
      });
    }

    const first = mob.targetQueue.length ? mob.targetQueue[0] : null;
    mob.targetCurrentKey = first ? targetKeyFromDescriptor(first) : null;
  }

  // Resolve current actor + derive action intent
  const curTd = mob.targetQueue.length ? mob.targetQueue[0] : null;
  const curActor = curTd ? resolveActorFromTargetDescriptor(curTd) : null;
  mob.__targetActor = curActor;

  // Action intent
  if (curActor) {
    const action = tdef.action || Object.create(null);
    const stopRangePx = Number(action.stopRangePx ?? action.preferredRangePx ?? 0);
    mob.__targetGoalActor = curActor;
    mob.__targetStopRangePx = (isFinite(stopRangePx) && stopRangePx > 0) ? stopRangePx : null;

    const prefAbility = lc(action.abilityId || '');
    mob.__targetPreferredAbilityId = prefAbility || null;

    // Force movement mode while targeting
    mob.aiMode = 'moving';
  } else {
    mob.__targetGoalActor = null;
    mob.__targetStopRangePx = null;
    mob.__targetPreferredAbilityId = null;

    const emptyType = lc(tdef.onEmpty?.type || 'idle');
    if (emptyType === 'returntoanchor' || emptyType === 'return_to_anchor') {
      const ax = resolveMobAnchorWorldX(mob);
      mob.aiMode = 'moving';
      mob.aiGoalX = Number(ax);
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

function getEffectiveMobParam(mob, key) {
  if (!mob || !key) return undefined;

  const k = String(key);

  // Direct fields (common, non-dot keys)
  if (k === 'mode' || k === 'aiMode') return mob.aiMode;
  if (k === 'goalX' || k === 'aiGoalX') return mob.aiGoalX;
  if (k === 'locomotionMode') return mob.locomotionMode;
  if (k === 'hp') return mob.hp;

  // Override-first, then def
  const fromOverride = getByDotPath(mob.paramOverrides, k);
  if (fromOverride !== undefined) return fromOverride;

  return getByDotPath(mob.def, k);
}

function applyMobParam(mob, key, value) {
  if (!mob || !key) return false;

  const k = String(key);

  // Direct fields / behaviour hooks
  if (k === 'mode' || k === 'aiMode') {
    const mode = lc(value);
    if (mode === 'waiting' || mode === 'moving' || mode === 'stationary') {
      setNpcAiMode(mob, mode, {}); // reuse existing
      return true;
    }
    return false;
  }

  if (k === 'goalX' || k === 'aiGoalX') {
    const n = Number(value);
    if (!isFinite(n)) return false;
    mob.aiGoalX = n;
    return true;
  }

  // ===== Anchor / targeting controls (setMobParam) =====

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
    mob.targetQueue = [];
    mob.targetCurrentKey = null;
    mob.__targetActor = null;
    mob.__targetGoalActor = null;
    mob.__targetStopRangePx = null;
    mob.__targetPreferredAbilityId = null;
    return true;
  }

  if (k === 'targetAdd') {
    // Accept: 'player' | 'Rowyn' | {kind:'npc',name:'Rowyn'} | {kind:'player'}
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
    if (!Array.isArray(mob.targetQueue)) mob.targetQueue = [];

    const k2 = targetKeyFromDescriptor(td);
    if (!k2) return false;

    // No duplicates
    for (const ex of mob.targetQueue) {
      if (targetKeyFromDescriptor(ex) === k2) return true;
    }

    mob.targetQueue.push(td);
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

    if (!td || !Array.isArray(mob.targetQueue)) return false;
    const k2 = targetKeyFromDescriptor(td);
    if (!k2) return false;

    for (let i = mob.targetQueue.length - 1; i >= 0; i--) {
      if (targetKeyFromDescriptor(mob.targetQueue[i]) === k2) {
        mob.targetQueue.splice(i, 1);
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
    mob.hp = n;
    handleMobDefeatIfNeeded(mob, { reason: 'setHp' });
    return true;
  }


  // Generic override (dot paths encouraged, e.g. "ai.waiting.speedPxPerSec")
  if (!mob.paramOverrides) mob.paramOverrides = Object.create(null);
  return setByDotPath(mob.paramOverrides, k, value);
}

function setMobParam(eff, payload) {
  const mobId = lc(eff?.id || eff?.mob || eff?.mobId || '');
  const key = String(eff?.key || eff?.param || '');
  if (!mobId || !key) return false;

  const useInContact = !!eff?.inContact;

  // Optional: set only specific instance(s)
  let wantInstanceId = String(eff?.instanceId || eff?.instance || '');

  // If inContact:true, default to the instance that triggered the rule (mob_contact_* payload)
  if (!wantInstanceId && useInContact) {
    wantInstanceId = String(payload?.mobInstanceId || '');
  }

  // (Optional) support multiple instances if you later add payload.mobInstanceIds
  const wantInstanceIds = Array.isArray(payload?.mobInstanceIds) ? payload.mobInstanceIds.map(String) : null;
  const wantSet = wantInstanceIds ? new Set(wantInstanceIds) : null;

  let did = false;

  for (const m of mobs) {
    if (!m || lc(m.id) !== mobId) continue;

    if (wantInstanceId && String(m.instanceId) !== wantInstanceId) continue;
    if (!wantInstanceId && wantSet && !wantSet.has(String(m.instanceId))) continue;

    if (applyMobParam(m, key, eff.value)) did = true;
  }

  if (did) {
    emitGameEvent('mob_param_change', { mob: mobId, key });
  }

  return did;
}

function applyMobLocomotionY(mob, dt) {
  if (!mob) return;

  const def = mob.def || mobDetails?.[lc(mob.id)] || null;

  // Allow rules to override locomotion mode via setMobParam:
  //   { "type":"setMobParam","mob":"x","key":"locomotionMode","value":"hover" }
  // Or via dot path:
  //   { "type":"setMobParam","mob":"x","key":"locomotion.mode","value":"hover" }
  let mode = lc(getEffectiveMobParam(mob, 'locomotion.mode') ?? getEffectiveMobParam(mob, 'locomotionMode') ?? mob.locomotionMode ?? def?.locomotion?.mode ?? 'ground');
  if (!mode) mode = 'ground';

  const yGround = groundY - mob.h - 8;
  const now = performance.now();

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


function updateWorldMobAutonomy(mob, dt, activeObjectBlockers) {
  if (!mob) return;

  // Freeze while despawning (lets animation render cleanly)
  if (mob._removeAtMs) {
    mob.vx = 0;
    mob.vy = 0;
    return;
  }


  // Freeze autonomous movement during conversation/menu/action-lock
  const worldLocked = inConversation || inMenu || (inActionPhrase && activeAction?.lockPlayer);
  if (worldLocked) {
    mob.vx = 0;
    mob.vy = 0;
    return;
  }

  // Stop-moving lock (abilities/attacks)
  {
    const now = performance.now();
    const until = Number(mob.__stopMoveUntilMs || 0);
    if (isFinite(until) && until > now) {
      mob.vx = 0;
      mob.vy = 0;
      applyMobLocomotionY(mob, dt);
      return;
    }
  }

  // Targeting update (may force aiMode/goal)
  {
    const now = performance.now();
    updateMobTargeting(mob, now);
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
    const now = performance.now();

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
        applyMobLocomotionY(mob, dt);
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
        applyMobLocomotionY(mob, dt);
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
        mob.facing = Math.sign(dx) || mob.facing || 1;
        mob.lastMoveTime = performance.now();
        mob.hasEverMoved = true;
      }

      mob.worldX = Math.max(2, Math.min(currentArea.lengthPx - mob.w - 2, mob.worldX));
      resolveActorVsBlockers(mob, prevX, activeObjectBlockers);
      mob.worldX = Math.max(2, Math.min(currentArea.lengthPx - mob.w - 2, mob.worldX));

      applyMobLocomotionY(mob, dt);
      return;


    }
  }

  if (mode === 'moving') {
    // Dynamic targeting goal: chase the current target actor (if present)
    let goalX = Number(mob.aiGoalX);
    let stopRangePx = Number(mob.__targetStopRangePx);

    if (mob.__targetGoalActor) {
      const a = mob.__targetGoalActor;
      goalX = actorCenterX(a) - (Number(mob.w) || 0) * 0.5;
      if (!isFinite(stopRangePx) || stopRangePx <= 0) stopRangePx = 0;
    } else {
      stopRangePx = 0;
    }

    const spd = Number(cfg.moving.speedPxPerSec) || MOB_AI_DEFAULTS.moving.speedPxPerSec;

    if (!isFinite(goalX) || !isFinite(spd) || spd <= 0) {
      mob.vx = 0;
      applyMobLocomotionY(mob, dt);
      return;
    }

    const prevX = mob.worldX;
    const dx = goalX - mob.worldX;

    // If we are close enough (stop range), do not drift into the target
    if (isFinite(stopRangePx) && stopRangePx > 0 && Math.abs(dx) <= stopRangePx) {
      mob.vx = 0;
      mob.facing = Math.sign(dx) || mob.facing || 1;
      applyMobLocomotionY(mob, dt);
      return;
    }

    const step = Math.sign(dx) * spd * dt;

    if (Math.abs(step) >= Math.abs(dx)) {
      mob.worldX = goalX;
      mob.vx = 0;
    } else {
      mob.worldX += step;
      mob.vx = step / dt;
      mob.facing = Math.sign(dx) || mob.facing || 1;
      mob.lastMoveTime = performance.now();
      mob.hasEverMoved = true;
    }

    mob.worldX = Math.max(2, Math.min(currentArea.lengthPx - mob.w - 2, mob.worldX));
    resolveActorVsBlockers(mob, prevX, activeObjectBlockers);
    mob.worldX = Math.max(2, Math.min(currentArea.lengthPx - mob.w - 2, mob.worldX));

    applyMobLocomotionY(mob, dt);
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
  const stats = rec.stats;

  const details = npcDetails && npcDetails[name] ? npcDetails[name] : null;
  const abilities = Array.isArray(details?.abilities) ? details.abilities.map((a) => ({ ...a })) : [];

  return {
    worldX, y, w, h, name, sprite, palette,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1, // 1 = right, -1 = left
    isFollowing: false,
    animFrame: 0,
    animTimer: 0,
    // logical interaction radius (gameplay only)
    interactionRadius: null,

    // NEW unified stat model (shared with registry record)
    stats,

    abilities,

    abilityNextAtMs: Object.create(null),

    lastMoveTime: performance.now(),
    hasEverMoved: false,

    // ===== AI (world NPCs) =====
    aiMode: 'stationary',     // 'stationary' | 'waiting' | 'moving'
    aiAnchorX: null,          // waiting anchor
    aiGoalX: null,            // moving goal
    aiPhase: 'idle',          // waiting internal phase
    aiNextDecisionAtMs: null, // waiting timer
    aiMoveTargetX: null       // waiting current short-walk target
  };
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
    rec.stats = n.stats || rec.stats;
    ensureNpcRecordStats(n.name, rec);
  }
  // party NPCs
  for (const p of party) {
    const rec = ensureNpcRecord(p.name);
    rec.inParty = true;
    rec.area = null;
    rec.worldX = null;
    rec.stats = p.stats || rec.stats;
    ensureNpcRecordStats(p.name, rec);
  }

}

function snapshotMobsToRegistry(opts = null) {
  const stripPlayerTargets = !!(opts && opts.stripPlayerTargets);

  for (const m of mobs) {
    if (!m || !m.instanceId) continue;

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

    // AI
    rec.aiMode = m.aiMode || 'stationary';
    rec.aiAnchorX = (m.aiAnchorX !== undefined) ? m.aiAnchorX : null;
    rec.aiGoalX = (m.aiGoalX !== undefined) ? m.aiGoalX : null;
    rec.aiPhase = (m.aiPhase !== undefined) ? m.aiPhase : null;
    rec.aiNextDecisionAtMs = (m.aiNextDecisionAtMs !== undefined) ? m.aiNextDecisionAtMs : null;
    rec.aiMoveTargetX = (m.aiMoveTargetX !== undefined) ? m.aiMoveTargetX : null;

    // Anchor should remain the original spawn point
    rec.anchor = (m.anchor && isFinite(m.anchor.worldX)) ? { worldX: Number(m.anchor.worldX) } : null;

    // Targeting memory
    rec.targetQueue = Array.isArray(m.targetQueue) ? m.targetQueue.map(t => ({ ...t })) : [];
    rec.targetCurrentKey = (m.targetCurrentKey !== undefined) ? m.targetCurrentKey : null;

    // If we’re leaving this area, player must be removed from targets (but NPCs like Rowyn stay)
    if (stripPlayerTargets && rec.targetQueue.length) {
      rec.targetQueue = rec.targetQueue.filter(t => lc(t?.kind || '') !== 'player');
      if (lc(rec.targetCurrentKey || '') === 'player') rec.targetCurrentKey = null;
    }
  }
}


resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ===== Init =====
async function initGame() {

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


  // Optional: apply Player startingStats from characters.json (during transition)
  if (npcDetails && npcDetails.Player && npcDetails.Player.startingStats) {
    const ss = npcDetails.Player.startingStats;
    for (const k of ['stamina','composure','endurance','fortitude']) {
      if (typeof ss[k] === 'number' && isFinite(ss[k])) {
        setPlayerStatField(k, 'base', ss[k]);
        setPlayerStatField(k, 'current', ss[k]);
      }
    }
  }


  for (const name of npcNameList) {
    ensureNpcRecord(name);
  }

  mobDetailsRaw = await mobDetailsPromise;
  mobDetails = resolveMobTemplates(mobDetailsRaw);
  mobIdList = Object.keys(mobDetails || {});
  console.log('[mobs] loaded', mobIdList.length, 'mob defs');


  itemsData = await loadItemsJSON();
  objectsData = await objectsDataPromise;

  rulesData = await loadRulesJSON();

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

  requestAnimationFrame(gameLoop);
}
initGame();

// ===== Conversation controls (unchanged core) =====
async function startConversation(npc) {
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
  dialogBox.textContent = 'Loading...';
  optionsBox.innerHTML = '';
  conversationPortrait.src = '';

  const fileKey = lc(npc.name);
  const data = await loadDialogFor(fileKey);

  currentDialog = data;
  currentDialogKey = fileKey;

  currentPhraseId = data.start;
  await loadPhrase(currentPhraseId);

}

async function startRuleScene(startRef, ruleId) {
  // Remember which rule started this scene (so once-rules can be marked fired on endConversation)
  currentRuleSceneId = ruleId || null;

  // Scenes are dialog-driven action chains
  inConversation = true;
  inViewMode = false;
  currentNpc = null;

  // Show conversation overlay (actions may hide it again)
  conversationOverlay.style.display = 'block';
  dialogBox.textContent = '';
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
    const rec = npc?.stats?.[k];
    const npcVal = Number(rec?.current);

    if (!isFinite(npcVal)) return false;

    for (const op of Object.keys(rule)) {
      let target = rule[op];

      // allow symbolic values: minalignment / minaffection (now the BASE threshold)
      if (typeof target === 'string') {
        const t = lc(target);
        if (t === 'minalignment') target = Number(npc?.stats?.alignment?.base ?? 0);
        else if (t === 'minaffection') target = Number(npc?.stats?.affection?.base ?? 0);
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
  if (w.alignment && !checkStat('alignment', w.alignment)) return false;
  if (w.affection && !checkStat('affection', w.affection)) return false;

  return true;
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
  npc.stats = rec.stats;
  npcs.push(npc);


  return npc;
}


function startActionPhrase(phraseId, phrase) {
  inActionPhrase = true;

  // Default: lock player movement during actions
  const lockPlayer = phrase.lockPlayer !== false;

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
    lockPlayer
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
      const baseSpeed = actor.maxMovementSpeed || 240;

      // Multiplier from JSON (default 1)
      const factor = Number(act.speedFactor ?? 1);

      // Final speed
      const spd = baseSpeed * factor;


      if (!isFinite(targetX) || !isFinite(spd) || spd <= 0) {
        activeAction.done = true;
      } else {
        const dx = targetX - actor.worldX;
        const step = Math.sign(dx) * spd * dt;

        if (Math.abs(step) >= Math.abs(dx)) {
            console.log('[MOVE SNAP->DONE]', {
            phraseId: activeAction?.phraseId,
            actor: actor?.name,
            worldX: actor?.worldX,
            targetX,
            dx,
            step,
            dt
          });

          actor.worldX = targetX;
          actor.vx = 0;
          activeAction.done = true;
        } else {
          actor.worldX += step;
          actor.vx = step / dt;
          actor.facing = Math.sign(dx) || actor.facing || 1;
          actor.lastMoveTime = performance.now();
          actor.hasEverMoved = true;
        }

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

    
    console.log('[ACTION DONE]', {
      phraseId: activeAction?.phraseId,
      currentPhraseId,
      act: activeAction?.phrase?.action,
      next
    });

    stopActionPhrase();

    // Apply effects on the action phrase when it completes (optional but consistent)
    applyEffects(phraseNow?.effects);

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

  if (s === 'player') return 'player';
  if (s === 'narrator') return 'narrator';

  // guide / null / missing speaker
  if (!s || s === 'guide') return 'guide';

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

function refreshConversationOverlayLayout(phrase) {
  if (!conversationOverlay || !dialogBox || !optionsBox) return;

  // Defaults
  resetConversationOverlayLayout();

  const mode = getDialogLayoutModeForPhrase(phrase);
  conversationOverlay.dataset.mode = mode;

  // Track current speaker name so stat-change feedback can mirror into the dialog portrait
  // (best-effort: supports a few common phrase shapes)
  CURRENT_DIALOG_SPEAKER_NAME = String(
    (phrase && (phrase.speaker ?? phrase.npc ?? phrase.actor ?? phrase.name ?? phrase.who)) || ''
  ).trim();


  const W = window.innerWidth || 0;
  const H = window.innerHeight || 0;
  const pad = 12;

  if (mode === 'narrator') {
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
    // 50% width, centered horizontally, 4 lines min, sits above optionsBox
    dialogBox.style.width = '50%';
    dialogBox.style.left = '50%';
    dialogBox.style.transform = 'translateX(-50%)';
    setDialogMinHeightForLines(4);

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

  dialogBox.style.background = 'rgba(255, 255, 255, 1)';
  dialogBox.style.border = '1px solid rgba(0, 0, 0, 1)';
  dialogBox.style.color = '#000';
  dialogBox.style.fontStyle = '';


  // measure portrait width (after image load this becomes correct)
  const pr = conversationPortrait ? conversationPortrait.getBoundingClientRect() : { width: 0 };
  const leftX = Math.ceil((pr.width || 0) + pad);

  // dialog box: just below top; left anchored to portrait; width fills remaining up to max=H
  const avail = Math.max(0, W - leftX - pad);
  const boxW = Math.max(200, Math.min(avail, H)); // max width = window height
  dialogBox.style.left = `${leftX}px`;
  dialogBox.style.top = `20%`;
  dialogBox.style.width = `${Math.floor(boxW)}px`;
  dialogBox.style.maxWidth = `${Math.floor(H)}px`;

  // height: at least 4 lines OR enough to show full text (whichever is taller)
  setDialogMinHeightForLines(4);
  dialogBox.style.height = ''; // let content decide, scroll if needed

  // options box aligned to same left/width
  optionsBox.style.left = `${leftX}px`;
  optionsBox.style.bottom = `${pad}px`;
  optionsBox.style.width = `${Math.floor(boxW)}px`;
  optionsBox.style.maxWidth = `${Math.floor(H)}px`;
  optionsBox.style.transform = '';
  optionsBox.style.textAlign = 'left';
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
  element.innerHTML = '';
  if (!text) return;

  isTypingDialog = true;
  cancelDialogTyping = false;

  const delay = 1000 / dialogCharsPerSecond;

  let htmlBuffer = '';

  let i = 0;
  while (i < text.length) {
    if (!inConversation) return;

    if (cancelDialogTyping) {
      element.innerHTML = text;
      break;
    }

    // If this is an HTML tag, append it instantly
    if (text[i] === '<') {
      const end = text.indexOf('>', i);
      if (end !== -1) {
        htmlBuffer += text.slice(i, end + 1);
        element.innerHTML = htmlBuffer;
        i = end + 1;
        continue;
      }
    }

    // Visible character: animate it
    htmlBuffer += text[i];
    element.innerHTML = htmlBuffer;
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

  const resolved = await ensureDialogAndGetPhrase(id);
  if (!resolved.dialog) { endConversation(); return; }

  const phrase = resolved.dialog.phrases[resolved.phraseId];
  currentPhraseId = resolved.phraseId;

  if (!phrase) { endConversation(); return; }


  // ACTION PHRASE:
  // If phrase has an `action` object, treat it as a scene/action step.
  // - Hide dialog UI
  // - Lock world + dialog inputs
  // - Keep world updating (handled in update())
  if (phrase.action && typeof phrase.action === 'object') {
    startActionPhrase(id, phrase);
    return;
  }

  // Apply dialog phrase effects ON ENTER (so they run once when shown)
  applyEffects(phrase?.effects);


  // Layout mode (player / narrator / guide / npc)
  const layoutMode = getDialogLayoutModeForPhrase(phrase);

  // Default: hide portrait unless NPC mode (but DO NOT clear src here; keep old portrait until new is ready)
  conversationPortrait.style.display = (layoutMode === 'npc') ? 'block' : 'none';

  // For NPC phrases: do not show the dialog/options until the NEW portrait is loaded
if (layoutMode === 'npc') {
  __dialogAwaitingPortrait = true;

  // Keep the old portrait visible while loading the next one
  if (dialogBox) dialogBox.style.display = 'none';
  if (optionsBox) optionsBox.style.display = 'none';


    const speakerName = lc(String(phrase.speaker || ''));
    const reaction = phrase.reaction || 'neutral';

    const portraitPath =
      `assets/portraits/character_portrait_${speakerName}_${reaction}.png`;
    const fallback =
      `assets/portraits/character_portrait_${speakerName}_neutral.png`;

    const finalSrc = await ensurePortraitSrcLoaded(portraitPath, fallback);

    // If another phrase started loading while we waited, abort this one
    if (!inConversation || mySeq !== __dialogPhraseLoadSeq) return;

    conversationPortrait.src = finalSrc;


    __dialogAwaitingPortrait = false;

    // Now that portrait is ready (real width), layout + show dialog/options
    refreshConversationOverlayLayout(phrase);
    if (dialogBox) dialogBox.style.display = '';
    if (optionsBox) optionsBox.style.display = '';

  } else {
    __dialogAwaitingPortrait = false;
    // Non-NPC modes can lay out immediately
    refreshConversationOverlayLayout(phrase);
  }




  optionsBox.innerHTML = '';
  dialogOptionsMap = null;

  await typeDialogText(dialogBox, phrase.text);

  if (phrase.options) {
    dialogOptionsMap = {};
    let idx = 1;
    for (const key in phrase.options) {
      const opt = phrase.options[key];

      // NEW: conditional visibility
      if (opt.when && !checkWhenBlock(opt.when, currentNpc)) {
        continue; // hide this option
      }

      const optDiv = document.createElement('div');
      optDiv.textContent = `${idx}. ${opt.text}`;
      optionsBox.appendChild(optDiv);

      dialogOptionsMap[idx] = {
        ...opt,
        optionId: key
      };
      idx++;
    }

  } else {
    const p = document.createElement('div');
    p.textContent = 'Press any key to continue...';
    optionsBox.appendChild(p);
  }
  // Final layout pass (now that optionsBox has its real height)
  refreshConversationOverlayLayout(phrase);

}

async function startTriggeredDialog(index) {
  const p = activeDialogPrompts[index];
  if (!p) return;

  // Mark as "fired" only AFTER the conversation completes
  currentTriggeredPromptId = `${lc(p.npc.name)}:${p.triggerKey}`;

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
  dialogBox.innerHTML = 'Loading...';
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


function endConversation() {
  console.log('[DEBUG] endConversation called');

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
  currentNpc = null;

  currentDialog = null;
  currentPhraseId = null;
  dialogOptionsMap = null;
  inViewMode = false;
  conversationOverlay.style.display = 'none';

  // NPC must exist and must not be in view-only mode
  if (!npc || wasViewMode) {
    // Even without an NPC, state-only rules may now be eligible to fire.
    console.log('[DEBUG] evaluateAllStateRules about to run');

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
    firedDialogTriggers.add(currentTriggeredPromptId);
    currentTriggeredPromptId = null;
  }

  // IMPORTANT: some state-only scene rules get unblocked only after conversations end
  console.log('[DEBUG] evaluateAllStateRules about to run');
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

function canRecruitNpc(npc) {
  if (!npc) return false;
  if (party.includes(npc)) return false;
  if (party.length >= 3) return false;

  const aCur = Number(npc?.stats?.alignment?.current ?? 0);
  const aMin = Number(npc?.stats?.alignment?.base ?? 0);

  const fCur = Number(npc?.stats?.affection?.current ?? 0);
  const fMin = Number(npc?.stats?.affection?.base ?? 0);

  return (
    (fCur >= fMin) ||
    (aCur >= aMin)
  );
}


function emitProximityEvent(isEnter, t) {
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



  emitGameEvent(ev, {
    area: currentAreaName,
    section: getSectionNameForX(player.worldX),
    kind: t.kind,
    id: t.id,
    from: (playerCenterX() < t.worldX) ? 'left' : 'right',
    target: t.target,
    npc: (t.kind === 'npc') ? t.id : undefined
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
  const payload = { ...mobPayloadBase(mob, targetActor), ...(extraPayload || {}) };
  applyRuleEffects({ effects }, payload);
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

  // If it was in contact, force an end event + onEnd hook
  const instKey = makeContactKey({ kind: 'mob', id: mob.instanceId });
  if (contactInside.has(instKey)) {
    contactInside.delete(instKey);
    mob.contactNextTickAtMs = 0;
    emitMobContactEvent(false, mob);
    runMobContactHook(mob, 'end');
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

function handleMobDefeatIfNeeded(mob, extraPayload = null) {
  if (!mob) return false;

  const hp = Number(mob.hp);
  if (!isFinite(hp)) return false;
  if (hp > 0) return false;

  // prevent double-processing
  if (mob._defeated) return true;
  mob._defeated = true;

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
  const now = performance.now();
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
  const list = mob?.def?.abilities;
  if (!Array.isArray(list) || list.length === 0) return;

  // Ability gating: if you ever want to disable abilities via rules, add a mob param later.
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a) continue;

    const abilityId = lc(a.id || a.name || `ability_${i}`);
    const nextAt = Number(mob.abilityNextAtMs?.[abilityId] || 0);
    if (nowMs < nextAt) continue;

    const requiresContact = !!(a.requiresContact || a.inContact);
    let contactTargetActor = null;

    if (requiresContact) {
      // Prefer current target if set, else player, else party
      const pref = mob.__targetActor || mob.__targetGoalActor || player;

      const candidates = [pref, player, ...party];
      for (const cand of candidates) {
        if (!cand) continue;
        const pairKey = contactPairKey(mob.instanceId, cand);
        if (pairKey && contactInsidePairs.has(pairKey)) {
          contactTargetActor = cand;
          break;
        }
      }
      if (!contactTargetActor) continue;
    }



    const rangePxRaw = a.rangePx ?? a.range;
    const rangePx = Number(rangePxRaw);
    if (isFinite(rangePx) && rangePx > 0) {
      const mobCx = (Number(mob.worldX) || 0) + (Number(mob.w) || 0) * 0.5;

      // Prefer current targeting actor; fall back to player
      const pref = mob.__targetActor || mob.__targetGoalActor || player;
      const prefCx = actorCenterX(pref);

      const dx = Math.abs(prefCx - mobCx);
      if (dx > rangePx) continue;
    }


    const effects = Array.isArray(a.effects) ? a.effects : null;
    if (!effects || effects.length === 0) continue;

    // Fire
    emitGameEvent('mob_ability', { ...mobPayloadBase(mob), ability: abilityId });
    console.log(
      '[mob ability]',
      abilityId,
      'mob=', mob.id,
      'instance=', mob.instanceId,
      'rangePx=', a.rangePx ?? a.range,
      'requiresContact=', !!(a.requiresContact || a.inContact)
    );
    const pref = mob.__targetActor || mob.__targetGoalActor || player;
    applyMobEffects(effects, mob, { ability: abilityId }, contactTargetActor || pref);

    const cd = Math.max(0, Number(a.cooldownMs ?? a.cooldown ?? 1000) || 1000);
    mob.abilityNextAtMs[abilityId] = nowMs + cd;
    return; // one ability per tick per mob
  }
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
  rec.lastSeenArea = null;
  rec.lastSeenWorldX = null;
  rec.lastSeenAt = Date.now();

  rec.area = null;
  rec.worldX = null;
  rec.stats = npc.stats || rec.stats;
  ensureNpcRecordStats(npc.name, rec);




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



// ===== Key handling =====
const keys = {};
window.addEventListener('keydown', (e) => {

  if (inConversation && isTypingDialog) {
    cancelDialogTyping = true;
    e.preventDefault();
    return;
  }

  // Menu input eats keys (prevents movement, recruiting, exits, etc.)
  if (inMenu) {
    if (e.code === 'Escape' || e.code === 'KeyX' || e.code === 'KeyM') {
      closePlayerMenu();
      e.preventDefault();
      return;
    }

    // Left/Right: cycle pages
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const dir = (e.code === 'ArrowRight') ? 1 : -1;
      const ids = MENU_PAGES.map(p => p.id);
      const idx = Math.max(0, ids.indexOf(activeMenuPageId));
      const next = (idx + dir + ids.length) % ids.length;
      setActiveMenuPage(ids[next]);
      e.preventDefault();
      return;
    }

    // Open menu directly to Items
    if (e.code === 'KeyI') {
      setActiveMenuPage('items');
      e.preventDefault();
      return;
    }

    // Open menu directly to Items
    if (e.code === 'KeyP') {
      setActiveMenuPage('party');
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
          tryUseItemWithFeedback(slot.id, slot.uid);
        }

        e.preventDefault();
        return;
      }
    }

    if (activeMenuPageId === 'abilities' && e.code.startsWith('Digit')) {
      const n = parseInt(e.code.replace('Digit', ''), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 9) {
        const slot = abilitiesMenuHotkeys[n - 1];
        if (!slot || !slot.abilityId || !slot.npcName) {
          e.preventDefault();
          return;
        }

        if (!tryCastPartyAbility(slot.npcName, slot.abilityId)) {
          e.preventDefault();
          return;
        }

        closePlayerMenu();
        renderPlayerMenu();
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

  if (controlsLocked && !inConversation) return;

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

          const aff = Number(opt.affectionEffect || 0);
          const ali = Number(opt.alignmentEffect || 0);

          if (isFinite(aff) && aff !== 0) {
            merged.push({ type: 'updateStat', npc: currentNpc.name, stat: 'affection', delta: aff });
          }
          if (isFinite(ali) && ali !== 0) {
            merged.push({ type: 'updateStat', npc: currentNpc.name, stat: 'alignment', delta: ali });
          }

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
  if (controlsLocked && !inConversation) {
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

  // Object interaction (Space)
  if (e.code === 'Space') {
    if (!currentObjectInteract) {
      // no interact target => allow Space to be used for jump as usual
    } else {


      const wasTypeInteracted =
        !!getFlag('global', `objectTypeInteracted:${currentObjectInteract.typeId}`);

      setFlag('global', 'activeObjectType', currentObjectInteract.typeId);
      setFlag('global', `objectTypeInteractedBefore:${currentObjectInteract.typeId}`, wasTypeInteracted);


      emitGameEvent('object_interact', {
        kind: 'object',
        id: currentObjectInteract.typeId,
        instanceKey: currentObjectInteract.instanceKey,
        wasTypeInteracted
      });


      e.preventDefault();
      return;
    }
  }



  if (e.code === 'KeyV' && currentTrigger) {
    inViewMode = true;
    inConversation = true;
    currentNpc = currentTrigger;
    promptEl.style.display = 'none';
    conversationPortrait.src = `assets/portraits/character_portrait_${lc(currentNpc.name)}_neutral.png`;
    dialogBox.textContent =
      `Name: ${currentNpc.name}\nAlignment: ${Number(currentNpc?.stats?.alignment?.current ?? 0)} / ${Number(currentNpc?.stats?.alignment?.base ?? 0)}\nAffection: ${Number(currentNpc?.stats?.affection?.current ?? 0)} / ${Number(currentNpc?.stats?.affection?.base ?? 0)}`;
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


  if (e.code === 'KeyN') showNames = !showNames;

  // Menu toggle
  if (!inConversation && !loading && e.code === 'KeyM') {
    togglePlayerMenu();
    e.preventDefault();
    return;
  }

  // Open menu directly to Items
  if (!inConversation && !loading && e.code === 'KeyI') {
    togglePlayerMenu('items');
    e.preventDefault();
    return;
  }

  // Open menu directly to Party
  if (!inConversation && !loading && e.code === 'KeyP') {
    togglePlayerMenu('party');
    e.preventDefault();
    return;
  }

  // Open menu directly to Abilities
  if (!inConversation && !loading && e.code === 'KeyA') {
    togglePlayerMenu('abilities');
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

window.addEventListener('keyup', (e) => { keys[e.code] = false; });

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
      job.triggerKey
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


// ===== Update / Draw =====
function update(dt) {

  if (!currentArea) return;

  // Timed flags
  expireTimedFlags(performance.now());

  // Background asset warming (silent; a few per frame)
  processAssetWarmQueue(4);
  __resolvePendingPassoutRescuePrompt();


  // If we're in an action phrase, run the action each frame.
  if (inConversation && inActionPhrase) {
    runActiveAction(dt);
  }

  if (inActionPhrase && activeAction?.lockPlayer && !isPlayerDrivenByActionMoveTo()) {
    player.vx = 0;
  }


  if (loading) {
    const visibleNpcsReady = npcs.every(npc => {
      const sprites = npcSprites[npc.name];
      return sprites && sprites.ready;
    });

    // player sprite readiness (you currently have playerSprite, not player.sprite)
    const playerReady = playerSprites && playerSprites.ready;


    // background readiness (needs the helper from earlier: isAreaBackgroundReady)
    const bgReady = isAreaBackgroundReady(currentArea);

    if (playerReady && visibleNpcsReady && bgReady) {
      pendingSpawns = [];
      populateNPCsForCurrentArea();
      populateMobsForCurrentArea();
      initConditionalSpawnsForCurrentArea();
      loading = false;


      // Initialize world time cache after first successful load gate
      if (!__lastWorldTimeInfo) __lastWorldTimeInfo = getWorldTimeInfo(WORLD_TIME_MIN);
      if (__lastWorldTimeTickBucket == null) __lastWorldTimeTickBucket = Math.floor(WORLD_TIME_MIN / Math.max(1e-6, WORLD_TIME_TICK_MIN));

    } else {
      return; // block update + input
    }

  }

  // ===== World time progression (dt-driven, deterministic pausing rules) =====
  if (shouldAdvanceWorldTime()) {
    advanceWorldTime(dt);
  }


  const playerMovementLocked = inConversation || inMenu || (inActionPhrase && activeAction?.lockPlayer);
  const playerDrivenByAction = isPlayerDrivenByActionMoveTo();
  const activeObjectBlockers = getActiveObjectBlockers();

  if (!playerDrivenByAction) {
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

    if (player.vx > 0) lastDirection = 1;
    else if (player.vx < 0) lastDirection = -1;

    const prevPlayerX = player.worldX;
    player.worldX += player.vx * dt;
    player.y += player.vy * dt;

    resolveActorVsBlockers(player, prevPlayerX, activeObjectBlockers);


    if (player.vx !== 0) {
      player.hasEverMoved = true;
      player.lastMoveTime = performance.now();
    }

    if (player.y < 0) { player.y = 0; player.vy = 0; }
    if (player.y + player.h >= groundY) {
      player.y = groundY - player.h;
      player.vy = 0;
      player.onGround = true;
    }
  } else {
    // Player is being moved by action phrase (moveTo).
    // runActiveAction() updates player.worldX and player.vx; we only update facing bookkeeping here.
    if (player.vx > 0) lastDirection = 1;
    else if (player.vx < 0) lastDirection = -1;

    if (player.vx !== 0) {
      player.hasEverMoved = true;
      player.lastMoveTime = performance.now();
    }

    // Keep the same grounding rule used elsewhere (moveTo also does this, but belt-and-braces)
    player.y = groundY - player.h;
    player.vy = 0;
    player.onGround = true;
  }


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
  if (!playerMovementLocked) {
    for (let i = 0; i < party.length; i++) {
      const m = party[i];

      // Stop-moving lock (abilities/attacks)
      {
        const now = performance.now();
        const until = Number(m.__stopMoveUntilMs || 0);
        if (isFinite(until) && until > now) {
          m.isFollowing = false; // ok while locked; will be recalculated next tick when unlocked
          m.vx = 0;
          m.vy = 0;
          m.onGround = true;
          m.y = groundY - m.h;
          continue;
        }
      }

      const nowMs = performance.now();
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
        m.facing = Math.sign(m.vx);
        m.lastMoveTime = performance.now();
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
    updateWorldNpcAutonomy(npc, dt, activeObjectBlockers);
  }


  // Remove mobs whose despawn delay has completed
  {
    const now = performance.now();
    for (let i = mobs.length - 1; i >= 0; i--) {
      const m = mobs[i];
      const t = Number(m?._removeAtMs);
      if (isFinite(t) && t > 0 && now >= t) {
        removeMobInstance(m);
      }
    }
  }


    // --- World mob autonomy ---
  for (const mob of mobs) {
    updateWorldMobAutonomy(mob, dt, activeObjectBlockers);
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

    // Make a stable id. If your ex already has an id, use it; otherwise use a composite.
    const exId = ex.id
      ? String(ex.id)
      : `${String(ex.direction || '')}:${String(ex.target || '')}:${String(ex.worldX || '')}`;

    //if (currentAreaName === 'Forest1') console.log('[exit]', exId, ex);

    targets.push({
      kind: 'exit',
      id: exId,
      worldX: ex.worldX,
      radius: interactionRadius('exit', 0),
      direction: ex.direction,
      target: ex.target,
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
      const nowMs = performance.now();
      const resolved = resolvePlacedObjectRender(o, base, nowMs);
      const entry = resolved.entry;

      // Match the draw functions' default sizing per layer
      const defaultHMult = (bucket.layer === 'back') ? 0.55 : 0.70;

      const targetH = Math.floor(
        (o.heightPx || (TILE_DRAW_HEIGHT() * defaultHMult)) * SCALE.objects
      );

      let targetW = Math.floor(player.w); // safe fallback if image not ready yet
      if (entry && entry.ready) {
        const srcW = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameW) : Math.max(1, entry.w);
        const srcH = (entry.frames && entry.frames > 1) ? Math.max(1, entry.frameH) : Math.max(1, entry.h);
        if (srcH > 0) targetW = Math.floor(targetH * (srcW / srcH));
      }

      const instanceId = String(o.instanceId || `${bucket.layer}:${base}:${i}`).trim(); // unique per placed object

      targets.push({
        kind: 'object',
        id: base,
        instanceId,
        worldX: o.worldX + (targetW * 0.5),
        radius: interactionRadius('object', targetW),
        filename: base
      });



    }
  }

  for (const t of targets) {
    const key = makeProxKey(t);          // instance key (objects use instanceId)
    const typeKey = makeProxTypeKey(t);  // rule-facing key (kind + base id)
    if (!key || !typeKey) continue;

    // keep latest target lookup for distance checks (used by object interaction focus)
    proximityTargetByKey.set(key, t);


    const isInside = inRadius(t.worldX, t.radius);
    const wasInside = proximityInside.has(key);

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

      // Set interaction focus if none exists yet for this type
      if (!proximityInteractFocus.has(typeKey)) {
        proximityInteractFocus.set(typeKey, key);
      }


      // Keep type-level proximity in sync for STATE rules
      if (t.kind === 'object') {
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


      emitProximityEvent(true, t);


    } else if (!isInside && wasInside) {
      proximityInside.delete(key);

      // If this instance was the interaction focus, clear it
      if (proximityInteractFocus.get(typeKey) === key) {
        proximityInteractFocus.delete(typeKey);
      }


      // Keep type-level proximity in sync for STATE rules
      if (t.kind === 'object') {
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


      emitProximityEvent(false, t);

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
  const nowMobMs = performance.now();

  for (const mob of mobs) {
    if (!mob || !mob.id || !mob.instanceId) continue;

    runMobContactTick(mob, nowMobMs);
    tryMobAbilities(mob, nowMobMs);
  }



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
      showSectionBanner(nowSection);
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
    promptEl.textContent = text.trim();
    promptEl.style.display = 'block';
  } else {
    promptEl.style.display = 'none';
  }


  //const dialogPromptContainer = document.getElementById('dialogPromptContainer');

  activeDialogPrompts.length = 0;

  const __stillActivePromptIds = new Set();

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
    if (firedDialogTriggers.has(firedId)) continue;

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
      __promptId: promptId
    });
  }
  
  // Free any party prompt slots that disappeared this frame
  for (const [pid] of __partyPromptSlotById) {
    if (!__stillActivePromptIds.has(pid)) {
      __releasePartyPromptSlot(pid);
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
    return img.height + 6;
  }

  // Fallback: plain "R" only if image missing
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.font = '40px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('R', sx, sy);
  ctx.restore();

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


function drawSpeechBubbleForNpc(npc, text, keyLabel, yOffset = 0) {
  const sx = npc.worldX - cameraX + npc.w / 2;
  const sy = npc.y - 10 - yOffset;

  ctx.save();

  const fontPx = 48;
  ctx.font = `${fontPx}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const paddingX = 16;
  const paddingY = 10;

  const fullText = keyLabel ? `[${keyLabel}] ${text}` : text;

  const textW = ctx.measureText(fullText).width;
  const boxW = Math.ceil(textW + paddingX * 2);
  const boxH = Math.ceil(fontPx + paddingY * 2);

  const x = Math.floor(sx - boxW / 2);
  const y = Math.floor(sy - boxH);

  // Bubble (opaque white with 6px black border)
  const cornerRadius = 12; // increase for rounder corners

  drawRoundedRect(ctx, x, y, boxW, boxH, cornerRadius);

  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.stroke();


  // Text (black)
  ctx.fillStyle = '#000000';
  ctx.fillText(fullText, sx, y + boxH / 2);

  ctx.restore();
  return boxH + 6;
}


function drawInteractionIcon(x, y, label = 'I') {
  // Primary: image icon
  if (interactIcon.ready && interactIcon.img) {
    const img = interactIcon.img;
    ctx.drawImage(
      img,
      Math.floor(x - img.width / 2),
      Math.floor(y - img.height)
    );
    return;
  }

  // Fallback: text icon
  ctx.save();

  ctx.font = '28px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.fillText(String(label || 'I'), x, y + 1);

  ctx.restore();
}

function drawExitProximityIcon() {
  // Prefer Up if both happen to be present
  const ex = currentExitUp || currentExitDown;
  if (!ex) return;

  const useUp = !!currentExitUp;
  const icon = useUp ? exitUpIcon : exitDownIcon;
  if (!icon.ready || !icon.img) return;

  const worldCenterX = Number(ex.worldX) + Number(ex.w || 0) * 0.5;
  const sx = worldToScreenX(worldCenterX, PARALLAX.ground);

  // Vertically fixed to the middle of the screen (still within world-render layer)
  const sy = Math.floor(HEIGHT * 0.5);

  const img = icon.img;
  ctx.drawImage(
    img,
    Math.floor(sx - img.width * 0.5),
    Math.floor(sy - img.height * 0.5)
  );
}


// ============================================================================
// Actor animation request (shared by mobs + NPCs)
// ============================================================================

function setActorTempAnim(actor, type, durationMs = 450, nowMs = null) {
  if (!actor) return false;
  const now = (nowMs == null) ? performance.now() : Number(nowMs);
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
  const now = (nowMs == null) ? performance.now() : Number(nowMs);
  const dur = Math.max(0, Number(durationMs || 0));
  return lockActorMovementUntil(actor, now + dur);
}

function getActionAnimSpec(actionDef, fallbackType = 'ability', fallbackMs = 520) {
  const t = lc(actionDef?.animation ?? actionDef?.anim ?? fallbackType);
  const ms = Number(
    actionDef?.animationMs ??
    actionDef?.animMs ??
    actionDef?.durationMs ??
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

  const now = performance.now();
  const stoppedLongEnough = now - (player.lastMoveTime || 0) > 10000;

  drawActorSprite({
    actor: player,
    sprites,
    x,
    y,
    facing: lastDirection,
    stoppedLongEnough,
    freezeAnim: (inConversation && !inActionPhrase)
  });


  // Player head bars (STA/COM only) — draw even when names are hidden (force-visible window)
  const cx = x + player.w / 2;
  const y0 = y - 2;

  // bars start just above the player head; they stack upward
  const barsStartYBottom = y0 - 4;
  const barsUsed = drawPlayerHeadBars(x, barsStartYBottom);

  // Name label (only when toggled on) sits above the stacked bars
  if (showNames && player.name) {
    ctx.save();
    ctx.font = '48px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;

    const line1 = `${player.name}`;
    const nameY = barsStartYBottom - barsUsed - 6;

    ctx.strokeText(line1, cx, nameY);
    ctx.fillText(line1, cx, nameY);

    ctx.restore();
  }
}

function drawCharacter(char) {
  const sx = char.worldX - cameraX;
  if (sx + char.w < -50 || sx - char.w > WIDTH + 50) return;

  const x = Math.floor(sx);
  const y = Math.floor(char.y);

  const now = performance.now();
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
      freezeAnim: (inConversation && !inActionPhrase)
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
        freezeAnim: (inConversation && !inActionPhrase)
      });
    } else {
      const p = char.palette || {};
      ctx.fillStyle = p.hat || '#444';
      ctx.fillRect(x, y, char.w, char.h);
    }
  }

  const barsUsed = drawNpcHeadBars(char, x, y);


  if (showNames && char.name) {
    ctx.save();
    ctx.font = '60px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;

    const align = Number(char?.stats?.alignment?.current ?? 0);
    const affect = Number(char?.stats?.affection?.current ?? 0);

    const label = `${char.name}  [A=${align}  F=${affect}]`;

    const cx = x + char.w / 2;
    const baseNameY = y - 2;
    const nameY = baseNameY - (Number(barsUsed) || 0) - 6;

    ctx.strokeText(label, cx, nameY);
    ctx.fillText(label, cx, nameY);
    ctx.restore();
  }

}


function drawMob(mob) {
  const sx = mob.worldX - cameraX;
  if (sx + mob.w < -50 || sx - mob.w > WIDTH + 50) return;

  const x = Math.floor(sx);
  const y = Math.floor(mob.y);

  const now = performance.now();
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
      freezeAnim: (inConversation && !inActionPhrase)
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
        freezeAnim: (inConversation && !inActionPhrase)
      });
    } else {
      ctx.fillStyle = '#444';
      ctx.fillRect(x, y, mob.w, mob.h);
    }
  }

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

  drawGroundBackObjects(); // NEW: moves with ground, but behind characters


  // (Characters & player are drawn in other functions)
}

function drawParallaxObjectLayer(list, parallax, defaultHeightFactor, dyFn) {
  if (!list || list.length === 0) return;

  const nowMs = performance.now();

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

    const nowMs = performance.now();


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

    if (proximityInteractFocus.get(typeKey) === instanceKey && isObjectInteractable(base, instanceKey)) {
      drawInteractionIcon(
        sx + Math.floor(targetW * 0.5),
        dy - 16,
        'Space'
      );
    }
  }
}


function drawGroundBackObjects() {
  if (!currentArea || !currentArea.groundBackObjects || currentArea.groundBackObjects.length === 0) return;
  drawGroundObjectLayer(currentArea.groundBackObjects, 'gback', -250);
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
      const nowMs = performance.now();
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

    // Bring party to the safe place too (random positions within 500 worldX)
    scatterPartyNearPlayer(500);

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



function gameLoop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;

  update(dt);
  updateFade(dt);       // NEW: advance fade state

    // ===== World render (affected by camera zoom) =====
  ctx.save();
  applyCameraZoomTransform();

  drawScenery();

  drawExitProximityIcon();

  if (loading) {

    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = '60px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(loadingMessage || 'Loading...', WIDTH / 2, HEIGHT / 2);
    ctx.restore();

    drawFadeOverlay();
    requestAnimationFrame(gameLoop);
    return;
  }

  drawCharacters();
  drawPlayer();

  drawGroundForeObjects(); // moves with ground, in front of characters (but behind UI)

  // --- Time-of-day darkening: Group B (ground + actors + groundForeObjects) ---
  drawTimeDarkenOverlay('B');

  // --- Time-of-day darkening: Group C (true foreground objects) ---
  drawTimeDarkenOverlay('C');

  // ===== Above-head UI (recruit icons + dialog prompt bubbles) =====
  const headStack = new Map(); // npc -> current yOffset used


  drawStatChangeFloaters(ctx);
  drawItemFoundFloaters(ctx);


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
for (let i = 0; i < activeDialogPrompts.length; i++) {
  const p = activeDialogPrompts[i];
  if (!p || !p.npc) continue;

  const actor = p.npc;

  let yOffset = headStack.get(actor) || 0;
let keyLabel = 'T';
if (party.includes(actor)) {
  keyLabel = (Number.isFinite(p.keyNum) && p.keyNum > 0) ? String(p.keyNum) : null;
}

  const used = drawSpeechBubbleForNpc(actor, p.prompt, keyLabel, yOffset);

  headStack.set(actor, yOffset + used);
}


  drawForegroundObjects();

  ctx.restore(); // end world zoom render

  // ===== Screen-space overlays (NOT affected by zoom) =====
  // ===== Screen-space overlays (NOT affected by zoom) =====
  drawAreaBanner();
  drawSectionBanner();

  drawTimeOfDayWidget();

  drawItemFoundToast();
  drawFadeOverlay();



  requestAnimationFrame(gameLoop);

}

