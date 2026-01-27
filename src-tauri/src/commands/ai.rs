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
    system: Option<String>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
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

// Helper function to get API key from settings or environment
async fn get_api_key() -> Result<String, String> {
    // Try loading from .env file in project directory FIRST (before env var check)
    let project_dir = std::path::PathBuf::from("/Users/noahsafar/Projects/aiden");
    let env_file = project_dir.join(".env");

    // Fallback: manually parse the .env file (most reliable)
    if env_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&env_file) {
            for line in content.lines() {
                if let Some(key) = line.strip_prefix("ANTHROPIC_API_KEY=") {
                    let key = key.trim().to_string();
                    if !key.is_empty() && !key.starts_with('"') {
                        println!("Found API key in .env file, length: {}", key.len());
                        return Ok(key);
                    }
                }
            }
        }
    }

    // Try environment variable (for dev - may be set by IDE or cargo-letps)
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            println!("Found API key in environment, length: {}", key.len());
            return Ok(key);
        }
    }

    // Try reading from settings file
    let app_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("aiden");

    let settings_file = app_dir.join("notification_settings.json");

    if settings_file.exists() {
        let content = std::fs::read_to_string(&settings_file)
            .map_err(|e| format!("Failed to read settings: {}", e))?;

        if let Ok(settings_json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(api_key) = settings_json["anthropic_api_key"].as_str() {
                if !api_key.is_empty() {
                    println!("Found API key in settings file, length: {}", api_key.len());
                    return Ok(api_key.to_string());
                }
            }
        }
    }

    Err("ANTHROPIC_API_KEY not found in environment, settings, or .env file".to_string())
}

// Helper function to call Claude API
async fn call_claude_api(prompt: String) -> Result<String, String> {
    call_claude_api_with_system(prompt, None).await
}

async fn call_claude_api_with_system(prompt: String, system: Option<String>) -> Result<String, String> {
    let api_key = get_api_key().await?;
    eprintln!("DEBUG: Using API key with length: {}, starts with: {}", api_key.len(), &api_key[..8.min(api_key.len())]);

    let client = reqwest::Client::new();
    let request = ClaudeRequest {
        model: "claude-sonnet-4-20250514".to_string(),  // z.ai supports Claude models
        max_tokens: 4000,
        messages: vec![
            ClaudeMessage {
                role: "user".to_string(),
                content: prompt,
            }
        ],
        system,
    };

    // Use z.ai endpoint (Anthropic-compatible API)
    let response = client
        .post("https://api.z.ai/api/anthropic/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Failed to call z.ai API: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("z.ai API error: {} - {}", status, error_body));
    }

    let claude_response: ClaudeResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse z.ai response: {}", e))?;

    if claude_response.content.is_empty() {
        return Err("Empty response from z.ai API".to_string());
    }

    Ok(claude_response.content[0].text.clone())
}

// ==================== EMAIL ANALYSIS ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyzeEmailRequest {
    pub sender: String,
    pub subject: String,
    pub body_text: String,
    pub has_attachments: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyzeEmailResponse {
    pub questions: Vec<Question>,
    pub suggested_formality_score: i32, // 0-100
    pub requires_reply: bool,
    pub reply_reasoning: String,
    pub meeting_request: Option<MeetingRequest>,
    pub missing_attachment_warning: Option<String>,
    pub mentioned_document_types: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Question {
    #[serde(rename = "type")]
    pub question_type: String, // "choice" or "text"
    pub question: String,
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingRequest {
    pub is_meeting: bool,
    pub proposed_times: Vec<String>,
    pub duration_minutes: i32,
    pub subject: String,
}

#[command]
pub async fn analyze_email_claude(request: AnalyzeEmailRequest) -> Result<AnalyzeEmailResponse, String> {
    let system_prompt = r#"You are Aiden, an intelligent email assistant. Your job is to analyze emails and extract:
1. Questions the sender needs answers to
2. Whether a reply is needed and why
3. The appropriate tone (formality 0-100)
4. Whether this is a meeting request
5. Any missing attachments mentioned

Always respond with valid JSON only."#;

    let prompt = format!(
        r#"Analyze this email and respond with ONLY valid JSON (no markdown, no explanation):

Sender: {}
Subject: {}
Body: {}
Has Attachments: {}

Respond in this exact JSON format:
{{
  "questions": [
    {{"type": "choice", "question": "What's your preference?", "options": ["Option A", "Option B", "Option C"]}},
    {{"type": "text", "question": "What specific information do you need?"}}
  ],
  "suggested_formality_score": 50,
  "requires_reply": true,
  "reply_reasoning": "Brief explanation of why reply is needed",
  "meeting_request": {{
    "is_meeting": false,
    "proposed_times": [],
    "duration_minutes": 60,
    "subject": "Meeting subject extracted from email"
  }},
  "missing_attachment_warning": null,
  "mentioned_document_types": []
}}

Guidelines:
- Questions: Extract actual questions or decisions needed from the email
- Type: "choice" for questions with clear options (like "yes/no"), "text" for open-ended
- Formality: 0=very casual, 50=neutral, 100=very formal
- Meeting: Set is_meeting=true if they want to meet; extract proposed times like "Tuesday at 2pm"
- Missing attachment: Warn if they mention "attached file" but no attachments exist
- Document types: List mentioned file types (resume, PDF, etc.)"#,
        request.sender, request.subject, request.body_text, request.has_attachments
    );

    let response = call_claude_api_with_system(prompt, Some(system_prompt.to_string())).await?;

    // Extract JSON from response (in case there's markdown or extra text)
    let json_str = extract_json_from_response(&response)?;

    let parsed: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON response: {}. Response was: {}", e, response))?;

    let questions: Vec<Question> = serde_json::from_value(parsed["questions"].clone())
        .unwrap_or_default();

    let suggested_formality_score = parsed["suggested_formality_score"].as_i64().unwrap_or(50) as i32;
    let requires_reply = parsed["requires_reply"].as_bool().unwrap_or(true);
    let reply_reasoning = parsed["reply_reasoning"].as_str().unwrap_or("").to_string();

    let meeting_request: Option<MeetingRequest> = parsed["meeting_request"].as_object()
        .and_then(|v| serde_json::from_value(serde_json::Value::Object(v.clone())).ok())
        .filter(|m: &MeetingRequest| m.is_meeting);

    let missing_attachment_warning = parsed["missing_attachment_warning"].as_str()
        .map(|s| s.to_string());

    let mentioned_document_types: Vec<String> = parsed["mentioned_document_types"].as_array()
        .and_then(|arr| serde_json::from_value(serde_json::Value::Array(arr.clone())).ok())
        .unwrap_or_default();

    Ok(AnalyzeEmailResponse {
        questions,
        suggested_formality_score,
        requires_reply,
        reply_reasoning,
        meeting_request,
        missing_attachment_warning,
        mentioned_document_types,
    })
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

// ==================== REPLY GENERATION ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateReplyRequest {
    pub sender: String,
    pub subject: String,
    pub body_text: String,
    pub user_answers: Vec<UserAnswer>,
    pub formality_level: String, // "casual", "neutral", "formal"
    pub additional_context: Option<String>,
    pub selected_meeting_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserAnswer {
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateReplyResponse {
    pub reply: String,
    pub subject: String,
}

#[command]
pub async fn generate_reply_claude(request: GenerateReplyRequest) -> Result<GenerateReplyResponse, String> {
    let system_prompt = r#"You are Aiden, an intelligent email assistant. You write professional, contextually appropriate email replies.
Keep replies concise and natural. Match the requested formality level."#;

    let answers_section = if request.user_answers.is_empty() {
        "No specific questions to address.".to_string()
    } else {
        request.user_answers.iter()
            .map(|a| format!("Q: {}\nA: {}", a.question, a.answer))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let context_section = request.additional_context
        .map(|c| format!("\nAdditional Context: {}", c))
        .unwrap_or_default();

    let meeting_section = request.selected_meeting_time
        .map(|t| format!("\nMeeting Time: {}", t))
        .unwrap_or_default();

    let prompt = format!(
        r#"Write a reply to this email.

ORIGINAL EMAIL:
From: {}
Subject: {}
Body: {}

MY ANSWERS TO QUESTIONS:
{}

{}

{}

REQUIREMENTS:
- Formality: {}
- Keep it concise (2-4 sentences typically)
- Be professional but natural
- Include "Re: " in the subject line
- Return ONLY a JSON object with "reply" and "subject" fields

Response format:
{{
  "reply": "Your email reply here...",
  "subject": "Re: {}"
}}"#,
        request.sender,
        request.subject,
        request.body_text,
        answers_section,
        context_section,
        meeting_section,
        request.formality_level,
        request.subject
    );

    let response = call_claude_api_with_system(prompt, Some(system_prompt.to_string())).await?;

    let json_str = extract_json_from_response(&response)?;

    let parsed: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON response: {}", e))?;

    let reply = parsed["reply"].as_str()
        .ok_or("Missing 'reply' field in response")?
        .to_string();

    let subject = parsed["subject"].as_str()
        .ok_or("Missing 'subject' field in response")?
        .to_string();

    Ok(GenerateReplyResponse { reply, subject })
}

// ==================== EMAIL EDITING ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct EditReplyRequest {
    pub current_reply: String,
    pub edit_prompt: String,
}

#[command]
pub async fn edit_reply_claude(request: EditReplyRequest) -> Result<String, String> {
    let prompt = format!(
        r#"Edit this email reply based on the user's request.

Current reply:
{}

User's edit request: {}

Return ONLY the edited reply, no explanation or extra text."#,
        request.current_reply, request.edit_prompt
    );

    call_claude_api(prompt).await
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