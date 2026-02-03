// Pixel Forest Runner (modular version)
// This script contains the entire game logic that was previously embedded
// in index.html. It loads assets from the new directory structure and
// maintains the same gameplay features: exploration, NPC encounters,
// party recruitment, name display toggling, and removal of party members.

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

// Conversation state
let inConversation = false;
let currentNpc = null;
let currentDialog = null;
let currentPhraseId = null;
let dialogOptionsMap = null;
let inViewMode = false;

// Dialog storage. Will be filled on demand.
const dialogs = {};

/*
 * NOTE: removed redundant template definition of predefinedDialogs. The
 * predefinedDialogs constant is defined above with embedded data for
 * characters that require complex dialog trees. If you wish to add more
 * predefined dialogs, edit the object defined earlier in this file.
 */

// Helper to load a dialog JSON for a given NPC name. Uses fetch and caches the result.
async function loadDialogFor(name) {
  name = name.toLowerCase();
  if (dialogs[name]) return dialogs[name];
  // If a predefined dialog exists, return it instead of attempting a fetch.
  /*
  if (predefinedDialogs[name]) {
    dialogs[name] = predefinedDialogs[name];
    return predefinedDialogs[name];
  }
  */
  try {
    const resp = await fetch(`data/dialogs/${name}.json`);
    if (resp.ok) {
      const data = await resp.json();
      dialogs[name] = data;
      return data;
    }
  } catch (err) {
    // Failed to fetch from file (likely running via file://). Create a simple fallback dialog.
    console.log("failed to get json for"&name)
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

async function loadNPCdetails() {
  console.log("load NPC details");
try {
    const resp = await fetch(`data/characters.json`);
    if (resp.ok) {
      const data = await resp.json();
      //console.log(data);
      return data;
    }
  } catch (err) {
    // Failed to fetch from file (likely running via file://). Create a simple fallback dialog.
    console.log("failed to get json for character details")
  }
}

// Create a single shared promise for NPC details.
// Everyone else should either await this in init, or (rarely) await it inline.
const npcDetailsPromise = loadNPCdetails();
const npcSprites = {};

// Will hold the resolved JSON for synchronous access after init
let npcDetails = null;

// Simple asset-wait helper (optional)
/*function imageLoaded(img) {
  return new Promise(res => {
    if (img.complete && img.naturalWidth) return res();
    img.onload = () => res();
    img.onerror = () => res(); // don't block the game if a file is missing
  });
}*/
let npcNameList = [];
async function initGame() {
  // 1) Wait for NPC JSON
  npcDetails = await npcDetailsPromise;

  // 2) (Optional) wait for key images so first frame draws nicely
  /*await Promise.all([
    imageLoaded(playerSprite),
    imageLoaded(groundTileImg),
    // preload a handful of npc sprites quickly (won’t block if they 404)
    ...Object.values(npcSprites).slice(0, 4).map(s => imageLoaded(s.img))
  ]);*/
  console.log(npcDetails);
  npcNameList = Object.keys(npcDetails);
  console.log(npcNameList);

  
  npcNameList.forEach((name) => {
    const img = new Image();
    console.log(name.toLowerCase());
    img.src = `assets/sprites/npcs/character_sprite_${name.toLowerCase()}.png`;
    npcSprites[name] = { img, ready: false };
    img.onload = () => { npcSprites[name].ready = true; };
  });
  // 3) Now it’s safe to build the world & spawn NPCs
  initScenery();

  console.log("Scenery initialised");
  // 4) Start the loop
  requestAnimationFrame(gameLoop);
}

// Kick everything off
initGame();



// Begin a conversation with the given NPC. Loads the dialog data and shows the overlay.
async function startConversation(npc) {
  if (inConversation) return;
  inConversation = true;
  currentNpc = npc;
  promptEl.style.display = 'none';
  // Load dialog data
  const data = await loadDialogFor(npc.name);
  currentDialog = data;
  currentPhraseId = data.start;
  conversationOverlay.style.display = 'block';
  loadPhrase(currentPhraseId);
}

// Load and display a phrase by id. Handles NPC speech and player options.
function loadPhrase(id) {
  if (!inConversation || !currentDialog) return;
  const phrase = currentDialog.phrases[id];
  currentPhraseId = id;
  if (!phrase) {
    endConversation();
    return;
  }
  // Determine portrait based on reaction
  let reaction = phrase.reaction || 'neutral';
  let portraitPath = `assets/portraits/character_portrait_${currentNpc.name.toLowerCase()}_${reaction}.png`;
  // Fallback to neutral portrait if not found
  const img = new Image();
  img.onload = () => {
    conversationPortrait.src = portraitPath;
  };
  img.onerror = () => {
    conversationPortrait.src = `assets/portraits/character_portrait_${currentNpc.name.toLowerCase()}_neutral.png`;
  };
  img.src = portraitPath;
  // Display NPC text in dialog box
  dialogBox.textContent = phrase.text;
  // Clear options
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
    // No options: instruct user to continue
    const p = document.createElement('div');
    p.textContent = 'Press any key to continue...';
    optionsBox.appendChild(p);
  }
}

// End the current conversation and restore game control
function endConversation() {
  inConversation = false;
  currentNpc = null;
  currentDialog = null;
  currentPhraseId = null;
  dialogOptionsMap = null;
  inViewMode = false;
  conversationOverlay.style.display = 'none';
}

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// Player definition with default name
const player = {
  worldX: 40,
  y: 0,
  w: 48,
  h: 88,
  vx: 0,
  vy: 0,
  speed: 0.8,
  jumpForce: -7.5,
  onGround: false,
  name: 'Dace'
};

const gravity = 0.35;
const friction = 0.85;
let cameraX = 0;
let lastDirection = 1;

// Ground positioning
const groundLineY = HEIGHT - 40;
const groundAreaTop = groundLineY - player.h * 0.5;
const groundY = groundLineY;

// Environment arrays
const trees = [];
const bushes = [];
const rocks = [];

// NPC and party arrays
const npcs = [];
const party = [];
const npcSpacing = WIDTH * 1;
let nextNpcRight = npcSpacing;
let nextNpcLeft = -npcSpacing;
let worldMin = 0;
let worldMax = 0;

// Ensure Rowyn appears as the first character to the right. We track a flag
// so we only insert Rowyn once during initialization.
let rowynSpawnedFirst = false;

// Load player sprite
console.log("load player sprite");
const playerSprite = new Image();
playerSprite.src = 'assets/sprites/player/dace.png';
let spriteReady = false;
playerSprite.onload = () => {
  spriteReady = true;
};

// Load ground tile
console.log("load ground tile");
const groundTileImg = new Image();
groundTileImg.src = 'assets/tiles/ground.png';
let groundTileReady = false;
groundTileImg.onload = () => {
  groundTileReady = true;
};


// Fallback palettes for NPCs
const npcPalettes = [
  {
    hat: '#5a3a22', hatBand: '#c68b59', face: '#eac9a7',
    shirt: '#4b7094', pants: '#2f3d4e', boots: '#503d2c'
  },
  {
    hat: '#2a434c', hatBand: '#89654b', face: '#f1d0b2',
    shirt: '#3d8b6e', pants: '#413a5a', boots: '#362d22'
  },
  {
    hat: '#483662', hatBand: '#b288b2', face: '#e9c89c',
    shirt: '#6c5b7b', pants: '#2e3647', boots: '#44312b'
  },
  {
    hat: '#4d4028', hatBand: '#a77948', face: '#e7c399',
    shirt: '#7a893f', pants: '#2c4151', boots: '#473e2c'
  }
];

// Interaction system
const interactionDistance = player.w * 2;
let currentTrigger = null;

// Helper functions to create environment objects
function createTree(worldX) {
  const trunkHeight = 20 + Math.random() * 20;
  const trunkWidth = 4 + Math.random() * 2;
  const leavesHeight = 14 + Math.random() * 8;
  const leavesWidth = 20 + Math.random() * 16;
  return { worldX, trunkH: trunkHeight, trunkW: trunkWidth, leavesH: leavesHeight, leavesW: leavesWidth };
}
function createBush(worldX) {
  const w = 16 + Math.random() * 12;
  const h = 8 + Math.random() * 4;
  return { worldX, w, h };
}
function createRock(worldX) {
  const size = 6 + Math.random() * 6;
  return { worldX, size };
}



// Create an NPC at a given world coordinate
function createNpc(name,worldX) {
  console.log("Create NPC")
  
  const spriteEntry = npcSprites[name];
  const sprite = spriteEntry ? spriteEntry.img : null;
  const w = player.w;
  const h = player.h;
  const y = groundY - h - 8;

  //console.log(npcDetails);
  //console.log(npcDetails["Rowyn"]);
  //console.log(npcDetails["Rowyn"]["minaffection"]);
  const minAffection = npcDetails["Rowyn"]["minaffection"];
  const minAlignment = npcDetails["Rowyn"]["minalignment"];
  const palette = npcPalettes[Math.floor(Math.random() * npcPalettes.length)];
  //console.log("min affection:");
  //console.log(minAffection);
  // Initialize stats: alignment and affection start at 0. Minimum thresholds to recruit default to 0.
  return {
    worldX,
    y,
    w,
    h,
    name,
    sprite,
    palette,
    alignment: 0,
    affection: 0,
    minAlignmentRecruit: minAlignment,
    minAffectionRecruit: minAffection
  };
}

function spawnNpc(name,atX) {
  console.log("Spawn NPC" );
  console.log(name);
  console.log(npcNameList);
  console.log(npcNameList.length);
  const elementNumber = Math.floor(Math.random() * npcNameList.length);
  console.log(elementNumber);
  if (name == "") {
    console.log("Name is blank");
    name = npcNameList[elementNumber];

  }
  console.log("set name");
  console.log(name);
  const npc = createNpc(name,atX);
  npcs.push(npc);
}

// Initialize scenery and initial NPCs
function initScenery() {
  console.log("Initialise scenery & NPCs");
  worldMin = -WIDTH;
  worldMax = WIDTH * 2;
  let pos = worldMin;
  while (pos < worldMax) {
    trees.push(createTree(pos + Math.random() * 80));
    bushes.push(createBush(pos + 20 + Math.random() * 60));
    rocks.push(createRock(pos + 10 + Math.random() * 50));
    pos += 80;
  }
  // Spawn Rowyn at the first positive spawn location if not already inserted.
  if (!rowynSpawnedFirst) {
    // Place Rowyn at the first scheduled NPC position on the right.
    console.log("Create Rowyn");
    const rowynX = nextNpcRight;
    const npc = createNpc("Rowyn",rowynX);
    //npc.name = 'rowyn';
    // Assign proper sprite for Rowyn
    if (npcSprites['rowyn']) {
      npc.sprite = npcSprites['rowyn'].img;
    }
    npcs.push(npc);
    rowynSpawnedFirst = true;
    // Advance nextNpcRight so normal spawning resumes after Rowyn
    nextNpcRight = rowynX + npcSpacing;
  }
  // Spawn NPCs within the initial world bounds
  while (nextNpcRight <= worldMax) {
    spawnNpc("",nextNpcRight);
    nextNpcRight += npcSpacing;
  }
  while (nextNpcLeft >= worldMin) {
    spawnNpc("",nextNpcLeft);
    nextNpcLeft -= npcSpacing;
  }
}
//initScenery();

// Key handling
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  // If in a conversation, process conversation controls and prevent other actions
  if (inConversation) {
    // Exit conversation on X
    if (e.code === 'KeyX') {
      endConversation();
      return;
    }
    // Handle number selection for options when options exist
    if (dialogOptionsMap && Object.keys(dialogOptionsMap).length > 0) {
      if (e.code.startsWith('Digit')) {
        const idx = parseInt(e.code.replace('Digit', ''));
        if (dialogOptionsMap[idx] !== undefined) {
          const nextId = dialogOptionsMap[idx];
          // Apply alignment/affection effects if available
          // Find the corresponding option definition
          const currentPhrase = currentDialog && currentPhraseId ? currentDialog.phrases[currentPhraseId] : null;
          if (currentPhrase && currentPhrase.options) {
            let optionIndex = 1;
            for (const key in currentPhrase.options) {
              const opt = currentPhrase.options[key];
              if (optionIndex === idx) {
                // Apply stat effects if defined
                if (currentNpc) {
                  const alignEff = opt.alignmentEffect || 0;
                  const affEff = opt.affectionEffect || 0;
                  currentNpc.alignment += alignEff;
                  currentNpc.affection += affEff;
                }
                break;
              }
              optionIndex++;
            }
          }
          if (nextId) {
            loadPhrase(nextId);
          } else {
            endConversation();
          }
        }
        return;
      }
    } else {
      // No options: any key continues except X (handled above)
      if (inViewMode) {
        // In view mode, any key closes the view
        endConversation();
      } else if (currentDialog && currentPhraseId) {
        const phrase = currentDialog.phrases[currentPhraseId];
        if (phrase && phrase.next) {
          loadPhrase(phrase.next);
        } else {
          endConversation();
        }
      } else {
        // If no dialog loaded, just end conversation
        endConversation();
      }
      return;
    }
    return;
  }
  // Not in conversation: normal game controls
  // Talk with T
  if (e.code === 'KeyT' && currentTrigger) {
    startConversation(currentTrigger);
    return;
  }
  // View stats with V
  if (e.code === 'KeyV' && currentTrigger) {
    // Start view mode overlay
    inViewMode = true;
    inConversation = true;
    currentNpc = currentTrigger;
    promptEl.style.display = 'none';
    // Set portrait to neutral
    conversationPortrait.src = `assets/portraits/character_portrait_${currentNpc.name.toLowerCase()}_neutral.png`;
    dialogBox.textContent = `Name: ${currentNpc.name}\nAlignment: ${currentNpc.alignment}\nAffection: ${currentNpc.affection}\nMin Alignment to Recruit: ${currentNpc.minAlignmentRecruit}\nMin Affection to Recruit: ${currentNpc.minAffectionRecruit}`;
    optionsBox.innerHTML = '<div>Press X to close</div>';
    conversationOverlay.style.display = 'block';
    return;
  }
  // Recruit with R (only if conditions meet)
  if (e.code === 'KeyR' && currentTrigger) {
    const npc = currentTrigger;
    if (party.length < 3 && ((npc.affection >= npc.minAffectionRecruit) || (npc.alignment >= npc.minAlignmentRecruit))) {
      npc.offsetX = 24 + party.length * 24;
      const idx = npcs.indexOf(npc);
      if (idx >= 0) {
        npcs.splice(idx, 1);
      }
      party.push(npc);
      currentTrigger = null;
      promptEl.style.display = 'none';
    }
  }
  // Toggle names with N
  if (e.code === 'KeyN') {
    showNames = !showNames;
  }
  // Drop party members with Shift+1/2/3
  if (e.shiftKey) {
    let removeIndex = null;
    if (e.code === 'Digit1') removeIndex = 0;
    else if (e.code === 'Digit2') removeIndex = 1;
    else if (e.code === 'Digit3') removeIndex = 2;
    if (removeIndex !== null && removeIndex < party.length) {
      const removed = party.splice(removeIndex, 1)[0];
      removed.y = groundY - removed.h - 8;
      if (removed.offsetX !== undefined) delete removed.offsetX;
      npcs.push(removed);
      if (currentTrigger === removed) {
        currentTrigger = null;
        promptEl.style.display = 'none';
      }
    }
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

let showNames = false;

function update() {
  // If a conversation is active, pause game updates (movement, spawning) but allow drawing
  if (inConversation) {
    return;
  }
  // Movement input
  if (keys['ArrowLeft'] || keys['KeyA']) player.vx -= player.speed;
  if (keys['ArrowRight'] || keys['KeyD']) player.vx += player.speed;
  if ((keys['ArrowUp'] || keys['Space'] || keys['KeyW']) && player.onGround) {
    player.vy = player.jumpForce;
    player.onGround = false;
  }
  player.vy += gravity;
  if (player.onGround) player.vx *= friction;
  player.vx = Math.max(Math.min(player.vx, 4), -4);
  if (player.vx > 0) lastDirection = 1;
  else if (player.vx < 0) lastDirection = -1;
  player.worldX += player.vx;
  player.y += player.vy;
  if (player.y < 0) {
    player.y = 0;
    player.vy = 0;
  }
  if (player.y + player.h >= groundY) {
    player.y = groundY - player.h;
    player.vy = 0;
    player.onGround = true;
  }
  // Camera dead zone (25% left/right)
  {
    const screenX = player.worldX - cameraX;
    const leftThreshold = WIDTH * 0.25;
    const rightThreshold = WIDTH * 0.75;
    if (screenX < leftThreshold) cameraX = player.worldX - leftThreshold;
    else if (screenX > rightThreshold) cameraX = player.worldX - rightThreshold;
  }
  // Extend world right
  const rightNeeded = cameraX + WIDTH * 2;
  while (rightNeeded > worldMax) {
    const start = worldMax;
    const end = worldMax + 80;
    const base = start + Math.random() * 40;
    trees.push(createTree(base));
    bushes.push(createBush(base + 30 + Math.random() * 20));
    rocks.push(createRock(base + 15 + Math.random() * 20));
    while (nextNpcRight >= start && nextNpcRight <= end) {
      spawnNpc("",nextNpcRight);
      nextNpcRight += npcSpacing;
    }
    worldMax = end;
  }
  // Extend world left
  const leftNeeded = cameraX - WIDTH;
  while (leftNeeded < worldMin) {
    const end = worldMin;
    const start = worldMin - 80;
    const base = start + Math.random() * 40;
    trees.push(createTree(base));
    bushes.push(createBush(base + 30 + Math.random() * 20));
    rocks.push(createRock(base + 15 + Math.random() * 20));
    while (nextNpcLeft >= start && nextNpcLeft <= end) {
      spawnNpc("",nextNpcLeft);
      nextNpcLeft -= npcSpacing;
    }
    worldMin = start;
  }
  // Interaction check: find the closest NPC within range
  currentTrigger = null;
  let closestDist = Infinity;
  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    const dx = Math.abs((player.worldX + player.w * 0.5) - (npc.worldX + npc.w * 0.5));
    if (dx < interactionDistance && dx < closestDist) {
      currentTrigger = npc;
      closestDist = dx;
    }
  }
  // Update prompt based on interaction and party size
  if (currentTrigger) {
    let text = 'T: Talk  ';
    // Only show recruit option if there is room in the party and the NPC meets alignment/affection thresholds
    if (party.length < 3) {
      const npc = currentTrigger;
      const canRecruit = (npc.affection >= npc.minAffectionRecruit) || (npc.alignment >= npc.minAlignmentRecruit);
      if (canRecruit) {
        text += 'R: Recruit  ';
      }
    }
    text += 'V: View';
    promptEl.textContent = text;
    promptEl.style.display = 'block';
  } else {
    promptEl.style.display = 'none';
  }
  // Update party positions
  const baseDistance = player.w * 1.5;
  for (let i = 0; i < party.length; i++) {
    const member = party[i];
    const dxToPlayer = player.worldX - member.worldX;
    const threshold = baseDistance * (i + 1);
    const extra = Math.abs(dxToPlayer) - threshold;
    if (extra > 0) {
      const step = extra * 0.1;
      const maxStep = 4;
      member.worldX += Math.sign(dxToPlayer) * Math.min(step, maxStep);
    }
    const targetY = groundLineY - member.h - 2 * (i + 1);
    const dy = targetY - member.y;
    if (Math.abs(dy) > 0.5) {
      const stepY = Math.sign(dy) * Math.min(Math.abs(dy) * 0.1, 2);
      member.y += stepY;
    } else {
      member.y = targetY;
    }
  }
}

function drawPlayer() {
  const px = Math.floor(player.worldX - cameraX);
  const py = Math.floor(player.y);
  if (spriteReady) {
    if (lastDirection < 0) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(playerSprite, -(px + player.w), py, playerSprite.width, playerSprite.height);
      ctx.restore();
    } else {
      ctx.drawImage(playerSprite, px, py, playerSprite.width, playerSprite.height);
    }
    if (showNames && player.name) {
      ctx.save();
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      const x = px + player.w / 2;
      const y = py - 2;
      ctx.strokeText(player.name, x, y);
      ctx.fillText(player.name, x, y);
      ctx.restore();
    }
  }
}

function drawCharacters() {
  // Draw roaming NPCs
  npcs.forEach((npc) => {
    const sx = npc.worldX - cameraX;
    if (sx + npc.w < -50 || sx - npc.w > WIDTH + 50) return;
    const x = Math.floor(sx);
    const y = Math.floor(npc.y);
    if (npc.sprite && npcSprites[npc.name] && npcSprites[npc.name].ready) {
      ctx.drawImage(npc.sprite, x, y, npc.w, npc.h);
    } else {
      const p = npc.palette;
      ctx.fillStyle = p.hat;
      ctx.fillRect(x, y, npc.w, 4);
      ctx.fillStyle = p.hatBand;
      ctx.fillRect(x + 2, y + 1, npc.w - 4, 1);
      ctx.fillStyle = p.face;
      ctx.fillRect(x + 2, y + 4, npc.w - 4, 5);
      ctx.fillStyle = p.shirt;
      ctx.fillRect(x + 1, y + 9, npc.w - 2, 6);
      ctx.fillStyle = p.pants;
      ctx.fillRect(x + 1, y + 15, 4, 4);
      ctx.fillRect(x + npc.w - 5, y + 15, 4, 4);
      ctx.fillStyle = p.boots;
      ctx.fillRect(x + 1, y + 19, 4, 1);
      ctx.fillRect(x + npc.w - 5, y + 19, 4, 1);
    }
    if (showNames && npc.name) {
      ctx.save();
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      const textX = x + npc.w / 2;
      const textY = y - 2;
      ctx.strokeText(npc.name, textX, textY);
      ctx.fillText(npc.name, textX, textY);
      ctx.restore();
    }
  });
  // Draw party members from back to front
  for (let i = party.length - 1; i >= 0; i--) {
    const member = party[i];
    const sx = member.worldX - cameraX;
    if (sx + member.w < -50 || sx - member.w > WIDTH + 50) continue;
    const x = Math.floor(sx);
    const y = Math.floor(member.y);
    if (member.sprite && npcSprites[member.name] && npcSprites[member.name].ready) {
      ctx.drawImage(member.sprite, x, y, member.w, member.h);
    } else {
      const p = member.palette || {
        hat: '#3a2e39', hatBand: '#b86f50', face: '#e5c29f',
        shirt: '#4b8e76', pants: '#373e4c', boots: '#2d2a32'
      };
      ctx.fillStyle = p.hat;
      ctx.fillRect(x, y, member.w, 4);
      ctx.fillStyle = p.hatBand;
      ctx.fillRect(x + 2, y + 1, member.w - 4, 1);
      ctx.fillStyle = p.face;
      ctx.fillRect(x + 2, y + 4, member.w - 4, 5);
      ctx.fillStyle = p.shirt;
      ctx.fillRect(x + 1, y + 9, member.w - 2, 6);
      ctx.fillStyle = p.pants;
      ctx.fillRect(x + 1, y + 15, 4, 4);
      ctx.fillRect(x + member.w - 5, y + 15, 4, 4);
      ctx.fillStyle = p.boots;
      ctx.fillRect(x + 1, y + 19, 4, 1);
      ctx.fillRect(x + member.w - 5, y + 19, 4, 1);
    }
    if (showNames && member.name) {
      ctx.save();
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      const tx = x + member.w / 2;
      const ty = y - 2;
      ctx.strokeText(member.name, tx, ty);
      ctx.fillText(member.name, tx, ty);
      ctx.restore();
    }
  }
}

function drawScenery() {
  // Sky
  const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  grad.addColorStop(0, '#232942');
  grad.addColorStop(1, '#4f5d75');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // Far mountains
  const farFactor = 0.5;
  const farShift = cameraX * farFactor;
  ctx.fillStyle = '#2a344c';
  ctx.beginPath();
  ctx.moveTo(-farShift + 0, groundLineY - 60);
  ctx.lineTo(-farShift + 80, groundLineY - 80);
  ctx.lineTo(-farShift + 160, groundLineY - 50);
  ctx.lineTo(-farShift + 240, groundLineY - 90);
  ctx.lineTo(-farShift + 320, groundLineY - 60);
  ctx.lineTo(-farShift + 400, groundLineY - 100);
  ctx.lineTo(-farShift + 480, groundLineY - 70);
  ctx.lineTo(-farShift + 560, groundLineY - 90);
  ctx.lineTo(-farShift + 640, groundLineY - 60);
  ctx.lineTo(-farShift + 720, groundLineY - 80);
  ctx.lineTo(-farShift + WIDTH, groundLineY - 50);
  ctx.lineTo(-farShift + WIDTH, HEIGHT);
  ctx.lineTo(-farShift + 0, HEIGHT);
  ctx.closePath();
  ctx.fill();
  // Near objects (trees, bushes, rocks) with parallax
  const nearFactor = 0.8;
  trees.forEach((tree) => {
    const sx = tree.worldX - cameraX * nearFactor;
    if (sx + tree.leavesW < -50 || sx - tree.leavesW > WIDTH + 50) return;
    const baseY = groundLineY;
    ctx.fillStyle = '#4b3b2e';
    ctx.fillRect(Math.floor(sx), baseY - tree.trunkH, Math.floor(tree.trunkW), Math.floor(tree.trunkH));
    ctx.fillStyle = '#2a684f';
    ctx.fillRect(Math.floor(sx - (tree.leavesW - tree.trunkW) / 2), baseY - tree.trunkH - tree.leavesH,
                 Math.floor(tree.leavesW), Math.floor(tree.leavesH));
  });
  bushes.forEach((bush) => {
    const sx = bush.worldX - cameraX * nearFactor;
    if (sx + bush.w < -50 || sx - bush.w > WIDTH + 50) return;
    ctx.fillStyle = '#356346';
    ctx.fillRect(Math.floor(sx), groundLineY - bush.h, Math.floor(bush.w), Math.floor(bush.h));
  });
  rocks.forEach((rock) => {
    const sx = rock.worldX - cameraX * nearFactor;
    if (sx + rock.size < -50 || sx - rock.size > WIDTH + 50) return;
    const y = groundLineY - rock.size;
    ctx.fillStyle = '#6c6c7a';
    ctx.fillRect(Math.floor(sx), y, Math.floor(rock.size), Math.floor(rock.size));
    ctx.fillStyle = '#8a8aa6';
    ctx.fillRect(Math.floor(sx) + 1, y + 1, Math.floor(rock.size) - 2, Math.floor(rock.size / 2));
  });
  // Ground tile
  if (groundTileReady) {
    //const foregroundHeight = 200;
    
    const tileH = 110;
    const tileW = tileH*groundTileImg.width/groundTileImg.height;
    // Determine how far the ground has scrolled
    const offsetX = (cameraX % tileW + tileW) % tileW;
    // Repeat tiles across the width of the canvas
    for (let x = -offsetX; x < WIDTH; x += tileW) {
      ctx.drawImage(groundTileImg, x, HEIGHT - tileH, tileW, tileH);
    }
  } else {
    // Fallback simple ground
    for (let i = 0; i < WIDTH; i += 8) {
      ctx.fillStyle = (i / 8) % 2 === 0 ? '#5c7a53' : '#4d6a46';
      ctx.fillRect(i, groundAreaTop, 8, HEIGHT - groundAreaTop);
    }
    ctx.fillStyle = '#3e3c2d';
    ctx.fillRect(0, groundLineY - 2, WIDTH, 4);
  }
}

function gameLoop() {
  console.log("gameloop");
  update();
  drawScenery();
  drawCharacters();
  drawPlayer();
  requestAnimationFrame(gameLoop);
}
//requestAnimationFrame(gameLoop);
