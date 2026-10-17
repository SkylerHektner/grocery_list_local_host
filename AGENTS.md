# AGENTS.md

A personal, keyboard-first grocery list builder: a Rust (axum) server on the home LAN serves a
vanilla HTML/CSS/JS app and a small JSON API; the output is a plain-text list grouped in store-walk
order, pasted into Apple Notes. **[docs/SPEC.md](docs/SPEC.md) is the source of truth for
behavior; [docs/TASKS.md](docs/TASKS.md) is the build plan and status** (read your task's section
and the Notes of the tasks before it). Keep responses concise.

## Repo map

```
Cargo.toml              lib + bin crate; package and binary are both `rust_html_server`
src/main.rs             CLI entry: parse config, create data dir, bind, print LAN URL, Ctrl+C shutdown
src/lib.rs              pub fn app(..) -> Router   <- used by main.rs AND tests (the main seam)
src/config.rs           flags/env parsing as a pure fn (unit tests inside)
src/api/mod.rs          /api router + JSON 404/405 fallbacks; one submodule per resource
src/api/meta.rs         GET /api/health (state/version arrive in T2)
tests/app.rs            integration tests: oneshot requests against app()
tests/common/mod.rs     helpers: send(&app, method, uri, Option<json>) / get(&app, uri) -> TestResponse
public/                 frontend, served from disk (no build step, no runtime deps)
  index.html  css/app.css  js/main.js  js/fuzzy.js  js/*.test.js
e2e/                    Playwright Test (own package.json, uses system Microsoft Edge)
  playwright.config.ts  global-teardown.ts  tests/fixtures.ts  tests/*.spec.ts
scripts/check.ps1|.sh   every check, in order, stops at first failure
docs/                   SPEC.md, TASKS.md, API.md (API.md from T3)
.claude/launch.json     "dev" preview server: 127.0.0.1:3999, data in target/dev-data, --demo
.claude/settings.json   allowlisted check/test commands
data/                   THE OWNER'S REAL DATA (gitignored). Never touch. See "Data safety".
```

## Commands

Run from the repo root unless noted. Shell is Git Bash or PowerShell on Windows.

| What | Command |
|---|---|
| **Everything** (definition of done) | `pwsh -File scripts/check.ps1` · Git Bash: `./scripts/check.sh` |
| Everything except Playwright | `pwsh -File scripts/check.ps1 -Quick` · `./scripts/check.sh --quick` |
| Format / check format | `cargo fmt` / `cargo fmt --check` |
| Lint | `cargo clippy --all-targets -- -D warnings` |
| Rust tests | `cargo test` |
| One Rust test (name substring) | `cargo test flags_win` · one file: `cargo test --test app` · one unit test: `cargo test --lib config::tests::help` |
| JS unit tests | `node --test "public/js/**/*.test.js"` (quote the glob; a bare dir like `node --test public/js/` does **not** work on Node 26) |
| One JS test file / by name | `node --test public/js/fuzzy.test.js` · `node --test --test-name-pattern="diacritics" "public/js/**/*.test.js"` |
| Playwright (in `e2e/`) | `npm test` (first time: `npm ci`; never `npx playwright install`) |
| One spec / project / title | `npx playwright test tests/smoke.spec.ts` · `--project=desktop` or `--project=mobile` · `-g "health"` |
| Headed / step debugging | `npm run test:headed` (or `npx playwright test --headed --project=desktop`) · `npx playwright test --debug` |
| Failure artifacts | `e2e/test-results/` (traces, screenshots); `npx playwright show-trace <trace.zip>` |
| Look at the app | start the `dev` config from `.claude/launch.json` with the preview tool (http://127.0.0.1:3999) |

Playwright's `webServer` runs `cargo run -- --addr 127.0.0.1:3999 --data-dir <fresh temp dir> --demo`
itself and stops it afterwards. The temp dir is `%TEMP%/grocery-e2e/run-*` (exposed to tests as
`process.env.GROCERY_E2E_DATA_DIR`) and is deleted by `global-teardown.ts`.

## Conventions

**Rust**
- Thin handlers: extract → call a store/model function → map to response. Logic lives in plain
  functions (`store.rs`, `names.rs`, `export.rs`, ...) with unit tests.
- Errors go through `ApiError` (`src/error.rs`, from T2) → `{"error": "<message>"}` with 400/404/409.
  No `unwrap`/`expect`/`panic!` in request paths.
- Each resource has `src/api/<resource>.rs` exposing its routes; `api::router()` merges them
  **before** the fallbacks (axum applies `method_not_allowed_fallback` only to earlier routes).
- Every endpoint gets integration tests in `tests/` (use `tests/common`), never a real socket
  and never the real `data/`: use `tempfile::tempdir()`.
- No new dependencies without a reason in the commit message (SPEC §5).

**JavaScript / HTML / CSS**
- Vanilla ES modules, no bundler, no framework, no runtime dependencies. Relative imports with
  the `.js` extension.
- Pure logic (fuzzy matching, formatting, sorting) lives in DOM-free modules with a sibling
  `*.test.js` using `node:test` + `node:assert/strict`.
- `data-testid` on every interactive element and on anything a test asserts on.
- Keep modules small and single-purpose (split past ~300 lines).

**E2E**
- Import `test`/`expect` from `./fixtures` (not `@playwright/test`): it fails any test whose page
  logged a console error or threw. Clear `consoleErrors.length = 0` after an *expected* error.
- One server + one DB serve all tests of a run (`workers: 1`, both projects). Don't assume an empty
  DB; use unique names per test. Prefer `getByTestId` / `getByRole`.
- Projects: `desktop` (Desktop Edge) and `mobile` (375×812, touch). Tests run in both by default.

**Repo hygiene**: `.gitattributes` forces LF everywhere; don't commit CRLF. Commit only when asked
(in the task workflow the orchestrator reviews and commits).

## Data safety (hard rules)

- `data/` holds the owner's real grocery data and backups. **Never read, write, delete or point a
  server/test at it.** Rust tests: temp dirs. E2E: the fresh temp dir above. Dev/preview:
  `target/dev-data`.
- The owner runs a long-lived `cargo run --release` server on **port 3000**. Never kill it, never
  bind 3000, never run `cargo build --release` / `cargo run --release` (it would fight over
  `target/release`).
- Anything you start listens on **127.0.0.1:3999**. Only one process can: stop the `dev` preview
  before running Playwright (its webServer has `reuseExistingServer: false` and fails if 3999 is busy).
  A running preview also locks `target/debug/rust_html_server.exe` on Windows, so stop it before
  `cargo test`/`cargo build` too.
- Never run `cargo run` in the foreground (it never exits). Use the Playwright webServer or the
  `.claude/launch.json` preview.
- Don't touch firewall rules or other system settings.

## Definition of done

1. `pwsh -File scripts/check.ps1` passes in full (including Playwright).
2. Behavior changes are reflected in `docs/SPEC.md`; API changes in `docs/API.md` (request/response
   examples).
3. Your task in `docs/TASKS.md` is ticked with a short `Notes:` line for later tasks.
