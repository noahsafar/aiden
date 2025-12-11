use tauri::command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub polling_interval_minutes: u64,
    pub enable_notifications: bool,
    pub enable_auto_reply: bool,
    pub auto_reply_delay_minutes: u64,
    pub urgent_keywords: Vec<String>,
    pub important_senders: Vec<String>,
    pub working_hours_start: String,
    pub working_hours_end: String,
    pub timezone: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            polling_interval_minutes: 5,
            enable_notifications: true,
            enable_auto_reply: false,
            auto_reply_delay_minutes: 30,
            urgent_keywords: vec![
                "urgent".to_string(),
                "emergency".to_string(),
                "asap".to_string(),
                "immediately".to_string(),
            ],
            important_senders: vec![],
            working_hours_start: "09:00".to_string(),
            working_hours_end: "17:00".to_string(),
            timezone: "UTC".to_string(),
        }
    }
}

#[command]
pub async fn get_settings() -> Result<AppSettings, String> {
    // For now, return default settings
    // In a real app, you'd load these from storage
    Ok(AppSettings::default())
}

#[command]
pub async fn save_settings(settings: AppSettings) -> Result<(), String> {
    // For now, just return success
    // In a real app, you'd save these to storage
    println!("Settings saved: {:?}", settings);
    Ok(())
}

#[command]
pub async fn update_polling_interval(interval_minutes: u64) -> Result<(), String> {
    // For now, just return success
    // In a real app, you'd update the background task
    println!("Polling interval updated to: {} minutes", interval_minutes);
    Ok(())
}