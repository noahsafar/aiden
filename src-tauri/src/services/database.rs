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

    Ok(())
}