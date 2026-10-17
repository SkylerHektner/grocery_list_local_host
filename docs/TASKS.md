# Tasks

Implementation plan for [SPEC.md](SPEC.md). Tasks run **one at a time, in order**, each by a
sub-agent. Each task ends with `scripts/check.ps1` (or every check that exists so far) passing,
this file's checkbox ticked, and a short "Notes" line for anything the next task should know.
The orchestrator reviews and commits each task on branch `grocery-v2`.

Status legend: `[ ]` todo · `[x]` done

---

## T1 — Agent-friendly workspace & scaffold
- [ ] Done

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
- [ ] Done

- `model.rs`, `names.rs`, `error.rs`, `store.rs` per SPEC §2 and §5.
- Atomic save, backups (keep 10), schema version check, default category seed, `--demo` seed
  (~40 realistic items across categories incl. some staples & aliases, ~4 recipes).
- `AppState` shared via axum state; `GET /api/state` and `GET /api/version`.
- Unit tests: normalization/validation, save→load round trip, backup rotation, seed contents,
  unknown-newer-schema error.

## T3 — Backend API
- [ ] Done

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
