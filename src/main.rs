use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::process::ExitCode;

use rust_html_server::AppState;
use rust_html_server::config::{self, Command, USAGE};

#[tokio::main]
async fn main() -> ExitCode {
    let args = std::env::args_os()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned());
    let config = match config::parse(args, |key| std::env::var(key).ok()) {
        Ok(Command::Run(config)) => config,
        Ok(Command::Help) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(err) => {
            eprintln!("error: {err}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };

    // Bind before opening the store, so a second instance on a busy port fails without
    // touching the data dir (opening an existing DB writes a backup).
    let listener = match tokio::net::TcpListener::bind(config.addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("error: cannot bind {}: {err}", config.addr);
            return ExitCode::FAILURE;
        }
    };
    let addr = listener.local_addr().unwrap_or(config.addr);

    let (state, report) = match AppState::open(&config.data_dir, config.demo) {
        Ok(opened) => opened,
        Err(err) => {
            eprintln!("error: {err}");
            return ExitCode::FAILURE;
        }
    };
    for warning in &report.warnings {
        eprintln!("warning: {warning}");
    }
    let app = rust_html_server::app(state.clone(), &config.static_dir);

    println!("Listening on http://{addr}");
    if addr.ip().is_unspecified() {
        println!("  This computer: http://localhost:{}", addr.port());
        match lan_ip() {
            Some(ip) => println!(
                "  Phone (same Wi-Fi): http://{}",
                SocketAddr::new(ip, addr.port())
            ),
            None => println!("  Phone: could not detect this computer's LAN IP (try `ipconfig`)"),
        }
    }
    let db_status = if report.created {
        "new".to_string()
    } else {
        format!("loaded, version {}", state.version())
    };
    println!("Database:   {} ({db_status})", report.db_path.display());
    if let Some(backup) = &report.backup {
        println!("Backup:     {}", backup.display());
    }
    println!("Static dir: {}", config.static_dir.display());
    if config.demo {
        if report.demo_seeded {
            println!("Demo mode:  seeded the demo catalog");
        } else {
            println!("Demo mode:  skipped (demo data is only seeded into a new database)");
        }
    }

    if let Err(err) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        eprintln!("error: server failed: {err}");
        return ExitCode::FAILURE;
    }
    println!("Shut down cleanly.");
    ExitCode::SUCCESS
}

/// The LAN address other devices can reach. "Connecting" a UDP socket only selects a route and
/// local address; no packets are sent.
fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_unspecified() && !ip.is_loopback()).then_some(ip)
}

async fn shutdown_signal() {
    if tokio::signal::ctrl_c().await.is_err() {
        // No Ctrl+C handler available: run until killed.
        std::future::pending::<()>().await;
    }
    println!("Shutting down...");
}
