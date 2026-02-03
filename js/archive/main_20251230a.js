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

// UI flags
let showNames = false; //don't show character names by default

// Physics baselines (we scale these with character scale so jumping feels consistent)
const BASE_GRAVITY = 0.35;
const BASE_JUMP_FORCE = -7.5;
let gravity = BASE_GRAVITY;
const friction = 0.90;

//CHARACTER CONSTANTS
// Interaction radii (multipliers of player visible width)
let INTERACTION = {
  npc: 1.8,
  exit: 1.0
};

const FOLLOW_ACCEL_TIME = 2.0; // seconds to reach full speed
const FOLLOW_DECEL_TIME = 2.0; // seconds to come to rest



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
    cameraX = Math.max(
      0,
      Math.min(cameraX, Math.max(0, currentArea.lengthPx - WIDTH))
    );
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
let cameraX = 0; //WHERE DOES THE CAMERA START AT THE BEGINNING OF THE GAME?
let lastDirection = 1; //Which direction the player character was facing the last time they moved

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
const FADE = { active:false, phase:'idle', t:0, durOut:0.22, durIn:0.22, onMid:null };

// Exits (absolute world-space list for current area)
let worldExits = [];
let currentExitUp = null;
let currentExitDown = null;



//CHARACTERS
const BASE_CHAR_W = 163;
const BASE_CHAR_H = 300;

const player = {
  worldX: 40,
  y: 0,
  w: BASE_CHAR_W * SCALE.characters,
  h: BASE_CHAR_H * SCALE.characters,
  vx: 0,
  vy: 0,
  jumpForce: -7.5,
  onGround: false,
  name: 'Dace'
};


// REGISTRY OF NPCs AND THEIR STATES
// name -> { inParty:boolean, area:string|null, worldX:number|null }
const npcRegistry = {};
function ensureNpcRecord(name) {
  if (!npcRegistry[name]) {
    npcRegistry[name] = { inParty:false, area:null, worldX:null, affection:0, alignment:0 };
  }
  return npcRegistry[name];
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
let npcNameList = [];

// NPCs & party (same as before)
const npcs = [];
const party = [];

function isNpcInPartyByName(name) {
  const n = String(name || '').toLowerCase();
  return party.some(p => String(p.name || '').toLowerCase() === n);
}
function isNpcInWorldByName(name) {
  const n = String(name || '').toLowerCase();
  return npcs.some(p => String(p.name || '').toLowerCase() === n);
}

function npcInteractionDistance() {
  return player.w * INTERACTION.npc;
}

function exitInteractionDistance() {
  return player.w * INTERACTION.exit;
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



//DIALOGS AND CONVERSATIONS
// Dialog storage. Will be filled on demand.
const dialogs = {};
// Conversation state
let inConversation = false;
let currentNpc = null;
let currentDialog = null;
let currentPhraseId = null;
let activeDialogPrompts = [];
let firedDialogTriggers = new Set();
let dialogOptionsMap = null;
let inViewMode = false;
// Helper to load a dialog JSON for a given NPC name. Uses fetch and caches the result.
async function loadDialogFor(name) {
  name = name.toLowerCase();
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

function evaluateDialogTriggers() {
  if (!dialogs || typeof dialogs !== 'object') return;

  activeDialogPrompts.length = 0;

  if (!currentArea) return;

  const candidates = [];

  // NPCs physically in the current area
  if (currentArea.npcs) {
    for (const npc of currentArea.npcs) {
      candidates.push(npc);
    }
  }

  // Party members (avoid duplicates)
  for (const p of party) {
    if (!candidates.includes(p)) {
      candidates.push(p);
    }
  }

  for (const npc of candidates) {
    const dialog = dialogs[npc.name.toLowerCase()];
    if (!dialog || !dialog.triggers) continue;

    for (const [trigKey, trigger] of Object.entries(dialog.triggers)) {
      const triggerId = `${npc.name.toLowerCase()}:${trigKey}`;
      if (firedDialogTriggers.has(triggerId)) continue;


      const w = trigger.when || {};

      if (w.area && w.area !== currentAreaName) continue;

      if (w.sections && currentArea.sections) {
        const idx = Math.floor(player.worldX / currentArea.sectionTileWidth);
        const sec = currentArea.sections[idx]?.name;
        if (!w.sections.includes(sec)) continue;
      }

      if (typeof w.party === 'boolean') {
        const inParty = isNpcInPartyByName(npc.name);
        if (w.party !== inParty) continue;
      }

      activeDialogPrompts.push({
        npc,
        triggerKey: trigKey,
        prompt: trigger.prompt,
        start: trigger.start
      });

    }
  }
}




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
  const endX = cameraX + WIDTH;

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

// ===== Object images (assets/objects/*) =====
const objectImages = new Map(); // name -> {img, ready, w, h}
function loadObjectImage(name) {
  if (!name) return null;
  const key = String(name).trim();
  if (objectImages.has(key)) return objectImages.get(key);
  const img = new Image();
  const entry = { img, ready: false, w: 0, h: 0 };
  img.onload  = () => { entry.ready = true; entry.w = img.width; entry.h = img.height; };
  img.onerror = () => console.warn('Failed to load object image:', key);
  const src = key.includes('.') ? key : `${key}.png`;
  img.src = `assets/objects/${src}`;
  objectImages.set(key, entry);
  return entry;
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

  // --- NEW: rescale sprinkled positions to preserve even distribution
  const scale = (oldLen > 0) ? (newLen / oldLen) : 1;
  if (scale && isFinite(scale) && scale !== 1) {
    function scaleArrayPositions(arr) {
      if (!arr) return;
      for (const o of arr) {
        if (o && typeof o.worldX === 'number') {
          o.worldX *= scale;
        }
      }
    }
    scaleArrayPositions(currentArea.backObjects);  // your background objects
    scaleArrayPositions(currentArea.foreObjects);  // your foreground objects
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
    const dir = (ex.direction || '').toLowerCase(); // "up"/"down"
    const pos = ex.Position ?? ex.position ?? 0;
    arr.push({ id, direction: dir, posLocal: Number(pos) || 0, target: ex.targetexit || null });
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

    if (rec.area === null) { rec.area = areaName; rec.worldX = atX; rec.affection ||= 0; rec.alignment ||= 0; }
    spawnNpc(name, atX);
    // NEW: apply saved stats onto the instance
    const spawned = npcs.find(n => n.name === name);
    if (spawned) { spawned.affection = rec.affection || 0; spawned.alignment = rec.alignment || 0; }
  }
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
    if (spawned) { spawned.affection = rec.affection || 0; spawned.alignment = rec.alignment || 0; }
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
          return {
            name: String(it.name || '').trim(),
            height: Number(it.height) || defaultH,
            density: (it.density != null && it.density !== '') ? Number(it.density) : undefined
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

    const secDistant = parseList(sdef.distantbackrounds || sdef.distantbackgrounds);
    const secBacks   = parseList(sdef.backgrounds);

    const secBackObjs = normalizeImageItems(sdef.backobjects || [], defaultBackObjH);
    const secForeObjs = normalizeImageItems(sdef.foreobjects || [], defaultForeObjH);

    return {
      distantList: (secDistant.length ? secDistant : areaDistant),
      backgroundList: (secBacks.length ? secBacks : areaBacks),
      backObjList: (secBackObjs.length ? secBackObjs : areaBackObjs),
      foreObjList: (secForeObjs.length ? secForeObjs : areaForeObjs)
    };
  }


  const positioned = new Map();
  for (const [secName, secDef] of Object.entries(definedSections)) {
    const pos = Number(secDef.position || 0);
    const exits = normalizeExits(secDef.exits);
    positioned.set(secName, { name: secName, pos, groundKey: secDef.groundimage || defaultGroundKey, exits, raw: secDef });
  }

  // Prepare flat sections array (index 0..sectionCount-1)
  const sections = Array(sectionCount).fill(null).map(() => ({
    name: null,
    groundKey: defaultGroundKey,
    exits: []
  }));

  // Place those with a fixed position (1-based)
  for (const sec of positioned.values()) {
    if (sec.pos > 0 && sec.pos <= sectionCount) {
      sections[sec.pos - 1] = {
        name: sec.name,
        groundKey: sec.groundKey || defaultGroundKey,
        exits: sec.exits || []
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
        exits: sec.exits || []
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

  // These are only used for "density-free" items as a baseline
  const DENSITY_BACK = 420;
  const DENSITY_FORE = 520;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const startX = i * sectionTileWidth;
    const endX = startX + sectionTileWidth;

    const { backObjList, foreObjList } = getSectionLists(sec.name);

    // Split each list into "density-defined" vs "density-free"
    const backWithDensity = (backObjList || []).filter(o => o && o.density > 0);
    const backNoDensity   = (backObjList || []).filter(o => !o || !o.density);
    const foreWithDensity = (foreObjList || []).filter(o => o && o.density > 0);
    const foreNoDensity   = (foreObjList || []).filter(o => !o || !o.density);

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
        const x = foreSpawnMinX + Math.random() * (foreSpawnMaxX - foreSpawnMinX);
        foreObjects.push({
          worldX: x,
          key: obj.name,
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
        const x = foreSpawnMinX + Math.random() * (foreSpawnMaxX - foreSpawnMinX);
        foreObjects.push({
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
    raw: def,
    exitsWorld,
     skyEntry,
    distantEntries,
    backgroundEntries,
    backObjects,
    foreObjects
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
  const area = buildAreaFromDefinition(areaName);
  if (!area) return;
  currentAreaName = areaName;
  firedDialogTriggers.clear();
  currentArea = area;
  worldMin = 0;
  worldMax = currentArea.lengthPx;
  worldExits = currentArea.exitsWorld;
  placePlayerAtAreaEdge(currentArea, spawnEdge);

  populateNPCsForCurrentArea();     // spawn per persistence
  showAreaBanner(areaName);         // show name of area when entering
  beginLoadingForCurrentArea(`Loading ${areaName}...`);
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
    snapshotNPCsToRegistry();   // NEW: persist before swapping areas
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

  startFadeTransfer(() => {
    snapshotNPCsToRegistry();   // NEW: persist before warp
    buildAndEnterArea(dest.areaName, 'left'); // target area built
    player.worldX = Math.max(2, Math.min(currentArea.lengthPx - player.w - 2, dest.worldX || 2));
    player.vx = 0; player.vy = 0; player.onGround = true; player.y = groundY - player.h;
    cameraX = Math.max(0, Math.min(player.worldX - canvas.width * 0.5, Math.max(0, currentArea.lengthPx - canvas.width)));

    // Party comes along + nudge behind (arriving from left edge is a safe default here)
    carryPartyWithPlayer(prevX, player.worldX);
    nudgePartyBehind('left');
  });
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

  const details = npcDetails && npcDetails[name] ? npcDetails[name] : null;
  const minAffection = details ? (details.minaffection || 0) : 0;
  const minAlignment = details ? (details.minalignment || 0) : 0;

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
    alignment: 0, affection: 0,
    minAlignmentRecruit: minAlignment,
    minAffectionRecruit: minAffection,
    lastMoveTime: performance.now(),
    hasEverMoved: false,
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
  loadDialogFor(name.toLowerCase());
}

function snapshotNPCsToRegistry() {
  // world NPCs
  for (const n of npcs) {
    const rec = ensureNpcRecord(n.name);
    rec.inParty = false;
    rec.area = currentAreaName;
    rec.worldX = Math.max(2, Math.min(currentArea.lengthPx - n.w - 2, n.worldX));
    rec.alignment = n.alignment || 0;
    rec.affection = n.affection || 0;
  }
  // party NPCs
  for (const p of party) {
    const rec = ensureNpcRecord(p.name);
    rec.inParty = true;
    rec.area = null;
    rec.worldX = null;
    rec.alignment = p.alignment || 0;
    rec.affection = p.affection || 0;
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
  npcNameList = Object.keys(npcDetails || {});



  // Preload NPC sprites
  npcNameList.forEach((name) => {
  const base = name.toLowerCase();

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
});


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
  promptEl.style.display = 'none';

  // show UI immediately
  conversationOverlay.style.display = 'block';
  dialogBox.textContent = 'Loading...';
  optionsBox.innerHTML = '';
  conversationPortrait.src = `assets/portraits/character_portrait_${currentNpc.name.toLowerCase()}_neutral.png`;

  const data = await loadDialogFor(npc.name);
  currentDialog = data;
  currentPhraseId = data.start;
  loadPhrase(currentPhraseId);
}

function loadPhrase(id) {
  if (!inConversation || !currentDialog) return;
  const phrase = currentDialog.phrases[id];
  currentPhraseId = id;
  if (!phrase) { endConversation(); return; }
  let reaction = phrase.reaction || 'neutral';
  let portraitPath = `assets/portraits/character_portrait_${currentNpc.name.toLowerCase()}_${reaction}.png`;
  const img = new Image();
  img.onload = () => { conversationPortrait.src = portraitPath; };
  img.onerror = () => {
    conversationPortrait.src = `assets/portraits/character_portrait_${currentNpc.name.toLowerCase()}_neutral.png`;
  };
  img.src = portraitPath;

  dialogBox.textContent = phrase.text;
  optionsBox.innerHTML = '';
  dialogOptionsMap = null;

  if (phrase.options) {
    dialogOptionsMap = {};
    let idx = 1;
    for (const key in phrase.options) {
      const opt = phrase.options[key];
      const optDiv = document.createElement('div');
      optDiv.textContent = `${idx}. ${opt.text}`;
      optionsBox.appendChild(optDiv);
      dialogOptionsMap[idx] = opt.next;
      idx++;
    }
  } else {
    const p = document.createElement('div');
    p.textContent = 'Press any key to continue...';
    optionsBox.appendChild(p);
  }
}

function startTriggeredDialog(index) {
  const p = activeDialogPrompts[index];
  const triggerId = `${p.npc.name.toLowerCase()}:${p.triggerKey}`;
  firedDialogTriggers.add(triggerId);
  //firedDialogTriggers.add(triggerKey);

  if (!p) return;

  inConversation = true;
  currentNpc = p.npc;

  promptEl.style.display = 'none';
  document.getElementById('dialogPromptContainer').innerHTML = '';

  // Show UI immediately (mirror startConversation)
  conversationOverlay.style.display = 'block';
  dialogBox.textContent = 'Loading...';
  optionsBox.innerHTML = '';
  conversationPortrait.src = `assets/portraits/character_portrait_${currentNpc.name.toLowerCase()}_neutral.png`;

  const data = dialogs[currentNpc.name.toLowerCase()];
  if (!data) { endConversation(); return; }

  currentDialog = data;
  currentPhraseId = p.start || data.start;
  loadPhrase(currentPhraseId);
}

function endConversation() {
  const npc = currentNpc;
  const wasViewMode = inViewMode;

  inConversation = false;
  currentNpc = null;
  currentDialog = null;
  currentPhraseId = null;
  dialogOptionsMap = null;
  inViewMode = false;
  conversationOverlay.style.display = 'none';

  // Auto-recruit after a normal conversation (not view mode)
  if (npc && !wasViewMode) {
    recruitNpcToParty(npc);
  }
}

function recruitNpcToParty(npc) {
  if (!npc) return;

  // Already in party? bail
  if (party.includes(npc)) return;

  // Party full? (same limit as R-key)
  if (party.length >= 3) return;

  // Check min alignment / affection thresholds
  if (!(
    (npc.affection >= npc.minAffectionRecruit) ||
    (npc.alignment >= npc.minAlignmentRecruit)
  )) {
    return;
  }

  // Same behavior as existing R-recruit logic
  npc.offsetX = 24 + party.length * 24;

  const idx = npcs.indexOf(npc);
  if (idx >= 0) npcs.splice(idx, 1);

  npc.isChasing = false;
  npc.followSpeed = 0;
  party.push(npc);

  // Remove any other world copies of this NPC by name
  for (let i = npcs.length - 1; i >= 0; i--) {
    if (String(npcs[i].name || '').toLowerCase() === String(npc.name || '').toLowerCase()) {
      npcs.splice(i, 1);
    }
  }

  const rec = ensureNpcRecord(npc.name);
  rec.inParty = true;
  rec.area = null;
  rec.worldX = null;
  rec.alignment = npc.alignment;
  rec.affection = npc.affection;
}


// ===== Key handling =====
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (loading) return;

  // Triggered dialog prompts: Digit1..Digit9 (no shift, and only when not already in conversation)
  if (!inConversation && !e.shiftKey && e.code.startsWith('Digit')) {
    const n = parseInt(e.code.replace('Digit', ''), 10);
    const idx = n - 1;
    if (idx >= 0 && idx < activeDialogPrompts.length) {
      startTriggeredDialog(idx);
      return;
    }
  }
  

  if (inConversation) {
    if (e.code === 'KeyX') { endConversation(); return; }
    if (dialogOptionsMap && Object.keys(dialogOptionsMap).length > 0) {
      if (e.code.startsWith('Digit')) {
        const idx = parseInt(e.code.replace('Digit', ''));
        if (dialogOptionsMap[idx] !== undefined) {
          const nextId = dialogOptionsMap[idx];
          // apply effects
          const currentPhrase = currentDialog && currentPhraseId ? currentDialog.phrases[currentPhraseId] : null;
          if (currentPhrase && currentPhrase.options) {
            let optionIndex = 1;
            for (const key in currentPhrase.options) {
              const opt = currentPhrase.options[key];
              if (optionIndex === idx) {
                if (currentNpc) {
                  const alignEff = opt.alignmentEffect || 0;
                  const affEff = opt.affectionEffect || 0;
                  currentNpc.alignment += alignEff;
                  currentNpc.affection += affEff;

                  // NEW: persist to registry immediately
                  const rec = ensureNpcRecord(currentNpc.name);
                  rec.alignment = currentNpc.alignment;
                  rec.affection = currentNpc.affection;
                }
                break;
              }
              optionIndex++;
            }
          }
          if (nextId) loadPhrase(nextId); else endConversation();
        }
        return;
      }
    } else {
      if (inViewMode) { endConversation(); return; }
      else if (currentDialog && currentPhraseId) {
        const phrase = currentDialog.phrases[currentPhraseId];
        if (phrase && phrase.next) loadPhrase(phrase.next); else endConversation();
      } else endConversation();
    }
    return;
  }

  // Not in conversation: game controls
  if (e.code === 'KeyT' && currentTrigger) { startConversation(currentTrigger); return; }

  if (e.code === 'KeyV' && currentTrigger) {
    inViewMode = true;
    inConversation = true;
    currentNpc = currentTrigger;
    promptEl.style.display = 'none';
    conversationPortrait.src = `assets/portraits/character_portrait_${currentNpc.name.toLowerCase()}_neutral.png`;
    dialogBox.textContent =
      `Name: ${currentNpc.name}\nAlignment: ${currentNpc.alignment}\nAffection: ${currentNpc.affection}\nMin Alignment to Recruit: ${currentNpc.minAlignmentRecruit}\nMin Affection to Recruit: ${currentNpc.minAffectionRecruit}`;
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

  if (e.shiftKey) {
    let removeIndex = null;
    if (e.code === 'Digit1') removeIndex = 0;
    else if (e.code === 'Digit2') removeIndex = 1;
    else if (e.code === 'Digit3') removeIndex = 2;
    if (removeIndex !== null && removeIndex < party.length) {
      const removed = party.splice(removeIndex, 1)[0];

      // Reset follow state → enter coast-to-stop
      removed.isChasing = false;
      removed.followSpeed = removed.followSpeed || Math.abs(removed.vx || 0);
      removed.vx = removed.vx || 0;

      // Position
      removed.y = groundY - removed.h - 8;
      if (removed.offsetX !== undefined) delete removed.offsetX;

      // Ensure animation logic works
      removed.lastMoveTime = performance.now();
      removed.hasEverMoved = true;

      npcs.push(removed);

      const rec = ensureNpcRecord(removed.name);
      rec.inParty = false;
      rec.area = currentAreaName;
      rec.worldX = Math.max(2, Math.min(currentArea.lengthPx - removed.w - 2, removed.worldX));
      rec.alignment = removed.alignment;
      rec.affection = removed.affection;

      if (currentTrigger === removed) {
        currentTrigger = null;
        promptEl.style.display = 'none';
      }
    }
  }

  // Exit usage keys (when near exits)
  if ((e.code === 'ArrowUp' || e.code === 'KeyW') && currentExitUp) {
    tryUseExit(currentExitUp);
  }
  if ((e.code === 'ArrowDown' || e.code === 'KeyS') && currentExitDown) {
    tryUseExit(currentExitDown);
  }

});

window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function updateCamera() {
  const playerCenterX = player.worldX + player.w * 0.5;
  const screenCenterX = WIDTH * 0.5;
  const deadZone = WIDTH * 0.15;

  const minX = cameraX + (screenCenterX - deadZone);
  const maxX = cameraX + (screenCenterX + deadZone);

  if (playerCenterX < minX) {
    cameraX = playerCenterX - (screenCenterX - deadZone);
  } else if (playerCenterX > maxX) {
    cameraX = playerCenterX - (screenCenterX + deadZone);
  }

  cameraX = Math.max(0, Math.min(cameraX, Math.max(0, currentArea.lengthPx - WIDTH)));
}


// ===== Update / Draw =====
function update(dt) {


  if (inConversation) return;
  if (!currentArea) return;
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
      loading = false;
    } else {
      return; // block update + input
    }
  }


  // Movement
  if (!loading) {
    const moveScale = SCALE.characters;

    if (keys['ArrowLeft'] || keys['KeyA']) {
      player.vx -= movementSpeed() * dt;
    }
    if (keys['ArrowRight'] || keys['KeyD']) {
      player.vx += movementSpeed() * dt;
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

  player.worldX += player.vx * dt;
  player.y += player.vy * dt;

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
  for (let i = 0; i < party.length; i++) {
    const m = party[i];
    const target = (i === 0) ? player : party[i - 1];

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
    m.worldX += m.vx * dt;
    m.y += m.vy * dt;

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
    

  updateCamera();

  
  // --- Pre-warm adjacent areas when approaching edges ---
  const EDGE_WARM_DISTANCE = player.w * 2;

  if (player.worldX < EDGE_WARM_DISTANCE && currentArea.leftarea) {
    warmAreaAssets(currentArea.leftarea);
  }

  if (
    player.worldX + player.w >
    currentArea.lengthPx - EDGE_WARM_DISTANCE &&
    currentArea.rightarea
  ) {
    warmAreaAssets(currentArea.rightarea);
  }


  // Interaction: nearest NPC
  let closestDist = Infinity;
  let trigger = null;
  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    const dx = Math.abs((player.worldX + player.w * 0.5) - (npc.worldX + npc.w * 0.5));
    const radius = npc.interactionRadius || npcInteractionDistance();
    if (dx < radius && dx < closestDist) {
      trigger = npc;
      closestDist = dx;
    }
  }
  currentTrigger = trigger;

  // Exit trigger (track UP and DOWN separately so both can exist at same worldX)
  // Keep currentExitUp/Down stable while the player remains in range.
  let closestUpDx = Infinity;
  let closestDownDx = Infinity;

  let nextExitUp = null;
  let nextExitDown = null;

  for (const ex of worldExits) {
    const dx = Math.abs((player.worldX + player.w * 0.5) - ex.worldX);
    if (dx > exitInteractionDistance()) continue;

    // --- NEW: pre-warm destination area ---
    if (ex.target) {
      const target = parseTargetExitString(ex.target);
      if (target && target.area) {
        warmAreaAssets(target.area);
      }
    }

    if (ex.direction === 'up') {
      if (dx < closestUpDx) { closestUpDx = dx; nextExitUp = ex; }
    } else if (ex.direction === 'down') {
      if (dx < closestDownDx) { closestDownDx = dx; nextExitDown = ex; }
    }
  }

  // Only update/clear AFTER the scan.
  // This prevents the key handler seeing null mid-frame.
  currentExitUp = nextExitUp;
  currentExitDown = nextExitDown;



  evaluateDialogTriggers();


  // Prompt text
  if (currentTrigger || currentExitUp || currentExitDown) {
    let text = '';
    if (currentTrigger) {
      text += 'T: Talk  ';
      if (party.length < 3) {
        const npc = currentTrigger;
        const canRecruit = (npc.affection >= npc.minAffectionRecruit) || (npc.alignment >= npc.minAlignmentRecruit);
        if (canRecruit) text += 'R: Recruit  ';
      }
      text += 'V: View  ';
    }
    if (currentExitUp) text += '↑: Use Exit  ';
    if (currentExitDown) text += '↓: Use Exit  ';
    promptEl.textContent = text.trim();
    promptEl.style.display = 'block';
  } else {
    promptEl.style.display = 'none';
  }

  const dialogPromptContainer = document.getElementById('dialogPromptContainer');
  dialogPromptContainer.innerHTML = '';

  activeDialogPrompts.forEach((p, i) => {
    // Only show up to 9 prompts (Digit1..Digit9)
    if (i >= 9) return;

    const el = document.createElement('div');
    el.className = 'dialogPrompt';

    const img = document.createElement('img');
    img.src = `assets/portraits/character_portrait_${p.npc.name.toLowerCase()}_neutral.png`;

    const txt = document.createElement('div');
    txt.className = 'dialogPromptText';
    txt.textContent = p.prompt;

    const key = document.createElement('div');
    key.className = 'dialogPromptKey';
    key.textContent = `[${i + 1}]`;

    el.appendChild(img);
    el.appendChild(txt);
    el.appendChild(key);

    el.onclick = () => startTriggeredDialog(i);

    dialogPromptContainer.appendChild(el);
  });

  // // Party follow (unchanged)
  // const baseDistance = player.w * 1.5;
  // for (let i = 0; i < party.length; i++) {
  //   const member = party[i];
  //   if (member.isChasing === undefined) {
  //     member.isChasing = false;
  //   }
  //   if (member.followSpeed === undefined) {
  //     member.followSpeed = 0;
  //   }

  //   const prevX = member.worldX;

  //   const leaderX = (i === 0)
  //     ? player.worldX
  //     : party[i - 1].worldX;

  //   const dx = leaderX - member.worldX;
  //   const dist = Math.abs(dx);

  //   const startDist = followStartDistance(i);
  //   const stopDist  = followStopDistance(i);

  //   // Decide whether to start or stop chasing
  //   if (!member.isChasing && dist > startDist) {
  //     member.isChasing = true;
  //   }
  //   else if (member.isChasing && dist < stopDist) {
  //     member.isChasing = false;
  //   }

  //   // Horizontal follow — eased speed, capped to player's current speed
  //   if (member.isChasing) {
  //     // const targetSpeed = member.isChasing
  //     //   ? Math.min(maxMovementSpeed(), Math.abs(player.vx))
  //     //   : 0;
      
  //     const targetSpeed = Math.min(maxMovementSpeed(), partyChaseSpeed());


  //     // Ease toward player's current speed
  //     member.followSpeed += (targetSpeed - member.followSpeed) * (PARTY_SPEED_EASE * dt);

  //     member.worldX += Math.sign(dx) * Math.min(member.followSpeed * dt, dist);
  //   } else {
  //     // Ease speed down to zero when not chasing
  //     member.followSpeed *= (1 - PARTY_SPEED_EASE * dt);
  //   }


  //   // Vertical follow
  //   const targetY = groundLineY - member.h - 2 * (i + 1);
  //   const dy = targetY - member.y;
  //   if (Math.abs(dy) > 0.5) {
  //     member.y += Math.sign(dy) * Math.min(Math.abs(dy) * 0.1, 2);
  //   } else {
  //     member.y = targetY;
  //   }

  //   // Facing + velocity (AFTER movement)
  //   member.vx = member.worldX - prevX;
  //   if (member.vx !== 0) {
  //     member.facing = Math.sign(member.vx);
  //     member.hasEverMoved = true;
  //     member.lastMoveTime = performance.now();
  //   }

  // }

  // //--- World NPC deceleration (prevents permanent running) ---
  // for (const npc of npcs) {
  //   // NPCs only coast if they are not actively moving via scripts
  //   if (!npc.isChasing && Math.abs(npc.vx || 0) > 0) {
  //     easeNpcToStop(npc);
  //   }
  // }


}

function drawPlayer() {
  const sx = player.worldX - cameraX;
  if (sx + player.w < -50 || sx - player.w > WIDTH + 50) return;

  const x = Math.floor(sx);
  const y = Math.floor(player.y);

  const sprites = playerSprites;

  // Lazy-load extra player sheets (same pattern as NPCs)
  if (sprites && sprites.ready && !sprites.requestedExtras) {
    sprites.requestedExtras = true;

    const load = (key, path) => {
      const img = new Image();
      img.src = path;
      img.onload = () => { sprites[key] = img; };
      img.onerror = () => {};
    };

    load('stoppedLeft', 'assets/sprites/player/dace_stopped_left.png');

    // Future files — safe to add later without code changes
    load('runLeft', 'assets/sprites/player/dace_run_left.png');
    load('runRight', 'assets/sprites/player/dace_run_right.png');
    load('stoppedRight', 'assets/sprites/player/dace_stopped_right.png');
    load('stoppedForward', 'assets/sprites/player/dace_stopped_forward.png');
  }

  if (!sprites || !sprites.ready) return;

  const moving = Math.abs(player.vx) > 0.1;
  const now = performance.now();
  const stoppedLongEnough = now - (player.lastMoveTime || 0) > 10000;

  let sheet = sprites.idle;
  let flip = false;

  if (moving) {
    if (lastDirection < 0) {
      if (sprites.runLeft) sheet = sprites.runLeft;
      else if (sprites.runRight) { sheet = sprites.runRight; flip = true; }
    } else {
      if (sprites.runRight) sheet = sprites.runRight;
      else if (sprites.runLeft) { sheet = sprites.runLeft; flip = true; }
    }
  } else {
    if (!player.hasEverMoved || stoppedLongEnough) {
      if (sprites.stoppedForward) sheet = sprites.stoppedForward;
    } else {
      if (lastDirection < 0) {
        if (sprites.stoppedLeft) sheet = sprites.stoppedLeft;
        else if (sprites.stoppedRight) { sheet = sprites.stoppedRight; flip = true; }
      } else {
        if (sprites.stoppedRight) sheet = sprites.stoppedRight;
        else if (sprites.stoppedLeft) { sheet = sprites.stoppedLeft; flip = true; }
      }
    }
  }

  // Static image fallback (single-frame)
  if (sheet === sprites.idle || !sheet.width) {
    if (flip) {
      ctx.save(); ctx.scale(-1, 1);
      ctx.drawImage(sheet, -(x + player.w), y, player.w, player.h);
      ctx.restore();
    } else {
      const scale = player.h / sheet.height;
      const drawH = player.h;
      const drawW = Math.floor(sheet.width * scale);
      const drawX = Math.floor(x + (player.w - drawW) / 2);
      const drawY = Math.floor(y);

      ctx.drawImage(sheet, drawX, drawY, drawW, drawH);

    }
    return;
  }

  // Animated sheet (same logic as NPCs)
  const FRAME_H = sheet.height;
  const FRAME_W = FRAME_H;
  const FRAMES = Math.max(1, Math.floor(sheet.width / FRAME_W));

  player.animTimer = (player.animTimer || 0) + 1;
  const delay = animFrameDelayFromSpeed(player.vx);

  if (player.animTimer >= delay) {
    player.animFrame = ((player.animFrame || 0) + 1) % FRAMES;
    player.animTimer = 0;
  }


  const scale = player.h / FRAME_H;
  const drawH = player.h;
  const drawW = Math.floor(FRAME_W * scale);
  const drawX = Math.floor(x + (player.w - drawW) / 2);
  const drawY = y;

  ctx.save();
  if (flip) {
    ctx.translate(drawX + drawW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      sheet,
      player.animFrame * FRAME_W, 0, FRAME_W, FRAME_H,
      0, drawY, drawW, drawH
    );
  } else {
    ctx.drawImage(
      sheet,
      player.animFrame * FRAME_W, 0, FRAME_W, FRAME_H,
      drawX, drawY, drawW, drawH
    );
  }
  ctx.restore();

  // Name label
  if (showNames && player.name) {
    ctx.save();
    ctx.font = '60px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;

    const spd = Math.abs(player.vx || 0).toFixed(1);
    const label = `${player.name}  v=${spd}`;

    ctx.strokeText(label, x + player.w / 2, y - 2);
    ctx.fillText(label, x + player.w / 2, y - 2);
    ctx.restore();
  }

}


function drawCharacter(char) {
  const sx = char.worldX - cameraX;
  if (sx + char.w < -50 || sx - char.w > WIDTH + 50) return;

  const x = Math.floor(sx);
  const y = Math.floor(char.y);

  const sprites = npcSprites[char.name];

  if (sprites && sprites.ready && !sprites.requestedExtras) {
    sprites.requestedExtras = true;

    const base = String(char.name || '').toLowerCase();

    const load = (key, path) => {
      const img = new Image();
      img.src = path;
      img.onload = () => { sprites[key] = img; };
      img.onerror = () => {};
    };

    load('runLeft', `assets/sprites/npcs/${base}_run_left.png`);
    load('runRight', `assets/sprites/npcs/${base}_run_right.png`);
    load('stoppedLeft', `assets/sprites/npcs/${base}_stopped_left.png`);
    load('stoppedRight', `assets/sprites/npcs/${base}_stopped_right.png`);
    load('stoppedForward', `assets/sprites/npcs/${base}_stopped_forward.png`);
  }


  if (sprites && sprites.ready) {
    const moving = Math.abs(char.vx || 0) > 0.1;
    const now = performance.now();
    const stoppedLongEnough = now - char.lastMoveTime > 10000;

    let sheet = sprites.idle;
    let flip = false;

    if (Math.abs(char.vx) > 0.1) {
      // RUNNING
      if (char.facing < 0) {
        if (sprites.runLeft) sheet = sprites.runLeft;
        else if (sprites.runRight) { sheet = sprites.runRight; flip = true; }
      } else {
        if (sprites.runRight) sheet = sprites.runRight;
        else if (sprites.runLeft) { sheet = sprites.runLeft; flip = true; }
      }
    } else {
      // STOPPED
      if (!char.hasEverMoved || stoppedLongEnough) {
        if (sprites.stoppedForward) {
          sheet = sprites.stoppedForward;
        }
      } else {
        if (char.facing < 0) {
          if (sprites.stoppedLeft) sheet = sprites.stoppedLeft;
          else if (sprites.stoppedRight) { sheet = sprites.stoppedRight; flip = true; }
        } else {
          if (sprites.stoppedRight) sheet = sprites.stoppedRight;
          else if (sprites.stoppedLeft) { sheet = sprites.stoppedLeft; flip = true; }
        }
      }
    }

    if (sheet !== sprites.idle) {
      const FRAME_H = sheet.height;
      const FRAME_W = FRAME_H;
      const FRAMES = FRAME_H > 0 ? Math.floor(sheet.width / FRAME_W) : 1;


      char.animTimer++;
      const delay = animFrameDelayFromSpeed(char.vx);

      if (char.animTimer >= delay) {
        char.animFrame = (char.animFrame + 1) % FRAMES;
        char.animTimer = 0;
      }



      // Scale animation by HEIGHT only; width follows proportionally
      const scale = char.h / FRAME_H;
      const drawH = char.h;
      const drawW = Math.floor(FRAME_W * scale);

      // Center animation horizontally over the logical body
      const drawX = Math.floor(x + (char.w - drawW) / 2);
      const drawY = Math.floor(y);

      ctx.save();

      if (flip) {
        ctx.translate(drawX + drawW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(
          sheet,
          char.animFrame * FRAME_W, 0, FRAME_W, FRAME_H,
          0, drawY, drawW, drawH
        );
      } else {
        ctx.drawImage(
          sheet,
          char.animFrame * FRAME_W, 0, FRAME_W, FRAME_H,
          drawX, drawY, drawW, drawH
        );
      }

      ctx.restore();

    } else {
      // maintain aspect ratio for single-frame sprites
      const scale = char.h / sheet.height;
      const drawH = char.h;
      const drawW = Math.floor(sheet.width * scale);

      const drawX = Math.floor(x + (char.w - drawW) / 2);
      const drawY = Math.floor(y);

      ctx.drawImage(sheet, drawX, drawY, drawW, drawH);
    }

  } else {
    // fallback block sprite
    const p = char.palette || {};
    ctx.fillStyle = p.hat || '#444';
    ctx.fillRect(x, y, char.w, char.h);
  }

  if (showNames && char.name) {
    ctx.save();
    ctx.font = '60px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;

    const align = char.alignment ?? 0;
    const affect = char.affection ?? 0;

    const label = `${char.name}  [A=${align}  F=${affect}]`;

    ctx.strokeText(label, x + char.w / 2, y - 2);
    ctx.fillText(label, x + char.w / 2, y - 2);
    ctx.restore();
  }


}


function drawCharacters() {
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

  // Tiles a strip of images across each section, but each image is scaled to full screen height.
  // Maintains aspect ratio; repeats horizontally as many times as needed to cover the section.
  // function drawStripFullHeight(entries, parallax) {
  //   if (!entries || entries.length === 0) return;

  //   const H = HEIGHT;

  //   for (let i = 0; i < entries.length; i++) {
  //     let entry = entries[i];
  //     if (!entry) continue;

  //     // Lazy-load if this slot is still a string key
  //     if (typeof entry === 'string') {
  //       entry = entries[i] = loadTileImage(entry);
  //     }

  //     if (!entry || !entry.ready) continue;

  //     // Scale to full canvas height; maintain aspect ratio
  //     const scaledW = Math.floor(H * (entry.w / Math.max(1, entry.h)));
  //     if (scaledW <= 0) continue;

  //     // Section world span
  //     const startWorldX = i * currentArea.sectionTileWidth;
  //     const endWorldX = startWorldX + currentArea.sectionTileWidth;

  //     // Tile the image horizontally to cover the section span
  //     // Start tiling from the first tile that could appear on screen (with parallax)
  //     // but we’ll simply iterate from section start to end using scaledW steps.
  //     let x = startWorldX;
  //     // If the image is wider than the section, we still draw it once; otherwise repeat
  //     while (x < endWorldX) {
  //       const screenX = Math.floor(x - cameraX * parallax);
  //       ctx.drawImage(entry.img, screenX, 0, scaledW, H);
  //       // Advance by full image width in world units at this layer
  //       x += scaledW;
  //       if (scaledW > currentArea.sectionTileWidth) {
  //         // Avoid infinite loop when image is wider than section: one draw is enough
  //         break;
  //       }
  //     }
  //   }
  // }

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

  // (Characters & player are drawn in other functions)
}

function drawBackgroundObjects() {
  if (!currentArea || !currentArea.backObjects || currentArea.backObjects.length === 0) return;

  for (const obj of currentArea.backObjects) {
    if (!obj.entry && obj.key) obj.entry = loadObjectImage(obj.key);
    const entry = obj.entry;
    if (!entry || !entry.ready) continue;

    const sx = worldToScreenX(obj.worldX, PARALLAX.backObjects);

    // Assigned height (screen px), maintain aspect
    const targetH = Math.floor(
      (obj.heightPx || (TILE_DRAW_HEIGHT() * 0.55)) * SCALE.objects
    );
    const targetW = Math.floor(targetH * (entry.w / Math.max(1, entry.h)));

    // Slightly above the path, so it sits behind the ground-tile visually
    // Path top is (HEIGHT - TILE_DRAW_HEIGHT). We want the object base around there.
    const baseY = HEIGHT - TILE_DRAW_HEIGHT();
    const dy = Math.floor(baseY - targetH + (obj.yJitter || 0) - (obj.baseBelowTop || 0));

    ctx.drawImage(entry.img, sx, dy, targetW, targetH);
  }
}

function drawForegroundObjects() {
  if (!currentArea || !currentArea.foreObjects || currentArea.foreObjects.length === 0) return;

  const PARALLAX_FORE = PARALLAX.foreground; // strongest parallax
  for (const obj of currentArea.foreObjects) {
    if (!obj.entry && obj.key) obj.entry = loadObjectImage(obj.key);
    const entry = obj.entry;
    if (!entry || !entry.ready) continue;

    const sx = worldToScreenX(obj.worldX, PARALLAX_FORE);

    const targetH = Math.floor(
      (obj.heightPx || (TILE_DRAW_HEIGHT() * 0.70)) * SCALE.objects
    );
    const targetW = Math.floor(targetH * (entry.w / Math.max(1, entry.h)));

    // Slightly below the path, so it sits in front of ground
    const dy = Math.floor(HEIGHT - targetH);

    ctx.drawImage(entry.img, sx, dy, targetW, targetH);
  }
}





function startFadeTransfer(callbackMid) {
  FADE.active = true; FADE.phase = 'out'; FADE.t = 0; FADE.onMid = callbackMid;
}

function updateFade(dt) {
  if (!FADE.active) return;
  FADE.t += dt;
  if (FADE.phase === 'out' && FADE.t >= FADE.durOut) {
    // switch area now
    if (typeof FADE.onMid === 'function') FADE.onMid();
    FADE.phase = 'in'; FADE.t = 0;
  } else if (FADE.phase === 'in' && FADE.t >= FADE.durIn) {
    FADE.active = false; FADE.phase = 'idle'; FADE.t = 0; FADE.onMid = null;
  }
}

function drawFadeOverlay() {
  if (!FADE.active) return;
  let alpha = 0;
  if (FADE.phase === 'out') alpha = Math.min(1, FADE.t / FADE.durOut);
  else if (FADE.phase === 'in') alpha = 1 - Math.min(1, FADE.t / FADE.durIn);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.restore();
}


function gameLoop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;

  update(dt);
  updateFade(dt);       // NEW: advance fade state

  drawScenery();

  if (loading) {
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

    // Still draw fade overlay if you want it visible during transfers
    drawFadeOverlay();
    requestAnimationFrame(gameLoop);
    return;
  }
  drawCharacters();
  drawPlayer();
  drawForegroundObjects(); // NEW: in front of ground (and player, if you want it here)
  drawAreaBanner();
  drawFadeOverlay();    // NEW: draw fade on top

  requestAnimationFrame(gameLoop);
}

