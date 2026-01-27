// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;
mod services;
mod utils;

use commands::{auth, gmail, ai, database, settings, fs};
use services::storage::TokenStorage;
use services::system_tray::SystemTrayService;
use services::background_email::BackgroundEmailService;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Note: Notification plugin is loaded via Cargo.toml
            // We use emit() for background notifications which frontend handles

            // Initialize token storage
            let token_storage = TokenStorage::new(app.handle().clone());
            app.manage(token_storage);

            // Start background email service
            let bg_service = BackgroundEmailService::new(app.handle().clone());
            app.manage(bg_service.clone());

            // Clone for the background task
            let bg_service_spawn = bg_service.clone();

            // Spawn background service startup
            tauri::async_runtime::spawn(async move {
                // Wait a bit for the app to fully initialize
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                bg_service_spawn.start().await;
            });

            // Handle window close event - hide to tray instead of quitting
            let window = app.get_webview_window("main").unwrap();
            let window_for_event = window.clone();

            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Prevent the window from closing, hide it instead
                    api.prevent_close();
                    let _ = window_for_event.hide();
                }
                _ => {}
            });

            // Build system tray after setup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Create system tray
                match SystemTrayService::create_system_tray(&app_handle).await {
                    Ok(_tray) => {
                        println!("System tray created successfully");
                    }
                    Err(e) => {
                        eprintln!("Failed to create system tray: {}", e);
                    }
                }
            });

            // Handle tray icon events
            let app_handle_for_tray = app.handle().clone();
            app.on_tray_icon_event(move |app, event| {
                let tray_service = SystemTrayService::new(app_handle_for_tray.clone());
                tray_service.handle_event(app, &event);
            });

            // Handle menu events (for tray menu clicks)
            let app_handle_for_menu = app.handle().clone();
            app.on_menu_event(move |app, event| {
                let tray_service = SystemTrayService::new(app_handle_for_menu.clone());
                let id = event.id().0.clone();
                tray_service.handle_menu_item(app, &id);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth commands
            auth::get_auth_url,
            auth::exchange_code_for_token,
            auth::refresh_token,
            // Gmail commands
            gmail::fetch_emails,
            gmail::send_email,
            gmail::get_profile,
            gmail::mark_email_as_read,
            // AI commands
            ai::generate_reply,
            ai::summarize_email,
            ai::analyze_email_claude,
            ai::generate_reply_claude,
            ai::edit_reply_claude,
            // Database commands
            database::save_email,
            database::get_emails,
            database::update_email_status,
            // Settings commands
            settings::start_oauth_server,
            settings::check_oauth_server_running,
            settings::proxy_generate_reply,
            settings::proxy_analyze_email,
            settings::check_server_health,
            settings::get_settings,
            settings::save_settings,
            settings::should_send_notification,
            // File system commands
            fs::write_file,
            fs::read_file,
            fs::get_downloads_path,
            fs::get_platform,
            fs::open_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
