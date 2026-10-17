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
  | 400 | Validation failed, or the body is not valid JSON / has wrong or missing fields |
  | 404 | Unknown id (`"item 12 not found"`) or unknown `/api/*` route |
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

  `id` is `null` when there is no single affected id (e.g. clearing the list). A failed mutation
  changes nothing (no partial writes, no version bump).
- **`version`** is a revision counter, incremented by exactly 1 on every successful mutation and
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
    { "id": 56, "name": "Spaghetti Carbonara", "item_ids": [42, 30, 31, 26, 17, 41, 40] }
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

## Categories, items, recipes, list

Arrive with T3 (see SPEC §4 for the planned endpoints).
