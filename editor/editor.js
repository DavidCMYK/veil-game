/* Stage 1 editor:
   - Load areas.json, characters.json, plus any dialog jsons
   - Show a tree
   - Inspect JSON
   - Save current / save all via downloads
*/

const inspector = document.getElementById("inspector");
const btnOpenFolder = document.getElementById("btnOpenFolder");

let projectDirHandle = null;
let dataDirHandle = null;
let currentWarningsContainer = null;
let expandedRules = new Set(); // stores rule indices
const expandedAreaSections = new Set(); // key: "AreaName::SectionName"

let dialogMarkerCounter = 0;

let currentDialogKey = null;
let currentPhraseId = null;
const expandedDialogPhrases = new Set();

let currentRuleChar = null;
let currentRuleIndex = null;


const els = {
  btnClear: document.getElementById("btnClear"),
  btnSaveCurrent: document.getElementById("btnSaveCurrent"),
  btnSaveAll: document.getElementById("btnSaveAll"),
  btnViewDiff: document.getElementById("btnViewDiff"),
  status: document.getElementById("status"),
  tree: document.getElementById("tree"),
  inspectorTitle: document.getElementById("inspectorTitle"),
};


const state = {
  // in-memory world model
  world: {
    areas: null,
    characters: null,
    rules: null,
    items: null,
    objects: null,
    abilities: null,
    mobs: null,
    factions: null,
    dialogs: {}, // key: "mira" / "rowyn" derived from filename
  },
  original: {
    areas: null,
    characters: null,
    rules: null,
    items: null,
    objects: null,
    abilities: null,
    mobs: null,
    factions: null,
    dialogs: {},
  },
  // original filenames so we can save back with same names
  files: {
    areas: null,       // { name, data }
    characters: null,  // { name, data }
    rules: null,
    items: null,
    objects: null,
    abilities: null,
    mobs: null,
    factions: null,
    dialogs: {},       // key -> { name, data }
  },
  selection: null, // { type: "areas"|"characters"|"rules"|"items"|"objects"|"abilities"|"mobs"|"factions"|"dialog", key?: string }
  dialogSearch: "",
};

let dirtyRefreshQueued = false;

function refreshDirtyState() {
  buildTree();
  enableSaveButtons();
}

function queueDirtyRefresh() {
  if (dirtyRefreshQueued) return;
  dirtyRefreshQueued = true;
  requestAnimationFrame(() => {
    dirtyRefreshQueued = false;
    refreshDirtyState();
  });
}

function setStatus(msg, isError = false) {
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.style.color = isError ? "var(--danger)" : "var(--muted)";
}


function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function deriveDialogKeyFromFilename(filename) {
  // "mira.json" -> "mira"
  // "rowyn.dialog.json" -> "rowyn.dialog" (still fine)
  return filename.replace(/\.json$/i, "").trim();
}

async function hasFileHandle(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

async function getDirectoryHandleSafe(dirHandle, name) {
  try {
    return await dirHandle.getDirectoryHandle(name, { create: false });
  } catch {
    return null;
  }
}

async function resolveDataDir(rootDirHandle) {
  if (await hasFileHandle(rootDirHandle, "areas.json")) return rootDirHandle;
  const dataDir = await getDirectoryHandleSafe(rootDirHandle, "data");
  return dataDir;
}

async function loadJsonFromHandle(fileHandle) {
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

async function getFileHandleByRelativePath(rootDirHandle, relPath) {
  // relPath like "dialogs/mira.json" or "mira.json"
  const parts = relPath.split("/").filter(Boolean);
  let dir = rootDirHandle;

  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: false });
  }


  const filename = parts[parts.length - 1];
  return await dir.getFileHandle(filename, { create: false });
}

async function loadAllDialogs() {
  if (!dataDirHandle) return;

  const dialogsDir = await getDirectoryHandleSafe(dataDirHandle, "dialogs");
  if (!dialogsDir) return;

  for await (const [name, handle] of dialogsDir.entries()) {
    if (handle.kind !== "file") continue;
    if (!name.toLowerCase().endsWith(".json")) continue;

    const data = await loadJsonFromHandle(handle);
    const key = deriveDialogKeyFromFilename(name.toLowerCase());

    state.world.dialogs[key] = data;
    state.files.dialogs[key] = { name, handle };
    markOriginal("dialog", data, key);
  }
}

function getDialogOptionIds(npc) {
  const dialog = state.world.dialogs[npc?.toLowerCase()];
  if (!dialog || !dialog.phrases) return [];

  const ids = new Set();

  for (const phrase of Object.values(dialog.phrases)) {
    if (!phrase || typeof phrase !== "object") continue;
    if (!phrase.options || typeof phrase.options !== "object") continue;

    for (const optionId of Object.keys(phrase.options)) {
      ids.add(optionId);
    }
  }

  return Array.from(ids);
}

function enableSaveButtons() {
  const hasAny =
    !!state.world.areas ||
    !!state.world.characters ||
    !!state.world.rules ||
    !!state.world.items ||
    !!state.world.objects ||
    !!state.world.abilities ||
    !!state.world.mobs ||
    !!state.world.factions ||
    Object.keys(state.world.dialogs).length > 0;

  els.btnSaveAll.disabled = !hasAny;
  els.btnSaveCurrent.disabled = !state.selection;
  if (els.btnViewDiff) {
    els.btnViewDiff.disabled = !state.selection || !isSelectionDirty(state.selection);
  }
}

function clearAll() {
  dataDirHandle = null;
  state.world.areas = null;
  state.world.characters = null;
  state.world.rules = null;
  state.world.items = null;
  state.world.objects = null;
  state.world.abilities = null;
  state.world.mobs = null;
  state.world.factions = null;
  state.world.dialogs = {};
  state.files.areas = null;
  state.files.characters = null;
  state.files.rules = null;
  state.files.items = null;
  state.files.objects = null;
  state.files.abilities = null;
  state.files.mobs = null;
  state.files.factions = null;
  state.files.dialogs = {};
  state.original.dialogs = {};
  state.selection = null;
  expandedRules.clear();
  state.dialogSearch = "";
  expandedAreaSections.clear();
  expandedDialogPhrases.clear();
  dirtyRefreshQueued = false;

  els.inspectorTitle.textContent = "Inspector";
  els.tree.innerHTML = "";
  enableSaveButtons();
  setStatus("Cleared. Load game data from the data/ folder.");
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, "-");
}

async function ensureArchiveFolder() {
  if (!dataDirHandle) throw new Error("Data folder not loaded.");
  return await dataDirHandle.getDirectoryHandle("archive", { create: true });
}

async function archiveAndWrite(fileEntry, data) {
  const archiveDir = await ensureArchiveFolder();

  // Read current file before overwriting
  const oldFile = await fileEntry.handle.getFile();
  const oldText = await oldFile.text();

  const archivedName =
    fileEntry.name.replace(/\.json$/i, "") +
    "_" + timestamp() + ".json";

  const archiveFile = await archiveDir.getFileHandle(archivedName, { create: true });
  const archiveStream = await archiveFile.createWritable();
  await archiveStream.write(oldText);
  await archiveStream.close();

  // Write new version
  const writeStream = await fileEntry.handle.createWritable();
  await writeStream.write(pretty(data));
  await writeStream.close();
}

function selectNode(node) {
  state.selection = node;
  enableSaveButtons();
  inspector.innerHTML = "";

  if (!inspector.dataset.dirtyListener) {
    inspector.dataset.dirtyListener = "1";
    inspector.addEventListener("input", () => queueDirtyRefresh());
    inspector.addEventListener("change", () => queueDirtyRefresh());
  }

  document.querySelectorAll(".treeItem").forEach((el) => el.classList.remove("active"));
  const active = document.querySelector(`.treeItem[data-node="${node.type}:${node.key ?? ""}"]`);
  if (active) active.classList.add("active");

  if (node.type === "areas" && node.key?.startsWith("area:")) {
    const areaName = node.key.replace("area:", "");
    renderAreaEditor(areaName);
    return;
  }

  if (node.type === "characters" && node.key?.startsWith("char:")) {
    const charName = node.key.replace("char:", "");
    renderCharacterEditor(charName);
    return;
  }

  if (node.type === "rules") {
    renderRulesEditor();
    return;
  }

  if (node.type === "items") {
    renderRawJsonEditor("items.json", state.world.items, (v) => {
      state.world.items = v;
    });
    return;
  }

  if (node.type === "objects") {
    renderRawJsonEditor("objects.json", state.world.objects, (v) => {
      state.world.objects = v;
    });
    return;
  }

  if (node.type === "abilities") {
    renderRawJsonEditor("abilities.json", state.world.abilities, (v) => {
      state.world.abilities = v;
    });
    return;
  }

  if (node.type === "mobs") {
    renderRawJsonEditor("mobs.json", state.world.mobs, (v) => {
      state.world.mobs = v;
    });
    return;
  }

  if (node.type === "factions") {
    renderRawJsonEditor("factions.json", state.world.factions, (v) => {
      state.world.factions = v;
    });
    return;
  }

  // fallback: raw JSON view
  const pre = document.createElement("pre");
  pre.className = "jsonView";

  if (node.type === "areas") {
    els.inspectorTitle.textContent = "areas.json";
    pre.textContent = pretty(state.world.areas);
  } else if (node.type === "characters") {
    els.inspectorTitle.textContent = "characters.json";
    pre.textContent = pretty(state.world.characters);
  } else if (node.type === "rules") {
    els.inspectorTitle.textContent = "rules.json";
    pre.textContent = pretty(state.world.rules);
  } else if (node.type === "items") {
    els.inspectorTitle.textContent = "items.json";
    pre.textContent = pretty(state.world.items);
  } else if (node.type === "objects") {
    els.inspectorTitle.textContent = "objects.json";
    pre.textContent = pretty(state.world.objects);
  } else if (node.type === "abilities") {
    els.inspectorTitle.textContent = "abilities.json";
    pre.textContent = pretty(state.world.abilities);
  } else if (node.type === "mobs") {
    els.inspectorTitle.textContent = "mobs.json";
    pre.textContent = pretty(state.world.mobs);
  } else if (node.type === "factions") {
    els.inspectorTitle.textContent = "factions.json";
    pre.textContent = pretty(state.world.factions);
  } else if (node.type === "dialog") {
    renderDialogEditor(node.key);
  }

  inspector.appendChild(pre);
}

function buildTree() {
  els.tree.innerHTML = "";

  // Areas group
  els.tree.appendChild(makeGroup("Areas", [
    makeItem("areas.json", { type: "areas" }, !!state.world.areas),
    ...(state.world.areas ? Object.keys(state.world.areas).map((areaName) =>
      makeItem(areaName, { type: "areas", key: `area:${areaName}` }, true, true)
    ) : []),
  ]));

  // Characters group
  els.tree.appendChild(makeGroup("Characters", [
    makeItem("characters.json", { type: "characters" }, !!state.world.characters),
    ...(state.world.characters ? Object.keys(state.world.characters).map((charName) =>
      makeItem(charName, { type: "characters", key: `char:${charName}` }, true, true)
    ) : []),
  ]));

  // Dialogs group
  const dialogKeys = Object.keys(state.world.dialogs);
  els.tree.appendChild(makeGroup("Dialogs", [
    ...(dialogKeys.length
      ? dialogKeys
          .sort((a, b) => a.localeCompare(b))
          .map((k) => makeItem(state.files.dialogs[k]?.name ?? (k + ".json"), { type: "dialog", key: k }, true))
      : [makeItem("(none loaded)", { type: "dialog", key: "__none__" }, false)]),
  ]));

  // Rules group
  els.tree.appendChild(makeGroup("Rules", [
    makeItem("rules.json", { type: "rules" }, !!state.world.rules),
  ]));

  // Items group
  els.tree.appendChild(makeGroup("Items", [
    makeItem("items.json", { type: "items" }, !!state.world.items),
  ]));

  // Objects group
  els.tree.appendChild(makeGroup("Objects", [
    makeItem("objects.json", { type: "objects" }, !!state.world.objects),
  ]));

  // Abilities group
  els.tree.appendChild(makeGroup("Abilities", [
    makeItem("abilities.json", { type: "abilities" }, !!state.world.abilities),
  ]));

  // Mobs group
  els.tree.appendChild(makeGroup("Mobs", [
    makeItem("mobs.json", { type: "mobs" }, !!state.world.mobs),
  ]));

  // Factions group
  els.tree.appendChild(makeGroup("Factions", [
    makeItem("factions.json", { type: "factions" }, !!state.world.factions),
  ]));

}

function makeGroup(title, items) {
  const wrap = document.createElement("div");
  wrap.className = "treeGroup";

  const h = document.createElement("div");
  h.className = "treeGroupHeader";
  h.textContent = title;

  const body = document.createElement("div");
  body.className = "treeItems";
  items.forEach((it) => body.appendChild(it));

  wrap.appendChild(h);
  wrap.appendChild(body);
  return wrap;
}

function makeItem(label, node, enabled, isChild = false) {
  const item = document.createElement("div");
  item.className = "treeItem";
  item.style.opacity = enabled ? "1" : "0.55";
  item.textContent = isChild ? `↳ ${label}` : label;

  if (enabled) {
    if (node.type === "dialog") {
      const dialog = state.world.dialogs[node.key];
      if (dialog && isDirty("dialog", dialog, node.key)) {
        item.classList.add("dirty");
      }
    } else if (state.world[node.type]) {
      if (isDirty(node.type, state.world[node.type])) {
        item.classList.add("dirty");
      }
    }
  }

  const nodeKey = `${node.type}:${node.key ?? ""}`;
  item.dataset.node = nodeKey;

  if (enabled) {
    item.onclick = () => selectNode(node);
  }


  return item;
}

async function readFileAsJson(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${file.name}: ${e.message}`);
  }
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));

  const areasFile = byName.get("areas.json");
  const charactersFile = byName.get("characters.json");

  // Load known files first
  const loaded = [];
  const errors = [];

  async function loadKnown(kind, file) {
    try {
      const data = await readFileAsJson(file);
      state.world[kind] = data;
      state.files[kind] = { name: file.name, data };
      markOriginal(kind, data);
      loaded.push(file.name);
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (areasFile) await loadKnown("areas", areasFile);
  if (charactersFile) await loadKnown("characters", charactersFile);

  // Everything else that's .json we treat as dialog for now
  const dialogCandidates = files.filter((f) => {
    const n = f.name.toLowerCase();
    return n.endsWith(".json") && n !== "areas.json" && n !== "characters.json";
  });

  for (const f of dialogCandidates) {
    try {
      const data = await readFileAsJson(f);
      const key = deriveDialogKeyFromFilename(f.name.toLowerCase());
      state.world.dialogs[key] = data;
      state.files.dialogs[key] = { name: f.name, data };
      markOriginal("dialog", data, key);
      loaded.push(f.name);
    } catch (err) {
      errors.push(err.message);
    }
  }

  buildTree();
  enableSaveButtons();

  if (errors.length) {
    setStatus(`Loaded: ${loaded.join(", ") || "(none)"} | Errors: ${errors.join(" | ")}`, true);
  } else {
    setStatus(`Loaded: ${loaded.join(", ") || "(none)"}`);
  }
}

async function saveCurrent() {
  const sel = state.selection;
  if (!sel || !dataDirHandle) return;

  try {
    if (sel.type === "areas") {
      await archiveAndWrite(state.files.areas, state.world.areas);
      markOriginal("areas", state.world.areas);
      setStatus("Saved areas.json");
    }

    if (sel.type === "characters") {
      await archiveAndWrite(state.files.characters, state.world.characters);
      markOriginal("characters", state.world.characters);
      setStatus("Saved characters.json");
    }

    if (sel.type === "rules") {
      await archiveAndWrite(state.files.rules, state.world.rules);
      markOriginal("rules", state.world.rules);
      setStatus("Saved rules.json");
    }

    if (sel.type === "items") {
      await archiveAndWrite(state.files.items, state.world.items);
      markOriginal("items", state.world.items);
      setStatus("Saved items.json");
    }

    if (sel.type === "objects") {
      await archiveAndWrite(state.files.objects, state.world.objects);
      markOriginal("objects", state.world.objects);
      setStatus("Saved objects.json");
    }

    if (sel.type === "abilities") {
      await archiveAndWrite(state.files.abilities, state.world.abilities);
      markOriginal("abilities", state.world.abilities);
      setStatus("Saved abilities.json");
    }

    if (sel.type === "mobs") {
      await archiveAndWrite(state.files.mobs, state.world.mobs);
      markOriginal("mobs", state.world.mobs);
      setStatus("Saved mobs.json");
    }

    if (sel.type === "factions") {
      await archiveAndWrite(state.files.factions, state.world.factions);
      markOriginal("factions", state.world.factions);
      setStatus("Saved factions.json");
    }

    if (sel.type === "dialog") {
      const f = state.files.dialogs[sel.key];

      const dialog = state.world.dialogs[sel.key];
      await archiveAndWrite(f, dialog);
      markOriginal("dialog", dialog, sel.key);
      setStatus(`Saved ${f.name}`);
      refreshDirtyState();
    }

  } catch (e) {
    setStatus(e.message, true);
  }
}


async function saveAll() {
  if (!dataDirHandle) return;

  try {
    if (state.files.areas)
      await archiveAndWrite(state.files.areas, state.world.areas);

    if (state.files.characters)
      await archiveAndWrite(state.files.characters, state.world.characters);

    if (state.files.rules)
      await archiveAndWrite(state.files.rules, state.world.rules);

    if (state.files.items)
      await archiveAndWrite(state.files.items, state.world.items);

    if (state.files.objects)
      await archiveAndWrite(state.files.objects, state.world.objects);

    if (state.files.abilities)
      await archiveAndWrite(state.files.abilities, state.world.abilities);

    if (state.files.mobs)
      await archiveAndWrite(state.files.mobs, state.world.mobs);

    if (state.files.factions)
      await archiveAndWrite(state.files.factions, state.world.factions);

    for (const key of Object.keys(state.files.dialogs)) {
      const dialog = state.world.dialogs[key];
      await archiveAndWrite(state.files.dialogs[key], dialog);
    }

    markOriginal("areas", state.world.areas);
    markOriginal("characters", state.world.characters);
    markOriginal("rules", state.world.rules);
    markOriginal("items", state.world.items);
    markOriginal("objects", state.world.objects);
    markOriginal("abilities", state.world.abilities);
    markOriginal("mobs", state.world.mobs);
    markOriginal("factions", state.world.factions);
    Object.keys(state.world.dialogs).forEach((key) => {
      markOriginal("dialog", state.world.dialogs[key], key);
    });

    setStatus("All files saved.");
    refreshDirtyState();
  } catch (e) {
    setStatus(e.message, true);
  }
}

function renderBackObjectsEditor(form, label, list, rerender) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = label;
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  list.forEach((obj, i) => {
    const row = document.createElement("div");
    row.className = "deltaRow";

    const name = document.createElement("input");
    name.value = obj.name ?? "";
    name.placeholder = "name";
    name.style.flex = "1";
    name.oninput = () => (obj.name = name.value);

    const height = document.createElement("input");
    height.type = "number";
    height.value = obj.height ?? 0;
    height.style.width = "70px";
    height.oninput = () => (obj.height = Number(height.value));

    const del = document.createElement("button");
    del.textContent = "✕";
    del.onclick = () => {
      list.splice(i, 1);
      rerender();
    };

    row.appendChild(name);
    row.appendChild(height);
    row.appendChild(del);
    block.appendChild(row);
  });

  const add = document.createElement("button");
  add.textContent = "Add";
  add.onclick = () => {
    list.push({ name: "", height: 0 });
    rerender();
  };

  block.appendChild(add);
  form.appendChild(block);
}

function renderForeObjectsEditor(form, label, list, rerender) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = label;
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  list.forEach((obj, i) => {
    const row = document.createElement("div");
    row.className = "deltaRow";

    const name = document.createElement("input");
    name.value = obj.name ?? "";
    name.placeholder = "name";
    name.style.flex = "1";
    name.oninput = () => (obj.name = name.value);

    const height = document.createElement("input");
    height.type = "number";
    height.value = obj.height ?? 0;
    height.style.width = "60px";
    height.oninput = () => (obj.height = Number(height.value));

    const density = document.createElement("input");
    density.type = "number";
    density.value = obj.density ?? "";
    density.placeholder = "density";
    density.style.width = "60px";
    density.oninput = () => {
      obj.density =
        density.value === "" ? undefined : Number(density.value);
    };

    const del = document.createElement("button");
    del.textContent = "✕";
    del.onclick = () => {
      list.splice(i, 1);
      rerender();
    };

    row.appendChild(name);
    row.appendChild(height);
    row.appendChild(density);
    row.appendChild(del);
    block.appendChild(row);
  });

  const add = document.createElement("button");
  add.textContent = "Add";
  add.onclick = () => {
    list.push({ name: "", height: 0 });
    rerender();
  };

  block.appendChild(add);
  form.appendChild(block);
}

function renderSectionForeObjectsEditor(container, list, rerender) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = "Foreground objects";
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  list.forEach((obj, i) => {
    const row = document.createElement("div");
    row.className = "deltaRow";

    const name = document.createElement("input");
    name.value = obj.name ?? "";
    name.placeholder = "name";
    name.style.flex = "1";
    name.oninput = () => (obj.name = name.value);

    const height = document.createElement("input");
    height.type = "number";
    height.value = obj.height ?? 0;
    height.style.width = "60px";
    height.oninput = () => (obj.height = Number(height.value));

    const density = document.createElement("input");
    density.type = "number";
    density.value = obj.density ?? "";
    density.placeholder = "density";
    density.style.width = "60px";
    density.oninput = () => {
      obj.density =
        density.value === "" ? undefined : Number(density.value);
    };

    const del = document.createElement("button");
    del.textContent = "✕";
    del.onclick = () => {
      list.splice(i, 1);
      rerender();
    };

    row.appendChild(name);
    row.appendChild(height);
    row.appendChild(density);
    row.appendChild(del);
    block.appendChild(row);
  });

  const add = document.createElement("button");
  add.textContent = "Add foreground object";
  add.onclick = () => {
    list.push({ name: "", height: 0 });
    rerender();
  };

  block.appendChild(add);
  container.appendChild(block);
}

function renderJsonArrayEditor(container, label, list, rerender, options = {}) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = label;
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  list.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "deltaRow";
    row.style.flexDirection = "column";

    const json = makeJsonTextarea(item, (v) => {
      list[i] = v;
    }, { minHeight: options.minHeight ?? 60 });

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = () => {
      list.splice(i, 1);
      rerender();
    };

    row.appendChild(json);
    row.appendChild(del);
    block.appendChild(row);
  });

  const add = document.createElement("button");
  add.textContent = options.addLabel ?? "Add";
  add.onclick = () => {
    const next = options.defaultItem ? JSON.parse(JSON.stringify(options.defaultItem)) : {};
    list.push(next);
    rerender();
  };

  block.appendChild(add);
  container.appendChild(block);
}

function renderKeyedObjectEditor(container, label, obj, rerender) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = label;
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  Object.entries(obj).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "deltaRow";
    row.style.flexDirection = "column";

    const keyRow = document.createElement("div");
    keyRow.style.display = "flex";
    keyRow.style.gap = "6px";

    const keyInput = document.createElement("input");
    keyInput.value = key;
    keyInput.placeholder = "id";
    keyInput.style.flex = "1";
    keyInput.onchange = () => {
      if (!keyInput.value || keyInput.value === key) return;
      obj[keyInput.value] = obj[key];
      delete obj[key];
      rerender();
    };

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = () => {
      delete obj[key];
      rerender();
    };

    keyRow.appendChild(keyInput);
    keyRow.appendChild(del);
    row.appendChild(keyRow);

    const json = makeJsonTextarea(value, (v) => {
      obj[key] = v;
    });

    row.appendChild(json);
    block.appendChild(row);
  });

  const add = document.createElement("button");
  add.textContent = "Add";
  add.onclick = () => {
    const id = prompt("New ID");
    if (!id) return;
    if (obj[id]) {
      alert("ID already exists.");
      return;
    }
    obj[id] = {};
    rerender();
  };

  block.appendChild(add);
  container.appendChild(block);
}

function renderAreaEditor(areaName) {
  const area = state.world.areas[areaName];
  els.inspectorTitle.textContent = `Area: ${areaName}`;
  inspector.innerHTML = "";

  const form = document.createElement("div");
  form.className = "form";

  // leftarea / rightarea
  form.appendChild(makeInput("Left area", area.leftarea, (v) => {
    area.leftarea = v || null;
  }));

  form.appendChild(makeInput("Right area", area.rightarea, (v) => {
    area.rightarea = v || null;
  }));

  form.appendChild(
    makeInput("Default ground", area.defaultground, (v) => {
      area.defaultground = v || null;
    })
  );

  // Section count (read-only display, derived from UI state)
  const sectionCountRow = document.createElement("div");
  sectionCountRow.className = "formRow";

  const sectionCountLabel = document.createElement("label");
  sectionCountLabel.textContent = "Section count";

  const sectionCountValue = document.createElement("div");
  sectionCountValue.textContent = area.sectioncount ?? 0;
  sectionCountValue.style.opacity = "0.8";

  sectionCountRow.appendChild(sectionCountLabel);
  sectionCountRow.appendChild(sectionCountValue);
  form.appendChild(sectionCountRow);


  renderStringArrayEditor(
    form,
    "Backgrounds",
    area.backgrounds ?? (area.backgrounds = []),
    () => renderAreaEditor(areaName)
  );

  renderStringArrayEditor(
    form,
    "Distant backgrounds",
    area.distantbackgrounds ?? (area.distantbackgrounds = []),
    () => renderAreaEditor(areaName)
  );

  renderBackObjectsEditor(
    form,
    "Back objects",
    area.backobjects ?? (area.backobjects = []),
    () => renderAreaEditor(areaName)
  );

  renderForeObjectsEditor(
    form,
    "Foreground objects",
    area.foreobjects ?? (area.foreobjects = []),
    () => renderAreaEditor(areaName)
  );


  // sections
  const sectionList = document.createElement("div");
  sectionList.className = "sectionList";

  const title = document.createElement("div");
  title.textContent = "Sections";
  title.style.fontWeight = "700";
  title.style.marginBottom = "6px";
  sectionList.appendChild(title);

  const explicitByPosition = {};
  Object.entries(area.sections || {}).forEach(([name, data]) => {
    explicitByPosition[data.position] = name;
  });

  const addSectionBtn = document.createElement("button");
  addSectionBtn.textContent = "+ Add section";
  addSectionBtn.onclick = () => {
    area.sectioncount = (area.sectioncount || 0) + 1;
    renderAreaEditor(areaName);
  };
  sectionList.appendChild(addSectionBtn);


  for (let i = 1; i <= area.sectioncount; i++) {
    const sectionName = explicitByPosition[i];

    const row = document.createElement("div");
    row.className = "sectionItem";

    if (sectionName) {
      const label = document.createElement("span");
      label.textContent = `[${i}] ${sectionName}`;
      label.style.flex = "1";
      row.appendChild(label);

      const up = document.createElement("button");
      up.textContent = "⬆";
      up.disabled = area.sections[sectionName].position === 1;
      up.onclick = (e) => {
        e.stopPropagation();
        moveSection(areaName, sectionName, -1);
      };

      const down = document.createElement("button");
      down.textContent = "⬇";
      down.disabled = area.sections[sectionName].position === area.sectioncount;
      down.onclick = (e) => {
        e.stopPropagation();
        moveSection(areaName, sectionName, 1);
      };

      row.appendChild(up);
      row.appendChild(down);

      const del = document.createElement("button");
      del.textContent = "✕";
      del.onclick = (e) => {
        e.stopPropagation();
        deleteSection(areaName, sectionName);
      };

      row.appendChild(del);

      row.onclick = () => {
        const key = `${areaName}::${sectionName}`;
        if (expandedAreaSections.has(key)) {
          expandedAreaSections.delete(key);
        } else {
          expandedAreaSections.add(key);
        }
        renderAreaEditor(areaName);
      };
    } else {
      row.classList.add("implicit");

      const label = document.createElement("span");
      label.textContent = `[${i}] (implicit section)`;
      label.style.flex = "1";

      const del = document.createElement("button");
      del.textContent = "✕";
      del.onclick = (e) => {
        e.stopPropagation();
        deleteImplicitSection(areaName, i);
      };

      row.appendChild(label);
      row.appendChild(del);

      row.onclick = () => createSectionFromImplicit(areaName, i);
    }


    sectionList.appendChild(row);
    if (sectionName) {
      const key = `${areaName}::${sectionName}`;
      if (expandedAreaSections.has(key)) {
        const inner = document.createElement("div");
        inner.style.marginLeft = "16px";
        inner.style.marginTop = "6px";
        inner.style.marginBottom = "6px";

        renderSectionEditorInline(areaName, sectionName, inner);
        sectionList.appendChild(inner);
      }
    }

  }


  form.appendChild(sectionList);
  inspector.appendChild(form);
}

function moveSection(areaName, sectionName, delta) {
  const area = state.world.areas[areaName];
  const section = area.sections[sectionName];
  const newPos = section.position + delta;

  if (newPos < 1 || newPos > area.sectioncount) return;

  const other = Object.entries(area.sections)
    .find(([_, s]) => s.position === newPos);

  if (other) {
    other[1].position = section.position;
  }

  section.position = newPos;
  renderAreaEditor(areaName);
}


function renderSectionExitsEditor(container, exits, rerender) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = "Exits";
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  Object.entries(exits).forEach(([id, ex]) => {
    const row = document.createElement("div");
    row.className = "form";

    row.appendChild(
      makeInput("ID", id, () => {}, "text", true)
    );

    row.appendChild(
      makeSelect(
        "Direction",
        ["up", "down", "left", "right"],
        ex.direction,
        (v) => (ex.direction = v)
      )
    );

    row.appendChild(
      makeInput("Position", ex.Position ?? ex.position ?? 0, (v) => {
        ex.Position = Number(v);
      }, "number")
    );

    row.appendChild(
      makeInput("Target exit", ex.targetexit ?? "", (v) => {
        ex.targetexit = v;
      })
    );

    const del = document.createElement("button");
    del.textContent = "✕";
    del.onclick = () => {
      delete exits[id];
      rerender();
    };

    row.appendChild(del);
    block.appendChild(row);
  });

  const add = document.createElement("button");
  add.textContent = "Add exit";
  add.onclick = () => {
    const id = String(Date.now());
    exits[id] = { direction: "up", Position: 0, targetexit: "" };
    rerender();
  };

  block.appendChild(add);
  container.appendChild(block);
}


function renderSectionEditorInline(areaName, sectionName, mount) {
  const section = state.world.areas[areaName].sections[sectionName];
  if (!section) return;

  const form = document.createElement("div");
  form.className = "form";

  form.appendChild(
    makeInput("Position", section.position, (v) => {
      section.position = Number(v);
    }, "number")
  );

  form.appendChild(
    makeInput("Ground image", section.groundimage, (v) => {
      section.groundimage = v;
    })
  );

  mount.appendChild(form);

  

  const charBlock = document.createElement("div");
  charBlock.className = "sectionList";

  const ch = document.createElement("div");
  ch.textContent = "Character";
  ch.style.fontWeight = "700";
  charBlock.appendChild(ch);

  if (!section.characters) {
    const add = document.createElement("button");
    add.textContent = "Add character";
    add.onclick = () => {
      section.characters = { name: "", position: 0 };
      renderAreaEditor(areaName);
    };
    charBlock.appendChild(makeReadonly("(none)", ""));
    charBlock.appendChild(add);
  } else {
    charBlock.appendChild(
      makeInput("Name", section.characters.name, (v) => {
        section.characters.name = v;
      })
    );

    charBlock.appendChild(
      makeInput("Position", section.characters.position, (v) => {
        section.characters.position = Number(v);
      }, "number")
    );

    charBlock.appendChild(
      makeInput("Mode", section.characters.mode ?? "", (v) => {
        section.characters.mode = v;
      })
    );

    charBlock.appendChild(
      makeInput("Auto-cast ability", section.characters.autoCastAbility ?? "", (v) => {
        section.characters.autoCastAbility = v;
      })
    );

    const del = document.createElement("button");
    del.textContent = "Remove character";
    del.onclick = () => {
      delete section.characters;
      renderAreaEditor(areaName);
    };

    charBlock.appendChild(del);
  }

  mount.appendChild(charBlock);

  // Ground back objects
  if (!section.groundBackObjects) {
    section.groundBackObjects = [];
  }

  renderJsonArrayEditor(
    mount,
    "Ground back objects",
    section.groundBackObjects,
    () => renderAreaEditor(areaName),
    { addLabel: "Add ground back object", defaultItem: { name: "", position: 0 } }
  );

  // Ground fore objects
  if (!section.groundForeObjects) {
    section.groundForeObjects = [];
  }

  renderJsonArrayEditor(
    mount,
    "Ground fore objects",
    section.groundForeObjects,
    () => renderAreaEditor(areaName),
    { addLabel: "Add ground fore object", defaultItem: { name: "", position: 0 } }
  );

  // Section foreobjects
  if (!section.foreobjects) {
    section.foreobjects = [];
  }

  renderSectionForeObjectsEditor(
    mount,
    section.foreobjects,
    () => renderAreaEditor(areaName)
  );

  // Section items
  if (!section.items) {
    section.items = [];
  }

  renderJsonArrayEditor(
    mount,
    "Items",
    section.items,
    () => renderAreaEditor(areaName),
    { addLabel: "Add item", defaultItem: { item: "", position: 0 } }
  );

  // Section mobs
  if (!section.mobs) {
    section.mobs = [];
  }

  renderJsonArrayEditor(
    mount,
    "Mobs",
    section.mobs,
    () => renderAreaEditor(areaName),
    { addLabel: "Add mob", defaultItem: { id: "", position: 0 } }
  );

  // Safe places
  if (!section.safeplaces) {
    section.safeplaces = {};
  }

  renderKeyedObjectEditor(
    mount,
    "Safe places",
    section.safeplaces,
    () => renderAreaEditor(areaName)
  );

  // Section exits
  if (!section.exits) {
    section.exits = {};
  }

  renderSectionExitsEditor(
    mount,
    section.exits,
    () => renderAreaEditor(areaName)
  );
}

function deleteImplicitSection(areaName, position) {
  const area = state.world.areas[areaName];

  // Shift explicit sections down
  Object.values(area.sections || {}).forEach((s) => {
    if (s.position > position) {
      s.position -= 1;
    }
  });

  area.sectioncount -= 1;
  renderAreaEditor(areaName);
}

function deleteSection(areaName, sectionName) {
  const area = state.world.areas[areaName];
  const section = area.sections[sectionName];

  if (!section) return;

  // 1. Check populated fields (excluding name/position)
  const hasData =
    section.characters ||
    (section.foreobjects && section.foreobjects.length > 0) ||
    (section.groundBackObjects && section.groundBackObjects.length > 0) ||
    (section.groundForeObjects && section.groundForeObjects.length > 0) ||
    (section.items && section.items.length > 0) ||
    (section.mobs && section.mobs.length > 0) ||
    (section.safeplaces && Object.keys(section.safeplaces).length > 0) ||
    (section.exits && Object.keys(section.exits).length > 0) ||
    section.groundimage;

  if (hasData) {
    alert("Cannot delete section: section has data.");
    return;
  }

  // 2. Check rule references
  const refs = [];

  (state.world.rules || []).forEach((rule) => {
    if (rule?.triggerWhen?.event === "section_enter") {
      const sec = rule.triggerWhen.section;
      const secs = rule.triggerWhen.sections;
      if (sec === sectionName || (Array.isArray(secs) && secs.includes(sectionName))) {
        refs.push(rule.id || "(unnamed rule)");
      }
    }
  });

  if (refs.length > 0) {
    alert(
      "Cannot delete section. Referenced by rules:\n\n" +
        refs.join("\n")
    );
    return;
  }

  // 3. Delete + re-pack positions
  const removedPos = section.position;
  delete area.sections[sectionName];

  Object.values(area.sections).forEach((s) => {
    if (s.position > removedPos) {
      s.position -= 1;
    }
  });

  area.sectioncount -= 1;

  renderAreaEditor(areaName);
}


function renderSectionEditor(areaName, sectionName) {
  const section = state.world.areas[areaName].sections[sectionName];
  els.inspectorTitle.textContent = `Section: ${areaName}.${sectionName}`;
  inspector.innerHTML = "";

  const form = document.createElement("div");
  form.className = "form";

  form.appendChild(makeInput("Position", section.position, (v) => {
    section.position = Number(v);
  }, "number"));

  form.appendChild(makeInput("Ground image", section.groundimage, (v) => {
    section.groundimage = v;
  }));

  if (section.characters) {
    form.appendChild(makeInput("Character", section.characters.name, (v) => {
      section.characters.name = v;
    }));

    form.appendChild(makeInput("Char position", section.characters.position, (v) => {
      section.characters.position = Number(v);
    }, "number"));
  }

  inspector.appendChild(form);
}

function renderCharacterEditor(charName) {
  const character = state.world.characters[charName];
  els.inspectorTitle.textContent = `Character: ${charName}`;
  inspector.innerHTML = "";

  const form = document.createElement("div");
  form.className = "form";

  form.appendChild(
    makeJsonEditorRow("Starting stats", character.startingStats ?? {}, (v) => {
      character.startingStats = v;
    })
  );

  renderStringArrayEditor(
    form,
    "Factions",
    character.factions ?? (character.factions = []),
    () => renderCharacterEditor(charName)
  );

  renderStringArrayEditor(
    form,
    "Abilities",
    character.abilities ?? (character.abilities = []),
    () => renderCharacterEditor(charName)
  );

  renderStringArrayEditor(
    form,
    "Interacts",
    character.interacts ?? (character.interacts = []),
    () => renderCharacterEditor(charName)
  );

  form.appendChild(
    makeInput("Inventory size", character.inventorySize ?? "", (v) => {
      character.inventorySize = v === "" ? null : Number(v);
    }, "number")
  );

  form.appendChild(
    makeJsonEditorRow("Alliance by faction", character.allianceByFaction ?? {}, (v) => {
      character.allianceByFaction = v;
    })
  );

  form.appendChild(
    makeJsonEditorRow("AI", character.ai ?? {}, (v) => {
      character.ai = v;
    }, { minHeight: 120 })
  );

  form.appendChild(
    makeJsonEditorRow("Goals", character.goals ?? [], (v) => {
      character.goals = v;
    }, { minHeight: 120 })
  );

  inspector.appendChild(form);
}

function renderRawJsonEditor(title, value, onChange) {
  els.inspectorTitle.textContent = title;
  inspector.innerHTML = "";

  const form = document.createElement("div");
  form.className = "form";

  form.appendChild(
    makeJsonEditorRow("JSON", value, (v) => {
      onChange(v);
    }, { minHeight: 220 })
  );

  inspector.appendChild(form);
}

function renderRulesEditor() {
  const rules = state.world.rules;
  els.inspectorTitle.textContent = "rules.json";
  inspector.innerHTML = "";

  if (!Array.isArray(rules)) {
    inspector.textContent = "(Invalid rules)";
    return;
  }

  const actions = document.createElement("div");
  actions.className = "contentActions";

  const addRuleBtn = document.createElement("button");
  addRuleBtn.textContent = "Add rule";
  addRuleBtn.onclick = () => {
    rules.push({});
    expandedRules.add(rules.length - 1);
    renderRulesEditor();
  };

  const expandAll = document.createElement("button");
  expandAll.textContent = "Expand all";
  expandAll.onclick = () => {
    rules.forEach((_, idx) => expandedRules.add(idx));
    renderRulesEditor();
  };

  const collapseAll = document.createElement("button");
  collapseAll.textContent = "Collapse all";
  collapseAll.onclick = () => {
    expandedRules.clear();
    renderRulesEditor();
  };

  actions.appendChild(addRuleBtn);
  actions.appendChild(expandAll);
  actions.appendChild(collapseAll);
  inspector.appendChild(actions);

  const list = document.createElement("div");
  list.className = "sectionList";

  rules.forEach((rule, idx) => {
    const row = document.createElement("div");
    row.className = "sectionItem";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "6px";

    const title = document.createElement("div");
    title.style.flex = "1";
    title.style.cursor = "pointer";
    title.textContent = `${idx + 1}. ${rule?.id || "(no id)"}`;

    title.onclick = () => {
      if (expandedRules.has(idx)) {
        expandedRules.delete(idx);
      } else {
        expandedRules.add(idx);
      }
      renderRulesEditor();
    };

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirm("Delete this rule?")) return;
      rules.splice(idx, 1);
      expandedRules.clear();
      renderRulesEditor();
    };

    header.appendChild(title);
    header.appendChild(del);
    row.appendChild(header);

    if (expandedRules.has(idx)) {
      const editorWrap = document.createElement("div");
      editorWrap.style.marginTop = "6px";
      editorWrap.style.marginLeft = "12px";

      const jsonRow = makeJsonEditorRow(
        "Rule JSON",
        rule ?? {},
        (v) => {
          rules[idx] = v;
        },
        { minHeight: 160 }
      );

      editorWrap.appendChild(jsonRow);
      row.appendChild(editorWrap);
    }

    list.appendChild(row);
  });

  inspector.appendChild(list);
}

function rebuildDialog(dialogKey) {
  const dialog = state.world.dialogs[dialogKey];
  if (!dialog) return;

  const phrases = dialog.phrases;

  const referenced = new Set();

  Object.values(phrases).forEach(phrase => {
    collectNextTargets(phrase).forEach(id => referenced.add(id));
  });

  referenced.forEach(id => {
    if (!phrases[id]) {
      phrases[id] = {}; // blank placeholder phrase
    }
  });
}

function collectNextTargets(phrase) {
  const out = [];

  if (!phrase) return out;

  // phrase.next
  if (typeof phrase.next === "string") out.push(phrase.next);
  if (phrase.next && typeof phrase.next === "object") {
    Object.keys(phrase.next).forEach(k => out.push(k));
  }

  // options
  if (phrase.options) {
    Object.values(phrase.options).forEach(opt => {
      if (typeof opt.next === "string") out.push(opt.next);
      if (opt.next && typeof opt.next === "object") {
        Object.keys(opt.next).forEach(k => out.push(k));
      }
    });
  }

  return out;
}

function getPhraseMissingFields(phrase, phraseId) {
  const missing = [];
  if (!phraseId) missing.push("id");
  if (!phrase) return missing;

  const hasSpeaker = typeof phrase.speaker === "string" && phrase.speaker.trim();
  const hasText = typeof phrase.text === "string" && phrase.text.trim();
  const hasReaction = typeof phrase.reaction === "string" && phrase.reaction.trim();
  const any = hasSpeaker || hasText || hasReaction;
  const speakerLower = hasSpeaker ? phrase.speaker.trim().toLowerCase() : "";
  const reactionOptional = ["guide", "narrator", "player"].includes(speakerLower);

  if (any) {
    if (!hasSpeaker) missing.push("speaker");
    if (!hasText) missing.push("text");
    if (!hasReaction && !reactionOptional) missing.push("reaction");
  }

  return missing;
}

function getOptionMissingFields(opt, optionId) {
  const missing = [];
  if (!optionId) missing.push("id");
  if (!opt) {
    missing.push("text", "next");
    return missing;
  }
  const hasText = typeof opt.text === "string" && opt.text.trim();
  if (!hasText) missing.push("text");

  let hasNext = false;
  if (typeof opt.next === "string") {
    hasNext = opt.next.trim().length > 0;
  } else if (opt.next && typeof opt.next === "object") {
    hasNext = Object.keys(opt.next).length > 0;
  }
  if (!hasNext) missing.push("next");
  return missing;
}

function getConditionMissingFields(targetId, dialog) {
  const missing = [];
  if (!targetId) missing.push("id");
  if (!targetId || !dialog?.phrases?.[targetId]) {
    missing.push("next");
  }
  return missing;
}

function parseDialogRefLocal(ref, fallbackKey) {
  const s = String(ref || "");
  const dot = s.indexOf(".");
  if (dot > 0) {
    const fileKey = s.slice(0, dot).trim().toLowerCase();
    const phraseId = s.slice(dot + 1);
    return { fileKey, phraseId };
  }
  return { fileKey: String(fallbackKey || "").toLowerCase(), phraseId: s };
}

function buildDialogTrees(dialogKey, edges) {
  const dialog = state.world.dialogs[dialogKey];
  if (!dialog || !dialog.phrases) {
    return { trees: [], nodeUseCounts: new Map(), treeByPhrase: new Map(), orphanSet: new Set() };
  }

  const phraseOrder = Object.keys(dialog.phrases);
  const orderIndex = new Map(phraseOrder.map((id, idx) => [id, idx]));

  const incoming = new Map(phraseOrder.map((id) => [id, 0]));

  Object.entries(edges).forEach(([from, list]) => {
    list.forEach((e) => {
      if (!e.to) return;
      if (incoming.has(e.to)) incoming.set(e.to, (incoming.get(e.to) || 0) + 1);
    });
  });

  const entryRoots = new Set();
  phraseOrder.forEach((id) => {
    if ((incoming.get(id) || 0) === 0) entryRoots.add(id);
  });

  if (dialog.start) {
    const ref = parseDialogRefLocal(dialog.start, dialogKey);
    if (ref.fileKey === String(dialogKey).toLowerCase() && dialog.phrases[ref.phraseId]) {
      entryRoots.add(ref.phraseId);
    }
  }

  if (Array.isArray(state.world.rules)) {
    state.world.rules.forEach((rule) => {
      const startRef = rule?.dialog?.start;
      if (!startRef) return;
      const ref = parseDialogRefLocal(startRef, dialogKey);
      if (ref.fileKey === String(dialogKey).toLowerCase() && dialog.phrases[ref.phraseId]) {
        entryRoots.add(ref.phraseId);
      }
    });
  }

  if (state.world.objects && typeof state.world.objects === "object") {
    Object.values(state.world.objects).forEach((def) => {
      const dialogDef = def?.dialog;
      if (!dialogDef) return;
      ["firstType", "firstInstance", "everyType"].forEach((k) => {
        const startRef = dialogDef[k];
        if (!startRef) return;
        const ref = parseDialogRefLocal(startRef, dialogKey);
        if (ref.fileKey === String(dialogKey).toLowerCase() && dialog.phrases[ref.phraseId]) {
          entryRoots.add(ref.phraseId);
        }
      });
    });
  }

  const trees = [];
  const sortedRoots = Array.from(entryRoots).sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  sortedRoots.forEach((rootId) => {
    const mode = (incoming.get(rootId) || 0) === 0 ? "root" : "entry";
    trees.push({ rootId, mode });
  });

  if (!trees.length && phraseOrder.length) {
    const chosen = phraseOrder.slice().sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))[0];
    if (chosen) trees.push({ rootId: chosen, mode: "cycle" });
  }

  const nodeUseCounts = new Map();
  const treeByPhrase = new Map();
  const reachable = new Set();
  trees.forEach((tree) => {
    const nodes = buildDialogFlowNodes(dialogKey, tree.rootId, edges, tree.allowedPhraseIds);
    nodes.forEach((n) => {
      if (n.type !== "phrase") return;
      reachable.add(n.id);
      nodeUseCounts.set(n.key, (nodeUseCounts.get(n.key) || 0) + 1);
      const roots = treeByPhrase.get(n.id) || new Set();
      roots.add(tree.rootId);
      treeByPhrase.set(n.id, roots);
    });
  });

  const orphanSet = new Set(phraseOrder.filter((id) => !reachable.has(id)));
  if (orphanSet.size) {
    const orphanAdj = new Map(Array.from(orphanSet).map((id) => [id, new Set()]));
    Object.entries(edges).forEach(([from, list]) => {
      if (!orphanSet.has(from)) return;
      list.forEach((e) => {
        if (!e.to || !orphanSet.has(e.to)) return;
        orphanAdj.get(from).add(e.to);
        orphanAdj.get(e.to).add(from);
      });
    });

    const visited = new Set();
    Array.from(orphanSet).forEach((id) => {
      if (visited.has(id)) return;
      const stack = [id];
      const comp = [];
      visited.add(id);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        (orphanAdj.get(cur) || []).forEach((n) => {
          if (visited.has(n)) return;
          visited.add(n);
          stack.push(n);
        });
      }
      const chosen = comp.slice().sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))[0];
      if (chosen) {
        trees.push({ rootId: chosen, mode: "orphan", allowedPhraseIds: new Set(comp) });
      }
    });
  }

  return { trees, nodeUseCounts, treeByPhrase, orphanSet };
}

function renderDialogEditor(dialogKey) {
  const dialog = state.world.dialogs[dialogKey];
  els.inspectorTitle.textContent = `Dialog: ${dialogKey}`;
  inspector.innerHTML = "";

  const actions = document.createElement("div");
  actions.className = "contentActions";

  const addPhraseBtn = document.createElement("button");
  addPhraseBtn.textContent = "Add Phrase";
  addPhraseBtn.onclick = () => {
    const id = prompt("New phrase ID");
    if (!id) return;

    if (dialog.phrases[id]) {
      alert("Phrase ID already exists");
      return;
    }

    dialog.phrases[id] = {};
    expandedDialogPhrases.add(`${dialogKey}::${id}`);
    renderDialogEditor(dialogKey);
  };

  actions.appendChild(addPhraseBtn);

  const rebuildBtn = document.createElement("button");
  rebuildBtn.textContent = "Rebuild dialog tree";
  rebuildBtn.onclick = () => {
    rebuildDialog(dialogKey);
    renderDialogEditor(dialogKey);
  };

  actions.appendChild(rebuildBtn);
  inspector.appendChild(actions);

  if (!dialog || !dialog.phrases) {
    inspector.textContent = "(Invalid dialog)";
    return;
  }

  const search = document.createElement("div");
  search.className = "dialogSearch";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search phrase id / speaker / text";
  searchInput.value = state.dialogSearch || "";
  searchInput.oninput = () => {
    state.dialogSearch = searchInput.value;
    renderDialogEditor(dialogKey);
  };

  search.appendChild(searchInput);
  inspector.appendChild(search);

  const wrap = document.createElement("div");
  wrap.className = "dialogFlow";

  const edges = collectDialogEdges(dialog);

  const { trees, nodeUseCounts, orphanSet } = buildDialogTrees(dialogKey, edges);

  trees.forEach((tree, i) => {
    const treeWrap = document.createElement("div");
    treeWrap.className = "dialogTree";

    const title = document.createElement("div");
    title.className = "dialogTreeTitle";
    let label = `Tree ${i + 1}: ${tree.rootId}`;
    if (tree.mode === "cycle") label += " (cycle)";
    if (tree.mode === "entry") label += " (entry)";
    if (tree.mode === "orphan") label += " (unreachable)";
    title.textContent = label;
    treeWrap.appendChild(title);

    const graphWrap = document.createElement("div");
    graphWrap.className = "dialogGraphWrap";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("dialogEdges");
    graphWrap.appendChild(svg);

    const handlesSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    handlesSvg.classList.add("dialogHandles");
    graphWrap.appendChild(handlesSvg);

    treeWrap.appendChild(graphWrap);
    wrap.appendChild(treeWrap);

    requestAnimationFrame(() => {
      renderDialogFlowchart(dialogKey, tree.rootId, edges, graphWrap, svg, nodeUseCounts, tree.allowedPhraseIds, orphanSet);
    });
  });

  inspector.appendChild(wrap);
}
function renderDialogFlowchart(dialogKey, rootId, edges, graphWrap, svg, nodeUseCounts = null, allowedPhraseIds = null, orphanSet = null) {
  const dialog = state.world.dialogs[dialogKey];
  const nodes = buildDialogFlowNodes(dialogKey, rootId, edges, allowedPhraseIds);
  const layout = layoutDialogNodes(nodes, edges, rootId);

  const padding = 20;
  const width = Math.max(600, layout.width + padding * 2);
  const height = Math.max(200, layout.height + padding * 2);
  graphWrap.style.minWidth = `${width}px`;
  graphWrap.style.minHeight = `${height}px`;

  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const handlesSvg = graphWrap.querySelector(".dialogHandles");
  if (handlesSvg) {
    handlesSvg.setAttribute("width", String(width));
    handlesSvg.setAttribute("height", String(height));
  }

  const markerId = `arrow-${dialogKey}-${rootId}-${dialogMarkerCounter++}`;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", markerId);
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "3");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("orient", "auto");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M0,0 L8,3 L0,6 Z");
  path.setAttribute("fill", "rgba(122,162,255,0.7)");
  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const nodeEls = new Map();
  const nodeMap = new Map();
  const edgeEls = new Map();
  const edgeHandles = new Map();
  const nextHandles = new Map();
  graphWrap.dataset.rootId = rootId;
  const handleGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  handleGroup.setAttribute("class", "edgeHandles");
  if (handlesSvg) handlesSvg.appendChild(handleGroup);
  const edgesToRender = buildDialogFlowEdges(dialogKey, nodes, edges);
  const edgesByFrom = new Map();
  const edgesByTo = new Map();
  edgesToRender.forEach((e) => {
    if (!edgesByFrom.has(e.from)) edgesByFrom.set(e.from, []);
    if (!edgesByTo.has(e.to)) edgesByTo.set(e.to, []);
    edgesByFrom.get(e.from).push(e);
    edgesByTo.get(e.to).push(e);
  });

  function getPathEndpoints(pathStr) {
    const pts = [];
    const re = /[ML]\s*([-\d.]+),([-\d.]+)/g;
    let m;
    while ((m = re.exec(pathStr))) {
      pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
    }
    if (pts.length < 2) return null;
    return { start: pts[0], end: pts[pts.length - 1] };
  }

  function showHandles(edgeKey, show) {
    const handles = edgeHandles.get(edgeKey);
    if (!handles) return;
    handles.forEach((h) => {
      h.style.display = show ? "block" : "none";
    });
  }

  function showHandlesForNode(nodeKey, show, edgesByFrom, edgesByTo) {
    const incoming = edgesByTo.get(nodeKey) || [];
    incoming.forEach((edge) => {
      showHandles(`${edge.from}=>${edge.to}`, show);
    });
    const outgoing = edgesByFrom.get(nodeKey) || [];
    outgoing.forEach((edge) => {
      showHandles(`${edge.from}=>${edge.to}`, show);
    });
  }

  function showNextHandle(nodeKey, show) {
    const handle = nextHandles.get(nodeKey);
    if (!handle) return;
    handle.style.display = show ? "block" : "none";
  }

  function setHandlesVisibleForNode(nodeKey, show) {
    showHandlesForNode(nodeKey, show, edgesByFrom, edgesByTo);
    showNextHandle(nodeKey, show);
  }

  nodes.forEach((node) => {
    nodeMap.set(node.key, node);

    const el = document.createElement("div");
    el.className = `dialogNode ${node.type}`;
    el.dataset.key = node.key;
    el.dataset.rootId = rootId;
    if (node.width) {
      el.style.width = `${node.width}px`;
    }
    el.style.left = `${node.x + padding}px`;
    el.style.top = `${node.y + padding}px`;

    const missing = (() => {
      if (node.type === "phrase") {
        const phrase = dialog?.phrases?.[node.id];
        return getPhraseMissingFields(phrase, node.id);
      }
      if (node.type === "option") {
        const info = node.key.split(":");
        const phraseId = info[1];
        const optionId = info[2];
        const opt = dialog?.phrases?.[phraseId]?.options?.[optionId];
        return getOptionMissingFields(opt, optionId);
      }
      if (node.type === "condition") {
        const info = node.key.split(":");
        const targetId = info.length === 3 ? info[2] : info[3];
        return getConditionMissingFields(targetId, dialog);
      }
      return [];
    })();

    if (missing.length) {
      el.classList.add("nodeMissing");
      el.title = `Missing: ${missing.join(", ")}`;
    }

    if (node.type === "phrase") {
      const phrase = dialog.phrases[node.id];
      const header = document.createElement("div");
      header.className = "dialogNodeHeader";
      header.textContent = node.id;

      const meta = document.createElement("div");
      meta.className = "dialogNodeMeta";
      const speaker = phrase?.speaker ?? "";
      const reaction = phrase?.reaction ?? "";
      meta.textContent = reaction ? `${speaker} - ${reaction}` : speaker;

      const text = document.createElement("div");
      text.className = "dialogNodeText";
      text.textContent = truncateText(phrase?.text ?? "", 120);

      el.appendChild(header);
      el.appendChild(meta);
      el.appendChild(text);

      if (phrase?.action) {
        const action = document.createElement("div");
        action.className = "dialogNodeAction";
        action.textContent = `action: ${summariseAction(phrase.action)}`;
        el.appendChild(action);
      }

      if (phrase?.effects) {
        const effects = document.createElement("div");
        effects.className = "dialogNodeEffects";
        effects.textContent = `effects: ${summariseEffects(phrase.effects)}`;
        effects.title = JSON.stringify(phrase.effects, null, 2);
        el.appendChild(effects);
      }

      el.addEventListener("click", (ev) => {
        if (shouldSuppressNodeClick()) {
          ev.stopPropagation();
          return;
        }
        currentDialogKey = dialogKey;
        currentPhraseId = node.id;
        openNodeModal(node.key, rootId);
      });
    }

    if (node.type === "option") {
      const header = document.createElement("div");
      header.className = "dialogNodeHeader";
      header.textContent = node.meta?.id ?? "option";
      el.appendChild(header);

      const text = document.createElement("div");
      text.className = "dialogNodeText";
      text.textContent = truncateText(node.meta?.text ?? "", 80);
      el.appendChild(text);

      const optInfo = node.key.split(":");
      const optPhraseId = optInfo[1];
      const optId = optInfo[2];
      const opt = dialog?.phrases?.[optPhraseId]?.options?.[optId];
      if (opt?.when && typeof opt.when === "object") {
        const whenLine = document.createElement("div");
        whenLine.className = "dialogNodeCondition";
        whenLine.textContent = `if ${summariseWhen(opt.when)}`;
        el.appendChild(whenLine);
      }
      if (opt?.hideIfChosen) {
        const hideLine = document.createElement("div");
        hideLine.className = "dialogNodeCondition";
        const raw = opt.hideIfChosen;
        let mode = (typeof raw === "string") ? raw : "global";
        if (mode === "perconversation") mode = "conversation";
        hideLine.textContent = (mode === "conversation") ? "Once per conversation" : "Once ever";
        el.appendChild(hideLine);
      }
      if (opt?.effects) {
        const effects = document.createElement("div");
        effects.className = "dialogNodeEffects";
        effects.textContent = `effects: ${summariseEffects(opt.effects)}`;
        effects.title = JSON.stringify(opt.effects, null, 2);
        el.appendChild(effects);
      }

      const del = document.createElement("button");
      del.className = "dialogNodeDelete";
      del.textContent = "×";
      del.title = "Delete option";
      del.onclick = (ev) => {
        ev.stopPropagation();
        const info = parseNodeKey(node.key);
        deleteOption(info);
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
      };
      el.appendChild(del);

      el.addEventListener("click", (ev) => {
        if (shouldSuppressNodeClick()) {
          ev.stopPropagation();
          return;
        }
        openNodeModal(node.key, rootId);
      });
    }

    if (node.type === "condition") {
      const header = document.createElement("div");
      header.className = "dialogNodeHeader";
      header.textContent = "condition";
      el.appendChild(header);

      const text = document.createElement("div");
      text.className = "dialogNodeText";
      text.textContent = truncateText(node.meta?.label ?? "", 80);
      el.appendChild(text);

      const del = document.createElement("button");
      del.className = "dialogNodeDelete";
      del.textContent = "×";
      del.title = "Delete condition";
      del.onclick = (ev) => {
        ev.stopPropagation();
        const info = parseNodeKey(node.key);
        deleteCondition(info);
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
      };
      el.appendChild(del);

      el.addEventListener("click", (ev) => {
        if (shouldSuppressNodeClick()) {
          ev.stopPropagation();
          return;
        }
        openNodeModal(node.key, rootId);
      });
    }

    if (nodeUseCounts && node.type === "phrase") {
      if ((nodeUseCounts.get(node.key) || 0) > 1) {
        el.classList.add("multiTree");
      }
    }
    if (orphanSet && node.type === "phrase" && orphanSet.has(node.id)) {
      el.classList.add("orphanNode");
      if (!el.title) el.title = "Unreachable without a root";
    }

    if (matchesDialogSearch(node, dialogKey)) {
      el.classList.add("highlight");
    }

    if (node.type === "phrase" && currentDialogKey === dialogKey && currentPhraseId === node.id) {
      el.classList.add("selected");
    }

    let hoverHideTimer = null;
    function clearHoverHide() {
      if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
      }
    }

    function applyNodeHover(show) {
      if (show) {
        el.classList.add("nodeHoverSelf");
      } else {
        el.classList.remove("nodeHoverSelf");
      }

      const incoming = edgesByTo.get(node.key) || [];
      incoming.forEach((edge) => {
        const parentEl = nodeEls.get(edge.from);
        if (parentEl) parentEl.classList.toggle("nodeHoverParent", show);
        const edgeEl = edgeEls.get(`${edge.from}=>${edge.to}`);
        if (edgeEl) edgeEl.classList.toggle("edgeHoverParent", show);
      });

      const outgoing = edgesByFrom.get(node.key) || [];
      outgoing.forEach((edge) => {
        const childEl = nodeEls.get(edge.to);
        if (childEl) childEl.classList.toggle("nodeHoverChild", show);
        const edgeEl = edgeEls.get(`${edge.from}=>${edge.to}`);
        if (edgeEl) edgeEl.classList.toggle("edgeHoverChild", show);
      });
    }

    function showNodeHover() {
      clearHoverHide();
      applyNodeHover(true);
      setHandlesVisibleForNode(node.key, true);
    }

    function hideNodeHover() {
      clearHoverHide();
      hoverHideTimer = setTimeout(() => {
        applyNodeHover(false);
        setHandlesVisibleForNode(node.key, false);
      }, 150);
    }

    el.addEventListener("mouseenter", showNodeHover);
    el.addEventListener("mouseleave", hideNodeHover);

    el.addEventListener("mousedown", (ev) => startNodeDrag(ev, node));

    graphWrap.appendChild(el);
    nodeEls.set(node.key, el);
  });

  const addMenus = [];
  function closeAddMenus() {
    addMenus.forEach((m) => m.remove());
    addMenus.length = 0;
  }

  function nextConditionId(phrase) {
    const base = "new_condition";
    let idx = 1;
    const existing = new Set(Object.keys(phrase?.next || {}));
    while (existing.has(`${base}_${idx}`)) idx += 1;
    return `${base}_${idx}`;
  }

  function nextPhraseId(baseId) {
    const base = `${baseId}_next`;
    let idx = 1;
    while (dialog?.phrases?.[`${base}_${idx}`]) idx += 1;
    return `${base}_${idx}`;
  }

  function createAddButton(phraseNode) {
    const phraseKey = `phrase:${phraseNode.id}`;
    const parentEl = nodeEls.get(phraseKey);
    if (!parentEl) return;

    const children = nodes.filter((n) => n.meta?.parentKey === phraseKey);
    const wrapRect = graphWrap.getBoundingClientRect();

    let maxBottom = 0;
    const parentRect = parentEl.getBoundingClientRect();
    maxBottom = parentRect.bottom - wrapRect.top;

    children.forEach((child) => {
      const childEl = nodeEls.get(child.key);
      if (!childEl) return;
      const r = childEl.getBoundingClientRect();
      maxBottom = Math.max(maxBottom, r.bottom - wrapRect.top);
    });

    const btn = document.createElement("button");
    btn.className = "dialogAddChild";
    btn.textContent = "+";
    const parentLeft = parentRect.left - wrapRect.left;
    const parentWidth = parentRect.width;
    btn.style.left = `${parentLeft + parentWidth / 2 - 11}px`;
    btn.style.top = `${maxBottom + 6}px`;

    btn.onclick = (ev) => {
      ev.stopPropagation();
      closeAddMenus();

      const menu = document.createElement("div");
      menu.className = "dialogAddMenu";
      menu.style.left = `${parentLeft + parentWidth / 2 + 6}px`;
      menu.style.top = `${maxBottom - 6}px`;

      const addOptionBtn = document.createElement("button");
      addOptionBtn.textContent = "Add option";
      addOptionBtn.onclick = (e2) => {
        e2.stopPropagation();
        menu.innerHTML = "";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Option ID";
        input.className = "dialogAddInput";
        menu.appendChild(input);

        const confirm = document.createElement("button");
        confirm.textContent = "Create";
        confirm.onclick = (e3) => {
          e3.stopPropagation();
          const id = input.value.trim();
          if (!id) {
            closeAddMenus();
            return;
          }
          const phrase = dialog?.phrases?.[phraseNode.id];
          phrase.options = phrase.options || {};
          if (phrase.options[id]) {
            alert("Option ID already exists for this phrase.");
            return;
          }
          phrase.options[id] = { text: "", next: null };
          renderDialogEditor(dialogKey);
          queueDirtyRefresh();
        };

        input.addEventListener("blur", () => {
          if (!input.value.trim()) closeAddMenus();
        });

        menu.appendChild(confirm);
        input.focus();
      };

      const addCondBtn = document.createElement("button");
      addCondBtn.textContent = "Add condition";
      addCondBtn.onclick = (e2) => {
        e2.stopPropagation();
        const phrase = dialog?.phrases?.[phraseNode.id];
        if (!phrase) return;
        if (typeof phrase.next === "string") {
          const existing = phrase.next;
          phrase.next = { [existing]: { when: null } };
        } else if (!phrase.next || typeof phrase.next !== "object") {
          phrase.next = {};
        }
        const id = nextConditionId(phrase);
        phrase.next[id] = { when: {} };
        if (!dialog.phrases[id]) {
          dialog.phrases[id] = {};
        }
        rebuildDialog(dialogKey);
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
      };

      menu.appendChild(addOptionBtn);
      menu.appendChild(addCondBtn);
      graphWrap.appendChild(menu);
      addMenus.push(menu);
    };

    graphWrap.appendChild(btn);
  }

  nodes.filter((n) => n.type === "phrase").forEach((phraseNode) => {
    createAddButton(phraseNode);
  });

  if (!graphWrap.dataset.addMenuListeners) {
    graphWrap.dataset.addMenuListeners = "1";
    graphWrap.addEventListener("click", () => closeAddMenus());
    graphWrap.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeAddMenus();
    });
  }

  const nodeBounds = collectNodeBounds(nodeEls, graphWrap);
  const parentMap = buildParentMap(nodes);

  function parseNodeKey(key) {
    const parts = (key || "").split(":");
    const type = parts[0];
    if (type === "phrase") return { type, phraseId: parts[1] };
    if (type === "option") return { type, phraseId: parts[1], optionId: parts[2] };
    if (type === "cond") {
      if (parts.length === 3) return { type, phraseId: parts[1], targetId: parts[2] };
      return { type, phraseId: parts[1], optionId: parts[2], targetId: parts[3] };
    }
    return { type };
  }

  function nodeHasNoNextKey(nodeKey) {
    return nodeHasNoNext(parseNodeKey(nodeKey));
  }

  function isEmptyPhrase(phrase) {
    if (!phrase || typeof phrase !== "object") return true;
    const hasText = typeof phrase.text === "string" && phrase.text.trim();
    const hasSpeaker = typeof phrase.speaker === "string" && phrase.speaker.trim();
    const hasAction = phrase.action != null;
    const hasNext = phrase.next != null;
    const hasOptions = phrase.options && Object.keys(phrase.options).length > 0;
    return !(hasText || hasSpeaker || hasAction || hasNext || hasOptions);
  }

  function computeIncomingCounts(dialog) {
    const counts = {};
    const phrases = dialog?.phrases || {};
    Object.keys(phrases).forEach((id) => { counts[id] = 0; });

    Object.values(phrases).forEach((phrase) => {
      if (!phrase) return;
      if (typeof phrase.next === "string") {
        counts[phrase.next] = (counts[phrase.next] || 0) + 1;
      } else if (phrase.next && typeof phrase.next === "object") {
        Object.keys(phrase.next).forEach((target) => {
          counts[target] = (counts[target] || 0) + 1;
        });
      }

      if (phrase.options && typeof phrase.options === "object") {
        Object.values(phrase.options).forEach((opt) => {
          if (!opt) return;
          if (typeof opt.next === "string") {
            counts[opt.next] = (counts[opt.next] || 0) + 1;
          } else if (opt.next && typeof opt.next === "object") {
            Object.keys(opt.next).forEach((target) => {
              counts[target] = (counts[target] || 0) + 1;
            });
          }
        });
      }
    });
    return counts;
  }

  function deleteCondition(info) {
    const phrase = getPhrase(info.phraseId);
    if (!phrase) return;

    const beforeCounts = computeIncomingCounts(dialog);
    const targetId = info.targetId;
    const removedCfg = removeConditionFromParent(info);
    if (!removedCfg) return;

    const afterCounts = computeIncomingCounts(dialog);
    const targetPhrase = getPhrase(targetId);

    if (targetPhrase && isEmptyPhrase(targetPhrase) && beforeCounts[targetId] === 1 && (afterCounts[targetId] || 0) === 0) {
      delete dialog.phrases[targetId];
    }
  }

  function deleteOption(info) {
    const phrase = getPhrase(info.phraseId);
    if (!phrase) return;
    const opt = getOption(info.phraseId, info.optionId);
    if (!opt) return;

    const targets = [];
    if (typeof opt.next === "string") {
      targets.push(opt.next);
    } else if (opt.next && typeof opt.next === "object") {
      targets.push(...Object.keys(opt.next));
    }

    const beforeCounts = computeIncomingCounts(dialog);
    removeOptionFromPhrase(info.phraseId, info.optionId);
    const afterCounts = computeIncomingCounts(dialog);

    targets.forEach((targetId) => {
      const targetPhrase = getPhrase(targetId);
      if (!targetPhrase) return;
      if (isEmptyPhrase(targetPhrase) && beforeCounts[targetId] === 1 && (afterCounts[targetId] || 0) === 0) {
        delete dialog.phrases[targetId];
      }
    });
  }

  let nodeDragState = null;
  let nodeDragSuppressUntil = 0;
  let autoScrollRaf = null;

  function shouldSuppressNodeClick() {
    return Date.now() < nodeDragSuppressUntil;
  }

  function getPhrase(phraseId) {
    return dialog?.phrases?.[phraseId];
  }

  function getOption(phraseId, optionId) {
    return dialog?.phrases?.[phraseId]?.options?.[optionId];
  }

  function ensureNextObject(owner) {
    if (typeof owner.next === "string") {
      const existing = owner.next;
      owner.next = { [existing]: { when: null } };
      return owner.next;
    }
    if (!owner.next || typeof owner.next !== "object") {
      owner.next = {};
    }
    return owner.next;
  }

  function insertEntry(container, key, value, targetKey, insertAfter) {
    const entries = Object.entries(container || {});
    const filtered = entries.filter(([k]) => k !== key);
    const insertIndex = targetKey
      ? Math.max(0, filtered.findIndex(([k]) => k === targetKey) + (insertAfter ? 1 : 0))
      : 0;
    filtered.splice(insertIndex, 0, [key, value]);
    return Object.fromEntries(filtered);
  }

  function removeOptionFromPhrase(phraseId, optionId) {
    const phrase = getPhrase(phraseId);
    if (!phrase?.options) return null;
    const opt = phrase.options[optionId];
    if (!opt) return null;
    delete phrase.options[optionId];
    if (!Object.keys(phrase.options).length) phrase.options = {};
    return opt;
  }

  function removeConditionFromParent(info) {
    if (info.optionId) {
      const opt = getOption(info.phraseId, info.optionId);
      if (!opt?.next || typeof opt.next !== "object") return null;
      const cfg = opt.next[info.targetId];
      if (!cfg) return null;
      delete opt.next[info.targetId];
      if (!Object.keys(opt.next).length) opt.next = null;
      return cfg;
    }
    const phrase = getPhrase(info.phraseId);
    if (!phrase?.next || typeof phrase.next !== "object") return null;
    const cfg = phrase.next[info.targetId];
    if (!cfg) return null;
    delete phrase.next[info.targetId];
    if (!Object.keys(phrase.next).length) phrase.next = null;
    return cfg;
  }

  function nodeHasNoNext(info) {
    if (info.type === "phrase") {
      const phrase = getPhrase(info.phraseId);
      return !!phrase && (phrase.next == null);
    }
    if (info.type === "option") {
      const opt = getOption(info.phraseId, info.optionId);
      return !!opt && (opt.next == null);
    }
    return false;
  }

  function clearDropTarget() {
    if (nodeDragState?.dropEl) {
      nodeDragState.dropEl.classList.remove("dropTarget");
      nodeDragState.dropEl = null;
    }
  }

  function setDropTarget(el) {
    if (nodeDragState?.dropEl === el) return;
    clearDropTarget();
    if (el) {
      el.classList.add("dropTarget");
      nodeDragState.dropEl = el;
    }
  }

  function findDropTarget(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el ? el.closest?.(".dialogNode") : null;
  }

  function autoScrollWhileDragging(clientX, clientY) {
    const scroller = document.querySelector(".content");
    if (!scroller) return;

    const rect = scroller.getBoundingClientRect();
    const margin = 40;
    let velocity = 0;

    if (clientY < rect.top + margin) {
      velocity = -Math.min(18, Math.ceil((rect.top + margin - clientY) / 4));
    } else if (clientY > rect.bottom - margin) {
      velocity = Math.min(18, Math.ceil((clientY - (rect.bottom - margin)) / 4));
    }

    if (!velocity) {
      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
      return;
    }
    if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);

    const step = () => {
      if (!nodeDragState) return;
      scroller.scrollTop += velocity;
      autoScrollRaf = requestAnimationFrame(step);
    };

    autoScrollRaf = requestAnimationFrame(step);
  }

  function startNodeDrag(ev, node) {
    if (ev.button !== 0) return;
    if (ev.target.closest?.("button")) return;

    const info = parseNodeKey(node.key);
    const incoming = edgesByTo.get(node.key) || [];
    const incomingFromKey = incoming.length ? incoming[0].from : null;
    const nodeEl = nodeEls.get(node.key);
    const rect = nodeEl ? nodeEl.getBoundingClientRect() : null;
    const offsetX = rect ? ev.clientX - rect.left : 0;
    const offsetY = rect ? ev.clientY - rect.top : 0;
    const ghost = nodeEl ? nodeEl.cloneNode(true) : null;
    if (ghost && rect) {
      ghost.classList.add("dialogDragGhost");
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      document.body.appendChild(ghost);
    }

    nodeDragState = {
      dialogKey,
      nodeKey: node.key,
      nodeType: node.type,
      info,
      treeRootId: rootId,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
      incomingFromKey,
      ghost,
      offsetX,
      offsetY
    };

    ev.preventDefault();
  }

  function updateNodeDrag(clientX, clientY) {
    if (!nodeDragState) return;
    const dx = clientX - nodeDragState.startX;
    const dy = clientY - nodeDragState.startY;
    const dist = Math.hypot(dx, dy);

    if (!nodeDragState.moved && dist > 4) {
      nodeDragState.moved = true;
      nodeDragSuppressUntil = Date.now() + 200;
      const el = nodeEls.get(nodeDragState.nodeKey);
      if (el) el.classList.add("dragging");
    }

    if (!nodeDragState.moved) return;
    autoScrollWhileDragging(clientX, clientY);
    if (nodeDragState.ghost) {
      nodeDragState.ghost.style.left = `${clientX - nodeDragState.offsetX}px`;
      nodeDragState.ghost.style.top = `${clientY - nodeDragState.offsetY}px`;
    }
    const targetEl = findDropTarget(clientX, clientY);
    if (targetEl && targetEl.dataset.key === nodeDragState.nodeKey) {
      setDropTarget(null);
      return;
    }
    setDropTarget(targetEl);
  }

  function endNodeDrag(clientX, clientY) {
    if (!nodeDragState) return;
    const state = nodeDragState;
    nodeDragState = null;
    if (autoScrollRaf) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }

    const draggedEl = nodeEls.get(state.nodeKey);
    if (draggedEl) draggedEl.classList.remove("dragging");
    if (state.ghost) state.ghost.remove();

    if (!state.moved) {
      clearDropTarget();
      return;
    }

    const targetEl = findDropTarget(clientX, clientY);
    clearDropTarget();
    if (!targetEl) return;

    const targetKey = targetEl.dataset.key;
    if (!targetKey || targetKey === state.nodeKey) return;

    const targetInfo = parseNodeKey(targetKey);
    const sameTree = targetEl.dataset.rootId === state.treeRootId;
    const copy = !sameTree;

    if (state.info.type === "phrase") {
      if (!sameTree) {
        console.log("[drag-phrase-cross-tree]", {
          from: state.info.phraseId,
          to: targetKey,
          targetHasNoNext: nodeHasNoNext(targetInfo)
        });
      }
      if ((targetInfo.type === "phrase" || targetInfo.type === "option") && nodeHasNoNext(targetInfo)) {
        if (sameTree && state.incomingFromKey) {
          removeLink(state.incomingFromKey, state.info.phraseId);
        }
        addLink(targetKey, state.info.phraseId);
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
      }
      return;
    }

    if (state.info.type === "option") {
      const sourcePhrase = getPhrase(state.info.phraseId);
      const sourceOption = sourcePhrase?.options?.[state.info.optionId];
      if (!sourceOption) return;

      if (targetInfo.type !== "phrase" && targetInfo.type !== "option") return;

      const targetPhraseId = targetInfo.phraseId;
      const targetPhrase = getPhrase(targetPhraseId);
      if (!targetPhrase) return;

      const isSameParent = targetPhraseId === state.info.phraseId;

      targetPhrase.options = targetPhrase.options || {};
      if (!isSameParent && targetPhrase.options[state.info.optionId]) {
        alert("Option ID already exists for that phrase.");
        return;
      }

      const movingOption = copy ? cloneDeep(sourceOption) : sourceOption;
      if (targetInfo.type === "phrase") {
        targetPhrase.options = insertEntry(targetPhrase.options, state.info.optionId, movingOption, null, false);
      } else {
        targetPhrase.options = insertEntry(targetPhrase.options, state.info.optionId, movingOption, targetInfo.optionId, true);
      }

      if (!copy && !isSameParent) {
        delete sourcePhrase.options[state.info.optionId];
        if (!Object.keys(sourcePhrase.options).length) sourcePhrase.options = {};
      }

      renderDialogEditor(dialogKey);
      queueDirtyRefresh();
      return;
    }

    if (state.info.type === "cond") {
      if (targetInfo.type !== "phrase" && targetInfo.type !== "cond") return;

      const sourceCfg = copy ? cloneDeep(getConditionConfig(state.info)) : removeConditionFromParent(state.info);
      if (!sourceCfg) return;

      const targetContainerInfo = targetInfo.type === "phrase"
        ? { phraseId: targetInfo.phraseId, optionId: null }
        : { phraseId: targetInfo.phraseId, optionId: targetInfo.optionId };

      const targetPhrase = getPhrase(targetContainerInfo.phraseId);
      if (!targetPhrase) return;

      let containerOwner = targetPhrase;
      if (targetContainerInfo.optionId) {
        const opt = getOption(targetContainerInfo.phraseId, targetContainerInfo.optionId);
        if (!opt) return;
        containerOwner = opt;
      }

      const container = ensureNextObject(containerOwner);
      const targetKeyId = targetInfo.type === "cond" ? targetInfo.targetId : null;

      if (targetKeyId && container[targetKeyId] && targetKeyId === state.info.targetId && targetContainerInfo.phraseId === state.info.phraseId && targetContainerInfo.optionId === state.info.optionId) {
        return;
      }

      if (container[state.info.targetId] && (targetContainerInfo.phraseId !== state.info.phraseId || targetContainerInfo.optionId !== state.info.optionId)) {
        alert("Condition target already exists for that parent.");
        if (!copy) {
          restoreConditionToSource(state.info, sourceCfg);
        }
        return;
      }

      const updated = insertEntry(container, state.info.targetId, sourceCfg, targetKeyId, true);
      containerOwner.next = updated;
      renderDialogEditor(dialogKey);
      queueDirtyRefresh();
      return;
    }
  }

  function getConditionConfig(info) {
    if (info.optionId) {
      const opt = getOption(info.phraseId, info.optionId);
      if (!opt?.next || typeof opt.next !== "object") return null;
      return opt.next[info.targetId] || null;
    }
    const phrase = getPhrase(info.phraseId);
    if (!phrase?.next || typeof phrase.next !== "object") return null;
    return phrase.next[info.targetId] || null;
  }

  function restoreConditionToSource(info, cfg) {
    if (!cfg) return;
    if (info.optionId) {
      const opt = getOption(info.phraseId, info.optionId);
      if (!opt) return;
      const container = ensureNextObject(opt);
      container[info.targetId] = cfg;
    } else {
      const phrase = getPhrase(info.phraseId);
      if (!phrase) return;
      const container = ensureNextObject(phrase);
      container[info.targetId] = cfg;
    }
  }

  function createNextButton(node, info) {
    const parentEl = nodeEls.get(node.key);
    if (!parentEl) return;

    const btn = document.createElement("button");
    btn.className = "dialogAddNext";
    btn.textContent = "+";
    btn.style.left = `${node.x + padding + (node.width ?? 240) + 8}px`;
    btn.style.top = `${node.y + padding + 8}px`;

    btn.onclick = (ev) => {
      ev.stopPropagation();
      const newId = nextPhraseId(info.phraseId);
      if (!dialog.phrases[newId]) dialog.phrases[newId] = {};

      if (info.type === "phrase") {
        const phrase = dialog?.phrases?.[info.phraseId];
        if (!phrase) return;
        if (phrase.next && typeof phrase.next === "object") {
          phrase.next[newId] = phrase.next[newId] ?? { when: null };
        } else {
          phrase.next = newId;
        }
      }

      if (info.type === "option") {
        const phrase = dialog?.phrases?.[info.phraseId];
        const opt = phrase?.options?.[info.optionId];
        if (!opt) return;
        if (opt.next && typeof opt.next === "object") {
          opt.next[newId] = opt.next[newId] ?? { when: null };
        } else {
          opt.next = newId;
        }
      }

      renderDialogEditor(dialogKey);
      queueDirtyRefresh();
    };

    graphWrap.appendChild(btn);
  }

  nodes.forEach((node) => {
    const info = parseNodeKey(node.key);
    if (info.type === "phrase") {
      const phrase = dialog?.phrases?.[info.phraseId];
      if (phrase && phrase.next == null) {
        createNextButton(node, info);
      }
    }
    if (info.type === "option") {
      const phrase = dialog?.phrases?.[info.phraseId];
      const opt = phrase?.options?.[info.optionId];
      if (opt && opt.next == null) {
        createNextButton(node, info);
      }
    }
  });

  function cloneDeep(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function renamePhraseIdAll(dialogKey, oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const dialog = state.world.dialogs[dialogKey];
    if (!dialog || !dialog.phrases) return;

    if (dialog.phrases[newId]) {
      alert("Phrase ID already exists in this dialog.");
      return;
    }

    // Rename phrase key
    dialog.phrases[newId] = dialog.phrases[oldId];
    delete dialog.phrases[oldId];

    // Update references inside dialog
    Object.values(dialog.phrases).forEach((phrase) => {
      if (!phrase) return;

      if (typeof phrase.next === "string") {
        if (phrase.next === oldId) phrase.next = newId;
      } else if (phrase.next && typeof phrase.next === "object") {
        if (phrase.next[oldId]) {
          phrase.next[newId] = phrase.next[oldId];
          delete phrase.next[oldId];
        }
      }

      if (phrase.options) {
        Object.values(phrase.options).forEach((opt) => {
          if (!opt) return;
          if (typeof opt.next === "string") {
            if (opt.next === oldId) opt.next = newId;
          } else if (opt.next && typeof opt.next === "object") {
            if (opt.next[oldId]) {
              opt.next[newId] = opt.next[oldId];
              delete opt.next[oldId];
            }
          }
        });
      }
    });

    // Update rules.json references
    (state.world.rules || []).forEach((rule) => {
      if (rule?.dialog?.start === oldId) rule.dialog.start = newId;
      if (rule?.scene?.start === oldId) rule.scene.start = newId;
    });

    // Update character rules references
    Object.values(state.world.characters || {}).forEach((char) => {
      (char?.rules || []).forEach((rule) => {
        if (rule?.dialog?.start === oldId) rule.dialog.start = newId;
        if (rule?.scene?.start === oldId) rule.scene.start = newId;
      });
    });
  }

  function openNodeModal(nodeKey, originRootId = null) {
    const info = parseNodeKey(nodeKey);
    const overlay = document.createElement("div");
    overlay.className = "dialogModalOverlay";

    const modal = document.createElement("div");
    modal.className = "dialogModal";
    overlay.appendChild(modal);

    const header = document.createElement("div");
    header.className = "dialogModalHeader";
    header.textContent = `Edit ${info.type}`;
    modal.appendChild(header);

    const body = document.createElement("div");
    body.className = "dialogModalBody";
    modal.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "dialogModalFooter";
    modal.appendChild(footer);

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "Cancel";
    const btnOk = document.createElement("button");
    btnOk.textContent = "Ok";
    footer.appendChild(btnCancel);
    footer.appendChild(btnOk);

    function close() {
      overlay.remove();
    }

    function closeWithRestore(restoreFn) {
      restoreFn();
      renderDialogEditor(dialogKey);
      close();
    }

    if (info.type === "phrase") {
      const phrase = dialog?.phrases?.[info.phraseId];
      if (!phrase) return;
      const snapshot = cloneDeep(phrase);
      const phraseIdInput = makeInput("Phrase ID", info.phraseId, () => {});
      const phraseIdField = phraseIdInput.querySelector("input");
      if (phraseIdField) {
        phraseIdField.value = info.phraseId;
      }
      const speakerRow = makeInput("Speaker", phrase.speaker ?? "", (v) => {
        phrase.speaker = v || null;
      });

      const missing = getPhraseMissingFields(phrase, info.phraseId);
      if (missing.includes("id")) phraseIdInput.classList.add("missingField");
      if (missing.includes("speaker")) speakerRow.classList.add("missingField");

      body.appendChild(phraseIdInput);
      body.appendChild(speakerRow);

      renderDialogPhraseEditorInline(dialogKey, info.phraseId, body, originRootId, close);

      btnCancel.onclick = () => {
        dialog.phrases[info.phraseId] = snapshot;
        closeWithRestore(() => {});
      };
      btnOk.onclick = () => {
        const newId = phraseIdField ? phraseIdField.value.trim() : info.phraseId;
        if (!newId) {
          alert("Phrase ID cannot be empty.");
          return;
        }
        if (newId !== info.phraseId) {
          renamePhraseIdAll(dialogKey, info.phraseId, newId);
          currentPhraseId = newId;
        }
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
        close();
      };
    }

    if (info.type === "option") {
      const phrase = dialog?.phrases?.[info.phraseId];
      const opt = phrase?.options?.[info.optionId];
      if (!opt) return;
      const snapshot = cloneDeep(opt);

      const form = document.createElement("div");
      form.className = "form";
      const optIdRow = makeReadonly("Option ID", info.optionId);
      const optTextRow = makeInput("Text", opt.text ?? "", (v) => { opt.text = v; });
      form.appendChild(optIdRow);
      form.appendChild(optTextRow);
      const hideRow = document.createElement("div");
      hideRow.className = "formRow";
      const hideLabel = document.createElement("label");
      hideLabel.textContent = "Hide If Chosen";
      const hideSelect = document.createElement("select");
      [
        { value: "", label: "(none)" },
        { value: "conversation", label: "Per conversation" },
        { value: "perconversation", label: "Per conversation (alias)" },
        { value: "global", label: "Global" }
      ].forEach(({ value, label }) => {
        const optEl = document.createElement("option");
        optEl.value = value;
        optEl.textContent = label;
        hideSelect.appendChild(optEl);
      });
      hideSelect.value = opt.hideIfChosen ?? "";
      hideSelect.onchange = () => {
        opt.hideIfChosen = hideSelect.value || null;
      };
      hideRow.appendChild(hideLabel);
      hideRow.appendChild(hideSelect);
      form.appendChild(hideRow);

      renderStateEditor(form, opt);

      renderWhenEditor(form, opt);

      renderEffectsEditor(form, opt);

      form.appendChild(
        makeCheckbox(
          "Effects Once",
          !!opt.effectsOnce,
          (v) => {
            opt.effectsOnce = v;
          }
        )
      );

      const optMissing = getOptionMissingFields(opt, info.optionId);
      if (optMissing.includes("id")) optIdRow.classList.add("missingField");
      if (optMissing.includes("text")) optTextRow.classList.add("missingField");

      if (typeof opt.next === "string" || opt.next == null) {
        const nextRow = makeInput("Next", typeof opt.next === "string" ? opt.next : "", (v) => { opt.next = v || null; });
        if (optMissing.includes("next")) nextRow.classList.add("missingField");
        form.appendChild(nextRow);
      } else if (opt.next && typeof opt.next === "object") {
        const condWrap = document.createElement("div");
        condWrap.className = "sectionList";
        if (optMissing.includes("next")) condWrap.classList.add("missingField");

        const title = document.createElement("div");
        title.textContent = "Conditional next";
        title.style.fontWeight = "700";
        title.style.marginBottom = "6px";
        condWrap.appendChild(title);

        Object.entries(opt.next).forEach(([target, cfg]) => {
          const row = document.createElement("div");
          row.className = "form";
          row.appendChild(makeInput("Target", target, (v) => {
            if (!v || v === target) return;
            opt.next[v] = opt.next[target];
            delete opt.next[target];
          }));
          row.appendChild(makeInput("When (JSON)", cfg?.when ? JSON.stringify(cfg.when) : "", (v) => {
            try { cfg.when = v ? JSON.parse(v) : null; } catch {}
          }));
          const del = document.createElement("button");
          del.textContent = "Delete branch";
          del.onclick = () => {
            delete opt.next[target];
            if (!Object.keys(opt.next).length) opt.next = null;
            renderDialogEditor(dialogKey);
            queueDirtyRefresh();
            close();
          };
          row.appendChild(del);
          condWrap.appendChild(row);
        });

        const addBtn = document.createElement("button");
        addBtn.textContent = "Add conditional branch";
        addBtn.onclick = () => {
          const id = prompt("Target phrase ID");
          if (!id) return;
          opt.next[id] = { when: {} };
          renderDialogEditor(dialogKey);
          queueDirtyRefresh();
          close();
        };
        condWrap.appendChild(addBtn);
        form.appendChild(condWrap);
      }

      body.appendChild(form);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete option";
      deleteBtn.onclick = () => {
        deleteOption(info);
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
        close();
      };
      footer.insertBefore(deleteBtn, btnOk);

      btnCancel.onclick = () => {
        phrase.options[info.optionId] = snapshot;
        closeWithRestore(() => {});
      };
      btnOk.onclick = () => {
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
        close();
      };
    }

    if (info.type === "cond") {
      const form = document.createElement("div");
      form.className = "form";

      let container = null;
      if (info.optionId) {
        const phrase = dialog?.phrases?.[info.phraseId];
        const opt = phrase?.options?.[info.optionId];
        if (!opt) return;
        if (!opt.next || typeof opt.next !== "object") opt.next = {};
        container = opt.next;
      } else {
        const phrase = dialog?.phrases?.[info.phraseId];
        if (!phrase) return;
        if (!phrase.next || typeof phrase.next !== "object") phrase.next = {};
        container = phrase.next;
      }

      const snapshot = cloneDeep(container);
      const targetId = info.targetId;
      const cfg = container[targetId] || {};
      container[targetId] = cfg;

      const targetRow = makeReadonly("Target", targetId);
      form.appendChild(targetRow);
      renderWhenEditor(form, cfg);

      const condMissing = getConditionMissingFields(targetId, dialog);
      if (condMissing.length) targetRow.classList.add("missingField");

      body.appendChild(form);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete condition";
      deleteBtn.onclick = () => {
        deleteCondition(info);
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
        close();
      };
      footer.insertBefore(deleteBtn, btnOk);

      btnCancel.onclick = () => {
        if (info.optionId) {
          const phrase = dialog?.phrases?.[info.phraseId];
          if (phrase?.options?.[info.optionId]) {
            phrase.options[info.optionId].next = snapshot;
          }
        } else {
          const phrase = dialog?.phrases?.[info.phraseId];
          if (phrase) phrase.next = snapshot;
        }
        closeWithRestore(() => {});
      };
      btnOk.onclick = () => {
        renderDialogEditor(dialogKey);
        queueDirtyRefresh();
        close();
      };
    }

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) btnCancel.click();
    });
    document.addEventListener("keydown", function esc(ev) {
      if (ev.key === "Escape") {
        btnCancel.click();
        document.removeEventListener("keydown", esc);
      }
    });

    document.body.appendChild(overlay);
  }

  function removeLink(fromKey, targetPhraseId) {
    const info = parseNodeKey(fromKey);
    if (info.type === "phrase") {
      const phrase = dialog?.phrases?.[info.phraseId];
      if (!phrase) return;
      if (typeof phrase.next === "string") {
        if (phrase.next === targetPhraseId) phrase.next = null;
      } else if (phrase.next && typeof phrase.next === "object") {
        if (phrase.next[targetPhraseId]) {
          delete phrase.next[targetPhraseId];
          if (!Object.keys(phrase.next).length) phrase.next = null;
        }
      }
    }

    if (info.type === "option") {
      const phrase = dialog?.phrases?.[info.phraseId];
      const opt = phrase?.options?.[info.optionId];
      if (!opt) return;
      if (typeof opt.next === "string") {
        if (opt.next === targetPhraseId) opt.next = null;
      } else if (opt.next && typeof opt.next === "object") {
        if (opt.next[targetPhraseId]) {
          delete opt.next[targetPhraseId];
          if (!Object.keys(opt.next).length) opt.next = null;
        }
      }
    }

    if (info.type === "cond") {
      if (info.optionId) {
        const phrase = dialog?.phrases?.[info.phraseId];
        const opt = phrase?.options?.[info.optionId];
        if (!opt || !opt.next || typeof opt.next !== "object") return;
        if (opt.next[targetPhraseId]) {
          delete opt.next[targetPhraseId];
          if (!Object.keys(opt.next).length) opt.next = null;
        }
      } else {
        const phrase = dialog?.phrases?.[info.phraseId];
        if (!phrase || !phrase.next || typeof phrase.next !== "object") return;
        if (phrase.next[targetPhraseId]) {
          delete phrase.next[targetPhraseId];
          if (!Object.keys(phrase.next).length) phrase.next = null;
        }
      }
    }
  }

  function addLink(fromKey, targetPhraseId) {
    const info = parseNodeKey(fromKey);
    if (info.type === "phrase") {
      const phrase = dialog?.phrases?.[info.phraseId];
      if (!phrase) return;
      if (phrase.next && typeof phrase.next === "object") {
        phrase.next[targetPhraseId] = phrase.next[targetPhraseId] ?? { when: null };
      } else {
        phrase.next = targetPhraseId;
      }
    }

    if (info.type === "option") {
      const phrase = dialog?.phrases?.[info.phraseId];
      const opt = phrase?.options?.[info.optionId];
      if (!opt) return;
      if (opt.next && typeof opt.next === "object") {
        opt.next[targetPhraseId] = opt.next[targetPhraseId] ?? { when: null };
      } else {
        opt.next = targetPhraseId;
      }
    }

    if (info.type === "cond") {
      if (info.optionId) {
        const phrase = dialog?.phrases?.[info.phraseId];
        const opt = phrase?.options?.[info.optionId];
        if (!opt) return;
        if (!opt.next || typeof opt.next !== "object") opt.next = {};
        opt.next[targetPhraseId] = opt.next[targetPhraseId] ?? { when: null };
      } else {
        const phrase = dialog?.phrases?.[info.phraseId];
        if (!phrase) return;
        if (!phrase.next || typeof phrase.next !== "object") phrase.next = {};
        phrase.next[targetPhraseId] = phrase.next[targetPhraseId] ?? { when: null };
      }
    }
  }

  function updateTarget(fromKey, oldTargetId, newTargetId) {
    const info = parseNodeKey(fromKey);
    if (info.type === "phrase") {
      const phrase = dialog?.phrases?.[info.phraseId];
      if (!phrase) return;
      if (typeof phrase.next === "string") {
        if (phrase.next === oldTargetId) phrase.next = newTargetId;
      } else if (phrase.next && typeof phrase.next === "object") {
        if (phrase.next[oldTargetId]) {
          phrase.next[newTargetId] = phrase.next[oldTargetId];
          delete phrase.next[oldTargetId];
        }
      }
    }

    if (info.type === "option") {
      const phrase = dialog?.phrases?.[info.phraseId];
      const opt = phrase?.options?.[info.optionId];
      if (!opt) return;
      if (typeof opt.next === "string") {
        if (opt.next === oldTargetId) opt.next = newTargetId;
      } else if (opt.next && typeof opt.next === "object") {
        if (opt.next[oldTargetId]) {
          opt.next[newTargetId] = opt.next[oldTargetId];
          delete opt.next[oldTargetId];
        }
      }
    }

    if (info.type === "cond") {
      if (info.optionId) {
        const phrase = dialog?.phrases?.[info.phraseId];
        const opt = phrase?.options?.[info.optionId];
        if (!opt) return;
        if (!opt.next || typeof opt.next !== "object") opt.next = {};
        if (opt.next[oldTargetId]) {
          opt.next[newTargetId] = opt.next[oldTargetId];
          delete opt.next[oldTargetId];
        } else {
          opt.next[newTargetId] = { when: null };
        }
      } else {
        const phrase = dialog?.phrases?.[info.phraseId];
        if (!phrase) return;
        if (!phrase.next || typeof phrase.next !== "object") phrase.next = {};
        if (phrase.next[oldTargetId]) {
          phrase.next[newTargetId] = phrase.next[oldTargetId];
          delete phrase.next[oldTargetId];
        } else {
          phrase.next[newTargetId] = { when: null };
        }
      }
    }
  }

  let dragState = null;
  let nextDragState = null;
  const dragLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
  dragLine.setAttribute("class", "dragLine");
  dragLine.style.display = "none";
  dragLine.style.pointerEvents = "none";
  if (handlesSvg) {
    handlesSvg.appendChild(dragLine);
  } else {
    svg.appendChild(dragLine);
  }

  function startDrag(edgeKey, endType, startPt, endPt) {
    const wrapRect = graphWrap.getBoundingClientRect();
    dragState = { edgeKey, endType, startPt, endPt, wrapRect };
    dragLine.style.display = "block";
    dragLine.setAttribute("marker-end", `url(#${markerId})`);
  }

  function startNextDrag(ev, nodeKey, startPt) {
    if (ev.button !== 0) return;
    if (!nodeHasNoNextKey(nodeKey)) return;
    const wrapRect = graphWrap.getBoundingClientRect();
    nextDragState = { nodeKey, startPt, wrapRect };
    dragLine.style.display = "block";
    dragLine.setAttribute("marker-end", `url(#${markerId})`);
    ev.stopPropagation();
  }

  function updateDragLine(clientX, clientY) {
    if (!dragState) return;
    const x = clientX - dragState.wrapRect.left;
    const y = clientY - dragState.wrapRect.top;
    const fixed = dragState.endType === "start" ? dragState.endPt : dragState.startPt;
    dragLine.setAttribute("d", `M${fixed.x},${fixed.y} L${x},${y}`);
  }

  function updateNextDrag(clientX, clientY) {
    if (!nextDragState) return;
    const x = clientX - nextDragState.wrapRect.left;
    const y = clientY - nextDragState.wrapRect.top;
    dragLine.setAttribute("d", `M${nextDragState.startPt.x},${nextDragState.startPt.y} L${x},${y}`);
  }

  function endDrag(clientX, clientY) {
    if (!dragState) return;
    const state = dragState;
    dragState = null;
    dragLine.style.display = "none";

    const el = document.elementFromPoint(clientX, clientY);
    const nodeEl = el ? el.closest?.(".dialogNode") : null;
    if (!nodeEl) return;
    const targetKey = nodeEl.dataset.key;
    if (!targetKey) return;

    const [fromKey, toKey] = state.edgeKey.split("=>");
    const targetNodeInfo = parseNodeKey(targetKey);
    const oldTargetInfo = parseNodeKey(toKey);

    if (state.endType === "end") {
      if (targetNodeInfo.type !== "phrase") return;
      if (oldTargetInfo.phraseId === targetNodeInfo.phraseId) return;
      updateTarget(fromKey, oldTargetInfo.phraseId, targetNodeInfo.phraseId);
      renderDialogEditor(dialogKey);
      queueDirtyRefresh();
      return;
    }

    removeLink(fromKey, oldTargetInfo.phraseId);
    if (targetNodeInfo.type === "phrase" || targetNodeInfo.type === "option" || targetNodeInfo.type === "cond") {
      addLink(targetKey, oldTargetInfo.phraseId);
      renderDialogEditor(dialogKey);
      queueDirtyRefresh();
    }
  }

  function endNextDrag(clientX, clientY) {
    if (!nextDragState) return;
    const state = nextDragState;
    nextDragState = null;
    dragLine.style.display = "none";

    const el = document.elementFromPoint(clientX, clientY);
    const nodeEl = el ? el.closest?.(".dialogNode") : null;
    if (!nodeEl) return;
    const targetKey = nodeEl.dataset.key;
    if (!targetKey) return;

    const targetInfo = parseNodeKey(targetKey);
    if (targetInfo.type !== "phrase") return;
    if (targetInfo.phraseId === parseNodeKey(state.nodeKey).phraseId) return;
    if (!nodeHasNoNextKey(state.nodeKey)) return;

    addLink(state.nodeKey, targetInfo.phraseId);
    renderDialogEditor(dialogKey);
    queueDirtyRefresh();
  }
  let forwardLane = 0;
  let backLane = 0;

  edgesToRender.forEach((edge) => {
    const fromEl = nodeEls.get(edge.from);
    const toEl = nodeEls.get(edge.to);
    if (!fromEl || !toEl) return;

    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    const fromDepth = fromNode?.depth ?? 0;
    const toDepth = toNode?.depth ?? 0;
    const isBack = toNode?.type === "phrase" && toDepth <= fromDepth;

    const laneIndex = isBack ? backLane++ : forwardLane++;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const wrapRect = graphWrap.getBoundingClientRect();

    const pathStr = routeDialogEdgePath(fromRect, toRect, wrapRect, isBack, laneIndex, nodeBounds, fromNode?.key, toNode?.key, fromNode, toNode, parentMap);
    if (!pathStr) return;

    const edgeKey = `${edge.from}=>${edge.to}`;

    const hitEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitEl.setAttribute("d", pathStr);
    hitEl.setAttribute("class", "dialogEdgeHit");
    hitEl.dataset.from = edge.from;
    hitEl.dataset.to = edge.to;
    hitEl.addEventListener("mouseenter", () => {
      pathEl.classList.add("hovered");
      const fromEl = nodeEls.get(edge.from);
      const toEl = nodeEls.get(edge.to);
      if (fromEl) fromEl.classList.add("edgeHover");
      if (toEl) toEl.classList.add("edgeHover");
      showHandles(edgeKey, true);
    });
    hitEl.addEventListener("mouseleave", () => {
      pathEl.classList.remove("hovered");
      const fromEl = nodeEls.get(edge.from);
      const toEl = nodeEls.get(edge.to);
      if (fromEl) fromEl.classList.remove("edgeHover");
      if (toEl) toEl.classList.remove("edgeHover");
      showHandles(edgeKey, false);
    });

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", pathStr);
    pathEl.setAttribute("class", "dialogEdge");
    pathEl.setAttribute("marker-end", `url(#${markerId})`);
    pathEl.dataset.from = edge.from;
    pathEl.dataset.to = edge.to;
    pathEl.style.pointerEvents = "none";

    edgeEls.set(edgeKey, pathEl);

    const endpoints = getPathEndpoints(pathStr);
    if (endpoints && edge.to.startsWith("phrase:")) {
      const startHandle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      startHandle.setAttribute("class", "edgeHandle");
      startHandle.setAttribute("r", "5");
      startHandle.setAttribute("cx", endpoints.start.x);
      startHandle.setAttribute("cy", endpoints.start.y);
      startHandle.style.display = "none";

      const endHandle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      endHandle.setAttribute("class", "edgeHandle");
      endHandle.setAttribute("r", "5");
      endHandle.setAttribute("cx", endpoints.end.x);
      endHandle.setAttribute("cy", endpoints.end.y);
      endHandle.style.display = "none";

      const startHit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      startHit.setAttribute("class", "edgeHandleHit");
      startHit.setAttribute("r", "10");
      startHit.setAttribute("cx", endpoints.start.x);
      startHit.setAttribute("cy", endpoints.start.y);
      startHit.style.display = "none";

      const endHit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      endHit.setAttribute("class", "edgeHandleHit");
      endHit.setAttribute("r", "10");
      endHit.setAttribute("cx", endpoints.end.x);
      endHit.setAttribute("cy", endpoints.end.y);
      endHit.style.display = "none";

      const fromIsPhrase = edge.from.startsWith("phrase:");
      const toIsOptionOrCond = edge.to.startsWith("option:") || edge.to.startsWith("cond:");
      const allowMove = !(fromIsPhrase && toIsOptionOrCond);

      if (allowMove) {
        startHit.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          startDrag(edgeKey, "start", endpoints.start, endpoints.end);
        });
        endHit.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          startDrag(edgeKey, "end", endpoints.start, endpoints.end);
        });
        startHandle.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          startDrag(edgeKey, "start", endpoints.start, endpoints.end);
        });
        endHandle.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          startDrag(edgeKey, "end", endpoints.start, endpoints.end);
        });
      }

      startHit.addEventListener("mouseenter", () => {
        setHandlesVisibleForNode(edge.from, true);
        setHandlesVisibleForNode(edge.to, true);
      });
      endHit.addEventListener("mouseenter", () => {
        setHandlesVisibleForNode(edge.from, true);
        setHandlesVisibleForNode(edge.to, true);
      });
      startHit.addEventListener("mouseleave", () => {
        setHandlesVisibleForNode(edge.from, false);
        setHandlesVisibleForNode(edge.to, false);
      });
      endHit.addEventListener("mouseleave", () => {
        setHandlesVisibleForNode(edge.from, false);
        setHandlesVisibleForNode(edge.to, false);
      });

      handleGroup.appendChild(startHit);
      handleGroup.appendChild(endHit);
      handleGroup.appendChild(startHandle);
      handleGroup.appendChild(endHandle);
      edgeHandles.set(edgeKey, [startHandle, endHandle, startHit, endHit]);
    }
    svg.appendChild(hitEl);
    svg.appendChild(pathEl);
  });

  nodes.forEach((node) => {
    if (!nodeHasNoNextKey(node.key)) return;
    const nodeEl = nodeEls.get(node.key);
    if (!nodeEl) return;
    const wrapRect = graphWrap.getBoundingClientRect();
    const rect = nodeEl.getBoundingClientRect();
    const cx = rect.right - wrapRect.left - 6;
    const cy = rect.top - wrapRect.top + 6;

    const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    handle.setAttribute("class", "edgeHandle nextHandle");
    handle.setAttribute("r", "5");
    handle.setAttribute("cx", cx);
    handle.setAttribute("cy", cy);
    handle.style.display = "none";

    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("class", "edgeHandleHit nextHandleHit");
    hit.setAttribute("r", "10");
    hit.setAttribute("cx", cx);
    hit.setAttribute("cy", cy);
    hit.style.display = "none";

    hit.addEventListener("mousedown", (ev) => {
      startNextDrag(ev, node.key, { x: cx, y: cy });
    });
    handle.addEventListener("mousedown", (ev) => {
      startNextDrag(ev, node.key, { x: cx, y: cy });
    });

    hit.addEventListener("mouseenter", () => setHandlesVisibleForNode(node.key, true));
    hit.addEventListener("mouseleave", () => setHandlesVisibleForNode(node.key, false));

    handleGroup.appendChild(hit);
    handleGroup.appendChild(handle);
    nextHandles.set(node.key, handle);
    nextHandles.set(`${node.key}:hit`, hit);
  });

  if (!graphWrap.dataset.dragListeners) {
    graphWrap.dataset.dragListeners = "1";
    window.addEventListener("mousemove", (ev) => {
      if (dragState) updateDragLine(ev.clientX, ev.clientY);
      if (nextDragState) updateNextDrag(ev.clientX, ev.clientY);
      if (nodeDragState) updateNodeDrag(ev.clientX, ev.clientY);
    });

    window.addEventListener("mouseup", (ev) => {
      if (dragState) endDrag(ev.clientX, ev.clientY);
      if (nextDragState) endNextDrag(ev.clientX, ev.clientY);
      if (nodeDragState) endNodeDrag(ev.clientX, ev.clientY);
    });
  }
}

function stableStringify(obj) {
  if (obj == null) return "null";
  const seen = new WeakSet();
  return JSON.stringify(obj, function (key, value) {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) return value;
      const sorted = {};
      Object.keys(value).sort().forEach((k) => {
        sorted[k] = value[k];
      });
      return sorted;
    }
    return value;
  });
}

function markOriginal(key, data, dialogKey = null) {
  const snapshot = JSON.parse(JSON.stringify(data));
  if (key === "dialog" && dialogKey) {
    state.original.dialogs[dialogKey] = snapshot;
    return;
  }
  state.original[key] = snapshot;
}

function isDirty(key, data, dialogKey = null) {
  if (key === "dialog" && dialogKey) {
    const orig = state.original.dialogs[dialogKey];
    if (!orig) return true;
    return JSON.stringify(orig) !== JSON.stringify(data);
  }
  const orig = state.original[key];
  if (!orig) return true;
  return stableStringify(orig) !== stableStringify(data);
}

function isSelectionDirty(selection) {
  if (!selection) return false;
  if (selection.type === "dialog") {
    const dialog = state.world.dialogs[selection.key];
    return !!dialog && isDirty("dialog", dialog, selection.key);
  }
  const data = state.world[selection.type];
  if (!data) return false;
  return isDirty(selection.type, data);
}

function getSelectionLabel(selection) {
  if (!selection) return "Diff";
  if (selection.type === "dialog") {
    const file = state.files.dialogs[selection.key];
    return file?.name ?? `${selection.key}.json`;
  }
  return `${selection.type}.json`;
}

function getSelectionData(selection) {
  if (!selection) return null;
  if (selection.type === "dialog") return state.world.dialogs[selection.key] ?? null;
  return state.world[selection.type] ?? null;
}

function getSelectionOriginal(selection) {
  if (!selection) return null;
  if (selection.type === "dialog") return state.original.dialogs[selection.key] ?? null;
  return state.original[selection.type] ?? null;
}

function diffLines(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: "same", left: oldLines[i - 1], right: newLines[j - 1] });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "del", left: oldLines[i - 1], right: "" });
      i -= 1;
    } else {
      ops.push({ type: "add", left: "", right: newLines[j - 1] });
      j -= 1;
    }
  }

  while (i > 0) {
    ops.push({ type: "del", left: oldLines[i - 1], right: "" });
    i -= 1;
  }
  while (j > 0) {
    ops.push({ type: "add", left: "", right: newLines[j - 1] });
    j -= 1;
  }

  return ops.reverse();
}

function openDiffViewer(selection) {
  const current = getSelectionData(selection);
  const original = getSelectionOriginal(selection);

  if (!current || !original) {
    setStatus("No diff available for this selection.", true);
    return;
  }

  const oldText = pretty(original);
  const newText = pretty(current);

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const ops = diffLines(oldLines, newLines);

  const overlay = document.createElement("div");
  overlay.className = "diffModalOverlay";

  const modal = document.createElement("div");
  modal.className = "diffModal";

  const header = document.createElement("div");
  header.className = "diffModalHeader";
  header.innerHTML = `<div class="diffTitle">Diff: ${getSelectionLabel(selection)}</div>`;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "diffModalBody";

  const cols = document.createElement("div");
  cols.className = "diffColumns";

  const leftCol = document.createElement("div");
  leftCol.className = "diffColumn";

  const rightCol = document.createElement("div");
  rightCol.className = "diffColumn";

  ops.forEach((op) => {
    const leftLine = document.createElement("div");
    leftLine.className = "diffLine";
    leftLine.textContent = op.left ?? "";

    const rightLine = document.createElement("div");
    rightLine.className = "diffLine";
    rightLine.textContent = op.right ?? "";

    if (op.type === "add") {
      rightLine.classList.add("diffAdd");
      leftLine.classList.add("diffEmpty");
    } else if (op.type === "del") {
      leftLine.classList.add("diffDel");
      rightLine.classList.add("diffEmpty");
    } else {
      leftLine.classList.add("diffSame");
      rightLine.classList.add("diffSame");
    }

    leftCol.appendChild(leftLine);
    rightCol.appendChild(rightLine);
  });

  cols.appendChild(leftCol);
  cols.appendChild(rightCol);
  body.appendChild(cols);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

function routeDialogEdgePath(fromRect, toRect, wrapRect, isBack, laneIndex, boundsMap, fromKey, toKey, fromNode, toNode, parentMap) {
  const spacing = 12;
  const pad = 2;

  const from = {
    left: fromRect.left - wrapRect.left,
    right: fromRect.right - wrapRect.left,
    top: fromRect.top - wrapRect.top,
    bottom: fromRect.bottom - wrapRect.top,
    cy: fromRect.top - wrapRect.top + fromRect.height / 2,
    cx: fromRect.left - wrapRect.left + fromRect.width / 2,
  };

  const to = {
    left: toRect.left - wrapRect.left,
    right: toRect.right - wrapRect.left,
    top: toRect.top - wrapRect.top,
    bottom: toRect.bottom - wrapRect.top,
    cy: toRect.top - wrapRect.top + toRect.height / 2,
    cx: toRect.left - wrapRect.left + toRect.width / 2,
  };

  const debugObstacles = Array.from(boundsMap.entries())
    .filter(([key]) => key !== fromKey && key !== toKey)
    .filter(([key, rect]) => {
      if (fromNode?.type === "phrase" && toNode?.type === "phrase") {
        if (isDescendantOf(key, fromKey, parentMap)) {
          const minX = Math.min(fromRect.left, toRect.left) - wrapRect.left;
          const maxX = Math.max(fromRect.right, toRect.right) - wrapRect.left;
          const minY = Math.min(fromRect.top, toRect.top) - wrapRect.top;
          const maxY = Math.max(fromRect.bottom, toRect.bottom) - wrapRect.top;
          const inX = rect.right >= minX && rect.left <= maxX;
          const inY = rect.bottom >= minY && rect.top <= maxY;
          if (!inX || !inY) {
            return false;
          }
        }
      }
      return true;
    })
    .map(([key, rect]) => ({ key, rect }));

  const obstacles = debugObstacles.map((entry) => entry.rect);

  function pathIntersectsObstacles(points) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (segmentHitsAny(a, b, obstacles)) return true;
    }
    return false;
  }

  function shrinkRect(rect, amount) {
    return {
      left: rect.left + amount,
      right: rect.right - amount,
      top: rect.top + amount,
      bottom: rect.bottom - amount,
    };
  }

  function closestSidePoint(rect, target) {
    const candidates = [
      { x: rect.left, y: rect.cy },
      { x: rect.right, y: rect.cy },
      { x: rect.cx, y: rect.top },
      { x: rect.cx, y: rect.bottom },
    ];
    let best = candidates[0];
    let bestDist = Infinity;
    for (const c of candidates) {
      const dx = c.x - target.x;
      const dy = c.y - target.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }
  function firstIntersectionWithRect(fromPoint, toPoint, rect) {
    if (pointInRect(fromPoint, rect)) return toPoint;

    const dx = toPoint.x - fromPoint.x;
    const dy = toPoint.y - fromPoint.y;
    if (dx === 0 && dy === 0) return toPoint;

    let bestT = Infinity;
    let hit = null;

    function consider(t, x, y) {
      if (t < 0 || t > 1) return;
      if (t >= bestT) return;
      const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (!inside) return;
      bestT = t;
      hit = { x, y };
    }

    if (dx !== 0) {
      const tLeft = (rect.left - fromPoint.x) / dx;
      consider(tLeft, rect.left, fromPoint.y + dy * tLeft);
      const tRight = (rect.right - fromPoint.x) / dx;
      consider(tRight, rect.right, fromPoint.y + dy * tRight);
    }

    if (dy !== 0) {
      const tTop = (rect.top - fromPoint.y) / dy;
      consider(tTop, fromPoint.x + dx * tTop, rect.top);
      const tBottom = (rect.bottom - fromPoint.y) / dy;
      consider(tBottom, fromPoint.x + dx * tBottom, rect.bottom);
    }

    return hit || toPoint;
  }




  const parentRect = { left: from.left, right: from.right, top: from.top, bottom: from.bottom, cx: from.cx, cy: from.cy };
  const targetRect = { left: to.left, right: to.right, top: to.top, bottom: to.bottom, cx: to.cx, cy: to.cy };  // Rule 1/2: parent -> option/condition
  if (toNode?.type === "option" || toNode?.type === "condition") {
    const start = { x: from.left + 6, y: from.bottom };
    let end = { x: to.left, y: to.cy };
    const straightEnd = firstIntersectionWithRect({ x: start.x, y: end.y }, end, targetRect);
    const points = [start, { x: start.x, y: end.y }, straightEnd];

    if (!pathIntersectsObstacles(points)) {
      return `M${start.x},${start.y} L${start.x},${end.y} L${straightEnd.x},${straightEnd.y}`;
    }

    const midX = start.x - 20;
    const elbowEnd = firstIntersectionWithRect({ x: midX, y: end.y }, end, targetRect);
    const elbow = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, elbowEnd];
    if (!pathIntersectsObstacles(elbow)) {
      return `M${start.x},${start.y} L${midX},${start.y} L${midX},${end.y} L${elbowEnd.x},${elbowEnd.y}`;
    }
  }

  // Rule 3: parent -> phrase (direct)
  let start = { x: from.right, y: from.cy };
  let end = { x: to.left, y: to.cy };

  // Special case: phrase with options/conditions to bare next
  if (
    fromNode?.type === "phrase" &&
    toNode?.type === "phrase" &&
    fromKey &&
    toKey &&
    Array.from(boundsMap.entries()).some(([key]) => {
      return key.startsWith("option:") && key.includes(`${fromNode.id}:`);
    })
  ) {
    const childBottoms = Array.from(boundsMap.entries())
      .filter(([key]) => key.startsWith("option:") && key.includes(`${fromNode.id}:`) || key.startsWith("cond:") && key.includes(`${fromNode.id}:`))
      .map(([, rect]) => rect.bottom);
    const lowest = childBottoms.length ? Math.max(...childBottoms) : from.bottom;
    const startPt = { x: from.left + 6, y: from.bottom };
    const midY = to.cy;
    const endPt = { x: to.left, y: to.cy };
    const custom = [startPt, { x: startPt.x, y: midY }, endPt];
    if (!pathIntersectsObstacles(custom)) {
      return `M${startPt.x},${startPt.y} L${startPt.x},${midY} L${endPt.x},${endPt.y}`;
    }
  }

  // Rule 4: if direct crosses parent, move start to closest side

  if (segmentIntersectsRect(start, end, shrinkRect(parentRect, pad))) {
    start = closestSidePoint(parentRect, end);
  }

  // Rule 5: if still crosses target, move end to closest side
  if (segmentIntersectsRect(start, end, shrinkRect(targetRect, pad))) {
    end = closestSidePoint(targetRect, start);
  }

  const direct = [start, end];  if (!pathIntersectsObstacles(direct)) {
    return `M${start.x},${start.y} L${end.x},${end.y}`;
  }

  // Try simple single-bend elbows before multi-bend routing
  const elbowAEnd = firstIntersectionWithRect({ x: end.x, y: start.y }, end, targetRect);
  const elbowA = [start, { x: end.x, y: start.y }, elbowAEnd];
  if (!pathIntersectsObstacles(elbowA)) {
    return `M${start.x},${start.y} L${end.x},${start.y} L${elbowAEnd.x},${elbowAEnd.y}`;
  }

  const elbowBEnd = firstIntersectionWithRect({ x: start.x, y: end.y }, end, targetRect);
  const elbowB = [start, { x: start.x, y: end.y }, elbowBEnd];
  if (!pathIntersectsObstacles(elbowB)) {
    return `M${start.x},${start.y} L${start.x},${end.y} L${elbowBEnd.x},${elbowBEnd.y}`;
  }

  // Rule 6: obstacle avoidance elbow (minimum deviation)
  const midYBase = Math.max(from.bottom, to.bottom) + 16;
  const midYAlt = Math.min(from.top, to.top) - 16;

  function elbowPath(midY) {
    const elbow = [
      start,
      { x: start.x + 10, y: start.y },
      { x: start.x + 10, y: midY },
      { x: end.x - 10, y: midY },
      { x: end.x - 10, y: end.y },
      end,
    ];
    return elbow;
  }

  const targetMid = (start.y + end.y) / 2;
  const near = [targetMid, start.y, end.y];
  for (let i = 1; i <= 6; i++) {
    const delta = i * 12;
    near.push(targetMid + delta, targetMid - delta);
  }

  const candidateSet = new Set();
  const candidates = [];
  for (const v of near) {
    const key = Math.round(v * 10) / 10;
    if (candidateSet.has(key)) continue;
    candidateSet.add(key);
    candidates.push(v);
  }

  candidates.sort((a, b) => Math.abs(a - targetMid) - Math.abs(b - targetMid));

  for (const midY of candidates) {
    const elbow = elbowPath(midY);
    if (!pathIntersectsObstacles(elbow)) {
      const endSnap = firstIntersectionWithRect({ x: end.x - 10, y: end.y }, end, targetRect);
      return `M${start.x},${start.y} L${start.x + 10},${start.y} L${start.x + 10},${midY} L${end.x - 10},${midY} L${end.x - 10},${end.y} L${endSnap.x},${endSnap.y}`;
    }
  }

  const laneCandidates = [
    midYBase + laneIndex * spacing,
    midYAlt - laneIndex * spacing,
    midYBase + (laneIndex + 1) * spacing,
    midYAlt - (laneIndex + 1) * spacing,
  ];

  for (const midY of laneCandidates) {
    const elbow = elbowPath(midY);
    if (!pathIntersectsObstacles(elbow)) {
      const endSnap = firstIntersectionWithRect({ x: end.x - 10, y: end.y }, end, targetRect);
      return `M${start.x},${start.y} L${start.x + 10},${start.y} L${start.x + 10},${midY} L${end.x - 10},${midY} L${end.x - 10},${end.y} L${endSnap.x},${endSnap.y}`;
    }
  }

  return `M${start.x},${start.y} L${end.x},${end.y}`;
}


function buildParentMap(nodes) {
  const parents = new Map();
  nodes.forEach((n) => {
    if (n.meta?.parentKey) {
      parents.set(n.key, n.meta.parentKey);
    }
  });
  return parents;
}

function isDescendantOf(nodeKey, ancestorKey, parentMap) {
  let cur = nodeKey;
  while (parentMap.has(cur)) {
    const p = parentMap.get(cur);
    if (p === ancestorKey) return true;
    cur = p;
  }
  return false;
}

function collectNodeBounds(nodeEls, graphWrap) {
  const wrapRect = graphWrap.getBoundingClientRect();
  const map = new Map();
  nodeEls.forEach((el, key) => {
    const r = el.getBoundingClientRect();
    map.set(key, {
      left: r.left - wrapRect.left,
      right: r.right - wrapRect.left,
      top: r.top - wrapRect.top,
      bottom: r.bottom - wrapRect.top,
    });
  });
  return map;
}

function segmentHitsAny(a, b, rects) {
  for (const rect of rects) {
    if (segmentIntersectsRect(a, b, rect)) return true;
  }
  return false;
}

function segmentIntersectsRect(a, b, rect) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);

  const pad = 6;
  const left = rect.left - pad;
  const right = rect.right + pad;
  const top = rect.top - pad;
  const bottom = rect.bottom + pad;

  if (maxX < left || minX > right || maxY < top || minY > bottom) {
    return false;
  }

  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];

  for (let i = 0; i < 4; i++) {
    const c1 = corners[i];
    const c2 = corners[(i + 1) % 4];
    if (segmentsIntersect(a, b, c1, c2)) return true;
  }

  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
  return false;
}

function pointInRect(p, rect) {
  const pad = 6;
  return p.x > rect.left - pad && p.x < rect.right + pad && p.y > rect.top - pad && p.y < rect.bottom + pad;
}

function segmentsIntersect(a, b, c, d) {
  function cross(p, q, r) {
    return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  }

  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

function buildDialogFlowNodes(dialogKey, rootId, edges, allowedPhraseIds = null) {
  const nodes = [];
  const nodeMap = new Map();
  const visited = new Set();
  const queue = [{ id: rootId }];
  const dialog = state.world.dialogs[dialogKey];

  function addNode(node) {
    if (nodeMap.has(node.key)) return;
    nodeMap.set(node.key, node);
    nodes.push(node);
  }

  while (queue.length) {
    const cur = queue.shift();
    if (!cur || !cur.id) continue;
    if (allowedPhraseIds && !allowedPhraseIds.has(cur.id)) continue;
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);

    addNode({
      key: `phrase:${cur.id}`,
      id: cur.id,
      type: "phrase",
      depth: 0,
      x: 0,
      y: 0
    });

    const outs = edges[cur.id] || [];
    outs.forEach((edge) => {
      if (edge.type === "next") {
        if (!allowedPhraseIds || allowedPhraseIds.has(edge.to)) {
          queue.push({ id: edge.to });
        }
      }

      if (edge.type === "option") {
        const optKey = `option:${cur.id}:${edge.optionId}`;
        addNode({
          key: optKey,
          id: optKey,
          type: "option",
          depth: 0,
          x: 0,
          y: 0,
          meta: { id: edge.optionId, text: edge.optionText, parentKey: `phrase:${cur.id}` }
        });
        if (edge.to && (!allowedPhraseIds || allowedPhraseIds.has(edge.to))) queue.push({ id: edge.to });
      }

      if (edge.type === "condition") {
        const condKey = `cond:${cur.id}:${edge.to}`;
        addNode({
          key: condKey,
          id: condKey,
          type: "condition",
          depth: 0,
          x: 0,
          y: 0,
          meta: { label: edge.label, parentKey: `phrase:${cur.id}` }
        });
        if (edge.to && (!allowedPhraseIds || allowedPhraseIds.has(edge.to))) queue.push({ id: edge.to });
      }

      if (edge.type === "option_condition") {
        const optKey = `option:${cur.id}:${edge.optionId}`;
        addNode({
          key: optKey,
          id: optKey,
          type: "option",
          depth: 0,
          x: 0,
          y: 0,
          meta: { id: edge.optionId, text: edge.optionText, parentKey: `phrase:${cur.id}` }
        });

        const condKey = `cond:${cur.id}:${edge.optionId}:${edge.to}`;
        addNode({
          key: condKey,
          id: condKey,
          type: "condition",
          depth: 0,
          x: 0,
          y: 0,
          meta: { label: edge.label, parentKey: optKey, conditionFromOption: true }
        });

        if (edge.to && (!allowedPhraseIds || allowedPhraseIds.has(edge.to))) queue.push({ id: edge.to });
      }
    });

    // Ensure options exist even if they have no next
    const phrase = dialog?.phrases?.[cur.id];
    if (phrase?.options) {
      Object.entries(phrase.options).forEach(([optId, opt]) => {
        const optKey = `option:${cur.id}:${optId}`;
        addNode({
          key: optKey,
          id: optKey,
          type: "option",
          depth: 0,
          x: 0,
          y: 0,
          meta: { id: optId, text: opt?.text ?? "", parentKey: `phrase:${cur.id}` }
        });
      });
    }
  }

  return nodes;
}

function buildDialogFlowEdges(dialogKey, nodes, edges) {
  const nodeKeys = new Set(nodes.map((n) => n.key));
  const out = [];
  const dialog = state.world.dialogs[dialogKey];

  nodes.forEach((n) => {
    if (n.type !== "phrase") return;
    const outs = edges[n.id] || [];
    outs.forEach((edge) => {
      if (edge.type === "next") {
        const toKey = `phrase:${edge.to}`;
        if (nodeKeys.has(toKey)) {
          out.push({ from: n.key, to: toKey });
        }
      }

      if (edge.type === "option") {
        const optKey = `option:${n.id}:${edge.optionId}`;
        if (nodeKeys.has(optKey)) {
          out.push({ from: n.key, to: optKey });
          if (edge.to) {
            const toKey = `phrase:${edge.to}`;
            if (nodeKeys.has(toKey)) {
              out.push({ from: optKey, to: toKey });
            }
          }
        }
      }

      if (edge.type === "condition") {
        const condKey = `cond:${n.id}:${edge.to}`;
        if (nodeKeys.has(condKey)) {
          out.push({ from: n.key, to: condKey });
          if (edge.to) {
            const toKey = `phrase:${edge.to}`;
            if (nodeKeys.has(toKey)) {
              out.push({ from: condKey, to: toKey });
            }
          }
        }
      }

      if (edge.type === "option_condition") {
        const optKey = `option:${n.id}:${edge.optionId}`;
        const condKey = `cond:${n.id}:${edge.optionId}:${edge.to}`;
        if (nodeKeys.has(optKey)) {
          out.push({ from: n.key, to: optKey });
        }
        if (nodeKeys.has(condKey)) {
          if (nodeKeys.has(optKey)) {
            out.push({ from: optKey, to: condKey });
          } else {
            out.push({ from: n.key, to: condKey });
          }
          if (edge.to) {
            const toKey = `phrase:${edge.to}`;
            if (nodeKeys.has(toKey)) {
              out.push({ from: condKey, to: toKey });
            }
          }
        }
      }
    });

    const phrase = dialog?.phrases?.[n.id];
    if (phrase?.options) {
      Object.keys(phrase.options).forEach((optId) => {
        const optKey = `option:${n.id}:${optId}`;
        if (nodeKeys.has(optKey)) {
          const already = out.some((e) => e.from === n.key && e.to === optKey);
          if (!already) out.push({ from: n.key, to: optKey });
        }
      });
    }
  });

  return out;
}
function buildPhraseAdj(edges) {
  const adj = new Map();
  Object.entries(edges).forEach(([from, list]) => {
    list.forEach((edge) => {
      if (!edge.to) return;
      if (!adj.has(from)) adj.set(from, new Set());
      adj.get(from).add(edge.to);
    });
  });
  return adj;
}

function detectDialogRecursion(rootId, adj) {
  const stack = new Set();
  const visited = new Set();
  const rec = new Set();

  function dfs(node) {
    if (!node) return;
    if (stack.has(node)) return;
    stack.add(node);

    const nexts = adj.get(node) || [];
    nexts.forEach((to) => {
      if (stack.has(to)) {
        rec.add(`${node}=>${to}`);
        return;
      }
      if (!visited.has(to)) dfs(to);
    });

    stack.delete(node);
    visited.add(node);
  }

  dfs(rootId);
  return rec;
}

function computePhraseDepths(rootId, adj, rec) {
  const depths = new Map();
  depths.set(rootId, 0);

  const nodes = Array.from(adj.keys());
  for (let i = 0; i < nodes.length + 2; i++) {
    let changed = false;
    nodes.forEach((from) => {
      if (!depths.has(from)) return;
      const fromDepth = depths.get(from) ?? 0;
      (adj.get(from) || []).forEach((to) => {
        if (rec.has(`${from}=>${to}`)) return;
        const nextDepth = fromDepth + 1;
        if ((depths.get(to) ?? -1) < nextDepth) {
          depths.set(to, nextDepth);
          changed = true;
        }
      });
    });
    if (!changed) break;
  }

  return depths;
}

function layoutDialogNodes(nodes, edges, rootId) {
  const BASE_WIDTH = 240;
  const SHRINK = 20;
  const MIN_WIDTH = 140;
  const CHILD_OFFSET_X = 20;
  const CHILD_GAP_Y = 24;
  const CHILD_ROW_Y = 90;

  const colWidth = 280;
  const rowHeight = 140;
  const GAP = 18;
  const RIGHT_GAP = 18;
  const PAD = 6;

  const phraseAdj = buildPhraseAdj(edges);
  const recursion = detectDialogRecursion(rootId, phraseAdj);
  const depths = computePhraseDepths(rootId, phraseAdj, recursion);

  const nodeMap = new Map(nodes.map((n) => [n.key, n]));

  nodes.forEach((node) => {
    if (node.type === "phrase") {
      node.depth = depths.get(node.id) ?? 0;
      node.width = BASE_WIDTH;
      return;
    }

    const parentKey = node.meta?.parentKey;
    const parent = parentKey ? nodeMap.get(parentKey) : null;
    const base = parent?.depth ?? 0;
    node.depth = base + 1;
    const parentWidth = parent?.width ?? BASE_WIDTH;
    node.width = Math.max(MIN_WIDTH, parentWidth - SHRINK);
  });

  function nodeHeight(node) {
    if (node.type === "phrase") return 110;
    if (node.type === "option") return 80;
    if (node.type === "condition") return 70;
    return 80;
  }

  const occupied = [];
  const rectByKey = new Map();
  const positionedNodes = new Set();
  const visitedPhrases = new Set();

  function requiredYFor(x, w, h, y) {
    let req = y;
    for (const rect of occupied) {
      if (rect.left > x + 1) {
        req = Math.max(req, rect.bottom + RIGHT_GAP);
      }

      const overlap = !(
        x + w + PAD <= rect.left ||
        x >= rect.right + PAD ||
        y + h + PAD <= rect.top ||
        y >= rect.bottom + PAD
      );

      if (overlap) {
        req = Math.max(req, rect.bottom + GAP);
      }
    }
    return req;
  }

  function placeNode(node, desiredY) {
    if (!node) return desiredY;
    if (positionedNodes.has(node.key)) return node.y ?? desiredY;

    let x = node.depth * colWidth;
    if (node.type !== "phrase") {
      const parentKey = node.meta?.parentKey;
      const parent = parentKey ? nodeMap.get(parentKey) : null;
      if (parent && Number.isFinite(parent.x)) {
        x = parent.x + CHILD_OFFSET_X;
      }
    }

    const w = node.width ?? BASE_WIDTH;
    const h = nodeHeight(node);
    let y = Math.max(0, desiredY);

    while (true) {
      const req = requiredYFor(x, w, h, y);
      if (req <= y) break;
      y = req;
    }

    node.x = x;
    node.y = y;

    const rect = { left: x, right: x + w, top: y, bottom: y + h, key: node.key };
    occupied.push(rect);
    rectByKey.set(node.key, rect);
    positionedNodes.add(node.key);

    return y;
  }

  function placeAligned(nodeA, nodeB, desiredY) {
    if (!nodeA || !nodeB) return desiredY;

    if (positionedNodes.has(nodeA.key) && positionedNodes.has(nodeB.key)) {
      return nodeB.y ?? desiredY;
    }

    if (positionedNodes.has(nodeA.key) && !positionedNodes.has(nodeB.key)) {
      return placeNode(nodeB, nodeA.y ?? desiredY);
    }

    if (!positionedNodes.has(nodeA.key) && positionedNodes.has(nodeB.key)) {
      return placeNode(nodeA, nodeB.y ?? desiredY);
    }

    let xA = nodeA.depth * colWidth;
    let xB = nodeB.depth * colWidth;

    if (nodeA.type !== "phrase") {
      const parentKey = nodeA.meta?.parentKey;
      const parent = parentKey ? nodeMap.get(parentKey) : null;
      if (parent && Number.isFinite(parent.x)) {
        xA = parent.x + CHILD_OFFSET_X;
      }
    }

    if (nodeB.type !== "phrase") {
      const parentKey = nodeB.meta?.parentKey;
      const parent = parentKey ? nodeMap.get(parentKey) : null;
      if (parent && Number.isFinite(parent.x)) {
        xB = parent.x + CHILD_OFFSET_X;
      }
    }

    const wA = nodeA.width ?? BASE_WIDTH;
    const hA = nodeHeight(nodeA);

    const wB = nodeB.width ?? BASE_WIDTH;
    const hB = nodeHeight(nodeB);

    let y = Math.max(0, desiredY);

    while (true) {
      const reqA = requiredYFor(xA, wA, hA, y);
      const reqB = requiredYFor(xB, wB, hB, y);
      const req = Math.max(reqA, reqB);
      if (req <= y) break;
      y = req;
    }

    nodeA.x = xA;
    nodeA.y = y;
    nodeB.x = xB;
    nodeB.y = y;

    const rectA = { left: xA, right: xA + wA, top: y, bottom: y + hA, key: nodeA.key };
    const rectB = { left: xB, right: xB + wB, top: y, bottom: y + hB, key: nodeB.key };

    occupied.push(rectA, rectB);
    rectByKey.set(nodeA.key, rectA);
    rectByKey.set(nodeB.key, rectB);
    positionedNodes.add(nodeA.key);
    positionedNodes.add(nodeB.key);

    return y;
  }

  function placePhrase(phraseId, desiredY) {
    if (!phraseId) return;
    const phraseKey = `phrase:${phraseId}`;
    const phraseNode = nodeMap.get(phraseKey);
    if (!phraseNode) return;

    if (!positionedNodes.has(phraseKey)) {
      placeNode(phraseNode, desiredY);
    }

    if (visitedPhrases.has(phraseId)) return;
    visitedPhrases.add(phraseId);

    const baseNode = nodeMap.get(phraseKey);
    if (!baseNode) return;

    let childCursor = baseNode.y + CHILD_ROW_Y;
    const optionCondCursor = new Map();

    const outs = edges[phraseId] || [];
    const optionEdges = outs.filter((edge) => edge.type !== "next");
    const nextEdges = outs.filter((edge) => edge.type === "next");

    optionEdges.forEach((edge) => {
      if (edge.type === "option") {
        const optKey = `option:${phraseId}:${edge.optionId}`;
        const optNode = nodeMap.get(optKey);
        const childNode = edge.to ? nodeMap.get(`phrase:${edge.to}`) : null;

        if (optNode && childNode) {
          const y = placeAligned(optNode, childNode, childCursor);
          childCursor = y + CHILD_ROW_Y;
        } else if (optNode) {
          const y = placeNode(optNode, childCursor);
          childCursor = y + CHILD_ROW_Y;
        }

        if (edge.to) placePhrase(edge.to, optNode?.y ?? baseNode.y);
        return;
      }

      if (edge.type === "condition") {
        const condKey = `cond:${phraseId}:${edge.to}`;
        const condNode = nodeMap.get(condKey);
        const childNode = edge.to ? nodeMap.get(`phrase:${edge.to}`) : null;

        if (condNode && childNode) {
          const y = placeAligned(condNode, childNode, childCursor);
          childCursor = y + CHILD_ROW_Y;
        } else if (condNode) {
          const y = placeNode(condNode, childCursor);
          childCursor = y + CHILD_ROW_Y;
        }

        if (edge.to) placePhrase(edge.to, condNode?.y ?? baseNode.y);
        return;
      }

      if (edge.type === "option_condition") {
        const optKey = `option:${phraseId}:${edge.optionId}`;
        const optNode = nodeMap.get(optKey);
        if (optNode && !positionedNodes.has(optKey)) {
          const y = placeNode(optNode, childCursor);
          childCursor = y + CHILD_ROW_Y;
        }

        const condKey = `cond:${phraseId}:${edge.optionId}:${edge.to}`;
        const condNode = nodeMap.get(condKey);
        const childNode = edge.to ? nodeMap.get(`phrase:${edge.to}`) : null;
        const optBaseY = optNode?.y ?? baseNode.y;
        const condCursor = optionCondCursor.get(optKey) ?? (optBaseY + CHILD_ROW_Y);

        if (condNode && childNode) {
          const y = placeAligned(condNode, childNode, condCursor);
          optionCondCursor.set(optKey, y + CHILD_ROW_Y);
        } else if (condNode) {
          const y = placeNode(condNode, condCursor);
          optionCondCursor.set(optKey, y + CHILD_ROW_Y);
        }

        if (edge.to) placePhrase(edge.to, condNode?.y ?? baseNode.y);
      }
    });

    const shouldStackNext = optionEdges.length > 0;
    nextEdges.forEach((edge) => {
      if (!edge.to) return;
      placePhrase(edge.to, shouldStackNext ? childCursor : baseNode.y);
    });
  }

  placePhrase(rootId, 0);

  let maxRight = 0;
  let maxBottom = 0;
  nodes.forEach((node) => {
    if (!Number.isFinite(node.x)) {
      if (node.type !== "phrase") {
        const parentKey = node.meta?.parentKey;
        const parent = parentKey ? nodeMap.get(parentKey) : null;
        if (parent && Number.isFinite(parent.x)) {
          node.x = parent.x + CHILD_OFFSET_X;
        } else {
          node.x = node.depth * colWidth;
        }
      } else {
        node.x = node.depth * colWidth;
      }
    }
    if (!Number.isFinite(node.y)) node.y = 0;
    const w = node.width ?? BASE_WIDTH;
    const h = nodeHeight(node);
    maxRight = Math.max(maxRight, node.x + w);
    maxBottom = Math.max(maxBottom, node.y + h);
  });

  return {
    width: Math.max(maxRight + colWidth, colWidth * 2),
    height: Math.max(maxBottom + rowHeight, rowHeight * 2),
  };
}

function truncateText(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "�";
}

function summariseAction(action) {
  if (!action || typeof action !== "object") return String(action ?? "");
  const type = action.type ?? "action";
  const actor = action.actor ? ` actor=${action.actor}` : "";
  return `${type}${actor}`;
}

function summariseValue(value) {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function summariseEffect(effect) {
  if (!effect || typeof effect !== "object") return String(effect ?? "");
  const type = effect.type ?? "effect";

  if (type === "updateStat") {
    const npc = effect.npc ?? "";
    const stat = effect.stat ?? "";
    const delta = effect.delta != null ? Number(effect.delta) : null;
    const deltaStr = delta == null ? "" : (delta >= 0 ? `+${delta}` : `${delta}`);
    const head = [npc, stat].filter(Boolean).join(" ");
    return `${head} ${deltaStr}`.trim();
  }

  if (type === "setStat") {
    const npc = effect.npc ?? "";
    const stat = effect.stat ?? "";
    const field = effect.field ? `.${effect.field}` : "";
    const value = effect.value != null ? summariseValue(effect.value) : "";
    const head = [npc, `${stat}${field}`].filter(Boolean).join(" ");
    return `${head}=${value}`.trim();
  }

  if (type === "setActorParam") {
    const actor = effect.actor ?? "";
    const key = effect.key ?? "";
    const value = effect.value != null ? summariseValue(effect.value) : "";
    const head = [actor, key].filter(Boolean).join(" ");
    return `${head}=${value}`.trim();
  }

  if (type === "setFlag") {
    const scope = effect.scope ? `${effect.scope}:` : "";
    const key = effect.key ?? "";
    const value = effect.value != null ? summariseValue(effect.value) : "true";
    const atEnd = effect.atEnd ? " (end)" : "";
    return `${scope}${key}=${value}${atEnd}`.trim();
  }

  if (type === "setFlagTimed") {
    const scope = effect.scope ? `${effect.scope}:` : "";
    const key = effect.key ?? "";
    const value = effect.value != null ? summariseValue(effect.value) : "true";
    const dur = effect.durationMs != null ? ` ${effect.durationMs}ms` : "";
    return `${scope}${key}=${value}${dur}`.trim();
  }

  if (type === "addItem" || type === "removeItem") {
    const id = effect.id ?? effect.item ?? "";
    const qty = effect.qty ?? effect.count;
    const qtyStr = qty != null ? ` x${qty}` : "";
    return `${type} ${id}${qtyStr}`.trim();
  }

  if (type === "openMap") return "openMap";
  if (type === "advanceTime") return `advanceTime ${effect.minutes ?? effect.min ?? ""}`.trim();
  if (type === "setTime") return `setTime ${effect.tMin ?? effect.minutes ?? ""}`.trim();
  if (type === "setTimePhase" || type === "skipToPhase") {
    return `${type} ${effect.phase ?? effect.is ?? effect.to ?? ""}`.trim();
  }

  if (type === "stun") {
    const actor = effect.actor ?? effect.npc ?? "";
    const dur = effect.durationMs != null ? `${effect.durationMs}ms` : "";
    return `stun ${actor} ${dur}`.trim();
  }

  if (type === "push") {
    const actor = effect.actor ?? effect.npc ?? "";
    const dir = effect.direction ?? "";
    const dist = effect.distance ?? "";
    return `push ${actor} ${dir} ${dist}`.trim();
  }

  const fields = Object.entries(effect)
    .filter(([k]) => k !== "type")
    .map(([k, v]) => `${k}=${summariseValue(v)}`)
    .slice(0, 3);
  const suffix = Object.keys(effect).length - 1 > 3 ? " …" : "";
  return fields.length ? `${type} ${fields.join(" ")}${suffix}` : type;
}

function summariseEffects(effects) {
  if (!effects) return "";
  if (!Array.isArray(effects)) return "effects";
  const parts = effects.map(summariseEffect).filter(Boolean);
  if (!parts.length) return `${effects.length} effect${effects.length === 1 ? "" : "s"}`;
  return parts.join("; ");
}

function matchesDialogSearch(node, dialogKey) {
  const query = (state.dialogSearch || "").trim().toLowerCase();
  if (!query) return false;
  if (node.type !== "phrase") return false;

  const dialog = state.world.dialogs[dialogKey];
  const phrase = dialog?.phrases?.[node.id] || {};
  const hay = [node.id, phrase.speaker, phrase.reaction, phrase.text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return hay.includes(query);
}
function renderDialogPhraseEditor(dialogKey, phraseId, showBackToFlow = false) {
  const dialog = state.world.dialogs[dialogKey];
  const phrase = dialog?.phrases?.[phraseId];

  if (!phrase) return;

  els.inspectorTitle.textContent = `Dialog: ${dialogKey} -> ${phraseId}`;
  inspector.innerHTML = "";

  const form = document.createElement("div");
  form.className = "form";

  if (showBackToFlow) {
    const back = document.createElement("button");
    back.textContent = "Back to flow";
    back.onclick = () => {
      renderDialogEditor(dialogKey);
    };
    form.appendChild(back);
  }

  // Phrase ID (read-only)
  form.appendChild(makeReadonly("Phrase ID", phraseId));

  // Speaker (read-only for now)
  form.appendChild(
    makeReadonly("Speaker", phrase.speaker ?? "")
  );

  // Reaction
  form.appendChild(
    makeInput("Reaction", phrase.reaction ?? "", (v) => {
      phrase.reaction = v || null;
    })
  );

  form.appendChild(
    makeInput(
      "Effects (JSON)",
      phrase.effects ? JSON.stringify(phrase.effects) : "",
      (v) => {
        try {
          phrase.effects = v ? JSON.parse(v) : null;
        } catch {
          // ignore invalid JSON while typing
        }
      }
    )
  );

  form.appendChild(
    makeCheckbox(
      "Effects Once",
      !!phrase.effectsOnce,
      (v) => {
        phrase.effectsOnce = v;
      }
    )
  );

  // Text (textarea)
  const textRow = document.createElement("div");
  textRow.className = "formRow";

  const label = document.createElement("label");
  label.textContent = "Text";

  const textarea = document.createElement("textarea");
  textarea.value = phrase.text ?? "";
  textarea.style.flex = "1";
  textarea.style.minHeight = "80px";
  textarea.oninput = () => {
    phrase.text = textarea.value;
  };

  textRow.appendChild(label);
  textRow.appendChild(textarea);
  form.appendChild(textRow);

  inspector.appendChild(form);
}

function checkConditionalOverlap(condNext) {
  const keys = Object.keys(condNext);
  const issues = [];

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = condNext[keys[i]]?.when;
      const b = condNext[keys[j]]?.when;
      if (!a || !b) continue;

      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);

      if (aKeys.some(k => bKeys.includes(k))) {
        issues.push(`${keys[i]} ↔ ${keys[j]}`);
      }
    }
  }

  return issues;
}


function findExternalPhraseReferences(dialogKey, phraseId) {
  const refs = [];

  (state.world.rules || []).forEach(rule => {
    if (rule?.dialog?.start === phraseId) {
      refs.push(`rule "${rule.id}"`);
    }
    if (rule?.scene?.start === phraseId) {
      refs.push(`scene rule "${rule.id}"`);
    }
  });

  Object.values(state.world.characters || {}).forEach((char) => {
    (char?.rules || []).forEach((rule) => {
      if (rule?.dialog?.start === phraseId) {
        refs.push(`character rule "${char.name ?? char.id ?? "unknown"}"`);
      }
      if (rule?.scene?.start === phraseId) {
        refs.push(`character scene rule "${char.name ?? char.id ?? "unknown"}"`);
      }
    });
  });

  return refs;
}

function findDialogIncomingRefs(dialogKey, phraseId, originRootId = null) {
  const dialog = state.world.dialogs[dialogKey];
  if (!dialog || !dialog.phrases) return [];
  if (!originRootId) {
    // no tree context: treat any incoming as external
    const edges = collectDialogEdges(dialog);
    const refs = [];
    Object.entries(edges).forEach(([from, list]) => {
      list.forEach((e) => {
        if (e.to === phraseId) refs.push(`phrase "${from}"`);
      });
    });
    return refs;
  }

  const edges = collectDialogEdges(dialog);
  const { treeByPhrase } = buildDialogTrees(dialogKey, edges);
  const refs = [];

  Object.entries(edges).forEach(([from, list]) => {
    list.forEach((e) => {
      if (e.to !== phraseId) return;
      const roots = treeByPhrase.get(from) || new Set();
      const sameTree = roots.size === 1 && roots.has(originRootId);
      if (!sameTree) {
        refs.push(`phrase "${from}"`);
      }
    });
  });

  return refs;
}

function clearIncomingInTree(dialogKey, phraseId, originRootId) {
  if (!originRootId) return;
  const dialog = state.world.dialogs[dialogKey];
  if (!dialog?.phrases) return;

  const edges = collectDialogEdges(dialog);
  const { treeByPhrase } = buildDialogTrees(dialogKey, edges);

  Object.entries(dialog.phrases).forEach(([id, phrase]) => {
    if (!phrase) return;
    const roots = treeByPhrase.get(id) || new Set();
    if (!(roots.size === 1 && roots.has(originRootId))) return;

    if (phrase.next === phraseId) {
      phrase.next = null;
    } else if (phrase.next && typeof phrase.next === "object") {
      if (phrase.next[phraseId]) {
        delete phrase.next[phraseId];
        if (!Object.keys(phrase.next).length) phrase.next = null;
      }
    }

    if (phrase.options && typeof phrase.options === "object") {
      Object.values(phrase.options).forEach((opt) => {
        if (!opt) return;
        if (opt.next === phraseId) {
          opt.next = null;
        } else if (opt.next && typeof opt.next === "object") {
          if (opt.next[phraseId]) {
            delete opt.next[phraseId];
            if (!Object.keys(opt.next).length) opt.next = null;
          }
        }
      });
    }
  });
}


function renderDialogPhraseEditorInline(dialogKey, phraseId, mount, originRootId = null, onDeleteClose = null) {
  const dialog = state.world.dialogs[dialogKey];
  const phrase = dialog?.phrases?.[phraseId];
  if (!phrase) return;

  const form = document.createElement("div");
  form.className = "form";

  const reactionRow = makeInput("Reaction", phrase.reaction ?? "", (v) => {
    phrase.reaction = v || null;
  });
  form.appendChild(reactionRow);

  const textRow = document.createElement("div");
  textRow.className = "formRow";

  const label = document.createElement("label");
  label.textContent = "Text";

  const textarea = document.createElement("textarea");
  textarea.value = phrase.text ?? "";
  textarea.style.flex = "1";
  textarea.style.minHeight = "80px";
  textarea.oninput = () => {
    phrase.text = textarea.value;
  };

  textRow.appendChild(label);
  textRow.appendChild(textarea);
  form.appendChild(textRow);

  const missing = getPhraseMissingFields(phrase, phraseId);
  if (missing.includes("reaction")) reactionRow.classList.add("missingField");
  if (missing.includes("text")) textRow.classList.add("missingField");

  // Action (JSON)
  form.appendChild(
    makeInput(
      "Action (JSON)",
      phrase.action ? JSON.stringify(phrase.action) : "",
      (v) => {
        try {
          phrase.action = v ? JSON.parse(v) : null;
        } catch {
          // ignore invalid JSON while typing
        }
      }
    )
  );

  renderEffectsEditor(form, phrase);

  form.appendChild(
    makeCheckbox(
      "Effects Once",
      !!phrase.effectsOnce,
      (v) => {
        phrase.effectsOnce = v;
      }
    )
  );

  // Phrase-level next
  if (typeof phrase.next === "string" || phrase.next == null) {
    form.appendChild(
      makeInput(
        "Next",
        typeof phrase.next === "string" ? phrase.next : "",
        (v) => {
          phrase.next = v || null;
        }
      )
    );
  }

  // Conditional next (editable)
  if (phrase.next && typeof phrase.next === "object") {
    const overlap = checkConditionalOverlap(phrase.next);

    const condWrap = document.createElement("div");
    condWrap.className = "sectionList";

    const title = document.createElement("div");
    title.textContent = overlap.length
      ? "Conditional next ⚠ overlapping conditions"
      : "Conditional next";
    title.style.fontWeight = "700";
    title.style.marginBottom = "6px";
    condWrap.appendChild(title);

    Object.entries(phrase.next).forEach(([target, cfg]) => {
      const row = document.createElement("div");
      row.className = "form";

      // Target phrase ID
      row.appendChild(
        makeInput("Target", target, (v) => {
          if (!v || v === target) return;
          phrase.next[v] = phrase.next[target];
          delete phrase.next[target];
        })
      );

      // When condition (raw JSON)
      row.appendChild(
        makeInput(
          "When (JSON)",
          cfg?.when ? JSON.stringify(cfg.when) : "",
          (v) => {
            try {
              cfg.when = v ? JSON.parse(v) : null;
            } catch {
              // ignore invalid JSON while typing
            }
          }
        )
      );

      const del = document.createElement("button");
      del.textContent = "Delete branch";
      del.onclick = () => {
        delete phrase.next[target];
        if (!Object.keys(phrase.next).length) {
          phrase.next = null;
        }
        renderDialogEditor(dialogKey);
      };

      row.appendChild(del);
      condWrap.appendChild(row);
    });

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add conditional branch";
    addBtn.onclick = () => {
      const id = prompt("Target phrase ID");
      if (!id) return;

      phrase.next[id] = { when: {} };
      renderDialogEditor(dialogKey);
    };

    condWrap.appendChild(addBtn);
    form.appendChild(condWrap);
  }

  const delBtn = document.createElement("button");
  delBtn.textContent = "Delete phrase";
  delBtn.style.background = "var(--danger)";

  delBtn.onclick = () => {
    const externalRefs = findExternalPhraseReferences(dialogKey, phraseId);
    const dialogRefs = findDialogIncomingRefs(dialogKey, phraseId, originRootId);

    if (phrase.next || (phrase.options && Object.keys(phrase.options).length)) {
      alert(
        "Cannot delete phrase.\n\n" +
        "This phrase has outgoing links (next / options)."
      );
      return;
    }

    if (externalRefs.length) {
      alert(
        "Cannot delete phrase. It is referenced outside this tree:\n\n" +
        externalRefs.join("\n")
      );
      return;
    }

    if (dialogRefs.length) {
      alert(
        "Cannot delete phrase. It is referenced by other trees:\n\n" +
        dialogRefs.join("\n")
      );
      return;
    }

    if (!confirm(`Delete phrase "${phraseId}"? This cannot be undone.`)) {
      return;
    }

    clearIncomingInTree(dialogKey, phraseId, originRootId);
    delete state.world.dialogs[dialogKey].phrases[phraseId];
    expandedDialogPhrases.delete(`${dialogKey}::${phraseId}`);
    renderDialogEditor(dialogKey);
    queueDirtyRefresh();
    if (typeof onDeleteClose === "function") {
      onDeleteClose();
    }
  };

  form.appendChild(delBtn);

  mount.appendChild(form);
}


function moveRule(charName, fromIndex, toIndex) {
  const rules = state.world.characters[charName].rules;
  if (toIndex < 0 || toIndex >= rules.length) return;

  const tmp = rules[fromIndex];
  rules[fromIndex] = rules[toIndex];
  rules[toIndex] = tmp;

  renderCharacterEditor(charName);
}


function renderRuleEditorInline(container, charName, ruleIndex) {
  currentRuleChar = charName;
  currentRuleIndex = ruleIndex;

  const character = state.world.characters[charName];
  const rule = character.rules[ruleIndex];

  rule.triggerWhen = rule.triggerWhen || {};



  const form = document.createElement("div");
  form.className = "form";

  // Rule ID
  form.appendChild(makeInput("Rule id", rule.id, (v) => {
    rule.id = v;
  }));

  // Enabled / Disabled
  form.appendChild(
    makeCheckbox(
      "Enabled",
      rule.disabled !== true,
      (v) => {
        rule.disabled = !v;
        renderRuleWarnings(rule);
      }
    )
  );


  const triggerTypes = ["(none)", "section_enter", "dialog_option", "party_join", "party_leave"];


  form.appendChild(
    makeSelect(
      "Trigger event",
      triggerTypes,
      rule.triggerWhen?.event,
      (v) => {
        if (v === "(none)") {
          delete rule.triggerWhen.event;
        } else {
          rule.triggerWhen.event = v;
        }
        renderCharacterEditor(charName);
      }

    )
  );

  if (rule.triggerWhen?.event === "section_enter") {
    renderSectionEnterFields(form, rule);
  }

  if (
    rule.triggerWhen?.event === "party_join" ||
    rule.triggerWhen?.event === "party_leave" ||
    rule.triggerWhen?.event === "dialog_option"
  ) {
    renderPartyJoinFields(form, rule);
  }

  if (rule.triggerWhen?.event === "dialog_option") {
    renderDialogOptionFields(form, rule);
  }

    


  // once flag
  form.appendChild(makeCheckbox("Once", !!rule.once, (v) => {
    rule.once = v;
  }));

  // renderScopeEditor(
  //   form,
  //   "Scope when",
  //   rule.scopeWhen,
  //   (v) => (rule.scopeWhen = v)
  // );

  // renderScopeEditor(
  //   form,
  //   "Descope when",
  //   rule.descopeWhen,
  //   (v) => (rule.descopeWhen = v)
  // );

  renderEventBlock(form, "Scope when", rule.scopeWhen, charName);
  renderEventBlock(form, "Descope when", rule.descopeWhen, charName);

  renderRuleDeltaEditor(form, rule);
  renderDialogEffectEditor(form, rule);

  const warnings = validateRule(rule);

  currentWarningsContainer = document.createElement("div");
  form.appendChild(currentWarningsContainer);

  renderRuleWarnings(rule);

  container.appendChild(form);
}

function renderEventBlock(form, title, obj, charName) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = title;
  h.style.fontWeight = "700";
  block.appendChild(h);

  if (!obj) {
    block.appendChild(makeReadonly("(none)", ""));
    form.appendChild(block);
    return;
  }

  // Event selector
  const eventTypes = ["(none)", "section_enter", "dialog_option", "party_join", "party_leave"];

  block.appendChild(
    makeSelect(
      "Event",
      eventTypes,
      obj.event,
      (v) => {
        if (v === "(none)") {
          Object.keys(obj).forEach(k => delete obj[k]);
        } else {
          obj.event = v;
        }
        renderCharacterEditor(charName);
      }
    )
  );

  // Event-specific fields
  if (obj.event === "section_enter") {
    renderSectionEnterFields(block, { triggerWhen: obj });
  }

  if (
    obj.event === "party_join" ||
    obj.event === "party_leave" ||
    obj.event === "dialog_option"
  ) {
    renderPartyJoinFields(block, { triggerWhen: obj });
  }

  if (obj.event === "dialog_option") {
    renderDialogOptionFields(block, { triggerWhen: obj });
  }


  form.appendChild(block);
}


function renderSectionEnterFields(form, rule) {
  const areaName = rule.triggerWhen.area;
  const area = state.world.areas?.[areaName];
  const areaNames = Object.keys(state.world.areas || {});

  // Area selector
  form.appendChild(
    makeSelect(
      "Area",
      ["(none)", ...areaNames],
      areaName ?? "(none)",
      (v) => {
        if (v === "(none)") {
          delete rule.triggerWhen.area;
        } else {
          rule.triggerWhen.area = v;
        }

        // Reset sections whenever area changes
        rule.triggerWhen.sections = [];

        renderCharacterEditor(currentRuleChar);
      }
    )
  );


    renderSectionsArrayDropdown(form, rule);
}

function renderDialogOptionFields(form, rule) {
  const npc = rule.triggerWhen.npc;
  const optionIds = getDialogOptionIds(npc);

  if (optionIds.length) {
    form.appendChild(
      makeSelect(
        "Option",
        optionIds,
        rule.triggerWhen.option,
        (v) => {
          rule.triggerWhen.option = v;
          renderRuleWarnings(
            state.world.characters[currentRuleChar].rules[currentRuleIndex]
          );
        }
      )
    );
  } else {
    form.appendChild(
      makeInput(
        "Option",
        rule.triggerWhen.option,
        (v) => {
          rule.triggerWhen.option = v;
          renderRuleWarnings(
            state.world.characters[currentRuleChar].rules[currentRuleIndex]
          );
        }
      )
    );
  }
}

function normaliseProjectRelativePath(p) {
  if (!p) return p;
  return p.startsWith("data/") ? p.slice(5) : p;
}



function renderPartyJoinFields(form, rule) {
  const npcNames = Object.keys(state.world.characters || {});
  form.appendChild(
    makeSelect(
      "NPC",
      npcNames,
      rule.triggerWhen.npc,
      (v) => {
        rule.triggerWhen.npc = v;

        // If this is a dialog_option trigger, refresh so Option becomes dropdown
        if (rule.triggerWhen.event === "dialog_option") {
          renderRuleEditor(currentRuleChar, currentRuleIndex);
        } else {
          renderRuleWarnings(
            state.world.characters[currentRuleChar].rules[currentRuleIndex]
          );
        }
      }
    )
  );
}



function renderConditionBlock(title, condition) {
  if (!condition) return null;

  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = title;
  h.style.fontWeight = "700";
  h.style.marginBottom = "4px";
  block.appendChild(h);

  Object.entries(condition).forEach(([k, v]) => {
    block.appendChild(makeReadonly(k, JSON.stringify(v)));
  });

  return block;
}

function renderEffectsEditor(mount, effectsOwner) {
  const wrap = document.createElement("div");
  wrap.className = "effectsEditor";

  function ensureList() {
    if (!Array.isArray(effectsOwner.effects)) {
      return [];
    }
    return effectsOwner.effects;
  }

  function makeRowLabel(text) {
    const label = document.createElement("label");
    label.textContent = text;
    return label;
  }

  function makeTextInput(value, onChange) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value ?? "";
    input.oninput = () => onChange(input.value);
    return input;
  }

  function makeNumberInput(value, onChange) {
    const input = document.createElement("input");
    input.type = "number";
    input.value = value ?? "";
    input.oninput = () => onChange(input.value === "" ? null : Number(input.value));
    return input;
  }

  function makeJsonInput(value, onChange) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value ? JSON.stringify(value) : "";
    input.oninput = () => {
      try {
        onChange(input.value ? JSON.parse(input.value) : null);
      } catch {
        // ignore invalid JSON while typing
      }
    };
    return input;
  }

  function makeFieldSelect(value, onChange) {
    const select = document.createElement("select");
    const options = ["", "current", "max", "base"];
    options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt ? opt : "(default)";
      select.appendChild(o);
    });
    select.value = value ?? "";
    select.onchange = () => {
      onChange(select.value || null);
    };
    return select;
  }

  function rerender() {
    wrap.innerHTML = "";
    const list = ensureList();

    const header = document.createElement("div");
    header.className = "effectsHeader";
    header.textContent = "Effects";
    wrap.appendChild(header);

    list.forEach((effect, idx) => {
      if (!effect || typeof effect !== "object") effect = { type: "updateStat" };

      const row = document.createElement("div");
      row.className = "effectsRow";

      const typeRow = document.createElement("div");
      typeRow.className = "effectsRowLine";
      typeRow.appendChild(makeRowLabel("Type"));
      const typeSelect = document.createElement("select");
      [
        "updateStat",
        "setStat",
        "setActorParam",
        "setFlag",
        "setFlagTimed",
        "restoreNpcAiState",
        "deleteActorParam",
        "removeItemInstances",
        "openMap",
        "addItem",
        "advanceTime",
        "setTime",
        "setTimePhase",
        "skipToPhase",
        "removeItem",
        "addGoal",
        "removeGoal",
        "setMovement",
        "setNpcMovement",
        "setNpcAiMode",
        "updateMobHp",
        "setMobHp",
        "stun",
        "push",
        "addTag",
        "removeTag",
        "addPartyTag",
        "removePartyTag",
        "setGateOpen",
        "toggleGate"
      ].forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        typeSelect.appendChild(opt);
      });
      typeSelect.value = effect.type ?? "updateStat";
      typeSelect.onchange = () => {
        effect.type = typeSelect.value;
        rerender();
      };
      typeRow.appendChild(typeSelect);
      row.appendChild(typeRow);

      const atEndRow = document.createElement("div");
      atEndRow.className = "effectsRowLine";
      atEndRow.appendChild(makeRowLabel("At End"));
      const atEndWrap = document.createElement("label");
      atEndWrap.className = "effectsCheckbox";
      const atEnd = document.createElement("input");
      atEnd.type = "checkbox";
      atEnd.checked = !!effect.atEnd;
      atEnd.onchange = () => { effect.atEnd = atEnd.checked; };
      atEndWrap.appendChild(atEnd);
      const atEndText = document.createElement("span");
      atEndText.textContent = "queue to end";
      atEndWrap.appendChild(atEndText);
      atEndRow.appendChild(atEndWrap);
      row.appendChild(atEndRow);

      if (effect.type === "updateStat") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Npc"));
        line1.appendChild(makeTextInput(effect.npc ?? "", (v) => { effect.npc = v || null; }));
        line1.appendChild(makeRowLabel("Stat"));
        line1.appendChild(makeTextInput(effect.stat ?? "", (v) => { effect.stat = v || null; }));
        line1.appendChild(makeRowLabel("Field"));
        line1.appendChild(makeFieldSelect(effect.field ?? "", (v) => { effect.field = v; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("Delta"));
        line2.appendChild(makeNumberInput(effect.delta ?? null, (v) => { effect.delta = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "setStat") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Npc"));
        line1.appendChild(makeTextInput(effect.npc ?? "", (v) => { effect.npc = v || null; }));
        line1.appendChild(makeRowLabel("Stat"));
        line1.appendChild(makeTextInput(effect.stat ?? "", (v) => { effect.stat = v || null; }));
        line1.appendChild(makeRowLabel("Field"));
        line1.appendChild(makeFieldSelect(effect.field ?? "", (v) => { effect.field = v; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("Value"));
        line2.appendChild(makeJsonInput(effect.value ?? null, (v) => { effect.value = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "setActorParam") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? "", (v) => { effect.actor = v || null; }));
        line1.appendChild(makeRowLabel("Key"));
        line1.appendChild(makeTextInput(effect.key ?? "", (v) => { effect.key = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("Value"));
        line2.appendChild(makeJsonInput(effect.value ?? null, (v) => { effect.value = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "setFlag") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Scope"));
        line1.appendChild(makeTextInput(effect.scope ?? "", (v) => { effect.scope = v || null; }));
        line1.appendChild(makeRowLabel("Key"));
        line1.appendChild(makeTextInput(effect.key ?? "", (v) => { effect.key = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("Value"));
        line2.appendChild(makeJsonInput(effect.value ?? null, (v) => { effect.value = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "setFlagTimed") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Scope"));
        line1.appendChild(makeTextInput(effect.scope ?? "", (v) => { effect.scope = v || null; }));
        line1.appendChild(makeRowLabel("Key"));
        line1.appendChild(makeTextInput(effect.key ?? "", (v) => { effect.key = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("Value"));
        line2.appendChild(makeJsonInput(effect.value ?? null, (v) => { effect.value = v; }));
        line2.appendChild(makeRowLabel("DurationMs"));
        line2.appendChild(makeNumberInput(effect.durationMs ?? null, (v) => { effect.durationMs = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "restoreNpcAiState") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("State"));
        line2.appendChild(makeJsonInput(effect.state ?? effect.aiState ?? null, (v) => { effect.state = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "deleteActorParam") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        line1.appendChild(makeRowLabel("Key"));
        line1.appendChild(makeTextInput(effect.key ?? effect.param ?? "", (v) => { effect.key = v || null; }));
        row.appendChild(line1);
      }

      if (effect.type === "removeItemInstances") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        line1.appendChild(makeRowLabel("Item"));
        line1.appendChild(makeTextInput(effect.id ?? effect.item ?? "", (v) => { effect.id = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("UIDs"));
        line2.appendChild(makeJsonInput(effect.uids ?? null, (v) => { effect.uids = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "openMap") {
        const line = document.createElement("div");
        line.className = "effectsRowLine";
        line.textContent = "(no fields)";
        row.appendChild(line);
      }

      if (effect.type === "addItem" || effect.type === "removeItem") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Item"));
        line1.appendChild(makeTextInput(effect.id ?? effect.item ?? "", (v) => { effect.id = v || null; }));
        line1.appendChild(makeRowLabel("Qty"));
        line1.appendChild(makeNumberInput(effect.qty ?? effect.count ?? null, (v) => { effect.qty = v; }));
        row.appendChild(line1);
      }

      if (effect.type === "advanceTime") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Minutes"));
        line1.appendChild(makeNumberInput(effect.minutes ?? effect.min ?? null, (v) => { effect.minutes = v; }));
        row.appendChild(line1);
      }

      if (effect.type === "setTime") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Minutes"));
        line1.appendChild(makeNumberInput(effect.tMin ?? effect.minutes ?? null, (v) => { effect.tMin = v; }));
        row.appendChild(line1);
      }

      if (effect.type === "setTimePhase" || effect.type === "skipToPhase") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Phase"));
        line1.appendChild(makeTextInput(effect.phase ?? effect.is ?? effect.to ?? "", (v) => { effect.phase = v || null; }));
        row.appendChild(line1);
      }

      if (effect.type === "addGoal") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("Goal"));
        line2.appendChild(makeJsonInput(effect.goal ?? effect.value ?? null, (v) => { effect.goal = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "removeGoal") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        line1.appendChild(makeRowLabel("GoalId"));
        line1.appendChild(makeTextInput(effect.goalId ?? effect.id ?? effect.goal ?? "", (v) => { effect.goalId = v || null; }));
        row.appendChild(line1);
      }

      if (effect.type === "setMovement" || effect.type === "setNpcMovement" || effect.type === "setNpcAiMode") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        line1.appendChild(makeRowLabel("Mode"));
        line1.appendChild(makeTextInput(effect.mode ?? "", (v) => { effect.mode = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("Config"));
        line2.appendChild(makeJsonInput(effect.goal ?? effect.value ?? null, (v) => { effect.goal = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "updateMobHp" || effect.type === "setMobHp") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Mob"));
        line1.appendChild(makeTextInput(effect.id ?? effect.mob ?? "", (v) => { effect.id = v || null; }));
        line1.appendChild(makeRowLabel("Instance"));
        line1.appendChild(makeTextInput(effect.instanceId ?? effect.instance ?? "", (v) => { effect.instanceId = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel(effect.type === "updateMobHp" ? "Delta" : "Value"));
        line2.appendChild(makeNumberInput(effect.delta ?? effect.value ?? null, (v) => {
          if (effect.type === "updateMobHp") effect.delta = v;
          else effect.value = v;
        }));
        row.appendChild(line2);
      }

      if (effect.type === "stun") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        line1.appendChild(makeRowLabel("DurationMs"));
        line1.appendChild(makeNumberInput(effect.durationMs ?? null, (v) => { effect.durationMs = v; }));
        row.appendChild(line1);
      }

      if (effect.type === "push") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        line1.appendChild(makeRowLabel("Direction"));
        line1.appendChild(makeTextInput(effect.direction ?? "", (v) => { effect.direction = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("Distance"));
        line2.appendChild(makeNumberInput(effect.distance ?? null, (v) => { effect.distance = v; }));
        line2.appendChild(makeRowLabel("Speed"));
        line2.appendChild(makeNumberInput(effect.speedFactor ?? null, (v) => { effect.speedFactor = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "addTag" || effect.type === "removeTag" || effect.type === "addPartyTag" || effect.type === "removePartyTag") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Actor"));
        line1.appendChild(makeTextInput(effect.actor ?? effect.npc ?? "", (v) => { effect.actor = v || null; }));
        line1.appendChild(makeRowLabel("Tag"));
        line1.appendChild(makeTextInput(effect.tag ?? effect.value ?? "", (v) => { effect.tag = v || null; }));
        row.appendChild(line1);

        const line2 = document.createElement("div");
        line2.className = "effectsRowLine";
        line2.appendChild(makeRowLabel("DurationMs"));
        line2.appendChild(makeNumberInput(effect.durationMs ?? null, (v) => { effect.durationMs = v; }));
        row.appendChild(line2);
      }

      if (effect.type === "setGateOpen") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Id"));
        line1.appendChild(makeTextInput(effect.id ?? effect.instanceId ?? "", (v) => { effect.id = v || null; }));
        line1.appendChild(makeRowLabel("Open"));
        line1.appendChild(makeJsonInput(effect.open ?? null, (v) => { effect.open = v; }));
        row.appendChild(line1);
      }

      if (effect.type === "toggleGate") {
        const line1 = document.createElement("div");
        line1.className = "effectsRowLine";
        line1.appendChild(makeRowLabel("Id"));
        line1.appendChild(makeTextInput(effect.id ?? effect.instanceId ?? "", (v) => { effect.id = v || null; }));
        row.appendChild(line1);
      }

      const controls = document.createElement("div");
      controls.className = "effectsControls";
      const up = document.createElement("button");
      up.textContent = "↑";
      up.onclick = () => {
        if (idx <= 0) return;
        const list = ensureList();
        [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
        rerender();
      };
      const down = document.createElement("button");
      down.textContent = "↓";
      down.onclick = () => {
        const list = ensureList();
        if (idx >= list.length - 1) return;
        [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]];
        rerender();
      };
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.onclick = () => {
        if (!Array.isArray(effectsOwner.effects)) return;
        effectsOwner.effects.splice(idx, 1);
        if (!effectsOwner.effects.length) {
          delete effectsOwner.effects;
        }
        rerender();
      };
      controls.appendChild(up);
      controls.appendChild(down);
      controls.appendChild(del);
      row.appendChild(controls);

      wrap.appendChild(row);
    });

    const footer = document.createElement("div");
    footer.className = "effectsFooter";
    const addBtn = document.createElement("button");
    addBtn.textContent = "Add effect";
    addBtn.onclick = () => {
      if (!Array.isArray(effectsOwner.effects)) {
        effectsOwner.effects = [];
      }
      effectsOwner.effects.push({ type: "updateStat", npc: "", stat: "", delta: 0 });
      rerender();
    };

    const rawBtn = document.createElement("button");
    rawBtn.textContent = "Raw JSON";
    rawBtn.onclick = () => {
      rawWrap.style.display = rawWrap.style.display === "none" ? "block" : "none";
      rawArea.value = JSON.stringify(ensureList(), null, 2);
    };

    footer.appendChild(addBtn);
    footer.appendChild(rawBtn);
    wrap.appendChild(footer);

    const rawWrap = document.createElement("div");
    rawWrap.className = "effectsRaw";
    rawWrap.style.display = "none";
    const rawArea = document.createElement("textarea");
    rawArea.value = JSON.stringify(ensureList(), null, 2);
    rawArea.oninput = () => {
      try {
        const parsed = JSON.parse(rawArea.value);
        if (Array.isArray(parsed)) {
          effectsOwner.effects = parsed;
          if (!effectsOwner.effects.length) {
            delete effectsOwner.effects;
          }
        }
      } catch {
        // ignore invalid JSON while typing
      }
    };
    rawWrap.appendChild(rawArea);
    wrap.appendChild(rawWrap);
  }

  rerender();
  mount.appendChild(wrap);
}

function renderWhenEditor(mount, owner) {
  const wrap = document.createElement("div");
  wrap.className = "whenEditor";

  function getWhen() {
    return owner.when && typeof owner.when === "object" ? owner.when : null;
  }

  function ensureWhen() {
    if (!owner.when || typeof owner.when !== "object") {
      owner.when = {};
    }
    return owner.when;
  }

  function updateWhen(mutator) {
    const when = ensureWhen();
    mutator(when);
  }

  function parseValue(raw) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    const num = Number(raw);
    if (raw !== "" && !Number.isNaN(num)) return num;
    return raw;
  }

  function makeListEditor(title, list, onChange) {
    const block = document.createElement("div");
    block.className = "whenBlock";
    const h = document.createElement("div");
    h.textContent = title;
    h.className = "whenBlockTitle";
    block.appendChild(h);

    (list || []).forEach((val, idx) => {
      const row = document.createElement("div");
      row.className = "whenRow";
      const input = document.createElement("input");
      input.type = "text";
      input.value = val ?? "";
      input.oninput = () => {
        list[idx] = input.value;
        onChange(list);
      };
      const del = document.createElement("button");
      del.textContent = "×";
      del.onclick = () => {
        list.splice(idx, 1);
        onChange(list);
        rerender();
      };
      row.appendChild(input);
      row.appendChild(del);
      block.appendChild(row);
    });

    const add = document.createElement("button");
    add.textContent = "Add";
    add.onclick = () => {
      list.push("");
      onChange(list);
      rerender();
    };
    block.appendChild(add);
    return block;
  }

  function makeFlagMapEditor(title, map, onChange) {
    const block = document.createElement("div");
    block.className = "whenBlock";
    const h = document.createElement("div");
    h.textContent = title;
    h.className = "whenBlockTitle";
    block.appendChild(h);

    Object.entries(map || {}).forEach(([k, v]) => {
      const row = document.createElement("div");
      row.className = "whenRow";
      const keyInput = document.createElement("input");
      keyInput.type = "text";
      keyInput.value = k;
      keyInput.placeholder = "flag";
      const valInput = document.createElement("input");
      valInput.type = "text";
      valInput.value = v === null ? "null" : String(v);
      valInput.placeholder = "true/false/null/value";

      keyInput.oninput = () => {
        if (!keyInput.value || keyInput.value === k) return;
        map[keyInput.value] = map[k];
        delete map[k];
        onChange(map);
      };
      valInput.oninput = () => {
        map[k] = parseValue(valInput.value);
        onChange(map);
      };

      const del = document.createElement("button");
      del.textContent = "×";
      del.onclick = () => {
        delete map[k];
        onChange(map);
        rerender();
      };

      row.appendChild(keyInput);
      row.appendChild(valInput);
      row.appendChild(del);
      block.appendChild(row);
    });

    const add = document.createElement("button");
    add.textContent = "Add";
    add.onclick = () => {
      map[""] = true;
      onChange(map);
      rerender();
    };
    block.appendChild(add);
    return block;
  }

  function makeStatRuleEditor(title, rule, onChange) {
    const block = document.createElement("div");
    block.className = "whenBlock";
    const h = document.createElement("div");
    h.textContent = title;
    h.className = "whenBlockTitle";
    block.appendChild(h);

    const row = document.createElement("div");
    row.className = "whenRow";
    const opSelect = document.createElement("select");
    [">", ">=", "<", "<=", "==", "!="].forEach((op) => {
      const o = document.createElement("option");
      o.value = op;
      o.textContent = op;
      opSelect.appendChild(o);
    });
    const opKey = Object.keys(rule || {})[0] || ">=";
    opSelect.value = opKey;
    const valInput = document.createElement("input");
    valInput.type = "text";
    valInput.value = rule?.[opKey] ?? "";
    valInput.placeholder = "value";

    opSelect.onchange = () => {
      const val = valInput.value;
      onChange({ [opSelect.value]: parseValue(val) });
    };
    valInput.oninput = () => {
      onChange({ [opSelect.value]: parseValue(valInput.value) });
    };

    row.appendChild(opSelect);
    row.appendChild(valInput);
    block.appendChild(row);
    return block;
  }

  function makeStatSumEditor(list, onChange) {
    const block = document.createElement("div");
    block.className = "whenBlock";
    const h = document.createElement("div");
    h.textContent = "statSum";
    h.className = "whenBlockTitle";
    block.appendChild(h);

    (list || []).forEach((rule, idx) => {
      const row = document.createElement("div");
      row.className = "whenRow";

      const actor = document.createElement("input");
      actor.type = "text";
      actor.placeholder = "actor";
      actor.value = rule.actor ?? "";
      actor.oninput = () => { rule.actor = actor.value; onChange(list); };

      const stats = document.createElement("input");
      stats.type = "text";
      stats.placeholder = "stats (comma)";
      stats.value = Array.isArray(rule.stats) ? rule.stats.join(", ") : "";
      stats.oninput = () => {
        rule.stats = stats.value.split(",").map(s => s.trim()).filter(Boolean);
        onChange(list);
      };

      const field = document.createElement("input");
      field.type = "text";
      field.placeholder = "field";
      field.value = rule.field ?? "";
      field.oninput = () => { rule.field = field.value || null; onChange(list); };

      const op = document.createElement("input");
      op.type = "text";
      op.placeholder = "op";
      op.value = rule.op ?? "";
      op.oninput = () => { rule.op = op.value || null; onChange(list); };

      const rhs = document.createElement("input");
      rhs.type = "text";
      rhs.placeholder = "rhs/value";
      rhs.value = rule.rhs ?? rule.value ?? "";
      rhs.oninput = () => { rule.rhs = parseValue(rhs.value); onChange(list); };

      const del = document.createElement("button");
      del.textContent = "×";
      del.onclick = () => {
        list.splice(idx, 1);
        onChange(list);
        rerender();
      };

      row.appendChild(actor);
      row.appendChild(stats);
      row.appendChild(field);
      row.appendChild(op);
      row.appendChild(rhs);
      row.appendChild(del);
      block.appendChild(row);
    });

    const add = document.createElement("button");
    add.textContent = "Add statSum";
    add.onclick = () => {
      list.push({ actor: "", stats: [], op: ">=", rhs: "" });
      onChange(list);
      rerender();
    };
    block.appendChild(add);
    return block;
  }

  function hasWhenData(when) {
    if (!when || typeof when !== "object") return false;
    return Object.keys(when).length > 0;
  }

  function rerender() {
    wrap.innerHTML = "";
    const when = getWhen() || {};
    const shouldOpen = wrap.dataset.open === "1" || hasWhenData(getWhen());
    wrap.dataset.open = shouldOpen ? "1" : "0";

    const header = document.createElement("div");
    header.className = "whenHeader";
    const title = document.createElement("div");
    title.textContent = "When";
    const toggle = document.createElement("button");
    toggle.textContent = hasWhenData(getWhen()) ? "Edit when" : "Add when";
    header.appendChild(title);
    header.appendChild(toggle);
    wrap.appendChild(header);

    const body = document.createElement("div");
    body.className = "whenBody";
    body.style.display = wrap.dataset.open === "1" ? "block" : "none";
    wrap.appendChild(body);

    toggle.onclick = () => {
      const next = body.style.display === "none" ? "block" : "none";
      body.style.display = next;
      wrap.dataset.open = next === "block" ? "1" : "0";
    };

    const areaRow = document.createElement("div");
    areaRow.className = "whenRow";
    areaRow.appendChild(makeRowLabel("Area"));
    const areaInput = document.createElement("input");
    areaInput.type = "text";
    areaInput.value = when.area ?? "";
    areaInput.oninput = () => {
      updateWhen((w) => {
        if (areaInput.value) w.area = areaInput.value;
        else delete w.area;
      });
    };
    areaRow.appendChild(areaInput);
    body.appendChild(areaRow);

    const sections = Array.isArray(when.sections) ? when.sections : [];
    body.appendChild(makeListEditor("Sections", sections, (v) => {
      updateWhen((w) => {
        if (v && v.length) w.sections = v;
        else delete w.sections;
      });
    }));

    const timeBlock = document.createElement("div");
    timeBlock.className = "whenBlock";
    const timeTitle = document.createElement("div");
    timeTitle.className = "whenBlockTitle";
    timeTitle.textContent = "Time";
    timeBlock.appendChild(timeTitle);

    const phaseRow = document.createElement("div");
    phaseRow.className = "whenRow";
    phaseRow.appendChild(makeRowLabel("Phase"));
    const phaseSelect = document.createElement("select");
    ["", "morning", "day", "evening", "night"].forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p ? p : "(any)";
      phaseSelect.appendChild(opt);
    });
    const phaseVal = (typeof when.timePhase === "string") ? when.timePhase : "";
    phaseSelect.value = phaseVal;
    phaseSelect.onchange = () => {
      updateWhen((w) => {
        if (phaseSelect.value) w.timePhase = phaseSelect.value;
        else delete w.timePhase;
      });
    };
    phaseRow.appendChild(phaseSelect);
    timeBlock.appendChild(phaseRow);

    const tb = when.timeBetween && typeof when.timeBetween === "object" ? when.timeBetween : {};
    const tbRow = document.createElement("div");
    tbRow.className = "whenRow";
    tbRow.appendChild(makeRowLabel("startMin"));
    const startMin = makeNumberInput(tb.startMin ?? "", (v) => {
      updateWhen((w) => {
        tb.startMin = v;
        if (v == null) delete tb.startMin;
        if (Object.keys(tb).length) w.timeBetween = tb;
        else delete w.timeBetween;
      });
    });
    tbRow.appendChild(startMin);
    tbRow.appendChild(makeRowLabel("endMin"));
    const endMin = makeNumberInput(tb.endMin ?? "", (v) => {
      updateWhen((w) => {
        tb.endMin = v;
        if (v == null) delete tb.endMin;
        if (Object.keys(tb).length) w.timeBetween = tb;
        else delete w.timeBetween;
      });
    });
    tbRow.appendChild(endMin);
    tbRow.appendChild(makeRowLabel("startT"));
    const startT = makeNumberInput(tb.startT ?? "", (v) => {
      updateWhen((w) => {
        tb.startT = v;
        if (v == null) delete tb.startT;
        if (Object.keys(tb).length) w.timeBetween = tb;
        else delete w.timeBetween;
      });
    });
    tbRow.appendChild(startT);
    tbRow.appendChild(makeRowLabel("endT"));
    const endT = makeNumberInput(tb.endT ?? "", (v) => {
      updateWhen((w) => {
        tb.endT = v;
        if (v == null) delete tb.endT;
        if (Object.keys(tb).length) w.timeBetween = tb;
        else delete w.timeBetween;
      });
    });
    tbRow.appendChild(endT);
    timeBlock.appendChild(tbRow);
    body.appendChild(timeBlock);

    const partyBlock = document.createElement("div");
    partyBlock.className = "whenBlock";
    const partyTitle = document.createElement("div");
    partyTitle.className = "whenBlockTitle";
    partyTitle.textContent = "Party";
    partyBlock.appendChild(partyTitle);

    const partyTypeRow = document.createElement("div");
    partyTypeRow.className = "whenRow";
    partyTypeRow.appendChild(makeRowLabel("Type"));
    const partyType = document.createElement("select");
    const partyTypeOptions = [
      { value: "", label: "(none)" },
      { value: "boolean", label: "This character is in the party" },
      { value: "list", label: "All listed characters are in party" },
      { value: "object", label: "Party rules (hasAll/hasAny/lacks)" }
    ];
    partyTypeOptions.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      partyType.appendChild(opt);
    });
    const partyVal = when.party;
    const partyKind = typeof partyVal === "boolean" ? "boolean" : Array.isArray(partyVal) ? "list" : (partyVal && typeof partyVal === "object") ? "object" : "";
    partyType.value = partyKind;
    partyType.onchange = () => {
      const v = partyType.value;
      updateWhen((w) => {
        if (!v) { delete w.party; return; }
        if (v === "boolean") w.party = true;
        if (v === "list") w.party = [];
        if (v === "object") w.party = { hasAll: [], hasAny: [], lacks: [] };
      });
      rerender();
    };
    partyTypeRow.appendChild(partyType);
    partyBlock.appendChild(partyTypeRow);

    if (partyKind === "boolean") {
      const row = document.createElement("div");
      row.className = "whenRow";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = !!when.party;
      chk.onchange = () => {
        updateWhen((w) => { w.party = chk.checked; });
      };
      row.appendChild(chk);
      row.appendChild(document.createTextNode(" npc in party"));
      partyBlock.appendChild(row);
    }
    if (partyKind === "list") {
      partyBlock.appendChild(makeListEditor("Has All", when.party, (v) => {
        updateWhen((w) => { w.party = v; });
      }));
    }
    if (partyKind === "object") {
      partyBlock.appendChild(makeListEditor("Has All", when.party.hasAll || [], (v) => {
        updateWhen((w) => { w.party = w.party || {}; w.party.hasAll = v; });
      }));
      partyBlock.appendChild(makeListEditor("Has Any", when.party.hasAny || [], (v) => {
        updateWhen((w) => { w.party = w.party || {}; w.party.hasAny = v; });
      }));
      partyBlock.appendChild(makeListEditor("Lacks", when.party.lacks || [], (v) => {
        updateWhen((w) => { w.party = w.party || {}; w.party.lacks = v; });
      }));
    }
    body.appendChild(partyBlock);

    body.appendChild(makeFlagMapEditor("Area Flags", when.areaFlags || {}, (v) => {
      updateWhen((w) => {
        if (v && Object.keys(v).length) w.areaFlags = v;
        else delete w.areaFlags;
      });
    }));
    body.appendChild(makeFlagMapEditor("Global Flags", when.globalFlags || {}, (v) => {
      updateWhen((w) => {
        if (v && Object.keys(v).length) w.globalFlags = v;
        else delete w.globalFlags;
      });
    }));

    if (when.flags && typeof when.flags === "object") {
      body.appendChild(makeFlagMapEditor("Flags: Area", when.flags.area || {}, (v) => {
        updateWhen((w) => {
          w.flags = w.flags || {};
          w.flags.area = v;
        });
      }));
      body.appendChild(makeFlagMapEditor("Flags: Global", when.flags.global || {}, (v) => {
        updateWhen((w) => {
          w.flags = w.flags || {};
          w.flags.global = v;
        });
      }));
    }

    const statSumList = Array.isArray(when.statSum) ? when.statSum : (when.statSum ? [when.statSum] : []);
    body.appendChild(makeStatSumEditor(statSumList, (v) => {
      updateWhen((w) => {
        if (v && v.length) w.statSum = v;
        else delete w.statSum;
      });
    }));

    if (when.alignment) {
      wrap.appendChild(makeStatRuleEditor("Alignment", when.alignment, (v) => {
        updateWhen((w) => { w.alignment = v; });
      }));
    } else {
      const add = document.createElement("button");
      add.textContent = "Add alignment check";
      add.onclick = () => { updateWhen((w) => { w.alignment = { ">=": 0 }; }); rerender(); };
      body.appendChild(add);
    }

    if (when.affection) {
      body.appendChild(makeStatRuleEditor("Affection", when.affection, (v) => {
        updateWhen((w) => { w.affection = v; });
      }));
    } else {
      const add = document.createElement("button");
      add.textContent = "Add affection check";
      add.onclick = () => { updateWhen((w) => { w.affection = { ">=": 0 }; }); rerender(); };
      body.appendChild(add);
    }

    const rawWrap = document.createElement("div");
    rawWrap.className = "whenRaw";
    rawWrap.style.display = "none";
    const rawArea = document.createElement("textarea");
    rawArea.value = JSON.stringify(when, null, 2);
    rawArea.oninput = () => {
      try {
        const parsed = JSON.parse(rawArea.value);
        if (parsed && typeof parsed === "object") owner.when = parsed;
      } catch {
        // ignore invalid JSON while typing
      }
    };
    rawWrap.appendChild(rawArea);

    const rawBtn = document.createElement("button");
    rawBtn.textContent = "Raw JSON";
    rawBtn.onclick = () => {
      rawWrap.style.display = rawWrap.style.display === "none" ? "block" : "none";
      rawArea.value = JSON.stringify(when, null, 2);
    };
    body.appendChild(rawBtn);
    body.appendChild(rawWrap);
  }

  rerender();
  mount.appendChild(wrap);
}

function renderStateEditor(mount, owner) {
  const wrap = document.createElement("div");
  wrap.className = "stateEditor";

  const stateTypes = [
    { value: "npcInParty", label: "NPC in party" },
    { value: "hasBeenInParty", label: "NPC has been in party" },
    { value: "movementState", label: "Movement state" },
    { value: "npcInSection", label: "NPC in section" },
    { value: "npcInArea", label: "NPC in area" },
    { value: "playerInArea", label: "Player in area" },
    { value: "playerInSection", label: "Player in section" },
    { value: "playerInProximity", label: "Player in proximity" },
    { value: "playerInContact", label: "Player in contact" },
    { value: "timePhase", label: "Time phase" },
    { value: "timeBetween", label: "Time between" },
    { value: "flag", label: "Flag" },
    { value: "inventory", label: "Inventory" },
    { value: "stat", label: "Stat compare" },
    { value: "statSum", label: "Stat sum" },
    { value: "actorParam", label: "Actor param" }
  ];

  function getList() {
    return Array.isArray(owner.state) ? owner.state : [];
  }

  function ensureList() {
    if (!Array.isArray(owner.state)) owner.state = [];
    return owner.state;
  }

  function updateState(mutator) {
    const list = ensureList();
    mutator(list);
    if (!list.length) delete owner.state;
  }

  function makeRowLabel(text) {
    const label = document.createElement("label");
    label.textContent = text;
    return label;
  }

  function makeTextInput(value, onChange) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value ?? "";
    input.oninput = () => onChange(input.value);
    return input;
  }

  function makeNumberInput(value, onChange) {
    const input = document.createElement("input");
    input.type = "number";
    input.value = value ?? "";
    input.oninput = () => onChange(input.value === "" ? null : Number(input.value));
    return input;
  }

  function makeBooleanSelect(value, onChange) {
    const select = document.createElement("select");
    [
      { value: "true", label: "true" },
      { value: "false", label: "false" }
    ].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      select.appendChild(o);
    });
    select.value = value ? "true" : "false";
    select.onchange = () => onChange(select.value === "true");
    return select;
  }

  function makeOpSelect(value, onChange) {
    const select = document.createElement("select");
    [">", ">=", "<", "<=", "==", "!=", "lt", "lte", "gt", "gte", "eq", "neq", "exists", "notexists"].forEach((op) => {
      const o = document.createElement("option");
      o.value = op;
      o.textContent = op;
      select.appendChild(o);
    });
    select.value = value ?? "==";
    select.onchange = () => onChange(select.value);
    return select;
  }

  function makeListEditor(title, list, onChange) {
    const block = document.createElement("div");
    block.className = "stateBlock";
    const h = document.createElement("div");
    h.textContent = title;
    h.className = "stateBlockTitle";
    block.appendChild(h);

    (list || []).forEach((val, idx) => {
      const row = document.createElement("div");
      row.className = "stateRowLine";
      const input = document.createElement("input");
      input.type = "text";
      input.value = val ?? "";
      input.oninput = () => {
        list[idx] = input.value;
        onChange(list);
      };
      const del = document.createElement("button");
      del.textContent = "×";
      del.onclick = () => {
        list.splice(idx, 1);
        onChange(list);
        rerender();
      };
      row.appendChild(input);
      row.appendChild(del);
      block.appendChild(row);
    });

    const add = document.createElement("button");
    add.textContent = "Add";
    add.onclick = () => {
      list.push("");
      onChange(list);
      rerender();
    };
    block.appendChild(add);
    return block;
  }

  function renderRuleFields(row, rule, onChange) {
    const type = rule.type;

    if (type === "npcInParty" || type === "hasBeenInParty") {
      row.appendChild(makeRowLabel("NPC"));
      row.appendChild(makeTextInput(rule.npc ?? "", (v) => { rule.npc = v; onChange(); }));
      row.appendChild(makeRowLabel("Is"));
      row.appendChild(makeBooleanSelect(rule.is !== false, (v) => { rule.is = v; onChange(); }));
      return;
    }

    if (type === "movementState") {
      row.appendChild(makeRowLabel("Actor"));
      row.appendChild(makeTextInput(rule.actor ?? rule.npc ?? "", (v) => { rule.actor = v; onChange(); }));
      row.appendChild(makeRowLabel("State"));
      row.appendChild(makeTextInput(rule.is ?? "", (v) => { rule.is = v; onChange(); }));
      return;
    }

    if (type === "npcInSection") {
      row.appendChild(makeRowLabel("NPC"));
      row.appendChild(makeTextInput(rule.npc ?? "", (v) => { rule.npc = v; onChange(); }));
      row.appendChild(makeRowLabel("Section"));
      row.appendChild(makeTextInput(rule.section ?? "", (v) => { rule.section = v; onChange(); }));
      row.appendChild(makeRowLabel("Area"));
      row.appendChild(makeTextInput(rule.area ?? "", (v) => { rule.area = v || null; onChange(); }));
      return;
    }

    if (type === "npcInArea") {
      row.appendChild(makeRowLabel("NPC"));
      row.appendChild(makeTextInput(rule.npc ?? "", (v) => { rule.npc = v; onChange(); }));
      row.appendChild(makeRowLabel("Area"));
      row.appendChild(makeTextInput(rule.area ?? "", (v) => { rule.area = v; onChange(); }));
      row.appendChild(makeRowLabel("Is"));
      row.appendChild(makeBooleanSelect(rule.is !== false, (v) => { rule.is = v; onChange(); }));
      return;
    }

    if (type === "playerInArea") {
      row.appendChild(makeRowLabel("Area"));
      row.appendChild(makeTextInput(rule.area ?? "", (v) => { rule.area = v; onChange(); }));
      row.appendChild(makeRowLabel("Is"));
      row.appendChild(makeBooleanSelect(rule.is !== false, (v) => { rule.is = v; onChange(); }));
      return;
    }

    if (type === "playerInSection") {
      row.appendChild(makeRowLabel("Section"));
      row.appendChild(makeTextInput(rule.section ?? "", (v) => { rule.section = v; onChange(); }));
      row.appendChild(makeRowLabel("Area"));
      row.appendChild(makeTextInput(rule.area ?? "", (v) => { rule.area = v || null; onChange(); }));
      row.appendChild(makeRowLabel("Is"));
      row.appendChild(makeBooleanSelect(rule.is !== false, (v) => { rule.is = v; onChange(); }));
      return;
    }

    if (type === "playerInProximity") {
      row.appendChild(makeRowLabel("Kind"));
      row.appendChild(makeTextInput(rule.kind ?? "", (v) => { rule.kind = v; onChange(); }));
      row.appendChild(makeRowLabel("ID/NPC"));
      row.appendChild(makeTextInput(rule.id ?? rule.npc ?? "", (v) => { rule.id = v; onChange(); }));
      row.appendChild(makeRowLabel("Recruitable"));
      row.appendChild(makeBooleanSelect(!!rule.recruitable, (v) => { rule.recruitable = v; onChange(); }));
      return;
    }

    if (type === "playerInContact") {
      row.appendChild(makeRowLabel("Kind"));
      row.appendChild(makeTextInput(rule.kind ?? "", (v) => { rule.kind = v; onChange(); }));
      row.appendChild(makeRowLabel("ID/Mob"));
      row.appendChild(makeTextInput(rule.id ?? rule.mob ?? "", (v) => { rule.id = v; onChange(); }));
      return;
    }

    if (type === "timePhase") {
      row.appendChild(makeRowLabel("Phase"));
      row.appendChild(makeTextInput(rule.is ?? rule.phase ?? "", (v) => { rule.is = v; onChange(); }));
      return;
    }

    if (type === "timeBetween") {
      row.appendChild(makeRowLabel("startMin"));
      row.appendChild(makeNumberInput(rule.startMin ?? null, (v) => { rule.startMin = v; onChange(); }));
      row.appendChild(makeRowLabel("endMin"));
      row.appendChild(makeNumberInput(rule.endMin ?? null, (v) => { rule.endMin = v; onChange(); }));
      row.appendChild(makeRowLabel("startT"));
      row.appendChild(makeNumberInput(rule.startT ?? null, (v) => { rule.startT = v; onChange(); }));
      row.appendChild(makeRowLabel("endT"));
      row.appendChild(makeNumberInput(rule.endT ?? null, (v) => { rule.endT = v; onChange(); }));
      return;
    }

    if (type === "flag") {
      row.appendChild(makeRowLabel("Scope"));
      row.appendChild(makeTextInput(rule.scope ?? "global", (v) => { rule.scope = v; onChange(); }));
      row.appendChild(makeRowLabel("Key"));
      row.appendChild(makeTextInput(rule.key ?? "", (v) => { rule.key = v; onChange(); }));
      row.appendChild(makeRowLabel("Is"));
      const isVal = (rule.is === null) ? "null" : (rule.is === false ? "false" : "true");
      const isSelect = document.createElement("select");
      ["true", "false", "null"].forEach((val) => {
        const o = document.createElement("option");
        o.value = val;
        o.textContent = val;
        isSelect.appendChild(o);
      });
      isSelect.value = isVal;
      isSelect.onchange = () => {
        rule.is = isSelect.value === "null" ? null : (isSelect.value === "true");
        onChange();
      };
      row.appendChild(isSelect);
      return;
    }

    if (type === "inventory") {
      row.appendChild(makeRowLabel("Actor"));
      row.appendChild(makeTextInput(rule.actor ?? rule.npc ?? "player", (v) => { rule.actor = v; onChange(); }));
      row.appendChild(makeRowLabel("Item"));
      row.appendChild(makeTextInput(rule.id ?? rule.item ?? rule.itemId ?? "", (v) => { rule.id = v; onChange(); }));
      row.appendChild(makeRowLabel("Measure"));
      row.appendChild(makeTextInput(rule.measure ?? "count", (v) => { rule.measure = v; onChange(); }));
      row.appendChild(makeRowLabel("Op"));
      row.appendChild(makeOpSelect(rule.op ?? "gte", (v) => { rule.op = v; onChange(); }));
      row.appendChild(makeRowLabel("RHS"));
      row.appendChild(makeNumberInput(rule.rhs ?? rule.value ?? 1, (v) => { rule.rhs = v; onChange(); }));
      return;
    }

    if (type === "stat") {
      row.appendChild(makeRowLabel("Actor"));
      row.appendChild(makeTextInput(rule.actor ?? rule.npc ?? "player", (v) => { rule.actor = v; onChange(); }));
      row.appendChild(makeRowLabel("Stat"));
      row.appendChild(makeTextInput(rule.stat ?? "", (v) => { rule.stat = v; onChange(); }));
      row.appendChild(makeRowLabel("Field"));
      row.appendChild(makeTextInput(rule.field ?? "current", (v) => { rule.field = v; onChange(); }));
      row.appendChild(makeRowLabel("Op"));
      row.appendChild(makeOpSelect(rule.op ?? "lt", (v) => { rule.op = v; onChange(); }));
      row.appendChild(makeRowLabel("RHS"));
      row.appendChild(makeNumberInput(rule.rhs ?? rule.value ?? 0, (v) => { rule.rhs = v; onChange(); }));
      return;
    }

    if (type === "statSum") {
      row.appendChild(makeRowLabel("Actor"));
      row.appendChild(makeTextInput(rule.actor ?? rule.npc ?? "player", (v) => { rule.actor = v; onChange(); }));
      row.appendChild(makeRowLabel("Stats"));
      row.appendChild(makeTextInput(Array.isArray(rule.stats) ? rule.stats.join(", ") : "", (v) => {
        rule.stats = v.split(",").map(s => s.trim()).filter(Boolean);
        onChange();
      }));
      row.appendChild(makeRowLabel("Field"));
      row.appendChild(makeTextInput(rule.field ?? "current", (v) => { rule.field = v; onChange(); }));
      row.appendChild(makeRowLabel("Op"));
      row.appendChild(makeOpSelect(rule.op ?? "lt", (v) => { rule.op = v; onChange(); }));
      row.appendChild(makeRowLabel("RHS"));
      row.appendChild(makeNumberInput(rule.rhs ?? rule.value ?? 0, (v) => { rule.rhs = v; onChange(); }));
      return;
    }

    if (type === "actorParam") {
      row.appendChild(makeRowLabel("Actor"));
      row.appendChild(makeTextInput(rule.actor ?? rule.npc ?? "player", (v) => { rule.actor = v; onChange(); }));
      row.appendChild(makeRowLabel("Key"));
      row.appendChild(makeTextInput(rule.key ?? rule.param ?? "", (v) => { rule.key = v; onChange(); }));
      row.appendChild(makeRowLabel("Op"));
      row.appendChild(makeOpSelect(rule.op ?? "eq", (v) => { rule.op = v; onChange(); }));
      row.appendChild(makeRowLabel("Value"));
      row.appendChild(makeTextInput(rule.value ?? "", (v) => { rule.value = v; onChange(); }));
      return;
    }
  }

  function renderRuleList(list, container, depth = 0) {
    list.forEach((rule, idx) => {
      if (!rule || typeof rule !== "object") rule = { type: "npcInParty", npc: "", is: true };
      if (!rule.type && !rule.any) rule.type = "npcInParty";

      const row = document.createElement("div");
      row.className = "stateRow";
      row.style.marginLeft = `${depth * 14}px`;

      if (Array.isArray(rule.any)) {
        const title = document.createElement("div");
        title.className = "stateRowLine";
        title.textContent = "Any of:";
        row.appendChild(title);

        const sub = Array.isArray(rule.any) ? rule.any : [];
        renderRuleList(sub, row, depth + 1);

        const addAny = document.createElement("button");
        addAny.textContent = "Add OR condition";
        addAny.onclick = () => {
          updateState(() => {
            rule.any.push({ type: "npcInParty", npc: "", is: true });
          });
          rerender();
        };
        row.appendChild(addAny);
      } else {
        const typeRow = document.createElement("div");
        typeRow.className = "stateRowLine";
        typeRow.appendChild(makeRowLabel("Type"));
        const typeSelect = document.createElement("select");
        stateTypes.forEach((t) => {
          const opt = document.createElement("option");
          opt.value = t.value;
          opt.textContent = t.label;
          typeSelect.appendChild(opt);
        });
        typeSelect.value = rule.type ?? "npcInParty";
        typeSelect.onchange = () => {
          rule.type = typeSelect.value;
          rerender();
        };
        typeRow.appendChild(typeSelect);
        row.appendChild(typeRow);

        const fields = document.createElement("div");
        fields.className = "stateRowLine";
        renderRuleFields(fields, rule, () => {});
        row.appendChild(fields);
      }

      const controls = document.createElement("div");
      controls.className = "stateControls";
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.onclick = () => {
        updateState((listRef) => {
          listRef.splice(idx, 1);
        });
        rerender();
      };
      controls.appendChild(del);
      row.appendChild(controls);

      container.appendChild(row);
    });
  }

  function rerender() {
    wrap.innerHTML = "";
    const list = getList();

    const header = document.createElement("div");
    header.className = "stateHeader";
    header.textContent = "State";
    wrap.appendChild(header);

    if (list.length) {
      renderRuleList(list, wrap);
    }

    const footer = document.createElement("div");
    footer.className = "stateFooter";
    const addBtn = document.createElement("button");
    addBtn.textContent = "Add condition";
    addBtn.onclick = () => {
      updateState((listRef) => {
        listRef.push({ type: "npcInParty", npc: "", is: true });
      });
      rerender();
    };

    const addAnyBtn = document.createElement("button");
    addAnyBtn.textContent = "Add OR group";
    addAnyBtn.onclick = () => {
      updateState((listRef) => {
        listRef.push({ any: [{ type: "npcInParty", npc: "", is: true }] });
      });
      rerender();
    };

    const rawBtn = document.createElement("button");
    rawBtn.textContent = "Raw JSON";
    rawBtn.onclick = () => {
      rawWrap.style.display = rawWrap.style.display === "none" ? "block" : "none";
      rawArea.value = JSON.stringify(getList(), null, 2);
    };

    footer.appendChild(addBtn);
    footer.appendChild(addAnyBtn);
    footer.appendChild(rawBtn);
    wrap.appendChild(footer);

    const rawWrap = document.createElement("div");
    rawWrap.className = "stateRaw";
    rawWrap.style.display = "none";
    const rawArea = document.createElement("textarea");
    rawArea.value = JSON.stringify(getList(), null, 2);
    rawArea.oninput = () => {
      try {
        const parsed = JSON.parse(rawArea.value);
        if (Array.isArray(parsed)) {
          owner.state = parsed;
          if (!owner.state.length) delete owner.state;
        }
      } catch {
        // ignore invalid JSON while typing
      }
    };
    rawWrap.appendChild(rawArea);
    wrap.appendChild(rawWrap);
  }

  rerender();
  mount.appendChild(wrap);
}

function makeInput(label, value, onChange, type = "text") {
  const row = document.createElement("div");
  row.className = "formRow";

  const l = document.createElement("label");
  l.textContent = label;

  const input = document.createElement("input");
  input.type = type;
  input.value = value ?? "";

  input.oninput = () => {
    onChange(input.value);
  };

  row.appendChild(l);
  row.appendChild(input);
  return row;
}


function makeReadonly(label, value) {
  const row = document.createElement("div");
  row.className = "formRow";

  const l = document.createElement("label");
  l.textContent = label;

  const v = document.createElement("div");
  v.textContent = value;
  v.style.opacity = "0.8";
  v.style.fontSize = "13px";

  row.appendChild(l);
  row.appendChild(v);
  return row;
}

function makeSelect(label, options, value, onChange) {
  const row = document.createElement("div");
  row.className = "formRow";

  const l = document.createElement("label");
  l.textContent = label;

  const select = document.createElement("select");
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    select.appendChild(o);
  });

  select.value = value ?? options[0];
  select.onchange = () => {
    onChange(select.value);
  };


  row.appendChild(l);
  row.appendChild(select);
  return row;
}

function makeCheckbox(label, value, onChange) {
  const row = document.createElement("div");
  row.className = "formRow";

  const l = document.createElement("label");
  l.textContent = label;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.onchange = () => {
    onChange(input.checked);
  };


  row.appendChild(l);
  row.appendChild(input);
  return row;
}

function makeRowLabel(text) {
  const label = document.createElement("label");
  label.textContent = text;
  return label;
}

function makeNumberInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.value = value ?? "";
  input.oninput = () => onChange(input.value === "" ? null : Number(input.value));
  return input;
}

function makeJsonEditorRow(label, value, onValidJson, options = {}) {
  const row = document.createElement("div");
  row.className = "formRow";

  const l = document.createElement("label");
  l.textContent = label;

  const wrap = document.createElement("div");
  wrap.style.flex = "1";

  const textarea = document.createElement("textarea");
  textarea.value = value === undefined ? "" : pretty(value);
  textarea.style.width = "100%";
  textarea.style.minHeight = `${options.minHeight ?? 80}px`;

  const error = document.createElement("div");
  error.style.color = "var(--danger)";
  error.style.fontSize = "12px";
  error.style.marginTop = "4px";
  error.style.display = "none";

  textarea.oninput = () => {
    try {
      const parsed = textarea.value === "" ? null : JSON.parse(textarea.value);
      error.style.display = "none";
      onValidJson(parsed);
    } catch (e) {
      error.textContent = e.message;
      error.style.display = "block";
    }
  };

  wrap.appendChild(textarea);
  wrap.appendChild(error);

  row.appendChild(l);
  row.appendChild(wrap);
  return row;
}

function makeJsonTextarea(value, onValidJson, options = {}) {
  const wrap = document.createElement("div");
  wrap.style.flex = "1";

  const textarea = document.createElement("textarea");
  textarea.value = value === undefined ? "" : pretty(value);
  textarea.style.width = "100%";
  textarea.style.minHeight = `${options.minHeight ?? 60}px`;

  const error = document.createElement("div");
  error.style.color = "var(--danger)";
  error.style.fontSize = "12px";
  error.style.marginTop = "4px";
  error.style.display = "none";

  textarea.oninput = () => {
    try {
      const parsed = textarea.value === "" ? null : JSON.parse(textarea.value);
      error.style.display = "none";
      onValidJson(parsed);
    } catch (e) {
      error.textContent = e.message;
      error.style.display = "block";
    }
  };

  wrap.appendChild(textarea);
  wrap.appendChild(error);
  return wrap;
}


function createSectionFromImplicit(areaName, position) {
  const area = state.world.areas[areaName];

  const name = prompt(`Name new section at position ${position}:`);
  if (!name) return;

  if (area.sections[name]) {
    alert("A section with that name already exists.");
    return;
  }

  area.sections[name] = {
    position,
    groundimage: area.defaultground ?? null
  };

  // Expand the new section inline instead of opening old editor
  expandedAreaSections.add(`${areaName}::${name}`);
  renderAreaEditor(areaName);

}

async function openProjectFolder() {
  try {
    projectDirHandle = await window.showDirectoryPicker();

    // Explicit permission request (CRITICAL)
    const perm = await projectDirHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      projectDirHandle = null;
      setStatus("Folder permission denied.", true);
      return;
    }

    clearAll();

    dataDirHandle = await resolveDataDir(projectDirHandle);
    if (!dataDirHandle) {
      setStatus("Could not find data folder (areas.json).", true);
      return;
    }

    const loadMap = [
      ["areas", "areas.json"],
      ["characters", "characters.json"],
      ["rules", "rules.json"],
      ["items", "items.json"],
      ["objects", "objects.json"],
      ["abilities", "abilities.json"],
      ["mobs", "mobs.json"],
      ["factions", "factions.json"],
    ];

    for (const [key, filename] of loadMap) {
      if (!(await hasFileHandle(dataDirHandle, filename))) continue;
      const handle = await dataDirHandle.getFileHandle(filename, { create: false });
      const data = await loadJsonFromHandle(handle);
      state.world[key] = data;
      state.files[key] = { name: filename, handle };
      markOriginal(key, data);
    }

    await loadAllDialogs();

    // Rebuild all dialogs to materialise missing phrase IDs
    Object.keys(state.world.dialogs).forEach(rebuildDialog);

    
    buildTree();
    enableSaveButtons();
    setStatus("Project data loaded.");

  } catch (err) {
    console.error(err);
    setStatus(`Failed to open folder: ${err.message}`, true);
  }
}

function renderSectionsArrayDropdown(form, rule) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = "Sections";
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  const areaName = rule.triggerWhen.area;
  const area = state.world.areas?.[areaName];
  const sectionIds = area ? Object.keys(area.sections || {}) : [];

  // Ensure array exists
  if (!Array.isArray(rule.triggerWhen.sections)) {
    rule.triggerWhen.sections = [];
  }

  // If no area or no sections, show read-only note
  if (!areaName || !sectionIds.length) {
    block.appendChild(makeReadonly("(none)", "Select an Area first"));
    form.appendChild(block);
    return;
  }

  rule.triggerWhen.sections.forEach((value, index) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "6px";
    row.style.marginBottom = "4px";

    const select = document.createElement("select");
    sectionIds.forEach((id) => {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = id;
      select.appendChild(o);
    });

    // If current value is invalid (e.g. after area change), default to first valid
    if (!sectionIds.includes(value)) {
      rule.triggerWhen.sections[index] = sectionIds[0];
      select.value = sectionIds[0];
    } else {
      select.value = value;
    }

    select.onchange = () => {
      rule.triggerWhen.sections[index] = select.value;
      renderRuleWarnings(state.world.characters[currentRuleChar].rules[currentRuleIndex]);
    };

    const del = document.createElement("button");
    del.textContent = "×";
    del.onclick = () => {
      rule.triggerWhen.sections.splice(index, 1);
      renderCharacterEditor(currentRuleChar);
    };

    row.appendChild(select);
    row.appendChild(del);
    block.appendChild(row);
  });

  const add = document.createElement("button");
  add.textContent = "Add";
  add.onclick = () => {
    rule.triggerWhen.sections.push(sectionIds[0]);
    renderCharacterEditor(currentRuleChar);
  };

  block.appendChild(add);
  form.appendChild(block);
}


function renderStringArrayEditor(form, label, arr, onChange) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = label;
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  if (!Array.isArray(arr)) {
    block.appendChild(makeReadonly("(none)", ""));
  } else {
    arr.forEach((value, index) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "6px";
      row.style.marginBottom = "4px";

      const input = document.createElement("input");
      input.type = "text";
      input.value = value;
      input.oninput = () => {
        arr[index] = input.value;
        onChange(arr);
      };

      const del = document.createElement("button");
      del.textContent = "×";
      del.onclick = () => {
        arr.splice(index, 1);
        onChange(arr);
      };

      row.appendChild(input);
      row.appendChild(del);
      block.appendChild(row);
    });
  }

  const add = document.createElement("button");
  add.textContent = "+ Add section";
  add.onclick = () => {
    if (!Array.isArray(arr)) arr = [];
    arr.push("");
    onChange(arr);
  };

  block.appendChild(add);
  form.appendChild(block);
}


// function renderScopeEditor(form, title, obj, onChange) {
//   const block = document.createElement("div");
//   block.className = "sectionList";

//   const h = document.createElement("div");
//   h.textContent = title;
//   h.style.fontWeight = "700";
//   h.style.marginBottom = "6px";
//   block.appendChild(h);

//   const type = obj ? Object.keys(obj)[0] : "(none)";

//   const typeSelect = makeSelect(
//     "Type",
//     ["(none)", "inArea", "leaveArea"],
//     type,
//     (v) => {
//       if (v === "(none)") {
//         onChange(null);
//       } else if (!obj || !obj[v]) {
//         onChange({ [v]: "" });
//       }
//       renderRuleEditor(currentRuleChar, currentRuleIndex);
//     }
//   );

//   block.appendChild(typeSelect);

//   if (obj && type !== "(none)") {
//     block.appendChild(
//       makeSelect(
//         "Area",
//         Object.keys(state.world.areas),
//         obj[type],
//         (v) => {
//           obj[type] = v;
//         }
//       )
//     );
//   }

//   form.appendChild(block);
// }

function renderScopeEditor(form, title, obj) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = title;
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  if (!obj) {
    block.appendChild(makeReadonly("(none)", ""));
    form.appendChild(block);
    return;
  }

  Object.entries(obj).forEach(([key, value]) => {
    block.appendChild(
      makeInput(key, value, (v) => {
        obj[key] = v;
      })
    );
  });

  form.appendChild(block);
}


// function renderEffectsEditor(form, rule) {
//   const block = document.createElement("div");
//   block.className = "sectionList";

//   const h = document.createElement("div");
//   h.textContent = "Effects";
//   h.style.fontWeight = "700";
//   h.style.marginBottom = "6px";
//   block.appendChild(h);

//   rule.effects = rule.effects || {};

//   block.appendChild(
//     makeInput("Affection Δ", rule.effects.affection ?? "", (v) => {
//       rule.effects.affection = Number(v);
//     }, "number")
//   );

//   block.appendChild(
//     makeInput("Alignment Δ", rule.effects.alignment ?? "", (v) => {
//       rule.effects.alignment = Number(v);
//     }, "number")
//   );

//   form.appendChild(block);
// }

function renderDialogEffectEditor(form, rule) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = "Dialog";
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  // No dialog yet → allow adding
  if (!rule.dialog) {
    const add = document.createElement("button");
    add.textContent = "Add dialog effect";
    add.onclick = () => {
      rule.dialog = { prompt: "", start: "" };
      renderCharacterEditor(currentRuleChar);
    };

    block.appendChild(makeReadonly("(none)", ""));
    block.appendChild(add);
    form.appendChild(block);
    return;
  }

  // Prompt
  block.appendChild(
    makeInput("Prompt", rule.dialog.prompt ?? "", (v) => {
      rule.dialog.prompt = v;
    })
  );

  // Start phrase
  const character = state.world.characters[currentRuleChar];

  // character.dialog is a path like "data/dialogs/rowyn.json"
  const dialogFilename = (character?.dialog || "").split("/").pop().toLowerCase(); // "rowyn.json"
  const dialogKey = dialogFilename.replace(/\.json$/i, ""); // "rowyn"

  const dialog = dialogKey ? state.world.dialogs[dialogKey] : null;
  const phraseIds = dialog ? Object.keys(dialog.phrases || {}) : [];



  block.appendChild(
    makeSelect(
      "Start phrase",
      phraseIds,
      rule.dialog.start,
      (v) => {
        rule.dialog.start = v;
      }
    )
  );


  // Remove dialog
  const del = document.createElement("button");
  del.textContent = "Remove dialog effect";
  del.onclick = () => {
    delete rule.dialog;
    renderCharacterEditor(currentRuleChar);
  };

  block.appendChild(del);
  form.appendChild(block);
}


function renderRuleDeltaEditor(form, rule) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = "Delta";
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  if (!rule.delta) {
    rule.delta = {};
  }

  Object.entries(rule.delta).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "deltaRow";
    row.style.display = "flex";
    row.style.gap = "6px";
    row.style.alignItems = "center";

    // Stat name
    const keyInput = document.createElement("input");
    keyInput.value = key;
    keyInput.placeholder = "stat";
    keyInput.style.flex = "1";
    keyInput.onchange = () => {
      if (!keyInput.value || keyInput.value === key) return;
      rule.delta[keyInput.value] = rule.delta[key];
      delete rule.delta[key];
      renderCharacterEditor(currentRuleChar);
    };

    // Value
    const valInput = document.createElement("input");
    valInput.type = "number";
    valInput.value = value;
    valInput.style.width = "80px";
    valInput.onchange = () => {
      rule.delta[key] = Number(valInput.value);
    };

    // Delete
    const del = document.createElement("button");
    del.textContent = "✕";
    del.onclick = () => {
      delete rule.delta[key];
      renderCharacterEditor(currentRuleChar);
    };

    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(del);
    block.appendChild(row);
  });

  // Add delta row
  const add = document.createElement("button");
  add.textContent = "Add delta";
  add.onclick = () => {
    rule.delta[""] = 0;
    renderCharacterEditor(currentRuleChar);
  };

  block.appendChild(add);
  form.appendChild(block);
}


// function renderRuleDeltaEditor(form, rule) {
//   const block = document.createElement("div");
//   block.className = "sectionList";

//   const h = document.createElement("div");
//   h.textContent = "Delta";
//   h.style.fontWeight = "700";
//   h.style.marginBottom = "6px";
//   block.appendChild(h);

//   if (!rule.delta) {
//     block.appendChild(makeReadonly("(none)", ""));
//     form.appendChild(block);
//     return;
//   }

//   Object.entries(rule.delta).forEach(([key, value]) => {
//     block.appendChild(
//       makeInput(key, value, (v) => {
//         rule.delta[key] = Number(v);
//       }, "number")
//     );
//   });

//   form.appendChild(block);
// }

function renderRuleWarnings(rule) {
  if (!currentWarningsContainer) return;

  currentWarningsContainer.innerHTML = "";

  const warnings = validateRule(rule);
  if (!warnings.length) return;

  currentWarningsContainer.style.color = "#c9a400";
  currentWarningsContainer.style.fontSize = "13px";

  warnings.forEach(w => {
    const line = document.createElement("div");
    line.textContent = "⚠ " + w;
    currentWarningsContainer.appendChild(line);
  });
}


function validateRule(rule) {
  const warnings = [];

  if (rule.disabled === true) return [];
  
  function validateEventBlock(label, block) {
    if (!block) return;

    if (!block.event) {
      warnings.push(`${label}: missing event`);
      return;
    }

    switch (block.event) {
      case "party_join":
      case "party_leave":
        if (!block.npc) warnings.push(`${label}: missing npc`);
        break;

      case "dialog_option":
        if (!block.npc) warnings.push(`${label}: missing npc`);
        if (!block.option) warnings.push(`${label}: missing option`);
        break;

      case "section_enter":
        if (!Array.isArray(block.sections) || block.sections.length === 0) {
          warnings.push(`${label}: sections[] missing or empty`);
        }
        break;

      default:
        warnings.push(`${label}: unknown event '${block.event}'`);
    }
  }

  validateEventBlock("Trigger", rule.triggerWhen);
  validateEventBlock("Scope", rule.scopeWhen);
  validateEventBlock("Descope", rule.descopeWhen);

  if (rule.delta) {
    Object.entries(rule.delta).forEach(([k, v]) => {
      if (typeof v !== "number" || Number.isNaN(v)) {
        warnings.push(`Delta '${k}' is not a number`);
      }
    });
  }

  // triggerWhen.area must exist
  if (rule.triggerWhen?.area) {
    if (!state.world.areas?.[rule.triggerWhen.area]) {
      warnings.push(
        `Unknown area: "${rule.triggerWhen.area}"`
      );
    }
  }

  // section_enter.sections must exist in the area
  if (
    rule.triggerWhen?.event === "section_enter" &&
    rule.triggerWhen.area &&
    Array.isArray(rule.triggerWhen.sections)
  ) {
    const area = state.world.areas?.[rule.triggerWhen.area];
    const validSections = area ? Object.keys(area.sections || {}) : [];

    rule.triggerWhen.sections.forEach(sec => {
      if (!validSections.includes(sec)) {
        warnings.push(
          `Unknown section "${sec}" in area "${rule.triggerWhen.area}"`
        );
      }
    });
  }

  // triggerWhen.npc must exist
  if (rule.triggerWhen?.npc) {
    if (!state.world.characters?.[rule.triggerWhen.npc]) {
      warnings.push(
        `Unknown character: "${rule.triggerWhen.npc}"`
      );
    }
  }

  // dialog_option.option must exist in NPC dialog
  if (
    rule.triggerWhen?.event === "dialog_option" &&
    rule.triggerWhen.npc &&
    rule.triggerWhen.option
  ) {
    const optionIds = getDialogOptionIds(rule.triggerWhen.npc);
    if (optionIds.length && !optionIds.includes(rule.triggerWhen.option)) {
      warnings.push(
        `Dialog option "${rule.triggerWhen.option}" does not exist for ${rule.triggerWhen.npc}`
      );
    }
  }
  return warnings;
}


function collectDialogEdges(dialog) {
  const edges = {}; // from -> [{ type, to, label, optionId, optionText }]

  Object.entries(dialog.phrases).forEach(([id, phrase]) => {
    edges[id] = edges[id] || [];

    // phrase.next
    if (typeof phrase.next === "string") {
      edges[id].push({ type: "next", to: phrase.next });
    }

    // conditional phrase.next
    if (phrase.next && typeof phrase.next === "object") {
      Object.entries(phrase.next).forEach(([to, cfg]) => {
        edges[id].push({
          type: "condition",
          to,
          label: cfg?.when ? `if ${summariseWhen(cfg.when)}` : "(default)"
        });
      });
    }

    // options
    if (phrase.options) {
      Object.entries(phrase.options).forEach(([optId, opt]) => {
        const optText = opt?.text ?? "";

        // Always include the parent -> option edge, even if it has no next
        edges[id].push({
          type: "option",
          to: typeof opt?.next === "string" ? opt.next : null,
          optionId: optId,
          optionText: optText
        });

        if (opt?.next && typeof opt.next === "object") {
          Object.entries(opt.next).forEach(([to, cfg]) => {
            edges[id].push({
              type: "option_condition",
              to,
              optionId: optId,
              optionText: optText,
              label: cfg?.when ? `if ${summariseWhen(cfg.when)}` : "(default)"
            });
          });
        }
      });
    }
  });

  return edges;
}
function summariseWhen(when) {
  if (!when || typeof when !== "object") return "";
  const parts = [];
  const handled = new Set();
  const opMap = {
    gte: ">=",
    lte: "<=",
    gt: ">",
    lt: "<",
    eq: "=",
    "==": "=",
    "===": "=",
    ne: "!=",
    neq: "!=",
    "!=": "!="
  };

  function fmtOp(op) {
    return opMap[op] || op;
  }

  function pushFlagMap(prefix, map) {
    if (!map || typeof map !== "object") return;
    Object.entries(map).forEach(([k, v]) => {
      parts.push(`${prefix} ${k} = ${summariseValue(v)}`);
    });
  }

  function fmtStatRule(label, rule) {
    if (!rule || typeof rule !== "object") return null;
    const [op, val] = Object.entries(rule)[0] || [];
    if (!op) return null;
    return `${label} ${fmtOp(op)} ${val}`;
  }

  if (when.stat && typeof when.stat === "object") {
    handled.add("stat");
    const { actor, stat, field, op, rhs } = when.stat;
    const actorStr = actor ?? "actor";
    const statStr = stat ?? "stat";
    const fieldStr = field && field !== "current" ? ` ${field}` : "";
    if (op != null && rhs != null) {
      parts.push(`${actorStr} ${statStr}${fieldStr} ${fmtOp(op)} ${rhs}`);
    } else {
      parts.push(`${actorStr} ${statStr}${fieldStr}`);
    }
  }

  if (when.alignment) {
    handled.add("alignment");
    const line = fmtStatRule("alignment", when.alignment);
    if (line) parts.push(line);
  }

  if (when.affection) {
    handled.add("affection");
    const line = fmtStatRule("affection", when.affection);
    if (line) parts.push(line);
  }

  if (when.area) {
    handled.add("area");
    parts.push(`area = ${when.area}`);
  }

  if (Array.isArray(when.sections) && when.sections.length) {
    handled.add("sections");
    parts.push(`sections include ${when.sections.join(", ")}`);
  }

  if (when.timePhase) {
    handled.add("timePhase");
    parts.push(`time phase = ${when.timePhase}`);
  }

  if (when.timeBetween && typeof when.timeBetween === "object") {
    handled.add("timeBetween");
    const tb = when.timeBetween;
    const bits = [];
    if (tb.startMin != null) bits.push(`startMin ${tb.startMin}`);
    if (tb.endMin != null) bits.push(`endMin ${tb.endMin}`);
    if (tb.startT != null) bits.push(`startT ${tb.startT}`);
    if (tb.endT != null) bits.push(`endT ${tb.endT}`);
    if (bits.length) parts.push(`time between ${bits.join(", ")}`);
  }

  if (when.party != null) {
    handled.add("party");
    if (when.party === true) {
      parts.push("party present");
    } else if (Array.isArray(when.party)) {
      parts.push(`party has ${when.party.join(", ")}`);
    } else if (typeof when.party === "object") {
      if (Array.isArray(when.party.hasAll) && when.party.hasAll.length) {
        parts.push(`party has all ${when.party.hasAll.join(", ")}`);
      }
      if (Array.isArray(when.party.hasAny) && when.party.hasAny.length) {
        parts.push(`party has any ${when.party.hasAny.join(", ")}`);
      }
      if (Array.isArray(when.party.lacks) && when.party.lacks.length) {
        parts.push(`party lacks ${when.party.lacks.join(", ")}`);
      }
    }
  }

  if (when.areaFlags) {
    handled.add("areaFlags");
    pushFlagMap("area flag", when.areaFlags);
  }

  if (when.globalFlags) {
    handled.add("globalFlags");
    pushFlagMap("global flag", when.globalFlags);
  }

  if (when.flags && typeof when.flags === "object") {
    handled.add("flags");
    pushFlagMap("area flag", when.flags.area);
    pushFlagMap("global flag", when.flags.global);
  }

  Object.entries(when).forEach(([k, v]) => {
    if (handled.has(k)) return;
    if (v && typeof v === "object") {
      const op = Object.keys(v)[0];
      if (op) {
        parts.push(`${k} ${fmtOp(op)} ${summariseValue(v[op])}`);
        return;
      }
    }
    parts.push(`${k} = ${summariseValue(v)}`);
  });

  return parts.join(", ");
}



// Wire up
els.btnClear.addEventListener("click", () => clearAll());
els.btnSaveCurrent.addEventListener("click", () => saveCurrent());
els.btnSaveAll.addEventListener("click", () => saveAll());
if (els.btnViewDiff) {
  els.btnViewDiff.addEventListener("click", () => openDiffViewer(state.selection));
}
btnOpenFolder.addEventListener("click", openProjectFolder);

clearAll();



