// Notification service - temporarily disabled
// TODO: Re-enable notification plugin when needed

use tauri::{AppHandle, Manager};
use crate::commands::gmail::Email;

pub struct NotificationService {
    app_handle: AppHandle,
}

impl NotificationService {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub async fn send_email_notification(&self, email: &Email) -> Result<(), Box<dyn std::error::Error>> {
        // TODO: Implement notification when plugin is added
        let notification_title = format!("📧 New Email: {}", email.subject);
        println!("Notification: {} - From: {}", notification_title, email.sender);
        Ok(())
    }

    pub async fn send_summary_notification(&self, count: usize, urgent_count: usize) -> Result<(), Box<dyn std::error::Error>> {
        let title = if urgent_count > 0 {
            format!("📧 {} new emails ({} urgent)", count, urgent_count)
        } else {
            format!("📧 {} new emails", count)
        };

        let body = if urgent_count > 0 {
            "You have urgent emails that need your attention"
        } else {
            "You have new emails to review"
        };

        // TODO: Implement notification when plugin is added
        println!("Notification: {} - {}", title, body);
        Ok(())
    }

    pub async fn send_ai_reply_notification(&self, email: &Email) -> Result<(), Box<dyn std::error::Error>> {
        // TODO: Implement notification when plugin is added
        println!("🤖 AI Reply Generated for: {}", email.subject);
        Ok(())
    }
}

#[tauri::command]
pub async fn send_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    println!("Notification: {} - {}", title, body);
    Ok(())
}