Project: Rowyn Veil — AI agent guidance

Purpose
- Help an AI coding agent be productive immediately by summarizing the runtime architecture, data flow, developer workflows, and project-specific conventions.

Quick overview
- Single-page browser game. Entry: `index.html` which loads `js/main.js` in the global scope (not ES modules).
- Runtime is data-driven: core world content lives in `data/` (notably `areas.json`, `characters.json`, `rules.json`, and `dialogs/*.json`).
- Assets are in `assets/` (icons, items, objects, portraits, sprites). Filenames are lowercase and referenced by id.
- In-editor tools live under `editor/` (open `editor/index.html` to run the in-browser editor which uses the File System Access APIs).

Key files to read first
- `index.html` — game container, canvas, and UI overlays.
- `js/main.js` — entire game runtime: loading, rendering, world state, rules, events, and input handling (very large, global-scope file).
- `editor/editor.js` and `editor/index.html` — editor UI and save/load logic (archives previous versions into `data/archive`).
- `data/rules.json` — example of the event-driven rule format (triggers, state checks, effects, dialog/scene keys).

Important patterns & conventions
- Global-scope JS: `js/main.js` exposes many global variables (`player`, `party`, `currentArea`, `WORLD_TIME_MIN`, etc.). Edits should avoid breaking global names.
- Data-driven rules: rules are objects with `triggerWhen`, `state`, `effects`, and `dialog/scene` keys (see `data/rules.json`). Modify rules rather than hard-coding behavior when possible.
- ID and filename casing: code uses `lc(id)` / lowercasing liberally; asset lookup uses lowercase ids (e.g. `assets/items/${lc(id)}.png`). Add assets using lowercase filenames.
- No module imports: `index.html` intentionally uses a plain `<script>` to avoid CORS when run locally — be careful if converting to modules.
- Editor conventions: dialog keys are derived from filenames (`mira.json` -> key `mira`). Editor archives previous saves to `data/archive`.

Developer workflows
- Run locally by serving the project over HTTP (recommended) or opening `index.html` directly for quick checks.
  - Python (PowerShell):
    ```powershell
    python -m http.server 8000
    ```
  - Node (PowerShell):
    ```powershell
    npx http-server -c-1 . -p 8000
    ```
- Use the browser DevTools console to inspect runtime globals (`player`, `party`, `currentArea`, `areasData`, `npcRegistry`, `proximityTargetByKey`).
- Editor: open `editor/index.html` via an HTTP serve to get full File System Access (save/restore/archive). When served insecurely some FS APIs may be limited.

Common edits and where to make them
- Content/data: update `data/areas.json`, `data/characters.json`, `dialogs/*.json`, `data/items.json`, and `data/rules.json`.
- Visual assets: add PNGs under `assets/` using the matching lowercase id.
- UI/logic: change `js/main.js`. Follow existing helper functions (`getItemDef`, `getObjectDef`, `emitGameEvent`) and preserve global event names.

Examples (use these exact patterns)
- Item image path: `img.src = 'assets/items/' + lc(id) + '.png'` (main.js item rendering).
- Rule trigger example: a `triggerWhen` with `event: "section_enter"` and `scene.start` pointing into `dialogs`/scenes (see `data/rules.json`).

Notes for AI edits
- Preserve global names and patterns; do not convert the whole project to modules without coordinating changes to `index.html` loading.
- Keep data-driven decisions in `data/` files when possible (the runtime expects these shapes).
- Prefer small, focused patches: this repo is large and monolithic; keep changes localized and update `data/archive` via the editor when modifying world data.

If anything above is unclear or you want more examples (e.g., common rule shapes, dialog JSON schema, or hotpaths inside `js/main.js`), tell me which area to expand and I will iterate.
