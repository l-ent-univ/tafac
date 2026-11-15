// The menu bar (macOS), in French: Tafac, Fichier, Édition, Présentation,
// Aller, Fenêtre. Tauri's default one is in English.
//
// Its commands go to the page in the window in front (src/desktopMenu.js),
// as a `tafac:command` event: « Aller » (⌘1…), « Nouveau message » (⌘N),
// « Rechercher » (⌘F), « Actualiser » (⌘R). « Réglages… » (⌘,) opens the
// app's own Réglages (`tafac:open-settings`, src/App.jsx). « Imprimer… »
// (⌘P) is the system's print panel for that window. « Rechercher les mises à
// jour… » checks now (updater.rs), which answers with a note in that window;
// greyed in a build that doesn't update (a local one).
//
// The page tells the menu what it has (POST /__desktop/menu, desktop.rs →
// `update`): « Aller »'s pages (the university's, none signed out), the
// one in view (ticked), and which commands apply there (the others greyed).
// Where the university has Moodle in the app (moodle.rs), « Aller » starts
// with « Précédent » (⌘[) and « Suivant » (⌘]), as Finder's: Moodle's own
// history, greyed off its page. « Imprimer… » there prints Moodle's page.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Manager, Runtime};

use crate::window::Page;

const CHECK_UPDATES: &str = "check-updates";
const SETTINGS: &str = "settings";
const NEW_MESSAGE: &str = "new-message";
const FIND: &str = "find";
const REFRESH: &str = "refresh";
const PRINT: &str = "print";
const BACK: &str = "back";
const FORWARD: &str = "forward";
const GO_PREFIX: &str = "go:";

// What the page sent (src/desktopMenu.js).
#[derive(Deserialize, Default)]
pub struct PageState {
    #[serde(default)]
    pages: Vec<PageEntry>,
    current: Option<String>,
    #[serde(default)]
    compose: bool,
    #[serde(default)]
    find: bool,
    #[serde(default)]
    refresh: bool,
    // Moodle's history (« Précédent », « Suivant »): None where the
    // university has no Moodle in the app, and the entries aren't there.
    #[serde(default)]
    history: Option<History>,
}

#[derive(Deserialize, Clone, Copy)]
struct History {
    #[serde(default)]
    back: bool,
    #[serde(default)]
    forward: bool,
}

#[derive(Deserialize)]
struct PageEntry {
    id: String,
    label: String,
}

// The items the page's state changes.
struct Handles<R: Runtime> {
    go: Submenu<R>,
    new_message: MenuItem<R>,
    find: MenuItem<R>,
    refresh: MenuItem<R>,
}

struct MenuState<R: Runtime>(Mutex<Handles<R>>);

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadata {
        name: Some("Tafac".into()),
        version: Some(app.package_info().version.to_string()),
        website: Some("https://tafac.fr".into()),
        website_label: Some("tafac.fr".into()),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        "Tafac",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("À propos de Tafac"), Some(about))?,
            &MenuItem::with_id(
                app,
                CHECK_UPDATES,
                "Rechercher les mises à jour…",
                crate::updater::enabled(&app.package_info().version),
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, SETTINGS, "Réglages…", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("Services"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Masquer Tafac"))?,
            &PredefinedMenuItem::hide_others(app, Some("Masquer les autres"))?,
            &PredefinedMenuItem::show_all(app, Some("Tout afficher"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quitter Tafac"))?,
        ],
    )?;

    // Greyed until the page says (signed in, a mail page).
    let new_message = MenuItem::with_id(app, NEW_MESSAGE, "Nouveau message", false, Some("CmdOrCtrl+N"))?;
    let file_menu = Submenu::with_items(
        app,
        "Fichier",
        true,
        &[
            &new_message,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Fermer la fenêtre"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, PRINT, "Imprimer…", true, Some("CmdOrCtrl+P"))?,
        ],
    )?;

    // Without it, ⌘C, ⌘V, ⌘Z… do nothing in the page's fields.
    let find = MenuItem::with_id(app, FIND, "Rechercher", false, Some("CmdOrCtrl+F"))?;
    let edit_menu = Submenu::with_items(
        app,
        "Édition",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Annuler"))?,
            &PredefinedMenuItem::redo(app, Some("Rétablir"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Couper"))?,
            &PredefinedMenuItem::copy(app, Some("Copier"))?,
            &PredefinedMenuItem::paste(app, Some("Coller"))?,
            &PredefinedMenuItem::select_all(app, Some("Tout sélectionner"))?,
            &PredefinedMenuItem::separator(app)?,
            &find,
        ],
    )?;

    let refresh = MenuItem::with_id(app, REFRESH, "Actualiser", false, Some("CmdOrCtrl+R"))?;
    let view_menu = Submenu::with_items(
        app,
        "Présentation",
        true,
        &[&refresh, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::fullscreen(app, Some("Plein écran"))?],
    )?;

    // Filled by the page (`update`).
    let go = Submenu::with_items(app, "Aller", false, &[])?;

    // Its id makes it macOS' Window menu: the system adds the open windows
    // to it.
    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Fenêtre",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Réduire"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, Some("Tout ramener au premier plan"))?,
        ],
    )?;

    let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &go, &window_menu])?;
    app.manage(MenuState(Mutex::new(Handles { go, new_message, find, refresh })));
    Ok(menu)
}

// The page's state (desktop.rs, POST /__desktop/menu).
pub fn update<R: Runtime>(app: &AppHandle<R>, state: PageState) {
    let Some(menu_state) = app.try_state::<MenuState<R>>() else { return };
    let Ok(handles) = menu_state.0.lock() else { return };
    let _ = handles.new_message.set_enabled(state.compose);
    let _ = handles.find.set_enabled(state.find);
    let _ = handles.refresh.set_enabled(state.refresh);

    if let Ok(items) = handles.go.items() {
        for item in items {
            let _ = handles.go.remove(item_ref(&item));
        }
    }
    if let (Some(history), false) = (state.history, state.pages.is_empty()) {
        if let Ok(item) = MenuItem::with_id(app, BACK, "Précédent", history.back, Some("CmdOrCtrl+[")) {
            let _ = handles.go.append(&item);
        }
        if let Ok(item) = MenuItem::with_id(app, FORWARD, "Suivant", history.forward, Some("CmdOrCtrl+]")) {
            let _ = handles.go.append(&item);
        }
        if let Ok(separator) = PredefinedMenuItem::separator(app) {
            let _ = handles.go.append(&separator);
        }
    }
    for (index, page) in state.pages.iter().enumerate() {
        // ⌘1 to ⌘9, in the sidebar's order.
        let shortcut = (index < 9).then(|| format!("CmdOrCtrl+{}", index + 1));
        let checked = state.current.as_deref() == Some(page.id.as_str());
        if let Ok(item) = CheckMenuItem::with_id(app, format!("{GO_PREFIX}{}", page.id), &page.label, true, checked, shortcut.as_deref()) {
            let _ = handles.go.append(&item);
        }
    }
    let _ = handles.go.set_enabled(!state.pages.is_empty());
}

fn item_ref<R: Runtime>(item: &MenuItemKind<R>) -> &dyn tauri::menu::IsMenuItem<R> {
    match item {
        MenuItemKind::MenuItem(item) => item,
        MenuItemKind::Submenu(item) => item,
        MenuItemKind::Predefined(item) => item,
        MenuItemKind::Check(item) => item,
        MenuItemKind::Icon(item) => item,
    }
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == CHECK_UPDATES {
        crate::updater::check_from_menu(app, front_window(app).map(|page| page.view));
        return;
    }
    let Some(Page { window, view }) = front_window(app) else { return };
    let script = match id {
        SETTINGS => "window.dispatchEvent(new Event('tafac:open-settings'))".to_string(),
        PRINT => {
            // Moodle's page when it is the one in view, else the app's.
            let _ = match crate::moodle::shown_in(app, window.label()) {
                Some(moodle) => moodle.print(),
                None => view.print(),
            };
            return;
        }
        NEW_MESSAGE | FIND | REFRESH | BACK | FORWARD => command_script(id, None),
        _ => match id.strip_prefix(GO_PREFIX) {
            Some(page) => command_script("go", Some(page)),
            None => return,
        },
    };
    let _ = view.eval(&script);
}

// The window in front, else the main one, brought back if it was closed
// (hidden: closing it doesn't quit, main.rs).
fn front_window<R: Runtime>(app: &AppHandle<R>) -> Option<Page<R>> {
    if let Some(page) = crate::window::pages(app).into_iter().find(|page| page.window.is_focused().unwrap_or(false)) {
        return Some(page);
    }
    let page = crate::window::page(app, "main")?;
    let _ = page.window.show();
    let _ = page.window.set_focus();
    Some(page)
}

fn command_script(command: &str, page: Option<&str>) -> String {
    let detail = serde_json::json!({ "command": command, "page": page });
    format!("window.dispatchEvent(new CustomEvent('tafac:command', {{ detail: {detail} }}))")
}
