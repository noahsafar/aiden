// Email parsing utilities
use crate::models::Email;

pub struct EmailParser;

impl EmailParser {
    pub fn parse_from_gmail(gmail_message: &serde_json::Value) -> Result<Email, Box<dyn std::error::Error>> {
        // TODO: Parse Gmail API response into Email model
        Err("Not implemented".into())
    }

    pub fn extract_text_content(payload: &serde_json::Value) -> Result<String, Box<dyn std::error::Error>> {
        // TODO: Extract text content from Gmail message payload
        Err("Not implemented".into())
    }

    pub fn clean_html(html: &str) -> String {
        // TODO: Convert HTML to plain text
        html.to_string()
    }
}