use tauri::command;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub polling_interval_minutes: u64,
    pub enable_notifications: bool,
    pub enable_auto_reply: bool,
    pub auto_reply_delay_minutes: u64,
    pub urgent_keywords: Vec<String>,
    pub important_senders: Vec<String>,
    pub working_hours_start: String,
    pub working_hours_end: String,
    pub timezone: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            polling_interval_minutes: 5,
            enable_notifications: true,
            enable_auto_reply: false,
            auto_reply_delay_minutes: 30,
            urgent_keywords: vec![
                "urgent".to_string(),
                "emergency".to_string(),
                "asap".to_string(),
                "immediately".to_string(),
            ],
            important_senders: vec![],
            working_hours_start: "09:00".to_string(),
            working_hours_end: "17:00".to_string(),
            timezone: "UTC".to_string(),
        }
    }
}

#[command]
pub async fn get_settings() -> Result<AppSettings, String> {
    // For now, return default settings
    // In a real app, you'd load these from storage
    Ok(AppSettings::default())
}

#[command]
pub async fn save_settings(settings: AppSettings) -> Result<(), String> {
    // For now, just return success
    // In a real app, you'd save these to storage
    println!("Settings saved: {:?}", settings);
    Ok(())
}

#[command]
pub async fn update_polling_interval(interval_minutes: u64) -> Result<(), String> {
    // For now, just return success
    // In a real app, you'd update the background task
    println!("Polling interval updated to: {} minutes", interval_minutes);
    Ok(())
}

#[command]
pub async fn start_oauth_server() -> Result<bool, String> {
    use std::env;

    // Try multiple locations for oauth_server.py
    // 1. src-tauri directory (for dev mode)
    // 2. Next to the executable (for production bundle)
    let exe_path = env::current_exe()
        .unwrap_or_else(|_| "aiden".into());
    let exe_dir = exe_path.parent().unwrap_or(&exe_path);

    // Possible locations for oauth_server.py
    let mut possible_paths: Vec<String> = vec![
        // Dev mode: project root
        "/Users/noahsafar/Projects/aiden/oauth_server.py".to_string(),
        // Dev mode: src-tauri directory
        "/Users/noahsafar/Projects/aiden/src-tauri/oauth_server.py".to_string(),
    ];

    // Also try next to the executable (for production bundle)
    if let Some(exe_path) = exe_dir.join("oauth_server.py").to_str() {
        possible_paths.push(exe_path.to_string());
    }

    let mut oauth_server_path: Option<std::path::PathBuf> = None;
    for path_str in possible_paths {
        let path = std::path::Path::new(&path_str);
        if path.exists() {
            oauth_server_path = Some(path.to_path_buf());
            println!("Found oauth_server.py at: {:?}", path);
            break;
        }
    }

    let oauth_server_path = match oauth_server_path {
        Some(p) => p,
        None => {
            println!("OAuth server file not found in any location");
            return Ok(false);
        }
    };

    // On macOS/Linux, spawn the Python server in the background
    #[cfg(unix)]
    {
        // First, check if a Python oauth server is already running
        let check_result = Command::new("pgrep")
            .args(&["-f", "python.*oauth_server"])
            .output();

        let already_running = match &check_result {
            Ok(output) => output.status.success(),
            Err(_) => false,
        };

        if already_running {
            println!("OAuth server already running");
            return Ok(true);
        }

        // Try multiple Python locations (absolute paths for app bundle compatibility)
        let python_paths = vec![
            "/opt/anaconda3/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
            "/opt/homebrew/bin/python3",
        ];

        let mut spawn_result: Option<std::io::Result<std::process::Child>> = None;

        for python_path in python_paths {
            if std::path::Path::new(python_path).exists() {
                println!("Trying Python at: {}", python_path);
                spawn_result = Some(Command::new(python_path)
                    .arg(&oauth_server_path)
                    .spawn());

                if let Some(Ok(_)) = &spawn_result {
                    println!("OAuth server started successfully with {}", python_path);
                    return Ok(true);
                }
            }
        }

        // If no absolute path worked, try the PATH-relative version as fallback
        if spawn_result.is_none() || spawn_result.as_ref().unwrap().is_err() {
            println!("Trying 'python3' from PATH as fallback");
            let result = Command::new("python3")
                .arg(&oauth_server_path)
                .spawn();

            match result {
                Ok(_) => {
                    println!("OAuth server started successfully with python3 from PATH");
                    Ok(true)
                }
                Err(e) => {
                    eprintln!("Failed to start OAuth server: {}", e);
                    eprintln!("Python executable not found. Please ensure Python 3 is installed.");
                    Ok(false)
                }
            }
        } else {
            Ok(false)
        }
    }

    // On Windows, spawn differently
    #[cfg(windows)]
    {
        let result = Command::new("python")
            .arg(&oauth_server_path)
            .spawn();

        match result {
            Ok(_) => {
                println!("OAuth server started successfully");
                Ok(true)
            }
            Err(e) => {
                eprintln!("Failed to start OAuth server: {}", e);
                Ok(false)
            }
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        Ok(false)
    }
}

#[command]
pub async fn check_oauth_server_running() -> Result<bool, String> {
    #[cfg(unix)]
    {
        let result = Command::new("pgrep")
            .args(&["-f", "python.*oauth_server"])
            .output();

        match result {
            Ok(output) => Ok(output.status.success()),
            Err(_) => Ok(false),
        }
    }

    #[cfg(not(unix))]
    {
        Ok(false)
    }
}