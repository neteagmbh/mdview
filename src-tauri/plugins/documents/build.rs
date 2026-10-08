/// Links the native iOS document-provider implementation into the application.
fn main() {
    tauri_plugin::Builder::new(&[]).ios_path("ios").build();
}
