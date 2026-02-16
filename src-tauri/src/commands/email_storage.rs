use serde::{Deserialize, Serialize};
use tauri::command;
use std::path::PathBuf;

// Lightweight email struct for persistence - mirrors the frontend Email interface
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredEmail {
    pub id: String,
    pub gmail_id: String,
    pub thread_id: String,
    pub subject: String,
    pub sender: String,
    pub recipients: String,
    pub date: String,
    pub body_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_html: Option<String>,
    pub snippet: String,
    pub is_read: bool,
    pub is_starred: bool,
    pub has_attachments: bool,
    #[serde(default)]
    pub attachments: Vec<serde_json::Value>,
    pub status: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_points: Option<Vec<String>>,
    #[serde(default)]
    pub requires_reply: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_generated_reply: Option<String>,
    // Labels for Gmail
    #[serde(default)]
    pub labels: Vec<String>,
    // Catch-all for other fields we don't want to lose
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn get_emails_path() -> PathBuf {
    let app_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    let app_dir = app_dir.join("aiden");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("emails.json")
}

fn get_sent_emails_path() -> PathBuf {
    let app_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    let app_dir = app_dir.join("aiden");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("sent_emails.json")
}

#[command]
pub async fn persist_emails(emails: Vec<serde_json::Value>) -> Result<(), String> {
    let path = get_emails_path();
    let json = serde_json::to_string(&emails)
        .map_err(|e| format!("Failed to serialize emails: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write emails to disk: {}", e))?;
    Ok(())
}

#[command]
pub async fn persist_sent_emails(emails: Vec<serde_json::Value>) -> Result<(), String> {
    let path = get_sent_emails_path();
    let json = serde_json::to_string(&emails)
        .map_err(|e| format!("Failed to serialize sent emails: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write sent emails to disk: {}", e))?;
    Ok(())
}

#[command]
pub async fn load_persisted_emails() -> Result<Vec<serde_json::Value>, String> {
    let path = get_emails_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read emails from disk: {}", e))?;
    let emails: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse persisted emails: {}", e))?;
    Ok(emails)
}

#[command]
pub async fn load_persisted_sent_emails() -> Result<Vec<serde_json::Value>, String> {
    let path = get_sent_emails_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read sent emails from disk: {}", e))?;
    let emails: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse persisted sent emails: {}", e))?;
    Ok(emails)
}
