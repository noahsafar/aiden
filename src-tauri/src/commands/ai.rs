use serde::{Deserialize, Serialize};
use tauri::command;
use reqwest;
use std::time::Duration;
use std::collections::HashMap;
use std::path::PathBuf;
use std::fs;

// Storage for writing styles per recipient
lazy_static::lazy_static! {
    static ref WRITING_STYLES: std::sync::Mutex<HashMap<String, RecipientWritingStyle>> =
        std::sync::Mutex::new(HashMap::new());
}

// Get the path to the writing styles file
fn get_writing_styles_path() -> PathBuf {
    let app_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    let app_dir = app_dir.join("aiden");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("writing_styles.json")
}

// Load writing styles from disk on startup
fn load_writing_styles() {
    let path = get_writing_styles_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(loaded) = serde_json::from_str::<HashMap<String, RecipientWritingStyle>>(&content) {
            let mut styles = WRITING_STYLES.lock().unwrap();
            *styles = loaded;
            println!("Loaded {} writing styles from disk", styles.len());
        }
    }
}

// Save writing styles to disk
fn save_writing_styles_to_disk() {
    let styles = WRITING_STYLES.lock().unwrap();
    let path = get_writing_styles_path();
    if let Ok(json) = serde_json::to_string_pretty(&*styles) {
        fs::write(&path, json).ok();
    }
}

// Initialize writing styles on first use
fn init_writing_styles() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        load_writing_styles();
    });
}

// Claude API request/response structures
#[derive(Debug, Serialize)]
pub struct ClaudeRequest {
    pub model: String,
    pub max_tokens: u32,
    pub messages: Vec<ClaudeMessage>,
    pub system: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ClaudeMessageContent {
    Text(String),
    Array(Vec<serde_json::Value>),
}

#[derive(Debug, Serialize)]
pub struct ClaudeMessage {
    pub role: String,
    pub content: ClaudeMessageContent,
}

#[derive(Debug, Deserialize)]
pub struct ClaudeResponse {
    pub content: Vec<ClaudeContent>,
}

#[derive(Debug, Deserialize)]
pub struct ClaudeContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
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

// New structs for conversation context and per-recipient writing style
#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationEmail {
    pub subject: String,
    pub sender: String,
    pub body: String,
    pub date: String,
    pub is_from_user: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecipientWritingStyle {
    pub recipient_email: String,
    pub tone_description: String,
    pub formality_score: i32, // 0-100
    pub common_phrases: Vec<String>,
    pub greeting_style: String,
    pub sign_off_style: String,
    pub sample_count: i32,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationContext {
    pub recipient_email: String,
    pub previous_emails: Vec<ConversationEmail>,
    pub total_conversation_count: i32,
}

// Read a string field out of the app settings JSON (~/.config/aiden/notification_settings.json).
pub(crate) fn read_app_setting(field: &str) -> Option<String> {
    let settings_file = dirs::config_dir()?.join("aiden").join("notification_settings.json");
    let content = std::fs::read_to_string(settings_file).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json[field]
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// Helper function to get the API key. Resolution order (no machine-specific paths):
//   1. ANTHROPIC_API_KEY environment variable (dev shells, CI)
//   2. App settings file — the normal path for an installed app (set via Settings UI)
//   3. A .env in the working directory or its parent (dev convenience: `tauri dev`
//      runs in src-tauri/, so the parent is the project root)
pub(crate) async fn get_api_key() -> Result<String, String> {
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    if let Some(key) = read_app_setting("anthropic_api_key") {
        return Ok(key);
    }

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(".env"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(".env"));
        }
    }
    for env_file in candidates {
        if let Ok(content) = std::fs::read_to_string(&env_file) {
            for line in content.lines() {
                if let Some(key) = line.strip_prefix("ANTHROPIC_API_KEY=") {
                    let key = key.trim().trim_matches('"').to_string();
                    if !key.is_empty() {
                        return Ok(key);
                    }
                }
            }
        }
    }

    Err("No Anthropic API key configured. Add it in Settings, or set the ANTHROPIC_API_KEY environment variable.".to_string())
}

// Model + endpoint are configurable so a deprecated model id or a provider change
// doesn't require shipping a new binary. Env var beats settings beats default.
pub(crate) fn resolve_ai_model() -> String {
    std::env::var("AIDEN_AI_MODEL")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| read_app_setting("ai_model"))
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string())
}

pub(crate) fn resolve_ai_base() -> String {
    let base = std::env::var("AIDEN_AI_BASE_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| read_app_setting("ai_base_url"))
        .unwrap_or_else(|| "https://api.z.ai/api/anthropic".to_string());
    base.trim_end_matches('/').to_string()
}

/// Some Anthropic-compatible gateways (e.g. a proxy issuing non-Anthropic
/// tokens) authenticate with `Authorization: Bearer <token>` rather than the
/// direct-API `x-api-key` header. Prefer ANTHROPIC_AUTH_TOKEN when set; fall
/// back to the regular API key otherwise (unchanged default behavior).
pub(crate) async fn resolve_auth_header() -> Result<(&'static str, String), String> {
    if let Ok(token) = std::env::var("ANTHROPIC_AUTH_TOKEN") {
        if !token.is_empty() {
            return Ok(("Authorization", format!("Bearer {}", token)));
        }
    }
    if let Some(token) = read_app_setting("anthropic_auth_token") {
        return Ok(("Authorization", format!("Bearer {}", token)));
    }
    let api_key = get_api_key().await?;
    Ok(("x-api-key", api_key))
}

// Helper function to call Claude API
async fn call_claude_api(prompt: String) -> Result<String, String> {
    call_claude_api_with_system(prompt, None).await
}

pub(crate) async fn call_claude_api_with_system(prompt: String, system: Option<String>) -> Result<String, String> {
    let (auth_header, auth_value) = resolve_auth_header().await?;
    eprintln!("DEBUG: Using {} auth, length: {}", auth_header, auth_value.len());

    let client = reqwest::Client::new();
    let request = ClaudeRequest {
        model: resolve_ai_model(),
        max_tokens: 4000,
        messages: vec![
            ClaudeMessage {
                role: "user".to_string(),
                content: ClaudeMessageContent::Text(prompt),
            }
        ],
        system,
    };

    // Anthropic-compatible endpoint (configurable; defaults to z.ai)
    let response = client
        .post(format!("{}/v1/messages", resolve_ai_base()))
        .header(auth_header, auth_value)
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

// Helper function to call Claude API with vision (for images)
async fn call_claude_vision_api(prompt: String, base64_image: String, media_type: String, system: Option<String>) -> Result<String, String> {
    let (auth_header, auth_value) = resolve_auth_header().await?;

    let client = reqwest::Client::new();

    // Build content array with text and image
    let content_array = vec![
        serde_json::json!({
            "type": "text",
            "text": prompt
        }),
        serde_json::json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64_image
            }
        }),
    ];

    let request = ClaudeRequest {
        model: resolve_ai_model(),
        max_tokens: 4000,
        messages: vec![
            ClaudeMessage {
                role: "user".to_string(),
                content: ClaudeMessageContent::Array(content_array),
            }
        ],
        system,
    };

    // Anthropic-compatible endpoint (configurable; defaults to z.ai)
    let response = client
        .post(format!("{}/v1/messages", resolve_ai_base()))
        .header(auth_header, auth_value)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Failed to call z.ai vision API: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("z.ai vision API error: {} - {}", status, error_body));
    }

    let claude_response: ClaudeResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse z.ai vision response: {}", e))?;

    if claude_response.content.is_empty() {
        return Err("Empty response from z.ai vision API".to_string());
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
    // New field for attachment suggestions
    pub attachment_requests: Vec<AttachmentRequest>,
    // Deadline extracted from email (e.g. "2025-02-15", "next Friday", "March 1st")
    pub deadline: Option<String>,
    // Detected tone of the sender (e.g. "frustrated", "friendly", "urgent", "neutral")
    pub sender_tone: Option<String>,
    // Life intelligence data extracted from email
    pub life_data: Vec<LifeDataItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentRequest {
    pub keyword: String, // e.g., "resume", "transcript", "invoice"
    pub file_type: Option<String>, // e.g., "pdf", "docx"
    pub description: String, // e.g., "They want your resume"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LifeDataItem {
    #[serde(default, alias = "type")]
    pub data_type: String,        // "subscription" | "bill" | "travel" | ... (model sometimes emits "type")
    #[serde(default)]
    pub title: String,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub date: Option<String>,     // renewal/due/delivery/departure date
    pub end_date: Option<String>, // travel return dates
    pub frequency: Option<String>,// "monthly", "yearly", "one-time", null
    pub details: Option<String>,  // confirmation #, tracking URL, etc.
    pub tracking_number: Option<String>,
    pub carrier: Option<String>,  // shipping carrier or airline
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
    #[serde(default = "default_event_type")]
    pub event_type: String, // "meeting" | "event"
    pub location: Option<String>,
}

fn default_event_type() -> String {
    "meeting".to_string()
}

#[command]
pub async fn analyze_email_claude(request: AnalyzeEmailRequest) -> Result<AnalyzeEmailResponse, String> {
    let system_prompt = r#"You are Aiden, an intelligent email assistant. Your job is to analyze emails and extract:
1. Questions the sender needs answers to
2. Whether a reply is needed and why
3. The appropriate tone (formality 0-100)
4. Whether this is a meeting request
5. Any missing attachments mentioned
6. What attachments the sender is requesting (keywords and file types)

Always respond with valid JSON only."#;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let prompt = format!(
        r#"Analyze this email and respond with ONLY valid JSON (no markdown, no explanation):

Today's date: {}
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
    "event_type": "meeting",
    "proposed_times": [],
    "duration_minutes": 60,
    "subject": "Meeting/event subject extracted from email",
    "location": null
  }},
  "missing_attachment_warning": null,
  "mentioned_document_types": [],
  "attachment_requests": [
    {{"keyword": "resume", "file_type": "pdf", "description": "They want your resume"}},
    {{"keyword": "transcript", "file_type": null, "description": "They're asking for your transcript"}}
  ],
  "deadline": null,
  "sender_tone": "neutral",
  "life_data": [
    {{"data_type": "subscription", "title": "Annual Membership", "amount": 50, "currency": "USD", "frequency": "yearly", "details": "Renews Friday at midnight"}},
    {{"data_type": "travel", "title": "Mom visiting", "date": "2026-08-12", "end_date": "2026-08-19", "details": "Delta flight DL 482"}}
  ]
}}

Guidelines:
- Questions: Extract questions, decisions needed, AND implicit requests for input/deliverables from the email. Include:
  1. Direct questions ("What is the status?")
  2. Requests for documents/files ("Send me the report", "Can you share the file?")
  3. Requests for status/updates ("Need an update on X")
  4. Decision prompts ("Can you attend?" → choice with Yes/No)
- Type: "choice" for questions with clear options (like "yes/no"), "text" for open-ended
- Formality: 0=very casual, 50=neutral, 100=very formal
- Meeting/Event: Set is_meeting=true ONLY if the user is specifically invited to a distinct scheduled occurrence or someone is requesting a specific time slot with the user.
  * event_type: "meeting" if someone wants to schedule a 1-on-1 or group meeting, or a personal appointment (doctor, dentist, etc.). "event" if it's a talk, seminar, workshop, webinar, lecture, presentation, panel, networking event, office hours, or any distinct scheduled event the user is invited to attend.
  * EXCLUSION: Do NOT set is_meeting=true for newsletters or marketing emails that merely MENTION events. But DO set is_meeting=true for: company-wide meetings (all-hands, town halls), internal events, workshops/talks the user is invited to attend, any event with a specific RSVP request.
  * proposed_times: For meetings, extract proposed times like "Tuesday at 2pm". For events, extract the event datetime in ISO format (e.g. "2026-02-27T11:30:00"). ALWAYS include the year based on context (use the current year if not specified).
  * duration_minutes: Best guess (60 default for meetings, 90 for talks/seminars, adjust based on context).
  * subject: The event/meeting name (e.g. "Mindset Management with Robin Barstow").
  * location: Extract venue/room/link if mentioned, null otherwise.
  IMPORTANT: Events are NOT deadlines. A talk on Feb 27 is an event to attend, not a deadline.
  NOT events/meetings: Newsletters, digests, and marketing emails that merely MENTION events/dates are NOT meetings or events. Only set is_meeting=true if the email is specifically INVITING the user to attend something or scheduling a meeting with the user. A newsletter saying "WWDC is June 10" is just information, not an event invite.
  Also NOT events/meetings: Travel confirmations (flights, hotel bookings, rental cars), shipping/delivery notifications, receipts, and transactional emails. A flight booking is logistics, not an event to "attend".
  Also NOT events/meetings: Government summons (jury duty, court dates), scheduling polls/Doodle links (these are requests for availability, not meeting invites), recruiter outreach mentioning "let's chat" without proposing a time, and emails that just mention meetings in passing without scheduling one. "Let me know by Friday" is a deadline, not a meeting.
- Missing attachment: Warn if they mention "attached", "attaching", "enclosed", "see attachment" but has_attachments is false. Always flag this — it likely means the sender forgot to attach.
- Document types: List mentioned file types (resume, PDF, etc.)
- Attachment requests: Extract files/documents they're asking for. For each, identify:
  * keyword: The main thing they're asking for (e.g., "resume", "portfolio", "transcript", "cover letter")
  * file_type: Specific format if mentioned (pdf, docx, xlsx, jpg), or null if not specified
  * description: Brief description of what they want

- Sender tone: Detect the emotional tone of the email. Choose EXACTLY ONE of: "friendly", "neutral", "professional", "formal", "casual", "urgent", "direct", "apologetic", "excited", "grateful", "anxious", "frustrated", "angry", "demanding", "passive-aggressive", "sarcastic", "annoyed", "sympathetic", "compassionate", "warm". For government/automated emails, use "formal" or "neutral". This will be used to adapt the reply tone.
- Deadline: Extract a deadline ONLY if the user personally must complete an action BY that date or face a consequence (missing out, late penalty, expiration). This includes payment due dates, warranty expirations, contract renewal deadlines, and registration closing dates. Use ISO format (YYYY-MM-DD). Set to null if no deadline applies.
  CRITICAL HALLUCINATION CHECK: Do NOT set a deadline unless a specific date or day is written in the email text AND it represents an action cutoff.
  * DEADLINE NULL: "ASAP", "urgent", "soon", "immediately" WITHOUT a date → null. Appointment dates, prescription pickups, event start times, flight departures → null (these are events, not deadlines). Phishing/scam emails claiming fake urgency → null.
  * VALID DEADLINE: "by end of day", "by today", "by Friday", "due March 5", "payment due by X", "warranty expires on X", "respond by X".
  A deadline is a CUTOFF DATE for the user's action — not the event itself. Look for any language implying a closing window: "by", "before", "due", "closes on", "closing of", "no later than", "last day to", "must be done by", "reminder to [do X] before [date]".
  YES — these ARE deadlines: application submission deadlines, RSVP-by dates, payment due dates, "please respond by Friday", "schedule a meeting by end of week", renewal dates requiring a decision, registration closing dates, "submit your report by March 1st", filing deadlines, "declare your intent before the closing of X on [date]", any "reminder to do X before [date]", sign-up/enrollment windows closing on a date, form submission cutoffs.
  NO — these are NOT deadlines: meeting times/invites (a meeting on Tuesday is not a deadline — it's an event), event start dates (conferences, webinars, concerts, talks, seminars, workshops, presentations), sale end dates, shipping/delivery ETAs, informational date mentions, dates in newsletters, someone else's deadline mentioned in passing, FYI dates with no required action. "Confirm your attendance by EOD" for a meeting invite is part of the RSVP, not a separate deadline — set is_meeting=true instead. If it's an event someone can attend, set it as a meeting_request with event_type "event" instead of a deadline.
  KEY DISTINCTION: "Let's meet Tuesday at 2pm" → NOT a deadline (it's a meeting time). "Please confirm your attendance by Monday" → IS a deadline (action required by cutoff). "The conference is March 15" → NOT a deadline. "Register for the conference by March 10" → IS a deadline. "Group formation closes on Friday, March 13th" → IS a deadline (March 13th). "Declare your intent before [date]" → IS a deadline.
  IMPORTANT: When you detect a deadline, you MUST set this field. Do not just classify as Urgent without also extracting the deadline date. If an email is time-sensitive because of a specific date, always extract that date here.
  For "by end of day", "by today", "by close of business" — use today's date as the deadline. But "ASAP", "immediately", "right now" WITHOUT a specific date → set deadline to null.
  YEAR INFERENCE: If the email says "March 13" or "Friday" with no year, use the NEXT upcoming occurrence based on Today's date. For example, if today is 2026-02-24 and the email says "March 13", the deadline is 2026-03-13 (NOT 2025-03-13). Never output a past date unless the email explicitly states a past year.
  Do NOT extract deadlines that have already passed, unless the email explicitly provides a new/extended deadline.
  Ignore "respond within X business days" or similar boilerplate in email signatures/footers.

- Life data: Extract structured life-intelligence items. Each item MUST include a "data_type" field (use exactly "data_type", not "type") and a short "title", then any relevant fields. Also capture personal milestones (a move, a job/career change, a graduation, family news) using data_type "move" / "career" / "family" with date + details. Types include:
  * "subscription" — recurring services (Netflix, Spotify, gym memberships, SaaS). Include amount, currency, frequency, renewal date.
  * "bill" — one-time or recurring bills/invoices (utilities, rent, insurance). Include amount, currency, date (due date), frequency.
  * "travel" — flights, hotel bookings, trip confirmations. Include carrier (airline/hotel), date (departure), end_date (return), confirmation_number (record locator, booking ref, e-ticket number e.g. "XYZ789"), details.
  * "package" — shipping/delivery notifications. Include carrier (UPS, FedEx, USPS, Amazon), tracking_number, date (delivery date), details (item description).
  * "order" — e-commerce order confirmations (Amazon, etc.). Include confirmation_code, order_number, details.
  * "purchase" — digital purchases or receipts (App Store, etc.). Include amount, currency, date, details (item name).
  * "insurance" — insurance claims, policy changes, coverage notices. Include amount, currency, date, details (claim #, policy info).
  * "financial" — tax refunds, deposits, bank notifications, investment updates. Include amount, currency, date, details.
  * "deadline" — any actionable cutoff date requiring the user's action (application deadlines, payment due dates, renewal deadlines, RSVP-by dates, respond-by dates). NOT event/meeting times. Always include here even if also set in the top-level deadline field. Include date, details.
  Only include items with clear, concrete data. Do not fabricate amounts or dates. Leave fields null if not explicitly stated in the email.

IMPORTANT - Set requires_reply to FALSE for:
- Newsletters, marketing emails, notifications, or automated emails
- Mass marketing or promotional emails (conference early birds, sale announcements, webinars) even if they contain rhetorical calls-to-action like "Register now" or "Buy tickets". These are not personal requests.
- Emails that are purely informational with no questions asked
- Receipts, confirmations, order updates, or shipping notifications
- Emails from noreply/automated addresses
- Emails from known senders like "NYT Cooking", "Substack", newsletters, mailing lists, etc.
- CC'd emails where someone else is the primary recipient or already answered
- GitHub/Jira/Slack/social media notifications
- Promotional or sale emails
- When in doubt, default to FALSE — it is better to miss a reply than to falsely nag the user

Set requires_reply to TRUE ONLY for:
- A real person directly asking the user a question and expecting an answer
- Meeting requests that need a yes/no
- Explicit requests for the user's input, approval, deliverables, or action
- Messages where ignoring would be socially or professionally inappropriate
- Code review requests (e.g. GitHub PR review requested — the reviewer is expected to act)
- Emails asking the user to send files, documents, or attachments
- Emails where the sender mentions "attached" but no attachments are present (user should let them know)
- Condolence, sympathy, or deeply personal messages where not responding would be inappropriate
- Vendor quotes, proposals, or bids that need a decision/acceptance
- Calendar invites (Google Calendar, Outlook) where the user needs to accept/decline
- Scheduling polls (Doodle, When2meet) where the user should vote"#,
        today, request.sender, request.subject, request.body_text, request.has_attachments
    );

    let response = call_claude_api_with_system(prompt, Some(system_prompt.to_string())).await?;

    // Extract JSON from response (in case there's markdown or extra text)
    let json_str = extract_json_from_response(&response)?;

    let parsed: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON response: {}. Response was: {}", e, response))?;

    let questions: Vec<Question> = serde_json::from_value(parsed["questions"].clone())
        .unwrap_or_default();

    let suggested_formality_score = parsed["suggested_formality_score"].as_i64().unwrap_or(50) as i32;
    let requires_reply = parsed["requires_reply"].as_bool().unwrap_or(false);
    let reply_reasoning = parsed["reply_reasoning"].as_str().unwrap_or("").to_string();

    let meeting_request: Option<MeetingRequest> = parsed["meeting_request"].as_object()
        .and_then(|v| serde_json::from_value(serde_json::Value::Object(v.clone())).ok())
        .filter(|m: &MeetingRequest| m.is_meeting);

    let missing_attachment_warning = parsed["missing_attachment_warning"].as_str()
        .map(|s| s.to_string());

    let mentioned_document_types: Vec<String> = parsed["mentioned_document_types"].as_array()
        .and_then(|arr| serde_json::from_value(serde_json::Value::Array(arr.clone())).ok())
        .unwrap_or_default();

    let attachment_requests: Vec<AttachmentRequest> = parsed["attachment_requests"].as_array()
        .and_then(|arr| serde_json::from_value(serde_json::Value::Array(arr.clone())).ok())
        .unwrap_or_default();

    let deadline = parsed["deadline"].as_str()
        .map(|s| s.to_string());

    let sender_tone = parsed["sender_tone"].as_str()
        .map(|s| s.to_string());

    let life_data: Vec<LifeDataItem> = parsed["life_data"].as_array()
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
        attachment_requests,
        deadline,
        sender_tone,
        life_data,
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
    // New fields for context and learned tone
    pub conversation_context: Option<ConversationContext>,
    pub learned_writing_style: Option<RecipientWritingStyle>,
    // Detected tone of the sender's email (from analysis)
    pub sender_tone: Option<String>,
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
    // Initialize writing styles storage
    init_writing_styles();

    // Build enhanced system prompt with learned writing style if available
    let base_system_prompt = r#"You are Aiden, an intelligent email assistant. You write professional, contextually appropriate email replies.
Keep replies concise and natural. Match the requested formality level."#;

    let system_prompt = if let Some(style) = &request.learned_writing_style {
        format!(
            r#"{}{}

LEARNED WRITING STYLE FOR THIS RECIPIENT:
- Recipient: {}
- Tone: {} (formality: {}/100)
- Common phrases you use with them: {}
- Your greeting style: {}
- Your sign-off style: {}
- Based on {} previous emails

Incorporate this learned style naturally into your reply while respecting the user's requested formality level."#,
            base_system_prompt,
            request.sender,
            style.recipient_email,
            style.tone_description,
            style.formality_score,
            style.common_phrases.join(", "),
            style.greeting_style,
            style.sign_off_style,
            style.sample_count
        )
    } else {
        base_system_prompt.to_string()
    };

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

    let tone_section = request.sender_tone
        .as_ref()
        .map(|t| format!("\nSENDER'S TONE: {} — Adapt your reply tone accordingly. For example, if frustrated/angry, be empathetic and solution-oriented. If excited, match their enthusiasm. If formal, stay formal.", t))
        .unwrap_or_default();

    // Build conversation history section if available
    let conversation_history_section = if let Some(ctx) = &request.conversation_context {
        if !ctx.previous_emails.is_empty() {
            let history: String = ctx.previous_emails.iter()
                .take(5) // Limit to last 5 emails for context
                .map(|email| {
                    let role = if email.is_from_user { "You" } else { "Them" };
                    format!(
                        "{} ({})\nSubject: {}\n{}",
                        role,
                        email.date,
                        email.subject,
                        if email.body.len() > 200 {
                            format!("{}...", &email.body[..200])
                        } else {
                            email.body.clone()
                        }
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!(
                "\nCONVERSATION HISTORY ({} emails total, showing most recent):\n{}\n",
                ctx.total_conversation_count,
                history
            )
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let prompt = format!(
        r#"Write a reply to this email.

ORIGINAL EMAIL:
From: {}
Subject: {}
Body: {}
{}

MY ANSWERS TO QUESTIONS:
{}

{}

{}
{}

REQUIREMENTS:
- Formality: {}
- Keep it concise (2-4 sentences typically)
- Be professional but natural
- Include "Re: " in the subject line
- Reference the conversation history naturally if relevant
- Return ONLY a JSON object with "reply" and "subject" fields

Response format:
{{
  "reply": "Your email reply here...",
  "subject": "Re: {}"
}}"#,
        request.sender,
        request.subject,
        request.body_text,
        conversation_history_section,
        answers_section,
        context_section,
        meeting_section,
        tone_section,
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

    // Extract JSON (handles markdown-wrapped responses)
    let json_str = extract_json_from_response(&response)
        .map_err(|_| format!("Invalid JSON response from Claude: {}", &response[..200.min(response.len())]))?;

    let parsed: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|_| "Failed to parse extracted JSON".to_string())?;

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
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let prompt = format!(
        r#"Classify this email's priority. Be CONSERVATIVE — most emails are "normal". Only escalate when truly warranted.

Today's date: {}
From: {}
Subject: {}
Content: {}

Respond in JSON format:
{{
  "category": "urgent|important|normal|low",
  "confidence": 0.95,
  "requires_reply": true,
  "can_auto_archive": false
}}

STRICT classification rules:

"urgent" — ONLY use when ALL of these are true:
  - Immediate time pressure (within 24-48 hours: "ASAP", "immediately", "today", "tomorrow", due date is tomorrow or today)
  - Requires the user's personal action (not just FYI about something time-sensitive)
  - From a real person or organization that matters (not automated/marketing)
  NOT urgent: Automated reminders (doctor appointments, subscription renewals), standard professional requests, 2FA/verification codes, password reset emails, or transactional notifications.
  Examples: "Your rent is due tomorrow", boss asking for something ASAP, interview time confirmation needed today
  NOT urgent: Deadlines more than 2 days away (those are "important"), sale ending soon, shipping updates, social media notifications, event reminders, 2FA codes, password resets

"important" — Requires the user's personal action or decision, but not immediately:
  - Direct questions from real people expecting a response
  - Requests for your input, approval, or deliverables
  - Financial matters needing action (bills, account issues)
  - Deadlines or closing dates more than 2 days away (e.g. "submit by next Friday", "group formation closes March 13th")
  - Scheduled interviews, confirmed meetings, or calendar invites the user needs to attend or prepare for
  Examples: Colleague asking for feedback, invoice requiring payment this week, job application follow-up, registration deadline next week, interview confirmation, scheduled meeting with Zoom link
  NOT important: Newsletters from important sources, FYI updates from work tools, read receipts

"normal" — Default category. Regular emails that may or may not need action:
  - General correspondence, updates, informational emails
  - Emails where it's unclear if a reply is expected
  When in doubt, classify as "normal"

"low" — Clearly does not need attention:
  - Newsletters, marketing, promotions, digests
  - Automated notifications that are purely informational (Slack digests, social media, CI build notifications)
  - Receipts, order confirmations, shipping updates, travel confirmations (informational only)
  - Password resets, 2FA codes, verification emails
  - Mailing lists where user is just a subscriber
  NOTE: GitHub PR review requests and Jira tickets assigned to the user are NOT "low" — they require action. Only purely informational notifications (e.g. "someone pushed to main") are low.

requires_reply rules:
  - TRUE only if the sender is a real person directly asking the user to respond, provide info, or take action
  - TRUE for: code review requests (e.g. GitHub PR review requested), emails asking the user to send files/documents/attachments, emails where the sender mentions attaching something but the attachment is missing (user should notify them)
  - FALSE for: newsletters, marketing emails, automated notifications (EXCEPT review requests), receipts, confirmations, FYI updates, CC'd emails where someone else is the primary recipient, Slack/Jira/LinkedIn notifications that are purely informational
  - When in doubt, set FALSE — it's better to miss a reply prompt than to nag about newsletters"#,
        today, sender, subject, email_content
    );

    let response = call_claude_api(prompt).await?;

    let json_str = extract_json_from_response(&response)
        .map_err(|_| format!("Invalid JSON response from Claude: {}", &response[..200.min(response.len())]))?;

    let parsed: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|_| "Failed to parse extracted JSON".to_string())?;

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

    let json_str = extract_json_from_response(&response)
        .map_err(|_| format!("Invalid JSON response from Claude: {}", &response[..200.min(response.len())]))?;

    let parsed: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|_| "Failed to parse extracted JSON".to_string())?;

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

// ==================== ATTACHMENT ANALYSIS ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyzeAttachmentRequest {
    pub filename: String,
    pub attachment_data: String, // base64 encoded
    pub mime_type: String,
    pub email_subject: Option<String>,
    pub email_sender: Option<String>,
    pub email_body: Option<String>, // for context
    pub email_summary: Option<String>, // pre-generated email summary for context
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyzedAttachment {
    pub summary: String,
    pub key_points: Vec<String>,
    pub action_items: Vec<String>,
}

#[command]
pub async fn analyze_attachment_claude(request: AnalyzeAttachmentRequest) -> Result<AnalyzedAttachment, String> {
    let system_prompt = r#"You are Aiden, an intelligent email assistant. Analyze email attachments and provide:
1. A concise 2-3 sentence summary of what the attachment contains
2. Key points extracted from the attachment content
3. Any action items, dates, deadlines, or important information

Focus primarily on the attachment's actual content. Use the email context only as secondary information for better understanding."#;

    // Build email context section
    let email_context = if let Some(summary) = &request.email_summary {
        format!(
            "\nEmail Context:\nSubject: {}\nFrom: {}\nEmail Summary: {}",
            request.email_subject.as_deref().unwrap_or("N/A"),
            request.email_sender.as_deref().unwrap_or("N/A"),
            summary
        )
    } else if request.email_subject.is_some() || request.email_sender.is_some() {
        format!(
            "\nEmail Context:\nSubject: {}\nFrom: {}",
            request.email_subject.as_deref().unwrap_or("N/A"),
            request.email_sender.as_deref().unwrap_or("N/A")
        )
    } else {
        String::new()
    };

    // Check if this is an image type
    let is_image = request.mime_type.starts_with("image/");

    // Store mime type for later use (before it's potentially moved)
    let mime_type = request.mime_type.clone();

    let response = if is_image {
        // Use vision API for images
        let prompt = format!(
            r#"Analyze this email attachment image.

Attachment filename: {}
{}

You are analyzing an attachment. Focus primarily on describing what the image contains - any text visible, data, charts, diagrams, or other visual information.

Respond in this JSON format:
{{
  "summary": "Concise 2-3 sentence description of what the image shows",
  "key_points": ["Main point 1", "Main point 2", "Main point 3"],
  "action_items": ["Action item 1 if any", "Action item 2 if any"],
  "file_type": "{}"
}}"#,
            request.filename,
            email_context,
            mime_type
        );

        call_claude_vision_api(prompt, request.attachment_data, request.mime_type, Some(system_prompt.to_string())).await?
    } else {
        // For non-images, extract text content
        let decoded_data = base64_decode(&request.attachment_data)?;

        let text_content = if mime_type == "application/pdf" {
            // Extract text from PDF
            extract_text_from_pdf(&decoded_data).unwrap_or_else(|e| {
                format!("[Failed to extract text from PDF: {}]", e)
            })
        } else if mime_type.starts_with("text/") {
            // Plain text file
            String::from_utf8_lossy(&decoded_data).to_string()
        } else {
            // For other formats, try to decode as UTF-8
            String::from_utf8_lossy(&decoded_data).to_string()
        };

        // Check if we got meaningful text content
        let has_meaningful_content = text_content.len() > 50 &&
            !text_content.starts_with("[Failed to extract") &&
            !text_content.contains("%PDF-") &&
            !text_content.starts_with("%") &&
            text_content.chars().filter(|c| c.is_alphabetic()).count() > 20;

        let truncated_text = if text_content.len() > 12000 {
            format!("{}...(truncated)", &text_content[..12000])
        } else {
            text_content.clone()
        };

        let prompt = if has_meaningful_content {
            // We have extracted text - analyze the actual content
            format!(
                r#"You are analyzing an email attachment. Focus primarily on the attachment's content.

Attachment: {} ({}){}

Analyze the attachment content and provide:

Respond in this JSON format:
{{
  "summary": "Concise 2-3 sentence summary of the attachment's actual content",
  "key_points": ["Main point 1", "Main point 2", "Main point 3"],
  "action_items": ["Action item 1 if any", "Action item 2 if any"],
  "file_type": "{}"
}}

Attachment content to analyze:
{}"#,
                request.filename,
                mime_type,
                email_context,
                mime_type,
                truncated_text
            )
        } else {
            // No meaningful text extracted - provide generic analysis based on filename and context
            format!(
                r#"You are analyzing an email attachment. The attachment could not have its text content extracted (possibly a scanned PDF, image-based document, or unsupported format).

Attachment: {} ({}){}

Based on the filename, file type, and email context, provide your best assessment of what this attachment likely contains.

Respond in this JSON format:
{{
  "summary": "Best guess summary based on filename and email context",
  "key_points": ["Likely point 1", "Likely point 2"],
  "action_items": ["Possible action 1 if any"],
  "file_type": "{}"
}}"#,
                request.filename,
                mime_type,
                email_context,
                mime_type
            )
        };

        call_claude_api_with_system(prompt, Some(system_prompt.to_string())).await?
    };

    let json_str = extract_json_from_response(&response)?;

    let parsed: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON response: {}. Response was: {}", e, response))?;

    let summary = parsed["summary"].as_str()
        .ok_or("Missing summary in response")?
        .to_string();

    let key_points: Vec<String> = parsed["key_points"].as_array()
        .and_then(|arr| serde_json::from_value(serde_json::Value::Array(arr.clone())).ok())
        .unwrap_or_default();

    let action_items: Vec<String> = parsed["action_items"].as_array()
        .and_then(|arr| serde_json::from_value(serde_json::Value::Array(arr.clone())).ok())
        .unwrap_or_default();

    Ok(AnalyzedAttachment {
        summary,
        key_points,
        action_items,
    })
}

// Helper to decode base64
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

// Helper to extract text from PDF bytes
fn extract_text_from_pdf(pdf_data: &[u8]) -> Result<String, String> {
    use pdf_extract::extract_text_from_mem;

    extract_text_from_mem(pdf_data)
        .map_err(|e| format!("PDF extraction error: {}", e))
        .map(|s| s.trim().to_string())
}

// ==================== WRITING STYLE LEARNING ====================

#[command]
pub async fn save_recipient_writing_style(style: RecipientWritingStyle) -> Result<(), String> {
    init_writing_styles();
    let mut styles = WRITING_STYLES.lock().unwrap();
    styles.insert(style.recipient_email.clone(), style);
    drop(styles);
    save_writing_styles_to_disk();
    Ok(())
}

#[command]
pub async fn get_recipient_writing_style(recipient_email: String) -> Result<Option<RecipientWritingStyle>, String> {
    init_writing_styles();
    let styles = WRITING_STYLES.lock().unwrap();
    Ok(styles.get(&recipient_email).cloned())
}

#[command]
pub async fn analyze_and_save_writing_style(
    recipient_email: String,
    sent_emails_bodies: Vec<String>,
) -> Result<RecipientWritingStyle, String> {
    if sent_emails_bodies.is_empty() {
        return Err("No emails provided for analysis".to_string());
    }

    let emails_text = sent_emails_bodies.iter()
        .take(10) // Analyze up to 10 recent emails
        .enumerate()
        .map(|(i, email)| format!("Email {}:\n{}\n", i + 1, email))
        .collect::<String>();

    let prompt = format!(
        r#"Analyze the writing style from these sent emails to a specific recipient.

{}

Respond in JSON format:
{{
  "tone_description": "e.g., 'Professional but friendly', 'Casual and warm', 'Formal and direct'",
  "formality_score": 50,
  "common_phrases": ["phrase1", "phrase2", "phrase3"],
  "greeting_style": "e.g., 'Hi [Name]', 'Hey [Name]', 'Dear [Name]'",
  "sign_off_style": "e.g., 'Best,', 'Thanks,' 'Regards,'"
}}

Analyze:
- Overall tone in 2-3 words
- Formality score (0=very casual, 100=very formal)
- Common phrases or expressions used with this recipient
- Typical greeting pattern
- Typical sign-off pattern"#,
        emails_text
    );

    let response = call_claude_api(prompt).await?;

    let json_str = extract_json_from_response(&response)?;
    let parsed: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON response: {}", e))?;

    let tone_description = parsed["tone_description"].as_str()
        .unwrap_or("Neutral")
        .to_string();

    let formality_score = parsed["formality_score"].as_i64()
        .unwrap_or(50) as i32;

    let common_phrases: Vec<String> = parsed["common_phrases"].as_array()
        .and_then(|arr| serde_json::from_value(serde_json::Value::Array(arr.clone())).ok())
        .unwrap_or_default();

    let greeting_style = parsed["greeting_style"].as_str()
        .unwrap_or("Hi [Name]")
        .to_string();

    let sign_off_style = parsed["sign_off_style"].as_str()
        .unwrap_or("Best,")
        .to_string();

    let now = chrono::Utc::now().to_rfc3339();

    let style = RecipientWritingStyle {
        recipient_email: recipient_email.clone(),
        tone_description,
        formality_score,
        common_phrases,
        greeting_style,
        sign_off_style,
        sample_count: sent_emails_bodies.len() as i32,
        last_updated: now,
    };

    // Save the style
    save_recipient_writing_style(style.clone()).await?;

    Ok(style)
}

// ==================== CONVERSATION CONTEXT ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct GetConversationContextRequest {
    pub recipient_email: String,
    pub current_email_id: Option<String>, // Exclude current email from history
    pub limit: Option<i32>, // Max emails to return
}

#[command]
pub async fn get_conversation_context_from_emails(
    recipient_email: String,
    all_emails: Vec<serde_json::Value>,
    current_email_id: Option<String>,
    limit: Option<i32>,
) -> Result<ConversationContext, String> {
    let limit = limit.unwrap_or(10);

    // Filter emails to/from this recipient
    let mut conversation_emails: Vec<ConversationEmail> = all_emails
        .into_iter()
        .filter(|email| {
            // Skip current email
            if let Some(current_id) = &current_email_id {
                if email.get("id").and_then(|v| v.as_str()) == Some(current_id.as_str()) {
                    return false;
                }
            }

            // Check if sender or recipient matches
            let sender = email.get("sender").and_then(|v| v.as_str()).unwrap_or("");
            let from = email.get("from").and_then(|v| v.as_str());
            let to = email.get("to").and_then(|v| v.as_str());
            let recipients = email.get("recipients").and_then(|v| v.as_str());

            sender == &recipient_email ||
            from == Some(recipient_email.as_str()) ||
            to == Some(recipient_email.as_str()) ||
            recipients == Some(recipient_email.as_str())
        })
        .map(|email| {
            let subject = email.get("subject").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let sender = email.get("sender").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let body = email.get("body_text")
                .and_then(|v| v.as_str())
                .or_else(|| email.get("snippet").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            let date = email.get("date")
                .or_else(|| email.get("timestamp"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Determine if this is from the user (sent email) or received
            let is_from_user = email.get("is_sent")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            ConversationEmail {
                subject,
                sender,
                body,
                date,
                is_from_user,
            }
        })
        .collect();

    // Sort by date (most recent first) and limit
    conversation_emails.sort_by(|a, b| b.date.cmp(&a.date));
    conversation_emails.truncate(limit as usize);

    let total_count = conversation_emails.len() as i32;

    Ok(ConversationContext {
        recipient_email,
        previous_emails: conversation_emails,
        total_conversation_count: total_count,
    })
}

// ==================== CONTACT CLASSIFICATION ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactClassifyInput {
    pub email_address: String,
    pub name: Option<String>,
    pub domain: Option<String>,
    pub emails_received: i64,
    pub emails_sent: i64,
    pub sample_subjects: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactClassifyResult {
    pub email_address: String,
    pub category: String,
}

#[command]
pub async fn classify_contacts_batch(contacts: Vec<ContactClassifyInput>) -> Result<Vec<ContactClassifyResult>, String> {
    if contacts.is_empty() {
        return Ok(vec![]);
    }

    // Build a concise summary of each contact for classification
    let mut contacts_text = String::new();
    for (i, contact) in contacts.iter().enumerate() {
        contacts_text.push_str(&format!(
            "{}. {} ({})\n   Domain: {}\n   Emails received: {}, sent: {}\n   Sample subjects: {}\n\n",
            i + 1,
            contact.name.as_deref().unwrap_or("Unknown"),
            contact.email_address,
            contact.domain.as_deref().unwrap_or("unknown"),
            contact.emails_received,
            contact.emails_sent,
            if contact.sample_subjects.is_empty() {
                "none".to_string()
            } else {
                contact.sample_subjects.join(" | ")
            }
        ));
    }

    let prompt = format!(
        r#"Classify each contact into exactly ONE category based on their email address, domain, name, communication pattern, and email subjects.

Categories:
- Colleague (coworker, classmate, team member, professor, university staff)
- Client (customer, someone you provide services to)
- Vendor (service provider, company you buy from, subscriptions)
- Friend (personal contact, non-work relationship)
- Family (family member)
- Other (newsletters, automated emails, unknown)

Contacts to classify:
{}

Respond with valid JSON only - an array of objects with "email_address" and "category":
[
  {{"email_address": "example@domain.com", "category": "Colleague"}},
  ...
]

Rules:
- .edu addresses are usually Colleague (classmate, professor, staff) unless the name or subjects clearly show a newsletter or automated sender.
- Brands, companies, stores, airlines, banks, publications, and any newsletter / mailing-list / automated / no-reply sender are NEVER Friend or Family. Use Vendor for a company you buy from or subscribe to, and Other for newsletters, mailing lists, and automated mail.
- Use Family ONLY when the contact is clearly a family member (e.g. shares a surname and personal subjects). A brand or newsletter name like "NYT Cooking" is NOT Family — it is Other.
- Use Friend ONLY for a real individual person with a personal, non-work relationship.
- When uncertain, use Other. Prefer Other over guessing a personal category.
- Only use the exact category names listed above."#,
        contacts_text
    );

    let response = call_claude_api(prompt).await?;

    let json_str = extract_json_from_response(&response)
        .map_err(|_| format!("Failed to extract JSON from classification response"))?;

    // Try parsing as array directly
    if let Ok(results) = serde_json::from_str::<Vec<ContactClassifyResult>>(&json_str) {
        return Ok(results);
    }

    // Try parsing as a wrapper object with a results array
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
        // Look for any array in the response
        if let Some(arr) = val.as_array() {
            let results: Vec<ContactClassifyResult> = arr.iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect();
            if !results.is_empty() {
                return Ok(results);
            }
        }
    }

    Err("Failed to parse classification response".to_string())
}