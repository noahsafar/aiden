use serde::{Deserialize, Serialize};
use tauri::command;

// ==================== CHATBOT TYPES ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatEmailContext {
    pub id: String,
    pub subject: String,
    pub sender: String,
    pub date: String,
    pub snippet: String,  // First ~80 chars of body
    pub status: String,   // Unhandled, Saved, Replied, Archived, Deleted
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatContactContext {
    pub email: String,
    pub name: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatContext {
    pub current_date: String,
    pub user_name: Option<String>,
    pub emails: Vec<ChatEmailContext>,
    pub contacts: Vec<ChatContactContext>,
    pub total_email_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,  // "user" or "assistant"
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatAction {
    #[serde(rename = "type")]
    pub action_type: String,  // "search", "compose", "archive", "delete", "save", "mark_read", "mark_unread", "navigate", "summarize", "remind", "none"
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub reply_message: String,
    pub action: Option<ChatAction>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatRequest {
    pub message: String,
    pub context: ChatContext,
    pub conversation_history: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Reminder {
    pub id: String,
    pub message: String,
    pub due_date: String,  // ISO 8601 datetime
    pub created_at: String,
    pub is_triggered: bool,
}

// ==================== REMINDER STORAGE ====================

lazy_static::lazy_static! {
    static ref REMINDERS: std::sync::Mutex<Vec<Reminder>> =
        std::sync::Mutex::new(Vec::new());
}

fn get_reminders_path() -> std::path::PathBuf {
    let app_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let app_dir = app_dir.join("aiden");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("reminders.json")
}

fn load_reminders() {
    let path = get_reminders_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(loaded) = serde_json::from_str::<Vec<Reminder>>(&content) {
            let mut reminders = REMINDERS.lock().unwrap();
            *reminders = loaded;
            println!("Loaded {} reminders from disk", reminders.len());
        }
    }
}

fn save_reminders_to_disk() {
    let reminders = REMINDERS.lock().unwrap();
    let path = get_reminders_path();
    if let Ok(json) = serde_json::to_string_pretty(&*reminders) {
        std::fs::write(&path, json).ok();
    }
}

fn init_reminders() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        load_reminders();
    });
}

// ==================== CHATBOT COMMAND ====================

#[command]
pub async fn process_chat_message(request: ChatRequest) -> Result<ChatResponse, String> {
    init_reminders();

    let system_prompt = build_system_prompt(&request.context);

    // Use the types from ai module
    use crate::commands::ai::{ClaudeRequest, ClaudeMessage, ClaudeMessageContent};

    // Build conversation history for Claude
    // Wrap assistant messages back into JSON format so Claude maintains JSON output consistency
    let mut claude_messages: Vec<ClaudeMessage> = request.conversation_history
        .into_iter()
        .map(|msg| {
            let content = if msg.role == "assistant" {
                // Re-wrap plain text reply_message into expected JSON format
                // This prevents Claude from seeing plain text responses and following that pattern
                let json_wrapped = serde_json::json!({
                    "reply_message": msg.content,
                    "action": { "type": "none", "data": {} }
                });
                json_wrapped.to_string()
            } else {
                msg.content
            };
            ClaudeMessage {
                role: msg.role,
                content: ClaudeMessageContent::Text(content),
            }
        })
        .collect();

    // Add current user message
    claude_messages.push(ClaudeMessage {
        role: "user".to_string(),
        content: ClaudeMessageContent::Text(request.message),
    });

    let claude_request = ClaudeRequest {
        model: "claude-sonnet-4-20250514".to_string(),
        max_tokens: 4000,
        messages: claude_messages,
        system: Some(system_prompt),
    };

    // Use the AI helper functions directly
    let api_key = crate::commands::ai::get_api_key().await?;
    let client = reqwest::Client::new();

    let response = client
        .post("https://api.z.ai/api/anthropic/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&claude_request)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Failed to call Claude API: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("Claude API error: {} - {}", status, error_body));
    }

    let claude_response = response
        .json::<crate::commands::ai::ClaudeResponse>()
        .await
        .map_err(|e| format!("Failed to parse Claude response: {}", e))?;

    if claude_response.content.is_empty() {
        return Err("Empty response from Claude API".to_string());
    }

    let response_text = claude_response.content[0].text.clone();

    // Try to extract JSON from the response
    match extract_json_from_response(&response_text) {
        Ok(json_str) => {
            let parsed: serde_json::Value = serde_json::from_str(&json_str)
                .map_err(|e| format!("Failed to parse JSON response: {}. Response was: {}", e, response_text))?;

            let reply_message = parsed["reply_message"].as_str()
                .unwrap_or(&response_text)
                .to_string();

            let action = if let Some(action_obj) = parsed.get("action").and_then(|v| v.as_object()) {
                let action_type = action_obj.get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("none")
                    .to_string();

                let data = action_obj.get("data")
                    .cloned()
                    .unwrap_or(serde_json::json!({}));

                Some(ChatAction {
                    action_type,
                    data,
                })
            } else {
                None
            };

            Ok(ChatResponse {
                reply_message,
                action,
            })
        }
        Err(_) => {
            // Claude responded with plain text instead of JSON - use it directly
            Ok(ChatResponse {
                reply_message: response_text,
                action: None,
            })
        }
    }
}

fn build_system_prompt(context: &ChatContext) -> String {
    let mut prompt = r#"You are Aiden, an intelligent email assistant. You help users manage their email through natural language conversation.

Available actions you can take:
1. **search** - Search emails using Gmail query syntax. Return `data.query` with the search query.
2. **compose** - Compose a new email. Return `data.to`, `data.subject`, `data.body`.
3. **archive** - Archive emails. Return `data.email_ids` as an array of email IDs to archive.
4. **delete** - Delete emails. Return `data.email_ids` as an array of email IDs to delete.
5. **save** - Save/bookmark emails. Return `data.email_ids` as an array of email IDs to save.
6. **mark_read** - Mark emails as read. Return `data.email_ids` as an array of email IDs.
7. **mark_unread** - Mark emails as unread. Return `data.email_ids` as an array of email IDs.
8. **navigate** - Navigate to a specific email. Return `data.email_id`.
9. **summarize** - Provide a summary (included in reply_message, no special data needed).
10. **remind** - Set a reminder. Return `data.message` and `data.due_date` (ISO 8601).
11. **none** - Just respond conversationally without taking action.

Context about the user:
"#.to_string();

    // Add current date
    prompt.push_str(&format!("- Current date: {}\n", context.current_date));

    // Add user name if available
    if let Some(name) = &context.user_name {
        prompt.push_str(&format!("- User's name: {}\n", name));
    }

    // Add email summary
    prompt.push_str(&format!(
        "- Total emails in view: {} (showing most recent {})\n\n",
        context.total_email_count,
        context.emails.len()
    ));

    // Add recent emails for context
    if !context.emails.is_empty() {
        prompt.push_str("Recent emails:\n");
        for (i, email) in context.emails.iter().enumerate() {
            prompt.push_str(&format!(
                "{}. [{}] From: {} | Subject: {} | Date: {} | ID: {} | Preview: {}...\n",
                i + 1,
                email.status,
                email.sender,
                email.subject,
                email.date,
                email.id,
                email.snippet
            ));
        }
        prompt.push_str("\n");
    }

    // Add contacts if available
    if !context.contacts.is_empty() {
        prompt.push_str("Top contacts:\n");
        for contact in context.contacts.iter().take(10) {
            prompt.push_str(&format!(
                "- {} ({})",
                contact.name.as_deref().unwrap_or("Unknown"),
                contact.email
            ));
            if let Some(category) = &contact.category {
                prompt.push_str(&format!(" - {}", category));
            }
            prompt.push('\n');
        }
        prompt.push_str("\n");
    }

    prompt.push_str(r#"
Response format:
Always respond with valid JSON (no markdown, no explanation):
{
  "reply_message": "Your conversational response to the user",
  "action": {
    "type": "action_type",
    "data": { ...action_specific_data }
  }
}

Action-specific data formats:
- **search**: `{"query": "gmail search query string"}`
- **compose**: `{"to": "recipient@example.com", "subject": "Email subject", "body": "Email body"}`
- **archive**: `{"email_ids": ["id1", "id2", ...]}`
- **delete**: `{"email_ids": ["id1", "id2", ...]}`
- **save**: `{"email_ids": ["id1", "id2", ...]}`
- **mark_read**: `{"email_ids": ["id1", "id2", ...]}`
- **mark_unread**: `{"email_ids": ["id1", "id2", ...]}`
- **navigate**: `{"email_id": "email_id_here"}`
- **remind**: `{"message": "Reminder message", "due_date": "2025-02-15T10:00:00"}`
- **summarize** or **none**: `{}` or omit action entirely

Guidelines:
- Be conversational and helpful in reply_message
- Only return an action if the user explicitly wants to do something
- For search, generate Gmail-style queries (e.g., "from:john@example.com", "subject:meeting", "after:2025/02/01")
- For compose, include a complete email with subject and body
- For reminders, parse natural language dates like "tomorrow", "in 2 days", "next Friday" into ISO 8601 format
- If unsure about something, ask for clarification in reply_message
- For bulk operations like "clear inbox", "delete all newsletters", or "mark all as read", include all matching email IDs from the context
- Each email in the context has a status field showing its current state (Unhandled, Saved, Replied, Archived, Deleted) - use this to avoid redundant operations
- CRITICAL: You MUST always respond with valid JSON. Never respond with plain text.
- Even for casual conversation, wrap your response in the JSON format above."#);

    prompt
}

fn extract_json_from_response(response: &str) -> Result<String, String> {
    // Try parsing as-is first
    if let Ok(_) = serde_json::from_str::<serde_json::Value>(response) {
        return Ok(response.to_string());
    }

    // Look for JSON between ```json and ```
    if let Some(start) = response.find("```json") {
        let json_start = start + 7;
        if let Some(end) = response[json_start..].find("```") {
            let json_str = response[json_start..json_start + end].trim();
            if serde_json::from_str::<serde_json::Value>(json_str).is_ok() {
                return Ok(json_str.to_string());
            }
        }
    }

    // Look for JSON between ``` and ```
    if let Some(start) = response.find("```") {
        let json_start = start + 3;
        if let Some(end) = response[json_start..].find("```") {
            let json_str = response[json_start..json_start + end].trim();
            if serde_json::from_str::<serde_json::Value>(json_str).is_ok() {
                return Ok(json_str.to_string());
            }
        }
    }

    // Try to find { and } as JSON boundaries
    if let Some(start) = response.find('{') {
        if let Some(end) = response.rfind('}') {
            let json_str = &response[start..=end];
            if serde_json::from_str::<serde_json::Value>(json_str).is_ok() {
                return Ok(json_str.to_string());
            }
        }
    }

    Err(format!("Could not extract valid JSON from response: {}", response))
}

// ==================== REMINDER COMMANDS ====================

#[command]
pub async fn save_reminder(reminder: Reminder) -> Result<(), String> {
    init_reminders();
    let mut reminders = REMINDERS.lock().unwrap();

    // Check if reminder with same ID exists, update it
    if let Some(existing) = reminders.iter().position(|r| r.id == reminder.id) {
        reminders[existing] = reminder;
    } else {
        reminders.push(reminder);
    }
    drop(reminders);
    save_reminders_to_disk();
    Ok(())
}

#[command]
pub async fn get_reminders() -> Result<Vec<Reminder>, String> {
    init_reminders();
    let reminders = REMINDERS.lock().unwrap();
    Ok(reminders.clone())
}

#[command]
pub async fn delete_reminder(id: String) -> Result<(), String> {
    init_reminders();
    let mut reminders = REMINDERS.lock().unwrap();
    reminders.retain(|r| r.id != id);
    drop(reminders);
    save_reminders_to_disk();
    Ok(())
}

#[command]
pub async fn get_due_reminders() -> Result<Vec<Reminder>, String> {
    init_reminders();
    let reminders = REMINDERS.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();

    let due: Vec<Reminder> = reminders.iter()
        .filter(|r| !r.is_triggered && r.due_date <= now)
        .cloned()
        .collect();

    Ok(due)
}

#[command]
pub async fn mark_reminder_triggered(id: String) -> Result<(), String> {
    init_reminders();
    let mut reminders = REMINDERS.lock().unwrap();
    if let Some(reminder) = reminders.iter_mut().find(|r| r.id == id) {
        reminder.is_triggered = true;
    }
    drop(reminders);
    save_reminders_to_disk();
    Ok(())
}
