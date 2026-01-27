// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;
mod services;
mod utils;

use commands::{auth, gmail, ai, database, settings, fs, crm};
use services::storage::TokenStorage;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
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
            // CRM commands
            crm::get_contacts,
            crm::get_contact,
            crm::update_contact,
            crm::get_contact_insights,
            crm::get_all_contact_insights,
            crm::get_threads,
            crm::get_thread,
            crm::update_thread_status,
            crm::get_thread_health_summary,
            crm::get_follow_up_reminders,
            crm::create_follow_up_reminder,
            crm::complete_reminder,
            crm::snooze_reminder,
            crm::get_reminder_suggestions,
            crm::get_email_templates,
            crm::get_template,
            crm::create_template,
            crm::update_template,
            crm::delete_template,
            crm::get_best_time_to_contact,
            crm::get_suggested_actions,
            crm::dismiss_suggested_action,
            crm::complete_suggested_action,
            crm::sync_thread_from_email,
            crm::sync_contact_from_email,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
