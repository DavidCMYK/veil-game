/* Stage 1 editor:
   - Load areas.json, characters.json, plus any dialog jsons
   - Show a tree
   - Inspect JSON
   - Save current / save all via downloads
*/

const inspector = document.getElementById("inspector");
const btnOpenFolder = document.getElementById("btnOpenFolder");

let projectDirHandle = null;
let currentRuleChar = null;
let currentRuleIndex = null;
let currentWarningsContainer = null;

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
    els.inspectorTitle.textContent = node.key;
    pre.textContent = pretty(state.world.dialogs[node.key]);
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
      await archiveAndWrite(f, state.world.dialogs[sel.key]);
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
      await archiveAndWrite(
        state.files.dialogs[key],
        state.world.dialogs[key]
      );
    }

    setStatus("All files saved.");
  } catch (e) {
    setStatus(e.message, true);
  }
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

  for (let i = 1; i <= area.sectioncount; i++) {
    const sectionName = explicitByPosition[i];

    const row = document.createElement("div");
    row.className = "sectionItem";

    if (sectionName) {
      row.textContent = `[${i}] ${sectionName}`;
      row.onclick = () => renderSectionEditor(areaName, sectionName);
    } else {
      row.classList.add("implicit");
      row.textContent = `[${i}] (implicit section)`;
      row.onclick = () => createSectionFromImplicit(areaName, i);
    }

    sectionList.appendChild(row);
  }


  form.appendChild(sectionList);
  inspector.appendChild(form);
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

  rules.forEach((rule, idx) => {
    const row = document.createElement("div");
    row.className = "sectionItem";
    row.textContent =
      `${idx + 1}. ${rule.id || "(no id)"} — ${rule.triggerWhen?.event || "no trigger"}`;

    row.onclick = () => renderRuleEditor(charName, idx);
    rulesBlock.appendChild(row);
  });


  form.appendChild(rulesBlock);
  inspector.appendChild(form);
}


function renderRuleEditor(charName, ruleIndex) {
  currentRuleChar = charName;
  currentRuleIndex = ruleIndex;

  const character = state.world.characters[charName];
  const rule = character.rules[ruleIndex];

  rule.triggerWhen = rule.triggerWhen || {};

  els.inspectorTitle.textContent = `Rule: ${charName} [${ruleIndex + 1}]`;
  inspector.innerHTML = "";

  const form = document.createElement("div");
  form.className = "form";

  // Rule ID
  form.appendChild(makeInput("Rule id", rule.id, (v) => {
    rule.id = v;
  }));

  const triggerTypes = ["section_enter", "dialog_option", "party_join", "party_leave"];

  form.appendChild(
    makeSelect(
      "Trigger event",
      triggerTypes,
      rule.triggerWhen?.event,
      (v) => {
        rule.triggerWhen.event = v;
        renderRuleEditor(charName, ruleIndex);
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

  renderScopeEditor(form, "Scope when", rule.scopeWhen);
  renderScopeEditor(form, "Descope when", rule.descopeWhen);


  renderEffectsEditor(form, rule);

  const warnings = validateRule(rule);

  currentWarningsContainer = document.createElement("div");
  form.appendChild(currentWarningsContainer);

  renderRuleWarnings(rule);

  inspector.appendChild(form);


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
        delete rule.triggerWhen.sections;
        renderRuleEditor(currentRuleChar, currentRuleIndex);
      }
    )
  );

  renderStringArrayEditor(
    form,
    "Sections",
    rule.triggerWhen.sections,
    (v) => {
      rule.triggerWhen.sections = v;
    }
  );


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

  // Re-render and open editor immediately
  renderAreaEditor(areaName);
  renderSectionEditor(areaName, name);
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
    
    buildTree();
    enableSaveButtons();
    setStatus("Project folder loaded.");

  } catch (err) {
    console.error(err);
    setStatus(`Failed to open folder: ${err.message}`, true);
  }

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
        renderRuleEditor(currentRuleChar, currentRuleIndex);
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
    renderRuleEditor(currentRuleChar, currentRuleIndex);
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

function renderEffectsEditor(form, rule) {
  const block = document.createElement("div");
  block.className = "sectionList";

  const h = document.createElement("div");
  h.textContent = "Delta";
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  block.appendChild(h);

  if (!rule.delta) {
    block.appendChild(makeReadonly("(none)", ""));
    form.appendChild(block);
    return;
  }

  Object.entries(rule.delta).forEach(([key, value]) => {
    block.appendChild(
      makeInput(key, value, (v) => {
        rule.delta[key] = Number(v);
      }, "number")
    );
  });

  form.appendChild(block);
}

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

  return warnings;
}


// Wire up
els.btnClear.addEventListener("click", () => clearAll());
els.btnSaveCurrent.addEventListener("click", () => saveCurrent());
els.btnSaveAll.addEventListener("click", () => saveAll());
btnOpenFolder.addEventListener("click", openProjectFolder);

clearAll();
