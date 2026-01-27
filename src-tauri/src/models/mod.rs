use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EmailStatus {
    Unhandled,
    Saved,
    LowPriority,
    Replied,
    Done,
    Deleted,
}

impl ToString for EmailStatus {
    fn to_string(&self) -> String {
        match self {
            EmailStatus::Unhandled => "Unhandled".to_string(),
            EmailStatus::Saved => "Saved".to_string(),
            EmailStatus::LowPriority => "Low Priority".to_string(),
            EmailStatus::Replied => "Replied".to_string(),
            EmailStatus::Done => "Done".to_string(),
            EmailStatus::Deleted => "Deleted".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EmailCategory {
    Urgent,
    Important,
    Normal,
    Low,
}

impl ToString for EmailCategory {
    fn to_string(&self) -> String {
        match self {
            EmailCategory::Urgent => "Urgent".to_string(),
            EmailCategory::Important => "Important".to_string(),
            EmailCategory::Normal => "Normal".to_string(),
            EmailCategory::Low => "Low".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Email {
    pub id: String,
    pub gmail_id: String,
    pub thread_id: String,
    pub subject: String,
    pub sender: String,
    pub recipients: String,
    pub date: String,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub snippet: String,
    pub is_read: bool,
    pub is_starred: bool,
    pub has_attachments: bool,
    pub status: String,
    pub category: String,
    pub summary: Option<String>,
    pub key_points: Vec<String>,
    pub requires_reply: bool,
    pub ai_generated_reply: Option<String>,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserStyle {
    pub id: Option<i64>,
    pub user_id: String,
    pub avg_email_length: f64,
    pub formal_language_ratio: f64,
    pub common_phrases: Vec<String>,
    pub sentiment_patterns: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationHistory {
    pub id: Option<i64>,
    pub email_id: String,
    pub notification_type: String,
    pub sent_at: String,
    pub user_action: Option<String>,
}

// ============================================
// CRM MODELS
// ============================================

/// Contact - represents an email contact with interaction stats
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: String,
    pub email_address: String,
    pub display_name: Option<String>,
    pub first_seen_at: i64,
    pub last_emailed_at: Option<i64>,
    pub last_received_from_at: Option<i64>,
    pub total_emails_sent: i32,
    pub total_emails_received: i32,
    pub total_threads: i32,
    pub avg_response_time_minutes: Option<f64>,
    pub response_rate: Option<f64>,
    pub is_vip: bool,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Thread status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ThreadStatus {
    Active,
    AwaitingReply,
    Stale,
    Archived,
    Done,
}

impl ThreadStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ThreadStatus::Active => "active",
            ThreadStatus::AwaitingReply => "awaiting_reply",
            ThreadStatus::Stale => "stale",
            ThreadStatus::Archived => "archived",
            ThreadStatus::Done => "done",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "active" => ThreadStatus::Active,
            "awaiting_reply" => ThreadStatus::AwaitingReply,
            "stale" => ThreadStatus::Stale,
            "archived" => ThreadStatus::Archived,
            "done" => ThreadStatus::Done,
            _ => ThreadStatus::Active,
        }
    }
}

/// Thread - represents an email conversation thread
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub id: String,
    pub gmail_thread_id: String,
    pub subject: String,
    pub participants: Vec<String>,
    pub last_email_date: i64,
    pub last_email_id: String,
    pub status: String, // ThreadStatus as string
    pub health_score: i32, // 0-100
    pub total_emails: i32,
    pub unread_count: i32,
    pub my_last_action: Option<String>, // 'sent', 'replied', 'read'
    pub my_last_action_at: Option<i64>,
    pub their_last_action_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Follow-up reminder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FollowUpReminder {
    pub id: String,
    pub thread_id: String,
    pub email_id: String,
    pub contact_email: String,
    pub reminder_type: String, // 'no_reply', 'check_in', 'deadline'
    pub scheduled_for: i64,
    pub is_completed: bool,
    pub completed_at: Option<i64>,
    pub sent_notification: bool,
    pub message_suggestion: Option<String>,
    pub created_at: i64,
}

/// Email template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailTemplate {
    pub id: String,
    pub name: String,
    pub subject: Option<String>,
    pub body: String,
    pub category: Option<String>, // 'follow_up', 'check_in', etc.
    pub tags: Vec<String>,
    pub use_count: i32,
    pub is_ai_personalized: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Email analytics - response patterns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAnalytics {
    pub id: String,
    pub contact_email: String,
    pub day_of_week: i32, // 0-6
    pub hour: i32, // 0-23
    pub emails_sent: i32,
    pub emails_received: i32,
    pub avg_response_time_minutes: Option<f64>,
    pub response_count: i32,
    pub last_updated: i64,
}

/// Suggested action from AI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedAction {
    pub id: String,
    pub email_id: Option<String>,
    pub thread_id: Option<String>,
    pub action_type: String, // 'archive', 'follow_up', 'reply', 'label', 'reminder'
    pub suggestion: String,
    pub priority: i32, // 0-100
    pub is_dismissed: bool,
    pub is_completed: bool,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}

/// Contact insights summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactInsights {
    pub email_address: String,
    pub display_name: Option<String>,
    pub total_emails_sent: i32,
    pub total_emails_received: i32,
    pub email_ratio: f64, // sent / received
    pub avg_response_time_minutes: Option<f64>,
    pub response_rate: Option<f64>,
    pub best_day_to_contact: Option<String>, // "Monday", etc.
    pub best_hour_to_contact: Option<i32>,
    pub threads_awaiting_reply: i32,
    pub is_vip: bool,
    pub last_interaction: Option<i64>,
    pub days_since_last_contact: Option<i32>,
}

/// Thread health summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadHealthSummary {
    pub total_threads: i32,
    pub active_threads: i32,
    pub awaiting_reply_threads: i32,
    pub stale_threads: i32,
    pub unresponded_threads: i32,
    pub avg_health_score: f64,
    pub threads_by_health: Vec<ThreadHealthByContact>,
}

/// Thread health by contact
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadHealthByContact {
    pub contact_email: String,
    pub contact_name: Option<String>,
    pub thread_count: i32,
    pub awaiting_count: i32,
    pub avg_health_score: i32,
    pub last_action: Option<String>,
    pub days_since_last_contact: Option<i32>,
}

/// Reminder suggestion from AI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderSuggestion {
    pub thread_id: String,
    pub contact_email: String,
    pub subject: String,
    pub days_since_last_contact: i32,
    pub suggestion_type: String, // 'gentle_nudge', 'follow_up', 'deadline_passed'
    pub message: String,
    pub suggested_message: String,
}