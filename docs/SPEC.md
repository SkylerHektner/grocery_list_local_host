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
  happen in one second), keeping the 10 most recent backups. A server that keeps running also
  copies `db.json` there before the first change once 24 h have passed since the last backup, so
  the newest copy is never more than about a day old (a failed backup is logged to stderr and
  never blocks the change).
- Requests are applied one at a time (the DB mutex), so simultaneous edits from the laptop and
  a phone each land exactly once with their own `version` (`tests/concurrency.rs`). Full-replace
  edits (`PUT /api/items/{id}`, `PUT /api/recipes/{id}`) are last-writer-wins: the clients send
  the latest state they have, which live sync keeps within a few seconds.
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

One search/add input at the top of the List view (sticky while scrolling), autofocused on load on
keyboard devices (not on touch screens, where focusing would pop up the on-screen keyboard). Also
reused in the recipe editor for adding ingredients (`public/js/components/omnibar.js`).

- Typing shows a dropdown (an ARIA combobox) of up to 8 fuzzy matches across **items and
  recipes** (recipes visibly labeled "Recipe" with their ingredient count). Each item row shows
  its category and the matched alias (`aka Parmesan`); items (and recipes) already on the list
  are marked "on list". Matched characters are highlighted.
- `↑`/`↓` move the highlight (clamped at the ends, no wrap-around); the highlight goes back to the
  top result whenever the text changes. `Enter` picks it; mouse/tap picks too. `Esc` clears the
  input (a second `Esc` leaves it: focus moves to the view itself, never to the page `<body>`).
  `↓` with an empty input moves focus into the list (3.5).
- Picking an item adds it to the list (manual source), clears the input, and keeps focus, so the
  user can rattle off `milk⏎ eggs⏎ bananas⏎` without touching the mouse. Enter always acts on the
  text currently in the box, and adds run one at a time in order, so fast typing never loses or
  reorders an add. Feedback is quiet: the new row is briefly highlighted and scrolled into view
  (and announced to screen readers); no toast.
- **Inline note syntax:** `eggs, 2 dozen⏎` adds Eggs with note "2 dozen". Only text before the
  first comma is searched; the dropdown shows the parsed note above the results.
- Picking a recipe opens the **cull dialog** (3.4).
- **Create rows:** whenever the query does not exactly match (normalized) an item name/alias, the
  dropdown ends with `+ Create item "…"` (and, in the List view, `+ Create recipe "…"`, see 3.7).
  If there are no fuzzy matches the create row is highlighted by default, so `Enter` starts
  creation. `Shift+Enter` always jumps straight to creation — except when the query exactly names
  an existing item, where it shows a hint ("press Enter to add it") instead of a doomed create.
- Re-adding an item already on the list is a no-op apart from adding the manual source / updating
  the note when one is given; it shows a subtle "already on list" toast, never an error.
- Live sync never touches the input: the dropdown re-renders with the same text and highlight.
- Usage stats (`use_count` +1, `last_used` = now) count the times an item is *put on* the list:
  a manual add bumps them when it creates the entry or gives a recipe-only entry its manual
  source; a recipe add bumps only the items it newly puts on the list. Re-adds never count twice.

### 3.2 New item flow (P0)

Triggered from the create row. The dropdown turns into a category picker:
`New item "Birthday candles" → choose category`.

- Categories listed in walk order, numbered `1`–`9` for one-key selection (the number stays with
  its category while filtering), then Uncategorized (`0`), which is always offered.
- Typing (in the same input, now a category filter) filters categories (fuzzy); `↑`/`↓` +
  `Enter` select; digits pick directly only while the filter is empty (so names can be typed);
  `0` or `Tab` = Uncategorized; `Esc` (or `Backspace` on an empty filter) returns to the search
  with the text intact.
- Selection creates the item **and** adds it to the list (or to the recipe being edited) in one
  step, with the inline note if one was typed, then returns focus to the empty omnibar. If the
  create fails (e.g. the name is another item's alias) the typed text comes back.
- On mobile the same picker is a tappable list of category rows (≥ 44 px) with a Back button.

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
- Fast: < 5 ms for 2,000 items on a laptop. End to end, with a 1,000+ item catalog the omnibar
  and the Items filter re-render within 50 ms of every keystroke (`e2e/tests/perf.spec.ts`).

### 3.4 Recipes → list with culling (P0)

Adding a recipe (from the List omnibar, or "Add to list" / `a` in the Recipes view) opens the
**cull dialog** listing its ingredients as checkboxes, ordered like the list (walk order, then
name, with category headers):

- Default checked, **except** staples (unchecked, tagged "staple"). A staple that is already on
  the list starts checked (confirming only adds the recipe as a source there).
- Items already on the list are tagged "on list"; confirming with them checked just adds the
  recipe as an extra source (never duplicates).
- Confirming with nothing checked still adds the recipe chip (the user saw the recipe and culled
  everything); adding a recipe that is already on the list extends it.
- Keyboard: `↑`/`↓` (`j`/`k`, `Home`/`End`) move, `Space` toggles, `a` toggles all (a "Check
  all / Uncheck all" button does the same for touch), `Enter` confirms, `Esc` cancels. Focus is
  trapped in the dialog and returns afterwards to where it was (the omnibar, the recipe row).
- The dialog shows a live "Adding N of M" count; skipped rows are struck through.
- Live sync while it is open keeps the user's choices (new ingredients get the defaults); if the
  recipe is deleted meanwhile the dialog closes with a toast.
- Confirming shows "Added 8 items from Tacos" (or "Added Tacos without any items") with Undo;
  if the list did not change at all ("Tacos is already on the list") there is nothing to undo.
- A recipe without ingredients shows "Tacos has no ingredients" instead, offering its editor
  (`Enter`).
- Mobile: full-screen sheet with large rows (≥ 52 px) and a sticky confirm button.

### 3.5 List view (P0)

- Entries grouped by category in walk order; Uncategorized last. Within a group, sorted by name.
- Each entry shows: name, note (inline editable), source tags (recipe names), remove button
  (always visible — no hover-only controls). Names wrap between words; the recipe tags follow
  the name and note on the same line (right-aligned on wide screens) and drop below a long name
  on a phone instead of squeezing it; a very long recipe name is shortened with "…".
- "Recipes on this list" chips at the top; removing a chip removes the recipe source from all
  entries and removes entries left with no source (items also added manually or by another
  recipe stay). Removing an entry removes it whatever its sources; chips stay even when no entry
  from that recipe is left (only removing the chip, clearing, or deleting the recipe drops it).
  Editing a recipe's ingredients doesn't change the list.
- **Layout:** each category's entries are a grid of tiles in reading order (as many columns as
  fit, at least 190 px wide; one column on a phone); a tile with its note editor open spans the line.
- **Keyboard list navigation:** `↓` from an empty omnibar moves focus into the list; `↑`/`↓` move a
  line up/down the grid to the nearest column (`↑` on the top line returns to the omnibar);
  `←`/`→` and `j`/`k` move to the previous/next tile in reading order (`k` on the first returns
  to the omnibar); `Home`/`End` jump; `Delete`/`Backspace`/`x`
  removes (focus moves to the next row, else the previous, else the omnibar);
  `Enter`/`n` edits the note inline (`Enter` saves, `Esc` cancels, an empty note clears it;
  clicking/tapping the row or its pencil button edits too); `/` or `Esc` returns to the omnibar.
  Rows use a roving tabindex, so `Tab` enters the list once. Live sync keeps the focused row (or
  its neighbour, if another device removed it) and an open note editor with its text.
- **Undo:** `Ctrl+Z` (in the List view, when not typing in a field) and an Undo button in the
  removal toasts ("Removed Milk", "Removed Tacos and 5 items", "Cleared the list") revert the last
  list change. Server keeps the last 50 list states in memory (lost on restart); only list edits
  that changed the list are recorded. Deleting an item or recipe and merging items clear the
  history (old states would reference them). Undo restores the list only, not usage. Nothing to
  undo shows a calm "Nothing to undo" toast.
- **Clear list** button with confirmation; an empty list shows an empty state that teaches the
  core loop ("Type an item and press Enter", the note syntax, Shift+Enter, `↓`).

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
- The List view has no on-screen paste preview; it keeps exactly what `GET /api/list/export`
  returns cached in the background, refetched on every state version change.
- **Copy** button and `Ctrl+Shift+C` shortcut (anywhere in the List view, including while typing
  in the omnibar) copy the text and show "Copied N items".
- The app is served over plain HTTP on the LAN, where `navigator.clipboard` is unavailable on
  phones. Copy must fall back to a hidden-textarea + `document.execCommand('copy')`, and if that
  fails, show the text pre-selected in a textarea for manual copy (`public/js/clipboard.js`).
  Copy uses the cached text when it matches the current version, so the copy happens inside
  the click (Safari only allows `execCommand('copy')` there); otherwise it fetches first.

### 3.7 Recipes view (P0)

Two routes: the index at `#/recipes` and a recipe's editor at `#/recipes/<id>` (an unknown id
shows a friendly "Recipe not found" with a link back; it turns into the editor if live sync
brings the recipe in, e.g. one just created on another device).

**Index**

- Fuzzy-filterable list of recipes (by name when the filter is empty) showing the ingredient
  count, a one-line preview of the ingredients (wide screens) and an "on list" tag; each row has
  a visible "Add" button (cull dialog).
- Keyboard: typing filters; `Enter` in the filter opens the top match (highlighted); `↓` moves
  into the rows; on a row `↑`/`↓`/`j`/`k` move (`↑` on the first returns to the filter),
  `Home`/`End`, `Enter` opens the editor, `a` adds to the list (cull dialog), `/` or `Esc` go back
  to the filter. Rows use a roving tabindex.
- Whenever the filter text does not name a recipe exactly, the rows end with
  `+ New recipe "…"`; when nothing matches it is the top row, so `Enter` creates the recipe and
  opens its editor.
- New recipe: `n` (when not typing) or the "New recipe" button asks for a name in a small dialog
  (prefilled with the filter text; the server's error, e.g. a duplicate, shows inline), then
  opens the editor.
- Coming back from an editor focuses that recipe's row, so `a` adds it right away.

**Editor**

- The name is an inline field: `Enter` or leaving the field saves (normalized); the server's
  validation message shows under it and the typed text stays; `Esc` puts the saved name back;
  `F2` jumps to it. `Enter` then moves on to the ingredient search.
- Ingredients are added with the same omnibar as the List view (items only: no recipes, no
  create-recipe row), including inline item creation with the category picker; the created item
  joins the recipe. Items already in the recipe are badged "in recipe" in the dropdown; picking
  one again only says "Milk is already in Tacos". Focus stays in the omnibar for rapid entry, and
  adds run one at a time through a queue, each reading the latest recipe, so fast typing never
  drops an ingredient.
- Ingredient rows are grouped and ordered like the list (walk order, then name; staples tagged)
  with an always-visible remove button. Keyboard: `↓` from the empty omnibar moves into the rows;
  `↑`/`↓`/`j`/`k`/`Home`/`End` move; `Delete`/`Backspace`/`x` removes (focus moves to the next
  row, else the previous, else the omnibar); `/` or `Esc` go back to the omnibar. A removal toast
  offers Undo (the ingredient goes back where it was).
- "Add to list" opens the cull dialog (a recipe without ingredients just says to add some
  first); "Delete" asks for confirmation (the recipe comes off the list; its items stay there as
  manual entries — see §4), then returns to the index.
- Back: a back link and `Esc` in the empty omnibar return to where the editor was opened from:
  the List view right after `+ Create recipe "…"` there (so the next step, adding the new recipe
  to the list, is a few keystrokes away), else the index.
- Live sync never touches the name field while it is focused or holds an unsaved/rejected edit,
  nor the omnibar text; new ingredients from another device are briefly highlighted.

**From the List view:** the omnibar's create rows offer both `+ Create item "…"` and
`+ Create recipe "…"`; creating a recipe (`POST /api/recipes` with the typed name) jumps to its
editor at `#/recipes/<id>`. Picking a recipe opens the cull dialog (§3.4).

### 3.8 Items catalog view (P1)

- Fuzzy-filterable table of all items: name, category, aliases, staple flag, usage count
  ("added 4×"; nothing for items never added), plus an "on list" tag. Sorted by name while the
  filter is empty. Quick-filter chips "Uncategorized" and "Staples" (with counts; both on = both
  conditions); `#/items/uncategorized` opens with the first one on (the Store order view links
  there).
- Long catalogs render 100 rows at a time: a "Show 100 more" row (`Enter` on it, or tap) adds
  the next 100 and moves focus to the first new row; changing the filter or a chip starts from
  the first 100 again. A row being edited, or just saved, created or merged into, is always
  rendered. This keeps filtering instant with thousands of items.
- Inline edit of name, category (select), aliases (comma-separated), staple toggle. One editor
  at a time (switching away from an edited, unsaved one is refused with a hint); `Enter` saves,
  `Esc` cancels; the server's validation message shows inline on the field it is about (a name
  vs. an alias conflict). Live sync never touches the open editor's fields or the filter text;
  the row being edited stays visible even if the filter stops matching it. On phones a tapped
  row opens the editor without focusing a field (no on-screen keyboard over it).
- Keyboard: typing filters; `Enter` in the filter edits the top match; `↓` moves into the rows;
  on a row `↑`/`↓`/`j`/`k`/`Home`/`End` move (`↑` on the first returns to the filter), `Enter`/
  `F2` edit, `s` toggles staple, `c` opens a category picker (`1`–`9` by walk position, `0`
  or `Tab` Uncategorized like the omnibar picker, typing filters, `Enter` picks), `m` merges, `Delete`/`Backspace` delete, `/`
  or `Esc` back to the filter. Each row also has a category button (opens the picker) and the
  editor has "Merge into…" and "Delete" buttons, for touch.
- Whenever the filter text does not name an item (or alias) exactly, the rows end with
  `+ New item "…"` (on top when nothing matches): it asks for the category with the same
  picker, creates the item (not on the list) and focuses its row.
- Delete with confirmation that names affected recipes (and says whether it is on the list);
  deletion removes the item from recipes and the list.
- Uncategorized items are highlighted (warm bar and category pill) so they can be fixed later;
  fixing one under the Uncategorized chip moves focus to the next.
- **Merge** (P2): merge item A into B — references move to B, A's name becomes an alias of B.
  Details: A's aliases become B's too; on the list, entries fold together (sources unioned, B's
  note kept unless it has none); recipes containing both keep B once; B adopts A's category only
  if uncategorized; usage counts are summed (`last_used` = later); B's name and staple flag stay.
  UI: a fuzzy picker of the other items (the first 100 by name until something is typed), then
  a confirm explaining the result ("Parmesan will become an alias of Parmigiano Reggiano; 2
  recipes updated. …").

### 3.9 Categories / store order view (P1)

- Ordered list of categories = store walk: numbered stops with their item counts, and a footer
  for Uncategorized (always last; "Review" opens `#/items/uncategorized`).
- Reorder with `Alt+↑`/`Alt+↓` on the focused row (focus follows it), and ↑/↓ buttons for
  touch (≥ 44 px). Moves show at once; requests run one at a time, each sending the latest
  order (reconciled with categories added/deleted meanwhile), so holding `Alt+↓` never races.
- `↑`/`↓`/`j`/`k`/`Home`/`End` move focus (keyboard devices start on the first row).
- Add (`n` or the button), rename (`Enter`/`F2`, or tap the row: name dialog, server errors
  inline), delete (`Delete`/`Backspace` or the trash button; the confirm says how many items
  become Uncategorized).

### 3.10 Live sync across devices (P1)

- Client polls `GET /api/version` every 3 s while the page is visible, and immediately on
  `focus`/`visibilitychange`/`online`. If the version changed, it fetches `GET /api/state` and
  re-renders.
- While the server can't be reached the header says "Offline — reconnecting" and polling backs
  off (retries after 3 s, 6 s, 12 s, 24 s, then every 30 s; focusing the page retries at once),
  so a stopped server or a sleeping PC isn't polled every 3 s (each failed request is a console
  error in the browser). The first successful poll goes back to Live and the 3 s rhythm.
- Re-render must never clobber what the user is typing (omnibar text, note editor, recipe editor
  name) or lose keyboard focus/selection.

### 3.11 App shell (P0)

- Views: **List** (default), **Recipes**, **Items**, **Store order**. Hash routing
  (`#/list`, `#/recipes`, `#/items`, `#/categories`).
- `Alt+1`…`Alt+4` switch views; `/` or `Ctrl+K` focuses the current view's search box; `?` opens
  a keyboard shortcut overlay.
- Toast area for confirmations, errors (with the server's error message), and Undo.
- The header shows a live-sync indicator (Live / "Offline — reconnecting"; on phones just a
  dot, plus "Offline" when offline) and a keyboard button that opens the shortcut overlay (for
  touch users).
- Light theme by default, whatever the OS prefers. A header button (moon / sun, `aria-pressed`)
  switches to dark and back; the choice is remembered per device (`localStorage`
  `grocery-theme`, applied before first paint; `public/js/theme.js`). Text, muted text included,
  has at least 4.5:1 contrast in both.
- Responsive: single column ≤ 700 px with the view tabs as a bottom tab bar that never covers
  content or toasts, sticky omnibar, tap targets ≥ 44 px, dialogs as bottom sheets that sit
  above the on-screen keyboard (`public/js/viewport.js` follows `window.visualViewport`; the
  omnibar's dropdown is capped the same way), no horizontal scroll at 360 px wide
  (`e2e/tests/mobile.spec.ts`).
- Accessibility: the omnibar and pickers are ARIA comboboxes with a listbox and
  `aria-activedescendant`; dialogs are `role="dialog"` + `aria-modal` named by their title; row
  lists are `role="list"` with a short `aria-label` per focusable row; every control has a name.
  Focus never falls back to the page `<body>`: closing a dialog returns it to the opener (or the
  row that replaced it), a toast whose Undo had focus hands it back, and a removed row passes it
  to a neighbour or the search box (`e2e/tests/a11y.spec.ts` walks every view by keyboard).

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
  store.rs            load/save/backup (startup + daily)/migrate/seed; AppState (Arc<Mutex<..>>),
                      mutate, undo
  names.rs            normalization + validation
  demo.rs             --demo catalog (names relied on by tests)
  error.rs            ApiError -> JSON response; ApiJson / ApiPath extractors
  catalog.rs          category/item/recipe edits incl. merge (Db methods)
  list.rs             list edits: add/remove items and recipes, notes, clear (Db methods)
  export.rs           list -> text
  api/                one module per resource: categories, items, recipes, list, meta
tests/                Rust integration tests (tower::ServiceExt::oneshot against app()), incl.
                      concurrent edits (concurrency.rs) and path traversal (app.rs)
public/
  index.html
  css/app.css
  js/main.js          bootstrap, routing, global shortcuts (view contract)
  js/router.js        hash routes; js/shortcuts.js: shortcut list for the ? overlay
  js/api.js           fetch wrapper; mutations return state
  js/store.js         client state, subscribe, live-sync polling
  js/fuzzy.js         pure fuzzy matcher (+ fuzzy-text.js, fuzzy-tiers.js, fuzzy.test.js)
  js/dom.js           h() element builder, highlight(), focus-preserving rerender(),
                      parkFocus()/focusFallback() (focus never left on <body>)
  js/viewport.js      on-screen keyboard: visualViewport -> CSS vars for sheets/dropdowns
  js/paging.js        "Show more" paging of long result lists (Items view)
  js/queue.js         serial mutation queue; js/clipboard.js: copy with fallbacks
  js/omnibar-model.js js/list-model.js js/recipes-model.js js/cull-model.js
  js/items-model.js js/categories-model.js
                      pure logic behind the omnibar, the list, the recipes view, the cull
                      dialog, the items view, the store order view
  js/components/      omnibar (+ category picker), cull dialog, name dialog, pick dialog,
                      toast, dialog, copy dialog, sticky bar
  js/views/           list (+ list-*.js), recipes (+ recipes-index*.js, recipe-*.js), items,
                      categories
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
- Every P0 keyboard flow has a Playwright test; mobile layout has a test at 375×812
  (`mobile.spec.ts`: a whole phone session, tap targets, sheets, no horizontal scroll);
  `a11y.spec.ts` walks every view by keyboard and checks roles/names and the Offline state;
  `perf.spec.ts` holds the 50 ms keystroke budget with 1,000+ items.
- Tests and dev servers **never** touch the real `data/` directory (temp dirs / port 3999).

## 7. Out of scope (v1)

Multiple stores, multiple simultaneous lists, list history, quantities/units, user accounts/auth,
HTTPS, checking items off in-store (that happens in the notes app), importing the old RON data.
