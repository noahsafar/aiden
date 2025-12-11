use tauri::{AppHandle, Manager, CustomMenuItem, Menu, MenuItem, Submenu, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTraySubmenu};

pub struct SystemTrayService {
    app_handle: AppHandle,
}

impl SystemTrayService {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub fn create_system_tray(&self) -> SystemTray {
        let quit = CustomMenuItem::new("quit".to_string(), "Quit Aiden");
        let hide = CustomMenuItem::new("hide".to_string(), "Hide Window");
        let show = CustomMenuItem::new("show".to_string(), "Show Aiden");
        let check_emails = CustomMenuItem::new("check_emails".to_string(), "Check for New Emails");

        let menu = SystemTrayMenu::new()
            .add_item(CustomMenuItem::new("show".to_string(), "📧 Aiden").disabled())
            .add_native_item(MenuItem::Separator)
            .add_item(check_emails)
            .add_native_item(MenuItem::Separator)
            .add_item(hide)
            .add_item(show)
            .add_native_item(MenuItem::Separator)
            .add_submenu(
                Submenu::new(
                    "Settings",
                    Menu::new()
                        .add_item(CustomMenuItem::new("notifications".to_string(), "Notifications"))
                        .add_item(CustomMenuItem::new("auto_reply".to_string(), "Auto-Reply Settings"))
                        .add_item(CustomMenuItem::new("check_interval".to_string(), "Check Interval"))
                )
            )
            .add_native_item(MenuItem::Separator)
            .add_item(quit);

        SystemTray::new().with_menu(menu)
    }

    pub fn handle_system_tray_event(&self, app: &AppHandle, event: SystemTrayEvent) {
        match event {
            SystemTrayEvent::MenuItemClick { id, .. } => {
                let item_handle = app.tray_handle().get_item(&id);
                match id.as_str() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "hide" => {
                        let window = app.get_webview_window("main").unwrap();
                        let _ = window.hide();
                    }
                    "show" => {
                        let window = app.get_webview_window("main").unwrap();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    "check_emails" => {
                        // Emit event to check for new emails
                        app.emit("check-new-emails", ()).ok();
                    }
                    "notifications" => {
                        // TODO: Open notifications settings
                    }
                    "auto_reply" => {
                        // TODO: Open auto-reply settings
                    }
                    "check_interval" => {
                        // TODO: Open check interval settings
                    }
                    _ => {}
                }
            }
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_webview_window("main").unwrap();
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        }
    }

    pub fn update_tray_tooltip(&self, message: &str) {
        if let Some(tray) = self.app_handle.tray_handle() {
            let _ = tray.set_tooltip(Some(message));
        }
    }
}