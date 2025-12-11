use serde::{Deserialize, Serialize};
use tauri::command;
use reqwest;
use std::time::Duration;

// Claude API request/response structures
#[derive(Debug, Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ClaudeMessage>,
}

#[derive(Debug, Serialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
}

#[derive(Debug, Deserialize)]
struct ClaudeContent {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmailSummary {
    pub summary: String,
    pub key_points: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmailClassification {
    pub category: String, // "urgent", "important", "normal", "low", "spam"
    pub confidence: f64,
    pub requires_reply: bool,
    pub can_auto_archive: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneratedReply {
    pub reply: String,
    pub tone: String, // "formal", "casual", "friendly", "professional"
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WritingStyle {
    pub tone: String,
    pub formality: f64,
    pub common_phrases: Vec<String>,
    pub avg_sentence_length: f64,
}

// Helper function to call Claude API
async fn call_claude_api(prompt: String) -> Result<String, String> {
    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .map_err(|_| "ANTHROPIC_API_KEY environment variable not set".to_string())?;

    let client = reqwest::Client::new();
    let request = ClaudeRequest {
        model: "claude-3-sonnet-20241022".to_string(),
        max_tokens: 2000,
        messages: vec![
            ClaudeMessage {
                role: "user".to_string(),
                content: prompt,
            }
        ],
    };

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Failed to call Claude API: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Claude API error: {}", response.status()));
    }

    let claude_response: ClaudeResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Claude response: {}", e))?;

    if claude_response.content.is_empty() {
        return Err("Empty response from Claude API".to_string());
    }

    Ok(claude_response.content[0].text.clone())
}

#[command]
pub async fn summarize_email(email_content: String, style_context: Option<String>) -> Result<EmailSummary, String> {
    let context = style_context.unwrap_or_default();
    let prompt = format!(
        r#"Please analyze this email and provide a concise summary and key points.

Email Content:
{}

Additional Context about recipient's preferences:
{}

Please respond in the following JSON format:
{{
  "summary": "A brief 2-3 sentence summary of the email",
  "key_points": ["Key point 1", "Key point 2", "Key point 3"]
}}

Focus on the most important information and action items."#,
        email_content, context
    );

    let response = call_claude_api(prompt).await?;

    // Try to parse as JSON
    let parsed: serde_json::Value = serde_json::from_str(&response)
        .map_err(|_| "Invalid JSON response from Claude".to_string())?;

    let summary = parsed["summary"].as_str()
        .ok_or("Missing summary in response".to_string())?
        .to_string();

    let key_points: Vec<String> = parsed["key_points"].as_array()
        .ok_or("Missing or invalid key_points in response".to_string())?
        .iter()
        .filter_map(|v| v.as_str())
        .map(|s| s.to_string())
        .collect();

    Ok(EmailSummary { summary, key_points })
}

#[command]
pub async fn classify_email(email_content: String, sender: String, subject: String) -> Result<EmailClassification, String> {
    let prompt = format!(
        r#"Please classify this email by priority and importance.

From: {}
Subject: {}
Content: {}

Respond in JSON format:
{{
  "category": "urgent|important|normal|low|spam",
  "confidence": 0.95,
  "requires_reply": true,
  "can_auto_archive": false
}}

Categories:
- urgent: Requires immediate attention (time-sensitive, emergencies, etc.)
- important: Important but not immediately time-sensitive
- normal: Regular emails that can be handled during routine processing
- low: Low priority emails (newsletters, notifications, etc.)
- spam: Unwanted or spam emails

Consider:
- Sender relationship and authority
- Time sensitivity
- Action required
- Content importance"#,
        sender, subject, email_content
    );

    let response = call_claude_api(prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response)
        .map_err(|_| "Invalid JSON response from Claude".to_string())?;

    let category = parsed["category"].as_str()
        .ok_or("Missing category in response".to_string())?
        .to_string();

    let confidence = parsed["confidence"].as_f64()
        .ok_or("Missing or invalid confidence in response".to_string())?;

    let requires_reply = parsed["requires_reply"].as_bool()
        .ok_or("Missing or invalid requires_reply in response".to_string())?;

    let can_auto_archive = parsed["can_auto_archive"].as_bool()
        .ok_or("Missing or invalid can_auto_archive in response".to_string())?;

    Ok(EmailClassification {
        category,
        confidence,
        requires_reply,
        can_auto_archive,
    })
}

#[command]
pub async fn generate_reply(
    original_email: String,
    user_style: WritingStyle,
    reply_type: String,
) -> Result<GeneratedReply, String> {
    let style_desc = format!(
        "Tone: {}, Formality: {:.1}, Common phrases: {}",
        user_style.tone,
        user_style.formality,
        user_style.common_phrases.join(", ")
    );

    let prompt = format!(
        r#"Generate a {} reply to this email, matching the user's writing style.

Original Email:
{}

User's Writing Style:
{}

Reply type: {}

Generate only the reply content, no greetings or explanations.
Match the user's tone and formality level.
Keep it concise and professional."#,
        reply_type, original_email, style_desc, reply_type
    );

    let response = call_claude_api(prompt).await?;

    Ok(GeneratedReply {
        reply: response,
        tone: user_style.tone,
        confidence: 0.9,
    })
}

#[command]
pub async fn analyze_writing_style(sent_emails: Vec<String>) -> Result<WritingStyle, String> {
    if sent_emails.is_empty() {
        return Err("No emails provided for analysis".to_string());
    }

    let emails_text = sent_emails.iter().enumerate()
        .map(|(i, email)| format!("Email {}:\n{}\n", i + 1, email))
        .collect::<String>();

    let prompt = format!(
        r#"Analyze the writing style from these sent emails and provide insights.

{}

Respond in JSON format:
{{
  "tone": "formal|casual|friendly|professional",
  "formality": 0.8,
  "common_phrases": ["phrase1", "phrase2", "phrase3"],
  "avg_sentence_length": 15.5
}}

Analyze:
- Overall tone (formal, casual, friendly, professional)
- Formality level (0.0 = very casual, 1.0 = very formal)
- Common phrases or expressions they use
- Average sentence length"#,
        emails_text
    );

    let response = call_claude_api(prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response)
        .map_err(|_| "Invalid JSON response from Claude".to_string())?;

    let tone = parsed["tone"].as_str()
        .ok_or("Missing tone in response".to_string())?
        .to_string();

    let formality = parsed["formality"].as_f64()
        .ok_or("Missing or invalid formality in response".to_string())?;

    let common_phrases: Vec<String> = parsed["common_phrases"].as_array()
        .ok_or("Missing or invalid common_phrases in response".to_string())?
        .iter()
        .filter_map(|v| v.as_str())
        .map(|s| s.to_string())
        .collect();

    let avg_sentence_length = parsed["avg_sentence_length"].as_f64()
        .ok_or("Missing or invalid avg_sentence_length in response".to_string())?;

    Ok(WritingStyle {
        tone,
        formality,
        common_phrases,
        avg_sentence_length,
    })
}