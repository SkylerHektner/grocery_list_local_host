# Grocery List Builder — Product & Technical Spec

A personal, keyboard-first grocery list builder served from a Rust web server on the home LAN.
The output is a plain-text "sticky note" list, grouped and ordered by the path you walk through
the store, ready to paste into Apple Notes (or any notes app).

This document is the source of truth for behavior. If code and spec disagree, fix one of them
and say which in the commit message. Task breakdown and status live in [TASKS.md](TASKS.md).

---

## 1. Principles

1. **Sticky note, not a spreadsheet.** Items have names, not quantities/units. An optional short
   free-text note ("2 dozen", "ripe") is the only extra detail.
2. **Keyboard first, mobile capable.** Every core flow is fully doable without the mouse on a
   laptop, and with thumbs on a phone. Keyboard flow must never require more keystrokes than
   necessary (type → Enter is the core loop).
3. **Zero-friction creation.** An unknown item or a new recipe can be created inline, mid-flow,
   in about one extra keystroke.
4. **Culling is a first-class operation.** Recipes add things you already have; removing them must
   be fast, and pantry staples should be pre-culled automatically.
5. **One path through the store.** Categories have a user-defined order matching the store walk.
6. **Simple tech.** Rust (axum) backend, vanilla JS/HTML/CSS frontend with no build step and no
   runtime JS dependencies. Small, well-tested, easy for agents to change safely.

---

## 2. Concepts & data model

| Concept | Description |
|---|---|
| **Category** | A store section ("Produce", "Dairy & Eggs"). The array order of categories *is* the store walk order. |
| **Item** | A catalog entry: `name`, optional `category_id` (null = Uncategorized), `aliases` (alternate search names), `staple` flag ("usually have it"), usage stats for search ranking. |
| **Recipe** | A named set of items (`item_ids`). No quantities. "Weekly staples" can simply be a recipe. |
| **List** | The single active grocery list: entries (item + optional note + sources) and the set of recipes that have been added to it. |
| **Source** | Why an entry is on the list: `manual` and/or one or more `recipe` ids. |

### 2.1 Persistence

- Single JSON file: `<data_dir>/db.json`. Whole DB is held in memory behind a mutex; every
  mutation writes the file atomically (write `db.json.tmp`, then rename over `db.json`).
- `schema_version` field (start at 1). Loading an unknown newer version is a hard error; older
  versions are migrated in code.
- `version` field: monotonic revision counter, incremented on every successful mutation (a fresh
  DB starts at 0). Used for live sync. A failed mutation (validation error or failed save)
  changes nothing in memory or on disk.
- On startup, if `db.json` exists and loads, copy it to
  `<data_dir>/backups/db-<unix_seconds>.json` (`db-<unix_seconds>-<n>.json` if several starts
  happen in one second), keeping the 10 most recent backups.
- A `db.json` that cannot be read, is not valid JSON, lacks `schema_version` or has invalid data
  is a hard startup error naming the file; it is never replaced and never backed up (so restarts
  on a broken file cannot rotate the good backups out).
- A missing `db.json` creates a fresh DB seeded with default categories in a typical walk order:
  Produce, Bakery, Deli & Cheese, Meat & Seafood, Dairy & Eggs, Frozen, Pantry, Snacks,
  Beverages, Household, Personal Care. With `--demo`, a fresh DB also gets the demo catalog
  (`src/demo.rs`: ~40 items incl. staples, aliases and two uncategorized items, 4 recipes).
- No legacy import: the old `data/*.ron` files are ignored.

### 2.2 Shape (illustrative)

```json
{
  "schema_version": 1,
  "version": 42,
  "next_id": 120,
  "categories": [{ "id": 1, "name": "Produce" }],
  "items": [{
    "id": 10, "name": "Parmigiano Reggiano", "category_id": 3,
    "aliases": ["Parmesan"], "staple": false,
    "use_count": 4, "last_used": 1760650000
  }],
  "recipes": [{ "id": 20, "name": "Tacos", "item_ids": [10, 11] }],
  "list": {
    "entries": [{
      "item_id": 10, "note": "2 wedges",
      "sources": [{ "kind": "manual" }, { "kind": "recipe", "recipe_id": 20 }],
      "added_at": 1760650000
    }],
    "recipe_ids": [20]
  }
}
```

Timestamps are unix seconds (no date-time crate needed); `last_used` is 0 for never-used items.
A missing note is `null`. IDs come from one shared `next_id` counter.

### 2.3 Names & validation

- Normalize every name/alias: trim, collapse internal whitespace to single spaces, uppercase the
  first character, leave the rest as typed ("BBQ sauce" stays "BBQ sauce").
- Length 1–80 characters (not bytes) after normalization; control characters are rejected.
- Item names are unique case-insensitively; an alias may not equal another item's name (and a
  name may not equal another item's alias). Two items may share an alias. Recipe names unique;
  category names unique (all case-insensitive).
- Aliases: blank ones are dropped, as are case-insensitive duplicates and aliases equal to the
  item's own name.
- Notes: trimmed and internal whitespace collapsed (a note never spans lines in the export), max
  80 chars, no control characters, empty ⇒ no note.

---

## 3. Features

Priority: **P0** = required for v1, **P1** = in v1 scope, **P2** = nice-to-have if time allows.

### 3.1 Omnibar — the core loop (P0)

One search/add input at the top of the List view, autofocused on load. Also reused in the recipe
editor for adding ingredients.

- Typing shows a dropdown of fuzzy matches across **items and recipes** (recipes visibly labeled).
  Each item row shows its category; items already on the list are marked "on list".
- `↑`/`↓` move the highlight; `Enter` picks it; `Esc` clears the input (second `Esc` closes/blurs).
- Picking an item adds it to the list (manual source), clears the input, and keeps focus, so the
  user can rattle off `milk⏎ eggs⏎ bananas⏎` without touching the mouse.
- **Inline note syntax:** `eggs, 2 dozen⏎` adds Eggs with note "2 dozen". Only text before the
  first comma is searched.
- Picking a recipe opens the **cull dialog** (3.4).
- **Create row:** whenever the query does not exactly match an item name/alias, the dropdown ends
  with `+ Create "…"`. If there are no fuzzy matches the create row is highlighted by default, so
  `Enter` starts creation. `Shift+Enter` always jumps straight to creation.
- Re-adding an item already on the list is a no-op apart from adding the manual source / updating
  the note when one is given; it shows a subtle "already on list" toast, never an error.
- Usage stats (`use_count` +1, `last_used` = now) count the times an item is *put on* the list:
  a manual add bumps them when it creates the entry or gives a recipe-only entry its manual
  source; a recipe add bumps only the items it newly puts on the list. Re-adds never count twice.

### 3.2 New item flow (P0)

Triggered from the create row. The dropdown turns into a category picker:
`New item "Birthday candles" → choose category`.

- Categories listed in walk order, numbered `1`–`9` for one-key selection.
- Typing filters categories (fuzzy); `↑`/`↓` + `Enter` select; `0` or `Tab` = Uncategorized;
  `Esc` returns to the search with the text intact.
- Selection creates the item **and** adds it to the list (or to the recipe being edited) in one
  step, then returns focus to the empty omnibar.
- On mobile the same picker is a tappable list of category buttons.

### 3.3 Fuzzy search (P0) — must be excellent

Pure function module (`public/js/fuzzy.js`), unit-tested with `node --test`. Requirements:

- Case-insensitive and diacritic-insensitive. Matches item names **and aliases** (best wins;
  results show which alias matched).
- Ranking tiers, best first:
  1. Exact name/alias match
  2. Name starts with query
  3. A word starts with query (`rice` → "Basmati Rice")
  4. Every query token is a word-prefix, any order (`cream hea` → "Heavy Cream")
  5. Contiguous substring
  6. Acronym/subsequence (`gy` → "Greek Yogurt", `pmsn` → "Parmesan")
  7. Typo-tolerant word match: Damerau–Levenshtein ≤ 1 for tokens of 4–7 chars, ≤ 2 for 8+
     (`parmesian` → "Parmesan", `brocoli` → "Broccoli", `tomatoe` → "Tomato")
- Ties broken by usage (`use_count`, then `last_used`), then shorter name, then alphabetical.
  Inside tiers 6 and 7 match quality comes first (acronym-like alignments over scattered ones;
  fewer edits first).
- Details that keep incremental typing sane (`public/js/fuzzy.js` documents them): punctuation
  counts as a word break and apostrophes vanish (`half and half` = "Half-and-half",
  `jerrys` → "Ben & Jerry's"); a one-character query only matches at word starts; tier 6 must
  start at a word start and may only enter a later word at its first letter (`tomatoe` does not
  match "Tomato p**a**st**e**"); tier 7 also lets the *last* token (5+ chars, still being typed)
  be within the typo budget of a word *prefix* (`strawv` → "Strawberries"). An empty query
  matches nothing.
- Returns match ranges so the UI can highlight matched characters.
- Fast: < 5 ms for 2,000 items on a laptop.

### 3.4 Recipes → list with culling (P0)

Adding a recipe opens the **cull dialog** listing its ingredients as checkboxes:

- Default checked, **except** staples (unchecked, tagged "staple").
- Items already on the list are tagged "on list"; confirming with them checked just adds the
  recipe as an extra source (never duplicates).
- Confirming with nothing checked still adds the recipe chip (the user saw the recipe and culled
  everything); adding a recipe that is already on the list extends it.
- Keyboard: `↑`/`↓` move, `Space` toggles, `a` toggles all, `Enter` confirms, `Esc` cancels.
- The dialog shows a live "Adding N of M" count.
- Mobile: full-screen sheet with large checkboxes and a sticky confirm button.

### 3.5 List view (P0)

- Entries grouped by category in walk order; Uncategorized last. Within a group, sorted by name.
- Each entry shows: name, note (inline editable), source tags (recipe names), remove button
  (always visible — no hover-only controls).
- "Recipes on this list" chips at the top; removing a chip removes the recipe source from all
  entries and removes entries left with no source (items also added manually or by another
  recipe stay). Removing an entry removes it whatever its sources; chips stay even when no entry
  from that recipe is left (only removing the chip, clearing, or deleting the recipe drops it).
  Editing a recipe's ingredients doesn't change the list.
- **Keyboard list navigation:** `↓` from an empty omnibar moves focus into the list; `↑`/`↓`/`j`/`k`
  move; `Delete`/`Backspace`/`x` removes; `Enter`/`n` edits the note (`Enter` saves, `Esc`
  cancels); `/` or `Esc` returns to the omnibar.
- **Undo:** `Ctrl+Z` (when not typing in a field) and an Undo button in the removal toast revert
  the last list change. Server keeps the last 50 list states in memory (lost on restart); only
  list edits that changed the list are recorded. Deleting an item or recipe and merging items
  clear the history (old states would reference them). Undo restores the list only, not usage.
- **Clear list** button with confirmation.

### 3.6 Export & copy (P0)

- Server endpoint renders the text (so it is testable in Rust); the UI shows a live preview.
- Format (blank line between groups, no trailing whitespace, no trailing blank line):

  ```
  PRODUCE
  Bananas
  Garlic

  DAIRY & EGGS
  Eggs
  Milk (2 gallons)
  ```

  - Category headers are the category name uppercased; empty categories are omitted.
  - Items sorted by name within a group (case-insensitive); a note is appended as ` (note)`.
  - Uncategorized items go last under `OTHER`. If a category named "Other" exists
    (case-insensitive), uncategorized items merge into that group instead (sorted together with
    its items, at that category's position in the walk).
  - An empty list exports as empty text.
  - Recipe sources are **not** included in the export.
- **Copy** button and `Ctrl+Shift+C` shortcut copy the text and show "Copied N items".
- The app is served over plain HTTP on the LAN, where `navigator.clipboard` is unavailable on
  phones. Copy must fall back to a hidden-textarea + `document.execCommand('copy')`, and if that
  fails, show the text pre-selected in a textarea for manual copy.

### 3.7 Recipes view (P0)

- Fuzzy-filterable list of recipes with ingredient counts.
- New recipe: type a name (`n` shortcut or "New recipe" button), then add ingredients with the
  same omnibar (including inline item creation). Ingredient rows are removable by keyboard and tap.
- Rename, delete (with confirmation), and "Add to list" (opens the cull dialog).
- Creating a recipe from the List-view omnibar: the create row offers both
  `+ Create item "…"` and `+ Create recipe "…"`; creating a recipe jumps to its editor.

### 3.8 Items catalog view (P1)

- Fuzzy-filterable table of all items: name, category, aliases, staple flag, usage count.
- Inline edit of name, category (select), aliases (comma-separated), staple toggle.
- Delete with confirmation that names affected recipes; deletion removes the item from recipes
  and the list.
- Uncategorized items are highlighted so they can be fixed later.
- **Merge** (P2): merge item A into B — references move to B, A's name becomes an alias of B.
  Details: A's aliases become B's too; on the list, entries fold together (sources unioned, B's
  note kept unless it has none); recipes containing both keep B once; B adopts A's category only
  if uncategorized; usage counts are summed (`last_used` = later); B's name and staple flag stay.

### 3.9 Categories / store order view (P1)

- Ordered list of categories = store walk.
- Reorder with `Alt+↑`/`Alt+↓` on the focused row, and ↑/↓ buttons for touch.
- Add, rename, delete (items in a deleted category become Uncategorized; confirm first).

### 3.10 Live sync across devices (P1)

- Client polls `GET /api/version` every 3 s while the page is visible, and immediately on
  `focus`/`visibilitychange`. If the version changed, it fetches `GET /api/state` and re-renders.
- Re-render must never clobber what the user is typing (omnibar text, note editor, recipe editor
  name) or lose keyboard focus/selection.

### 3.11 App shell (P0)

- Views: **List** (default), **Recipes**, **Items**, **Store order**. Hash routing
  (`#/list`, `#/recipes`, `#/items`, `#/categories`).
- `Alt+1`…`Alt+4` switch views; `/` or `Ctrl+K` focuses the current view's search box; `?` opens
  a keyboard shortcut overlay.
- Toast area for confirmations, errors (with the server's error message), and Undo.
- The header shows a live-sync indicator (Live / Offline) and a keyboard button that opens the
  shortcut overlay (for touch users).
- Light and dark themes via `prefers-color-scheme`.
- Responsive: single column ≤ 700 px with the view tabs as a bottom tab bar, sticky omnibar, tap
  targets ≥ 44 px, dialogs as bottom sheets, no horizontal scroll at 360 px wide.

### 3.12 Hosting (P0)

- Binds `0.0.0.0:3000` by default so phones on the LAN can reach it; prints the LAN URL at startup.
- Configuration via CLI flags or env vars (flag wins):
  `--addr` / `GROCERY_ADDR` (default `0.0.0.0:3000`),
  `--data-dir` / `GROCERY_DATA_DIR` (default `<crate dir>/data`),
  `--static-dir` / `GROCERY_STATIC_DIR` (default `<crate dir>/public`),
  `--demo` / `GROCERY_DEMO=1` (seed a demo catalog + recipes when the DB is fresh).
- Static files are served from disk, so frontend changes are live without a server restart.
- No auth (trusted home LAN). README documents the Windows Firewall rule the user must add.

---

## 4. HTTP API

All bodies are JSON. Errors are `{"error": "<human readable message>"}` with a fitting status
(400 validation, malformed/unknown body field or an unknown id inside a body value, 404 unknown
id being acted on (URL id, or `item_id`/`recipe_id`/`into_id` of list-add and merge bodies) or
route, 405 wrong method, 409 conflict/duplicate, 500 save failed). **Every mutation returns
`{"state": <Snapshot>, "id": <affected or created id | null>}`**, so the client never needs a
follow-up fetch. `Snapshot` = `{version, categories, items, recipes, list}`.

| Method & path | Body | Notes |
|---|---|---|
| `GET /api/health` | | `{ok: true, version}` |
| `GET /api/state` | | Snapshot |
| `GET /api/version` | | `{version}` — cheap poll |
| `POST /api/categories` | `{name}` | appended at end of walk order |
| `PUT /api/categories/{id}` | `{name}` | rename |
| `DELETE /api/categories/{id}` | | items → Uncategorized |
| `PUT /api/categories/order` | `{ids: [..]}` | must be a permutation of all ids (400) |
| `POST /api/items` | `{name, category_id?, aliases?, staple?}` | 409 on duplicate name; 400 unknown category |
| `PUT /api/items/{id}` | `{name, category_id, aliases, staple}` | full replace of editable fields; all required |
| `DELETE /api/items/{id}` | | cascades out of recipes + list; clears list undo history |
| `POST /api/items/{id}/merge` | `{into_id}` | P2; see 3.8; 400 into itself; clears list undo history |
| `POST /api/recipes` | `{name, item_ids?}` | 400 unknown item; duplicates dropped |
| `PUT /api/recipes/{id}` | `{name, item_ids}` | list untouched |
| `DELETE /api/recipes/{id}` | | removes recipe sources from list entries; entries left sourceless become manual; clears list undo history |
| `POST /api/list/items` | `{item_id, note?}` | adds manual source; bumps usage (see 3.1); 404 unknown item |
| `PUT /api/list/items/{item_id}` | `{note}` | `null`/`""` clears; 404 if not on list |
| `DELETE /api/list/items/{item_id}` | | removes the entry entirely; chips stay; 404 if not on list |
| `POST /api/list/recipes` | `{recipe_id, item_ids}` | `item_ids` = culled subset (else 400); bumps usage; chip added even if empty |
| `DELETE /api/list/recipes/{recipe_id}` | | see 3.5; 404 if not on list |
| `DELETE /api/list` | | clear |
| `POST /api/list/undo` | | 409 when nothing to undo |
| `GET /api/list/export` | | `text/plain; charset=utf-8` |

`docs/API.md` is the detailed, always-current reference (request/response examples).

---

## 5. Architecture

```
Cargo.toml            lib + bin crate
src/
  main.rs             parse config, load store, bind, print LAN URL
  lib.rs              pub fn app(state, static_dir) -> Router  (used by main and tests)
  config.rs           CLI flag / env var parsing (no clap)
  model.rs            serde types (Db, Category, Item, Recipe, List, Snapshot) + Db helpers
  store.rs            load/save/backup/migrate/seed; AppState (Arc<Mutex<..>>), mutate, undo
  names.rs            normalization + validation
  demo.rs             --demo catalog (names relied on by tests)
  error.rs            ApiError -> JSON response; ApiJson / ApiPath extractors
  catalog.rs          category/item/recipe edits incl. merge (Db methods)
  list.rs             list edits: add/remove items and recipes, notes, clear (Db methods)
  export.rs           list -> text
  api/                one module per resource: categories, items, recipes, list, meta
tests/                Rust integration tests (tower::ServiceExt::oneshot against app())
public/
  index.html
  css/app.css
  js/main.js          bootstrap, routing, global shortcuts (view contract)
  js/router.js        hash routes; js/shortcuts.js: shortcut list for the ? overlay
  js/api.js           fetch wrapper; mutations return state
  js/store.js         client state, subscribe, live-sync polling
  js/fuzzy.js         pure fuzzy matcher (+ fuzzy-text.js, fuzzy-tiers.js, fuzzy.test.js)
  js/dom.js           h() element builder, highlight(), focus-preserving rerender()
  js/components/      omnibar, category picker, cull dialog, toast, dialog
  js/views/           list, recipes, items, categories
e2e/                  Playwright (own package.json; dev-only)
scripts/check.ps1     run every check (also check.sh)
docs/                 SPEC.md, TASKS.md, API.md
```

- Backend deps: `axum`, `tokio`, `serde`, `serde_json`, `tower-http` (fs). Dev: `tower`,
  `http-body-util`, `tempfile`. Adding anything else needs a reason in the commit message.
- Frontend: ES modules, no framework, no bundler. Rendering via small `h()`/template helpers.
  Stable `data-testid` attributes on every interactive element used by tests.

---

## 6. Quality bar

- `scripts/check.ps1` passes: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test`, `node --test "public/js/**/*.test.js"`, Playwright e2e.
- Every API endpoint has integration tests (happy path + main error cases).
- Every P0 keyboard flow has a Playwright test; mobile layout has a test at 375×812.
- Tests and dev servers **never** touch the real `data/` directory (temp dirs / port 3999).

## 7. Out of scope (v1)

Multiple stores, multiple simultaneous lists, list history, quantities/units, user accounts/auth,
HTTPS, checking items off in-store (that happens in the notes app), importing the old RON data.
