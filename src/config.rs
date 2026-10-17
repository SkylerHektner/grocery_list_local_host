//! Runtime configuration from CLI flags and environment variables (SPEC §3.12).
//!
//! Parsing is a pure function over `(args, env lookup)` so it can be unit-tested without
//! touching the real process environment. Precedence: CLI flag > env var > default.

use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;

pub const DEFAULT_ADDR: &str = "0.0.0.0:3000";

pub const USAGE: &str = "\
Grocery list server

USAGE:
    rust_html_server [OPTIONS]

OPTIONS:
    --addr <IP:PORT>      Address to bind        [env: GROCERY_ADDR]       [default: 0.0.0.0:3000]
    --data-dir <PATH>     Where db.json lives    [env: GROCERY_DATA_DIR]   [default: <crate>/data]
    --static-dir <PATH>   Frontend files         [env: GROCERY_STATIC_DIR] [default: <crate>/public]
    --demo                Seed a demo catalog when the DB is fresh  [env: GROCERY_DEMO=1]
    -h, --help            Print this help

Flags win over env vars. Values may be given as `--flag value` or `--flag=value`.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    pub addr: SocketAddr,
    pub data_dir: PathBuf,
    pub static_dir: PathBuf,
    pub demo: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        Self {
            addr: DEFAULT_ADDR
                .parse()
                .expect("DEFAULT_ADDR is a valid socket address"),
            data_dir: crate_dir.join("data"),
            static_dir: crate_dir.join("public"),
            demo: false,
        }
    }
}

/// What `main` should do after parsing the command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Run(AppConfig),
    Help,
}

/// A user-facing configuration error. `main` prints it with [`USAGE`] and exits with code 2.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError(pub String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ConfigError {}

/// Parses CLI arguments (without the program name) and env vars via `env` lookup.
pub fn parse<I, F>(args: I, env: F) -> Result<Command, ConfigError>
where
    I: IntoIterator<Item = String>,
    F: Fn(&str) -> Option<String>,
{
    let mut addr: Option<String> = None;
    let mut data_dir: Option<String> = None;
    let mut static_dir: Option<String> = None;
    let mut demo = false;

    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let (flag, inline_value) = match arg.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => (flag.to_string(), Some(value)),
            _ => (arg.clone(), None),
        };
        match flag.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--demo" => {
                if inline_value.is_some() {
                    return Err(ConfigError("--demo does not take a value".into()));
                }
                demo = true;
            }
            "--addr" | "--data-dir" | "--static-dir" => {
                let value = match inline_value {
                    Some(v) => v.to_string(),
                    None => args
                        .next()
                        .ok_or_else(|| ConfigError(format!("{flag} requires a value")))?,
                };
                if value.is_empty() {
                    return Err(ConfigError(format!("{flag} requires a non-empty value")));
                }
                let slot = match flag.as_str() {
                    "--addr" => &mut addr,
                    "--data-dir" => &mut data_dir,
                    _ => &mut static_dir,
                };
                *slot = Some(value);
            }
            _ => return Err(ConfigError(format!("unknown argument: {arg}"))),
        }
    }

    let defaults = AppConfig::default();
    let non_empty_env = |key: &str| env(key).filter(|v| !v.trim().is_empty());

    let addr = match addr.or_else(|| non_empty_env("GROCERY_ADDR")) {
        Some(raw) => raw.trim().parse::<SocketAddr>().map_err(|_| {
            ConfigError(format!(
                "invalid address {raw:?}: expected IP:PORT, e.g. 127.0.0.1:3999"
            ))
        })?,
        None => defaults.addr,
    };
    let data_dir = data_dir
        .or_else(|| non_empty_env("GROCERY_DATA_DIR"))
        .map_or(defaults.data_dir, PathBuf::from);
    let static_dir = static_dir
        .or_else(|| non_empty_env("GROCERY_STATIC_DIR"))
        .map_or(defaults.static_dir, PathBuf::from);
    if !demo {
        demo = match env("GROCERY_DEMO") {
            None => false,
            Some(v) => parse_bool(&v).ok_or_else(|| {
                ConfigError(format!("invalid GROCERY_DEMO value {v:?}: use 1 or 0"))
            })?,
        };
    }

    Ok(Command::Run(AppConfig {
        addr,
        data_dir,
        static_dir,
        demo,
    }))
}

fn parse_bool(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "" | "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn run(args: &[&str], env: &[(&str, &str)]) -> Result<Command, ConfigError> {
        let env: HashMap<String, String> = env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        parse(args.iter().map(|s| s.to_string()), |k| env.get(k).cloned())
    }

    fn config(args: &[&str], env: &[(&str, &str)]) -> AppConfig {
        match run(args, env) {
            Ok(Command::Run(c)) => c,
            other => panic!("expected Run, got {other:?}"),
        }
    }

    #[test]
    fn defaults_when_nothing_given() {
        let c = config(&[], &[]);
        let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        assert_eq!(c.addr, "0.0.0.0:3000".parse().unwrap());
        assert_eq!(c.data_dir, crate_dir.join("data"));
        assert_eq!(c.static_dir, crate_dir.join("public"));
        assert!(!c.demo);
        assert_eq!(c, AppConfig::default());
    }

    #[test]
    fn flags_with_separate_values() {
        let c = config(
            &[
                "--addr",
                "127.0.0.1:3999",
                "--data-dir",
                "target/dev-data",
                "--static-dir",
                "web",
                "--demo",
            ],
            &[],
        );
        assert_eq!(c.addr, "127.0.0.1:3999".parse().unwrap());
        assert_eq!(c.data_dir, PathBuf::from("target/dev-data"));
        assert_eq!(c.static_dir, PathBuf::from("web"));
        assert!(c.demo);
    }

    #[test]
    fn flags_with_equals_values() {
        let c = config(&["--addr=127.0.0.1:4000", "--data-dir=a=b"], &[]);
        assert_eq!(c.addr, "127.0.0.1:4000".parse().unwrap());
        assert_eq!(c.data_dir, PathBuf::from("a=b"));
    }

    #[test]
    fn env_vars_used_when_no_flags() {
        let c = config(
            &[],
            &[
                ("GROCERY_ADDR", "127.0.0.1:5000"),
                ("GROCERY_DATA_DIR", "/tmp/d"),
                ("GROCERY_STATIC_DIR", "/tmp/s"),
                ("GROCERY_DEMO", "1"),
            ],
        );
        assert_eq!(c.addr, "127.0.0.1:5000".parse().unwrap());
        assert_eq!(c.data_dir, PathBuf::from("/tmp/d"));
        assert_eq!(c.static_dir, PathBuf::from("/tmp/s"));
        assert!(c.demo);
    }

    #[test]
    fn flags_win_over_env() {
        let c = config(
            &["--addr", "127.0.0.1:1", "--data-dir", "flag-data"],
            &[
                ("GROCERY_ADDR", "127.0.0.1:2"),
                ("GROCERY_DATA_DIR", "env-data"),
                ("GROCERY_STATIC_DIR", "env-static"),
            ],
        );
        assert_eq!(c.addr, "127.0.0.1:1".parse().unwrap());
        assert_eq!(c.data_dir, PathBuf::from("flag-data"));
        assert_eq!(c.static_dir, PathBuf::from("env-static"));
    }

    #[test]
    fn demo_env_values() {
        assert!(!config(&[], &[("GROCERY_DEMO", "0")]).demo);
        assert!(!config(&[], &[("GROCERY_DEMO", "")]).demo);
        assert!(config(&[], &[("GROCERY_DEMO", "true")]).demo);
        assert!(config(&["--demo"], &[("GROCERY_DEMO", "0")]).demo);
        assert!(run(&[], &[("GROCERY_DEMO", "maybe")]).is_err());
    }

    #[test]
    fn empty_env_values_fall_back_to_defaults() {
        let c = config(&[], &[("GROCERY_ADDR", " "), ("GROCERY_DATA_DIR", "")]);
        assert_eq!(c, AppConfig::default());
    }

    #[test]
    fn help() {
        assert_eq!(run(&["--help"], &[]), Ok(Command::Help));
        assert_eq!(run(&["--demo", "-h"], &[]), Ok(Command::Help));
    }

    #[test]
    fn errors() {
        let err = |args: &[&str]| run(args, &[]).unwrap_err().0;
        assert!(err(&["--bogus"]).contains("unknown argument: --bogus"));
        assert!(err(&["serve"]).contains("unknown argument: serve"));
        assert!(err(&["--addr"]).contains("--addr requires a value"));
        assert!(err(&["--data-dir="]).contains("non-empty"));
        assert!(err(&["--addr", "localhost"]).contains("invalid address"));
        assert!(err(&["--demo=1"]).contains("does not take a value"));
        assert!(
            run(&[], &[("GROCERY_ADDR", "nope")])
                .unwrap_err()
                .0
                .contains("invalid address")
        );
    }
}
