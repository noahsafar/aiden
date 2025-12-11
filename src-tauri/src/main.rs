// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;
mod services;
mod utils;

use commands::{auth, gmail, ai, database};
use services::storage::TokenStorage;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Register only the commands that exist
        .invoke_handler(tauri::generate_handler![
            // Auth commands
            auth::get_auth_url,
            auth::exchange_code_for_token,
            auth::refresh_token,
            // Gmail commands
            gmail::fetch_emails,
            gmail::send_email,
            gmail::get_profile,
            // AI commands
            ai::generate_reply,
            ai::summarize_email,
            // Database commands
            database::save_email,
            database::get_emails,
            database::update_email_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}