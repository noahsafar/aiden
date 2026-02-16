// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;
mod services;
mod utils;

use commands::{auth, gmail, ai, database, settings, fs, crm, chatbot, email_storage};
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
            ai::analyze_attachment_claude,
            ai::save_recipient_writing_style,
            ai::get_recipient_writing_style,
            ai::analyze_and_save_writing_style,
            ai::get_conversation_context_from_emails,
            ai::classify_email,
            ai::classify_contacts_batch,
            // Email persistence
            email_storage::persist_emails,
            email_storage::persist_sent_emails,
            email_storage::load_persisted_emails,
            email_storage::load_persisted_sent_emails,
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
            fs::get_indexed_folders,
            fs::update_indexed_folders,
            fs::search_files,
            fs::get_file_base64,
            fs::get_file_info,
            // CRM commands
            crm::extract_contacts_from_emails,
            crm::get_contacts,
            crm::get_contact,
            crm::update_contact_vip_status,
            crm::update_contact_notes,
            crm::get_contact_analytics,
            crm::get_network_data,
            crm::get_stale_contacts,
            crm::get_top_contacts,
            // Chatbot commands
            chatbot::process_chat_message,
            chatbot::save_reminder,
            chatbot::get_reminders,
            chatbot::delete_reminder,
            chatbot::get_due_reminders,
            chatbot::mark_reminder_triggered,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}