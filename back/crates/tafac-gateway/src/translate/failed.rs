// Any moved route, when it has no answer of its own to give.
//
// Node's answers then (server/entAuthApp.js: each route's `catch`, and its
// own refusals), given here now for the routes that moved:
//
//   an error of the university's (a service down, slow, or saying what
//   tonAPI doesn't read; a portal answering for someone else)
//       500 { error }, and 502 for the applications. In production `error`
//       is one fixed sentence, which the page shows as it is
//       (server/routeErrors), and the reason goes to the log; a development
//       server says the reason itself, for its debug menu. The reason here
//       is tonAPI's error code or words of this crate, never anything of
//       the account.
//   a parameter that isn't what it should be
//       400 { error }, in Node's words: a semester's id, an evaluation's, a
//       department's name.
//   an evaluation that isn't in the student's own report
//       404 { error: 'Unknown evaluation.' }
//   a report the IUT's gateway gives no PDF for
//       502 { error: 'ScoDoc did not return a PDF.' }
//
// The session lives: none of these says it is over (translate/expired.rs
// does, once the CAS says so), and its cookie isn't touched.

use http::header::CACHE_CONTROL;
use http::HeaderValue;

use super::json_response;
use crate::routes::Moved;

// What a route says of an error of the university's in production
// (server/routeErrors: UNAVAILABLE_MESSAGE).
pub(crate) const UNAVAILABLE: &str = "Service indisponible pour le moment";
// The applications' own (server/entAuthApp.js: APPS_UNAVAILABLE_MESSAGE).
const PORTAL_UNAVAILABLE: &str = "Portail indisponible pour le moment";

// Why a moved route has no answer of its own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    // An error of the university's. Why, for the log and for a development
    // server's answer: tonAPI's code or words of this crate, never anything
    // of the account.
    Unavailable(String),
    // One of Node's own sentences, with its status, whatever the server.
    Said(u16, &'static str),
}

// A semester's id that isn't one (the report of a semester, its PDF).
pub(crate) const SEMESTER_REFUSED: Failure = Failure::Said(400, "Invalid semester id.");
// A department's name that isn't one.
pub(crate) const DEPARTMENT_REFUSED: Failure = Failure::Said(400, "Invalid department.");
// A distribution's semester or evaluation that isn't an id.
pub(crate) const IDS_REFUSED: Failure = Failure::Said(400, "Invalid semester or evaluation id.");
pub(crate) const UNKNOWN_EVALUATION: Failure = Failure::Said(404, "Unknown evaluation.");
pub(crate) const NO_PDF: Failure = Failure::Said(502, "ScoDoc did not return a PDF.");

// `production`: whether Node runs as on tafac.fr and in the apps, where a
// route says one sentence for any error of the university's.
pub fn answer(route: Moved, failure: &Failure, production: bool) -> http::Response<Vec<u8>> {
    let applications = route == Moved::Apps;
    let (status, error) = match failure {
        Failure::Said(status, error) => (*status, *error),
        Failure::Unavailable(why) => {
            let error = match (production, applications) {
                (true, true) => PORTAL_UNAVAILABLE,
                (true, false) => UNAVAILABLE,
                (false, _) => why.as_str(),
            };
            (if applications { 502 } else { 500 }, error)
        }
    };
    let mut response = json_response(status, serde_json::to_vec(&serde_json::json!({ "error": error })).unwrap_or_default());
    // The PDF's route says so of every answer, as Node's does.
    if route == Moved::GradesTranscript {
        response.headers_mut().insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ANSWERED_BY;

    fn said(route: Moved, failure: &Failure, production: bool) -> (u16, serde_json::Value) {
        let response = answer(route, failure, production);
        (response.status().as_u16(), serde_json::from_slice(response.body()).unwrap())
    }

    fn unavailable() -> Failure {
        Failure::Unavailable("service_unavailable".to_string())
    }

    #[test]
    fn an_error_of_the_universitys_is_one_sentence_in_production() {
        for route in [Moved::Session, Moved::Account, Moved::MoodleDeadlines, Moved::Grades, Moved::GradesSemester, Moved::GradesMessage, Moved::GradesDistribution, Moved::GradesTranscript] {
            assert_eq!(said(route, &unavailable(), true), (500, serde_json::json!({ "error": "Service indisponible pour le moment" })), "{route:?}");
        }
        // The applications' own status and sentence.
        assert_eq!(said(Moved::Apps, &unavailable(), true), (502, serde_json::json!({ "error": "Portail indisponible pour le moment" })));
    }

    #[test]
    fn a_development_server_says_the_reason() {
        assert_eq!(said(Moved::Grades, &unavailable(), false), (500, serde_json::json!({ "error": "service_unavailable" })));
        assert_eq!(said(Moved::Apps, &unavailable(), false), (502, serde_json::json!({ "error": "service_unavailable" })));
    }

    #[test]
    fn a_refusal_is_said_in_nodes_words_whatever_the_server() {
        for production in [true, false] {
            assert_eq!(said(Moved::GradesSemester, &SEMESTER_REFUSED, production), (400, serde_json::json!({ "error": "Invalid semester id." })));
            assert_eq!(said(Moved::GradesDistribution, &UNKNOWN_EVALUATION, production), (404, serde_json::json!({ "error": "Unknown evaluation." })));
            assert_eq!(said(Moved::GradesTranscript, &NO_PDF, production), (502, serde_json::json!({ "error": "ScoDoc did not return a PDF." })));
        }
    }

    #[test]
    fn the_answer_is_one_made_here_and_never_kept() {
        let response = answer(Moved::Grades, &unavailable(), true);
        assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
        assert_eq!(response.headers()["content-type"], "application/json; charset=utf-8");
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert!(response.headers().get("x-tafac-session").is_none() && response.headers().get("set-cookie").is_none());
        for failure in [unavailable(), SEMESTER_REFUSED, NO_PDF] {
            assert_eq!(answer(Moved::GradesTranscript, &failure, true).headers()["cache-control"], "private, no-store");
        }
    }

}
