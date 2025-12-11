use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EmailStatus {
    Unhandled,
    Saved,
    LowPriority,
    Replied,
    Done,
}

impl ToString for EmailStatus {
    fn to_string(&self) -> String {
        match self {
            EmailStatus::Unhandled => "Unhandled".to_string(),
            EmailStatus::Saved => "Saved".to_string(),
            EmailStatus::LowPriority => "Low Priority".to_string(),
            EmailStatus::Replied => "Replied".to_string(),
            EmailStatus::Done => "Done".to_string(),
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