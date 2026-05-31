use axum::{Router, response::Html, routing::get};
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    // Build our application with a single route
    let app = Router::new().route("/", get(handler));

    // Define the address to listen on
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Server running on http://{}", addr);

    // Bind the listener to the address
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    // Start the server
    axum::serve(listener, app).await.unwrap();
}

// Our route handler returning an HTML response
async fn handler() -> Html<&'static str> {
    Html(
        r#"
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Hello World!</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f0f2f5;
                }
                .container {
                    text-align: center;
                    background: white;
                    padding: 3rem;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                h1 {
                    color: #333;
                    margin-top: 0;
                }
                p {
                    color: #666;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Hello, World! 🚀</h1>
                <p>Your Axum server is running successfully.</p>
            </div>
        </body>
        </html>
        "#,
    )
}
