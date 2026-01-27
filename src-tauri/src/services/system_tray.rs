use tauri::{AppHandle, Emitter, Manager};
use tauri::menu::{Menu, MenuItem, Submenu, MenuId};
use tauri::tray::{TrayIcon, TrayIconEvent, TrayIconBuilder};

#[derive(Clone)]
pub struct SystemTrayService {
    app_handle: AppHandle,
}

impl SystemTrayService {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub async fn create_system_tray(app: &AppHandle) -> Result<TrayIcon, Box<dyn std::error::Error>> {
        // Create the menu items
        let show_item = MenuItem::with_id(
            app,
            MenuId::new("show"),
            "Show Aiden",
            true,
            None::<&str>
        )?;

        let hide_item = MenuItem::with_id(
            app,
            MenuId::new("hide"),
            "Hide Window",
            true,
            None::<&str>
        )?;

        let check_emails_item = MenuItem::with_id(
            app,
            MenuId::new("check_emails"),
            "Check for New Emails",
            true,
            None::<&str>
        )?;

        let quit_item = MenuItem::with_id(
            app,
            MenuId::new("quit"),
            "Quit Aiden",
            true,
            None::<&str>
        )?;

        // Create settings submenu items
        let notifications_item = MenuItem::with_id(
            app,
            MenuId::new("notifications"),
            "Notifications",
            true,
            None::<&str>
        )?;

        let auto_reply_item = MenuItem::with_id(
            app,
            MenuId::new("auto_reply"),
            "Auto-Reply Settings",
            true,
            None::<&str>
        )?;

        let check_interval_item = MenuItem::with_id(
            app,
            MenuId::new("check_interval"),
            "Check Interval",
            true,
            None::<&str>
        )?;

        // Create settings submenu
        let settings_submenu = Submenu::with_items(
            app,
            "Settings",
            true,
            &[&notifications_item, &auto_reply_item, &check_interval_item],
        )?;

        // Create main menu
        let menu = Menu::with_items(app, &[&show_item, &check_emails_item, &hide_item, &settings_submenu, &quit_item])?;

        // Create the tray icon
        let _tray = TrayIconBuilder::new()
            .menu(&menu)
            .tooltip("Aiden")
            .build(app)?;

        Ok(_tray)
    }

    pub fn handle_event(&self, app: &AppHandle, event: &TrayIconEvent) {
        match event {
            TrayIconEvent::Click { .. } => {
                // Toggle window visibility on click
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            _ => {}
        }
    }

    pub fn handle_menu_item(&self, app: &AppHandle, id: &str) {
        match id {
            "quit" => {
                std::process::exit(0);
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "check_emails" => {
                // Emit event to frontend to check for new emails
                let _ = app.emit("check-new-emails", ());
            }
            "notifications" => {
                // TODO: Open notifications settings
                let _ = app.emit("open-settings", "notifications");
            }
            "auto_reply" => {
                // TODO: Open auto-reply settings
                let _ = app.emit("open-settings", "auto_reply");
            }
            "check_interval" => {
                // TODO: Open check interval settings
                let _ = app.emit("open-settings", "check_interval");
            }
            _ => {}
        }
    }

    pub fn update_tray_tooltip(&self, message: &str) {
        // Update tooltip if needed
        if let Some(tray) = self.app_handle.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(message));
        }
    }
}
