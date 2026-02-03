/* Stage 1 editor:
   - Load areas.json, characters.json, plus any dialog jsons
   - Show a tree
   - Inspect JSON
   - Save current / save all via downloads
*/

const inspector = document.getElementById("inspector");
const btnOpenFolder = document.getElementById("btnOpenFolder");

let projectDirHandle = null;
let currentWarningsContainer = null;
let expandedRules = new Set(); // stores rule object references
const expandedAreaSections = new Set(); // key: "AreaName::SectionName"

let currentDialogKey = null;
let currentPhraseId = null;
const expandedDialogPhrases = new Set();


const els = {
  btnClear: document.getElementById("btnClear"),
  btnSaveCurrent: document.getElementById("btnSaveCurrent"),
  btnSaveAll: document.getElementById("btnSaveAll"),
  status: document.getElementById("status"),
  tree: document.getElementById("tree"),
  inspectorTitle: document.getElementById("inspectorTitle"),
};


const state = {
  // in-memory world model
  world: {
    areas: null,
    characters: null,
    dialogs: {}, // key: "mira" / "rowyn" derived from filename
  },
  // original filenames so we can save back with same names
  files: {
    areas: null,       // { name, data }
    characters: null,  // { name, data }
    dialogs: {},       // key -> { name, data }
  },
  selection: null, // { type: "areas"|"characters"|"dialog", key?: string }
};

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

async function loadDialogsReferencedByCharacters() {
  if (!projectDirHandle || !state.world.characters) return;

  for (const [charName, charData] of Object.entries(state.world.characters)) {
    const rel = charData?.dialog;
    if (!rel) continue;

    try {
      const normalisedPath = normaliseProjectRelativePath(rel);
      const fileHandle = await getFileHandleByRelativePath(
        projectDirHandle,
        normalisedPath
      );

      const file = await fileHandle.getFile();
      const data = JSON.parse(await file.text());

      const filename = rel.split("/").pop().toLowerCase();     // "mira.json"
      const key = deriveDialogKeyFromFilename(filename).toLowerCase(); // "mira"

      state.world.dialogs[key] = data;
      state.files.dialogs[key] = { name: rel.split("/").pop(), handle: fileHandle };
    } catch (e) {
      // ignore missing dialog files; editor will fall back to text input
      // (keeps the editor resilient)
    }
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
    !!state.world.areas || !!state.world.characters || Object.keys(state.world.dialogs).length > 0;

  els.btnSaveAll.disabled = !hasAny;
  els.btnSaveCurrent.disabled = !state.selection;
}

function clearAll() {
  state.world.areas = null;
  state.world.characters = null;
  state.world.dialogs = {};
  state.files.areas = null;
  state.files.characters = null;
  state.files.dialogs = {};
  state.selection = null;

  els.inspectorTitle.textContent = "Inspector";
  els.tree.innerHTML = "";
  enableSaveButtons();
  setStatus("Cleared. Load areas.json, characters.json, and dialog .json files.");
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, "-");
}

async function ensureArchiveFolder() {
  return await projectDirHandle.getDirectoryHandle("archive", { create: true });
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


  // fallback: raw JSON view
  const pre = document.createElement("pre");
  pre.className = "jsonView";

  if (node.type === "areas") {
    els.inspectorTitle.textContent = "areas.json";
    pre.textContent = pretty(state.world.areas);
  } else if (node.type === "characters") {
    els.inspectorTitle.textContent = "characters.json";
    pre.textContent = pretty(state.world.characters);
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
  if (!sel || !projectDirHandle) return;

  try {
    if (sel.type === "areas") {
      await archiveAndWrite(state.files.areas, state.world.areas);
      setStatus("Saved areas.json");
    }

    if (sel.type === "characters") {
      await archiveAndWrite(state.files.characters, state.world.characters);
      setStatus("Saved characters.json");
    }

    if (sel.type === "dialog") {
      const f = state.files.dialogs[sel.key];

      const dialog = state.world.dialogs[sel.key];
      const clean = JSON.parse(JSON.stringify(dialog));

      Object.entries(clean.phrases || {}).forEach(([id, phrase]) => {
        const hasText = phrase.text && phrase.text.trim();
        const hasReaction = phrase.reaction && phrase.reaction.trim();
        if (!hasText && !hasReaction) {
          delete clean.phrases[id];
        }
      });

      await archiveAndWrite(f, clean);
      setStatus(`Saved ${f.name}`);
    }

  } catch (e) {
    setStatus(e.message, true);
  }
}


async function saveAll() {
  if (!projectDirHandle) return;

  try {
    if (state.files.areas)
      await archiveAndWrite(state.files.areas, state.world.areas);

    if (state.files.characters)
      await archiveAndWrite(state.files.characters, state.world.characters);

    for (const key of Object.keys(state.files.dialogs)) {
      const dialog = state.world.dialogs[key];
      const clean = JSON.parse(JSON.stringify(dialog));

      Object.entries(clean.phrases || {}).forEach(([id, phrase]) => {
        const hasText = phrase.text && phrase.text.trim();
        const hasReaction = phrase.reaction && phrase.reaction.trim();
        if (!hasText && !hasReaction) {
          delete clean.phrases[id];
        }
      });

      await archiveAndWrite(state.files.dialogs[key], clean);
    }


    setStatus("All files saved.");
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

    const del = document.createElement("button");
    del.textContent = "Remove character";
    del.onclick = () => {
      delete section.characters;
      renderAreaEditor(areaName);
    };

    charBlock.appendChild(del);
  }

  mount.appendChild(charBlock);


  // Section foreobjects
  if (!section.foreobjects) {
    section.foreobjects = [];
  }

  renderSectionForeObjectsEditor(
    mount,
    section.foreobjects,
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
    (section.exits && Object.keys(section.exits).length > 0) ||
    section.groundimage;

  if (hasData) {
    alert("Cannot delete section: section has data.");
    return;
  }

  // 2. Check rule references
  const refs = [];

  Object.values(state.world.characters || {}).forEach((char) => {
    (char.rules || []).forEach((rule) => {
      if (
        rule.triggerWhen?.event === "section_enter" &&
        rule.triggerWhen.sections?.includes(sectionName)
      ) {
        refs.push(rule.id || "(unnamed rule)");
      }
    });
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

  // Dialog (read-only for now)
  form.appendChild(makeReadonly("Dialog file", character.dialog || "(none)"));

  // Stats (if present)
  if (character.stats) {
    Object.entries(character.stats).forEach(([key, value]) => {
      form.appendChild(makeReadonly(`Stat: ${key}`, value));
    });
  }

  // Rules list
  const rules = character.rules || [];
  const rulesBlock = document.createElement("div");
  rulesBlock.className = "sectionList";

  const title = document.createElement("div");
  title.textContent = `Rules (${rules.length})`;
  title.style.fontWeight = "700";
  title.style.marginBottom = "6px";
  rulesBlock.appendChild(title);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "8px";
  controls.style.marginBottom = "6px";

  const addRule = document.createElement("button");
  addRule.textContent = "Add rule";
  addRule.onclick = () => {
    const rules = character.rules || (character.rules = []);

    const newRule = {
      id: "",
      triggerWhen: {},
      scopeWhen: { event: "" },
      descopeWhen: { event: "" }
    };


    rules.push(newRule);
    expandedRules.add(newRule);
    renderCharacterEditor(charName);
  };

  controls.appendChild(addRule);


  const expandAll = document.createElement("button");
  expandAll.textContent = "Expand all";
  expandAll.onclick = () => {
    rules.forEach(r => expandedRules.add(r));
    renderCharacterEditor(charName);
  };

  const collapseAll = document.createElement("button");
  collapseAll.textContent = "Collapse all";
  collapseAll.onclick = () => {
    expandedRules.clear();
    renderCharacterEditor(charName);
  };

  controls.appendChild(expandAll);
  controls.appendChild(collapseAll);
  rulesBlock.appendChild(controls);

  rules.forEach((rule, idx) => {
    const row = document.createElement("div");
    row.className = "sectionItem";
    if (rule.disabled === true) {
      row.style.opacity = "0.5";
    }

    // header row
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "6px";

    // expand / collapse click area
    const title = document.createElement("div");
    title.style.flex = "1";
    title.style.cursor = "pointer";
    title.textContent =
      `${idx + 1}. ${rule.id || "(no id)"} — ${rule.triggerWhen?.event || "no trigger"}`;

    title.onclick = () => {
      if (expandedRules.has(rule)) {
        expandedRules.delete(rule);
      } else {
        expandedRules.add(rule);
      }
      renderCharacterEditor(charName);
    };

    // up button
    const upBtn = document.createElement("button");
    upBtn.textContent = "⬆";
    upBtn.disabled = idx === 0;
    upBtn.onclick = (e) => {
      e.stopPropagation();
      moveRule(charName, idx, idx - 1);
    };

    // down button
    const downBtn = document.createElement("button");
    downBtn.textContent = "⬇";
    downBtn.disabled = idx === rules.length - 1;
    downBtn.onclick = (e) => {
      e.stopPropagation();
      moveRule(charName, idx, idx + 1);
    };

    header.appendChild(title);
    header.appendChild(upBtn);
    header.appendChild(downBtn);
    row.appendChild(header);


    // expanded editor
    if (expandedRules.has(rule)) {
      const editorWrap = document.createElement("div");
      editorWrap.style.marginTop = "6px";
      editorWrap.style.marginLeft = "12px";

      renderRuleEditorInline(editorWrap, charName, idx);
      row.appendChild(editorWrap);
    }

    rulesBlock.appendChild(row);
  });
      


  form.appendChild(rulesBlock);
  inspector.appendChild(form);
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

function renderDialogEditor(dialogKey) {
  const dialog = state.world.dialogs[dialogKey];
  els.inspectorTitle.textContent = `Dialog: ${dialogKey}`;
  inspector.innerHTML = "";

  const actions = document.createElement("div");
  actions.className = "contentActions";

  // Add Phrase
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

  // Rebuild Tree
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

  const wrap = document.createElement("div");
  wrap.className = "form";

  // Start phrase (read-only for now)
  wrap.appendChild(
    makeReadonly("Start", dialog.start ?? "(none)")
  );

  // Phrase list
  const list = document.createElement("div");
  list.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = `Phrases (${Object.keys(dialog.phrases).length})`;
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  list.appendChild(h);

  const edges = collectDialogEdges(dialog);

  // find roots
  const referenced = new Set();
  Object.values(edges).forEach(arr =>
    arr.forEach(e => referenced.add(e.to))
  );

  const roots = Object.keys(dialog.phrases).filter(
    id => !referenced.has(id)
  );

  // render trees
  roots.forEach(rootId => {
    renderDialogTreeNode(list, dialogKey, rootId, edges, 0, []);
  });


  wrap.appendChild(list);
  inspector.appendChild(wrap);
}

function renderDialogTreeNode(container, dialogKey, phraseId, edges, depth, path) {
  const row = document.createElement("div");
  row.className = "sectionItem";
  row.style.marginLeft = `${depth * 16}px`;

  row.textContent = phraseId;

  row.onclick = () => {
    const key = `${dialogKey}::${phraseId}`;
    if (expandedDialogPhrases.has(key)) {
      expandedDialogPhrases.delete(key);
    } else {
      expandedDialogPhrases.add(key);
    }
    renderDialogEditor(dialogKey);
  };


  container.appendChild(row);

  const key = `${dialogKey}::${phraseId}`;
  if (expandedDialogPhrases.has(key)) {
    const inner = document.createElement("div");
    inner.style.marginLeft = `${(depth + 1) * 16}px`;
    inner.style.marginTop = "6px";
    inner.style.marginBottom = "6px";

    renderDialogPhraseEditorInline(dialogKey, phraseId, inner);
    container.appendChild(inner);
  }


  // prevent infinite loops on this path
  if (path.includes(phraseId)) return;

  const nexts = edges[phraseId];
  if (!nexts) return;

  nexts.forEach(({ to, label }) => {
    const info = document.createElement("div");
    info.style.marginLeft = `${(depth + 1) * 16}px`;
    info.style.fontSize = "12px";
    info.style.opacity = "0.7";
    info.textContent = label ? `↳ ${label}` : "↳";
    container.appendChild(info);

    renderDialogTreeNode(
      container,
      dialogKey,
      to,
      edges,
      depth + 2,
      [...path, phraseId]
    );
  });
}


function renderDialogPhraseEditor(dialogKey, phraseId) {
  const dialog = state.world.dialogs[dialogKey];
  const phrase = dialog?.phrases?.[phraseId];

  if (!phrase) return;

  els.inspectorTitle.textContent = `Dialog: ${dialogKey} → ${phraseId}`;
  inspector.innerHTML = "";

  const form = document.createElement("div");
  form.className = "form";

  // Phrase ID (read-only)
  form.appendChild(makeReadonly("Phrase ID", phraseId));

  // Speaker (read-only for now)
  form.appendChild(
    makeReadonly("Speaker", phrase.speaker ?? "npc")
  );

  // Reaction
  form.appendChild(
    makeInput("Reaction", phrase.reaction ?? "", (v) => {
      phrase.reaction = v || null;
    })
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


function findPhraseReferences(dialogKey, phraseId) {
  const dialog = state.world.dialogs[dialogKey];
  const refs = [];

  // dialog phrases
  Object.entries(dialog.phrases).forEach(([id, phrase]) => {
    if (!phrase) return;

    // phrase.next
    if (phrase.next === phraseId) {
      refs.push(`phrase "${id}" → next`);
    }

    // conditional option.next
    if (phrase.options) {
      Object.entries(phrase.options).forEach(([optId, opt]) => {
        if (opt.next && typeof opt.next === "object" && opt.next[phraseId]) {
          refs.push(`phrase "${id}" → option "${optId}" conditional next`);
        }
      });
    }


    // conditional phrase.next
    if (phrase.next && typeof phrase.next === "object" && phrase.next[phraseId]) {
      refs.push(`phrase "${id}" → conditional next`);
    }

    // options
    if (phrase.options) {
      Object.entries(phrase.options).forEach(([optId, opt]) => {
        if (opt.next === phraseId) {
          refs.push(`phrase "${id}" → option "${optId}"`);
        }

        if (
          opt.next &&
          typeof opt.next === "object" &&
          opt.next[phraseId]
        ) {
          refs.push(`phrase "${id}" → option "${optId}" (conditional)`);
        }
      });
    }
  });

  // character rules
  Object.entries(state.world.characters || {}).forEach(([charName, char]) => {
    (char.rules || []).forEach(rule => {
      if (rule.dialog?.start === phraseId) {
        refs.push(`rule "${rule.id}" (character ${charName})`);
      }
    });
  });

  return refs;
}


function renderDialogPhraseEditorInline(dialogKey, phraseId, mount) {
  const dialog = state.world.dialogs[dialogKey];
  const phrase = dialog?.phrases?.[phraseId];
  if (!phrase) return;

  const form = document.createElement("div");
  form.className = "form";

  form.appendChild(makeReadonly("Phrase ID", phraseId));
  form.appendChild(makeReadonly("Speaker", phrase.speaker ?? "npc"));

  form.appendChild(
    makeInput("Reaction", phrase.reaction ?? "", (v) => {
      phrase.reaction = v || null;
    })
  );

  // Phrase-level next
  if (typeof phrase.next === "string" || phrase.next == null) {
    const hasOptions =
      phrase.options && Object.keys(phrase.options).length > 0;

    const nextInput = makeInput(
      "Next",
      typeof phrase.next === "string" ? phrase.next : "",
      (v) => {
        phrase.next = v || null;
      }
    );

    if (hasOptions) {
      const input = nextInput.querySelector("input");
      if (input) {
        input.disabled = true;
        input.placeholder = "Disabled (phrase has options)";
      }
    }

    form.appendChild(nextInput);
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

  // OPTIONS
  const options = phrase.options ?? {};

  const optWrap = document.createElement("div");
  optWrap.className = "sectionList";

  const optTitle = document.createElement("div");
  optTitle.textContent = "Options";
  optTitle.style.fontWeight = "700";
  optTitle.style.marginBottom = "6px";
  optWrap.appendChild(optTitle);

  // existing options
  Object.entries(options).forEach(([optId, opt]) => {
    const row = document.createElement("div");
    row.className = "form";
    row.style.border = "1px solid var(--border)";
    row.style.borderRadius = "6px";
    row.style.padding = "6px";

    row.appendChild(makeReadonly("Option ID", optId));

    row.appendChild(
      makeInput("Text", opt.text ?? "", (v) => {
        opt.text = v;
      })
    );

    // Option next
    if (typeof opt.next === "string" || opt.next == null) {
      row.appendChild(
        makeInput(
          "Next",
          typeof opt.next === "string" ? opt.next : "",
          (v) => {
            opt.next = v || null;
          }
        )
      );
    }

    // Conditional option next (read-only)
    if (opt.next && typeof opt.next === "object") {
      row.appendChild(
        makeReadonly(
          "Conditional next",
          Object.entries(opt.next)
            .map(([target, cfg]) =>
              cfg?.when
                ? `${target} (if ${summariseWhen(cfg.when)})`
                : `${target} (default)`
            )
            .join("\n")
        )
      );
    }

    row.appendChild(
      makeInput(
        "alignmentEffect",
        opt.alignmentEffect ?? 0,
        (v) => {
          opt.alignmentEffect = Number(v);
        },
        "number"
      )
    );

    row.appendChild(
      makeInput(
        "affectionEffect",
        opt.affectionEffect ?? 0,
        (v) => {
          opt.affectionEffect = Number(v);
        },
        "number"
      )
    );


    const del = document.createElement("button");
    del.textContent = "Delete option";
    del.onclick = () => {
      delete phrase.options[optId];
      renderDialogEditor(dialogKey);
    };

    row.appendChild(del);
    optWrap.appendChild(row);
  });

  // add option
  const addBtn = document.createElement("button");
  addBtn.textContent = "Add option";
  addBtn.onclick = () => {
    if (phrase.next && typeof phrase.next === "object") {
      alert("Cannot add options to a phrase with conditional next.");
      return;
    }

    const id = prompt("New option ID (must be unique)");
    if (!id) return;

    phrase.options = phrase.options || {};
    if (phrase.options[id]) {
      alert("Option ID already exists");
      return;
    }

    let movedNext = null;
    if (phrase.next) {
      movedNext = phrase.next;
      phrase.next = null;
    }

    phrase.options[id] = {
      text: "",
      next: movedNext
    };

    renderDialogEditor(dialogKey);
  };

  optWrap.appendChild(addBtn);
  form.appendChild(optWrap);


  const delBtn = document.createElement("button");
  delBtn.textContent = "Delete phrase";
  delBtn.style.background = "var(--danger)";

  delBtn.onclick = () => {
    const refs = findPhraseReferences(dialogKey, phraseId);

    if (phrase.next || (phrase.options && Object.keys(phrase.options).length)) {
      alert(
        "Cannot delete phrase.\n\n" +
        "This phrase has outgoing links (next / options)."
      );
      return;
    }

    if (refs.length) {
      alert(
        "Cannot delete phrase. It is referenced by:\n\n" +
        refs.join("\n")
      );
      return;
    }

    if (!confirm(`Delete phrase "${phraseId}"? This cannot be undone.`)) {
      return;
    }

    delete state.world.dialogs[dialogKey].phrases[phraseId];
    expandedDialogPhrases.delete(`${dialogKey}::${phraseId}`);
    renderDialogEditor(dialogKey);
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

  renderEffectsEditor(form, rule);
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
    // force validation refresh
    if (currentRuleChar !== null && currentRuleIndex !== null) {
      const rule = state.world.characters[currentRuleChar].rules[currentRuleIndex];
      renderRuleWarnings(rule);
    }
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
    if (currentRuleChar !== null && currentRuleIndex !== null) {
      const rule =
        state.world.characters[currentRuleChar].rules[currentRuleIndex];
      renderRuleWarnings(rule);
    }
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
    if (currentRuleChar !== null && currentRuleIndex !== null) {
      const rule =
        state.world.characters[currentRuleChar].rules[currentRuleIndex];
      renderRuleWarnings(rule);
    }
  };


  row.appendChild(l);
  row.appendChild(input);
  return row;
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


    for await (const [name, handle] of projectDirHandle.entries()) {
      if (handle.kind !== "file") continue;
      if (!name.toLowerCase().endsWith(".json")) continue;

      const file = await handle.getFile();
      const data = JSON.parse(await file.text());

      if (name === "areas.json") {
        state.world.areas = data;
        state.files.areas = { name, handle };
      } else if (name === "characters.json") {
        state.world.characters = data;
        state.files.characters = { name, handle };
      } else {
        const key = name.replace(/\.json$/i, "").toLowerCase();
        state.world.dialogs[key] = data;
        state.files.dialogs[key] = { name, handle };
      }
    }

    buildTree();
    enableSaveButtons();
    await loadDialogsReferencedByCharacters();

    // Rebuild all dialogs to materialise missing phrase IDs
    Object.keys(state.world.dialogs).forEach(rebuildDialog);

    
    buildTree();
    enableSaveButtons();
    setStatus("Project folder loaded.");

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
  add.textContent = "+ Add section";
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
        renderRuleWarnings(
          state.world.characters[currentRuleChar].rules[currentRuleIndex]
        );
      };

      const del = document.createElement("button");
      del.textContent = "×";
      del.onclick = () => {
        arr.splice(index, 1);
        onChange(arr);
        renderCharacterEditor(currentRuleChar);
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
    renderCharacterEditor(currentRuleChar);
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


function renderEffectsEditor(form, rule) {
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


// function renderEffectsEditor(form, rule) {
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
  const edges = {}; // from -> [{ to, label }]

  Object.entries(dialog.phrases).forEach(([id, phrase]) => {
    edges[id] = edges[id] || [];

    // phrase.next
    if (typeof phrase.next === "string") {
      edges[id].push({ to: phrase.next, label: null });
    }

    // conditional phrase.next
    if (phrase.next && typeof phrase.next === "object") {
      Object.entries(phrase.next).forEach(([to, cfg]) => {
        edges[id].push({
          to,
          label: cfg?.when ? `if ${summariseWhen(cfg.when)}` : null
        });
      });
    }

    // options
    if (phrase.options) {
      Object.entries(phrase.options).forEach(([optId, opt]) => {
        if (typeof opt.next === "string") {
          edges[id].push({
            to: opt.next,
            label: `option: ${optId}`
          });
        }

        if (opt.next && typeof opt.next === "object") {
          Object.entries(opt.next).forEach(([to, cfg]) => {
            edges[id].push({
              to,
              label: cfg?.when
                ? `option: ${optId}, if ${summariseWhen(cfg.when)}`
                : `option: ${optId}`
            });
          });
        }
      });
    }
  });

  return edges;
}

function summariseWhen(when) {
  return Object.entries(when)
    .map(([k, v]) => {
      if (typeof v === "object") {
        const op = Object.keys(v)[0];
        return `${k} ${op} ${v[op]}`;
      }
      return `${k} = ${v}`;
    })
    .join(", ");
}


// Wire up
els.btnClear.addEventListener("click", () => clearAll());
els.btnSaveCurrent.addEventListener("click", () => saveCurrent());
els.btnSaveAll.addEventListener("click", () => saveAll());
btnOpenFolder.addEventListener("click", openProjectFolder);

clearAll();
