use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::process::ExitCode;

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

    if let Err(err) = std::fs::create_dir_all(&config.data_dir) {
        eprintln!(
            "error: cannot create data dir {}: {err}",
            config.data_dir.display()
        );
        return ExitCode::FAILURE;
    }

    // T2 seam: load/seed the store from `config.data_dir` (honouring `config.demo`) and pass the
    // resulting state into `app`.
    let app = rust_html_server::app(&config.static_dir);

    let listener = match tokio::net::TcpListener::bind(config.addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("error: cannot bind {}: {err}", config.addr);
            return ExitCode::FAILURE;
        }
    };
    let addr = listener.local_addr().unwrap_or(config.addr);

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
    println!("Data dir:   {}", config.data_dir.display());
    println!("Static dir: {}", config.static_dir.display());
    if config.demo {
        println!("Demo mode:  on");
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
