// Tafac's look over Moodle's pages in Moodle's view (moodle.rs): its colours,
// faces and corners on Moodle's own (moodle_style.css, and
// moodle_style_dark.css in the dark theme), put in by moodle_style.js, which
// WebKit runs before each page's own scripts, in the page's top frame only.
// The university's sign-in pages, frames from other sites and the files
// Moodle serves as they are (pluginfile.php) are left alone.
//
// The colours are the app's, as its page shows them (palette and dark theme
// included): the page sends them (POST /__desktop/moodle/theme, and with
// `open`), the script the view is made with carries them, and a change
// while the view is there reaches its page as an event.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

const SCRIPT: &str = include_str!("moodle_style.js");
const CSS: &str = include_str!("moodle_style.css");
const DARK_CSS: &str = include_str!("moodle_style_dark.css");

// The app's faces (src/assets/fonts, as src/index.css declares them): Collab
// Sans for the text, regular and semi-bold (bold falls on semi-bold), SN Pro
// bold for the headings. Given as bytes: no address for a page's policy to
// refuse.
const LATIN: &str = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT: &str = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

struct Font {
    family: &'static str,
    weight: &'static str,
    range: Option<&'static str>,
    bytes: &'static [u8],
}

const FONTS: [Font; 4] = [
    Font { family: "Collab Sans", weight: "400", range: None, bytes: include_bytes!("../../src/assets/fonts/CollabSans-Regular.woff2") },
    Font { family: "Collab Sans", weight: "600", range: None, bytes: include_bytes!("../../src/assets/fonts/CollabSans-SemiBold.woff2") },
    Font { family: "SN Pro", weight: "700", range: Some(LATIN), bytes: include_bytes!("../../src/assets/fonts/SNPro-700-latin.woff2") },
    Font { family: "SN Pro", weight: "700", range: Some(LATIN_EXT), bytes: include_bytes!("../../src/assets/fonts/SNPro-700-latin-ext.woff2") },
];

// The colours the view takes (moodle_style.css reads them as --tafac-<name>).
// Keep in sync with MOODLE_THEME_TOKENS in src/desktopMoodle.js.
const THEME_TOKENS: [&str; 35] = [
    "surface-page",
    "surface-sunken",
    "surface-subtle",
    "surface-strong",
    "surface-field",
    "surface-card",
    "surface-raised",
    "surface-raised-hover",
    "ink",
    "ink-secondary",
    "ink-muted",
    "ink-faint",
    "line",
    "line-strong",
    "state-hover",
    "state-press",
    "focus-ring",
    "brand",
    "brand-hover",
    "brand-soft",
    "on-brand",
    "danger",
    "danger-soft",
    "warning",
    "warning-soft",
    "success",
    "success-soft",
    "info",
    "info-soft",
    "notify",
    "scrim",
    "shadow-tint",
    "sidebar",
    "glass-fill",
    "glass-fill-hover",
];

// What the page sends: the theme as it shows it.
#[derive(Deserialize, Debug)]
pub struct ThemeBody {
    #[serde(default)]
    dark: bool,
    #[serde(default)]
    tokens: BTreeMap<String, String>,
}

// As the view's script takes it: `version` tells a newer theme from an older
// one (one page's storage against the next event).
#[derive(Serialize, Clone, Debug)]
pub struct Theme {
    version: u64,
    dark: bool,
    tokens: BTreeMap<String, String>,
}

static VERSION: AtomicU64 = AtomicU64::new(0);

impl Theme {
    // The known colours only, each one as a browser writes a colour (rgb(),
    // oklch(), color(srgb …)): nothing that could close the rule it goes
    // in. The script checks again (CSS.supports).
    pub fn from_body(body: ThemeBody) -> Self {
        let tokens = body.tokens.into_iter().filter(|(name, value)| THEME_TOKENS.contains(&name.as_str()) && is_colour(value)).collect();
        Self { version: VERSION.fetch_add(1, Ordering::Relaxed) + 1, dark: body.dark, tokens }
    }

    pub fn looks_like(&self, other: &Self) -> bool {
        self.dark == other.dark && self.tokens == other.tokens
    }
}

fn is_colour(value: &str) -> bool {
    !value.is_empty() && value.len() <= 96 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b" .,%()/-#".contains(&byte))
}

fn fonts() -> &'static serde_json::Value {
    static FONTS_JSON: OnceLock<serde_json::Value> = OnceLock::new();
    FONTS_JSON.get_or_init(|| {
        FONTS
            .iter()
            .map(|font| {
                let mut entry = serde_json::json!({ "family": font.family, "weight": font.weight, "data": crate::moodle::base64(font.bytes) });
                if let Some(range) = font.range {
                    entry["range"] = range.into();
                }
                entry
            })
            .collect()
    })
}

// The view's script, for a Moodle at `host`, with the theme the app's page
// last sent (Sable's light one without).
pub fn script(host: &str, theme: Option<&Theme>) -> String {
    let config = serde_json::json!({ "host": host, "css": CSS, "dark": DARK_CSS, "theme": theme, "fonts": fonts() });
    format!("{SCRIPT}({config});")
}

// Tells the view's page of `theme` (moodle_style.js listens; a page not of
// Moodle's doesn't).
pub fn announce(theme: &Theme) -> String {
    let detail = serde_json::to_string(theme).unwrap_or_else(|_| "null".into());
    format!("document.dispatchEvent(new CustomEvent('tafac:moodle-theme', {{ detail: {detail} }}))")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(json: &str) -> ThemeBody {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn only_known_colours_reach_the_view() {
        let theme = Theme::from_body(body(
            r#"{ "dark": true, "tokens": {
                "ink": "rgb(228, 228, 228)",
                "brand": "oklch(0.78 0.1064 245)",
                "glass-fill": "color(srgb 0.104706 0.104706 0.104706)",
                "surface-card": "red; } body { display: none",
                "line": "url(https://example.com/x)",
                "made-up": "rgb(0, 0, 0)"
            } }"#,
        ));
        assert!(theme.dark);
        assert_eq!(theme.tokens.keys().map(String::as_str).collect::<Vec<_>>(), ["brand", "glass-fill", "ink"]);
    }

    #[test]
    fn each_theme_is_newer_than_the_last() {
        let first = Theme::from_body(body(r#"{ "dark": false }"#));
        let second = Theme::from_body(body(r#"{ "dark": false }"#));
        assert!(second.version > first.version);
        assert!(first.looks_like(&second));
        assert!(!first.looks_like(&Theme::from_body(body(r#"{ "dark": true }"#))));
    }

    #[test]
    fn the_script_carries_the_style_the_faces_and_the_theme() {
        let theme = Theme::from_body(body(r#"{ "dark": true, "tokens": { "ink": "rgb(228, 228, 228)" } }"#));
        let script = script("foad.univ-rennes.fr", Some(&theme));
        assert!(script.starts_with(SCRIPT));
        assert!(script.ends_with(");"));
        let config: serde_json::Value = serde_json::from_str(&script[SCRIPT.len() + 1..script.len() - 2]).unwrap();
        assert_eq!(config["host"], "foad.univ-rennes.fr");
        assert_eq!(config["css"], CSS);
        assert_eq!(config["dark"], DARK_CSS);
        assert_eq!(config["theme"]["dark"], true);
        assert_eq!(config["theme"]["tokens"]["ink"], "rgb(228, 228, 228)");
        assert_eq!(config["fonts"].as_array().map(Vec::len), Some(FONTS.len()));
        assert_eq!(config["fonts"][2]["family"], "SN Pro");
        assert!(config["fonts"][0].get("range").is_none());
    }

    #[test]
    fn the_announcement_is_an_event_with_the_theme() {
        let theme = Theme::from_body(body(r#"{ "dark": false, "tokens": { "brand": "rgb(73, 29, 17)" } }"#));
        let announcement = announce(&theme);
        assert!(announcement.starts_with("document.dispatchEvent(new CustomEvent('tafac:moodle-theme', { detail: {"));
        assert!(announcement.contains(r#""brand":"rgb(73, 29, 17)""#));
    }
}
