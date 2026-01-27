use tauri::command;
use sqlx::{FromRow, Sqlite, Pool};
use crate::models::{
    Contact, Thread, FollowUpReminder, EmailTemplate, SuggestedAction,
    ContactInsights, ThreadHealthSummary, ThreadHealthByContact,
    ReminderSuggestion,
};

// ============================================
// ROW TYPES - For database queries
// ============================================

#[derive(FromRow)]
struct ContactRow {
    id: String,
    email_address: String,
    display_name: Option<String>,
    first_seen_at: i64,
    last_emailed_at: Option<i64>,
    last_received_from_at: Option<i64>,
    total_emails_sent: i32,
    total_emails_received: i32,
    total_threads: i32,
    avg_response_time_minutes: Option<f64>,
    response_rate: Option<f64>,
    is_vip: i32,
    notes: Option<String>,
    tags: String,
    created_at: i64,
    updated_at: i64,
}

impl From<ContactRow> for Contact {
    fn from(row: ContactRow) -> Self {
        Contact {
            id: row.id,
            email_address: row.email_address,
            display_name: row.display_name,
            first_seen_at: row.first_seen_at,
            last_emailed_at: row.last_emailed_at,
            last_received_from_at: row.last_received_from_at,
            total_emails_sent: row.total_emails_sent,
            total_emails_received: row.total_emails_received,
            total_threads: row.total_threads,
            avg_response_time_minutes: row.avg_response_time_minutes,
            response_rate: row.response_rate,
            is_vip: row.is_vip != 0,
            notes: row.notes,
            tags: serde_json::from_str(&row.tags).unwrap_or_default(),
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(FromRow)]
struct ThreadRow {
    id: String,
    gmail_thread_id: String,
    subject: String,
    participants: String,
    last_email_date: i64,
    last_email_id: String,
    status: String,
    health_score: i32,
    total_emails: i32,
    unread_count: i32,
    my_last_action_at: Option<i64>,
    their_last_action_at: Option<i64>,
}

impl From<ThreadRow> for Thread {
    fn from(row: ThreadRow) -> Self {
        Thread {
            id: row.id,
            gmail_thread_id: row.gmail_thread_id,
            subject: row.subject,
            participants: serde_json::from_str(&row.participants).unwrap_or_default(),
            last_email_date: row.last_email_date,
            last_email_id: row.last_email_id,
            status: row.status,
            health_score: row.health_score,
            total_emails: row.total_emails,
            unread_count: row.unread_count,
            my_last_action: None,
            my_last_action_at: row.my_last_action_at,
            their_last_action_at: row.their_last_action_at,
            created_at: row.last_email_date,
            updated_at: row.last_email_date,
        }
    }
}

#[derive(FromRow)]
struct ReminderRow {
    id: String,
    thread_id: String,
    email_id: String,
    contact_email: String,
    reminder_type: String,
    scheduled_for: i64,
    is_completed: bool,
    completed_at: Option<i64>,
    sent_notification: bool,
    message_suggestion: Option<String>,
    created_at: i64,
}

impl From<ReminderRow> for FollowUpReminder {
    fn from(row: ReminderRow) -> Self {
        FollowUpReminder {
            id: row.id,
            thread_id: row.thread_id,
            email_id: row.email_id,
            contact_email: row.contact_email,
            reminder_type: row.reminder_type,
            scheduled_for: row.scheduled_for,
            is_completed: row.is_completed,
            completed_at: row.completed_at,
            sent_notification: row.sent_notification,
            message_suggestion: row.message_suggestion,
            created_at: row.created_at,
        }
    }
}

#[derive(FromRow)]
struct TemplateRow {
    id: String,
    name: String,
    subject: Option<String>,
    body: String,
    category: Option<String>,
    tags: String,
    use_count: i32,
    is_ai_personalized: bool,
    created_at: i64,
    updated_at: i64,
}

impl From<TemplateRow> for EmailTemplate {
    fn from(row: TemplateRow) -> Self {
        EmailTemplate {
            id: row.id,
            name: row.name,
            subject: row.subject,
            body: row.body,
            category: row.category,
            tags: serde_json::from_str(&row.tags).unwrap_or_default(),
            use_count: row.use_count,
            is_ai_personalized: row.is_ai_personalized,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(FromRow)]
struct SuggestedActionRow {
    id: String,
    email_id: Option<String>,
    thread_id: Option<String>,
    action_type: String,
    suggestion: String,
    priority: i32,
    is_dismissed: bool,
    is_completed: bool,
    created_at: i64,
    expires_at: Option<i64>,
}

impl From<SuggestedActionRow> for SuggestedAction {
    fn from(row: SuggestedActionRow) -> Self {
        SuggestedAction {
            id: row.id,
            email_id: row.email_id,
            thread_id: row.thread_id,
            action_type: row.action_type,
            suggestion: row.suggestion,
            priority: row.priority,
            is_dismissed: row.is_dismissed,
            is_completed: row.is_completed,
            created_at: row.created_at,
            expires_at: row.expires_at,
        }
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/// Get database pool
async fn get_db_pool() -> Result<sqlx::SqlitePool, String> {
    let database_url = "sqlite:./aiden.db";
    sqlx::SqlitePool::connect(database_url)
        .await
        .map_err(|e| format!("Failed to connect to database: {}", e))
}

/// Extract email address from a sender string
fn extract_email_address(sender: &str) -> String {
    if let Some(start) = sender.find('<') {
        if let Some(end) = sender.find('>') {
            return sender[start + 1..end].to_string();
        }
    }
    sender.to_string()
}

/// Extract display name from a sender string
fn extract_display_name(sender: &str) -> Option<String> {
    if let Some(end) = sender.find('<') {
        let name = sender[..end].trim().trim_matches('"');
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    None
}

/// Generate a follow-up message based on type and days
fn generate_follow_up_message(reminder_type: &str, days: i32) -> String {
    match reminder_type {
        "gentle_nudge" => "Hi! Just wanted to follow up on our previous conversation. Let me know if you need anything from my end.".to_string(),
        "follow_up" => format!("Hi! I wanted to follow up on our conversation from {} days ago. Do you have any updates?", days),
        "deadline_passed" | "check_in" => format!("Hi! It's been {} days since we last spoke. I wanted to check in and see if there's anything you need from me.", days),
        _ => "Hi! Just following up to see if there's anything I can help with.".to_string(),
    }
}

/// Get best time to contact for analysis
async fn get_best_time_to_contact_for(email: &str, pool: &sqlx::SqlitePool) -> Result<(Option<String>, Option<i32>), String> {
    let day_names = vec!["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    // Get response rates by day
    let by_day = sqlx::query_as::<Sqlite, (i32, i64)>(
        "SELECT day_of_week, COUNT(*) as count
        FROM email_analytics
        WHERE contact_email = ? AND response_count > 0
        GROUP BY day_of_week
        ORDER BY count DESC
        LIMIT 1"
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to get best day: {}", e))?;

    let best_day = by_day.and_then(|d| day_names.get(d.0 as usize).map(|s| s.to_string()));

    // Get response rates by hour
    let by_hour = sqlx::query_as::<Sqlite, (i32, i64)>(
        "SELECT hour, COUNT(*) as count
        FROM email_analytics
        WHERE contact_email = ? AND response_count > 0
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 1"
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to get best hour: {}", e))?;

    let best_hour = by_hour.map(|h| h.0);

    Ok((best_day, best_hour))
}

// ============================================
// CONTACT COMMANDS
// ============================================

#[command]
pub async fn get_contacts() -> Result<Vec<Contact>, String> {
    let pool = get_db_pool().await?;

    let rows = sqlx::query_as::<Sqlite, ContactRow>(
        "SELECT id, email_address, display_name, first_seen_at, last_emailed_at, last_received_from_at,
               total_emails_sent, total_emails_received, total_threads, avg_response_time_minutes,
               response_rate, is_vip, notes, tags, created_at, updated_at
        FROM contacts ORDER BY last_received_from_at DESC"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch contacts: {}", e))?;

    Ok(rows.into_iter().map(|r| r.into()).collect())
}

#[command]
pub async fn get_contact(email: String) -> Result<Option<Contact>, String> {
    let pool = get_db_pool().await?;

    let row = sqlx::query_as::<Sqlite, ContactRow>(
        "SELECT id, email_address, display_name, first_seen_at, last_emailed_at, last_received_from_at,
               total_emails_sent, total_emails_received, total_threads, avg_response_time_minutes,
               response_rate, is_vip, notes, tags, created_at, updated_at
        FROM contacts WHERE email_address = ?"
    )
    .bind(&email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to fetch contact: {}", e))?;

    Ok(row.map(|r| r.into()))
}

#[command]
pub async fn update_contact(
    email: String,
    display_name: Option<String>,
    is_vip: Option<bool>,
    notes: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<Contact, String> {
    let pool = get_db_pool().await?;
    let now = chrono::Utc::now().timestamp();

    // Build dynamic update query
    let mut update_parts = vec![];

    if let Some(dn) = &display_name {
        update_parts.push(format!("display_name = '{}'", dn.replace('\'', "''")));
    }
    if let Some(v) = is_vip {
        update_parts.push(format!("is_vip = {}", if v { 1 } else { 0 }));
    }
    if let Some(n) = &notes {
        update_parts.push(format!("notes = '{}'", n.replace('\'', "''")));
    }
    if let Some(t) = &tags {
        let tags_json = serde_json::to_string(t).unwrap_or_default();
        update_parts.push(format!("tags = '{}'", tags_json.replace('\'', "''")));
    }
    update_parts.push(format!("updated_at = {}", now));

    if update_parts.len() == 1 {
        return get_contact(email).await?.ok_or("Contact not found".to_string());
    }

    let query = format!(
        "UPDATE contacts SET {} WHERE email_address = '{}'",
        update_parts.join(", "),
        email.replace('\'', "''")
    );

    sqlx::query(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to update contact: {}", e))?;

    get_contact(email).await?.ok_or("Contact not found".to_string())
}

#[command]
pub async fn get_contact_insights(email: String) -> Result<ContactInsights, String> {
    let pool = get_db_pool().await?;
    let now = chrono::Utc::now().timestamp();

    // Get contact data
    let contact_data = sqlx::query_as::<Sqlite, (i32, i32, Option<f64>, Option<f64>, Option<i64>, Option<String>)>(
        "SELECT total_emails_sent, total_emails_received, avg_response_time_minutes,
               response_rate, last_received_from_at, display_name
        FROM contacts WHERE email_address = ?"
    )
    .bind(&email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to get contact insights: {}", e))?
    .ok_or("Contact not found".to_string())?;

    let (sent, received, avg_response, response_rate, last_contact, display_name) = contact_data;

    // Get threads awaiting reply for this contact
    let awaiting_result = sqlx::query_as::<Sqlite, (i64,)>(
        "SELECT COUNT(*) FROM threads t
        JOIN emails e ON t.last_email_id = e.id
        WHERE t.status = 'awaiting_reply'
        AND e.sender LIKE ?"
    )
    .bind(format!("%{}%", email))
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to get awaiting threads: {}", e))?;

    let email_ratio = if received > 0 { sent as f64 / received as f64 } else { sent as f64 };
    let days_since = last_contact.map(|t| (now - t) / 86400);

    // Find best time to contact
    let (best_day, best_hour) = get_best_time_to_contact_for(&email, &pool).await?;

    Ok(ContactInsights {
        email_address: email,
        display_name,
        total_emails_sent: sent,
        total_emails_received: received,
        email_ratio,
        avg_response_time_minutes: avg_response,
        response_rate,
        best_day_to_contact: best_day,
        best_hour_to_contact: best_hour,
        threads_awaiting_reply: awaiting_result.0 as i32,
        is_vip: false,
        last_interaction: last_contact,
        days_since_last_contact: days_since.map(|d| d as i32),
    })
}

#[command]
pub async fn get_all_contact_insights() -> Result<Vec<ContactInsights>, String> {
    let pool = get_db_pool().await?;

    let emails = sqlx::query_as::<Sqlite, (String,)>(
        "SELECT email_address FROM contacts ORDER BY last_received_from_at DESC LIMIT 50"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch contacts: {}", e))?;

    let mut insights = vec![];
    for contact in emails {
        if let Ok(insight) = get_contact_insights(contact.0).await {
            insights.push(insight);
        }
    }

    Ok(insights)
}

// ============================================
// THREAD COMMANDS
// ============================================

#[command]
pub async fn get_threads(
    status: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<Thread>, String> {
    let pool = get_db_pool().await?;
    let limit_val = limit.unwrap_or(50);

    let rows = if let Some(s) = status {
        sqlx::query_as::<Sqlite, ThreadRow>(
            "SELECT id, gmail_thread_id, subject, participants, last_email_date,
                    last_email_id, status, health_score, total_emails, unread_count,
                    my_last_action_at, their_last_action_at
            FROM threads WHERE status = ?
            ORDER BY last_email_date DESC
            LIMIT ?"
        )
        .bind(&s)
        .bind(limit_val)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch threads: {}", e))?
    } else {
        sqlx::query_as::<Sqlite, ThreadRow>(
            "SELECT id, gmail_thread_id, subject, participants, last_email_date,
                    last_email_id, status, health_score, total_emails, unread_count,
                    my_last_action_at, their_last_action_at
            FROM threads
            ORDER BY last_email_date DESC
            LIMIT ?"
        )
        .bind(limit_val)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch threads: {}", e))?
    };

    Ok(rows.into_iter().map(|r| r.into()).collect())
}

#[command]
pub async fn get_thread(thread_id: String) -> Result<Option<Thread>, String> {
    let pool = get_db_pool().await?;

    let row = sqlx::query_as::<Sqlite, ThreadRow>(
        "SELECT id, gmail_thread_id, subject, participants, last_email_date,
                last_email_id, status, health_score, total_emails, unread_count,
                my_last_action_at, their_last_action_at
        FROM threads WHERE id = ?"
    )
    .bind(&thread_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to fetch thread: {}", e))?;

    Ok(row.map(|r| r.into()))
}

#[command]
pub async fn update_thread_status(
    thread_id: String,
    status: String,
) -> Result<Thread, String> {
    let pool = get_db_pool().await?;
    let now = chrono::Utc::now().timestamp();

    sqlx::query("UPDATE threads SET status = ?, updated_at = ? WHERE id = ?")
        .bind(&status)
        .bind(now)
        .bind(&thread_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to update thread: {}", e))?;

    get_thread(thread_id).await?.ok_or("Thread not found".to_string())
}

#[command]
pub async fn get_thread_health_summary() -> Result<ThreadHealthSummary, String> {
    let pool = get_db_pool().await?;

    // Get thread counts by status
    let counts = sqlx::query_as::<Sqlite, (i64, i64, i64, i64)>(
        "SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
            SUM(CASE WHEN status = 'awaiting_reply' THEN 1 ELSE 0 END) as awaiting_count,
            SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) as stale_count
        FROM threads"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to get thread summary: {}", e))?;

    let (total, active, awaiting, stale) = (counts.0 as i32, counts.1 as i32, counts.2 as i32, counts.3 as i32);

    // Get unresponded threads
    let stale_threshold = chrono::Utc::now().timestamp() - (2 * 86400);
    let unresponded = sqlx::query_as::<Sqlite, (i64,)>(
        "SELECT COUNT(*) FROM threads
        WHERE their_last_action_at > ?
        AND my_last_action_at IS NULL
        AND status != 'done' AND status != 'archived'"
    )
    .bind(stale_threshold)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to get unresponded threads: {}", e))?
    .0 as i32;

    // Get health by contact - simplified query
    let by_contact = sqlx::query_as::<Sqlite, (String, Option<String>, i64, i64, i64, Option<i64>)>(
        "SELECT
            c.email_address,
            c.display_name,
            COUNT(t.id) as thread_count,
            SUM(CASE WHEN t.status = 'awaiting_reply' THEN 1 ELSE 0 END) as awaiting_count,
            COALESCE(AVG(t.health_score), 100) as avg_health,
            c.last_received_from_at
        FROM contacts c
        INNER JOIN threads t ON t.participants LIKE '%' || c.email_address || '%'
        GROUP BY c.email_address
        ORDER BY awaiting_count DESC, avg_health DESC
        LIMIT 10"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to get threads by contact: {}", e))?;

    let threads_by_health = by_contact.into_iter().map(|c| {
        let days_since = c.5.map(|t| (chrono::Utc::now().timestamp() - t) / 86400);

        ThreadHealthByContact {
            contact_email: c.0,
            contact_name: c.1,
            thread_count: c.2 as i32,
            awaiting_count: c.3 as i32,
            avg_health_score: c.4 as i32,
            last_action: None,
            days_since_last_contact: days_since.map(|d| d as i32),
        }
    }).collect();

    let avg_health = if total > 0 {
        sqlx::query_as::<Sqlite, (f64,)>("SELECT AVG(health_score) FROM threads")
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("Failed to get avg health: {}", e))?
            .0
    } else {
        0.0
    };

    Ok(ThreadHealthSummary {
        total_threads: total,
        active_threads: active,
        awaiting_reply_threads: awaiting,
        stale_threads: stale,
        unresponded_threads: unresponded,
        avg_health_score: avg_health,
        threads_by_health,
    })
}

// ============================================
// FOLLOW-UP REMINDERS
// ============================================

#[command]
pub async fn get_follow_up_reminders() -> Result<Vec<FollowUpReminder>, String> {
    let pool = get_db_pool().await?;

    let rows = sqlx::query_as::<Sqlite, ReminderRow>(
        "SELECT id, thread_id, email_id, contact_email, reminder_type, scheduled_for,
               is_completed, completed_at, sent_notification, message_suggestion, created_at
        FROM follow_up_reminders
        WHERE is_completed = false
        ORDER BY scheduled_for ASC"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch reminders: {}", e))?;

    Ok(rows.into_iter().map(|r| r.into()).collect())
}

#[command]
pub async fn create_follow_up_reminder(
    thread_id: String,
    email_id: String,
    contact_email: String,
    reminder_type: String,
    days_from_now: i32,
    message_suggestion: Option<String>,
) -> Result<FollowUpReminder, String> {
    let pool = get_db_pool().await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let scheduled_for = now + (days_from_now as i64 * 86400);

    let suggestion = message_suggestion.unwrap_or_else(|| {
        generate_follow_up_message(&reminder_type, days_from_now)
    });

    sqlx::query(
        "INSERT INTO follow_up_reminders (id, thread_id, email_id, contact_email, reminder_type, scheduled_for, message_suggestion, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&thread_id)
    .bind(&email_id)
    .bind(&contact_email)
    .bind(&reminder_type)
    .bind(scheduled_for)
    .bind(&suggestion)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create reminder: {}", e))?;

    Ok(FollowUpReminder {
        id,
        thread_id,
        email_id,
        contact_email,
        reminder_type,
        scheduled_for,
        is_completed: false,
        completed_at: None,
        sent_notification: false,
        message_suggestion: Some(suggestion),
        created_at: now,
    })
}

#[command]
pub async fn complete_reminder(reminder_id: String) -> Result<(), String> {
    let pool = get_db_pool().await?;
    let now = chrono::Utc::now().timestamp();

    sqlx::query("UPDATE follow_up_reminders SET is_completed = true, completed_at = ? WHERE id = ?")
        .bind(now)
        .bind(&reminder_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to complete reminder: {}", e))?;

    Ok(())
}

#[command]
pub async fn snooze_reminder(
    reminder_id: String,
    days: i32,
) -> Result<FollowUpReminder, String> {
    let pool = get_db_pool().await?;
    let now = chrono::Utc::now().timestamp();
    let new_scheduled_for = now + (days as i64 * 86400);

    sqlx::query("UPDATE follow_up_reminders SET scheduled_for = ? WHERE id = ?")
        .bind(new_scheduled_for)
        .bind(&reminder_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to snooze reminder: {}", e))?;

    let row = sqlx::query_as::<Sqlite, ReminderRow>(
        "SELECT id, thread_id, email_id, contact_email, reminder_type, scheduled_for,
               is_completed, completed_at, sent_notification, message_suggestion, created_at
        FROM follow_up_reminders WHERE id = ?"
    )
    .bind(&reminder_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to fetch snoozed reminder: {}", e))?;

    Ok(row.into())
}

#[command]
pub async fn get_reminder_suggestions() -> Result<Vec<ReminderSuggestion>, String> {
    let pool = get_db_pool().await?;
    let now = chrono::Utc::now().timestamp();
    let stale_threshold = now - (3 * 86400); // 3 days

    let suggestions = sqlx::query_as::<Sqlite, (String, String, String, i64, Option<i64>)>(
        "SELECT t.id, t.gmail_thread_id, t.subject, t.last_email_date, c.last_received_from_at
        FROM threads t
        JOIN contacts c ON t.participants LIKE '%' || c.email_address || '%'
        WHERE t.status = 'awaiting_reply'
        AND t.last_email_date < ?
        LIMIT 10"
    )
    .bind(stale_threshold)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to get reminder suggestions: {}", e))?;

    Ok(suggestions.into_iter().map(|s| {
        let days_since = if let Some(last) = s.4 {
            (now - last) / 86400
        } else {
            (now - s.3) / 86400
        };

        let suggestion_type = if days_since > 7 { "deadline_passed" } else { "follow_up" };

        ReminderSuggestion {
            thread_id: s.0,
            contact_email: String::new(), // Would need to extract from participants
            subject: s.2,
            days_since_last_contact: days_since as i32,
            suggestion_type: suggestion_type.to_string(),
            message: format!("No response in {} days", days_since),
            suggested_message: generate_follow_up_message(suggestion_type, days_since as i32),
        }
    }).collect())
}

// ============================================
// EMAIL TEMPLATES
// ============================================

#[command]
pub async fn get_email_templates() -> Result<Vec<EmailTemplate>, String> {
    let pool = get_db_pool().await?;

    let rows = sqlx::query_as::<Sqlite, TemplateRow>(
        "SELECT id, name, subject, body, category, tags, use_count, is_ai_personalized, created_at, updated_at
        FROM email_templates
        ORDER BY use_count DESC, created_at DESC"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch templates: {}", e))?;

    Ok(rows.into_iter().map(|r| r.into()).collect())
}

#[command]
pub async fn get_template(template_id: String) -> Result<Option<EmailTemplate>, String> {
    let pool = get_db_pool().await?;

    let row = sqlx::query_as::<Sqlite, TemplateRow>(
        "SELECT id, name, subject, body, category, tags, use_count, is_ai_personalized, created_at, updated_at
        FROM email_templates WHERE id = ?"
    )
    .bind(&template_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to fetch template: {}", e))?;

    Ok(row.map(|r| r.into()))
}

#[command]
pub async fn create_template(
    name: String,
    subject: Option<String>,
    body: String,
    category: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<EmailTemplate, String> {
    let pool = get_db_pool().await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let tags_json = serde_json::to_string(&tags.unwrap_or_default()).unwrap_or_default();

    sqlx::query(
        "INSERT INTO email_templates (id, name, subject, body, category, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&name)
    .bind(&subject)
    .bind(&body)
    .bind(&category)
    .bind(&tags_json)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create template: {}", e))?;

    get_template(id).await?.ok_or("Failed to fetch created template".to_string())
}

#[command]
pub async fn update_template(
    template_id: String,
    name: Option<String>,
    subject: Option<String>,
    body: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<EmailTemplate, String> {
    let pool = get_db_pool().await?;
    let now = chrono::Utc::now().timestamp();

    let mut update_parts = vec![];
    if let Some(n) = &name {
        update_parts.push(format!("name = '{}'", n.replace('\'', "''")));
    }
    if let Some(s) = &subject {
        update_parts.push(format!("subject = '{}'", s.replace('\'', "''")));
    }
    if let Some(b) = &body {
        update_parts.push(format!("body = '{}'", b.replace('\'', "''")));
    }
    if let Some(c) = &category {
        update_parts.push(format!("category = '{}'", c.replace('\'', "''")));
    }
    if let Some(t) = &tags {
        let tags_json = serde_json::to_string(t).unwrap_or_default();
        update_parts.push(format!("tags = '{}'", tags_json.replace('\'', "''")));
    }
    update_parts.push(format!("updated_at = {}", now));

    if update_parts.len() == 1 {
        return get_template(template_id).await?.ok_or("Template not found".to_string());
    }

    let query = format!(
        "UPDATE email_templates SET {} WHERE id = '{}'",
        update_parts.join(", "),
        template_id.replace('\'', "''")
    );

    sqlx::query(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to update template: {}", e))?;

    get_template(template_id).await?.ok_or("Failed to fetch updated template".to_string())
}

#[command]
pub async fn delete_template(template_id: String) -> Result<(), String> {
    let pool = get_db_pool().await?;

    sqlx::query("DELETE FROM email_templates WHERE id = ?")
        .bind(&template_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete template: {}", e))?;

    Ok(())
}

// ============================================
// SUGGESTED ACTIONS
// ============================================

#[command]
pub async fn get_suggested_actions() -> Result<Vec<SuggestedAction>, String> {
    let pool = get_db_pool().await?;
    let now = chrono::Utc::now().timestamp();
    let week_ago = now - (7 * 86400);

    let rows = sqlx::query_as::<Sqlite, SuggestedActionRow>(
        "SELECT id, email_id, thread_id, action_type, suggestion, priority, is_dismissed, is_completed, created_at, expires_at
        FROM suggested_actions
        WHERE is_dismissed = false AND is_completed = false
        AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY priority DESC, created_at ASC
        LIMIT 20"
    )
    .bind(week_ago)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch suggested actions: {}", e))?;

    Ok(rows.into_iter().map(|r| r.into()).collect())
}

#[command]
pub async fn dismiss_suggested_action(action_id: String) -> Result<(), String> {
    let pool = get_db_pool().await?;

    sqlx::query("UPDATE suggested_actions SET is_dismissed = true WHERE id = ?")
        .bind(&action_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to dismiss action: {}", e))?;

    Ok(())
}

#[command]
pub async fn complete_suggested_action(action_id: String) -> Result<(), String> {
    let pool = get_db_pool().await?;

    sqlx::query("UPDATE suggested_actions SET is_completed = true WHERE id = ?")
        .bind(&action_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to complete action: {}", e))?;

    Ok(())
}

// ============================================
// SYNC COMMANDS
// ============================================

#[command]
pub async fn sync_thread_from_email(email: crate::models::Email) -> Result<Thread, String> {
    let pool = get_db_pool().await?;
    let sender_email = extract_email_address(&email.sender);
    let now = chrono::Utc::now().timestamp();

    // Check if thread exists
    let existing = sqlx::query_as::<Sqlite, (String, String, i32)>(
        "SELECT id, status, total_emails FROM threads WHERE gmail_thread_id = ?"
    )
    .bind(&email.thread_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to query thread: {}", e))?;

    if let Some((id, status, total_emails)) = existing {
        // Update existing thread
        let new_total = total_emails + 1;
        let new_status = match status.as_str() {
            "archived" | "done" => status,
            "stale" => "awaiting_reply".to_string(),
            _ => "awaiting_reply".to_string(),
        };

        sqlx::query(
            "UPDATE threads SET
                last_email_date = ?,
                last_email_id = ?,
                total_emails = ?,
                status = ?,
                their_last_action_at = ?,
                updated_at = ?
            WHERE gmail_thread_id = ?"
        )
        .bind(now)
        .bind(&email.id)
        .bind(new_total)
        .bind(&new_status)
        .bind(now)
        .bind(now)
        .bind(&email.thread_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to update thread: {}", e))?;

        return get_thread(id).await?.ok_or("Thread not found".to_string());
    }

    // Create new thread
    let thread_id = uuid::Uuid::new_v4().to_string();

    let mut participants = vec![sender_email.clone()];
    for recipient in email.recipients.split(',') {
        let email_addr = extract_email_address(recipient.trim());
        if !participants.contains(&email_addr) {
            participants.push(email_addr);
        }
    }

    let participants_json = serde_json::to_string(&participants)
        .map_err(|e| format!("Failed to serialize participants: {}", e))?;

    let status = if email.requires_reply {
        "awaiting_reply"
    } else {
        "active"
    };

    sqlx::query(
        "INSERT INTO threads (
            id, gmail_thread_id, subject, participants, last_email_date, last_email_id,
            status, health_score, total_emails, unread_count,
            their_last_action_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&thread_id)
    .bind(&email.thread_id)
    .bind(&email.subject)
    .bind(&participants_json)
    .bind(now)
    .bind(&email.id)
    .bind(&status)
    .bind(100)
    .bind(1)
    .bind(0)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create thread: {}", e))?;

    get_thread(thread_id).await?.ok_or("Thread not found".to_string())
}

#[command]
pub async fn sync_contact_from_email(email: crate::models::Email) -> Result<Contact, String> {
    let pool = get_db_pool().await?;
    let sender_email = extract_email_address(&email.sender);
    let display_name = extract_display_name(&email.sender);
    let now = chrono::Utc::now().timestamp();

    // Check if contact exists
    let existing = sqlx::query_as::<Sqlite, (String, i32, i32)>(
        "SELECT id, total_emails_received, total_threads FROM contacts WHERE email_address = ?"
    )
    .bind(&sender_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to query contact: {}", e))?;

    if let Some((id, total_received, total_threads)) = existing {
        // Update existing contact
        sqlx::query(
            "UPDATE contacts SET
                last_received_from_at = ?,
                total_emails_received = ?,
                total_threads = ?,
                updated_at = ?
            WHERE email_address = ?"
        )
        .bind(now)
        .bind(total_received + 1)
        .bind(total_threads + 1)
        .bind(now)
        .bind(&sender_email)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to update contact: {}", e))?;

        return get_contact(sender_email).await?.ok_or("Contact not found".to_string());
    }

    // Create new contact
    let contact_id = uuid::Uuid::new_v4().to_string();
    let tags_json = "[]";

    sqlx::query(
        "INSERT INTO contacts (
            id, email_address, display_name, first_seen_at, last_received_from_at,
            total_emails_received, total_threads, tags, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&contact_id)
    .bind(&sender_email)
    .bind(&display_name)
    .bind(now)
    .bind(now)
    .bind(1)
    .bind(1)
    .bind(tags_json)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create contact: {}", e))?;

    get_contact(sender_email).await?.ok_or("Contact not found".to_string())
}

// ============================================
// OTHER COMMANDS
// ============================================

#[command]
pub async fn get_best_time_to_contact(contact_email: String) -> Result<ContactInsights, String> {
    get_contact_insights(contact_email).await
}
