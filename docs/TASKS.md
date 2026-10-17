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
- [ ] Done

- App shell: header with view tabs, hash routing, `Alt+1..4`, `?` shortcut overlay, toast system
  (with action button for Undo), confirm dialog component.
- `api.js` (errors surface the server's message as a toast), `store.js` (state + subscribe +
  live-sync polling per SPEC §3.10).
- `fuzzy.js` fully implemented per SPEC §3.3 with thorough `node --test` coverage of every tier,
  tie-breaking, diacritics, aliases, match ranges, and a 2,000-item performance check.
- Design system in `css/app.css`: tokens, light/dark, responsive rules, focus-visible styles.
- Playwright: routing + shortcut overlay + mobile viewport has no horizontal scroll.

## T5 — List view & omnibar
- [ ] Done

- Reusable omnibar component (SPEC §3.1) and category-picker new-item flow (§3.2).
- List view (§3.5): grouping, notes, sources, recipe chips, keyboard navigation, removal, undo,
  clear list.
- Export preview + copy with clipboard fallbacks (§3.6).
- Live sync must not clobber typing.
- Playwright: rapid multi-add by keyboard, inline note syntax, create new item (keyboard and
  tap), keyboard culling + undo, copy produces exact expected text, two-page live sync.

## T6 — Recipes
- [ ] Done

- Recipes view and editor (§3.7) reusing the omnibar, including inline item creation.
- Cull dialog (§3.4) from both the omnibar and the Recipes view.
- "Create recipe" option from the List omnibar.
- Playwright: create recipe entirely by keyboard, add recipe with staples pre-unchecked, toggle
  with Space, recipe chip removal keeps manually added items.

## T7 — Items catalog & store order
- [ ] Done

- Items view (§3.8) incl. aliases, staple toggle, delete cascade confirm, merge.
- Categories view (§3.9) incl. keyboard and touch reordering.
- Playwright: edit alias then find item by alias, reorder categories changes export order,
  delete category makes items Uncategorized, merge.

## T8 — Polish, mobile & hardening
- [ ] Done

- Mobile pass at 375×812 (tap targets, sticky omnibar, sheet dialogs) with Playwright coverage.
- Accessibility pass: labels, roles, `aria-activedescendant` on listboxes, focus management.
- Performance check with 1,000+ items (search stays instant).
- Bug sweep against SPEC; update docs; final `scripts/check.ps1` green.
