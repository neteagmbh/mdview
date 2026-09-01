#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

/// Starts the mdview desktop application.
fn main() {
    mdview_lib::run();
}
