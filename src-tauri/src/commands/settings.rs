use tauri::command;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateReplyRequest {
    pub sender: String,
    pub subject: String,
    pub body_text: String,
    pub user_answers: Vec<UserAnswer>,
    pub formality_level: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserAnswer {
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateReplyResponse {
    pub reply: String,
    pub suggested_formality: Option<String>,
}

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
    // Smart notification settings
    pub notification_mode: String,  // "all", "smart", "vip_only"
    pub quiet_hours_enabled: bool,
    pub quiet_hours_start: String,   // "22:00"
    pub quiet_hours_end: String,     // "08:00"
    pub batch_notifications_enabled: bool,
    pub batch_interval_minutes: u64, // How long to batch before sending
    pub vip_senders: Vec<String>,    // Senders that always trigger immediate notification
    pub emergency_keywords: Vec<String>, // Keywords that bypass quiet hours
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
            // Smart notification defaults
            notification_mode: "smart".to_string(),  // smart is the default
            quiet_hours_enabled: false,
            quiet_hours_start: "22:00".to_string(),
            quiet_hours_end: "08:00".to_string(),
            batch_notifications_enabled: true,
            batch_interval_minutes: 15,
            vip_senders: vec![],
            emergency_keywords: vec![
                "emergency".to_string(),
                "911".to_string(),
                "urgent".to_string(),
                "critical".to_string(),
                "immediate".to_string(),
                "asap".to_string(),
                "fire".to_string(),
            ],
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

    // macOS app bundle: look in Resources directory
    // In macOS app bundles: exe is at .app/Contents/MacOS/, resources at .app/Contents/Resources/
    if let Some(contents_dir) = exe_dir.parent() {
        let resources_path = contents_dir.join("Resources").join("oauth_server.py");
        if let Some(path_str) = resources_path.to_str() {
            println!("Checking for oauth_server.py at: {:?}", resources_path);
            possible_paths.push(path_str.to_string());
        }
    }

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

        println!("Looking for Python executables...");
        for python_path in python_paths {
            if std::path::Path::new(python_path).exists() {
                println!("Found Python at: {}", python_path);
                println!("Spawning oauth_server at: {:?}", oauth_server_path);
                spawn_result = Some(Command::new(python_path)
                    .arg(&oauth_server_path)
                    .spawn());

                if let Some(Ok(child)) = &spawn_result {
                    println!("OAuth server spawned successfully with {}, PID: {:?}", python_path, child.id());
                    return Ok(true);
                } else if let Some(Err(e)) = &spawn_result {
                    println!("Failed to spawn with {}: {}", python_path, e);
                }
            } else {
                println!("Python not found at: {}", python_path);
            }
        }

        // If no absolute path worked, try the PATH-relative version as fallback
        println!("Trying 'python3' from PATH as fallback");
        let result = Command::new("python3")
            .arg(&oauth_server_path)
            .spawn();

        match result {
            Ok(child) => {
                println!("OAuth server spawned successfully with python3 from PATH, PID: {:?}", child.id());
                Ok(true)
            }
            Err(e) => {
                eprintln!("Failed to start OAuth server: {}", e);
                eprintln!("OAuth server path: {:?}", oauth_server_path);
                eprintln!("Python executable not found. Please ensure Python 3 is installed.");
                Ok(false)
            }
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

/// Proxy the generate-reply request to the Python OAuth server
/// This bypasses the webview's security restrictions
#[command]
pub async fn proxy_generate_reply(request: GenerateReplyRequest) -> Result<GenerateReplyResponse, String> {
    println!("[proxy_generate_reply] Sending request to Python server");

    // Build the JSON payload
    let json_payload = match serde_json::to_string(&request) {
        Ok(json) => json,
        Err(e) => {
            eprintln!("Failed to serialize request: {}", e);
            return Err(format!("Failed to serialize request: {}", e));
        }
    };

    println!("[proxy_generate_reply] Payload size: {} bytes", json_payload.len());

    // Try multiple possible curl locations
    let curl_paths = vec![
        "/opt/anaconda3/bin/curl",
        "/usr/bin/curl",
        "/opt/homebrew/bin/curl",
        "/usr/local/bin/curl",
        "curl",  // fallback to PATH
    ];

    let mut last_error = String::from("No curl found");

    for curl_path in curl_paths {
        let output = match Command::new(curl_path)
            .arg("-s")                          // Silent mode
            .arg("-X")                          // Specify method
            .arg("POST")                        // POST method
            .arg("-H")                          // Add header
            .arg("Content-Type: application/json")
            .arg("-d")                          // Data payload
            .arg(&json_payload)
            .arg("--connect-timeout")           // Connection timeout
            .arg("5")
            .arg("--max-time")                  // Max time for request
            .arg("60")                          // 60 seconds total (AI can take time)
            .arg("http://localhost:8081/generate-reply")
            .output()
        {
            Ok(output) => output,
            Err(e) => {
                last_error = format!("Failed to execute curl at {}: {}", curl_path, e);
                continue;
            }
        };

        if !output.status.success() {
            last_error = format!("HTTP request failed with status: {}", output.status);
            continue;
        }

        let response_body = match std::str::from_utf8(&output.stdout) {
            Ok(s) => s,
            Err(e) => {
                last_error = format!("Invalid response encoding: {}", e);
                continue;
            }
        };

        println!("[proxy_generate_reply] Response received: {} bytes", response_body.len());

        // Parse the response
        match serde_json::from_str::<GenerateReplyResponse>(response_body) {
            Ok(response) => {
                println!("[proxy_generate_reply] Successfully parsed response");
                return Ok(response);
            }
            Err(e) => {
                last_error = format!("Invalid response from server: {}", e);
                eprintln!("Failed to parse response JSON: {}", e);
                eprintln!("Response body: {}", response_body);
                continue;
            }
        }
    }

    eprintln!("[proxy_generate_reply] All curl attempts failed: {}", last_error);
    Err(last_error)
}

/// Analyze an email to detect questions and suggest formality
#[command]
pub async fn proxy_analyze_email(sender: String, subject: String, body_text: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    println!("[proxy_analyze_email] Sending analyze request to Python server");

    let payload = json!({
        "sender": sender,
        "subject": subject,
        "body_text": body_text
    });

    let json_payload = match serde_json::to_string(&payload) {
        Ok(json) => json,
        Err(e) => return Err(format!("Failed to serialize request: {}", e)),
    };

    // Try multiple possible curl locations
    let curl_paths = vec![
        "/opt/anaconda3/bin/curl",
        "/usr/bin/curl",
        "/opt/homebrew/bin/curl",
        "/usr/local/bin/curl",
        "curl",  // fallback to PATH
    ];

    let mut last_error = String::from("No curl found");

    for curl_path in curl_paths {
        let output = match Command::new(curl_path)
            .arg("-s")
            .arg("-X")
            .arg("POST")
            .arg("-H")
            .arg("Content-Type: application/json")
            .arg("-d")
            .arg(&json_payload)
            .arg("--connect-timeout")
            .arg("5")
            .arg("--max-time")
            .arg("30")
            .arg("http://localhost:8081/analyze-email")
            .output()
        {
            Ok(output) => output,
            Err(e) => {
                last_error = format!("Failed to execute curl at {}: {}", curl_path, e);
                continue;
            }
        };

        if !output.status.success() {
            last_error = format!("HTTP request failed");
            continue;
        }

        let response_body = match std::str::from_utf8(&output.stdout) {
            Ok(s) => s,
            Err(e) => {
                last_error = format!("Invalid response encoding: {}", e);
                continue;
            }
        };

        match serde_json::from_str::<serde_json::Value>(response_body) {
            Ok(response) => return Ok(response),
            Err(e) => {
                last_error = format!("Invalid response: {}", e);
                continue;
            }
        }
    }

    Err(last_error)
}

/// Check if the Python server is responding
#[command]
pub async fn check_server_health() -> Result<bool, String> {
    // First check if the process is running (more reliable than HTTP check)
    #[cfg(unix)]
    {
        let pgrep_result = Command::new("pgrep")
            .args(&["-f", "python.*oauth_server"])
            .output();

        if let Ok(output) = pgrep_result {
            if output.status.success() {
                println!("[check_server_health] Python process is running");
                return Ok(true);
            }
        }
    }

    // Try multiple possible curl locations for HTTP check
    let curl_paths = vec![
        "/opt/anaconda3/bin/curl",
        "/usr/bin/curl",
        "/opt/homebrew/bin/curl",
        "/usr/local/bin/curl",
        "curl",  // fallback to PATH
    ];

    for curl_path in curl_paths {
        let output = match Command::new(curl_path)
            .arg("-s")
            .arg("--connect-timeout")
            .arg("2")
            .arg("http://localhost:8081/health")
            .output()
        {
            Ok(output) => output,
            Err(_) => continue,  // Try next path
        };

        if !output.status.success() {
            continue;
        }

        let response_body = match std::str::from_utf8(&output.stdout) {
            Ok(s) => s,
            Err(_) => continue,
        };

        if response_body.contains("\"status\": \"ok\"") || response_body.contains("\"status\":\"ok\"") {
            println!("[check_server_health] Server is responding via HTTP");
            return Ok(true);
        }
    }

    println!("[check_server_health] Server not responding");
    Ok(false)
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

/// Check if a notification should be sent based on smart notification settings
/// Returns a tuple: (should_notify: bool, should_batch: bool, reason: String)
#[command]
pub async fn should_send_notification(
    sender: String,
    subject: String,
    category: String,
    settings: AppSettings,
) -> Result<(bool, bool, String), String> {
    // If notifications are disabled, don't send
    if !settings.enable_notifications {
        return Ok((false, false, "Notifications are disabled".to_string()));
    }

    let sender_lower = sender.to_lowercase();
    let subject_lower = subject.to_lowercase();
    let category_lower = category.to_lowercase();

    // Check for emergency keywords that bypass ALL settings
    for keyword in &settings.emergency_keywords {
        if subject_lower.contains(&keyword.to_lowercase())
            || sender_lower.contains(&keyword.to_lowercase()) {
            return Ok((true, false, format!("Emergency keyword detected: {}", keyword)));
        }
    }

    // Check quiet hours
    if settings.quiet_hours_enabled {
        if let (Ok(current), Ok(start), Ok(end)) = (
            chrono::Local::now().format("%H:%M").to_string().parse::<String>(),
            settings.quiet_hours_start.parse::<f32>(),
            settings.quiet_hours_end.parse::<f32>(),
        ) {
            let current_time = current.parse::<f32>().unwrap_or(0.0);
            // Handle overnight quiet hours (e.g., 22:00 to 08:00)
            let in_quiet_hours = if start > end {
                // Overnight period
                current_time >= start || current_time < end
            } else {
                // Same day period
                current_time >= start && current_time < end
            };

            if in_quiet_hours {
                // Only VIPs can bypass quiet hours
                let is_vip = settings.vip_senders.iter()
                    .any(|vip| sender_lower.contains(&vip.to_lowercase()));

                if is_vip {
                    return Ok((true, false, "VIP sender during quiet hours".to_string()));
                } else if !is_vip && category_lower == "urgent" {
                    return Ok((true, false, "Urgent email during quiet hours".to_string()));
                } else {
                    return Ok((false, true, "Quiet hours - will batch".to_string()));
                }
            }
        }
    }

    // Check VIP senders (always immediate notification)
    let is_vip = settings.vip_senders.iter()
        .any(|vip| sender_lower.contains(&vip.to_lowercase()));

    if is_vip {
        return Ok((true, false, "VIP sender".to_string()));
    }

    // Check important senders list
    let is_important_sender = settings.important_senders.iter()
        .any(|imp| sender_lower.contains(&imp.to_lowercase()));

    // Apply notification mode logic
    match settings.notification_mode.as_str() {
        "all" => {
            // All notifications, but can still batch if enabled
            return Ok((true, settings.batch_notifications_enabled, "All notifications mode".to_string()));
        }
        "smart" => {
            // Smart mode: immediate for urgent/important, batch for normal/low
            if category_lower == "urgent" || category_lower == "important" || is_important_sender {
                return Ok((true, false, "Smart mode - high priority".to_string()));
            } else if category_lower == "normal" || category_lower == "low" {
                return Ok((false, true, "Smart mode - batch normal/low emails".to_string()));
            }
            return Ok((true, settings.batch_notifications_enabled, "Smart mode - default".to_string()));
        }
        "vip_only" => {
            // Only notify for VIP, urgent, or important senders
            if category_lower == "urgent" || category_lower == "important" || is_important_sender {
                return Ok((true, false, "VIP mode - high priority".to_string()));
            }
            return Ok((false, true, "VIP mode - not a priority sender".to_string()));
        }
        _ => {
            return Ok((true, settings.batch_notifications_enabled, "Default mode".to_string()));
        }
    }
}

