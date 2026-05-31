use axum::Router;
use std::net::SocketAddr;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    // Serve the "public" directory for any unhandled routes
    // (This automatically looks for `index.html` at the root!)
    let app = Router::new().fallback_service(ServeDir::new("public"));

    // Define the address to listen on
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Server running on http://{}", addr);

    // Bind the listener to the address
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    // Start the server
    axum::serve(listener, app).await.unwrap();
}
