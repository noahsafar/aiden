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

    // Create contacts table for CRM features
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            email_address TEXT UNIQUE NOT NULL,
            name TEXT,
            domain TEXT,
            first_seen INTEGER NOT NULL,
            last_contacted INTEGER,
            total_emails_received INTEGER NOT NULL DEFAULT 0,
            total_emails_sent INTEGER NOT NULL DEFAULT 0,
            total_threads INTEGER NOT NULL DEFAULT 0,
            relationship_score REAL NOT NULL DEFAULT 0,
            category TEXT NOT NULL DEFAULT 'Other',
            is_vip BOOLEAN NOT NULL DEFAULT 0,
            last_score_calculation INTEGER,
            avg_response_time_minutes REAL,
            last_response_time INTEGER,
            notes TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create email_interactions table for analytics
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS email_interactions (
            id TEXT PRIMARY KEY,
            email_id TEXT NOT NULL,
            contact_id TEXT NOT NULL,
            direction TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            response_time_minutes INTEGER,
            thread_depth INTEGER,
            was_initiator BOOLEAN NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create contact_notes table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS contact_notes (
            id TEXT PRIMARY KEY,
            contact_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create indexes for CRM tables
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email_address)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_contacts_score ON contacts (relationship_score)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_contacts_last_contacted ON contacts (last_contacted)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_email_interactions_contact_timestamp ON email_interactions (contact_id, timestamp)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_email_interactions_email_id ON email_interactions (email_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_contact_notes_contact_id ON contact_notes (contact_id)")
        .execute(pool)
        .await?;

    Ok(())
}