use sqlx::{SqlitePool, Row};
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Contact {
    pub id: String,
    pub email_address: String,
    pub name: Option<String>,
    pub domain: Option<String>,
    pub first_seen: i64,
    pub last_contacted: Option<i64>,
    pub total_emails_received: i64,
    pub total_emails_sent: i64,
    pub total_threads: i64,
    pub relationship_score: f64,
    pub category: String,
    pub is_vip: bool,
    pub avg_response_time_minutes: Option<f64>,
    pub last_response_time: Option<i64>,
    pub notes: Option<String>,
    pub days_since_contact: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_score_calculation: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmailInteraction {
    pub id: String,
    pub email_id: String,
    pub contact_id: String,
    pub direction: String,
    pub timestamp: i64,
    pub response_time_minutes: Option<i64>,
    pub thread_depth: Option<i64>,
    pub was_initiator: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactNote {
    pub id: String,
    pub contact_id: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactAnalytics {
    pub contact_id: String,
    pub email_address: String,
    pub name: Option<String>,
    pub total_emails: i64,
    pub emails_sent: i64,
    pub emails_received: i64,
    pub first_contact: i64,
    pub last_contact: i64,
    pub avg_response_time_minutes: Option<f64>,
    pub response_times: Vec<i64>,
    pub interaction_frequency: Vec<InteractionFrequency>,
    pub relationship_score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InteractionFrequency {
    pub date: String,
    pub count: i64,
    pub sent: i64,
    pub received: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkNode {
    pub id: String,
    pub label: String,
    pub value: i64,
    pub category: String,
    pub score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkLink {
    pub source: String,
    pub target: String,
    pub value: i64,
    pub strength: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkData {
    pub nodes: Vec<NetworkNode>,
    pub links: Vec<NetworkLink>,
}

// Get database pool
async fn get_pool() -> Result<SqlitePool, String> {
    let database_url = "sqlite:./aiden.db";
    SqlitePool::connect(database_url)
        .await
        .map_err(|e| format!("Failed to connect to database: {}", e))
}

// Generate a unique ID
fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("crm_{}", timestamp)
}

// Extract email address from sender string
fn extract_email_address(sender: &str) -> String {
    // Handle formats like "Name <email@example.com>" or just "email@example.com"
    if let Some(start) = sender.find('<') {
        if let Some(end) = sender.find('>') {
            return sender[start + 1..end].to_lowercase().trim().to_string();
        }
    }
    // If no angle brackets, check if it contains @
    if sender.contains('@') {
        return sender.trim().to_lowercase().to_string();
    }
    sender.to_lowercase()
}

// Extract name from sender string
fn extract_name(sender: &str) -> Option<String> {
    if let Some(end) = sender.find('<') {
        let name_part = sender[..end].trim().trim_matches('"').trim();
        if !name_part.is_empty() {
            return Some(name_part.to_string());
        }
    }
    None
}

// Extract domain from email address
fn extract_domain(email: &str) -> Option<String> {
    if let Some(domain_start) = email.find('@') {
        Some(email[domain_start + 1..].to_string())
    } else {
        None
    }
}

#[tauri::command]
pub async fn extract_contacts_from_emails() -> Result<Vec<Contact>, String> {
    let pool = get_pool().await?;

    // Get all emails from database
    let emails = sqlx::query(
        "SELECT id, gmail_id, sender, recipients, date, thread_id FROM emails ORDER BY date DESC"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch emails: {}", e))?;

    let mut contacts_map: std::collections::HashMap<String, Contact> = std::collections::HashMap::new();
    let now = Utc::now().timestamp_millis();

    for email in emails {
        let email_id: String = email.get("gmail_id");
        let sender: String = email.get("sender");
        let recipients: String = email.get("recipients");
        let date: i64 = email.get("date");
        let thread_id: String = email.get("thread_id");

        // Process sender
        let sender_email = extract_email_address(&sender);
        let sender_name = extract_name(&sender);
        let sender_domain = extract_domain(&sender_email);

        // Skip self-emails
        if !sender_email.contains("me") && !sender_email.contains("noreply") {
            let entry = contacts_map.entry(sender_email.clone()).or_insert_with(|| {
                let id = generate_id();
                Contact {
                    id: id.clone(),
                    email_address: sender_email.clone(),
                    name: sender_name.clone(),
                    domain: sender_domain.clone(),
                    first_seen: date,
                    last_contacted: Some(date),
                    total_emails_received: 0,
                    total_emails_sent: 0,
                    total_threads: 0,
                    relationship_score: 0.0,
                    category: "Other".to_string(),
                    is_vip: false,
                    avg_response_time_minutes: None,
                    last_response_time: None,
                    notes: None,
                    days_since_contact: Some((now - date) / (1000 * 60 * 60 * 24)),
                    last_score_calculation: None,
                }
            });

            entry.total_emails_received += 1;
            entry.last_contacted = Some(entry.last_contacted.unwrap().max(date));
            entry.days_since_contact = Some((now - entry.last_contacted.unwrap()) / (1000 * 60 * 60 * 24));
        }

        // Process recipients
        if let Ok(recipients_list) = serde_json::from_str::<Vec<String>>(&recipients) {
            for recipient in recipients_list {
                let recipient_email = extract_email_address(&recipient);
                let recipient_name = extract_name(&recipient);
                let recipient_domain = extract_domain(&recipient_email);

                if !recipient_email.contains("me") && !recipient_email.contains("noreply") {
                    let entry = contacts_map.entry(recipient_email.clone()).or_insert_with(|| {
                        let id = generate_id();
                        Contact {
                            id: id.clone(),
                            email_address: recipient_email.clone(),
                            name: recipient_name.clone(),
                            domain: recipient_domain.clone(),
                            first_seen: date,
                            last_contacted: Some(date),
                            total_emails_received: 0,
                            total_emails_sent: 0,
                            total_threads: 0,
                            relationship_score: 0.0,
                            category: "Other".to_string(),
                            is_vip: false,
                            avg_response_time_minutes: None,
                            last_response_time: None,
                            notes: None,
                            days_since_contact: Some((now - date) / (1000 * 60 * 60 * 24)),
                            last_score_calculation: None,
                        }
                    });

                    entry.total_emails_sent += 1;
                    entry.last_contacted = Some(entry.last_contacted.unwrap().max(date));
                    entry.days_since_contact = Some((now - entry.last_contacted.unwrap()) / (1000 * 60 * 60 * 24));
                }
            }
        }
    }

    // Calculate relationship scores for all contacts
    let mut contacts: Vec<Contact> = contacts_map.into_values().collect();
    for contact in &mut contacts {
        contact.relationship_score = calculate_relationship_score(contact);
        contact.last_score_calculation = Some(now);
    }

    // Save contacts to database
    for contact in &contacts {
        sqlx::query(
            r#"
            INSERT INTO contacts (
                id, email_address, name, domain, first_seen, last_contacted,
                total_emails_received, total_emails_sent, total_threads,
                relationship_score, category, is_vip, last_score_calculation,
                avg_response_time_minutes, last_response_time, notes,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(email_address) DO UPDATE SET
                name = excluded.name,
                last_contacted = excluded.last_contacted,
                total_emails_received = excluded.total_emails_received,
                total_emails_sent = excluded.total_emails_sent,
                relationship_score = excluded.relationship_score,
                last_score_calculation = excluded.last_score_calculation,
                updated_at = excluded.updated_at
            "#
        )
        .bind(&contact.id)
        .bind(&contact.email_address)
        .bind(&contact.name)
        .bind(&contact.domain)
        .bind(contact.first_seen)
        .bind(contact.last_contacted)
        .bind(contact.total_emails_received)
        .bind(contact.total_emails_sent)
        .bind(contact.total_threads)
        .bind(contact.relationship_score)
        .bind(&contact.category)
        .bind(contact.is_vip)
        .bind(contact.last_score_calculation)
        .bind(contact.avg_response_time_minutes)
        .bind(contact.last_response_time)
        .bind(&contact.notes)
        .bind(contact.first_seen)
        .bind(now)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to save contact: {}", e))?;
    }

    Ok(contacts)
}

// Calculate relationship score based on multiple factors
fn calculate_relationship_score(contact: &Contact) -> f64 {
    let total_emails = (contact.total_emails_sent + contact.total_emails_received) as f64;
    let recency_score = if let Some(last_contact) = contact.last_contacted {
        let days_since = (Utc::now().timestamp_millis() - last_contact) / (1000 * 60 * 60 * 24);
        (100.0 / (1.0 + days_since as f64 / 30.0)).min(100.0)
    } else {
        0.0
    };

    let frequency_score = (total_emails.log10() * 20.0).min(100.0);

    let mutuality_score = {
        let sent = contact.total_emails_sent as f64;
        let received = contact.total_emails_received as f64;
        if sent + received > 0.0 {
            let ratio = if sent > received { received / sent } else { sent / received };
            ratio * 100.0
        } else {
            0.0
        }
    };

    let vip_bonus = if contact.is_vip { 20.0 } else { 0.0 };

    (recency_score * 0.4 + frequency_score * 0.3 + mutuality_score * 0.3 + vip_bonus).min(100.0)
}

#[tauri::command]
pub async fn get_contacts(limit: Option<i32>, offset: Option<i32>) -> Result<Vec<Contact>, String> {
    let pool = get_pool().await?;
    let now = Utc::now().timestamp_millis();

    let contacts = sqlx::query(
        r#"
        SELECT
            id, email_address, name, domain, first_seen, last_contacted,
            total_emails_received, total_emails_sent, total_threads,
            relationship_score, category, is_vip, avg_response_time_minutes,
            last_response_time, notes
        FROM contacts
        ORDER BY relationship_score DESC, last_contacted DESC
        LIMIT ? OFFSET ?
        "#
    )
    .bind(limit.unwrap_or(100))
    .bind(offset.unwrap_or(0))
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch contacts: {}", e))?;

    let result: Vec<Contact> = contacts
        .into_iter()
        .map(|row| {
            let last_contacted: Option<i64> = row.get("last_contacted");
            Contact {
                id: row.get("id"),
                email_address: row.get("email_address"),
                name: row.get("name"),
                domain: row.get("domain"),
                first_seen: row.get("first_seen"),
                last_contacted,
                total_emails_received: row.get("total_emails_received"),
                total_emails_sent: row.get("total_emails_sent"),
                total_threads: row.get("total_threads"),
                relationship_score: row.get("relationship_score"),
                category: row.get("category"),
                is_vip: row.get("is_vip"),
                avg_response_time_minutes: row.get("avg_response_time_minutes"),
                last_response_time: row.get("last_response_time"),
                notes: row.get("notes"),
                days_since_contact: last_contacted.map(|lc| (now - lc) / (1000 * 60 * 60 * 24)),
                last_score_calculation: None,
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_contact(contact_id: String) -> Result<Option<Contact>, String> {
    let pool = get_pool().await?;
    let now = Utc::now().timestamp_millis();

    let contact = sqlx::query(
        r#"
        SELECT
            id, email_address, name, domain, first_seen, last_contacted,
            total_emails_received, total_emails_sent, total_threads,
            relationship_score, category, is_vip, avg_response_time_minutes,
            last_response_time, notes
        FROM contacts
        WHERE id = ?
        "#
    )
    .bind(&contact_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Failed to fetch contact: {}", e))?;

    Ok(contact.map(|row| {
        let last_contacted: Option<i64> = row.get("last_contacted");
        Contact {
            id: row.get("id"),
            email_address: row.get("email_address"),
            name: row.get("name"),
            domain: row.get("domain"),
            first_seen: row.get("first_seen"),
            last_contacted,
            total_emails_received: row.get("total_emails_received"),
            total_emails_sent: row.get("total_emails_sent"),
            total_threads: row.get("total_threads"),
            relationship_score: row.get("relationship_score"),
            category: row.get("category"),
            is_vip: row.get("is_vip"),
            avg_response_time_minutes: row.get("avg_response_time_minutes"),
            last_response_time: row.get("last_response_time"),
            notes: row.get("notes"),
            days_since_contact: last_contacted.map(|lc| (now - lc) / (1000 * 60 * 60 * 24)),
            last_score_calculation: None,
        }
    }))
}

#[tauri::command]
pub async fn update_contact_vip_status(contact_id: String, is_vip: bool) -> Result<(), String> {
    let pool = get_pool().await?;

    sqlx::query("UPDATE contacts SET is_vip = ?, updated_at = ? WHERE id = ?")
        .bind(is_vip)
        .bind(Utc::now().timestamp_millis())
        .bind(&contact_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to update VIP status: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn update_contact_notes(contact_id: String, notes: String) -> Result<(), String> {
    let pool = get_pool().await?;

    sqlx::query("UPDATE contacts SET notes = ?, updated_at = ? WHERE id = ?")
        .bind(&notes)
        .bind(Utc::now().timestamp_millis())
        .bind(&contact_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to update notes: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_contact_analytics(contact_id: String) -> Result<ContactAnalytics, String> {
    let pool = get_pool().await?;

    // Get contact info
    let contact = sqlx::query(
        "SELECT id, email_address, name, first_seen, total_emails_received,
         total_emails_sent, avg_response_time_minutes, relationship_score
         FROM contacts WHERE id = ?"
    )
    .bind(&contact_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to fetch contact: {}", e))?;

    let contact_id_db: String = contact.get("id");
    let email_address: String = contact.get("email_address");
    let name: Option<String> = contact.get("name");
    let first_seen: i64 = contact.get("first_seen");
    let emails_received: i64 = contact.get("total_emails_received");
    let emails_sent: i64 = contact.get("total_emails_sent");
    let avg_response_time_minutes: Option<f64> = contact.get("avg_response_time_minutes");
    let relationship_score: f64 = contact.get("relationship_score");

    // Get interaction frequency by day (last 90 days)
    let ninety_days_ago = Utc::now().timestamp_millis() - (90 * 24 * 60 * 60 * 1000);

    let interactions = sqlx::query(
        r#"
        SELECT
            date(timestamp/1000, 'unixepoch') as interaction_date,
            COUNT(*) as count,
            SUM(CASE WHEN direction = 'Outgoing' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN direction = 'Incoming' THEN 1 ELSE 0 END) as received
        FROM email_interactions
        WHERE contact_id = ? AND timestamp >= ?
        GROUP BY interaction_date
        ORDER BY interaction_date DESC
        "#
    )
    .bind(&contact_id)
    .bind(ninety_days_ago)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch interactions: {}", e))?;

    let interaction_frequency: Vec<InteractionFrequency> = interactions
        .into_iter()
        .map(|row| {
            InteractionFrequency {
                date: row.get("interaction_date"),
                count: row.get("count"),
                sent: row.get("sent"),
                received: row.get("received"),
            }
        })
        .collect();

    // Get recent response times
    let response_times_data = sqlx::query(
        "SELECT response_time_minutes FROM email_interactions
         WHERE contact_id = ? AND direction = 'Outgoing' AND response_time_minutes IS NOT NULL
         ORDER BY timestamp DESC LIMIT 50"
    )
    .bind(&contact_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch response times: {}", e))?;

    let response_times: Vec<i64> = response_times_data
        .into_iter()
        .map(|row| row.get("response_time_minutes"))
        .collect();

    Ok(ContactAnalytics {
        contact_id: contact_id_db,
        email_address,
        name,
        total_emails: emails_received + emails_sent,
        emails_sent,
        emails_received,
        first_contact: first_seen,
        last_contact: Utc::now().timestamp_millis(), // This would come from actual data
        avg_response_time_minutes,
        response_times,
        interaction_frequency,
        relationship_score,
    })
}

#[tauri::command]
pub async fn get_network_data(min_emails: Option<i64>, limit: Option<i64>) -> Result<NetworkData, String> {
    let pool = get_pool().await?;
    let min_emails = min_emails.unwrap_or(3);
    let limit = limit.unwrap_or(50);

    // Get contacts with minimum email threshold
    let contacts = sqlx::query(
        r#"
        SELECT id, email_address, name, total_emails_sent + total_emails_received as total_emails,
               relationship_score, category
        FROM contacts
        WHERE (total_emails_sent + total_emails_received) >= ?
        ORDER BY total_emails DESC
        LIMIT ?
        "#
    )
    .bind(min_emails)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch contacts for network: {}", e))?;

    let nodes: Vec<NetworkNode> = contacts
        .into_iter()
        .map(|row| {
            let total: i64 = row.get("total_emails");
            NetworkNode {
                id: row.get("id"),
                label: row.get::<String, _>("email_address"),
                value: total,
                category: row.get("category"),
                score: row.get("relationship_score"),
            }
        })
        .collect();

    // Get links based on thread participants
    let links_data = sqlx::query(
        r#"
        SELECT DISTINCT
            c1.id as source_id, c2.id as target_id,
            COUNT(*) as connection_strength
        FROM emails e1
        JOIN contacts c1 ON c1.email_address = e1.sender
        JOIN emails e2 ON e2.thread_id = e1.thread_id AND e2.id != e1.id
        JOIN contacts c2 ON c2.email_address = e2.sender
        WHERE c1.id IN (SELECT id FROM contacts WHERE (total_emails_sent + total_emails_received) >= ?)
          AND c2.id IN (SELECT id FROM contacts WHERE (total_emails_sent + total_emails_received) >= ?)
          AND c1.id != c2.id
        GROUP BY c1.id, c2.id
        HAVING connection_strength >= ?
        LIMIT ?
        "#
    )
    .bind(min_emails)
    .bind(min_emails)
    .bind(2) // Minimum thread connections
    .bind(limit * 2)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch network links: {}", e))?;

    let links: Vec<NetworkLink> = links_data
        .into_iter()
        .map(|row| {
            let strength: i64 = row.get("connection_strength");
            NetworkLink {
                source: row.get("source_id"),
                target: row.get("target_id"),
                value: strength,
                strength: (strength as f64).log10() * 10.0,
            }
        })
        .collect();

    Ok(NetworkData { nodes, links })
}

#[tauri::command]
pub async fn get_stale_contacts(days_threshold: Option<i64>) -> Result<Vec<Contact>, String> {
    let pool = get_pool().await?;
    let threshold = days_threshold.unwrap_or(30);
    let cutoff = Utc::now().timestamp_millis() - (threshold * 24 * 60 * 60 * 1000);

    let contacts = sqlx::query(
        r#"
        SELECT
            id, email_address, name, domain, first_seen, last_contacted,
            total_emails_received, total_emails_sent, total_threads,
            relationship_score, category, is_vip, avg_response_time_minutes,
            last_response_time, notes
        FROM contacts
        WHERE last_contacted < ? OR last_contacted IS NULL
        ORDER BY last_contacted DESC
        "#
    )
    .bind(cutoff)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch stale contacts: {}", e))?;

    let now = Utc::now().timestamp_millis();

    let result: Vec<Contact> = contacts
        .into_iter()
        .map(|row| {
            let last_contacted: Option<i64> = row.get("last_contacted");
            Contact {
                id: row.get("id"),
                email_address: row.get("email_address"),
                name: row.get("name"),
                domain: row.get("domain"),
                first_seen: row.get("first_seen"),
                last_contacted,
                total_emails_received: row.get("total_emails_received"),
                total_emails_sent: row.get("total_emails_sent"),
                total_threads: row.get("total_threads"),
                relationship_score: row.get("relationship_score"),
                category: row.get("category"),
                is_vip: row.get("is_vip"),
                avg_response_time_minutes: row.get("avg_response_time_minutes"),
                last_response_time: row.get("last_response_time"),
                notes: row.get("notes"),
                days_since_contact: last_contacted.map(|lc| (now - lc) / (1000 * 60 * 60 * 24)),
                last_score_calculation: None,
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_top_contacts(limit: Option<i32>) -> Result<Vec<Contact>, String> {
    let pool = get_pool().await?;
    let limit = limit.unwrap_or(10);
    let now = Utc::now().timestamp_millis();

    let contacts = sqlx::query(
        r#"
        SELECT
            id, email_address, name, domain, first_seen, last_contacted,
            total_emails_received, total_emails_sent, total_threads,
            relationship_score, category, is_vip, avg_response_time_minutes,
            last_response_time, notes
        FROM contacts
        ORDER BY relationship_score DESC
        LIMIT ?
        "#
    )
    .bind(limit)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch top contacts: {}", e))?;

    let result: Vec<Contact> = contacts
        .into_iter()
        .map(|row| {
            let last_contacted: Option<i64> = row.get("last_contacted");
            Contact {
                id: row.get("id"),
                email_address: row.get("email_address"),
                name: row.get("name"),
                domain: row.get("domain"),
                first_seen: row.get("first_seen"),
                last_contacted,
                total_emails_received: row.get("total_emails_received"),
                total_emails_sent: row.get("total_emails_sent"),
                total_threads: row.get("total_threads"),
                relationship_score: row.get("relationship_score"),
                category: row.get("category"),
                is_vip: row.get("is_vip"),
                avg_response_time_minutes: row.get("avg_response_time_minutes"),
                last_response_time: row.get("last_response_time"),
                notes: row.get("notes"),
                days_since_contact: last_contacted.map(|lc| (now - lc) / (1000 * 60 * 60 * 24)),
                last_score_calculation: None,
            }
        })
        .collect();

    Ok(result)
}
