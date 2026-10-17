//! Persistence and shared state (SPEC §2.1).
//!
//! The whole [`Db`] lives in memory behind a `std::sync::Mutex` inside [`AppState`]. Every
//! mutation goes through [`AppState::mutate`] (or [`AppState::mutate_with`]): the closure edits
//! a *copy* of the DB; only if it succeeds is the copy given the next `version`, written to
//! `<data_dir>/db.json` atomically (`db.json.tmp` + rename) and swapped in. A closure error or a
//! failed save leaves memory and disk exactly as they were.
//!
//! Startup ([`AppState::open`]): a missing `db.json` creates a fresh DB (default categories, plus
//! the demo catalog with `--demo`); an existing one is parsed, schema-checked and migrated, then
//! backed up to `backups/db-<unix_seconds>[-n].json` (newest [`KEEP_BACKUPS`] kept). Unreadable,
//! corrupt or too-new files are hard errors: the user's data is never silently replaced.
//!
//! A server that runs for weeks would only have its startup copy, so while running, the DB as it
//! is on disk is also backed up before the first change once [`BACKUP_EVERY_SECS`] have passed
//! since the last backup (a failed backup is reported on stderr and never blocks the change).

use std::collections::VecDeque;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::Value;

use crate::demo;
use crate::error::ApiError;
use crate::model::{Db, List, SCHEMA_VERSION, Snapshot, unix_now};

pub const DB_FILE: &str = "db.json";
pub const TMP_FILE: &str = "db.json.tmp";
pub const BACKUP_DIR: &str = "backups";
/// Startup backups kept in `<data_dir>/backups`.
pub const KEEP_BACKUPS: usize = 10;
/// List states kept for `POST /api/list/undo` (SPEC §3.5).
pub const UNDO_CAP: usize = 50;
/// While running: back up before the first change once this long has passed since the last
/// backup (startup or running), so a mistake can be undone from a copy at most a day old.
pub const BACKUP_EVERY_SECS: u64 = 24 * 60 * 60;

/// Shared app state: cheap to clone (one `Arc`), handed to axum via `Router::with_state`.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<Store>>,
}

struct Store {
    db: Db,
    data_dir: PathBuf,
    undo: UndoStack,
    /// Unix seconds of the last backup (startup counts, also for a fresh DB).
    last_backup: u64,
}

impl fmt::Debug for AppState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AppState").finish_non_exhaustive()
    }
}

/// What a mutation does to the list-undo history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListUndo {
    /// Leave the history alone (catalog edits that don't touch the list).
    Keep,
    /// Push the pre-mutation list if the mutation changed the list (list edits).
    Record,
    /// Forget the history (e.g. deleting an item, which old list states may reference).
    Clear,
}

/// The last [`UNDO_CAP`] list states, newest last; pushing beyond the cap drops the oldest.
#[derive(Debug, Clone, Default)]
pub struct UndoStack {
    states: VecDeque<List>,
}

impl UndoStack {
    pub fn push(&mut self, list: List) {
        if self.states.len() == UNDO_CAP {
            self.states.pop_front();
        }
        self.states.push_back(list);
    }

    pub fn pop(&mut self) -> Option<List> {
        self.states.pop_back()
    }

    pub fn clear(&mut self) {
        self.states.clear();
    }

    pub fn len(&self) -> usize {
        self.states.len()
    }

    pub fn is_empty(&self) -> bool {
        self.states.is_empty()
    }
}

/// What [`AppState::open`] did, for `main` to print.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenReport {
    pub db_path: PathBuf,
    /// `db.json` did not exist and a fresh DB was created.
    pub created: bool,
    /// The demo catalog was seeded (only ever into a freshly created DB).
    pub demo_seeded: bool,
    /// The startup backup of an existing `db.json`.
    pub backup: Option<PathBuf>,
    /// Non-fatal problems (e.g. an old backup could not be deleted).
    pub warnings: Vec<String>,
}

/// A startup failure; `main` prints it and exits non-zero.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenError(pub String);

impl fmt::Display for OpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for OpenError {}

impl AppState {
    /// Loads (or creates) `<data_dir>/db.json`; see the module docs. `demo` seeds the demo
    /// catalog only when the DB is created by this call.
    pub fn open(data_dir: impl AsRef<Path>, demo: bool) -> Result<(Self, OpenReport), OpenError> {
        let data_dir = data_dir.as_ref().to_path_buf();
        fs::create_dir_all(&data_dir).map_err(|e| {
            OpenError(format!(
                "cannot create data dir {}: {e}",
                data_dir.display()
            ))
        })?;
        let db_path = data_dir.join(DB_FILE);
        let mut report = OpenReport {
            db_path: db_path.clone(),
            created: false,
            demo_seeded: false,
            backup: None,
            warnings: Vec::new(),
        };

        let db = match fs::read(&db_path) {
            Ok(bytes) => {
                let (db, migrated) = parse_db(&bytes, &db_path)?;
                // Back up only files that loaded: restarting on a broken file must never rotate
                // the good backups out.
                let backup_dir = data_dir.join(BACKUP_DIR);
                let backup = write_backup(&backup_dir, &bytes, unix_now()).map_err(|e| {
                    OpenError(format!(
                        "cannot write a backup of {} to {}: {e}",
                        db_path.display(),
                        backup_dir.display()
                    ))
                })?;
                report.backup = Some(backup);
                report.warnings = prune_backups(&backup_dir, KEEP_BACKUPS);
                if migrated {
                    save(&data_dir, &db).map_err(|e| {
                        OpenError(format!("cannot save migrated {}: {e}", db_path.display()))
                    })?;
                }
                db
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let mut db = Db::with_default_categories();
                if demo {
                    demo::seed(&mut db);
                    report.demo_seeded = true;
                }
                save(&data_dir, &db)
                    .map_err(|e| OpenError(format!("cannot create {}: {e}", db_path.display())))?;
                report.created = true;
                db
            }
            Err(e) => {
                return Err(OpenError(format!("cannot read {}: {e}", db_path.display())));
            }
        };

        let store = Store {
            db,
            data_dir,
            undo: UndoStack::default(),
            last_backup: unix_now(),
        };
        let state = Self {
            inner: Arc::new(Mutex::new(store)),
        };
        Ok((state, report))
    }

    /// The directory holding `db.json` and `backups/`.
    pub fn data_dir(&self) -> PathBuf {
        self.lock().data_dir.clone()
    }

    /// Current DB revision (cheap; for `GET /api/version`).
    pub fn version(&self) -> u64 {
        self.lock().db.version
    }

    pub fn snapshot(&self) -> Snapshot {
        self.lock().db.snapshot()
    }

    /// Runs `f` with read access to the DB (e.g. to render the export text).
    pub fn read<R>(&self, f: impl FnOnce(&Db) -> R) -> R {
        f(&self.lock().db)
    }

    /// The one entry point for changes; same as `mutate_with(ListUndo::Keep, f)`.
    ///
    /// `f` edits a copy of the DB. On `Ok(t)` the copy gets `version + 1`, is saved atomically
    /// and replaces the DB; returns the new [`Snapshot`] and `t`. On `Err` nothing changes (no
    /// version bump, no write). A failed save is an [`ApiError::Internal`] and also changes
    /// nothing. Don't touch `version`/`schema_version` in `f`; allocate ids with `alloc_id`.
    pub fn mutate<T>(
        &self,
        f: impl FnOnce(&mut Db) -> Result<T, ApiError>,
    ) -> Result<(Snapshot, T), ApiError> {
        self.mutate_with(ListUndo::Keep, f)
    }

    /// [`mutate`](Self::mutate), plus what to do with the list-undo history on success.
    pub fn mutate_with<T>(
        &self,
        undo: ListUndo,
        f: impl FnOnce(&mut Db) -> Result<T, ApiError>,
    ) -> Result<(Snapshot, T), ApiError> {
        let mut store = self.lock();
        let mut draft = store.db.clone();
        let value = f(&mut draft)?;
        let previous = store.commit(draft)?;
        match undo {
            ListUndo::Keep => {}
            ListUndo::Record => {
                if previous.list != store.db.list {
                    store.undo.push(previous.list);
                }
            }
            ListUndo::Clear => store.undo.clear(),
        }
        Ok((store.db.snapshot(), value))
    }

    /// Restores the most recent recorded list state as a normal mutation (version bump + save).
    /// 409 when there is nothing to undo; a failed save keeps the state on the undo stack.
    pub fn undo_list(&self) -> Result<Snapshot, ApiError> {
        let mut store = self.lock();
        let Some(previous) = store.undo.pop() else {
            return Err(ApiError::conflict("nothing to undo"));
        };
        let mut draft = store.db.clone();
        draft.list = previous.clone();
        if let Err(e) = store.commit(draft) {
            store.undo.push(previous);
            return Err(e);
        }
        Ok(store.db.snapshot())
    }

    /// Number of list states that can be undone.
    pub fn undo_depth(&self) -> usize {
        self.lock().undo.len()
    }

    /// A panic inside a mutation closure only ever touched the discarded draft, so the stored DB
    /// is still intact and a poisoned lock is safe to reuse.
    fn lock(&self) -> MutexGuard<'_, Store> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Store {
    /// Copies the DB as saved (before the change about to be committed) to `backups/` when the
    /// last backup is [`BACKUP_EVERY_SECS`] old. Never fails the mutation: problems go to stderr.
    fn backup_if_due(&mut self, now: u64) {
        if now.saturating_sub(self.last_backup) < BACKUP_EVERY_SECS {
            return;
        }
        self.last_backup = now; // also after a failure: retry in a day, not on every change
        let dir = self.data_dir.join(BACKUP_DIR);
        match serialize(&self.db).and_then(|bytes| write_backup(&dir, &bytes, now)) {
            Ok(_) => {
                for warning in prune_backups(&dir, KEEP_BACKUPS) {
                    eprintln!("warning: {warning}");
                }
            }
            Err(e) => eprintln!(
                "warning: could not write a backup to {}: {e}",
                dir.display()
            ),
        }
    }

    /// Gives `draft` the next version, saves it, and only then swaps it in. Returns the
    /// previous DB. Takes the periodic backup first (see [`BACKUP_EVERY_SECS`]).
    fn commit(&mut self, mut draft: Db) -> Result<Db, ApiError> {
        self.backup_if_due(unix_now());
        draft.version = self.db.version + 1;
        draft.schema_version = SCHEMA_VERSION;
        save(&self.data_dir, &draft).map_err(|e| {
            ApiError::internal(format!(
                "could not save {}: {e}",
                self.data_dir.join(DB_FILE).display()
            ))
        })?;
        Ok(std::mem::replace(&mut self.db, draft))
    }
}

/// Parses `db.json` bytes: JSON → schema check → migrations → [`Db`]. Returns whether a
/// migration ran (the caller then re-saves). Repairs `next_id` if it lags behind the ids in use.
fn parse_db(bytes: &[u8], path: &Path) -> Result<(Db, bool), OpenError> {
    let file = path.display();
    let backups = path.with_file_name(BACKUP_DIR);
    let backups = backups.display();
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes); // UTF-8 BOM
    let value: Value = serde_json::from_slice(bytes).map_err(|e| {
        OpenError(format!(
            "{file} is not valid JSON ({e}). Refusing to start so it is not overwritten: \
             fix the file or restore a copy from {backups}."
        ))
    })?;
    let schema = value
        .get("schema_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            OpenError(format!(
                "{file} has no numeric \"schema_version\"; it is not a grocery DB this server \
                 can read. Fix it or restore a copy from {backups}."
            ))
        })?;
    if schema > SCHEMA_VERSION {
        return Err(OpenError(format!(
            "{file} has schema_version {schema}, but this server only understands up to \
             {SCHEMA_VERSION}: it was written by a newer version of the app. Run the newer \
             server, or restore an older copy from {backups}."
        )));
    }
    let value = migrate(value, schema).map_err(|e| OpenError(format!("{file}: {e}")))?;
    let mut db: Db = serde_json::from_value(value).map_err(|e| {
        OpenError(format!(
            "{file} has invalid data ({e}). Fix it or restore a copy from {backups}."
        ))
    })?;
    db.schema_version = SCHEMA_VERSION;
    db.next_id = db.next_id.max(db.max_id() + 1);
    Ok((db, schema != SCHEMA_VERSION))
}

/// Upgrades a parsed document from schema `from` to [`SCHEMA_VERSION`], one step at a time.
/// When the schema changes: bump `SCHEMA_VERSION` and add an arm per old version, e.g.
/// `1 => migrate(v1_to_v2(value)?, 2)`.
fn migrate(value: Value, from: u64) -> Result<Value, String> {
    match from {
        SCHEMA_VERSION => Ok(value),
        _ => Err(format!(
            "schema_version {from} is not supported (this server reads {SCHEMA_VERSION})"
        )),
    }
}

/// Writes the DB to `db.json.tmp`, flushes it to disk, then renames it over `db.json`
/// (`std::fs::rename` replaces the target on Windows too). On failure `db.json` is untouched
/// and the temp file is removed.
fn save(data_dir: &Path, db: &Db) -> io::Result<()> {
    let bytes = serialize(db)?;
    let tmp = data_dir.join(TMP_FILE);
    let result =
        write_synced(&tmp, &bytes).and_then(|()| rename_retrying(&tmp, &data_dir.join(DB_FILE)));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// `db.json`'s exact bytes for `db`: pretty JSON plus a newline (backups are byte-identical).
fn serialize(db: &Db) -> io::Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(db)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn write_synced(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// On Windows a virus scanner or search indexer can hold `db.json` open for a moment, making the
/// rename fail with "access denied"; retry briefly before giving up.
fn rename_retrying(from: &Path, to: &Path) -> io::Result<()> {
    let mut attempt = 0;
    loop {
        match fs::rename(from, to) {
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied && attempt < 5 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(20 * attempt));
            }
            result => return result,
        }
    }
}

/// Writes `bytes` to `<dir>/db-<now>.json`, or `db-<now>-<n>.json` if that exists (several
/// starts within one second never overwrite each other).
fn write_backup(dir: &Path, bytes: &[u8], now: u64) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    for n in 0..1000 {
        let name = match n {
            0 => format!("db-{now}.json"),
            n => format!("db-{now}-{n}.json"),
        };
        let path = dir.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let written = file.write_all(bytes).and_then(|()| file.sync_all());
                if let Err(e) = written {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(e);
                }
                return Ok(path);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::other("too many backups within one second"))
}

/// Deletes all but the newest `keep` backups (by the time + counter in the name). Files that
/// don't look like our backups are never touched. Returns warnings for failed deletions.
fn prune_backups(dir: &Path, keep: usize) -> Vec<String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => return vec![format!("cannot list backups in {}: {e}", dir.display())],
    };
    let mut backups: Vec<((u64, u64), PathBuf)> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| Some((backup_key(e.file_name().to_str()?)?, e.path())))
        .collect();
    backups.sort_by(|a, b| b.0.cmp(&a.0));
    backups
        .into_iter()
        .skip(keep)
        .filter_map(|(_, path)| {
            fs::remove_file(&path)
                .err()
                .map(|e| format!("cannot delete old backup {}: {e}", path.display()))
        })
        .collect()
}

/// `db-<secs>.json` → `(secs, 0)`, `db-<secs>-<n>.json` → `(secs, n)`; anything else → `None`.
fn backup_key(file_name: &str) -> Option<(u64, u64)> {
    let stem = file_name.strip_prefix("db-")?.strip_suffix(".json")?;
    let (secs, n) = stem.split_once('-').unwrap_or((stem, "0"));
    let number = |s: &str| {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse::<u64>().ok()
    };
    Some((number(secs)?, number(n)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Id, Item, ListEntry, Source};
    use tempfile::TempDir;

    fn open(dir: &Path) -> (AppState, OpenReport) {
        AppState::open(dir, false).unwrap()
    }

    fn open_err(dir: &Path) -> String {
        match AppState::open(dir, false) {
            Ok(_) => panic!("expected an error"),
            Err(e) => e.0,
        }
    }

    fn db_on_disk(dir: &Path) -> Db {
        serde_json::from_slice(&fs::read(dir.join(DB_FILE)).unwrap()).unwrap()
    }

    fn backups(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir.join(BACKUP_DIR))
            .map(|rd| {
                rd.map(|e| e.unwrap().file_name().into_string().unwrap())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    fn add_item(db: &mut Db, name: &str) -> Id {
        let id = db.alloc_id();
        db.items.push(Item {
            id,
            name: name.into(),
            category_id: Some(1),
            aliases: vec![],
            staple: false,
            use_count: 0,
            last_used: 0,
        });
        id
    }

    fn put_on_list(db: &mut Db, item_id: Id) {
        db.list.entries.push(ListEntry {
            item_id,
            note: None,
            sources: vec![Source::Manual],
            added_at: 1,
        });
    }

    #[test]
    fn missing_file_creates_seeded_db_on_disk() {
        let dir = TempDir::new().unwrap();
        let data = dir.path().join("nested").join("data");
        let (state, report) = open(&data);
        assert!(report.created && !report.demo_seeded);
        assert_eq!(report.backup, None);
        assert_eq!(report.db_path, data.join(DB_FILE));
        let expected = Db::with_default_categories();
        assert_eq!(state.read(Db::clone), expected);
        assert_eq!(db_on_disk(&data), expected);
        assert!(!data.join(TMP_FILE).exists());
        assert!(backups(&data).is_empty());
        assert_eq!(state.version(), 0);
        assert_eq!(state.data_dir(), data);
    }

    #[test]
    fn demo_seeds_only_a_fresh_db() {
        let dir = TempDir::new().unwrap();
        let (state, report) = AppState::open(dir.path(), true).unwrap();
        assert!(report.created && report.demo_seeded);
        let items = state.read(|db| db.items.len());
        assert_eq!(items, demo::ITEMS.len());
        assert_eq!(db_on_disk(dir.path()).items.len(), demo::ITEMS.len());
        drop(state);

        // An existing (even empty-catalog) DB is never demo-seeded.
        let other = TempDir::new().unwrap();
        drop(open(other.path()));
        let (state, report) = AppState::open(other.path(), true).unwrap();
        assert!(!report.created && !report.demo_seeded);
        assert!(state.read(|db| db.items.is_empty()));
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = TempDir::new().unwrap();
        let (state, _) = AppState::open(dir.path(), true).unwrap();
        state
            .mutate(|db| {
                let id = add_item(db, "Crème fraîche 🥛");
                db.find_item_mut(id)?.aliases = vec!["Creme fraiche".into()];
                put_on_list(db, id);
                db.list.entries[0].note = Some("1 tub".into());
                Ok(())
            })
            .unwrap();
        let before = state.read(Db::clone);
        drop(state);

        let (state, report) = open(dir.path());
        assert!(!report.created);
        assert_eq!(state.read(Db::clone), before);
        assert_eq!(state.version(), 1);
    }

    #[test]
    fn mutate_bumps_version_saves_and_returns_snapshot() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        let (snapshot, id) = state.mutate(|db| Ok(add_item(db, "Milk"))).unwrap();
        assert_eq!(id, 12);
        assert_eq!(snapshot.version, 1);
        assert_eq!(snapshot.items[0].name, "Milk");
        assert_eq!(state.snapshot(), snapshot);
        let disk = db_on_disk(dir.path());
        assert_eq!(disk.version, 1);
        assert_eq!(disk.next_id, 13);
        assert_eq!(disk.items[0].name, "Milk");
        // Atomic save leaves no temp file behind.
        assert!(!dir.path().join(TMP_FILE).exists());

        let (snapshot, ()) = state.mutate(|_| Ok(())).unwrap();
        assert_eq!(snapshot.version, 2);
    }

    #[test]
    fn closure_cannot_tamper_with_version() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        let (snapshot, ()) = state
            .mutate(|db| {
                db.version = 1000;
                db.schema_version = 99;
                Ok(())
            })
            .unwrap();
        assert_eq!(snapshot.version, 1);
        assert_eq!(state.read(|db| db.schema_version), SCHEMA_VERSION);
    }

    #[test]
    fn failed_mutation_changes_nothing_and_writes_nothing() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        let before = state.read(Db::clone);
        // Replace the file with a sentinel: any write would overwrite it.
        fs::write(dir.path().join(DB_FILE), "sentinel").unwrap();

        let err = state
            .mutate(|db| {
                add_item(db, "Milk");
                db.categories.clear();
                Err::<(), _>(ApiError::conflict("nope"))
            })
            .unwrap_err();

        assert_eq!(err, ApiError::conflict("nope"));
        assert_eq!(state.read(Db::clone), before);
        assert_eq!(
            fs::read_to_string(dir.path().join(DB_FILE)).unwrap(),
            "sentinel"
        );
        assert!(!dir.path().join(TMP_FILE).exists());
    }

    #[test]
    fn failed_save_rolls_back_and_is_internal_error() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        state.mutate(|db| Ok(add_item(db, "Milk"))).unwrap();
        let before = state.read(Db::clone);
        let on_disk = fs::read(dir.path().join(DB_FILE)).unwrap();
        // A directory where the temp file should go makes the save fail.
        fs::create_dir(dir.path().join(TMP_FILE)).unwrap();

        let err = state.mutate(|db| Ok(add_item(db, "Eggs"))).unwrap_err();

        assert!(matches!(err, ApiError::Internal(_)), "{err:?}");
        assert!(err.message().contains("could not save"), "{err}");
        assert_eq!(state.read(Db::clone), before);
        assert_eq!(fs::read(dir.path().join(DB_FILE)).unwrap(), on_disk);

        // Once the obstacle is gone, saving works and the version continues from memory.
        fs::remove_dir(dir.path().join(TMP_FILE)).unwrap();
        let (snapshot, _) = state.mutate(|db| Ok(add_item(db, "Eggs"))).unwrap();
        assert_eq!(snapshot.version, 2);
        assert_eq!(db_on_disk(dir.path()).items.len(), 2);
    }

    #[test]
    fn panicking_closure_leaves_state_usable() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        let clone = state.clone();
        let result = std::thread::spawn(move || {
            let _ = clone.mutate(|db| -> Result<(), ApiError> {
                db.items.clear();
                panic!("boom");
            });
        })
        .join();
        assert!(result.is_err());
        assert_eq!(state.version(), 0);
        assert_eq!(state.mutate(|_| Ok(())).unwrap().0.version, 1);
    }

    #[test]
    fn concurrent_mutations_are_serialized() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        let threads: Vec<_> = (0..8)
            .map(|t| {
                let state = state.clone();
                std::thread::spawn(move || {
                    for i in 0..5 {
                        state
                            .mutate(|db| Ok(add_item(db, &format!("Item {t}-{i}"))))
                            .unwrap();
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(state.version(), 40);
        let disk = db_on_disk(dir.path());
        assert_eq!(disk.items.len(), 40);
        assert_eq!(disk.consistency_problems(), Vec::<String>::new());
    }

    #[test]
    fn existing_file_is_backed_up_verbatim() {
        let dir = TempDir::new().unwrap();
        drop(open(dir.path()));
        let original = fs::read(dir.path().join(DB_FILE)).unwrap();

        let (_, report) = open(dir.path());

        let backup = report.backup.expect("backup made");
        assert_eq!(backup.parent().unwrap(), dir.path().join(BACKUP_DIR));
        let name = backup.file_name().unwrap().to_str().unwrap();
        assert!(backup_key(name).is_some(), "{name}");
        assert_eq!(fs::read(&backup).unwrap(), original);
        assert!(report.warnings.is_empty());
    }

    #[test]
    fn startup_backups_keep_the_newest_ten() {
        let dir = TempDir::new().unwrap();
        drop(open(dir.path()));
        for _ in 0..13 {
            drop(open(dir.path()));
        }
        // 13 starts within ~a second: suffixed names, none overwritten, 10 kept.
        assert_eq!(backups(dir.path()).len(), KEEP_BACKUPS);
    }

    #[test]
    fn a_running_server_backs_up_before_the_first_change_of_a_new_day() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path()); // fresh DB: no backup
        state.mutate(|db| Ok(add_item(db, "Milk"))).unwrap();
        assert!(backups(dir.path()).is_empty(), "not due yet");

        // A day later (the clock is the last backup's time): the next change first copies the
        // DB as saved, then goes through.
        let saved = fs::read(dir.path().join(DB_FILE)).unwrap();
        state.lock().last_backup -= BACKUP_EVERY_SECS;
        state.mutate(|db| Ok(add_item(db, "Eggs"))).unwrap();
        let names = backups(dir.path());
        assert_eq!(names.len(), 1);
        let backup = fs::read(dir.path().join(BACKUP_DIR).join(&names[0])).unwrap();
        assert_eq!(
            backup, saved,
            "the backup is the DB before the change, byte for byte"
        );
        assert_eq!(db_on_disk(dir.path()).items.len(), 2);

        // Not again on the same day.
        state.mutate(|db| Ok(add_item(db, "Bread"))).unwrap();
        assert_eq!(backups(dir.path()).len(), 1);
    }

    #[test]
    fn a_failed_running_backup_never_blocks_the_change() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        // A *file* named like the backups dir: creating backups/ fails.
        fs::write(dir.path().join(BACKUP_DIR), b"not a dir").unwrap();
        state.lock().last_backup = 0;
        state.mutate(|db| Ok(add_item(db, "Milk"))).unwrap();
        assert_eq!(db_on_disk(dir.path()).items.len(), 1);
        assert_eq!(state.version(), 1);
    }

    #[test]
    fn backups_in_the_same_second_get_suffixes() {
        let dir = TempDir::new().unwrap();
        let a = write_backup(dir.path(), b"a", 100).unwrap();
        let b = write_backup(dir.path(), b"b", 100).unwrap();
        let c = write_backup(dir.path(), b"c", 100).unwrap();
        assert_eq!(a.file_name().unwrap(), "db-100.json");
        assert_eq!(b.file_name().unwrap(), "db-100-1.json");
        assert_eq!(c.file_name().unwrap(), "db-100-2.json");
        assert_eq!(fs::read(&a).unwrap(), b"a");
        assert_eq!(fs::read(&b).unwrap(), b"b");
    }

    #[test]
    fn prune_keeps_newest_by_name_and_ignores_other_files() {
        let dir = TempDir::new().unwrap();
        for t in 1..=12 {
            write_backup(dir.path(), b"x", t).unwrap();
        }
        write_backup(dir.path(), b"x", 12).unwrap(); // db-12-1.json is the newest
        for other in [
            "notes.txt",
            "db-abc.json",
            "db-5-x.json",
            "db-+7.json",
            "my-db.json",
        ] {
            fs::write(dir.path().join(other), "keep me").unwrap();
        }
        fs::create_dir(dir.path().join("db-1.json.d")).unwrap();

        let warnings = prune_backups(dir.path(), 10);

        assert!(warnings.is_empty(), "{warnings:?}");
        let mut left: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        let mut expected: Vec<String> = (4..=12).map(|t| format!("db-{t}.json")).collect();
        expected.push("db-12-1.json".into());
        for other in [
            "notes.txt",
            "db-abc.json",
            "db-5-x.json",
            "db-+7.json",
            "my-db.json",
        ] {
            expected.push(other.into());
        }
        expected.push("db-1.json.d".into());
        expected.sort();
        assert_eq!(left, expected);
    }

    #[test]
    fn backup_key_parsing() {
        assert_eq!(backup_key("db-1760650000.json"), Some((1_760_650_000, 0)));
        assert_eq!(backup_key("db-5-3.json"), Some((5, 3)));
        assert_eq!(backup_key("db-.json"), None);
        assert_eq!(backup_key("db-5-.json"), None);
        assert_eq!(backup_key("db-+5.json"), None);
        assert_eq!(backup_key("db-5.json.tmp"), None);
        assert_eq!(backup_key("xdb-5.json"), None);
    }

    #[test]
    fn corrupt_json_is_a_hard_error_and_file_is_untouched() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join(DB_FILE), "{ \"schema_version\": 1, oops").unwrap();

        let err = open_err(dir.path());

        assert!(
            err.contains(&dir.path().join(DB_FILE).display().to_string()),
            "{err}"
        );
        assert!(err.contains("not valid JSON"), "{err}");
        assert_eq!(
            fs::read_to_string(dir.path().join(DB_FILE)).unwrap(),
            "{ \"schema_version\": 1, oops"
        );
        assert!(
            backups(dir.path()).is_empty(),
            "broken files are not backed up"
        );
    }

    #[test]
    fn empty_file_is_corrupt_not_fresh() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join(DB_FILE), "").unwrap();
        assert!(open_err(dir.path()).contains("not valid JSON"));
        assert_eq!(fs::read(dir.path().join(DB_FILE)).unwrap(), b"");
    }

    #[test]
    fn newer_schema_is_a_hard_error() {
        let dir = TempDir::new().unwrap();
        let doc = r#"{"schema_version": 2, "version": 1, "something_new": true}"#;
        fs::write(dir.path().join(DB_FILE), doc).unwrap();

        let err = open_err(dir.path());

        assert!(err.contains("schema_version 2"), "{err}");
        assert!(err.contains("newer version"), "{err}");
        assert_eq!(fs::read_to_string(dir.path().join(DB_FILE)).unwrap(), doc);
        assert!(backups(dir.path()).is_empty());
    }

    #[test]
    fn missing_or_unsupported_schema_and_bad_data_are_errors() {
        for (doc, expected) in [
            (r#"{"version": 1}"#, "no numeric \"schema_version\""),
            (r#"[1, 2]"#, "no numeric \"schema_version\""),
            (
                r#"{"schema_version": "1"}"#,
                "no numeric \"schema_version\"",
            ),
            (
                r#"{"schema_version": 0}"#,
                "schema_version 0 is not supported",
            ),
            (r#"{"schema_version": 1, "items": 5}"#, "invalid data"),
        ] {
            let dir = TempDir::new().unwrap();
            fs::write(dir.path().join(DB_FILE), doc).unwrap();
            let err = open_err(dir.path());
            assert!(err.contains(expected), "{doc}: {err}");
            assert_eq!(fs::read_to_string(dir.path().join(DB_FILE)).unwrap(), doc);
        }
    }

    #[test]
    fn utf8_bom_is_tolerated_and_next_id_repaired() {
        let dir = TempDir::new().unwrap();
        let mut db = Db::with_default_categories();
        db.next_id = 3; // lags behind category ids 1..=11
        let mut bytes = b"\xEF\xBB\xBF".to_vec();
        bytes.extend(serde_json::to_vec(&db).unwrap());
        fs::write(dir.path().join(DB_FILE), bytes).unwrap();

        let (state, _) = open(dir.path());

        assert_eq!(state.read(|db| db.next_id), 12);
        let (_, id) = state.mutate(|db| Ok(db.alloc_id())).unwrap();
        assert_eq!(id, 12);
    }

    #[test]
    fn unreadable_db_path_is_an_error() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(DB_FILE)).unwrap();
        assert!(open_err(dir.path()).contains("cannot read"));
    }

    #[test]
    fn undo_stack_is_capped_lifo() {
        let mut stack = UndoStack::default();
        assert!(stack.is_empty() && stack.pop().is_none());
        for i in 0..(UNDO_CAP as u64 + 10) {
            stack.push(List {
                entries: vec![],
                recipe_ids: vec![i],
            });
        }
        assert_eq!(stack.len(), UNDO_CAP);
        assert_eq!(stack.pop().unwrap().recipe_ids, [UNDO_CAP as u64 + 9]);
        assert_eq!(stack.pop().unwrap().recipe_ids, [UNDO_CAP as u64 + 8]);
        while stack.len() > 1 {
            stack.pop();
        }
        // The 10 oldest were dropped.
        assert_eq!(stack.pop().unwrap().recipe_ids, [10]);
        stack.push(List::default());
        stack.clear();
        assert!(stack.is_empty());
    }

    #[test]
    fn list_undo_records_only_successful_list_changes() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        let (_, milk) = state.mutate(|db| Ok(add_item(db, "Milk"))).unwrap();
        let (_, eggs) = state.mutate(|db| Ok(add_item(db, "Eggs"))).unwrap();
        assert_eq!(state.undo_depth(), 0);

        // Record + list changed → pushed.
        state
            .mutate_with(ListUndo::Record, |db| {
                put_on_list(db, milk);
                Ok(())
            })
            .unwrap();
        assert_eq!(state.undo_depth(), 1);
        // Record but list unchanged → not pushed.
        state
            .mutate_with(ListUndo::Record, |db| {
                db.find_item_mut(milk)?.use_count += 1;
                Ok(())
            })
            .unwrap();
        assert_eq!(state.undo_depth(), 1);
        // Failed mutation → not pushed.
        let _ = state.mutate_with(ListUndo::Record, |db| {
            put_on_list(db, eggs);
            Err::<(), _>(ApiError::bad_request("no"))
        });
        assert_eq!(state.undo_depth(), 1);
        // Keep leaves history alone even when the list changes.
        state
            .mutate(|db| {
                put_on_list(db, eggs);
                Ok(())
            })
            .unwrap();
        assert_eq!(state.undo_depth(), 1);

        // Undo restores the recorded (empty) list as a new version, saved to disk.
        let version = state.version();
        let snapshot = state.undo_list().unwrap();
        assert_eq!(snapshot.version, version + 1);
        assert!(snapshot.list.entries.is_empty());
        assert!(db_on_disk(dir.path()).list.entries.is_empty());
        assert_eq!(state.undo_depth(), 0);

        let err = state.undo_list().unwrap_err();
        assert_eq!(err, ApiError::conflict("nothing to undo"));
        assert_eq!(state.version(), version + 1);
    }

    #[test]
    fn list_undo_clear_and_failed_undo_save() {
        let dir = TempDir::new().unwrap();
        let (state, _) = open(dir.path());
        let (_, milk) = state.mutate(|db| Ok(add_item(db, "Milk"))).unwrap();
        for _ in 0..2 {
            state
                .mutate_with(ListUndo::Record, |db| {
                    db.list.entries.clear();
                    put_on_list(db, milk);
                    db.list.entries[0].note = Some(format!("v{}", db.version));
                    Ok(())
                })
                .unwrap();
        }
        assert_eq!(state.undo_depth(), 2);

        // A failed save during undo keeps the state undoable.
        fs::create_dir(dir.path().join(TMP_FILE)).unwrap();
        let before = state.read(Db::clone);
        assert!(matches!(state.undo_list(), Err(ApiError::Internal(_))));
        assert_eq!(state.undo_depth(), 2);
        assert_eq!(state.read(Db::clone), before);
        fs::remove_dir(dir.path().join(TMP_FILE)).unwrap();

        state.mutate_with(ListUndo::Clear, |_| Ok(())).unwrap();
        assert_eq!(state.undo_depth(), 0);
    }
}
