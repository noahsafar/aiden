use sqlx::{Pool, Sqlite, SqlitePool, migrate::MigrateDatabase, sqlite::SqliteConnectOptions};
use std::sync::Arc;
use tauri::async_runtime::RwLock;

pub type DbPool = Arc<RwLock<Option<SqlitePool>>>;

pub async fn init_database() -> Result<(), sqlx::Error> {
    let database_url = "sqlite:./aiden.db";

    // Create database if it doesn't exist
    if !Sqlite::database_exists(database_url).await? {
        Sqlite::create_database(database_url).await?;
    }

    // Connect to database
    let pool = SqlitePool::connect(database_url).await?;

    // Run migrations
    create_tables(&pool).await?;

    // Store pool in app state (will be handled later)

    Ok(())
}

async fn create_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Create emails table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS emails (
            id TEXT PRIMARY KEY,
            gmail_id TEXT UNIQUE NOT NULL,
            thread_id TEXT NOT NULL,
            subject TEXT NOT NULL,
            sender TEXT NOT NULL,
            sender_email TEXT NOT NULL,
            recipients TEXT NOT NULL, -- JSON array
            date INTEGER NOT NULL,
            body_text TEXT NOT NULL,
            body_html TEXT,
            snippet TEXT NOT NULL,
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            is_starred BOOLEAN NOT NULL DEFAULT FALSE,
            has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
            status TEXT NOT NULL DEFAULT 'Unhandled',
            category TEXT NOT NULL DEFAULT 'Normal',
            summary TEXT,
            key_points TEXT, -- JSON array
            requires_reply BOOLEAN NOT NULL DEFAULT FALSE,
            ai_generated_reply TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create user_styles table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS user_styles (
            user_email TEXT PRIMARY KEY,
            tone TEXT NOT NULL,
            formality_score REAL NOT NULL,
            common_phrases TEXT NOT NULL, -- JSON array
            avg_sentence_length REAL NOT NULL,
            avg_response_time_minutes REAL NOT NULL,
            last_updated INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create notification_history table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS notification_history (
            id TEXT PRIMARY KEY,
            email_id TEXT NOT NULL,
            sent_at INTEGER NOT NULL,
            clicked_at INTEGER,
            action_taken TEXT,
            FOREIGN KEY (email_id) REFERENCES emails (id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create queued_emails table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS queued_emails (
            id TEXT PRIMARY KEY,
            gmail_id TEXT NOT NULL,
            scheduled_for INTEGER NOT NULL,
            recipient TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            is_draft BOOLEAN NOT NULL DEFAULT FALSE
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create settings table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // ============================================
    // CRM FEATURE TABLES
    // ============================================

    // Create contacts table - tracks email contacts and their stats
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            email_address TEXT UNIQUE NOT NULL,
            display_name TEXT,
            first_seen_at INTEGER NOT NULL,
            last_emailed_at INTEGER,
            last_received_from_at INTEGER,
            total_emails_sent INTEGER NOT NULL DEFAULT 0,
            total_emails_received INTEGER NOT NULL DEFAULT 0,
            total_threads INTEGER NOT NULL DEFAULT 0,
            avg_response_time_minutes REAL,
            response_rate REAL,
            is_vip BOOLEAN NOT NULL DEFAULT 0,
            notes TEXT,
            tags TEXT, -- JSON array of tags
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create threads table - tracks email threads and their status
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            gmail_thread_id TEXT UNIQUE NOT NULL,
            subject TEXT NOT NULL,
            participants TEXT NOT NULL, -- JSON array of email addresses
            last_email_date INTEGER NOT NULL,
            last_email_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active', -- active, awaiting_reply, stale, archived, done
            health_score INTEGER NOT NULL DEFAULT 100, -- 0-100, higher is healthier
            total_emails INTEGER NOT NULL DEFAULT 1,
            unread_count INTEGER NOT NULL DEFAULT 0,
            my_last_action TEXT, -- 'sent', 'replied', 'read', null
            my_last_action_at INTEGER,
            their_last_action_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (last_email_id) REFERENCES emails (id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create follow_up_reminders table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS follow_up_reminders (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            email_id TEXT NOT NULL,
            contact_email TEXT NOT NULL,
            reminder_type TEXT NOT NULL, -- 'no_reply', 'check_in', 'deadline'
            scheduled_for INTEGER NOT NULL,
            is_completed BOOLEAN NOT NULL DEFAULT 0,
            completed_at INTEGER,
            sent_notification BOOLEAN NOT NULL DEFAULT 0,
            message_suggestion TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (thread_id) REFERENCES threads (id),
            FOREIGN KEY (email_id) REFERENCES emails (id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create email_templates table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS email_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            subject TEXT,
            body TEXT NOT NULL,
            category TEXT, -- 'follow_up', 'check_in', 'thank_you', 'meeting', 'custom'
            tags TEXT, -- JSON array
            use_count INTEGER NOT NULL DEFAULT 0,
            is_ai_personalized BOOLEAN NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create email_analytics table - track response patterns
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS email_analytics (
            id TEXT PRIMARY KEY,
            contact_email TEXT NOT NULL,
            day_of_week INTEGER NOT NULL, -- 0-6 (Sunday-Saturday)
            hour INTEGER NOT NULL, -- 0-23
            emails_sent INTEGER NOT NULL DEFAULT 0,
            emails_received INTEGER NOT NULL DEFAULT 0,
            avg_response_time_minutes REAL,
            response_count INTEGER NOT NULL DEFAULT 0,
            last_updated INTEGER NOT NULL,
            UNIQUE(contact_email, day_of_week, hour)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create suggested_actions table - AI-suggested actions for emails/threads
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS suggested_actions (
            id TEXT PRIMARY KEY,
            email_id TEXT,
            thread_id TEXT,
            action_type TEXT NOT NULL, -- 'archive', 'follow_up', 'reply', 'label', 'reminder'
            suggestion TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 50, -- 0-100
            is_dismissed BOOLEAN NOT NULL DEFAULT 0,
            is_completed BOOLEAN NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            expires_at INTEGER,
            FOREIGN KEY (email_id) REFERENCES emails (id),
            FOREIGN KEY (thread_id) REFERENCES threads (id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create indexes for better performance
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_emails_status ON emails (status)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_emails_category ON emails (category)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_emails_date ON emails (date)")
        .execute(pool)
        .await?;

    // CRM indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_threads_status ON threads (status)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_threads_participants ON threads (participants)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email_address)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled ON follow_up_reminders (scheduled_for, is_completed)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_suggested_actions ON suggested_actions (is_dismissed, is_completed, priority)")
        .execute(pool)
        .await?;

    Ok(())
}