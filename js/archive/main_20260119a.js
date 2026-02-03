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

// Dialog typing speed (characters per second)
let dialogCharsPerSecond = 50;


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
let currentTrigger = null;

let lastProximityNpc = null;

// Track which NPCs are currently within interaction radius (edge-trigger)
const proximityInside = new Set(); // stores npc name lowercased


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
// name -> { inParty:boolean, area:string|null, worldX:number|null, affection:number, alignment:number, rules:Rule[] }
const npcRegistry = {};
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

const eventStateDependencies = {
  npc_proximity: (payload) => {
    const npc = String(payload?.npc || '').toLowerCase();
    return npc ? [`playerInProximity:${npc}`] : [];
  },

  npc_proximity_leave: (payload) => {
    const npc = String(payload?.npc || '').toLowerCase();
    return npc ? [`playerInProximity:${npc}`] : [];
  },

  party_join: (payload) => {
    const npc = String(payload?.npc || '').toLowerCase();
    return npc
      ? [`npcInParty:${npc}`, `hasBeenInParty:${npc}`]
      : [];
  },

  party_leave: (payload) => {
    const npc = String(payload?.npc || '').toLowerCase();
    return npc ? [`npcInParty:${npc}`] : [];
  },

  area_enter: (payload) => {
    const out = [];
    if (payload?.fromArea) out.push(`playerInArea:${payload.fromArea}`);
    if (payload?.toArea)   out.push(`playerInArea:${payload.toArea}`);

    return out;
  },

  area_leave: (payload) => {
    const area = payload?.area;
    return area ? [`playerInArea:${area}`] : [];
  },

  section_enter: (payload) => {
    const area = String(payload?.area || '');
    const sec  = String(payload?.section || '');
    if (!sec) return [];
    const out = [`playerInSection:*:${sec}`];
    if (area) out.push(`playerInSection:${area}:${sec}`);

    const npc = String(payload?.npc || '').toLowerCase();
    if (npc && sec) {
      out.push(`npcInSection:${npc}:*:${sec}`);
      if (area) out.push(`npcInSection:${npc}:${area}:${sec}`);
    }

    return out;
  },

  section_leave: (payload) => {
    const area = String(payload?.area || '');
    const sec  = String(payload?.section || '');
    if (!sec) return [];
    const out = [`playerInSection:*:${sec}`];
    if (area) out.push(`playerInSection:${area}:${sec}`);

    const npc = String(payload?.npc || '').toLowerCase();
    if (npc && sec) {
      out.push(`npcInSection:${npc}:*:${sec}`);
      if (area) out.push(`npcInSection:${npc}:${area}:${sec}`);
    }

    return out;
  }
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
      const npc = String(s.npc || '').toLowerCase();
      return npc ? [`playerInProximity:${npc}`] : [];
    }

    case 'playerInArea': {
      return s.area ? [`playerInArea:${String(s.area)}`] : [];
    }

    case 'playerInSection': {
      const sec = String(s.section || '');
      if (!sec) return [];
      // index both exact (area+section) and area-agnostic (for rules that omit s.area)
      const out = [`playerInSection:*:${sec}`];
      if (s.area) out.push(`playerInSection:${String(s.area)}:${sec}`);
      return out;
    }

    case 'npcInSection': {
      const npc = String(s.npc || '').toLowerCase();
      const sec = String(s.section || '');
      if (!npc || !sec) return [];

      // Like playerInSection: index exact and area-agnostic
      const out = [`npcInSection:${npc}:*:${sec}`];
      if (s.area) out.push(`npcInSection:${npc}:${String(s.area)}:${sec}`);
      return out;
    }


    case 'npcInParty': {
      const npc = String(s.npc || '').toLowerCase();
      return npc ? [`npcInParty:${npc}`] : [];
    }

    case 'hasBeenInParty': {
      const npc = String(s.npc || '').toLowerCase();
      return npc ? [`hasBeenInParty:${npc}`] : [];
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
      area:null,
      worldX:null,
      affection:0,
      alignment:0
    };
  }
  return npcRegistry[name];
}

// ===== EVENT / RULE SYSTEM (NEW) =====
// Rule shape:
// {
//   id: "unique_string",
//   event: "section_enter" | "area_enter" | "talk_start" | "party_join" | "party_leave",
//   when: { area?, sections?, npc?, fromArea?, toArea? },
//   delta: { alignment?: number, affection?: number },
//   once?: boolean,          // if true, only triggers once ever
//   removeOnTrigger?: boolean, // if true, delete rule after it triggers
//   expires?: {
//     event: "area_leave" | "area_enter" | "party_leave",
//     area?: string
//   }

// }

// function addRule(npcName, rule) {
//   const rec = ensureNpcRecord(npcName);
//   if (!rule || !rule.id) return;
//   if (rec.rules.some(r => r && r.id === rule.id)) return;
//   rec.rules.push(rule);
//   indexStateRule(npcName, rule);

// }

// function removeRule(npcName, ruleId) {
//   const rec = ensureNpcRecord(npcName);

//   const before = rec.rules || [];
//   for (const r of before) {
//     if (r && r.id === ruleId) {
//       deindexStateRule(npcName, r);
//       break;
//     }
//   }

//   rec.rules = before.filter(r => r && r.id !== ruleId);

// }
// function removeRule(npcName, ruleId) {
//   console.warn('removeRule called but rules are no longer dynamically removed:', npcName, ruleId);
// }


// function applyCharacterRules(npcName) {
//   if (!npcDetails || typeof npcDetails !== 'object') return;

//   const charDef = npcDetails[npcName];
//   if (!charDef || !Array.isArray(charDef.rules)) return;

//   for (const r of charDef.rules) {
//     if (!r || !r.id) continue;
//     addRule(npcName, r);
//   }
// }

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


      case 'playerInArea': {
        if (currentAreaName !== s.area) return false;
        break;
      }

      case 'playerInSection': {
        if (payload?.section !== s.section) return false;
        if (s.area && payload?.area !== s.area) return false;
        break;
      }

      case 'playerInProximity': {
        const key = String(s.npc || '').toLowerCase();
        if (!key) return false;
        if (!proximityInside.has(key)) return false;
        break;
      }


      case 'hasBeenInParty': {
        const rec = ensureNpcRecord(s.npc);
        const has = !!rec.hasBeenInParty;
        if (has !== !!s.is) return false;
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

  if (w.direction && payload.direction !== w.direction) return false;

  if (w.npc && String(w.npc).toLowerCase() !== String(payload.npc || '').toLowerCase()) return false;

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

function applyRuleEffects(rule, payload) {
  const effects = Array.isArray(rule?.effects) ? rule.effects : [];
  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;

    if (eff.type === 'updateStat') {
      const who = eff.npc;
      const stat = eff.stat;
      const delta = Number(eff.delta);

      if (!who || !stat || !isFinite(delta)) continue;

      const rec = ensureNpcRecord(who);
      if (typeof rec[stat] !== 'number') rec[stat] = 0;
      rec[stat] += delta;

      // If the actor is currently live, update them too
      const actor = findActorByName(who);
      if (actor && typeof actor[stat] === 'number') actor[stat] = rec[stat];

      continue;
    }

    if (eff.type === 'setStat') {
      const who = eff.npc;
      const stat = eff.stat;
      const value = Number(eff.value);

      if (!who || !stat || !isFinite(value)) continue;

      const rec = ensureNpcRecord(who);
      rec[stat] = value;

      const actor = findActorByName(who);
      if (actor && typeof actor[stat] === 'number') actor[stat] = value;

      continue;
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


  // expire triggerWhen dialog prompts on inverse events ===
  if (eventName === 'section_leave') {
    const leavingArea = payload?.area;
    const leavingSection = payload?.section;

    for (const rule of rulesData) {
      if (!rule || !rule.id || !rule.triggerWhen || !rule.dialog) continue;

      const tw = rule.triggerWhen;

      if (
        tw.event === 'section_enter' &&
        tw.area === leavingArea &&
        tw.section === leavingSection
      ) {
        removeDialogPromptForRule(rule.id);
        activeStateRuleIds.delete(rule.id);
        deindexStateRule(rule);
      }
    }
  }

  if (eventName === 'area_leave') {
    const leavingArea = payload?.area;

    for (const rule of rulesData) {
      if (!rule || !rule.id || !rule.triggerWhen || !rule.dialog) continue;

      const tw = rule.triggerWhen;

      if (
        tw.event === 'area_enter' &&
        tw.area === leavingArea
      ) {
        removeDialogPromptForRule(rule.id);
        activeStateRuleIds.delete(rule.id);
        deindexStateRule(rule);
      }
    }
  }



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

    if (rule.scene && rule.scene.start) {
      startRuleScene(rule.scene.start);
    }


    if (rule.once) triggeredRuleIds.add(ruleId);
  }
}


// Emit an event and apply rules
function emitGameEvent(eventName, payload) {
  __lastEvent = { eventName, payload };

  applyRulesForEvent(eventName, payload);

  bumpEventCounts(eventName, payload);
  evaluateStateRulesForEvent(eventName, payload);
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
    if (!rule.dialog) continue;
    if (rule.disabled) continue;

    const isActive = activeStateRuleIds.has(ruleId);
    const shouldBeActive = evaluateRuleState(rule, payload);
    const hasFiredOnce = rule.once && triggeredRuleIds.has(ruleId);

    if (shouldBeActive && !isActive && !hasFiredOnce) {
      const speaker = rule.dialog.npc || payload?.npc;
      if (speaker) {
        enqueueNpcSpeechBubblePrompt(
          speaker,
          rule.dialog.prompt,
          rule.dialog.start,
          rule.id
        );
        activeStateRuleIds.add(ruleId);
        if (rule.once) triggeredRuleIds.add(ruleId);
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

  if (missing.length) {
    console.warn('[Rules] dialog rules missing dialog.npc key:', missing);
  }

  // Handy: dump one specific rule if needed
  const k = (rules || []).find(x => x && x.id === 'rowyn_forest1_keep_going_prompt');
  if (k) console.log('[Rules] rowyn_forest1_keep_going_prompt loaded as:', k);
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

function applyEffects(effects) {
  if (!Array.isArray(effects)) return;

  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;

    if (eff.type === 'setFlag') {
      const scope = eff.scope || 'area';
      const key = eff.key;
      const value = (eff.value !== undefined) ? eff.value : true;
      setFlag(scope, key, value);
      continue;
    }

    if (eff.type === 'lockControls') {
      controlsLocked = true;

      for (const k in keys) {
        keys[k] = false;
      }
      player.vx = 0;

      continue;
    }

    if (eff.type === 'unlockControls') {
      controlsLocked = false;

      for (const k in keys) {
        keys[k] = false;
      }

      continue;
    }

  }
}



let currentTriggeredPromptId = null;
let dialogOptionsMap = null;
const queuedDialogPrompts = [];

let inViewMode = false;
let inActionPhrase = false;
// Action phrase runtime state
let activeAction = null; // { phraseId, startedAtMs, done }

// Action-scene helper: remember where someone was in the party so they can rejoin in the same slot.
const rememberedPartyIndex = Object.create(null); // nameLower -> index


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

function parseDialogRef(ref, fallbackKey) {
  // Accept:
  //  - "phraseId" (local)
  //  - "fileId.phraseId" (cross-file)
  // Split on FIRST dot only so phraseId can contain dots.
  const s = String(ref || '');
  const dot = s.indexOf('.');
  if (dot > 0) {
    const fileKey = s.slice(0, dot).trim().toLowerCase();
    const phraseId = s.slice(dot + 1); // keep original casing for phrase keys
    return { fileKey, phraseId };
  }
  return { fileKey: String(fallbackKey || '').toLowerCase(), phraseId: s };
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

function enqueueNpcSpeechBubblePrompt(npcName, promptText, startPhrase, triggerKey) {
  enqueueDialogPrompt({
    npc: npcName,
    triggerKey: triggerKey || null, // MUST be set for rule-driven prompts
    prompt: promptText,
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
    // ground-locked overlays/objects (move with ground)
  warmObjects(area.groundBackObjects);
  warmObjects(area.groundForeObjects);
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
            density: (it.density != null && it.density !== '') ? Number(it.density) : undefined,
            position: (it.position != null && it.position !== '') ? Number(it.position) : undefined
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

      // ground-locked layers
      groundBackObjList: (secGroundBackObjs.length ? secGroundBackObjs : areaGroundBackObjs),
      groundForeObjList: (secGroundForeObjs.length ? secGroundForeObjs : areaGroundForeObjs)
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

    const { backObjList, foreObjList, groundBackObjList, groundForeObjList } = getSectionLists(sec.name);

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
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: -8,
        baseBelowTop: 14
      });
    }

    
    // --- FOREGROUND OBJECTS WITH EXPLICIT POSITION ---
    const foreWithPosition = (foreObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of foreWithPosition) {
      foreObjects.push({
        worldX: startX + obj.position,
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: 0,
        baseBelowTop: 0
      });
    }

    // --- GROUND-BACK OBJECTS WITH EXPLICIT POSITION (move with ground, BEHIND characters) ---
    const groundBackWithPosition = (groundBackObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of groundBackWithPosition) {
      groundBackObjects.push({
        worldX: startX + obj.position,
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: 0,
        baseBelowTop: 0
      });
    }

    // --- GROUND-FORE OBJECTS WITH EXPLICIT POSITION (move with ground, IN FRONT of characters) ---
    const groundForeWithPosition = (groundForeObjList || []).filter(o =>
      o && typeof o.position === 'number'
    );

    for (const obj of groundForeWithPosition) {
      groundForeObjects.push({
        worldX: startX + obj.position,
        key: obj.name,
        entry: null,
        heightPx: obj.height,
        yJitter: 0,
        baseBelowTop: 0
      });
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
    foreObjects,
    groundBackObjects,
    groundForeObjects,

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
  const area = buildAreaFromDefinition(areaName);

  // ===== IMPORTANT: flush section_leave before swapping areas =====
  // Otherwise section-enter prompts never expire if the player changes area from inside a section.
  if (fromArea) {
    // Player leaves their last known named section (if any)
    if (lastPlayerSection) {
      emitGameEvent('section_leave', {
        area: fromArea,
        section: lastPlayerSection,
        direction: null,
        npc: 'Player'
      });
    }

    // Party members leave their last known named sections (if any)
    for (const member of party) {
      if (!member || !member.name) continue;
      const k = String(member.name).toLowerCase();
      const lastSec = lastNpcSection.get(k) || null;

      if (lastSec) {
        emitGameEvent('section_leave', {
          area: fromArea,
          section: lastSec,
          direction: null,
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
  placePlayerAtAreaEdge(currentArea, spawnEdge);

  showAreaBanner(areaName);         // show name of area when entering
  beginLoadingForCurrentArea(`Loading ${areaName}...`);

  // area_leave event (for the previous area, if any)
  if (fromArea) {
    emitGameEvent('area_leave', { fromArea, toArea: areaName, area: fromArea, npc: 'Player' });
  }
  // NEW: area_enter event
  emitGameEvent('area_enter', { fromArea, toArea: areaName, area: areaName, edge: spawnEdge, npc: 'Player' });

  // Mirror area enter/leave for party members (same event names; includes npc)
  for (const member of party) {
    if (!member || !member.name) continue;

    if (fromArea) {
      emitGameEvent('area_leave', { fromArea, toArea: areaName, area: fromArea, npc: member.name });
    }
    emitGameEvent('area_enter', { fromArea, toArea: areaName, area: areaName, edge: spawnEdge, npc: member.name });
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

  emitGameEvent('exit_use', {
    area: currentAreaName,
    section: getSectionNameForX(player.worldX),
    direction: exitObj.direction,
    target: exitObj.target,
    toArea: dest.areaName
  });

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

  for (const name of npcNameList) {
    ensureNpcRecord(name);
  }

  rulesData = await loadRulesJSON();
  validateRulesData(rulesData);
  rebuildRulesIndex();




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
  emitGameEvent('talk_start', { area: currentAreaName, section: getSectionNameForX(player.worldX), npc: npc.name });

  promptEl.style.display = 'none';

  // show UI immediately
  conversationOverlay.style.display = 'block';
  dialogBox.textContent = 'Loading...';
  optionsBox.innerHTML = '';
  conversationPortrait.src = '';

  const fileKey = String(npc.name || '').toLowerCase();
  const data = await loadDialogFor(fileKey);

  currentDialog = data;
  currentDialogKey = fileKey;

  currentPhraseId = data.start;
  await loadPhrase(currentPhraseId);

}

async function startRuleScene(startRef) {
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
    let npcVal = npc[statName];
    if (npcVal == null) return false;

    for (const op of Object.keys(rule)) {
      let target = rule[op];

      // allow symbolic values: minalignment / minaffection
      if (typeof target === 'string') {
        const t = target.toLowerCase();
        if (t === 'minalignment') target = npc.minAlignmentRecruit;
        else if (t === 'minaffection') target = npc.minAffectionRecruit;
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

  const n = String(name).toLowerCase();
  if (n === 'player' || n === 'dace') return player;

  // Party first, then world npcs
  const p = party.find(x => String(x.name || '').toLowerCase() === n);
  if (p) return p;

  const w = npcs.find(x => String(x.name || '').toLowerCase() === n);
  if (w) return w;

  return null;
}

function getOrCreateNpcByName(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();

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
  const npc = createNpc(name, Math.max(2, Math.min(currentArea.lengthPx - player.w - 2, spawnX)));
  npc.alignment = rec.alignment || 0;
  npc.affection = rec.affection || 0;
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

        // Absolute target
        if (act.worldX !== undefined && act.worldX !== null) {
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
        rememberedPartyIndex[String(who.name).toLowerCase()] = idx;
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
          const k = String(who.name).toLowerCase();
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

    stopActionPhrase();

    // Apply effects on the action phrase when it completes (optional but consistent)
    applyEffects(phraseNow?.effects);

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
  element.textContent = '';
  if (!text) return;

  isTypingDialog = true;
  cancelDialogTyping = false;

  const delay = 1000 / dialogCharsPerSecond;

  for (let i = 0; i < text.length; i++) {
    if (!inConversation) return;

    if (cancelDialogTyping) {
      element.textContent = text;
      break;
    }

    element.textContent += text[i];
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  isTypingDialog = false;
}



async function loadPhrase(id) {
  if (!inConversation) return;

  conversationPortrait.src = '';


  const resolved = await ensureDialogAndGetPhrase(id);
  if (!resolved.dialog) { endConversation(); return; }

  const phrase = resolved.dialog.phrases[resolved.phraseId];
  currentPhraseId = resolved.phraseId;

  if (!phrase) { endConversation(); return; }
  // clearDialogOptions();
  // hideContinuePrompt();


  // ACTION PHRASE:
  // If phrase has an `action` object, treat it as a scene/action step.
  // - Hide dialog UI
  // - Lock world + dialog inputs
  // - Keep world updating (handled in update())
  if (phrase.action && typeof phrase.action === 'object') {
    startActionPhrase(id, phrase);
    return;
  }

  let speakerName = currentNpc?.name;

  if (typeof phrase.speaker === 'string' && phrase.speaker.length > 0) {
    speakerName = phrase.speaker;
  }

  // speaker handling (explicit only)
  if (typeof phrase.speaker === 'string' && phrase.speaker.length > 0) {
    const speakerName = phrase.speaker.toLowerCase();
    const reaction = phrase.reaction || 'neutral';
    const portraitPath =
      `assets/portraits/character_portrait_${speakerName}_${reaction}.png`;

    //console.log('[portrait] try:', portraitPath);

    const img = new Image();
    img.onload = () => {
      //console.log('[portrait] loaded:', portraitPath);
      conversationPortrait.src = portraitPath;
    };
    img.onerror = () => {
      const fallback =
        `assets/portraits/character_portrait_${speakerName}_neutral.png`;
      //console.warn('[portrait] failed, fallback:', portraitPath, '→', fallback);
      conversationPortrait.src = fallback;
    };
    img.src = portraitPath;

  } else {
    // narration / environment / no speaker
    conversationPortrait.src = '';
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

}

async function startTriggeredDialog(index) {
  const p = activeDialogPrompts[index];
  if (!p) return;

  // Mark as "fired" only AFTER the conversation completes
  currentTriggeredPromptId = `${p.npc.name.toLowerCase()}:${p.triggerKey}`;

  inConversation = true;
  currentNpc = p.npc;

  emitGameEvent('talk_start', {
    area: currentAreaName,
    section: getSectionNameForX(player.worldX),
    npc: currentNpc.name
  });

  promptEl.style.display = 'none';
  document.getElementById('dialogPromptContainer').innerHTML = '';

  // Show UI immediately (mirror startConversation)
  conversationOverlay.style.display = 'block';
  dialogBox.textContent = 'Loading...';
  optionsBox.innerHTML = '';
  conversationPortrait.src = '';

  const fileKey = String(currentNpc.name || '').toLowerCase();
  const data = await loadDialogFor(fileKey);
  if (!data) { endConversation(); return; }

  currentDialog = data;
  currentDialogKey = fileKey;

  // p.start can be "phraseId" OR "fileId.phraseId"
  currentPhraseId = p.start || data.start;
  await loadPhrase(currentPhraseId);

}


function endConversation() {
  const npc = currentNpc;
  const wasViewMode = inViewMode;

  // Always restore control state when a conversation/scene ends
  inActionPhrase = false;
  activeAction = null;
  controlsLocked = false;

  for (const k in keys) keys[k] = false;
  player.vx = 0;

  inConversation = false;
  currentNpc = null;
  currentDialog = null;
  currentPhraseId = null;
  dialogOptionsMap = null;
  inViewMode = false;
  conversationOverlay.style.display = 'none';

  // NPC must exist and must not be in view-only mode
  if (!npc || wasViewMode) return;

  // If this conversation was started from a triggered prompt, mark it fired now
  if (currentTriggeredPromptId) {
    firedDialogTriggers.add(currentTriggeredPromptId);
    currentTriggeredPromptId = null;
  }


  // 1) AUTO-JOIN (as before)
  //recruitNpcToParty(npc);

  // 2) AUTO-LEAVE (new)
  // If NPC *is* in the party, but affection AND alignment
  // are BOTH below minimum thresholds, they leave.
  if (party.includes(npc)) {
    const minA = npc.minAlignmentRecruit ?? 0;
    const minF = npc.minAffectionRecruit ?? 0;

    const badAlignment = npc.alignment < minA;
    const badAffection = npc.affection < minF;

    if (badAlignment && badAffection) {
      removeNpcFromParty(npc);
    }
  }
}

function canRecruitNpc(npc) {
  if (!npc) return false;
  if (party.includes(npc)) return false;
  if (party.length >= 3) return false;

  return (
    (npc.affection >= npc.minAffectionRecruit) ||
    (npc.alignment >= npc.minAlignmentRecruit)
  );
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

  if (!bypassChecks) {
    if (!canRecruitNpc(npc)) return false;
  }


  // Remove from world list (by instance + any other copies by name)
  if (fromWorld) {
    const idx = npcs.indexOf(npc);
    if (idx >= 0) npcs.splice(idx, 1);

    for (let i = npcs.length - 1; i >= 0; i--) {
      if (String(npcs[i].name || '').toLowerCase() === String(npc.name || '').toLowerCase()) {
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
  rec.area = null;
  rec.worldX = null;
  rec.alignment = npc.alignment;
  rec.affection = npc.affection;


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


// Returns the previous index in party (or -1 if not in party)
function removeNpcFromPartyInternal(npc, opts = {}) {
  if (!npc) return -1;

  const {
    emit = true,
    toWorld = true
  } = opts;

  const idx = party.indexOf(npc);
  if (idx < 0) return -1;

  party.splice(idx, 1);

  // Update registry
  const rec = ensureNpcRecord(npc.name);
  rec.inParty = false;
  rec.area = currentAreaName;
  rec.worldX = npc.worldX;
  rec.alignment = npc.alignment;
  rec.affection = npc.affection;

  if (toWorld) {
    // Put the NPC back into world NPCs at their current position
    npcs.push(npc);
  }

  if (emit) {
    emitGameEvent('party_leave', { area: currentAreaName, npc: npc.name });
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
    code === 'ArrowUp'   || code === 'ArrowDown'  ||
    code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD'
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

      count++;
      if (count === n) {
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

    if (e.code === 'KeyX') { endConversation(); return; }
    if (dialogOptionsMap && Object.keys(dialogOptionsMap).length > 0) {
      if (e.code.startsWith('Digit')) {
        const idx = parseInt(e.code.replace('Digit', ''));
        const opt = dialogOptionsMap[idx];
        if (!opt) return;
        optionsBox.innerHTML = '';
        dialogOptionsMap = null;

        //
        // APPLY EFFECTS
        //
        if (currentNpc) {
          const alignEff = opt.alignmentEffect || 0;
          const affEff   = opt.affectionEffect || 0;
          currentNpc.alignment += alignEff;
          currentNpc.affection += affEff;

          // persist stats
          const rec = ensureNpcRecord(currentNpc.name);
          rec.alignment = currentNpc.alignment;
          rec.affection = currentNpc.affection;

          applyEffects(opt.effects);

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

        applyEffects(phrase?.effects);

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
    
      const removed = party[removeIndex];
      removeNpcFromParty(removed);

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

  if (!currentArea) return;

  // If we're in an action phrase, run the action each frame.
  if (inConversation && inActionPhrase) {
    runActiveAction(dt);
  }

  if (inActionPhrase && activeAction?.lockPlayer) {
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
      populateNPCsForCurrentArea();
      loading = false;
    } else {
      return; // block update + input
    }
  }


  // Movement
  if (!loading) {

    // Dialog already freezes world by returning early.
    // Action phrases keep world running, so we must explicitly disable player input here.
    const playerMovementLocked = inConversation || (inActionPhrase && activeAction?.lockPlayer);

    if (!playerMovementLocked) {
      if (keys['ArrowLeft'] || keys['KeyA']) {
        player.vx -= movementSpeed() * dt;
      }
      if (keys['ArrowRight'] || keys['KeyD']) {
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


  // ===== Proximity scan (single pass) =====
  // - Sets currentTrigger (nearest WORLD npc in radius)
  // - Fires npc_proximity once on entering radius (world + party)
  let closestDist = Infinity;
  let trigger = null;

  const proximityList = [...npcs, ...party];

  for (const npc of proximityList) {
    if (!npc || !npc.name) continue;

    const dx = Math.abs(
      (player.worldX + player.w * 0.5) -
      (npc.worldX + npc.w * 0.5)
    );

    const radius = npc.interactionRadius || npcInteractionDistance();
    const key = String(npc.name).toLowerCase();

    const isInside = dx < radius;
    const wasInside = proximityInside.has(key);

    // Interaction target: choose nearest WORLD npc only (not party members)
    if (isInside && !party.includes(npc) && dx < closestDist) {
      trigger = npc;
      closestDist = dx;
    }

    // Event: fire once on entry (world + party)
    if (isInside && !wasInside) {
      proximityInside.add(key);
      emitGameEvent('npc_proximity', {
        area: currentAreaName,
        section: getSectionNameForX(player.worldX),
        npc: npc.name
      });
    } else if (!isInside && wasInside) {
      proximityInside.delete(key);

      emitGameEvent('npc_proximity_leave', {
        area: currentAreaName,
        section: getSectionNameForX(player.worldX),
        npc: npc.name
      });
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

  // ===== section_enter event =====
  const idx = Math.floor(player.worldX / currentArea.sectionTileWidth);
  const nowSection = currentArea.sections[idx]?.name || null;

  // Detect any section-index change (including unnamed sections)
  if (lastPlayerSectionIndex === null || idx !== lastPlayerSectionIndex) {
    let direction = null;
    if (lastPlayerSectionIndex !== null) {
      direction = idx > lastPlayerSectionIndex ? 'forward' : 'backward';
    }

    // NEW: section_leave for the previous named section
    if (lastPlayerSection) {
      emitGameEvent('section_leave', {
        area: currentAreaName,
        section: lastPlayerSection,
        direction,
        npc: 'Player'
      });
    }

    // Only emit section_enter if the *new* section has a name
    if (nowSection) {
      emitGameEvent('section_enter', {
        area: currentAreaName,
        section: nowSection,
        direction,
        npc: 'Player'
      });

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

    const key = String(npc.name).toLowerCase();

    const idxNpc = Math.floor(npc.worldX / currentArea.sectionTileWidth);
    const nowNpcSection = currentArea.sections[idxNpc]?.name || null;

    const prevIdx = lastNpcSectionIndex.has(key) ? lastNpcSectionIndex.get(key) : null;
    const prevSection = lastNpcSection.has(key) ? lastNpcSection.get(key) : null;

    // Only do work on the first observation OR when their section index changes
    if (prevIdx === null || idxNpc !== prevIdx) {
      let direction = null;
      if (prevIdx !== null) {
        direction = idxNpc > prevIdx ? 'forward' : 'backward';
      }

      // Leave old named section (if any)
      if (prevSection) {
        emitGameEvent('section_leave', {
          area: currentAreaName,
          section: prevSection,
          direction,
          npc: npc.name
        });
      }

      // Enter new named section (if any)
      if (nowNpcSection) {
        emitGameEvent('section_enter', {
          area: currentAreaName,
          section: nowNpcSection,
          direction,
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

  for (const p of queuedDialogPrompts) {
    const want = String(p.npc || '').toLowerCase();
    const npc =
      party.find(n => String(n.name || '').toLowerCase() === want) ||
      npcs.find(n => String(n.name || '').toLowerCase() === want);

    if (!npc) continue;


    // Only show the prompt while the player is within this NPC's interaction radius
    //const dx = Math.abs((player.worldX + player.w * 0.5) - (npc.worldX + npc.w * 0.5));
    //const radius = npc.interactionRadius || npcInteractionDistance();
    //if (dx >= radius) continue;

    const triggerKey = p.triggerKey || null;
    // All rule-driven prompts MUST have a trigger key so they can be de-duped and removed cleanly.
    if (!triggerKey) continue;


    const firedId = `${npc.name.toLowerCase()}:${triggerKey}`;
    if (firedDialogTriggers.has(firedId)) continue;

    activeDialogPrompts.push({
      npc,
      triggerKey,
      prompt: p.prompt,
      start: p.start
    });
  }
}

function isPlayerWithinNpcRadius(npc) {
  const dx = Math.abs((player.worldX + player.w * 0.5) - (npc.worldX + npc.w * 0.5));
  const radius = npc.interactionRadius || npcInteractionDistance();
  return dx < radius;
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
  ctx.font = '20px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('R', sx, sy);
  ctx.restore();

  return 26;
}



function drawSpeechBubbleForNpc(npc, text, keyLabel, yOffset = 0) {
  const sx = npc.worldX - cameraX + npc.w / 2;
  const sy = npc.y - 10 - yOffset;

  ctx.save();
  ctx.font = '48px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const paddingX = 16;
  const paddingY = 10;

  const fullText = keyLabel ? `[${keyLabel}] ${text}` : text;
  const textW = ctx.measureText(fullText).width;
  const boxW = textW + paddingX * 2;
  const boxH = 34;

  const x = Math.floor(sx - boxW / 2);
  const y = Math.floor(sy - boxH);

  // Bubble
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x, y, boxW, boxH);

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, boxW, boxH);

  // Text
  ctx.fillStyle = '#fff';
  ctx.fillText(fullText, sx, y + boxH - paddingY);

  ctx.restore();
  return boxH + 6;
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
    const label = `${player.name}  v=${spd} X=${player.worldX}`;

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

  drawGroundBackObjects(); // NEW: moves with ground, but behind characters


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

function drawGroundBackObjects() {
  if (!currentArea || !currentArea.groundBackObjects || currentArea.groundBackObjects.length === 0) return;

  for (const obj of currentArea.groundBackObjects) {
    if (!obj.entry && obj.key) obj.entry = loadObjectImage(obj.key);
    const entry = obj.entry;
    if (!entry || !entry.ready) continue;

    const sx = worldToScreenX(obj.worldX, PARALLAX.ground);

    const targetH = Math.floor(
      (obj.heightPx || (TILE_DRAW_HEIGHT() * 0.70)) * SCALE.objects
    );
    const targetW = Math.floor(targetH * (entry.w / Math.max(1, entry.h)));

    const dy = Math.floor(HEIGHT - targetH);
    ctx.drawImage(entry.img, sx, dy, targetW, targetH);
  }
}

function drawGroundForeObjects() {
  if (!currentArea || !currentArea.groundForeObjects || currentArea.groundForeObjects.length === 0) return;

  for (const obj of currentArea.groundForeObjects) {
    if (!obj.entry && obj.key) obj.entry = loadObjectImage(obj.key);
    const entry = obj.entry;
    if (!entry || !entry.ready) continue;

    const sx = worldToScreenX(obj.worldX, PARALLAX.ground);

    const targetH = Math.floor(
      (obj.heightPx || (TILE_DRAW_HEIGHT() * 0.70)) * SCALE.objects
    );
    const targetW = Math.floor(targetH * (entry.w / Math.max(1, entry.h)));

    const dy = Math.floor(HEIGHT - targetH);
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

  drawGroundForeObjects(); // moves with ground, in front of characters (but behind UI)


  // ===== Above-head UI (recruit icons + dialog prompt bubbles) =====
  const headStack = new Map(); // npc -> current yOffset used

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
  let partyLabel = 1;

  for (let i = 0; i < activeDialogPrompts.length; i++) {
    const p = activeDialogPrompts[i];
    if (!p || !p.npc) continue;

    const isPartyNpc = party.includes(p.npc);
    const keyLabel = isPartyNpc ? String(partyLabel++) : 'T';

    const yOffset = headStack.get(p.npc) || 0;
    const used = drawSpeechBubbleForNpc(p.npc, p.prompt, keyLabel, yOffset);
    headStack.set(p.npc, yOffset + used);
  }




  drawForegroundObjects(); // NEW: in front of ground (and player, if you want it here)
  drawAreaBanner();
  drawSectionBanner();
  drawFadeOverlay();    // NEW: draw fade on top

  requestAnimationFrame(gameLoop);
}

