use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::fs;
use std::io::Write;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    pub notifications_enabled: bool,
    pub auto_refresh_interval: u64,
    pub ai_settings: AiSettings,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiSettings {
    pub api_key: Option<String>,
    pub model: String,
    pub max_tokens: u32,
    pub writing_style: Option<WritingStyle>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WritingStyle {
    pub tone: String,
    pub formality: f64,
    pub common_phrases: Vec<String>,
    pub avg_sentence_length: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
}

pub struct TokenStorage {
    app_handle: AppHandle,
    cache: Arc<Mutex<Option<AuthToken>>>,
}

impl TokenStorage {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            cache: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn get_token(&self) -> Result<Option<AuthToken>, String> {
        // Check cache first
        let cache = self.cache.lock().await;
        if let Some(token) = cache.as_ref() {
            return Ok(Some(token.clone()));
        }
        drop(cache);

        // Load from disk
        match self.load_token_from_disk().await {
            Ok(token) => {
                // Update cache
                *self.cache.lock().await = Some(token.clone());
                return Ok(Some(token));
            }
            Err(_) => return Ok(None),
        }
    }

    pub async fn save_token(&self, token: &AuthToken) -> Result<(), String> {
        // Update cache
        *self.cache.lock().await = Some(token.clone());

        // Save to disk
        self.save_token_to_disk(token).await
    }

    pub async fn clear_token(&self) -> Result<(), String> {
        // Clear cache
        *self.cache.lock().await = None;

        // Remove from disk
        self.remove_token_file().await
    }

    async fn load_token_from_disk(&self) -> Result<AuthToken, String> {
        let app_dir = self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| {
                let home_dir = self.app_handle.path().home_dir().unwrap();
                home_dir.join(".aiden")
            });

        if let Err(e) = fs::create_dir_all(&app_dir) {
            return Err(format!("Failed to create app directory: {}", e));
        }

        let token_file = app_dir.join("auth_token.json");
        if token_file.exists() {
            let content = fs::read_to_string(&token_file)
                .map_err(|e| format!("Failed to read token file: {}", e))?;
            let token: AuthToken = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse token file: {}", e))?;
            Ok(token)
        } else {
            Err("Token file not found".to_string())
        }
    }

    async fn save_token_to_disk(&self, token: &AuthToken) -> Result<(), String> {
        let app_dir = self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| {
                let home_dir = self.app_handle.path().home_dir().unwrap();
                home_dir.join(".aiden")
            });

        if let Err(e) = fs::create_dir_all(&app_dir) {
            return Err(format!("Failed to create app directory: {}", e));
        }

        let token_file = app_dir.join("auth_token.json");
        let content = serde_json::to_string_pretty(token)
            .map_err(|e| format!("Failed to serialize token: {}", e))?;

        let mut file = fs::File::create(&token_file)
            .map_err(|e| format!("Failed to create token file: {}", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write token file: {}", e))?;

        Ok(())
    }

    async fn remove_token_file(&self) -> Result<(), String> {
        let app_dir = self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| {
                let home_dir = self.app_handle.path().home_dir().unwrap();
                home_dir.join(".aiden")
            });

        let token_file = app_dir.join("auth_token.json");
        if token_file.exists() {
            fs::remove_file(&token_file)
                .map_err(|e| format!("Failed to remove token file: {}", e))?;
        }

        Ok(())
    }
}

pub struct SettingsService {
    app_handle: AppHandle,
}

impl SettingsService {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub async fn get_settings(&self) -> Result<AppSettings, String> {
        let app_dir = self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| {
                let home_dir = self.app_handle.path().home_dir().unwrap();
                home_dir.join(".aiden")
            });

        if let Err(e) = fs::create_dir_all(&app_dir) {
            return Err(format!("Failed to create app directory: {}", e));
        }

        let settings_file = app_dir.join("settings.json");
        if settings_file.exists() {
            let content = fs::read_to_string(&settings_file)
                .map_err(|e| format!("Failed to read settings file: {}", e))?;
            let settings: AppSettings = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse settings file: {}", e))?;
            Ok(settings)
        } else {
            // Return default settings
            Ok(AppSettings {
                theme: "light".to_string(),
                notifications_enabled: true,
                auto_refresh_interval: 300,
                ai_settings: AiSettings {
                    api_key: None,
                    model: "claude-3-sonnet-20241022".to_string(),
                    max_tokens: 2000,
                    writing_style: None,
                },
            })
        }
    }

    pub async fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let app_dir = self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| {
                let home_dir = self.app_handle.path().home_dir().unwrap();
                home_dir.join(".aiden")
            });

        if let Err(e) = fs::create_dir_all(&app_dir) {
            return Err(format!("Failed to create app directory: {}", e));
        }

        let settings_file = app_dir.join("settings.json");
        let content = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;

        let mut file = fs::File::create(&settings_file)
            .map_err(|e| format!("Failed to create settings file: {}", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write settings file: {}", e))?;

        Ok(())
    }
}