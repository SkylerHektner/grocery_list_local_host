# Tasks

Implementation plan for [SPEC.md](SPEC.md). Tasks run **one at a time, in order**, each by a
sub-agent. Each task ends with `scripts/check.ps1` (or every check that exists so far) passing,
this file's checkbox ticked, and a short "Notes" line for anything the next task should know.
The orchestrator reviews and commits each task on branch `grocery-v2`.

Status legend: `[ ]` todo · `[x]` done

---

## T1 — Agent-friendly workspace & scaffold
- [x] Done

Notes: Seams for T2 are marked `T2 seam` in `src/lib.rs` (`app(static_dir)` → add `AppState`),
`src/api/meta.rs` (health returns `version: 0`) and `src/main.rs` (load/seed store, honour
`config.demo`); `api::json_error` in `src/api/mod.rs` is a stand-in for `ApiError`. Register new
routes in `api::router()` before its fallbacks. Unknown `/api/*` → JSON 404, wrong method → JSON
405; all responses get `Cache-Control: no-cache` unless a handler sets one. JS tests:
`node --test "public/js/**/*.test.js"` (a bare directory arg fails on Node 26; no package.json
needed — Node detects ESM syntax). E2E: import from `tests/fixtures.ts` (auto-fails on console
errors); one shared server/DB per run with `workers: 1`; data dir in
`process.env.GROCERY_E2E_DATA_DIR`. Port 3999 is shared by the e2e webServer and the
`.claude/launch.json` preview — stop the preview before running Playwright.

Goal: a clean skeleton that every later task can build, test and verify without guesswork.

- Delete the old implementation (`src/*`, `public/*`, `todo.md`). Keep `data/` untouched.
- Lib + bin crate layout from SPEC §5 with `config.rs` (flags/env, defaults from SPEC §3.12),
  `GET /api/health`, static serving, startup LAN-URL print. Swap `ron` for `serde_json`; add dev
  deps.
- Placeholder `public/index.html` + `css/app.css` + `js/main.js` that loads and calls `/api/health`.
- `node --test` scaffold: `public/js/fuzzy.js` stub + `fuzzy.test.js` with one passing test.
- `e2e/`: Playwright project (own `package.json`, `playwright.config.ts`). Uses the system
  **Microsoft Edge** (`channel: 'msedge'`) so no browser download is needed. `webServer` runs
  `cargo run -- --addr 127.0.0.1:3999 --data-dir <fresh temp dir> --demo`. One smoke test.
- `scripts/check.ps1` and `scripts/check.sh`: fmt check, clippy `-D warnings`, cargo test,
  node tests, Playwright. Non-zero exit on any failure.
- Rewrite `AGENTS.md` (overview, map, commands, conventions, data-safety rules, definition of
  done, "update SPEC/API/TASKS when behavior changes"). Add `CLAUDE.md` containing `@AGENTS.md`.
- `.claude/launch.json` "dev" config (port 3999, `target/dev-data`, `--demo`).
- `.claude/settings.json` allowlisting the project's check/test commands.
- `.gitignore`: `/target`, `/data`, `e2e/node_modules`, Playwright outputs.
- Rewrite `README.md` for the human: run on LAN (`cargo run --release`), firewall rule, where
  data lives, backups.

## T2 — Backend data layer
- [x] Done

Notes: Handlers take `State<AppState>` and do all writes via
`state.mutate(|db: &mut Db| -> Result<T, ApiError>) -> Result<(Snapshot, T), ApiError>` (edits a
clone; on Ok bumps version + atomic save; on Err/failed save nothing changes) and reply
`Json(MutationResponse::new(snapshot, id))`. List edits use `mutate_with(ListUndo::Record, ..)`
(pushes the old list only if it changed; cap 50), item delete `ListUndo::Clear` (consider it for
recipe delete too: old list states would reference the deleted recipe); `state.undo_list()`
implements undo (409 "nothing to undo"). Reads: `state.read(|db| ..)`. Bodies: `ApiJson<T>`
(JSON 400 on bad bodies). Helpers: `db.alloc_id()`, `find_item/_mut(id)?` (404),
`list_entry(_mut)`, `*_by_name_ci`, `check_item_names/check_recipe_name/check_category_name`
(409), `names::validate_name(raw, "item name")`, `validate_aliases`, `validate_note`,
`model::unix_now()`. Tests: `TestApp::new()` / `TestApp::demo()` (temp data dir) with
`get/post/put/delete`, `res.error()`, `item_id("Milk")`, `assert_consistent()` (runs
`Db::consistency_problems()` + memory == disk), `restart()`. Demo names: doc comment of
`src/demo.rs` (item ids 12–54, recipes 55–58). Fresh DB `version` is 0.

- `model.rs`, `names.rs`, `error.rs`, `store.rs` per SPEC §2 and §5.
- Atomic save, backups (keep 10), schema version check, default category seed, `--demo` seed
  (~40 realistic items across categories incl. some staples & aliases, ~4 recipes).
- `AppState` shared via axum state; `GET /api/state` and `GET /api/version`.
- Unit tests: normalization/validation, save→load round trip, backup rotation, seed contents,
  unknown-newer-schema error.

## T3 — Backend API
- [x] Done

Notes: All of SPEC §4 is live; `docs/API.md` is the per-endpoint reference. Every mutation
returns `{state, id}` — just replace client state with `state` (version bumps on every success,
even no-ops). Bodies are strict: unknown fields are 400, `PUT /api/items/{id}` needs all four
fields (`category_id` may be `null`), `PUT /api/list/items/{id}` needs `note` (`null`/`""`
clears). Creating an item or recipe does not touch the list: the new-item flow is
`POST /api/items` then `POST /api/list/items` (or `PUT /api/recipes/{id}` in the editor).
Re-adding an item already on the list is a 200, so decide "already on list" toasts client-side
before the call. `POST /api/list/recipes` needs `item_ids` ⊆ the recipe's ingredients (400
otherwise) and adds the chip even when empty. Removing entries never removes chips. "Not on the
list" is a 404 (likely a stale client: refetch `/api/state`). Undo: 409 `"nothing to undo"`;
only list edits that changed the list are recorded; item delete/merge, recipe delete and server
restarts clear it; undo restores the list only. Logic lives in `src/catalog.rs`,
`src/list.rs`, `src/export.rs`; test helpers `post_ok`/`post_err`/... in `tests/common`.

- Every endpoint in SPEC §4 (merge included), including list undo (50-state in-memory stack) and
  export text per SPEC §3.6.
- Usage stats bump on list adds. Cascades per SPEC.
- Integration tests in `tests/` for every endpoint: happy path, 400/404/409 cases, cascade rules,
  recipe-source removal semantics, undo, export formatting (incl. "Other" merge rule).
- Write `docs/API.md` with request/response examples.

## T4 — Frontend foundation
- [x] Done

Notes: **View contract** is documented at the top of `public/js/main.js`: a view module
default-exports `{id, title, mount(container, ctx), unmount?, focusSearch?, onParams?,
shortcuts?}`; `ctx = {store, api, params, toast, confirm, navigate, subscribe, listen,
onCleanup}` (subscribe/listen/onCleanup auto-clean on unmount; state is loaded before mount).
Replace `public/js/views/{list,recipes,items,categories}.js` (placeholders built by
`views/placeholder.js`, which can be deleted once all four are real). Global keys run on
document keydown and skip events a view `preventDefault()`-ed; `/` and `?` skip text fields;
everything is suspended while a modal is open (`isModalOpen()`). SPEC shortcuts for the `?`
overlay live in `js/shortcuts.js` — update it when you implement one. **Store/API:**
`store.state` = derived snapshot (`itemsById`, `categoriesById`, `categoryIndex` (walk position),
`recipesById`, `entriesByItemId`, `listRecipeIds`, plus raw arrays; `walkIndex(state, catId)`
sorts Uncategorized last); `api.*` mutations (`addToList(itemId, note?)`, `setNote`,
`removeFromList`, `addRecipeToList(recipeId, itemIds)`, `undo`, `createItem({...})`, ... — full
list in `api.js`) push the new state into the store and resolve `{state, id}`; failures toast the
server message automatically and reject with `ApiError` (`.status`), so just `try/catch` to
restore UI; `api.quiet.*` skips the toast for inline error display. Live sync polls every 3 s
(`createLiveSync` in `store.js`); keep typing safe with `rerender(container, build)` from
`dom.js` (restores focus/value/selection by `data-key`) or by keeping inputs outside re-rendered
subtrees. **Fuzzy:** `search(query, candidates, {name, aliases, useCount, lastUsed, limit})` →
`[{item, tier, quality, field, alias, text, ranges}]`; render with `highlight(r.text, r.ranges)`
(dom.js); empty query → `[]`; `matchText(query, text)` for single strings; `TIER` constants.
**UI:** `h(tag, attrs, ...children)` (`testid:` → data-testid, `onClick:` listeners, text is
always safe); `toast(msg, {variant: 'info'|'success'|'error', action: {label, onClick},
duration})`; `await confirm({title, message, confirmLabel, danger})`; `openModal({...})` for
custom dialogs (bottom sheet ≤ 700 px); `icon(name)` from `icons.js`. **CSS vocabulary** (top of
`css/app.css`): `.view .view-head .view-title .view-lead .card .sticky-bar .stack .cluster`,
`.btn(-primary|-ghost|-danger|-icon|-sm) .input .search>.search-input .checkbox`,
`.listbox>.option(.is-active|[aria-selected=true]) .option-label .option-alias .option-meta
.option-category(.is-uncategorized) .option-num .option-create .option-empty`,
`.group-header .group-count .rows>.row(.is-active) .row-name .row-note .row-tags .row-actions`,
`.tag(-accent|-warm|-danger) .chip .chip-label .chip-remove .kbd mark .empty .empty-art
.empty-title .empty-body .muted`; tokens are `--*` custom properties (light + dark). E2E:
`e2e/tests/shell.spec.ts` shows how to call app modules from a test (`inPage()` with a string
body, since the TS transform rewrites `import()` in functions); a 409 in the browser logs a
console error, so clear `consoleErrors` after expected failures. On ≤ 700 px the tabs are a
fixed bottom bar (`--bottom-nav-h`); the main area already pads for it.

- App shell: header with view tabs, hash routing, `Alt+1..4`, `?` shortcut overlay, toast system
  (with action button for Undo), confirm dialog component.
- `api.js` (errors surface the server's message as a toast), `store.js` (state + subscribe +
  live-sync polling per SPEC §3.10).
- `fuzzy.js` fully implemented per SPEC §3.3 with thorough `node --test` coverage of every tier,
  tie-breaking, diacritics, aliases, match ranges, and a 2,000-item performance check.
- Design system in `css/app.css`: tokens, light/dark, responsive rules, focus-visible styles.
- Playwright: routing + shortcut overlay + mobile viewport has no horizontal scroll.

## T5 — List view & omnibar
- [x] Done

Notes: **Omnibar** = `createOmnibar(config)` in `public/js/components/omnibar.js` (header comment
has an example); pure logic in `omnibar-model.js` (`searchModel`, `categoryOptions`,
`keyAction`, `parseEntry`; unit-tested). For the recipe editor pass `{store, api, toast, queue,
idPrefix: 'recipe', placeholder, recipes: false, createRecipe: false, itemBadge: (item) =>
inRecipe ? 'in recipe' : null, onPickItem: (item, {note, created}) => api.updateRecipe(...)}`:
`onPickItem` runs inside the queue (read the *latest* `store.state` recipe there, since adds can
be queued back to back), new-item creation (`POST /api/items` + picker) is built in, and it
returns `{el, input, focus({select}), clear(), mode, destroy()}` (call `destroy()` on unmount).
Test ids: input `<idPrefix>-search`, popup `<idPrefix>-popup`, rows `omnibar-option` /
`omnibar-create-item` / `omnibar-create-recipe` / `category-option[data-number]`, note banner
`omnibar-note-text`. **Recipe picks are a T6 seam**: `addRecipe()` in `views/list.js` adds the
recipe with the cull defaults (all but staples) + an Undo toast — replace it with the cull
dialog. **`+ Create recipe "…"`** does `POST /api/recipes {name}` then navigates to
`#/recipes/<id>` (params `['<id>']`): T6 opens that recipe's editor for this route (the router
already passes it; implement `onParams` to avoid a remount). Reusable: `createQueue()`
(`queue.js`) to serialize mutations; `copyText()` (`clipboard.js`); `noteArt()`
(`components/empty.js`); CSS `.view-wide` (a view opts out of the 720 px centered column; the
page is 1000 px wide now), `.only-keys`/`.only-touch`, `.omnibar-*`. Ctrl+Z / Ctrl+Shift+C are
List-view only (moved to the List group in `shortcuts.js`). E2E: `tests/list.spec.ts` helpers
(`resetList`, `addViaApi`, `uniqueName`, `group`, `row`) are worth copying; Windows' clipboard
turns `\n` into `\r\n` on read-back, and the desktop clipboard test uses the real system clipboard.

- Reusable omnibar component (SPEC §3.1) and category-picker new-item flow (§3.2).
- List view (§3.5): grouping, notes, sources, recipe chips, keyboard navigation, removal, undo,
  clear list.
- Export preview + copy with clipboard fallbacks (§3.6).
- Live sync must not clobber typing.
- Playwright: rapid multi-add by keyboard, inline note syntax, create new item (keyboard and
  tap), keyboard culling + undo, copy produces exact expected text, two-page live sync.

## T6 — Recipes
- [x] Done

Notes: **Cull dialog** = `addRecipeWithCull({recipe, store, api, toast, onUndo, onEdit})` in
`components/cull-dialog.js` (run it inside the view's queue; `openCullDialog` for just the
choice); logic in `cull-model.js`. **Recipes view** (`views/recipes.js`) swaps its index and
editor halves via `onParams`, each with its own scoped ctx (`scoped()`; copy it if a T7 view
needs sub-routes). Reusable for T7: `promptName({title, label, value, confirmLabel, testid,
submit})` (`components/name-dialog.js`: one-field modal, server error inline; good for adding/
renaming categories), `stickyBar(ctx, {testid}, ...children)` (`components/sticky-bar.js`),
`isKeyboardDevice()` (dom.js, autofocus only there), `openModal({className})`, CSS
`.split-head(-text|-actions) .field-error .back-link .btn-quiet-danger` (and `.btn` links have no
underline). The view contract gained `ctx.from` (the previously shown view id). Modals ignore a
held-down, repeating Enter. `recipes-model.js` has `ingredientGroups` (walk-order grouping of any
item-id list) and `filterRecipes`. E2E: `tests/recipes.spec.ts` helpers (`createRecipe`,
`itemIds`, `listNames`); `shell.spec.ts`'s live-sync test now watches the recipes index and the
Items placeholder's `count-recipes` stat, so update it when T7 replaces the Items view. Expected
409s still log console errors (clear `consoleErrors`). Seen, not fixed (T5 List view, for T8): at
375 px a long name next to a recipe tag wraps mid-word ("Parmigian / o / Reggiano").

- Recipes view and editor (§3.7) reusing the omnibar, including inline item creation.
- Cull dialog (§3.4) from both the omnibar and the Recipes view.
- "Create recipe" option from the List omnibar.
- Playwright: create recipe entirely by keyboard, add recipe with staples pre-unchecked, toggle
  with Space, recipe chip removal keeps manually added items.

## T7 — Items catalog & store order
- [x] Done

Notes: **Items view** = `views/items.js` (filter + chips, one inline editor at a time) with
`items-rows.js` (render/focus/row keys via `itemKeyAction`), `items-row-view.js`,
`items-editor.js` (persistent form element: rerender() moves it, never rebuilds it),
`items-actions.js` (s/c/m/Delete/create; every mutation queued and reading the latest item) and
`items-pickers.js`; logic in `items-model.js`. `#/items/uncategorized` presets the chip (Store
order's "Review" link). **Store order** = `views/categories.js` (+ `categories-view.js`, logic in
`categories-model.js`): a local `desired` order is rendered while queued reorders land; each
request sends `reconcileOrder(desired, server ids)`. Reusable: `openPicker()`
(`components/pick-dialog.js`: filterable modal listbox, digit keys, no autofocus on touch),
`pickCategory()` (items-pickers.js), CSS `.filter-chip[aria-pressed] .field .field-label
.field-check`, icons `merge`, `arrow-up/down`, `chevron-down`. `views/placeholder.js` (and its
`.stats` CSS) is gone; `shell.spec.ts` now watches `items-summary`. E2E: categories tests that
move demo categories restore the order in `finally` (other specs depend on the demo walk);
helpers `row`/`names`/`press` (click vs tap) in `categories.spec.ts`, `itemRow`/`filter` in
`items.spec.ts`. No backend changes were needed. Rough edges for T8: the Items view rebuilds
every row on each keystroke/sync (fine at ~50 items; check at 1,000+, maybe cap or window the
blank-filter list); "never added" shows on every unused item (a bit noisy); the pick dialog has
no `Tab` = Uncategorized like the omnibar picker; switching rows away from a dirty editor is
refused with a hint rather than offering save; item rows/category rows have no explicit ARIA
role (plain `li` with roving tabindex); no drag-and-drop reordering; still open from T6: at 375 px
a long list-entry name next to a recipe tag wraps mid-word. Chromium logs a console error for
every failed live-sync poll while the server is down (expected, but noisy in the dev console).

- Items view (§3.8) incl. aliases, staple toggle, delete cascade confirm, merge.
- Categories view (§3.9) incl. keyboard and touch reordering.
- Playwright: edit alias then find item by alias, reorder categories changes export order,
  delete category makes items Uncategorized, merge.

## T8 — Polish, mobile & hardening
- [x] Done

Notes: Fixed: list rows wrap names between words (recipe tags live in the row's wrapping line,
ellipsized); Items view renders 100 rows at a time with "Show 100 more" (`paging.js`; a row
being edited/saved/created stays rendered), filter keystrokes went from ~100 ms to < 20 ms at
1,245 items; merge picker lists 100 until you type; no "never added" noise; pick dialog `Tab` =
Uncategorized; `role="list"` + per-row `aria-label`s; live sync backs off (3→6→12→24→30 s) with
"Offline — reconnecting"; focus never lands on `<body>` (`parkFocus`/`focusFallback` in dom.js,
dialogs refocus a re-rendered opener by `data-key`, toasts hand focus back, deleting the last
category focuses "New category"); sheets/dropdowns sit above the on-screen keyboard
(`viewport.js`); 44 px touch targets (brand, back link, chip ×, note input, recipe name, staple
checkbox); `--ink-3`/`--offline` darkened to ≥ 4.5:1; `?` overlay gained Home/End, Backspace,
Tab, filter Esc. Server: daily backup while running (`BACKUP_EVERY_SECS`), tests for concurrent
devices (`tests/concurrency.rs`) and path traversal (`tests/app.rs`). New e2e specs: `mobile`,
`a11y`, `perf` (big catalog via `page.route`, shared DB untouched). Known limitations / ideas:
full-replace edits (`PUT` item/recipe) are last-writer-wins within the ~3 s sync window (idea:
`If-Match: <version>` → 409 + refetch); deleting items/recipes/categories can't be undone in
the app (backups only); switching away from a dirty item editor is refused with a hint rather
than offering to save; no drag-and-drop reordering; Chromium still logs one console error per
failed poll while offline (now backed off); the keyboard-aware sheets are verified by emulating
`--vv-height`, not on a real iPhone; no service worker/offline mode; `components/omnibar.js`
(~390 lines) is the one module well past ~300 lines (split the picker/keys out next time).

- Mobile pass at 375×812 (tap targets, sticky omnibar, sheet dialogs) with Playwright coverage.
- Accessibility pass: labels, roles, `aria-activedescendant` on listboxes, focus management.
- Performance check with 1,000+ items (search stays instant).
- Bug sweep against SPEC; update docs; final `scripts/check.ps1` green.

## T9 — UI feedback (owner's annotated screenshot, one note at a time)
- [ ] Done

Do these one by one (each its own commit; a fresh session can pick up the next unticked one):

- [x] Light mode by default (ignores the OS preference) + header light/dark toggle.
- [x] Bigger category group headers on the List view ("PRODUCE 16").
- [x] List view items in a grid of tiles per category instead of one long column.
- [ ] Remove the paste preview side panel from the List view.

Notes: Theme: `public/js/theme.js` (+ `theme.test.js`); dark palette is `:root[data-theme="dark"]`
in `app.css` (no `prefers-color-scheme` anywhere); `localStorage` `grocery-theme` = `dark` or
absent; an inline `<head>` script in `index.html` applies it before first paint; header button
`data-testid="theme-toggle"` ("Dark mode", `aria-pressed`). E2E: `shell.spec.ts`.
Headers: only `.list-group .group-header` changed (text-lg, full ink, hairline, count pill); the
shared small `.group-header` caption (recipe editor, cull dialog) is untouched.
Grid: `.list-group .rows` is a CSS grid (`auto-fill, minmax(190px)`; one column on phones); a
tile being note-edited spans the line. Keys: ↑/↓ = geometric `gridNeighbor()` in `list-model.js`
(nearest column on the next line, across groups), ←/→ and j/k = reading order. Once the paste
preview is gone the List card gets wider, so expect more columns.
