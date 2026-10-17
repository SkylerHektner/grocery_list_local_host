# HTTP API

Detailed, always-current reference for the JSON API under `/api` (summary table in
[SPEC.md §4](SPEC.md#4-http-api)). Every endpoint here has integration tests in `tests/`.

## Conventions

- **Bodies are JSON** (`Content-Type: application/json`), UTF-8. Responses carry
  `Cache-Control: no-cache`.
- **Errors** are `{"error": "<human readable message>"}` with a fitting status. The message is
  meant to be shown to the user as-is (e.g. in a toast).

  | Status | When |
  |---|---|
  | 400 | Validation failed; the body is not valid JSON or has a wrong, missing or **unknown** field (bodies are strict: `{"item_id": 1, "qty": 2}` is a 400); a path id is not a number (`/api/items/abc`); an id *inside a body value* does not exist (`"category 99 does not exist"`) |
  | 404 | The id being acted on does not exist (`"item 12 not found"`): the id in the URL, or `item_id` / `recipe_id` / `into_id` in list-add and merge bodies. Also: the item or recipe is not on the list (`"\"Milk\" is not on the list"`), unknown `/api/*` route |
  | 405 | Known route, wrong method |
  | 409 | Duplicate name (`"an item named \"Milk\" already exists"`) or conflicting state (`"nothing to undo"`) |
  | 500 | The server could not save the database; nothing was changed |

  ```json
  { "error": "an item named \"Milk\" already exists" }
  ```

- **Every mutation** (POST/PUT/DELETE) returns the complete new state plus the affected or
  created id, so the client never needs a follow-up fetch:

  ```json
  { "state": { "version": 43, "categories": [], "items": [], "recipes": [], "list": {} }, "id": 120 }
  ```

  `id` is the new id for creates, the URL id for updates and deletes (the *deleted* id), the
  target for list adds and merges (see each endpoint), and `null` when there is no single
  affected id (reordering, clearing the list, undo). A failed mutation changes nothing (no
  partial writes, no version bump, no undo state recorded).
- **`version`** is a revision counter, incremented by exactly 1 on every successful mutation
  (even one that changed nothing, like re-adding an item that is already on the list) and
  persisted with the data. A freshly created database starts at 0. Clients poll
  `GET /api/version` and refetch `GET /api/state` when it changes.
- **Names** (items, aliases, recipes, categories) are normalized: trimmed, internal whitespace
  collapsed to single spaces, first character uppercased, the rest kept as typed
  (`"  bBQ   sauce "` → `"BBQ sauce"`). 1–80 characters, no control characters, unique
  case-insensitively per kind. **Notes** are trimmed and whitespace-collapsed (not capitalized),
  max 80 characters; an empty note means no note (`null`). See SPEC §2.3.

### Snapshot

What `GET /api/state` returns and what `state` holds in mutation responses. The array order of
`categories` is the store walk order.

```json
{
  "version": 42,
  "categories": [
    { "id": 1, "name": "Produce" },
    { "id": 3, "name": "Deli & Cheese" }
  ],
  "items": [
    {
      "id": 26, "name": "Parmigiano Reggiano", "category_id": 3,
      "aliases": ["Parmesan"], "staple": false,
      "use_count": 4, "last_used": 1760650000
    },
    {
      "id": 54, "name": "Birthday candles", "category_id": null,
      "aliases": [], "staple": false, "use_count": 0, "last_used": 0
    }
  ],
  "recipes": [
    {
      "id": 56, "name": "Spaghetti Carbonara",
      "ingredients": [
        { "item_id": 42, "note": null }, { "item_id": 30, "note": null },
        { "item_id": 31, "note": "4 yolks + 1 whole" }, { "item_id": 26, "note": null }
      ]
    }
  ],
  "list": {
    "entries": [
      {
        "item_id": 26, "note": "1 wedge",
        "sources": [{ "kind": "manual" }, { "kind": "recipe", "recipe_id": 56 }],
        "added_at": 1760650000
      }
    ],
    "recipe_ids": [56]
  }
}
```

| Field | Notes |
|---|---|
| `items[].category_id` | `null` = Uncategorized |
| `items[].use_count`, `last_used` | Times added to the list, and unix seconds of the last add (`0` = never). For search ranking. |
| `list.entries[].note` | `null` when there is no note |
| `list.entries[].sources` | Never empty. `{"kind": "manual"}` and/or `{"kind": "recipe", "recipe_id": N}`, each recipe also in `list.recipe_ids` |
| `list.entries[].added_at` | Unix seconds |

The stored `db.json` additionally has `schema_version` and `next_id`; clients never see them.

## Meta

### `GET /api/health`

Liveness check (also what Playwright waits for).

```
GET /api/health
→ 200 {"ok": true, "version": 42}
```

### `GET /api/state`

The full [Snapshot](#snapshot).

```
GET /api/state
→ 200 {"version": 0, "categories": [{"id": 1, "name": "Produce"}, …], "items": [], "recipes": [],
       "list": {"entries": [], "recipe_ids": []}}
```

### `GET /api/version`

Cheap live-sync poll: just the current revision.

```
GET /api/version
→ 200 {"version": 42}
```

## Categories

The array order of `categories` is the store walk order. Logic: `src/catalog.rs`.

### `POST /api/categories`

Body `{name}`. Appends a category at the end of the walk. → `id` = the new category.
Errors: 400 invalid name, 409 duplicate name.

```
POST /api/categories {"name": "garden center"}
→ 200 {"state": {…, "categories": [… , {"id": 120, "name": "Garden center"}]}, "id": 120}
```

### `PUT /api/categories/{id}`

Body `{name}`. Renames (a case-only change of its own name is fine). → `id` = `{id}`.
Errors: 404 unknown id, 400 invalid name, 409 duplicate name.

```
PUT /api/categories/5 {"name": "Dairy"}
→ 200 {"state": {…}, "id": 5}
```

### `DELETE /api/categories/{id}`

Deletes the category; its items become Uncategorized (`category_id: null`). The list and the
list-undo history are untouched. → `id` = the deleted id. Errors: 404 unknown id.

```
DELETE /api/categories/1
→ 200 {"state": {…}, "id": 1}
```

### `PUT /api/categories/order`

Body `{ids}`: every category id exactly once, in the new walk order. → `id` = `null`.
Errors: 400 if an id is unknown, listed twice, or a category is missing
(`"the order must list every category; \"Produce\" (1) is missing"`).

```
PUT /api/categories/order {"ids": [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]}
→ 200 {"state": {…, "categories": [{"id": 11, "name": "Personal Care"}, …]}, "id": null}
```

## Items

Logic: `src/catalog.rs`.

### `POST /api/items`

Body `{name, category_id?, aliases?, staple?}` (defaults: `null`, `[]`, `false`). Name and
aliases are normalized; blank, duplicate and own-name aliases are dropped. Usage stats start at
0. Creating does **not** add the item to the list (follow with `POST /api/list/items`).
→ `id` = the new item.
Errors: 400 invalid name/alias or unknown `category_id` (`"category 99 does not exist"`);
409 the name is taken (`"an item named \"Milk\" already exists"`), is another item's alias
(`"\"Parmesan\" is already an alias of \"Parmigiano Reggiano\""`), or an alias is another item's
name (`"alias \"Milk\" is already the name of item \"Milk\""`). Items may share aliases.

```
POST /api/items {"name": "birthday candles", "category_id": null, "aliases": ["candles"]}
→ 200 {"state": {…, "items": [… , {"id": 121, "name": "Birthday candles", "category_id": null,
       "aliases": ["Candles"], "staple": false, "use_count": 0, "last_used": 0}]}, "id": 121}
```

### `PUT /api/items/{id}`

Body `{name, category_id, aliases, staple}`: a full replace, so **all four fields are required**
(`category_id` may be `null`). Usage stats and list entry are kept. → `id` = `{id}`.
Errors: 404 unknown id, 400 as for POST (incl. a missing field), 409 as for POST (excluding the
item itself, so a case-only rename is fine).

```
PUT /api/items/32 {"name": "Whole milk", "category_id": 5, "aliases": ["Milk"], "staple": false}
→ 200 {"state": {…}, "id": 32}
```

### `DELETE /api/items/{id}`

Deletes the item and every reference to it: removed from every recipe's `ingredients` and from the
list (recipe chips stay, even if no entry from that recipe is left). **Clears the list-undo
history** (older list states would reference the item). → `id` = the deleted id.
Errors: 404 unknown id.

```
DELETE /api/items/31
→ 200 {"state": {…}, "id": 31}
```

### `POST /api/items/{id}/merge`

Body `{into_id}`. Merges item `{id}` (A) into `into_id` (B), then deletes A:

- **List:** if both are on the list, B's entry gains A's sources (union, no duplicates) and A's
  note only if B has none; B's `added_at` is kept. If only A is on the list, its entry (note,
  sources, position) now names B.
- **Recipes:** A is replaced by B in place; where B is already an ingredient, A is just removed.
- **B itself:** gains A's name and aliases as aliases; adopts A's category only if B is
  uncategorized; `use_count` = sum, `last_used` = the later one; B's name and staple flag stay.
- **Clears the list-undo history.**

→ `id` = `into_id`. Errors: 404 unknown `{id}` or `into_id`, 400 `{id}` = `into_id`
(`"cannot merge \"Milk\" into itself"`).

```
POST /api/items/60/merge {"into_id": 26}
→ 200 {"state": {…, "items": [… , {"id": 26, "name": "Parmigiano Reggiano",
       "aliases": ["Parmesan", "Pecorino"], …}]}, "id": 26}
```

## Recipes

Logic: `src/catalog.rs`.

### `POST /api/recipes`

Body `{name, ingredients?}` (default `[]`), each ingredient `{item_id, note?}`. Every `item_id`
must be an existing item; duplicate items are dropped (first occurrence wins, note included).
A note is normalized like a list note (absent, `null` or blank = no note); it is what the item's
list entry gets when the recipe adds it (see `POST /api/list/recipes`). Creating does not touch
the list. → `id` = the new recipe.
Errors: 400 invalid name, unknown item (`"item 999 does not exist"`) or invalid note
(`"note is too long (81 characters, max 80)"`), 409 duplicate name.

```
POST /api/recipes {"name": "pancakes", "ingredients": [
  {"item_id": 32, "note": " 1  cup "}, {"item_id": 31}, {"item_id": 32}]}
→ 200 {"state": {…, "recipes": [… , {"id": 122, "name": "Pancakes", "ingredients": [
       {"item_id": 32, "note": "1 cup"}, {"item_id": 31, "note": null}]}]}, "id": 122}
```

### `PUT /api/recipes/{id}`

Body `{name, ingredients}` (both required): full replace, notes included (an ingredient sent
without a note has none). The list is **not** changed: entries keep this recipe as a source (and
any note it gave them) even if their item is no longer an ingredient. → `id` = `{id}`.
Errors: 404 unknown id, 400 / 409 as for POST.

```
PUT /api/recipes/55 {"name": "Taco night", "ingredients": [
  {"item_id": 28, "note": "1 lb"}, {"item_id": 25}, {"item_id": 15, "note": null}]}
→ 200 {"state": {…}, "id": 55}
```

### `DELETE /api/recipes/{id}`

Deletes the recipe and takes it off the list: its chip goes (`list.recipe_ids`), its source is
stripped from every entry, and entries left without a source **stay on the list as manual**.
**Clears the list-undo history.** → `id` = the deleted id. Errors: 404 unknown id.

```
DELETE /api/recipes/55
→ 200 {"state": {…}, "id": 55}
```

## List

The single active list (`state.list`). Logic: `src/list.rs`, `src/export.rs`.

**Usage stats.** `use_count` +1 and `last_used` = now when an item is *put on* the list: a manual
add that creates the entry or gives an existing recipe-only entry its manual source, or a recipe
add that creates the entry. Re-adding an item that is already there (manually), or a recipe
reaching an item already on the list, never counts again. Removing, clearing and undo don't
change usage.

**Undo.** Every list endpoint below (except export and undo itself) records the previous list
for `POST /api/list/undo` — but only if the list actually changed (a no-op re-add or clearing an
empty list records nothing). The server keeps the last 50 list states, **in memory only** (gone
after a restart). Deleting an item, merging items or deleting a recipe clears the history;
other catalog edits keep it.

### `POST /api/list/items`

Body `{item_id, note?}`. Puts the item on the list with a `manual` source and the (normalized)
note. If it is already on the list it is **not an error**: the entry gains the manual source if
missing, and its note is replaced only when a non-blank `note` is given (absent, `null` or
blank keeps the old note). → `id` = `item_id`.
Errors: 404 unknown item, 400 invalid note (`"note is too long (81 characters, max 80)"`).

```
POST /api/list/items {"item_id": 31, "note": "2 dozen"}
→ 200 {"state": {…, "list": {"entries": [{"item_id": 31, "note": "2 dozen",
       "sources": [{"kind": "manual"}], "added_at": 1760650000}], "recipe_ids": []}}, "id": 31}
```

### `PUT /api/list/items/{item_id}`

Body `{note}` (required; `null` or `""` clears it). → `id` = `{item_id}`.
Errors: 404 unknown item or not on the list (`"\"Milk\" is not on the list"`), 400 invalid note.

```
PUT /api/list/items/31 {"note": "brown"}
→ 200 {"state": {…}, "id": 31}
```

### `DELETE /api/list/items/{item_id}`

Removes the entry entirely, whatever its sources. Recipe chips stay even when no entry from that
recipe is left (remove them with `DELETE /api/list/recipes/{id}`). → `id` = `{item_id}`.
Errors: 404 unknown item or not on the list.

```
DELETE /api/list/items/31
→ 200 {"state": {…}, "id": 31}
```

### `POST /api/list/recipes`

Body `{recipe_id, item_ids}` (both required): `item_ids` is the culled subset of the recipe's
ingredients the user kept (duplicates ignored). Each gets a `{"kind": "recipe", "recipe_id": …}`
source: items already on the list just gain the source (never duplicated), others get a new
entry, in the recipe's ingredient order. **Notes:** an entry without a note gets the
ingredient's note; an existing note is never replaced. The recipe is added to
`list.recipe_ids` (once) **even when `item_ids` is empty**, so its chip shows. Adding the same
recipe again extends it. → `id` = `recipe_id`.
Errors: 404 unknown recipe, 400 an id that is not an ingredient of the recipe
(`"item 32 is not an ingredient of \"Tacos\""`).

```
POST /api/list/recipes {"recipe_id": 55, "item_ids": [28, 15]}
→ 200 {"state": {…, "list": {"entries": [{"item_id": 28, "note": "1 lb",
       "sources": [{"kind": "recipe", "recipe_id": 55}], "added_at": 1760650000}, …],
       "recipe_ids": [55]}}, "id": 55}
```

### `DELETE /api/list/recipes/{recipe_id}`

Removes the chip and the recipe's source from every entry; entries left without a source leave
the list (items also added manually or by another recipe stay). A staying entry whose note is
still exactly this recipe's note for its item loses it, or takes the note of its first remaining
recipe source that has one (a note the user changed is kept). The recipe itself is not
deleted. → `id` = `{recipe_id}`.
Errors: 404 unknown recipe or not on the list (`"\"Tacos\" is not on the list"`).

```
DELETE /api/list/recipes/55
→ 200 {"state": {…}, "id": 55}
```

### `DELETE /api/list`

Clears the list: all entries and chips. Usage stats are kept. → `id` = `null`.

```
DELETE /api/list
→ 200 {"state": {…, "list": {"entries": [], "recipe_ids": []}}, "id": null}
```

### `POST /api/list/undo`

No body. Restores the list as it was before the last recorded list edit (see **Undo** above),
as a normal mutation (version +1, saved). Only the list is restored, not usage stats or catalog
edits. → `id` = `null`. Errors: 409 `"nothing to undo"`.

```
POST /api/list/undo
→ 200 {"state": {…}, "id": null}
```

### `GET /api/list/export`

The list as plain text for pasting into a notes app (SPEC §3.6), `Content-Type:
text/plain; charset=utf-8`:

- one group per non-empty category, in walk order, headed by the category name uppercased;
  one blank line between groups;
- items sorted case-insensitively by name within a group, a note appended as ` (note)`;
  recipe sources never appear;
- uncategorized items last under `OTHER`, unless a category named "Other" (any case) exists:
  then they are sorted into that category's group, wherever it is in the walk;
- no trailing whitespace, no trailing newline; an empty list is an empty body.

```
GET /api/list/export
→ 200 text/plain
PRODUCE
Bananas
Limes

DAIRY & EGGS
Eggs (1 dozen)
Milk (2 gallons)

OTHER
Birthday candles
```
