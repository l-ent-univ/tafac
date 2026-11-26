// GET /__ent_auth/moodle/deadlines: the « Échéances Moodle » widget.
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   200 { authenticated: true, sessionMode, deadlines: { moodleHref, items } }
//       Each item: { id, title, courseName, dueAt, type, overdue,
//       submitted, href }. tonAPI reads the same two lists of Moodle's
//       calendar (what is still to do, and the upcoming events, where a
//       handed-in assignment or quiz has lost its action): answered here.
//       What Node decides and tonAPI doesn't is done here, as Node does it
//       (selectMoodleDeadlines): seven days back and thirty ahead, the
//       three latest overdue then what is coming, six in all, `overdue`,
//       and each link through the launch relay (which is still Node's).
//   200 { authenticated: false, deadlines: null }: nobody signed in. Node.
//   200 for the demo account: Node.
//   401 with X-Tafac-Session: expired: the CAS no longer knows the ticket
//       (tonAPI's `session_expired`, and the CAS asked says so). Answered
//       here (translate/expired.rs), and Node is told.
//   500 { error }: Moodle down, slow, or answering something else (the CAS
//       still knowing the ticket). Answered here (translate/failed.rs).
//   404 { disabled: true }: a university without the widget. It is not one
//       of routes.rs' universities for this route.
//
// Where the two differ, on purpose:
//   - a title Moodle only gives with its « doit être rendu » has it cut off;
//   - the same assignment set in two course spaces shows once;
//   - a quiz taken shows at its closing date only, not at its opening too.

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use tonapi_core::Homework;

use super::{json_answer, unanswered, Failure, Translated, Unanswered};
use crate::universities::University;

// selectMoodleDeadlines' limits (MOODLE_DEADLINES_*).
const MAX_ITEMS: usize = 6;
const MAX_OVERDUE: usize = 3;
const LOOKAHEAD_DAYS: i64 = 30;
const OVERDUE_DAYS: i64 = 7;
// Node's launch relay, which signs the browser in to Moodle on the way.
const LAUNCH: &str = "/__ent_auth/launch?url=";

// JavaScript's encodeURIComponent: everything but letters, digits and
// - _ . ! ~ * ' ( ) as UTF-8 bytes in %XX.
fn encode_uri_component(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

// The link to a page of Moodle's, through the launch relay; None for an
// address that isn't Moodle's own (buildMoodleLaunchHref).
fn launch_href(target: &str, moodle_host: &str) -> Option<String> {
    let host = url::Url::parse(target).ok()?.host_str()?.to_ascii_lowercase();
    (host == moodle_host).then(|| format!("{LAUNCH}{}", encode_uri_component(target)))
}

// getMoodleDeadlineType.
fn deadline_type(kind: Option<&str>) -> &'static str {
    match kind {
        Some("assign") => "assign",
        Some("quiz") => "quiz",
        Some("forum") => "forum",
        _ => "other",
    }
}

fn item(homework: &Homework, moodle_host: &str, now: DateTime<Utc>) -> serde_json::Value {
    let kind = deadline_type(homework.kind.as_deref());
    // Node: an assignment or a quiz is handed in when Moodle shows no
    // action for it; anything else has no such state.
    let submitted = matches!(kind, "assign" | "quiz").then(|| homework.submitted.unwrap_or(true));
    serde_json::json!({
        "id": homework.id,
        "title": homework.title,
        "courseName": homework.course.clone().unwrap_or_default(),
        // Date.prototype.toISOString: UTC, to the millisecond.
        "dueAt": homework.due.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis, true),
        "type": kind,
        "overdue": homework.due.with_timezone(&Utc) < now,
        "submitted": submitted,
        "href": homework.url.as_deref().and_then(|target| launch_href(target, moodle_host)),
    })
}

// `now`: when the answer is made (an item is overdue from then on).
pub fn translate(asked: Result<&[Homework], Unanswered>, university: &University, now: DateTime<Utc>) -> Translated {
    let homework = match asked {
        Ok(homework) => homework,
        Err(why) => return unanswered(why),
    };
    // Deadlines read somewhere else than a Moodle have no link to give.
    let Some(moodle) = &university.moodle else {
        return Translated::Failed(Failure::Unavailable("no Moodle in the university's settings".to_string()));
    };
    let moodle_host = moodle.host_str().unwrap_or_default().to_ascii_lowercase();

    let (from, to) = (now - Duration::days(OVERDUE_DAYS), now + Duration::days(LOOKAHEAD_DAYS));
    let mut shown: Vec<&Homework> = homework.iter().filter(|item| (from..=to).contains(&item.due.with_timezone(&Utc))).collect();
    shown.sort_by_key(|item| item.due);
    // The most recent overdue items only, so stale ones don't crowd out
    // what's coming up.
    let (overdue, upcoming): (Vec<&Homework>, Vec<&Homework>) = shown.into_iter().partition(|item| item.due.with_timezone(&Utc) < now);
    let latest_overdue = overdue.iter().skip(overdue.len().saturating_sub(MAX_OVERDUE));
    let items: Vec<serde_json::Value> = latest_overdue.chain(upcoming.iter()).take(MAX_ITEMS).map(|homework| item(homework, &moodle_host, now)).collect();

    json_answer(&serde_json::json!({
        "authenticated": true,
        "sessionMode": null,
        "deadlines": { "moodleHref": launch_href(&dashboard_of(moodle), &moodle_host), "items": items },
    }))
}

// Moodle's dashboard: /my/ under its address.
fn dashboard_of(moodle: &url::Url) -> String {
    let root = moodle.as_str().split(['?', '#']).next().unwrap_or_default().trim_end_matches('/');
    format!("{root}/my/")
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use tonapi_config::ResolvedUniversity;

    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn university(moodle: &str) -> University {
        let file = format!(
            r#"
            id = "univ-exemple"
            name = "Université d'exemple"
            [sso]
            kind = "cas"
            base-url = "https://cas.exemple.test/"
            [portal]
            kind = "uportal5"
            base-url = "https://ent.exemple.test/"
            {moodle}
            "#
        );
        University::of(ResolvedUniversity { dir: Default::default(), university: toml::from_str(&file).unwrap(), establishments: Default::default() }).unwrap()
    }

    fn with_moodle() -> University {
        university("[services.homework]\nprovider = \"moodle-ajax\"\nbase-url = \"https://foad.exemple.test/moodle\"")
    }

    // Due `hours` from now.
    fn homework(id: &str, hours: i64, kind: Option<&str>, submitted: Option<bool>) -> Homework {
        Homework {
            id: id.to_string(),
            title: format!("Devoir {id}"),
            course: None,
            due: Utc.timestamp_opt(NOW + hours * 3600, 0).unwrap().fixed_offset(),
            description: None,
            url: Some(format!("https://foad.exemple.test/moodle/mod/assign/view.php?id={id}")),
            submitted,
            kind: kind.map(str::to_string),
        }
    }

    fn answer(asked: Result<&[Homework], Unanswered>, university: &University) -> Option<serde_json::Value> {
        match translate(asked, university, Utc.timestamp_opt(NOW, 0).unwrap()) {
            Translated::Answer(response) => Some(serde_json::from_slice(response.body()).unwrap()),
            Translated::Failed(_) | Translated::Lost => None,
        }
    }

    #[test]
    fn an_item_is_nodes_field_for_field() {
        let list = [homework("7", 26, Some("assign"), Some(false))];
        let answer = answer(Ok(&list), &with_moodle()).unwrap();
        assert_eq!(
            answer,
            serde_json::json!({
                "authenticated": true,
                "sessionMode": null,
                "deadlines": {
                    "moodleHref": "/__ent_auth/launch?url=https%3A%2F%2Ffoad.exemple.test%2Fmoodle%2Fmy%2F",
                    "items": [{
                        "id": "7",
                        "title": "Devoir 7",
                        "courseName": "",
                        "dueAt": "2027-01-16T10:00:00.000Z",
                        "type": "assign",
                        "overdue": false,
                        "submitted": false,
                        "href": "/__ent_auth/launch?url=https%3A%2F%2Ffoad.exemple.test%2Fmoodle%2Fmod%2Fassign%2Fview.php%3Fid%3D7",
                    }],
                },
            })
        );
    }

    #[test]
    fn handed_in_is_nodes_reading_of_moodle() {
        let mut elsewhere = homework("5", 5, Some("lesson"), None);
        elsewhere.url = Some("https://ailleurs.exemple.test/x".to_string());
        let list = [
            homework("1", 1, Some("assign"), Some(true)),
            homework("2", 2, Some("quiz"), Some(false)),
            // An assignment Moodle shows no action for: handed in, to Node.
            homework("3", 3, Some("assign"), None),
            homework("4", 4, Some("forum"), None),
            elsewhere,
        ];
        let answer = answer(Ok(&list), &with_moodle()).unwrap();
        let read: Vec<_> = answer["deadlines"]["items"].as_array().unwrap().iter().map(|item| (item["type"].as_str().unwrap(), item["submitted"].clone())).collect();
        assert_eq!(
            read,
            [
                ("assign", serde_json::json!(true)),
                ("quiz", serde_json::json!(false)),
                ("assign", serde_json::json!(true)),
                ("forum", serde_json::Value::Null),
                ("other", serde_json::Value::Null),
            ]
        );
        // A page that isn't Moodle's own gets no link.
        assert!(answer["deadlines"]["items"][4]["href"].is_null());
    }

    #[test]
    fn the_window_the_overdue_kept_and_six_in_all() {
        let day = 24;
        let list: Vec<Homework> = [-8 * day, -7 * day, -6 * day, -3 * day, -2 * day, -1, 1, 2 * day, 3 * day, 30 * day, 30 * day + 1, 40 * day]
            .iter()
            .enumerate()
            .map(|(index, hours)| homework(&index.to_string(), *hours, Some("assign"), Some(false)))
            .collect();
        let answer = answer(Ok(&list), &with_moodle()).unwrap();
        let items = answer["deadlines"]["items"].as_array().unwrap();
        // Seven days back to the hour (1), not eight (0); the three latest
        // overdue (3, 4, 5) of the five in the window; then what is coming,
        // six in all: 30 days ahead to the hour (9) is in, but one too many.
        let ids: Vec<&str> = items.iter().map(|item| item["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["3", "4", "5", "6", "7", "8"]);
        let overdue: Vec<bool> = items.iter().map(|item| item["overdue"].as_bool().unwrap()).collect();
        assert_eq!(overdue, [true, true, true, false, false, false]);

        // Fewer overdue: the window's edges show.
        let few: Vec<Homework> = [-7 * day - 1, -7 * day, 30 * day, 30 * day + 1].iter().enumerate().map(|(index, hours)| homework(&index.to_string(), *hours, None, None)).collect();
        let answer = super::tests::answer(Ok(&few), &with_moodle()).unwrap();
        let ids: Vec<&str> = answer["deadlines"]["items"].as_array().unwrap().iter().map(|item| item["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["1", "2"]);
    }

    #[test]
    fn nothing_due_is_an_answer_and_no_answer_is_the_routes_error() {
        let now = Utc.timestamp_opt(NOW, 0).unwrap();
        let answer = answer(Ok(&[]), &with_moodle()).unwrap();
        assert_eq!(answer["deadlines"]["items"], serde_json::json!([]));
        for why in [Unanswered::Problem(tonapi_core::ErrorCode::ServiceUnavailable), Unanswered::Slow, Unanswered::NoTicket, Unanswered::CookiesChanged, Unanswered::Failed] {
            let Translated::Failed(failure) = translate(Err(why), &with_moodle(), now) else { panic!("{why}") };
            assert_eq!(failure, Failure::Unavailable(why.to_string()));
        }
        // The university no longer knows the session: the CAS says whether
        // it is over.
        assert!(matches!(translate(Err(Unanswered::Problem(tonapi_core::ErrorCode::SessionExpired)), &with_moodle(), now), Translated::Lost));
        // A university whose settings name no Moodle.
        assert!(matches!(translate(Ok(&[]), &university(""), now), Translated::Failed(Failure::Unavailable(_))));
    }

    #[test]
    fn a_link_is_encoded_as_the_page_decodes_it() {
        assert_eq!(encode_uri_component("https://foad.exemple.test/mod/assign/view.php?id=5&a=é b"), "https%3A%2F%2Ffoad.exemple.test%2Fmod%2Fassign%2Fview.php%3Fid%3D5%26a%3D%C3%A9%20b");
        assert_eq!(encode_uri_component("A-z_0.9!~*'()"), "A-z_0.9!~*'()");
    }

    #[test]
    fn only_moodles_own_pages_get_a_link() {
        let host = "foad.exemple.test";
        assert_eq!(launch_href("https://foad.exemple.test/my/", host).as_deref(), Some("/__ent_auth/launch?url=https%3A%2F%2Ffoad.exemple.test%2Fmy%2F"));
        assert_eq!(launch_href("https://FOAD.exemple.test/my/", host).map(|href| href.len() > LAUNCH.len()), Some(true));
        assert_eq!(launch_href("https://ailleurs.exemple.test/my/", host), None);
        assert_eq!(launch_href("https://foad.exemple.test.ailleurs.test/", host), None);
        assert_eq!(launch_href("not an address", host), None);
    }
}
