// The campus's webmail, a Zimbra as much of it as the mail routes ask: its
// entry under /webmail/ sends the student to the CAS, and back with a
// ticket it sets its session's cookie (ZM_AUTH_TOKEN) and sends on to its
// preauth, over plain http as Partage does; its SOAP under
// /service/soap/<request> answers with that cookie only (AUTH_EXPIRED
// otherwise), its REST servlet gives a message's parts, its upload servlet
// takes a file. It forgets its sessions when told to (the next one it
// opens is another).

use std::sync::atomic::Ordering;

use serde_json::{json, Value};

use super::{query_of, Answer, Received, State};

// The session cookie the webmail gives now.
fn token(state: &State) -> String {
    format!("ZM_AUTH_TOKEN=zm-campus-{}", state.webmail_sessions.load(Ordering::SeqCst))
}

fn soap(body: Value) -> Answer {
    Answer::of("200 OK", "application/json", json!({ "Body": body }).to_string())
}

fn fault(code: &str) -> Answer {
    Answer::of("500 Internal Server Error", "application/json", json!({ "Body": { "Fault": { "Detail": { "Error": { "Code": code } } } } }).to_string())
}

// One thread of the inbox, its newest mail's.
fn thread(id: &str, subject: &str, millis: i64) -> Value {
    json!({ "id": id, "su": subject, "d": millis, "f": "u", "n": 1, "u": 1, "fr": "Bonjour Camille,", "e": [{ "t": "f", "a": "scolarite@exemple.test", "p": "Scolarité Demo" }], "m": [{ "id": id.trim_start_matches('-') }] })
}

pub(super) fn webmail_answer(received: &Received<'_>, port: &str, state: &State) -> Answer {
    let Received { method, path, cookies, body, .. } = *received;
    let signed_in = cookies.split("; ").any(|cookie| cookie == token(state));
    if path.starts_with("/webmail/sso") {
        return match query_of(path, "ticket").as_deref() {
            Some("ST-campus") => Answer::redirect(&format!("http://127.0.0.1:{port}/service/preauth?isredirect=1")).with(format!("set-cookie: {}; Path=/", token(state))),
            _ => Answer::of("403 Forbidden", "text/html", "<html>no ticket</html>".to_string()),
        };
    }
    if path.starts_with("/webmail/") {
        return Answer::redirect(&format!("http://localhost:{port}/cas/login?service={}", super::percent_encoded(&format!("http://127.0.0.1:{port}/webmail/sso"))));
    }
    if path.starts_with("/service/preauth") {
        return Answer::redirect(&format!("http://127.0.0.1:{port}/zimbra/"));
    }
    if let Some(name) = path.strip_prefix("/service/soap/") {
        if method != "POST" {
            return Answer::of("405 Method Not Allowed", "text/plain", String::new());
        }
        if !signed_in {
            return fault("service.AUTH_EXPIRED");
        }
        let asked: Value = serde_json::from_str(body).unwrap_or(Value::Null);
        let request = &asked["Body"][name];
        state.soap_requests.lock().unwrap().push((name.to_string(), request.clone()));
        return match name {
            "SearchRequest" => {
                let threads = if request["query"] == "inid:2" { vec![thread("-301", "Inscriptions", 1_792_998_900_000), thread("300", "Réunion", 1_793_000_000_000)] } else { Vec::new() };
                soap(json!({ "SearchResponse": { "c": threads, "more": false } }))
            }
            "GetFolderRequest" if request["folder"]["l"] == "1" => soap(json!({ "GetFolderResponse": { "folder": [{ "id": "1", "name": "USER_ROOT", "folder": [
                { "id": "2", "name": "Inbox", "view": "message", "u": 3, "n": 12 },
                { "id": "3", "name": "Trash", "view": "message", "n": 1 },
                { "id": "4", "name": "Junk", "view": "message" },
                { "id": "5", "name": "Sent", "view": "message" },
                { "id": "6", "name": "Drafts", "view": "message" },
                { "id": "257", "name": "Moodle", "view": "message", "n": 2 },
            ] }] } })),
            "GetFolderRequest" => soap(json!({ "GetFolderResponse": { "folder": [{ "id": "2", "u": 3 }] } })),
            "MsgActionRequest" | "FolderActionRequest" | "EndSessionRequest" => soap(json!({ format!("{}Response", name.trim_end_matches("Request")): {} })),
            "GetInfoRequest" => soap(json!({ "GetInfoResponse": { "name": "camille.demo@exemple.test", "attSizeLimit": 10_485_760, "attrs": { "_attrs": { "displayName": "Camille Demo" } } } })),
            "GetPrefsRequest" => soap(json!({ "GetPrefsResponse": { "_attrs": { "zimbraPrefMarkMsgRead": "0" } } })),
            "GetIdentitiesRequest" => soap(json!({ "GetIdentitiesResponse": { "identity": [{ "id": "default-id", "name": "DEFAULT", "_attrs": { "zimbraPrefFromAddress": "camille.demo@exemple.test", "zimbraPrefFromDisplay": "Camille Demo" } }] } })),
            "AutoCompleteRequest" => soap(json!({ "AutoCompleteResponse": { "match": [{ "email": "\"Alex Martin\" <alex.martin@exemple.test>", "type": "gal" }] } })),
            "GetMsgRequest" => match request["m"]["id"].as_str() {
                Some("300") => soap(json!({ "GetMsgResponse": { "m": [{
                    "id": "300", "l": "2", "su": "Réunion", "d": 1_793_000_000_000_i64, "mid": "<abc@exemple.test>",
                    "e": [{ "t": "f", "a": "scolarite@exemple.test", "p": "Scolarité Demo" }, { "t": "t", "a": "camille.demo@exemple.test" }],
                    "mp": [{ "part": "1", "ct": "multipart/mixed", "mp": [
                        { "part": "1.1", "ct": "text/html", "body": true, "content": "<p>Bonjour <a href=\"https://127.0.0.1/__ent_auth/launch?url=x\">ici</a> <a href=\"https://exemple.test/\">là</a><script>alert(1)</script><img src=\"cid:photo\"><img src=\"https://tracker.exemple.test/p.gif\"></p>" },
                        { "part": "2", "ct": "image/png", "cd": "inline", "filename": "photo.png", "ci": "<photo>", "s": 7 },
                        { "part": "3", "ct": "application/pdf", "cd": "attachment", "filename": "rapport.pdf", "s": 1200 },
                    ] }],
                }] } })),
                Some("400") => soap(json!({ "GetMsgResponse": { "m": [{
                    "id": "400", "l": "6", "f": "sd", "su": "Brouillon", "d": 1_793_000_000_000_i64,
                    "e": [{ "t": "t", "a": "alex.martin@exemple.test", "p": "Alex Martin" }],
                    "mp": [{ "part": "1", "ct": "text/html", "body": true, "content": "<p>Presque fini<script>x</script></p>" }],
                }] } })),
                _ => fault("mail.NO_SUCH_MSG"),
            },
            "SendMsgRequest" => soap(json!({ "SendMsgResponse": { "m": [{ "id": "500" }] } })),
            "SaveDraftRequest" => soap(json!({ "SaveDraftResponse": { "m": [{ "id": "401", "l": "6", "f": "sd" }] } })),
            "GetSignaturesRequest" => {
                let custom = state.soap_requests.lock().unwrap().iter().any(|(asked, _)| asked == "CreateSignatureRequest");
                let mut list = vec![json!({ "id": "sig-partage", "name": "Signature", "content": [{ "type": "text/html", "_content": "<div><b>Camille Demo</b></div><img src=\"x.png\">" }] })];
                if custom {
                    list.push(json!({ "id": "sig-tafac", "name": "Tafac", "content": [{ "type": "text/plain", "_content": "Camille" }] }));
                }
                soap(json!({ "GetSignaturesResponse": { "signature": list } }))
            }
            "CreateSignatureRequest" | "ModifySignatureRequest" | "DeleteSignatureRequest" => soap(json!({ format!("{}Response", name.trim_end_matches("Request")): {} })),
            _ => fault("service.UNKNOWN_DOCUMENT"),
        };
    }
    if path.starts_with("/service/home/~/") {
        if !signed_in {
            return Answer::of("401 Unauthorized", "text/plain", String::new());
        }
        return match query_of(path, "part").as_deref() {
            Some("2") => Answer::of("200 OK", "image/png", "PNGDATA".to_string()).with("content-disposition: inline; filename=\"photo.png\"".to_string()),
            Some("3") => Answer::of("200 OK", "text/html", "<script>alert(1)</script>".to_string()).with("content-disposition: attachment; filename=\"page.html\"".to_string()),
            _ => Answer::of("404 Not Found", "text/plain", String::new()),
        };
    }
    if path.starts_with("/service/upload") {
        if !signed_in {
            return Answer::of("401 Unauthorized", "text/plain", String::new());
        }
        let answer = format!("200,'null',[{{\"aid\":\"campus-aid:{}\",\"ct\":\"application/pdf\",\"filename\":\"x.pdf\",\"s\":{}}}]", body.len(), body.len());
        return Answer::of("200 OK", "text/html", answer);
    }
    Answer::of("404 Not Found", "text/plain", String::new())
}
