// The automatic signature under a sent mail, built here from what the
// server knows (the identity's name, the session's CAS login where the
// university shows it, the university's settings) and two short choices of
// the page (its group's label, its establishment's id, looked up in the
// settings): never from HTML the page sends. Node's buildMailSignature,
// resolveMailSignature and readPngSize (server/mailSend.js,
// server/entAuthApp.js).
//
// The settings are the ones Node read (universities/<id>/server.js,
// mail.signature, gone with it): these are the settings now. The logos are the
// same PNG files, in the binary: their size is read from the file (drawn at
// 2×, shown at half).

use tonapi_providers::mail::text::{escape_html, trim_js};

use super::payload::{SignatureChoice, SignatureMode};

// The colours of the editor's look (MailSignatureView).
const TEXT_COLOR: &str = "#1d1d1f";
const MUTED_COLOR: &str = "#6b625b";

// ── The universities' settings ──────────────────────────────────────────────

pub(crate) struct Logo {
    // Its file in universities/<id>/assets/mail/.
    #[allow(dead_code)] // held to the JS settings by a test
    pub file: &'static str,
    pub png: &'static [u8],
    // A text for clients that don't show images.
    pub alt: &'static str,
}

pub(crate) struct Establishment {
    // Its id (client.js's establishments.byId), as the page names it.
    pub id: &'static str,
    pub label: &'static str,
    pub logo: Option<Logo>,
}

pub(crate) struct SignatureSettings {
    pub university: &'static str,
    // A line « Identifiant : <CAS login> » under the name.
    pub show_login: bool,
    pub logo: Option<Logo>,
    pub establishments: &'static [Establishment],
}

macro_rules! logo {
    ($university:literal, $file:literal, $alt:expr) => {
        Logo { file: $file, png: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../universities/", $university, "/assets/mail/", $file)), alt: $alt }
    };
}

const RENNES: &str = "Université de Rennes";
const RENNES_2: &str = "Université Rennes 2";

const SETTINGS: &[(&str, SignatureSettings)] = &[
    (
        "univ-rennes",
        SignatureSettings {
            university: RENNES,
            show_login: false,
            logo: Some(logo!("univ-rennes", "logo.png", RENNES)),
            establishments: &[Establishment { id: "iutlan", label: "IUT de Lannion", logo: Some(logo!("univ-rennes", "iutlan.png", "IUT de Lannion")) }],
        },
    ),
    // One establishment, the university itself (its name said once).
    (
        "univ-rennes-2",
        SignatureSettings {
            university: RENNES_2,
            show_login: true,
            logo: Some(logo!("univ-rennes-2", "logo.png", RENNES_2)),
            establishments: &[Establishment { id: "rennes2", label: RENNES_2, logo: None }],
        },
    ),
];

// The university's signature settings; None for one without (no mail).
pub(crate) fn settings(university: &str) -> Option<&'static SignatureSettings> {
    SETTINGS.iter().find_map(|(id, settings)| (*id == university).then_some(settings))
}

impl SignatureSettings {
    // The establishment of that id, its own entry only.
    pub(crate) fn establishment(&self, id: &str) -> Option<&'static Establishment> {
        self.establishments.iter().find(|establishment| establishment.id == id)
    }
}

// ── A PNG's size ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PngSize {
    pub width: u32,
    pub height: u32,
}

// A PNG's size in pixels, from its IHDR, or None for anything that isn't a
// PNG (its whole signature, then IHDR as the first chunk).
pub(crate) fn read_png_size(bytes: &[u8]) -> Option<PngSize> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let read = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    Some(PngSize { width: read(16), height: read(20) })
}

// ── What a send's signature holds ───────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SignatureLines {
    pub name: String,
    // The session's CAS login, where the university shows it; checked again
    // when the signature is built.
    pub login: Option<String>,
    pub group: String,
    pub establishment: String,
    pub university: String,
}

// A logo to send with the mail, at the size it shows at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SignatureLogo {
    pub png: &'static [u8],
    pub width: u32,
    pub height: u32,
    pub alt: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedSignature {
    pub lines: SignatureLines,
    // The establishment's, then the university's.
    pub logos: Vec<SignatureLogo>,
}

fn shown(logo: &Logo) -> Option<SignatureLogo> {
    let size = read_png_size(logo.png)?;
    // Math.round(size / 2): a half rounds up.
    let half = |pixels: u32| pixels / 2 + pixels % 2;
    Some(SignatureLogo { png: logo.png, width: half(size.width), height: half(size.height), alt: logo.alt })
}

// What the automatic signature holds for a send (resolveMailSignature), or
// None when it's off or another one is chosen: the identity's name, the
// session's login where the settings show it (never the page's), the
// page's group label (cleaned by the payload), its establishment if the
// settings have that id, the university, their logos.
pub(crate) fn resolve_signature(university: &str, choice: &SignatureChoice, identity_name: &str, session_login: Option<&str>) -> Option<ResolvedSignature> {
    if !choice.include || choice.mode != SignatureMode::Auto {
        return None;
    }
    let settings = settings(university);
    let establishment = settings.zip(choice.establishment.as_deref()).and_then(|(settings, id)| settings.establishment(id));
    let lines = SignatureLines {
        name: identity_name.to_string(),
        login: settings.filter(|settings| settings.show_login).and(session_login).map(str::to_string),
        group: choice.group.clone(),
        establishment: establishment.map(|establishment| establishment.label.to_string()).unwrap_or_default(),
        university: settings.map(|settings| settings.university.to_string()).unwrap_or_default(),
    };
    let logos = [establishment.and_then(|establishment| establishment.logo.as_ref()), settings.and_then(|settings| settings.logo.as_ref())];
    Some(ResolvedSignature { lines, logos: logos.into_iter().flatten().filter_map(shown).collect() })
}

// ── The signature as sent ───────────────────────────────────────────────────

// A logo as an inline part of the mail: its Content-ID (with or without its
// angle brackets), its size, its text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LogoPart {
    pub cid: String,
    pub width: u32,
    pub height: u32,
    pub alt: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct BuiltSignature {
    pub html: String,
    pub text: String,
}

// The CAS login a signature names (signatureLogin): letters, digits, « . »,
// « - », « _ », 32 at most. Anything else (an address typed to sign in) is
// no line rather than a wrong one.
fn signature_login(login: Option<&str>) -> Option<&str> {
    let login = trim_js(login?);
    let valid = (1..=32).contains(&login.len()) && login.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    valid.then_some(login)
}

// The signature in the editor's look (buildMailSignature): a dash, the
// name, « Identifiant : », the group, the establishment and the university
// (one name once), the logos by cid; everything escaped. Its text
// alternative after « -- ».
pub(crate) fn build_mail_signature(lines: &SignatureLines, logos: &[LogoPart]) -> BuiltSignature {
    let mut places: Vec<&str> = Vec::new();
    for place in [trim_js(&lines.establishment), trim_js(&lines.university)] {
        if !place.is_empty() && !places.contains(&place) {
            places.push(place);
        }
    }
    let place = places.join(" – ");
    let login = signature_login(lines.login.as_deref()).map(|login| format!("Identifiant : {login}")).unwrap_or_default();
    let shown = [trim_js(&lines.name), trim_js(&login), trim_js(&lines.group), trim_js(&place)];
    if shown.iter().all(|line| line.is_empty()) && logos.is_empty() {
        return BuiltSignature::default();
    }
    let row = |text: &str, style: &str| -> String {
        match (text.is_empty(), style.is_empty()) {
            (true, _) => String::new(),
            (false, true) => format!("<div>{}</div>", escape_html(text)),
            (false, false) => format!("<div style=\"{style}\">{}</div>", escape_html(text)),
        }
    };
    let images: String = logos
        .iter()
        .enumerate()
        .map(|(index, logo)| {
            let cid = logo.cid.strip_prefix('<').unwrap_or(&logo.cid);
            let cid = cid.strip_suffix('>').unwrap_or(cid);
            let (width, height) = (logo.width, logo.height);
            let margin = if index > 0 { ";margin-left:10px" } else { "" };
            format!(
                "<img src=\"cid:{}\" width=\"{width}\" height=\"{height}\" alt=\"{}\" style=\"display:inline-block;width:{width}px;height:{height}px;border:0;outline:none;vertical-align:middle{margin}\" />",
                escape_html(cid),
                escape_html(&logo.alt)
            )
        })
        .collect();
    let mut html = format!("<div style=\"margin:14px 0 6px;font-size:14px;line-height:1.45;color:{MUTED_COLOR}\">");
    html.push_str(&row("—", ""));
    html.push_str(&row(shown[0], &format!("font-weight:600;color:{TEXT_COLOR}")));
    for line in &shown[1..] {
        html.push_str(&row(line, ""));
    }
    if !images.is_empty() {
        html.push_str(&format!("<div style=\"margin-top:8px;line-height:0\">{images}</div>"));
    }
    html.push_str("</div>");
    let text = std::iter::once("-- ").chain(shown.iter().copied().filter(|line| !line.is_empty())).collect::<Vec<_>>().join("\n");
    BuiltSignature { html, text }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(establishment: Option<&str>) -> SignatureChoice {
        SignatureChoice { include: true, mode: SignatureMode::Auto, group: "MMI 2".into(), establishment: establishment.map(str::to_string) }
    }

    #[test]
    fn the_signature_escaped_its_logos_inline_by_cid_with_their_size() {
        let lines = SignatureLines {
            name: "Camille <b>Martin</b>".into(),
            group: "MMI 2 · TP \"3\"".into(),
            establishment: "Université Rennes 2".into(),
            university: "Université Rennes 2".into(),
            ..SignatureLines::default()
        };
        let logos = [LogoPart { cid: "<tafac-logo-1.abc@tafac.fr>".into(), width: 35, height: 40, alt: "IUT \"Lannion\"".into() }];
        let BuiltSignature { html, text } = build_mail_signature(&lines, &logos);
        assert!(html.contains("Camille &lt;b&gt;Martin&lt;/b&gt;"));
        assert!(html.contains("MMI 2 · TP &quot;3&quot;"));
        // The same name once.
        assert!(html.contains("<div>Université Rennes 2</div>"));
        assert_eq!(html.matches("Université Rennes 2").count(), 1);
        assert!(html.contains("<img src=\"cid:tafac-logo-1.abc@tafac.fr\" width=\"35\" height=\"40\" alt=\"IUT &quot;Lannion&quot;\" style=\"display:inline-block;width:35px;height:40px;border:0;outline:none;vertical-align:middle\" />"));
        assert_eq!(text, "-- \nCamille <b>Martin</b>\nMMI 2 · TP \"3\"\nUniversité Rennes 2");
        assert_eq!(build_mail_signature(&SignatureLines::default(), &[]), BuiltSignature::default());
    }

    // Node's output for the same input, byte for byte (buildMailSignature).
    #[test]
    fn the_html_is_nodes() {
        let lines = SignatureLines { name: "Léo".into(), login: Some(" e2101234 ".into()), group: "L1".into(), establishment: "IUT de Lannion".into(), university: "Université de Rennes".into() };
        let logos = [
            LogoPart { cid: "<tafac-logo-1.x@tafac.fr>".into(), width: 35, height: 40, alt: "IUT de Lannion".into() },
            LogoPart { cid: "tafac-logo-2.x@tafac.fr".into(), width: 104, height: 40, alt: "Université de Rennes".into() },
        ];
        let built = build_mail_signature(&lines, &logos);
        assert_eq!(
            built.html,
            "<div style=\"margin:14px 0 6px;font-size:14px;line-height:1.45;color:#6b625b\"><div>—</div><div style=\"font-weight:600;color:#1d1d1f\">Léo</div><div>Identifiant : e2101234</div><div>L1</div><div>IUT de Lannion – Université de Rennes</div><div style=\"margin-top:8px;line-height:0\"><img src=\"cid:tafac-logo-1.x@tafac.fr\" width=\"35\" height=\"40\" alt=\"IUT de Lannion\" style=\"display:inline-block;width:35px;height:40px;border:0;outline:none;vertical-align:middle\" /><img src=\"cid:tafac-logo-2.x@tafac.fr\" width=\"104\" height=\"40\" alt=\"Université de Rennes\" style=\"display:inline-block;width:104px;height:40px;border:0;outline:none;vertical-align:middle;margin-left:10px\" /></div></div>"
        );
        assert_eq!(built.text, "-- \nLéo\nIdentifiant : e2101234\nL1\nIUT de Lannion – Université de Rennes");
        // A login that is an address, or anything else, is no line.
        for login in ["camille@univ.fr", "a b", "", &"a".repeat(33)] {
            let lines = SignatureLines { name: "Léo".into(), login: Some(login.into()), ..SignatureLines::default() };
            assert!(!build_mail_signature(&lines, &[]).html.contains("Identifiant"), "{login:?}");
        }
        // Logos alone still make a signature.
        assert!(!build_mail_signature(&SignatureLines::default(), &logos[..1]).html.is_empty());
    }

    #[test]
    fn a_pngs_size_from_its_header() {
        let bytes: Vec<u8> = (0..29).map(|index| u8::from_str_radix(&"89504e470d0a1a0a0000000d4948445200000046000000500806000000"[index * 2..index * 2 + 2], 16).unwrap()).collect();
        assert_eq!(read_png_size(&bytes), Some(PngSize { width: 70, height: 80 }));
        assert_eq!(read_png_size(b"GIF89a"), None);
        // The whole signature, then IHDR.
        let mut broken = bytes.clone();
        broken[5] = 0;
        assert_eq!(read_png_size(&broken), None);
        let mut other_chunk = bytes.clone();
        other_chunk[12..16].copy_from_slice(b"IDAT");
        assert_eq!(read_png_size(&other_chunk), None);
        assert_eq!(read_png_size(&bytes[..23]), None);
    }

    #[test]
    fn the_signature_of_a_send_from_the_universitys_settings() {
        let rennes = resolve_signature("univ-rennes", &choice(Some("iutlan")), "Camille Martin", Some("cmartin")).unwrap();
        assert_eq!(rennes.lines, SignatureLines { name: "Camille Martin".into(), login: None, group: "MMI 2".into(), establishment: "IUT de Lannion".into(), university: "Université de Rennes".into() });
        // The establishment's logo, then the university's, at half their size.
        let sizes: Vec<(u32, u32, &str)> = rennes.logos.iter().map(|logo| (logo.width, logo.height, logo.alt)).collect();
        assert_eq!(sizes, [(35, 40, "IUT de Lannion"), (104, 40, "Université de Rennes")]);
        let parts: Vec<LogoPart> = rennes.logos.iter().enumerate().map(|(index, logo)| LogoPart { cid: format!("<tafac-logo-{}.x@tafac.fr>", index + 1), width: logo.width, height: logo.height, alt: logo.alt.into() }).collect();
        let html = build_mail_signature(&rennes.lines, &parts).html;
        assert!(html.contains("IUT de Lannion – Université de Rennes"));
        assert!(html.contains("alt=\"Université de Rennes\""));

        // Rennes 2 names the session's login; its one establishment is the
        // university itself, without a logo of its own.
        let rennes_2 = resolve_signature("univ-rennes-2", &choice(Some("rennes2")), "Léo", Some("e2101234")).unwrap();
        assert_eq!(rennes_2.lines.login.as_deref(), Some("e2101234"));
        assert_eq!(rennes_2.logos.iter().map(|logo| (logo.width, logo.height)).collect::<Vec<_>>(), [(40, 40)]);
        let text = build_mail_signature(&rennes_2.lines, &[]).text;
        assert_eq!(text, "-- \nLéo\nIdentifiant : e2101234\nMMI 2\nUniversité Rennes 2");

        // An establishment the settings don't have, its own keys only.
        for unknown in ["constructor", "__proto__", "toString", "rennes2"] {
            let resolved = resolve_signature("univ-rennes", &choice(Some(unknown)), "Léo", None).unwrap();
            assert_eq!(resolved.lines.establishment, "", "{unknown}");
            assert_eq!(resolved.logos.len(), 1, "{unknown}");
        }
        // Off, or another kind: nothing built here.
        assert_eq!(resolve_signature("univ-rennes", &SignatureChoice { include: false, ..choice(None) }, "Léo", None), None);
        assert_eq!(resolve_signature("univ-rennes", &SignatureChoice { mode: SignatureMode::Partage, ..choice(None) }, "Léo", None), None);
        // A university without settings: the name and the group only.
        let none = resolve_signature("univ-sorbonne-nouvelle", &choice(Some("iutlan")), "Léo", Some("leo")).unwrap();
        assert_eq!(none.lines, SignatureLines { name: "Léo".into(), group: "MMI 2".into(), ..SignatureLines::default() });
        assert!(none.logos.is_empty());
    }
}
