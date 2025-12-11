use tauri::command;
use super::ai::EmailClassification;
use super::ai::GeneratedReply;

#[command]
pub async fn send_email_notification(title: String, body: String) -> Result<(), String> {
    // TODO: Implement notification sending
    println!("Notification: {} - {}", title, body);
    Ok(())
}

#[command]
pub async fn show_new_email_notification(
    subject: String,
    sender: String,
    preview: String,
    classification: EmailClassification,
) -> Result<(), String> {
    let emoji = match classification.category.as_str() {
        "Urgent" => "🚨",
        "Important" => "⭐",
        "Normal" => "📧",
        "Low" => "📬",
        _ => "📧",
    };

    // TODO: Send native notification
    println!("{} {}", emoji, subject);
    println!("From: {}", sender);
    println!("Preview: {}", preview);
    println!("Category: {} ({:.1}% confidence)", classification.category, classification.confidence);

    Ok(())
}

#[command]
pub async fn show_ai_reply_notification(subject: String, reply_preview: String) -> Result<(), String> {
    // TODO: Send native notification for AI reply
    println!("🤖 AI Reply Generated for: {}", subject);
    println!("Reply: {}", reply_preview);

    Ok(())
}

#[command]
pub async fn show_summary_notification(
    new_emails_count: usize,
    urgent_count: usize,
) -> Result<(), String> {
    let (title, message) = if urgent_count > 0 {
        (
            format!("🚨 {} new emails ({} urgent)", new_emails_count, urgent_count),
            "You have urgent emails that need your attention".to_string(),
        )
    } else {
        (
            format!("📧 {} new emails", new_emails_count),
            "You have new emails to review".to_string(),
        )
    };

    // TODO: Send native notification
    println!("{}", title);
    println!("{}", message);

    Ok(())
}

#[command]
pub async fn show_error_notification(error_message: String) -> Result<(), String> {
    // TODO: Send error notification
    println!("⚠️ Error: {}", error_message);

    Ok(())
}

#[command]
pub async fn request_notification_permission() -> Result<bool, String> {
    // TODO: Request notification permission
    Ok(true)
}

#[command]
pub async fn check_notification_permission() -> Result<bool, String> {
    // TODO: Check notification permission
    Ok(true)
}