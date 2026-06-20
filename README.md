 ```markdown
   # Rust HTML Server - Grocery List Builder App

   A simple RESTful web server written in Rust, serving an HTML/CSS/JS grocery list builder
 application.

   ## Project Structure
   The project follows a clean, minimal layout:
 ```

 .
 ├── Cargo.toml                # Dependencies and build configuration
 ├── src/
 │   └── main.rs             # Main entrypoint for the Rust server
 └── public/
     ├── index.html           # Main HTML template
     ├── styles.css          # CSS styling
     └── scripts.js         # JavaScript frontend logic

 ```
   ## How It Works

   ### Server Architecture
   - Built using **axum** and **tokio**
   - REST routes are defined in `src/main.rs`
   - Routes map to request handlers that serve the HTML assets, respond to API requests

   ### Data Handling
   - User data (grocery items) is stored as simple Rust Object Notation (RON)
   - Simple key-value storage for demonstration purposes
 ```

 Development

 We aim to keep things simple, clean, and maintainable. The project follows these principles:

 - Minimal dependencies
 - Simplicity over complexity
 - Clean code organization
 - Consistent formatting (Rustfmt)

 Code Style

 - Follow Rust style conventions
 - Keep functions and modules small
 - Document everything worth documenting
 - Minimize boilerplate
 - Use meaningful variable names
 - Keep everything simple and stupid until it has to be complex
 - Don't add dependencies unless there is a very, very good reason to