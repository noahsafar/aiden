use tauri::command;
use std::fs::File;
use std::io::Write;
use std::path::Path;

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
