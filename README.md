# Grocery list

A personal, keyboard-first grocery list builder. A small Rust server runs on your PC and serves a
web app to any browser on your home Wi-Fi (laptop or phone). You build the list from your item
catalog and recipes, and it produces a plain-text list grouped by the order you walk through the
store, ready to paste into Apple Notes:

```
PRODUCE
Bananas
Garlic

DAIRY & EGGS
Eggs
Milk (2 gallons)
```

The full design is in [docs/SPEC.md](docs/SPEC.md).

## Run it

```
cargo run --release
```

The first run compiles everything (a few minutes); later starts take a second. It listens on
port 3000 on all network interfaces and prints where to open it:

```
Listening on http://0.0.0.0:3000
  This computer: http://localhost:3000
  Phone (same Wi-Fi): http://192.168.1.23:3000
```

- **Laptop:** open http://localhost:3000.
- **Phone:** open the **Phone** URL in the phone's browser (it must be on the same Wi-Fi).
  "Add to Home Screen" makes it feel like an app. If the address changes after a router restart,
  the server prints the new one when it starts.

Stop the server with `Ctrl+C`. Options (a flag wins over its environment variable):

| Flag | Env var | Default |
|---|---|---|
| `--addr <IP:PORT>` | `GROCERY_ADDR` | `0.0.0.0:3000` |
| `--data-dir <PATH>` | `GROCERY_DATA_DIR` | `data/` in this repo |
| `--static-dir <PATH>` | `GROCERY_STATIC_DIR` | `public/` in this repo |
| `--demo` | `GROCERY_DEMO=1` | off — seeds a demo catalog into a *fresh* database |

`cargo run --release -- --help` prints the same.

## Let your phone through Windows Firewall (one time)

Windows blocks incoming connections by default, so the phone can't connect until you allow
port 3000. In an **administrator** PowerShell, run:

```powershell
New-NetFirewallRule -DisplayName "Grocery list (TCP 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

This only opens port 3000 on networks marked **Private**, so make sure your home Wi-Fi is Private
(Settings → Network & internet → Wi-Fi → your network → Network profile type → Private).
To undo it: `Remove-NetFirewallRule -DisplayName "Grocery list (TCP 3000)"`.

There is no login: anyone on your Wi-Fi can open the app. Don't expose port 3000 to the internet.

## Using it

The core loop on a laptop is **type → Enter**: `milk⏎ eggs⏎ bananas⏎`. Press `?` anywhere for
every shortcut; the most useful ones:

| Keys | What it does |
|---|---|
| `Alt+1` … `Alt+4` | List, Recipes, Items, Store order |
| `/` or `Ctrl+K` | Jump to the search box |
| `eggs, 2 dozen` `Enter` | Add with a note |
| `Shift+Enter` | Create a new item (then `1`–`9` picks its category, `0`/`Tab` none) |
| `↓` from the empty search box | Into the list: `↑`/`↓` move, `Delete` removes, `Enter` edits the note |
| `Ctrl+Z` | Undo the last list change |
| `Ctrl+Shift+C` | Copy the list (then paste into Notes) |
| Recipe in the search box, `Enter` | Pick what you need: `Space` skips an ingredient, `Enter` adds |
| Items view: `s` / `c` / `m` | Staple on/off / change category / merge into another item |
| Store order: `Alt+↑` / `Alt+↓` | Move a category along your walk through the store |

On a phone everything works by tapping: type in the box and tap a suggestion, tap a recipe to
pick its ingredients, tap × to remove, then **Copy**. Over plain Wi-Fi HTTP some phones don't
allow automatic copying; the app then shows the text selected so you can copy it by hand.

The dot at the top right says **Live** when changes from other devices show up within seconds,
and **Offline — reconnecting** when the server can't be reached (is it running? is the phone on
the same Wi-Fi?). It reconnects by itself.

## Your data

- Everything lives in one file, `data/db.json` (the `data/` folder is git-ignored). Every change
  is written to it immediately and safely (a half-written file can never replace it).
- Backups go to `data/backups/db-<unix time>.json`: one each time the server starts, and one a
  day while it keeps running (before the first change of the day). The 10 most recent are kept.
- To restore a backup: stop the server, copy the backup over `data/db.json`, start the server.
- To back up elsewhere, just copy the `data/` folder.
- The old version's `data/*.ron` files are not imported; they are left alone.
- If `db.json` is ever unreadable (e.g. a bad hand edit), the server refuses to start and says
  why; it never overwrites the file. Fix it or restore a backup.
- Undo (`Ctrl+Z`, or the Undo button in a toast) covers the last 50 list changes since the
  server started.
  Deleting an item, recipe or category can't be undone in the app: use a backup if needed.

## Updating after code changes

1. Get the new code (e.g. `git pull`).
2. **Frontend only** (`public/`): nothing to restart. Files are served straight from disk, so
   just reload the page on each device.
3. **Backend** (`src/`, `Cargo.toml`): stop the server (`Ctrl+C`) and run
   `cargo run --release` again. Open pages reconnect on their own; reload them to pick up any
   frontend changes that came with it.

Your data is untouched by updates. If a new version ever needs a newer data format, it upgrades
`db.json` on start (after taking the startup backup).

## Checks (for development)

Requires Rust, Node.js 22+ and Microsoft Edge (the browser tests use your installed Edge).

```
pwsh -File scripts/check.ps1          # Windows: format, lint, Rust tests, JS tests, browser tests
pwsh -File scripts/check.ps1 -Quick   # same without the browser tests
./scripts/check.sh [--quick]          # same, from Git Bash / macOS / Linux
```

The first run installs the test tooling into `e2e/node_modules`. Tests never touch `data/` or
port 3000 — they use temporary folders and port 3999, so they are safe to run while your server is
up. Notes for AI coding agents are in [AGENTS.md](AGENTS.md); the build plan and its status are in
[docs/TASKS.md](docs/TASKS.md).
