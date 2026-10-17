# Grocery list

A personal, keyboard-first grocery list builder. A small Rust server runs on your PC and serves a
web app to any browser on your home Wi-Fi (laptop or phone). You build the list from your item
catalog and recipes, and it produces a plain-text list grouped by the order you walk through the
store, ready to paste into Apple Notes.

> **Status:** rewrite in progress on branch `grocery-v2` — see [docs/TASKS.md](docs/TASKS.md).
> The full design is in [docs/SPEC.md](docs/SPEC.md).

## Run it

```
cargo run --release
```

It listens on port 3000 on all network interfaces and prints where to open it:

```
Listening on http://0.0.0.0:3000
  This computer: http://localhost:3000
  Phone (same Wi-Fi): http://192.168.1.23:3000
```

Open the **Phone** URL in your phone's browser (it must be on the same Wi-Fi). Tip: "Add to Home
Screen" makes it feel like an app. Stop the server with `Ctrl+C`.

Options (a flag wins over its environment variable):

| Flag | Env var | Default |
|---|---|---|
| `--addr <IP:PORT>` | `GROCERY_ADDR` | `0.0.0.0:3000` |
| `--data-dir <PATH>` | `GROCERY_DATA_DIR` | `data/` in this repo |
| `--static-dir <PATH>` | `GROCERY_STATIC_DIR` | `public/` in this repo |
| `--demo` | `GROCERY_DEMO=1` | off — seeds a demo catalog into a *fresh* database |

`cargo run --release -- --help` prints the same.

## Let your phone through Windows Firewall (one time)

Windows blocks incoming connections by default. In an **administrator** PowerShell, run:

```powershell
New-NetFirewallRule -DisplayName "Grocery list (TCP 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

This only opens port 3000 on networks marked **Private**, so make sure your home Wi-Fi is Private
(Settings → Network & internet → Wi-Fi → your network → Network profile type → Private).
To undo it: `Remove-NetFirewallRule -DisplayName "Grocery list (TCP 3000)"`.

There is no login: anyone on your Wi-Fi can open the app. Don't expose port 3000 to the internet.

## Your data

- Everything lives in one file, `data/db.json` (the `data/` folder is git-ignored).
- Each time the server starts it copies the current file to `data/backups/db-<unix time>.json` and
  keeps the 10 most recent copies.
- To restore a backup: stop the server, copy the backup over `data/db.json`, start the server.
- To back up elsewhere, just copy the `data/` folder.
- The old version's `data/*.ron` files are not imported; they are left alone.
- If `db.json` is ever unreadable (e.g. a bad hand edit), the server refuses to start and says
  why; it never overwrites the file. Fix it or restore a backup.

## Changing the app

- **Frontend** (`public/`): files are served straight from disk, so edits are live — just reload
  the page.
- **Backend** (`src/`): stop the server (`Ctrl+C`) and run `cargo run --release` again.

## Checks

Requires Rust, Node.js 22+ and Microsoft Edge (the browser tests use your installed Edge).

```
pwsh -File scripts/check.ps1          # Windows: format, lint, Rust tests, JS tests, browser tests
pwsh -File scripts/check.ps1 -Quick   # same without the browser tests
./scripts/check.sh [--quick]          # same, from Git Bash / macOS / Linux
```

The first run installs the test tooling into `e2e/node_modules`. Tests never touch `data/` or
port 3000 — they use temporary folders and port 3999, so they are safe to run while your server is
up. Notes for AI coding agents are in [AGENTS.md](AGENTS.md).
