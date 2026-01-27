use tauri::{AppHandle, Emitter, Manager};
use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Duration;
use chrono::{DateTime, Utc, Timelike};

use crate::commands::settings::AppSettings;
use crate::commands::gmail::{Email, fetch_emails};
use crate::commands::ai::{EmailClassification, EmailSummary, classify_email, summarize_email};
use crate::commands::auth::AuthToken;

/// Represents a pending notification in the batch queue
#[derive(Debug, Clone)]
struct PendingNotification {
    email_id: String,
    subject: String,
    sender: String,
    category: String,
    requires_reply: bool,
    queued_at: DateTime<Utc>,
}

/// Background email service that polls, analyzes, and notifies
#[derive(Clone)]
pub struct BackgroundEmailService {
    app_handle: AppHandle,
    is_running: Arc<Mutex<bool>>,
    notification_queue: Arc<Mutex<Vec<PendingNotification>>>,
    last_history_id: Arc<Mutex<Option<String>>>,
}

impl BackgroundEmailService {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            is_running: Arc::new(Mutex::new(false)),
            notification_queue: Arc::new(Mutex::new(Vec::new())),
            last_history_id: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the background email polling service
    pub async fn start(&self) {
        let mut running = self.is_running.lock().await;
        if *running {
            println!("[BackgroundEmailService] Already running");
            return;
        }
        *running = true;
        drop(running);

        println!("[BackgroundEmailService] Starting background email service");

        // Spawn the main polling task
        let app_handle = self.app_handle.clone();
        let is_running = self.is_running.clone();
        let notification_queue = self.notification_queue.clone();
        let last_history_id = self.last_history_id.clone();

        tokio::spawn(async move {
            // Initial delay before first poll
            tokio::time::sleep(Duration::from_secs(5)).await;

            loop {
                // Check if we should stop
                {
                    let running = is_running.lock().await;
                    if !*running {
                        println!("[BackgroundEmailService] Stopping polling loop");
                        break;
                    }
                }

                // Load settings
                let settings = match Self::load_settings().await {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("[BackgroundEmailService] Failed to load settings: {}", e);
                        tokio::time::sleep(Duration::from_secs(60)).await;
                        continue;
                    }
                };

                // Only proceed if notifications are enabled
                if !settings.enable_notifications {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    continue;
                }

                // Get access token
                let token = match Self::get_access_token().await {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("[BackgroundEmailService] Failed to get token: {}", e);
                        tokio::time::sleep(Duration::from_secs(60)).await;
                        continue;
                    }
                };

                // Check for new emails
                match Self::check_for_new_emails(
                    app_handle.clone(),
                    token,
                    settings.clone(),
                    last_history_id.clone(),
                    notification_queue.clone(),
                ).await {
                    Ok(_) => {},
                    Err(e) => {
                        eprintln!("[BackgroundEmailService] Error checking emails: {}", e);
                    }
                }

                // Check if batch notifications should be sent
                if settings.batch_notifications_enabled {
                    Self::check_and_send_batch_notifications(
                        app_handle.clone(),
                        notification_queue.clone(),
                        settings.batch_interval_minutes,
                    ).await;
                }

                // Poll every 30 seconds
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });

        // Spawn the batch notification checker task
        let app_handle = self.app_handle.clone();
        let notification_queue = self.notification_queue.clone();
        let is_running = self.is_running.clone();

        tokio::spawn(async move {
            loop {
                {
                    let running = is_running.lock().await;
                    if !*running {
                        break;
                    }
                }

                // Load current settings for batch interval
                let settings = match Self::load_settings().await {
                    Ok(s) => s,
                    Err(_) => {
                        tokio::time::sleep(Duration::from_secs(60)).await;
                        continue;
                    }
                };

                if settings.batch_notifications_enabled {
                    Self::check_and_send_batch_notifications(
                        app_handle.clone(),
                        notification_queue.clone(),
                        settings.batch_interval_minutes,
                    ).await;
                }

                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        });
    }

    /// Stop the background service
    pub async fn stop(&self) {
        let mut running = self.is_running.lock().await;
        *running = false;
        println!("[BackgroundEmailService] Stop requested");
    }

    /// Load settings from disk
    async fn load_settings() -> Result<AppSettings, String> {
        let app_dir = dirs::config_dir()
            .ok_or("Could not find config directory")?
            .join("aiden");

        let settings_file = app_dir.join("notification_settings.json");
        if settings_file.exists() {
            let content = std::fs::read_to_string(&settings_file)
                .map_err(|e| format!("Failed to read settings: {}", e))?;
            let settings: AppSettings = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse settings: {}", e))?;
            Ok(settings)
        } else {
            Ok(AppSettings::default())
        }
    }

    /// Get access token, refreshing if necessary
    async fn get_access_token() -> Result<String, String> {
        let app_dir = dirs::config_dir()
            .ok_or("Could not find config directory")?
            .join("aiden");

        let token_file = app_dir.join("auth_token.json");
        if !token_file.exists() {
            return Err("Not authenticated".to_string());
        }

        let content = std::fs::read_to_string(&token_file)
            .map_err(|e| format!("Failed to read token: {}", e))?;
        let token: AuthToken = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse token: {}", e))?;

        // Check if token needs refresh (simple heuristic: if we have a refresh token, use it)
        if let Some(refresh_token_value) = token.refresh_token {
            // For now, always try to refresh to ensure we have a valid token
            match crate::commands::auth::refresh_token(refresh_token_value).await {
                Ok(new_token) => {
                    // Save the new token
                    let new_content = serde_json::to_string_pretty(&new_token)
                        .map_err(|e| format!("Failed to serialize token: {}", e))?;
                    std::fs::write(&token_file, new_content)
                        .map_err(|e| format!("Failed to write token: {}", e))?;
                    return Ok(new_token.access_token);
                }
                Err(e) => {
                    eprintln!("[BackgroundEmailService] Failed to refresh token, trying existing: {}", e);
                }
            }
        }

        Ok(token.access_token)
    }

    /// Check for new emails and process them
    async fn check_for_new_emails(
        app_handle: AppHandle,
        access_token: String,
        settings: AppSettings,
        last_history_id: Arc<Mutex<Option<String>>>,
        notification_queue: Arc<Mutex<Vec<PendingNotification>>>,
    ) -> Result<(), String> {
        // Fetch recent emails
        let (emails, _) = fetch_emails(access_token, None).await?;

        // Process new emails (in a real app, we'd use Gmail's push notification or history ID)
        // For now, we'll process emails that don't have analysis yet
        for email in emails {
            // Skip if no body text
            if email.body_text.is_empty() {
                continue;
            }

            // Check if we should analyze this email (no summary yet)
            if email.summary.is_none() || email.summary.as_ref().map_or(false, |s| s.is_empty()) {
                println!("[BackgroundEmailService] Processing new email: {}", email.subject);

                // Analyze email
                match Self::analyze_email_background(
                    app_handle.clone(),
                    email.clone(),
                    settings.clone(),
                ).await {
                    Ok((classification, summary)) => {
                        // Check if we should notify
                        let (should_notify, should_batch, _reason) = Self::should_send_notification_internal(
                            email.sender.clone(),
                            email.subject.clone(),
                            classification.category.clone(),
                            settings.clone(),
                        ).await?;

                        if should_notify {
                            if should_batch {
                                // Add to batch queue
                                let pending = PendingNotification {
                                    email_id: email.id.clone(),
                                    subject: email.subject.clone(),
                                    sender: email.sender.clone(),
                                    category: classification.category.clone(),
                                    requires_reply: classification.requires_reply,
                                    queued_at: Utc::now(),
                                };
                                notification_queue.lock().await.push(pending);
                                println!("[BackgroundEmailService] Queued for batch notification: {}", email.subject);
                            } else {
                                // Send immediate notification
                                Self::send_notification(
                                    app_handle.clone(),
                                    &email.subject,
                                    &email.sender,
                                    &classification.category,
                                    Some(&summary.summary),
                                ).await?;
                                println!("[BackgroundEmailService] Sent immediate notification for: {}", email.subject);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[BackgroundEmailService] Failed to analyze email: {}", e);
                    }
                }
            }
        }

        Ok(())
    }

    /// Analyze an email in the background (classification + summary)
    async fn analyze_email_background(
        app_handle: AppHandle,
        email: Email,
        _settings: AppSettings,
    ) -> Result<(EmailClassification, EmailSummary), String> {
        // Prepare email content for analysis
        let email_content = format!("Subject: {}\n\nFrom: {}\n\n{}", email.subject, email.sender, email.body_text);

        // Classify email
        let classification = classify_email(
            email_content.clone(),
            email.sender.clone(),
            email.subject.clone(),
        ).await?;

        // Summarize email
        let summary = summarize_email(email_content, None).await?;

        // Emit event to frontend so UI can be updated
        let _ = app_handle.emit("email-analyzed", serde_json::json!({
            "email_id": email.id,
            "gmail_id": email.gmail_id,
            "classification": classification,
            "summary": summary,
        }));

        Ok((classification, summary))
    }

    /// Internal smart notification logic
    async fn should_send_notification_internal(
        sender: String,
        subject: String,
        category: String,
        settings: AppSettings,
    ) -> Result<(bool, bool, String), String> {
        let sender_lower = sender.to_lowercase();
        let subject_lower = subject.to_lowercase();
        let category_lower = category.to_lowercase();

        // Check for emergency keywords that bypass ALL settings
        for keyword in &settings.emergency_keywords {
            if subject_lower.contains(&keyword.to_lowercase())
                || sender_lower.contains(&keyword.to_lowercase()) {
                return Ok((true, false, format!("Emergency keyword: {}", keyword)));
            }
        }

        // Check quiet hours
        if settings.quiet_hours_enabled {
            if let (Ok(start), Ok(end)) = (
                settings.quiet_hours_start.parse::<f32>(),
                settings.quiet_hours_end.parse::<f32>(),
            ) {
                let now = Utc::now();
                // Use hour() and minute() which exist on DateTime<Utc>
                let current_hour = now.hour() as f32 + (now.minute() as f32 / 60.0);

                let in_quiet_hours = if start > end {
                    // Overnight period
                    current_hour >= start || current_hour < end
                } else {
                    current_hour >= start && current_hour < end
                };

                if in_quiet_hours {
                    // Only VIPs and urgent emails bypass quiet hours
                    let is_vip = settings.vip_senders.iter()
                        .any(|vip| sender_lower.contains(&vip.to_lowercase()));

                    if is_vip {
                        return Ok((true, false, "VIP during quiet hours".to_string()));
                    } else if category_lower == "urgent" {
                        return Ok((true, false, "Urgent during quiet hours".to_string()));
                    } else {
                        return Ok((false, true, "Quiet hours - batching".to_string()));
                    }
                }
            }
        }

        // Check VIP senders
        let is_vip = settings.vip_senders.iter()
            .any(|vip| sender_lower.contains(&vip.to_lowercase()));

        if is_vip {
            return Ok((true, false, "VIP sender".to_string()));
        }

        // Check important senders
        let is_important_sender = settings.important_senders.iter()
            .any(|imp| sender_lower.contains(&imp.to_lowercase()));

        // Apply notification mode
        match settings.notification_mode.as_str() {
            "all" => {
                Ok((true, settings.batch_notifications_enabled, "All notifications".to_string()))
            }
            "smart" => {
                if category_lower == "urgent" || category_lower == "important" || is_important_sender {
                    Ok((true, false, "Smart mode - high priority".to_string()))
                } else {
                    Ok((false, true, "Smart mode - batch low priority".to_string()))
                }
            }
            "vip_only" => {
                if category_lower == "urgent" || category_lower == "important" || is_important_sender {
                    Ok((true, false, "VIP mode - high priority".to_string()))
                } else {
                    Ok((false, true, "VIP mode - not priority".to_string()))
                }
            }
            _ => {
                Ok((true, settings.batch_notifications_enabled, "Default".to_string()))
            }
        }
    }

    /// Send a native notification using the Tauri notification plugin
    async fn send_notification(
        app_handle: AppHandle,
        subject: &str,
        sender: &str,
        category: &str,
        summary: Option<&str>,
    ) -> Result<(), String> {
        let emoji = match category.to_lowercase().as_str() {
            "urgent" => "🚨",
            "important" => "⭐",
            _ => "📧",
        };

        let title = format!("{} {}", emoji, subject);
        let body = if let Some(summary) = summary {
            format!("From: {}\n\n{}", sender, summary)
        } else {
            format!("From: {}", sender)
        };

        // Try to send notification using Tauri's notification plugin
        // The API varies, so we'll use the emit approach as fallback
        let _ = app_handle.emit("show-notification", serde_json::json!({
            "title": title,
            "body": body,
        }));

        Ok(())
    }

    /// Check and send batch notifications if the interval has passed
    async fn check_and_send_batch_notifications(
        app_handle: AppHandle,
        notification_queue: Arc<Mutex<Vec<PendingNotification>>>,
        batch_interval_minutes: u64,
    ) {
        let mut queue = notification_queue.lock().await;
        if queue.is_empty() {
            return;
        }

        let now = Utc::now();
        let batch_duration_seconds = batch_interval_minutes as i64 * 60;

        // Check if any items have been in queue long enough, or if queue is getting full
        let should_send = queue.iter().any(|n| {
            now.signed_duration_since(n.queued_at).num_seconds() >= batch_duration_seconds
        }) || queue.len() >= 10; // Also send if we have 10+ pending

        if should_send {
            // Count urgent vs normal
            let urgent_count = queue.iter().filter(|n| n.category.to_lowercase() == "urgent").count();
            let total_count = queue.len();

            // Create summary notification
            let title = if urgent_count > 0 {
                format!("🚨 {} new emails ({} urgent)", total_count, urgent_count)
            } else {
                format!("📧 {} new emails", total_count)
            };

            let body = if total_count <= 3 {
                // List individual senders/subjects
                queue.iter()
                    .take(3)
                    .map(|n| format!("• {} – {}", n.sender, n.subject))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                // Show summary
                let urgent_part = if urgent_count > 0 { format!(", {} urgent", urgent_count) } else { String::new() };
                format!("You have {} new emails{}. Click to view.", total_count, urgent_part)
            };

            // Emit notification event to frontend
            let _ = app_handle.emit("show-notification", serde_json::json!({
                "title": title,
                "body": body,
            }));

            println!("[BackgroundEmailService] Sent batch notification for {} emails", total_count);

            // Clear the queue
            queue.clear();
        }
    }
}
