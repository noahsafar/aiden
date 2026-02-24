use serde::{Deserialize, Serialize};
use tauri::command;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LifeIntelligenceItem {
    pub id: String,
    pub email_id: String,
    pub data_type: String,        // "subscription" | "bill" | "travel" | "package" | "deadline"
    pub title: String,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub date: Option<String>,
    pub end_date: Option<String>,
    pub frequency: Option<String>,
    pub details: Option<String>,
    pub tracking_number: Option<String>,
    pub carrier: Option<String>,
    pub created_at: String,
    pub dismissed: bool,
}

// ==================== PERSISTENCE ====================

lazy_static::lazy_static! {
    static ref LIFE_ITEMS: std::sync::Mutex<Vec<LifeIntelligenceItem>> =
        std::sync::Mutex::new(Vec::new());
    static ref PROCESSED_EMAIL_IDS: std::sync::Mutex<Vec<String>> =
        std::sync::Mutex::new(Vec::new());
}

fn get_life_data_path() -> PathBuf {
    let app_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    let app_dir = app_dir.join("aiden");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("life_data.json")
}

fn get_processed_ids_path() -> PathBuf {
    let app_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    app_dir.join("aiden").join("life_processed_ids.json")
}

fn load_life_data() {
    let path = get_life_data_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(loaded) = serde_json::from_str::<Vec<LifeIntelligenceItem>>(&content) {
            let mut items = LIFE_ITEMS.lock().unwrap();
            *items = loaded;
            println!("Loaded {} life data items from disk", items.len());
        }
    }
    let ids_path = get_processed_ids_path();
    if let Ok(content) = std::fs::read_to_string(&ids_path) {
        if let Ok(loaded) = serde_json::from_str::<Vec<String>>(&content) {
            let mut ids = PROCESSED_EMAIL_IDS.lock().unwrap();
            *ids = loaded;
            println!("Loaded {} life-processed email IDs from disk", ids.len());
        }
    }
}

fn save_life_data_to_disk() {
    let items = LIFE_ITEMS.lock().unwrap();
    let path = get_life_data_path();
    if let Ok(json) = serde_json::to_string_pretty(&*items) {
        std::fs::write(&path, json).ok();
    }
}

fn save_processed_ids_to_disk() {
    let ids = PROCESSED_EMAIL_IDS.lock().unwrap();
    let path = get_processed_ids_path();
    if let Ok(json) = serde_json::to_string(&*ids) {
        std::fs::write(&path, json).ok();
    }
}

fn init_life_data() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        load_life_data();
    });
}

// ==================== COMMANDS ====================

#[command]
pub async fn save_life_items(items: Vec<LifeIntelligenceItem>) -> Result<(), String> {
    init_life_data();
    let mut stored = LIFE_ITEMS.lock().unwrap();
    for item in items {
        // Dedup by id
        if !stored.iter().any(|s| s.id == item.id) {
            stored.push(item);
        }
    }
    drop(stored);
    save_life_data_to_disk();
    Ok(())
}

#[command]
pub async fn load_life_items() -> Result<Vec<LifeIntelligenceItem>, String> {
    init_life_data();
    let items = LIFE_ITEMS.lock().unwrap();
    Ok(items.clone())
}

#[command]
pub async fn dismiss_life_item(id: String) -> Result<(), String> {
    init_life_data();
    let mut items = LIFE_ITEMS.lock().unwrap();
    if let Some(item) = items.iter_mut().find(|i| i.id == id) {
        item.dismissed = true;
    }
    drop(items);
    save_life_data_to_disk();
    Ok(())
}

#[command]
pub async fn delete_life_item(id: String) -> Result<(), String> {
    init_life_data();
    let mut items = LIFE_ITEMS.lock().unwrap();
    items.retain(|i| i.id != id);
    drop(items);
    save_life_data_to_disk();
    Ok(())
}

#[command]
pub async fn save_life_processed_ids(ids: Vec<String>) -> Result<(), String> {
    init_life_data();
    let mut stored = PROCESSED_EMAIL_IDS.lock().unwrap();
    for id in ids {
        if !stored.contains(&id) {
            stored.push(id);
        }
    }
    drop(stored);
    save_processed_ids_to_disk();
    Ok(())
}

#[command]
pub async fn load_life_processed_ids() -> Result<Vec<String>, String> {
    init_life_data();
    let ids = PROCESSED_EMAIL_IDS.lock().unwrap();
    Ok(ids.clone())
}
