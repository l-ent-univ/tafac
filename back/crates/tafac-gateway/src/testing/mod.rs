// A made-up campus for the tests, here and in what uses the crate (the
// apps' bridge): a portal, its CAS, a Moodle, an IUT's ScoDoc gateway, the
// school records and a library on this computer, as much of them as tonAPI
// and the launch relay ask, and the session cookie of a student there.

use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tonapi_config::ResolvedUniversity;

use crate::session::cookie;
use crate::Gateway;

pub const SECRET: &str = "a secret of the tests, long enough to be one";
pub const UNIVERSITY: &str = "univ-rennes";
pub const COOKIE_NAME: &str = cookie::PRODUCTION_COOKIE;
// The User-Agent Tafac goes under, to which the campus's CAS binds its ticket.
const NODE_AGENT: &str = "node";
// The campus's students: one signs in with a password; two are asked for a
// one-time code after it, the first with a code by mail as their only way
// to one, the second with an authenticator application, SMS and mail.
// Anyone else is refused.
pub const STUDENT: &str = "jdoe";
pub const STUDENT_WITH_CODE: &str = "otp-user";
pub const STUDENT_WITH_APP: &str = "totp-user";
pub const PASSWORD: &str = "the-password";
// The one code the CAS takes.
pub const CODE: &str = "246810";
// Where the university's API sends each student's codes, as it masks them.
pub const MAIL_OF_STUDENT_WITH_CODE: &str = "o***@exemple.test";
pub const SMS_OF_STUDENT_WITH_APP: &str = "06******12";
pub const MAIL_OF_STUDENT_WITH_APP: &str = "t***@exemple.test";
// Node's answer to a session check without a session.
pub const NODE_SAYS: &[u8] = br#"{"authenticated":false,"user":null,"analyticsEnabled":true,"university":"univ-rennes"}"#;

// The campus's listeners live on a runtime of their own, whatever runs the
// test that asks them.
static RUNTIME: LazyLock<tokio::runtime::Runtime> =
    LazyLock::new(|| tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("a runtime for the tests"));

pub fn block_on<F: Future>(future: F) -> F::Output {
    RUNTIME.block_on(future)
}

pub fn spawn<F>(future: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    RUNTIME.spawn(future);
}

// The portal (127.0.0.1) knows one session, `JSESSIONID=alive`, which it
// opens for a ticket of the CAS's, until it is told to forget the sessions
// it gave (the next one it opens is another); it lists the student's
// applications (uPortal's layout, and each tile's own fragment). The CAS is
// the same listener under
// another name (localhost): it signs STUDENT in with PASSWORD, and knows one
// ticket, `TGC=the-ticket`, until it is told to forget it. After the
// password of a student with a second factor it shows its code page (Esup
// OTP, as a step of its own flow), and takes CODE; the university's Esup
// OTP API is under /mfa-api/ on the CAS's host. Moodle is under
// /moodle/ on the portal's host: it signs in through the CAS and answers its
// calendar's two lists. The ScoDoc gateway is under /scodoc/: it signs in
// through the CAS too and answers one student's reports, a department's
// notice, a distribution, a PDF and the student's photo. The school records
// (ESUP MonDossierWeb, a Vaadin application) are under /mdw/: behind the CAS,
// they list two school certificates and give the file of each. The library
// under /library/ is a service like any other behind the CAS, for the
// launch relay to open. And the federation Moodle signs in through when the
// campus is asked for one (federated_settings): its discovery page under
// /wayf/, the university's IdP under /idp/.
pub struct Campus {
    port: String,
    // Each request received: its path and query, and its cookies.
    pub seen: Arc<Mutex<Vec<(String, String)>>>,
    // The paths something was posted to, in order (never what was posted).
    pub posted: Arc<Mutex<Vec<String>>>,
    state: Arc<State>,
}

#[derive(Default)]
struct State {
    moodle: Moodle,
    // The CAS no longer knows its ticket (signed out, or expired).
    ticket_gone: AtomicBool,
    // The CAS answers nothing but an error.
    cas_down: AtomicBool,
    // Esup OTP's API answers nothing but an error.
    code_api_down: AtomicBool,
    // The portal's sessions: it forgets the ones before when this goes up.
    portal_sessions: AtomicU32,
    // Each code the API was asked to send: « student method transport », and
    // « auto » when it was told the student didn't ask.
    codes_sent: Mutex<Vec<String>>,
    // ScoDoc has no photo of the student.
    no_photo: AtomicBool,
    // The school records list no certificate; answer nothing but an error.
    no_certificate: AtomicBool,
    records_down: AtomicBool,
}

// Moodle's state: the session it knows (a number: it forgets the one before
// when the number changes), and whether it answers at all.
#[derive(Default)]
struct Moodle {
    sessions: AtomicU32,
    down: AtomicBool,
}

// What the campus answers to one request.
struct Answer {
    status: &'static str,
    content_type: &'static str,
    body: String,
    // More headers, as written: a redirect's Location, a Set-Cookie.
    headers: Vec<String>,
}

impl Answer {
    fn of(status: &'static str, content_type: &'static str, body: String) -> Self {
        Self { status, content_type, body, headers: Vec::new() }
    }

    fn redirect(location: &str) -> Self {
        Self { status: "302 Found", content_type: "text/plain", body: String::new(), headers: vec![format!("location: {location}")] }
    }

    fn with(mut self, header: String) -> Self {
        self.headers.push(header);
        self
    }
}

fn token(claims: serde_json::Value) -> String {
    format!("{}.{}.signature", URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#), URL_SAFE_NO_PAD.encode(claims.to_string()))
}

const LOGIN_FORM: &str = r#"<html><body><form id="fm1" method="post" action="login">
    <input name="username"><input type="password" name="password">
    <input type="hidden" name="execution" value="e1s1"></form></body></html>"#;
// The form again, with the CAS's own words (Apereo's panel).
const LOGIN_REFUSED: &str = r#"<html><body><div id="loginErrorsPanel" class="banner banner-danger"><p>Invalid credentials.</p></div>
    <form id="fm1" method="post" action="login">
    <input name="username"><input type="password" name="password">
    <input type="hidden" name="execution" value="e1s2"></form></body></html>"#;
// Esup OTP's code page as Rennes' CAS shows it after a right password: one
// more step of the same flow, whose script names the university's API and
// the student there, and adds the field the code is typed in (`token`).
// `refused`: shown again after a code the CAS didn't take.
fn code_page(port: &str, student: &str, refused: bool) -> String {
    let (execution, errors) = match refused {
        true => ("e1s4", r#"<div id="errors" class="notification" data-status="error" role="alert"><p>Verification failed!</p><p>Please try again...</p></div>"#),
        false => ("e1s3", ""),
    };
    format!(
        r#"<html><head><title>Verification</title></head><body>
    <form method="post" id="fm1">{errors}<input type="hidden" name="_eventId_submit" value="Login" /><input type="hidden" name="execution" value="{execution}" /></form>
    <script type="module">
      const apiUrl = "http:\/\/localhost:{port}\/mfa-api";
      const uid = "{student}";
      const userHash = "made-up";
      (async () => {{ const url = new URL(apiUrl); }})();
    </script></body></html>"#
    )
}

// Esup OTP's API: who a student is (the ways to a code they turned on, and
// where a code goes, masked), and a code sent.
fn code_api_answer(method: &str, path: &str, state: &State) -> Answer {
    let json = |body: serde_json::Value| Answer::of("200 OK", "application/json", body.to_string());
    if state.code_api_down.load(Ordering::SeqCst) {
        return Answer::of("503 Service Unavailable", "text/plain", String::new());
    }
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    let parts: Vec<&str> = path.trim_start_matches("/mfa-api/users/").split('/').collect();
    let way = |active: bool, transports: &[&str]| serde_json::json!({ "active": active, "transports": transports });
    match (method, parts.as_slice()) {
        ("GET", [STUDENT_WITH_CODE, "made-up"]) => json(serde_json::json!({ "code": "Ok", "user": {
            "methods": { "codeRequired": true, "totp": way(false, &[]), "random_code": way(false, &["sms"]), "random_code_mail": way(true, &["mail"]), "push": way(false, &["push"]) },
            "transports": { "mail": MAIL_OF_STUDENT_WITH_CODE },
        } })),
        ("GET", [STUDENT_WITH_APP, "made-up"]) => json(serde_json::json!({ "code": "Ok", "user": {
            "methods": { "codeRequired": true, "totp": way(true, &[]), "random_code": way(true, &["sms", "mail"]), "push": way(false, &["push"]) },
            "transports": { "sms": SMS_OF_STUDENT_WITH_APP, "mail": MAIL_OF_STUDENT_WITH_APP },
        } })),
        ("POST", [student, "methods", way, "transports", transport, "made-up"]) => {
            state.codes_sent.lock().unwrap().push(format!("{student} {way} {transport} {query}").trim_end().to_string());
            json(serde_json::json!({ "code": "Ok" }))
        }
        _ => Answer::of("404 Not Found", "application/json", r#"{"code":"Error"}"#.to_string()),
    }
}

const SIGNED_IN_PAGE: &str = "<html><body><h2>Log In Successful</h2></body></html>";

fn query_of(path: &str, name: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (found, value) = pair.split_once('=')?;
        (found == name).then(|| percent_decoded(value))
    })
}

fn percent_decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let byte = bytes[at];
        let hex = (byte == b'%').then(|| text.get(at + 1..at + 3).and_then(|hex| u8::from_str_radix(hex, 16).ok())).flatten();
        match hex {
            Some(value) => {
                decoded.push(value);
                at += 3;
            }
            None => {
                decoded.push(if byte == b'+' { b' ' } else { byte });
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).to_string()
}

fn percent_encoded(text: &str) -> String {
    text.bytes().map(|byte| if byte.is_ascii_alphanumeric() { (byte as char).to_string() } else { format!("%{byte:02X}") }).collect()
}

// One event of Moodle's calendar, due `days` from now.
fn moodle_event(port: &str, id: u32, module: &str, name: &str, days: i64, action: bool) -> serde_json::Value {
    let due = chrono::Utc::now().timestamp() + days * 24 * 60 * 60 + 3600;
    let mut event = serde_json::json!({
        "id": id, "name": format!("{name} doit être rendu"), "activityname": name, "modulename": module,
        "eventtype": "due", "timesort": due, "timestart": due,
        "course": { "id": 7, "fullname": "Développement web" },
        "url": format!("http://127.0.0.1:{port}/moodle/mod/{module}/view.php?id={id}"),
    });
    if action {
        event["action"] = serde_json::json!({ "name": "Ajouter un travail", "url": format!("http://127.0.0.1:{port}/moodle/mod/{module}/view.php?id={id}"), "actionable": true });
    }
    event
}

// Moodle's answer to the two calls tonAPI sends in one request: what is
// still to do (overdue included), then the upcoming events, where what was
// handed in has lost its action.
fn moodle_calendar(port: &str) -> String {
    let event = |id, module, name, days, action| moodle_event(port, id, module, name, days, action);
    let to_do = [
        event(101, "assign", "Très vieux rendu", -10, true),
        event(102, "assign", "Rendu en retard A", -5, true),
        event(103, "quiz", "Quiz en retard", -3, true),
        event(104, "assign", "Rendu en retard B", -2, true),
        event(105, "assign", "Rendu en retard C", -1, true),
        event(106, "assign", "Maquette", 2, true),
        event(107, "forum", "Débat", 5, true),
        event(108, "assign", "Rapport", 7, true),
        event(109, "assign", "Rendu lointain", 40, true),
    ];
    let upcoming = [
        event(106, "assign", "Maquette", 2, true),
        event(201, "assign", "Compte rendu déjà rendu", 6, false),
        event(202, "quiz", "QCM passé", 8, false),
    ];
    serde_json::json!([
        { "error": false, "data": { "events": to_do, "firstid": 101, "lastid": 109 } },
        { "error": false, "data": { "events": upcoming } },
    ])
    .to_string()
}

fn moodle_answer(path: &str, cookies: &str, port: &str, moodle: &Moodle) -> Answer {
    let generation = moodle.sessions.load(Ordering::SeqCst);
    let session = format!("MoodleSession=open{generation}");
    let signed_in = cookies.contains(&session);
    let dashboard = |key: &str| {
        format!(r#"<html><head><script>M.cfg = {{"sesskey":"{key}","userId":42}};</script></head><body class="path-my">Tableau de bord</body></html>"#)
    };
    let route = path.split('?').next().unwrap_or_default();
    match route {
        "/moodle/login/index.php" => {
            let entry = format!("http://127.0.0.1:{port}/moodle/login/index.php?authCAS=CAS");
            if query_of(path, "ticket").as_deref() == Some("ST-campus") {
                Answer::redirect(&format!("http://127.0.0.1:{port}/moodle/my/")).with(format!("set-cookie: {session}; Path=/moodle"))
            } else if signed_in {
                Answer::of("200 OK", "text/html; charset=utf-8", dashboard(&format!("CAMPUSKEY{generation}")))
            } else {
                Answer::redirect(&format!("http://localhost:{port}/cas/login?service={}", percent_encoded(&entry)))
            }
        }
        // Moodle's entry by the federation: to the discovery page, with the
        // page to land on after.
        "/moodle/auth/shibboleth/index.php" => {
            let landing = query_of(path, "target").unwrap_or_else(|| format!("http://127.0.0.1:{port}/moodle/my/"));
            Answer::redirect(&format!("http://127.0.0.1:{port}/wayf/?return={}", percent_encoded(&landing)))
        }
        "/moodle/my/" if signed_in => Answer::of("200 OK", "text/html; charset=utf-8", dashboard(&format!("CAMPUSKEY{generation}"))),
        "/moodle/my/" => Answer::of("200 OK", "text/html; charset=utf-8", r#"<html><body class="notloggedin">Connexion</body></html>"#.to_string()),
        "/moodle/lib/ajax/service.php" => {
            if moodle.down.load(Ordering::SeqCst) {
                return Answer::of("503 Service Unavailable", "text/plain", String::new());
            }
            let key_matches = query_of(path, "sesskey").as_deref() == Some(format!("CAMPUSKEY{generation}").as_str());
            if signed_in && key_matches {
                Answer::of("200 OK", "application/json", moodle_calendar(port))
            } else {
                Answer::of("200 OK", "application/json", r#"[{"error":true,"exception":{"errorcode":"servicerequireslogin","message":"SECRET"}}]"#.to_string())
            }
        }
        _ => Answer::of("404 Not Found", "text/plain", String::new()),
    }
}

// The report ScoDoc's gateway gives for the current semester (901), as much
// of it as the page reads. Its second semester (890) is the same report
// without what only comes with the first connection.
pub fn scodoc_report() -> serde_json::Value {
    let evaluation = |id: u32, day: &str, value: &str| {
        serde_json::json!({
            "id": id, "description": format!("Contrôle {id}"), "evaluation_type": 0, "coef": "01.00",
            "date_debut": format!("{day}T00:00:00+02:00"), "date_fin": format!("{day}T00:00:00+02:00"),
            "note": { "value": value, "min": "04.00", "moy": "11.20", "max": "19.00" },
            "poids": { "UE1.1": 1 },
        })
    };
    serde_json::json!({
        "type": "BUT", "publie": true, "date": "2026-10-12T10:58:26+02:00", "formsemestre_id": 901,
        "etudiant": { "nom": "Doe", "prenom": "Jeanne", "code_nip": "21901234", "dept_acronym": "DEMO" },
        "formation": { "acronyme": "BUT DEMO", "titre": "BUT Démo" },
        "options": { "show_rangs": true, "show_ue_rangs": true, "show_ects": true },
        "ressources": { "R1.01": { "id": 5101, "titre": "Développement web", "moyenne": {}, "evaluations": [
            evaluation(7301, "2026-09-11", "12.50"), evaluation(7302, "2026-10-02", "~"),
        ] } },
        "saes": { "SAÉ 1.01": { "id": 5201, "titre": "Réaliser un site", "moyenne": { "value": "15.00" }, "evaluations": [] } },
        "ues_capitalisees": {},
        "ues": { "UE1.1": {
            "id": 300, "titre": "Comprendre", "color": "#6125C1",
            "moyenne": { "value": "12.50", "min": "05.00", "max": "17.00", "moy": "11.00", "rang": "4", "total": 56 },
            "bonus": "00.00", "malus": "00.00", "capitalise": null,
            "ressources": { "R1.01": { "id": 5101, "coef": 3, "moyenne": "12.50" } },
            "saes": { "SAÉ 1.01": { "id": 5201, "coef": 8, "moyenne": "15.00" } },
            "ECTS": { "acquis": 0, "total": 5 },
        } },
        "semestre": {
            "numero": 1, "annee_universitaire": "2026 - 2027", "date_debut": "2026-09-01", "date_fin": "2027-01-31",
            "groupes": [{ "id": 61, "group_name": "TD B", "partition": { "partition_name": "TD" } }],
            "notes": { "value": "13.96", "min": "08.00", "moy": "12.00", "max": "16.50" },
            "rang": { "value": "12", "total": 56, "groupes": { "61": { "value": "3", "total": 28 } } },
            "ECTS": { "acquis": 0, "total": 30 },
        },
    })
}

fn scodoc_first_connection() -> serde_json::Value {
    serde_json::json!({
        "config": {
            "releve_PDF": true, "liste_dep_publi_PDF": "", "histogramme": true,
            "afficher_absences": true, "liste_dep_publi_absences": "", "metrique_absences": "demi",
            "message_rapport_absences": "<p>Justifier sous <b>48 heures</b>.</p>",
        },
        "auth": { "session": "21901234", "name": "Jeanne Doe", "statut": 10 },
        "semestres": [
            { "titre": "BUT DEMO", "formsemestre_id": 890, "semestre_id": 2, "annee_scolaire": "2025/2026" },
            { "titre": "BUT DEMO", "formsemestre_id": 901, "semestre_id": 3, "annee_scolaire": "2026/2027" },
        ],
        "relevé": scodoc_report(),
        "absences": { "2026-10-05": [
            { "idAbs": 79015, "debut": 8, "fin": 10, "statut": "absent", "justifie": false, "enseignant": "prof@exemple.test", "matiereComplet": 5101, "dateFin": "2026-10-05" },
            { "idAbs": 79016, "debut": 10.25, "fin": 10.5, "statut": "retard", "justifie": true, "enseignant": "prof@exemple.test", "matiereComplet": 5101, "dateFin": "2026-10-05" },
        ] },
        "totauxAbsences": { "absent": { "demi": 3, "justifie": { "demi": 1 }, "non_justifie": { "demi": 2 } } },
    })
}

// The photo ScoDoc keeps of the student (what stands for one).
pub const SCODOC_PHOTO: &str = "PNG a photo of the campus";

// The IUT's ScoDoc gateway: a PHP session opened through the CAS, then
// data.php's actions and the PDF.
fn scodoc_answer(path: &str, cookies: &str, port: &str, has_photo: bool) -> Answer {
    const SESSION: &str = "PHPSESSID=notes-open";
    let signed_in = cookies.contains(SESSION);
    let root = format!("http://127.0.0.1:{port}/scodoc/");
    let lost = || Answer::of("200 OK", "application/json", r#"{"redirect":"/services/doAuth.php"}"#.to_string());
    match path.split('?').next().unwrap_or_default() {
        "/scodoc/" => Answer::of("200 OK", "text/html; charset=utf-8", "<html><body>Passerelle</body></html>".to_string()),
        "/scodoc/services/doAuth.php" => {
            if query_of(path, "ticket").as_deref() == Some("ST-campus") {
                Answer::redirect(&root).with(format!("set-cookie: {SESSION}; Path=/scodoc"))
            } else if signed_in {
                Answer::redirect(&root)
            } else {
                let service = format!("{root}services/doAuth.php?href={}", percent_encoded(&root));
                Answer::redirect(&format!("http://localhost:{port}/cas/login?service={}", percent_encoded(&service)))
            }
        }
        "/scodoc/services/data.php" if !signed_in => lost(),
        "/scodoc/services/data.php" => {
            let json = |value: serde_json::Value| Answer::of("200 OK", "application/json", value.to_string());
            match query_of(path, "q").as_deref() {
                Some("dataPremièreConnexion") => json(scodoc_first_connection()),
                Some("relevéEtudiant") if query_of(path, "semestre").as_deref() == Some("890") => {
                    let mut report = scodoc_report();
                    report["formsemestre_id"] = serde_json::json!(890);
                    json(serde_json::json!({ "relevé": report, "absences": [] }))
                }
                Some("relevéEtudiant") if query_of(path, "semestre").as_deref() == Some("901") => json(serde_json::json!({ "relevé": scodoc_report(), "absences": [] })),
                Some("getReportPageMessage") => json(serde_json::json!({ "message": "<p>Jury le 12 f&eacute;vrier.</p><p>Salle A.</p>" })),
                Some("listeNotes") => json(serde_json::json!([4.5, 9.0, 9.5, 11.0, 12.25, 13.0, 13.5, 16.0, 20.0])),
                Some("getStudentPic") if has_photo => Answer::of("200 OK", "image/png", SCODOC_PHOTO.to_string()),
                // As a gateway without a photo to give: a page, no image.
                Some("getStudentPic") => Answer::of("200 OK", "text/html; charset=utf-8", String::new()),
                _ => json(serde_json::json!({ "erreur": "Mauvaise requête." })),
            }
        }
        "/scodoc/services/bulletin_PDF.php" if signed_in => Answer::of("200 OK", "application/pdf", "%PDF-1.4 a report of the campus".to_string()),
        "/scodoc/services/bulletin_PDF.php" => Answer::of("200 OK", "text/html; charset=utf-8", "<html>Connexion</html>".to_string()),
        _ => Answer::of("404 Not Found", "text/plain", String::new()),
    }
}

// The school records (ESUP MonDossierWeb): a Vaadin application behind the
// CAS. Its page names the application; a first request opens its interface
// (the menu's buttons, a key to send back); a click on « Inscriptions »
// lists the files, one certificate a school year; each file is a PDF.
pub const CERTIFICATE_FILE: &str = "Certificat_de_Scolarité_X0001_2026-2027_JEANNE_DOE.pdf";
pub const CERTIFICATE_PDF: &str = "%PDF-1.4 a certificate of the campus";
const CERTIFICATE_PATH: &str = "/mdw/APP/connector/3/646/dl/Certificat_de_Scolarit%C3%A9_X0001_2026-2027_JEANNE_DOE.pdf";

fn records_answer(received: &Received<'_>, port: &str, state: &State) -> Answer {
    const SESSION: &str = "JSESSIONID=records-open";
    let Received { method, path, cookies, body, .. } = *received;
    if state.records_down.load(Ordering::SeqCst) {
        return Answer::of("503 Service Unavailable", "text/html; charset=utf-8", "<html>Maintenance</html>".to_string());
    }
    let signed_in = cookies.contains(SESSION);
    let root = format!("http://127.0.0.1:{port}/mdw/");
    let route = path.split('?').next().unwrap_or_default();
    match (method, route) {
        ("GET", "/mdw/login/cas") if query_of(path, "ticket").as_deref() == Some("ST-campus") => Answer::redirect(&root).with(format!("set-cookie: {SESSION}; Path=/mdw")),
        (_, "/mdw/") if !signed_in => Answer::redirect(&format!("http://localhost:{port}/cas/login?service={}", percent_encoded(&format!("{root}login/cas")))),
        ("GET", "/mdw/") => Answer::of(
            "200 OK",
            "text/html; charset=utf-8",
            r#"<html><body><div id="ROOT-2521314" class="v-app"></div><script>vaadin.initApplication("ROOT-2521314",{"theme":"valo-ul","serviceUrl":"."});</script></body></html>"#.to_string(),
        ),
        ("POST", "/mdw/") => {
            let interface = serde_json::json!({
                "Vaadin-Security-Key": "the-key-of-the-campus", "syncId": 0, "clientId": 0,
                "state": { "544": { "caption": "Etat-civil" }, "547": { "caption": "Inscriptions" }, "549": { "caption": "Notes & résultats" } },
            });
            Answer::of("200 OK", "application/json; charset=utf-8", serde_json::json!({ "v-uiId": 3, "uidl": interface.to_string() }).to_string())
        }
        ("POST", "/mdw/UIDL/") if signed_in => {
            let click: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
            if click["csrfToken"] != "the-key-of-the-campus" || click["rpc"][0][0] != "547" {
                return Answer::of("403 Forbidden", "application/json", "{}".to_string());
            }
            let file = |year: &str, connector: u32| {
                serde_json::json!({ "resources": { "dl": { "uRL": format!("app://APP/connector/3/{connector}/dl/Certificat_de_Scolarit%C3%A9_X0001_{year}_JEANNE_DOE.pdf") } } })
            };
            let files = match state.no_certificate.load(Ordering::SeqCst) {
                true => serde_json::json!({}),
                false => serde_json::json!({ "645": { "caption": "Certificat de scolarité " }, "646": file("2026-2027", 646), "652": file("2025-2026", 652) }),
            };
            Answer::of("200 OK", "application/json; charset=utf-8", format!("for(;;);{}", serde_json::json!([{ "syncId": 1, "state": files }])))
        }
        ("GET", CERTIFICATE_PATH) if signed_in => Answer::of("200 OK", "application/pdf", CERTIFICATE_PDF.to_string()),
        _ => Answer::of("404 Not Found", "text/plain", String::new()),
    }
}

// The library: a service behind the CAS as most are, for the launch relay.
// Its catalogue wants a visitor signed in (the CAS, then back with a
// ticket); the rest is what a service's address may answer instead.
fn library_answer(path: &str, port: &str) -> Answer {
    let cas = |service: &str| format!("http://localhost:{port}/cas/login?service={}", percent_encoded(service));
    let page = |body: &str| Answer::of("200 OK", "text/html; charset=utf-8", format!("<html><body>{body}</body></html>"));
    match path.split('?').next().unwrap_or_default() {
        "/library/catalogue" => match query_of(path, "ticket") {
            Some(_) => page("Catalogue"),
            None => Answer::redirect(&cas(&format!("http://127.0.0.1:{port}/library/catalogue"))),
        },
        // Open to anyone.
        "/library/hours" => page("Horaires"),
        // Sends to the CAS from the page itself, not by a redirect.
        "/library/reader" => Answer::of(
            "200 OK",
            "text/html; charset=utf-8",
            format!(r#"<html><head><meta http-equiv="refresh" content="0; url={}"></head></html>"#, cas(&format!("http://127.0.0.1:{port}/library/reader")).replace('&', "&amp;")),
        ),
        // Signs in through a federation: the CAS answers an IdP elsewhere.
        "/library/federated" => Answer::redirect(&cas("https://idp.exemple.test/sso")),
        // Another site's.
        "/library/partner" => Answer::redirect("https://elsewhere.exemple.test/books"),
        "/library/loop" => Answer::redirect(&format!("http://127.0.0.1:{port}/library/loop")),
        _ => Answer::of("404 Not Found", "text/plain", String::new()),
    }
}

// The federation's name for the campus's IdP, in its discovery page.
pub const IDP_ENTITY: &str = "urn:test:campus:idp";
// The message the IdP has Moodle told the student is signed in with.
pub const SAML_RESPONSE: &str = "PHNhbWw+Y2FtcHVzPC9zYW1sPg==";

// The federation: the discovery page (which university?), then the
// university's IdP, which signs in by the CAS and answers a page that posts
// its message to Moodle.
fn federation_answer(received: &Received<'_>, port: &str) -> Answer {
    let Received { method, path, body, .. } = *received;
    let page = |body: String| Answer::of("200 OK", "text/html; charset=utf-8", body);
    let idp = format!("http://127.0.0.1:{port}/idp/sso");
    match (method, path.split('?').next().unwrap_or_default()) {
        ("GET", "/wayf/") => page(format!(
            r#"<html><body><form action="/wayf/select" method="post"><input type="hidden" name="return" value="{}">
            <select name="user_idp"><option value="urn:test:another">Une autre</option><option value="{IDP_ENTITY}">Le campus</option></select>
            <input type="submit" name="Select" value="Sélection"></form></body></html>"#,
            query_of(path, "return").unwrap_or_default()
        )),
        ("POST", "/wayf/select") if form_field(body, "user_idp").as_deref() == Some(IDP_ENTITY) && form_field(body, "Select").is_some() => {
            Answer::redirect(&format!("{idp}?relay={}", percent_encoded(&form_field(body, "return").unwrap_or_default())))
        }
        ("GET", "/idp/sso") if query_of(path, "ticket").as_deref() == Some("ST-campus") => page(format!(
            r#"<html><body onload="document.forms[0].submit()"><form method="post" action="http://127.0.0.1:{port}/moodle/Shibboleth.sso/SAML2/POST">
            <input type="hidden" name="RelayState" value="{}"><input type="hidden" name="SAMLResponse" value="{SAML_RESPONSE}">
            <noscript><input type="submit" value="Continuer"></noscript></form></body></html>"#,
            query_of(path, "relay").unwrap_or_default()
        )),
        ("GET", "/idp/sso") => {
            let back = format!("{idp}?relay={}", percent_encoded(&query_of(path, "relay").unwrap_or_default()));
            Answer::redirect(&format!("http://localhost:{port}/cas/login?service={}", percent_encoded(&back)))
        }
        _ => Answer::of("400 Bad Request", "text/plain", String::new()),
    }
}

// One request to the campus, as much of it as the campus reads.
struct Received<'a> {
    method: &'a str,
    path: &'a str,
    cookies: &'a str,
    agent: &'a str,
    body: &'a str,
}

fn form_field(body: &str, name: &str) -> Option<String> {
    body.split('&').find_map(|pair| {
        let (found, value) = pair.split_once('=')?;
        (found == name).then(|| percent_decoded(value))
    })
}

// The CAS: its login page, the login and password posted to it, the ticket
// it gives and knows after, and its sign-out.
fn cas_answer(received: &Received<'_>, port: &str, state: &State) -> Answer {
    let Received { method, path, cookies, agent, body } = *received;
    let html = |page: &str| Answer::of("200 OK", "text/html; charset=utf-8", page.to_string());
    if state.cas_down.load(Ordering::SeqCst) {
        return Answer::of("503 Service Unavailable", "text/html; charset=utf-8", "<html>Maintenance</html>".to_string());
    }
    if path.starts_with("/cas/logout") {
        if cookies.contains("TGC=the-ticket") && agent == NODE_AGENT {
            state.ticket_gone.store(true, Ordering::SeqCst);
        }
        return html("<html><body>Logout successful</body></html>");
    }
    // Back to the service, signed in, or the CAS's own page without one.
    let signed_in = |ticket: &str| match query_of(path, "service") {
        Some(service) => {
            let separator = if service.contains('?') { '&' } else { '?' };
            Answer::redirect(&format!("{service}{separator}ticket=ST-campus")).with(format!("set-cookie: TGC={ticket}; Path=/cas"))
        }
        None => html(SIGNED_IN_PAGE),
    };
    if method == "POST" {
        let posted = |name: &str| form_field(body, name).unwrap_or_default();
        // The code page's form: the step of the flow it carries, and the code.
        if form_field(body, "token").is_some() {
            let in_the_flow = posted("_eventId_submit") == "Login" && ["e1s3", "e1s4"].contains(&posted("execution").as_str());
            if in_the_flow && posted("token") == CODE {
                state.ticket_gone.store(false, Ordering::SeqCst);
                return signed_in("the-ticket");
            }
            // The page again, as Rennes' CAS refuses a code.
            return Answer::of("401 Unauthorized", "text/html; charset=utf-8", code_page(port, STUDENT_WITH_CODE, true));
        }
        return match (posted("username").as_str(), posted("password") == PASSWORD) {
            (STUDENT, true) => {
                state.ticket_gone.store(false, Ordering::SeqCst);
                signed_in("the-ticket")
            }
            (student @ (STUDENT_WITH_CODE | STUDENT_WITH_APP), true) => html(&code_page(port, student, false)),
            _ => Answer::of("401 Unauthorized", "text/html; charset=utf-8", LOGIN_REFUSED.to_string()),
        };
    }
    let shown = cookies.contains("TGC=the-ticket");
    // The ticket is bound to the User-Agent that signed in (Tafac's): from
    // another one the CAS deletes it, as Rennes' does.
    if shown && agent != NODE_AGENT {
        return html(LOGIN_FORM).with("set-cookie: TGC=; Path=/cas; Max-Age=0".to_string());
    }
    if shown && !state.ticket_gone.load(Ordering::SeqCst) {
        // The same ticket, written anew: a CAS does at each sign-in.
        return signed_in("the-ticket-written-anew");
    }
    html(LOGIN_FORM)
}

// The portal's session of the moment: `alive`, then `alive-1`… once it forgot.
fn portal_session(state: &State) -> String {
    match state.portal_sessions.load(Ordering::SeqCst) {
        0 => "JSESSIONID=alive".to_string(),
        forgotten => format!("JSESSIONID=alive-{forgotten}"),
    }
}

// uPortal's layout for the student: a tab of two folders, the favourites
// first as uPortal lists them. The mail's tile says its address in its
// fragment only; the planning's in a parameter; the help's nowhere.
fn portal_layout() -> String {
    let portlet = |fname: &str, title: &str, more: serde_json::Value| {
        let mut portlet = serde_json::json!({ "_objectType": "portlet", "fname": fname, "title": title, "portletName": "app-launcher", "typeID": "2" });
        for (name, value) in more.as_object().unwrap() {
            portlet[name] = value.clone();
        }
        portlet
    };
    let mail = portlet("webapp-mail", "Messagerie", serde_json::json!({ "description": "Le webmail" }));
    serde_json::json!({ "authenticated": "true", "user": "jdoe", "layout": { "navigation": { "tabs": [{ "ID": "u1l1s1", "name": "Services", "content": [
        { "_objectType": "folder", "ID": "u1l1s2", "name": "Favoris", "content": [mail.clone()] },
        { "_objectType": "folder", "ID": "u1l1s3", "name": "Scolarité", "content": [
            portlet("webapp-planning", "Mon emploi du temps", serde_json::json!({ "parameters": { "url": "https://planning.exemple.test/portal/" } })),
            mail,
            portlet("webapp-aide", "Assistance", serde_json::json!({})),
        ] },
    ] }] } } })
    .to_string()
}

fn campus_answer(received: &Received<'_>, port: &str, state: &State) -> Answer {
    let Received { method, path, cookies, .. } = *received;
    if path.starts_with("/api/v4-3/dlm/layout.json") {
        let layout = match cookies.split("; ").any(|cookie| cookie == portal_session(state)) {
            true => portal_layout(),
            // As uPortal answers nobody: a guest's layout, no error.
            false => r#"{"authenticated":"false","user":"guest","layout":{"navigation":{"tabs":[]}}}"#.to_string(),
        };
        return Answer::of("200 OK", "application/json", layout);
    }
    if let Some(fragment) = path.strip_prefix("/api/v4-3/portlet/") {
        return match fragment {
            "webapp-mail.html" => Answer::of("200 OK", "text/html; charset=utf-8", "<a\n    id=\"Pluto_1_app\"\n    class=\"portlet-link\"\n    href=\"https://mail.exemple.test/\"\n    target=\"_blank\">Messagerie</a>".to_string()),
            _ => Answer::of("200 OK", "text/html; charset=utf-8", "<div>Aucun lien</div>".to_string()),
        };
    }
    if path.starts_with("/api/v5-1/userinfo") {
        let claims = if cookies.split("; ").any(|cookie| cookie == portal_session(state)) {
            serde_json::json!({
                "sub": "jdoe", "name": "Jeanne Doe", "given_name": "Jeanne", "family_name": "Doe",
                "email": "jeanne.doe@exemple.test", "iat": 1, "exp": 2,
            })
        } else if cookies.contains("JSESSIONID=someone-else") {
            serde_json::json!({ "sub": "asmith", "name": "Al Smith" })
        } else {
            serde_json::json!({ "sub": "guest" })
        };
        return Answer::of("200 OK", "application/jwt", token(claims));
    }
    // The portal's own sign-in: a ticket of the CAS's opens its session.
    if path.split('?').next() == Some("/Login") {
        return match query_of(path, "ticket").as_deref() {
            Some("ST-campus") => Answer::redirect(&format!("http://127.0.0.1:{port}/")).with(format!("set-cookie: {}; Path=/", portal_session(state))),
            _ => Answer::redirect(&format!("http://localhost:{port}/cas/login?service={}", percent_encoded(&format!("http://127.0.0.1:{port}/Login")))),
        };
    }
    if path == "/" {
        return Answer::of("200 OK", "text/html; charset=utf-8", "<html><body>Portail</body></html>".to_string());
    }
    if path.starts_with("/cas/") {
        return cas_answer(received, port, state);
    }
    if path.starts_with("/mfa-api/") {
        return code_api_answer(method, path, state);
    }
    if path.starts_with("/moodle/") {
        return moodle_answer(path, cookies, port, &state.moodle);
    }
    if path.starts_with("/scodoc/") {
        return scodoc_answer(path, cookies, port, !state.no_photo.load(Ordering::SeqCst));
    }
    if path.starts_with("/mdw/") {
        return records_answer(received, port, state);
    }
    if path.starts_with("/library/") {
        return library_answer(path, port);
    }
    if path.starts_with("/wayf/") || path.starts_with("/idp/") {
        return federation_answer(received, port);
    }
    Answer::of("404 Not Found", "text/plain", String::new())
}

// A request read from a connection: its head (the first line and the
// headers), and what of its body came with it.
pub async fn read_request<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> Option<(String, Vec<u8>)> {
    let mut received = Vec::new();
    let mut chunk = [0_u8; 2048];
    loop {
        if let Some(end) = received.windows(4).position(|window| window == b"\r\n\r\n") {
            let body = received.split_off(end + 4);
            received.truncate(end);
            return Some((String::from_utf8_lossy(&received).to_string(), body));
        }
        match stream.read(&mut chunk).await {
            Ok(read) if read > 0 => received.extend_from_slice(&chunk[..read]),
            _ => return None,
        }
    }
}

pub async fn read_head<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> Option<String> {
    Some(read_request(stream).await?.0)
}

pub fn header_of(head: &str, name: &str) -> String {
    let prefix = format!("{name}:");
    head.lines()
        .find_map(|line| line.to_ascii_lowercase().starts_with(&prefix).then(|| line[prefix.len()..].trim().to_string()))
        .unwrap_or_default()
}

pub fn campus() -> Campus {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let posted = Arc::new(Mutex::new(Vec::new()));
    let listener = block_on(tokio::net::TcpListener::bind("127.0.0.1:0")).unwrap();
    let port = listener.local_addr().unwrap().port().to_string();
    let state = Arc::new(State::default());
    let (record, record_posted, answering, at) = (seen.clone(), posted.clone(), state.clone(), port.clone());
    spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let (record, record_posted, state, port) = (record.clone(), record_posted.clone(), answering.clone(), at.clone());
            spawn(async move {
                let Some((head, mut body)) = read_request(&mut stream).await else { return };
                // A form posted: the rest of it, when it didn't come at once.
                let length: usize = header_of(&head, "content-length").parse().unwrap_or(0);
                let mut chunk = [0_u8; 2048];
                while body.len() < length {
                    match stream.read(&mut chunk).await {
                        Ok(read) if read > 0 => body.extend_from_slice(&chunk[..read]),
                        _ => break,
                    }
                }
                let mut words = head.split_whitespace();
                let (method, path) = (words.next().unwrap_or_default().to_string(), words.next().unwrap_or_default().to_string());
                let cookies = header_of(&head, "cookie");
                let received =
                    Received { method: &method, path: &path, cookies: &cookies, agent: &header_of(&head, "user-agent"), body: &String::from_utf8_lossy(&body) };
                let Answer { status, content_type, body, headers } = campus_answer(&received, &port, &state);
                if method == "POST" {
                    record_posted.lock().unwrap().push(path.split('?').next().unwrap_or_default().to_string());
                }
                record.lock().unwrap().push((path, cookies));
                let more: String = headers.iter().map(|header| format!("{header}\r\n")).collect();
                let answer = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\n{more}content-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(answer.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    Campus { port, seen, posted, state }
}

impl Campus {
    // The port the campus listens on, for the addresses it gives.
    pub fn port(&self) -> &str {
        &self.port
    }

    // tonAPI's settings for it, as a university.toml says them.
    pub fn settings(&self) -> ResolvedUniversity {
        self.settings_with("cas", "")
    }

    // The same campus, its Moodle behind the federation (Shibboleth) as
    // Rennes' is: the discovery page, then the university's IdP.
    pub fn federated_settings(&self) -> ResolvedUniversity {
        let federation = format!(
            r#"
            [sso.saml]
            wayf-url = "http://127.0.0.1:{port}/wayf/"
            idp-entity-id = "{IDP_ENTITY}"
            allowed-hosts = ["127.0.0.1", "localhost"]
            "#,
            port = self.port
        );
        self.settings_with("shibboleth", &federation)
    }

    fn settings_with(&self, moodle_entry: &str, federation: &str) -> ResolvedUniversity {
        let file = format!(
            r#"
            id = "{UNIVERSITY}"
            name = "Université d'exemple"
            [sso]
            kind = "cas"
            base-url = "http://localhost:{port}/cas/"
            {federation}
            [portal]
            kind = "uportal5"
            base-url = "http://127.0.0.1:{port}/"
            [services.profile]
            provider = "portal"
            [services.apps]
            provider = "portal"
            [services.homework]
            provider = "moodle-ajax"
            base-url = "http://127.0.0.1:{port}/moodle/"
            entry = "{moodle_entry}"
            [services.grades]
            provider = "scodoc-gateway"
            base-url = "http://127.0.0.1:{port}/scodoc/"
            [services.absences]
            provider = "scodoc-gateway"
            base-url = "http://127.0.0.1:{port}/scodoc/"
            [services.documents]
            provider = "mon-dossier-web"
            base-url = "http://127.0.0.1:{port}/mdw/"
            "#,
            port = self.port
        );
        ResolvedUniversity { dir: Default::default(), university: toml::from_str(&file).unwrap(), establishments: Default::default() }
    }

    pub fn gateway(&self) -> Gateway {
        Gateway::for_tests(vec![self.settings()], SECRET, COOKIE_NAME)
    }

    // The gateway of the campus whose Moodle is behind the federation.
    pub fn federated_gateway(&self) -> Gateway {
        Gateway::for_tests(vec![self.federated_settings()], SECRET, COOKIE_NAME)
    }

    // The session cookie (its value) of a student with these portal cookies.
    pub fn cookie(&self, overrides: serde_json::Value, portal_cookies: &[(&str, &str)]) -> String {
        let mut cookies = vec![serde_json::json!(["TGC", "the-ticket", "localhost", "/cas", 1, 1, null])];
        for (name, value) in portal_cookies {
            cookies.push(serde_json::json!([name, value, "127.0.0.1", "/", 1, 1, null]));
        }
        let mut payload = serde_json::json!({
            "id": "one-session", "uni": UNIVERSITY, "user": "jdoe", "mode": null, "demoState": null,
            "createdAt": crate::gateway::now_ms(), "jar": cookies,
        });
        for (name, value) in overrides.as_object().unwrap() {
            payload[name] = value.clone();
        }
        cookie::seal(SECRET, &payload)
    }

    // A student whose portal session lives.
    pub fn alive(&self) -> String {
        self.cookie(serde_json::json!({}), &[("JSESSIONID", "alive"), ("lb", "node2")])
    }

    // The same student, the portal's session lapsed.
    pub fn lapsed(&self) -> String {
        self.cookie(serde_json::json!({}), &[("JSESSIONID", "lapsed")])
    }

    // Moodle no longer knows the session it gave: the next question signs
    // in again.
    pub fn moodle_forgets(&self) {
        self.state.moodle.sessions.fetch_add(1, Ordering::SeqCst);
    }

    // Moodle stops (or starts again) answering its calendar.
    pub fn moodle_is_down(&self, down: bool) {
        self.state.moodle.down.store(down, Ordering::SeqCst);
    }

    // The CAS no longer knows its ticket: the session is over.
    pub fn cas_forgets(&self) {
        self.state.ticket_gone.store(true, Ordering::SeqCst);
    }

    // Whether the CAS still knows its ticket.
    pub fn cas_knows_the_ticket(&self) -> bool {
        !self.state.ticket_gone.load(Ordering::SeqCst)
    }

    // The CAS stops (or starts again) answering anything but an error.
    pub fn cas_is_down(&self, down: bool) {
        self.state.cas_down.store(down, Ordering::SeqCst);
    }

    // The portal forgets the sessions it gave: the next one it opens, for a
    // ticket of the CAS's, is another.
    pub fn portal_forgets(&self) {
        self.state.portal_sessions.fetch_add(1, Ordering::SeqCst);
    }

    // ScoDoc has (or no longer has) a photo of the student.
    pub fn scodoc_has_a_photo(&self, has: bool) {
        self.state.no_photo.store(!has, Ordering::SeqCst);
    }

    // The school records list (or no longer list) a certificate.
    pub fn records_have_a_certificate(&self, have: bool) {
        self.state.no_certificate.store(!have, Ordering::SeqCst);
    }

    // The school records stop (or start again) answering anything but an
    // error.
    pub fn records_are_down(&self, down: bool) {
        self.state.records_down.store(down, Ordering::SeqCst);
    }

    // Esup OTP's API stops (or starts again) answering anything but an error.
    pub fn code_api_is_down(&self, down: bool) {
        self.state.code_api_down.store(down, Ordering::SeqCst);
    }

    // Each code the API was asked to send, in order: « student method
    // transport », and « auto » when the student didn't ask.
    pub fn codes_sent(&self) -> Vec<String> {
        self.state.codes_sent.lock().unwrap().clone()
    }

    // How many times something was posted to a path of the campus's.
    pub fn posted_to(&self, path: &str) -> usize {
        self.posted.lock().unwrap().iter().filter(|posted| posted.as_str() == path).count()
    }

    // How many requests went to a path of the campus's.
    pub fn asked(&self, path: &str) -> usize {
        self.paths().iter().filter(|seen| seen.as_str() == path).count()
    }

    pub fn paths(&self) -> Vec<String> {
        self.seen.lock().unwrap().iter().map(|(path, _)| path.split('?').next().unwrap().to_string()).collect()
    }
}
