use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};
use reqwest;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use std::sync::Arc;
use base64::{Engine as _, engine::general_purpose};
use uuid;

// Rate limiter for Gmail API
pub struct RateLimiter {
    requests: Arc<RwLock<Vec<Instant>>>,
    max_requests: usize,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max_requests: usize, window: Duration) -> Self {
        Self {
            requests: Arc::new(RwLock::new(Vec::new())),
            max_requests,
            window,
        }
    }

    pub async fn acquire(&self) -> Result<(), String> {
        let mut requests = self.requests.write().await;
        let now = Instant::now();

        // Remove old requests outside the window
        requests.retain(|&req| now.duration_since(req) < self.window);

        // Check if we've exceeded the limit
        if requests.len() >= self.max_requests {
            let oldest_request = requests.first().unwrap();
            let wait_time = self.window - now.duration_since(*oldest_request);
            return Err(format!("Rate limit exceeded. Please wait {} seconds.", wait_time.as_secs()));
        }

        // Add current request
        requests.push(now);
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Email {
    pub id: String,
    pub gmail_id: String,
    pub thread_id: String,
    pub subject: String,
    pub sender: String,
    pub recipients: String,
    pub date: chrono::DateTime<chrono::Utc>,
    pub body_text: String,
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
pub struct GmailProfile {
    pub email_address: String,
    pub messages_total: i64,
    pub threads_total: i64,
    pub history_id: String,
}

// Gmail API response structures
#[derive(Debug, Deserialize)]
struct GmailListResponse {
    messages: Vec<GmailMessage>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GmailMessage {
    id: String,
    #[serde(default)]
    thread_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GmailMessageDetail {
    id: String,
    thread_id: String,
    snippet: String,
    internal_date: String,
    payload: GmailMessagePayload,
}

#[derive(Debug, Deserialize)]
struct GmailMessagePayload {
    parts: Option<Vec<GmailMessagePart>>,
    headers: Vec<GmailMessageHeader>,
    body: Option<GmailMessageBody>,
}

#[derive(Debug, Deserialize)]
struct GmailMessagePart {
    mime_type: Option<String>,
    body: GmailMessageBody,
    part_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GmailMessageBody {
    data: Option<String>,
    size: i64,
}

#[derive(Debug, Deserialize)]
struct GmailMessageHeader {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct GmailProfileResponse {
    email_address: String,
    messages_total: i64,
    threads_total: i64,
    history_id: String,
}

// Helper function to get rate limiter
fn get_rate_limiter() -> &'static RateLimiter {
    use std::sync::OnceLock;
    static RATE_LIMITER: OnceLock<RateLimiter> = OnceLock::new();
    RATE_LIMITER.get_or_init(|| {
        RateLimiter::new(100, Duration::from_secs(100)) // 100 requests per 100 seconds
    })
}

#[command]
pub async fn fetch_emails(access_token: String, page_token: Option<String>) -> Result<(Vec<Email>, Option<String>), String> {
    let rate_limiter = get_rate_limiter();
    rate_limiter.acquire().await?;

    let client = reqwest::Client::new();
    let mut url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=is:inbox"
    );

    if let Some(page_token) = page_token {
        url.push_str(&format!("&pageToken={}", page_token));
    }

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch messages: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Gmail API error: {}", response.status()));
    }

    let list_response: GmailListResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let mut emails = Vec::new();

    // Fetch details for each message
    for message in list_response.messages {
        rate_limiter.acquire().await?;

        let detail_url = format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=full",
            message.id
        );

        let detail_response = client
            .get(&detail_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch message details: {}", e))?;

        if !detail_response.status().is_success() {
            continue; // Skip messages that can't be fetched
        }

        let message_detail: GmailMessageDetail = detail_response
            .json()
            .await
            .map_err(|e| format!("Failed to parse message details: {}", e))?;

        let email = parse_gmail_message(message_detail)?;
        emails.push(email);
    }

    Ok((emails, list_response.next_page_token))
}

#[command]
pub async fn get_profile(access_token: String) -> Result<GmailProfile, String> {
    let rate_limiter = get_rate_limiter();
    rate_limiter.acquire().await?;

    let client = reqwest::Client::new();
    let response = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch profile: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Gmail API error: {}", response.status()));
    }

    let profile_response: GmailProfileResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse profile response: {}", e))?;

    Ok(GmailProfile {
        email_address: profile_response.email_address,
        messages_total: profile_response.messages_total,
        threads_total: profile_response.threads_total,
        history_id: profile_response.history_id,
    })
}

#[command]
pub async fn send_email(access_token: String, to: String, subject: String, body: String) -> Result<String, String> {
    let rate_limiter = get_rate_limiter();
    rate_limiter.acquire().await?;

    // Create RFC 2822 formatted email
    let email_content = format!(
        "To: {}\r\nSubject: {}\r\n\r\n{}",
        to, subject, body
    );

    let encoded_email = general_purpose::STANDARD.encode(email_content);

    let client = reqwest::Client::new();
    let response = client
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .body(format!(r#"{{"raw": "{}"}}"#, encoded_email))
        .send()
        .await
        .map_err(|e| format!("Failed to send email: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Gmail API error: {}", response.status()));
    }

    let result: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse send response: {}", e))?;

    Ok(result["id"].as_str().unwrap_or("unknown").to_string())
}

// Helper function to parse Gmail message details
fn parse_gmail_message(message: GmailMessageDetail) -> Result<Email, String> {
    let mut subject = "No Subject".to_string();
    let mut sender = "Unknown".to_string();
    let mut recipients = "".to_string();
    let mut body_text = "".to_string();
    let mut body_html = None;
    let mut has_attachments = false;

    // Parse headers
    for header in message.payload.headers {
        match header.name.to_lowercase().as_str() {
            "subject" => subject = header.value,
            "from" => sender = header.value,
            "to" => recipients = header.value,
            _ => {}
        }
    }

    // Parse body
    if let Some(parts) = message.payload.parts {
        for part in parts {
            if let Some(mime_type) = part.mime_type {
                if mime_type == "text/plain" {
                    if let Some(data) = part.body.data {
                        body_text = decode_base64_url(&data)?;
                    }
                } else if mime_type == "text/html" {
                    if let Some(data) = part.body.data {
                        body_html = Some(decode_base64_url(&data)?);
                    }
                } else if mime_type.starts_with("application/") || mime_type.starts_with("image/") {
                    has_attachments = true;
                }
            }
        }
    } else if let Some(body) = message.payload.body {
        if let Some(data) = body.data {
            body_text = decode_base64_url(&data)?;
        }
    }

    // Parse timestamp
    let timestamp = message.internal_date.parse::<i64>()
        .unwrap_or_else(|_| chrono::Utc::now().timestamp());
    let date = chrono::DateTime::from_timestamp(timestamp / 1000, 0)
        .unwrap_or(chrono::Utc::now());

    Ok(Email {
        id: uuid::Uuid::new_v4().to_string(),
        gmail_id: message.id,
        thread_id: message.thread_id,
        subject,
        sender,
        recipients,
        date,
        body_text,
        body_html,
        snippet: message.snippet,
        is_read: false, // This would need to be determined from label IDs
        is_starred: false, // This would need to be determined from label IDs
        has_attachments,
        status: "Unhandled".to_string(),
        category: "Normal".to_string(),
        summary: None,
        key_points: Vec::new(),
        requires_reply: false,
        ai_generated_reply: None,
    })
}

// Helper function to decode base64url encoding
fn decode_base64_url(encoded: &str) -> Result<String, String> {
    // Replace URL-safe characters
    let normalized = encoded.replace('-', "+").replace('_', "/");
    general_purpose::STANDARD
        .decode(normalized)
        .map_err(|e| format!("Failed to decode base64: {}", e))
        .and_then(|bytes| String::from_utf8(bytes).map_err(|e| format!("Invalid UTF-8: {}", e)))
}