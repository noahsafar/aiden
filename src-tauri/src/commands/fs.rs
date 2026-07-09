use tauri::command;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

// File search structures
#[derive(Debug, Serialize, Deserialize)]
pub struct IndexedFolder {
    pub path: String,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileMatch {
    pub path: String,
    pub name: String,
    pub file_type: String,
    pub size: u64,
    pub modified: u64, // Unix timestamp
    pub folder_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AttachmentSuggestion {
    pub keyword: String,
    pub file_type: Option<String>,
    pub matches: Vec<FileMatch>,
}

// Get indexed folders configuration
fn get_indexed_folders_path() -> PathBuf {
    let app_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    let app_dir = app_dir.join("aiden");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("indexed_folders.json")
}

fn load_indexed_folders() -> Vec<IndexedFolder> {
    let path = get_indexed_folders_path();
    if !path.exists() {
        // Create default folders
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let defaults = vec![
            IndexedFolder {
                path: home.join("Downloads").to_string_lossy().to_string(),
                name: "Downloads".to_string(),
                enabled: true,
            },
            IndexedFolder {
                path: home.join("Documents").to_string_lossy().to_string(),
                name: "Documents".to_string(),
                enabled: true,
            },
            IndexedFolder {
                path: home.join("Desktop").to_string_lossy().to_string(),
                name: "Desktop".to_string(),
                enabled: true,
            },
        ];
        save_indexed_folders(&defaults);
        return defaults;
    }

    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(folders) = serde_json::from_str::<Vec<IndexedFolder>>(&content) {
            return folders;
        }
    }
    Vec::new()
}

fn save_indexed_folders(folders: &[IndexedFolder]) {
    let path = get_indexed_folders_path();
    if let Ok(json) = serde_json::to_string_pretty(folders) {
        std::fs::write(&path, json).ok();
    }
}

#[command]
pub fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let path_obj = Path::new(&path);

    // Create parent directories if they don't exist
    if let Some(parent) = path_obj.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }

    // Write the file
    let mut file = File::create(path_obj)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    file.write_all(&contents)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

#[command]
pub fn read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[command]
pub fn get_downloads_path() -> Result<String, String> {
    // Get the user's home directory
    let home = dirs::home_dir()
        .ok_or("Could not find home directory")?;

    // Add Downloads folder
    let downloads = home.join("Downloads");
    Ok(downloads.to_string_lossy().to_string())
}

#[command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[command]
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(&["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

// ==================== FILE SEARCH ====================

#[command]
pub fn get_indexed_folders() -> Vec<IndexedFolder> {
    load_indexed_folders()
}

#[command]
pub fn update_indexed_folders(folders: Vec<IndexedFolder>) -> Result<(), String> {
    save_indexed_folders(&folders);
    Ok(())
}

#[command]
pub fn search_files(
    keywords: Vec<String>,
    file_types: Option<Vec<String>>,
    limit: Option<usize>,
) -> Vec<FileMatch> {
    let limit = limit.unwrap_or(20);
    let indexed_folders = load_indexed_folders();
    let enabled_folders: Vec<PathBuf> = indexed_folders
        .iter()
        .filter(|f| f.enabled)
        .filter_map(|f| Path::new(&f.path).canonicalize().ok())
        .collect();

    let mut all_matches = Vec::new();

    // Convert file types to lowercase extensions
    let file_type_extensions: Vec<String> = file_types
        .unwrap_or_default()
        .into_iter()
        .map(|ft| ft.trim_start_matches('.').to_lowercase())
        .collect();

    for folder_path in enabled_folders {
        if let Ok(entries) = std::fs::read_dir(&folder_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    continue; // Skip directories
                }

                // Get file metadata
                let metadata = match std::fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let modified = metadata.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                let file_name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                let extension = path.extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                // Check if file matches any keyword
                let matches_keyword = keywords.iter().any(|keyword| {
                    let keyword_lower = keyword.to_lowercase();
                    file_name.contains(&keyword_lower)
                });

                // Check if file matches any file type filter
                let matches_file_type = file_type_extensions.is_empty()
                    || file_type_extensions.contains(&extension)
                    || file_type_extensions.contains(&"*".to_string());

                if matches_keyword && matches_file_type {
                    // Extract file type (extension)
                    let file_type = if extension.is_empty() {
                        "file".to_string()
                    } else {
                        format!(".{}", extension)
                    };

                    all_matches.push(FileMatch {
                        path: path.to_string_lossy().to_string(),
                        name: path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string(),
                        file_type,
                        size: metadata.len(),
                        modified,
                        folder_name: folder_path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string(),
                    });
                }
            }
        }
    }

    // Sort by modified date (most recent first) and limit
    all_matches.sort_by(|a, b| b.modified.cmp(&a.modified));
    all_matches.truncate(limit);
    all_matches
}

#[command]
pub fn get_file_base64(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};

    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    Ok(general_purpose::STANDARD.encode(&bytes))
}

#[command]
pub fn get_file_info(path: String) -> Result<FileMatch, String> {
    let path_obj = Path::new(&path);
    let metadata = std::fs::metadata(&path_obj)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let modified = metadata.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let extension = path_obj.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let file_type = if extension.is_empty() {
        "file".to_string()
    } else {
        format!(".{}", extension)
    };

    let folder_name = path_obj.parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    Ok(FileMatch {
        path: path.clone(),
        name: path_obj.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
        file_type,
        size: metadata.len(),
        modified,
        folder_name,
    })
}

/* ---------------------------------------------------------------------- */
/* Generic app-data persistence (config-dir JSON)                          */
/*                                                                         */
/* User-owned state (commitment overrides, feedback signals, contact       */
/* memory, CRM notes) must survive a cleared webview — localStorage is a   */
/* cache, not a database. One JSON file per key under                      */
/* ~/.config/aiden/app_data/.                                              */
/* ---------------------------------------------------------------------- */

fn app_data_path(key: &str) -> Result<PathBuf, String> {
    // Keys become filenames — restrict to a safe charset (no path traversal).
    if key.is_empty()
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Invalid app data key: {}", key));
    }
    let dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("aiden")
        .join("app_data");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(dir.join(format!("{}.json", key)))
}

#[command]
pub fn save_app_data(key: String, json: String) -> Result<(), String> {
    let path = app_data_path(&key)?;
    // Write-then-rename so a crash mid-write can't corrupt existing data.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("Failed to write app data: {}", e))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Failed to commit app data: {}", e))?;
    Ok(())
}

#[command]
pub fn load_app_data(key: String) -> Result<Option<String>, String> {
    let path = app_data_path(&key)?;
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read app data: {}", e))
}
