// The routes another service of the university answers: the portal's
// applications, Moodle's deadlines, ScoDoc's grades.
//
// Each goes the same way:
//
//   its turn        one question at a time to a service of a session: the
//                   page asking twice at once signs in once
//   the answer kept as long as tonAPI says it may be given again (Node's
//                   own caches: the deadlines, five minutes). The home
//                   page's three are given past that too, old, while the
//                   university is asked again (behind.rs)
//   the question    asked with the CAS ticket and the service's session the
//                   student's session holds from the last one (tonapi/)
//   the translator  tonAPI's answer as the page reads it today, or why
//                   there is none (never kept: asked again the next time)
//
// A request Node's own route refuses (a parameter that isn't what it should
// be) is refused here in Node's words, before anything is asked.
//
// A route added here is a few lines: its question, its translator, its key.

use tonapi_config::ServiceKind;
use tonapi_providers::NetSettings;

use super::behind::Lasting;
use super::Gateway;
use crate::session::memory::Turn;
use crate::session::Held;
use crate::tonapi::{self, Service, Unanswered};
use crate::translate::grades::{message, report, scodoc_id};
use crate::translate::{self, failed, Translated};

// One of the request's parameters (« ?name=value »), decoded.
pub(super) fn parameter(query: Option<&str>, name: &str) -> Option<String> {
    url::form_urlencoded::parse(query?.as_bytes()).find_map(|(found, value)| (found == name).then(|| value.into_owned()))
}

// One of the home page's answers (behind.rs), asked of the university now,
// with its service's turn held: tonAPI's answer as the page reads it, kept
// to be given again, fresh then old, when there is one.
//
//   the applications   translate/apps.rs. Fresh as long as tonAPI says (an
//                      hour): a portal's applications change with the year
//   the deadlines      translate/moodle_deadlines.rs. Five minutes
//   the grades         the current semester's report (`report`)
pub(super) async fn read(net: NetSettings, held: &Held<'_>, lasting: Lasting) -> Translated {
    let service = Service { held, net };
    let (translated, keep_secs) = match lasting {
        Lasting::Apps => {
            let asked = tonapi::apps::read(&service).await;
            if asked.is_ok() {
                // The portal session tonAPI opened is the one the session
                // check asks with from now on (portal.rs).
                held.memory.portal_opened();
            }
            let keep_secs = asked.as_ref().ok().and_then(|asked| asked.keep_secs);
            (translate::apps::translate(asked.as_ref().map(|asked| asked.value.as_slice()).map_err(|why| *why)), keep_secs)
        }
        Lasting::Deadlines => {
            let asked = tonapi::homework::read(&service).await;
            let keep_secs = asked.as_ref().ok().and_then(|asked| asked.keep_secs);
            let homework = asked.as_ref().map(|asked| asked.value.as_slice()).map_err(|why| *why);
            (translate::moodle_deadlines::translate(homework, held.university, chrono::Utc::now()), keep_secs)
        }
        // Kept by `report` itself.
        Lasting::Grades => {
            return match report(&service, None).await {
                Ok(body) => translate::kept_answer(body),
                Err(why) => why,
            }
        }
    };
    if let (Translated::Answer(response), Some(seconds)) = (&translated, keep_secs) {
        held.memory.keep_answer_to_give_old(lasting.key(), seconds, response.body());
    }
    translated
}

// A semester's report as the page gets it (the current one without
// `semester`): the answer kept, or tonAPI asked and its answer kept. Called
// with the grades' turn held. The current one is one of the home page's:
// kept to be given old too.
async fn report(service: &Service<'_>, semester: Option<&str>) -> Result<Vec<u8>, Translated> {
    let Held { university, memory, .. } = service.held;
    let key = semester.map_or_else(|| Lasting::Grades.key().to_string(), |id| format!("grades/semester/{id}"));
    if let Some(body) = memory.answer(&key) {
        return Ok(body);
    }
    let asked = tonapi::grades::report(service, semester).await;
    let keep_secs = asked.as_ref().ok().and_then(|asked| asked.keep_secs);
    match report::translate(asked.as_ref().map(|asked| &asked.value).map_err(|why| *why), semester.is_none(), university.timezone) {
        Translated::Answer(response) => {
            match (keep_secs, semester) {
                (Some(seconds), None) => memory.keep_answer_to_give_old(&key, seconds, response.body()),
                (Some(seconds), Some(_)) => memory.keep_answer(&key, seconds, response.body()),
                (None, _) => {}
            }
            Ok(response.into_body())
        }
        other => Err(other),
    }
}

impl Gateway {
    // GET /__ent_auth/grades/semester/<id> (translate/grades/report.rs).
    // The current semester's, GET /__ent_auth/grades, is one of the home
    // page's (behind.rs).
    pub(super) async fn grades(&self, held: &Held<'_>, semester: &str) -> Translated {
        let Some(semester) = scodoc_id(semester) else {
            return Translated::Failed(failed::SEMESTER_REFUSED);
        };
        let _turn = held.memory.turn(Turn::Service(ServiceKind::Grades)).await;
        let service = Service { held, net: self.net };
        match report(&service, Some(semester)).await {
            Ok(body) => translate::kept_answer(body),
            Err(why) => why,
        }
    }

    // GET /__ent_auth/grades/department-message?dep=… (translate/grades/message.rs).
    pub(super) async fn grades_message(&self, held: &Held<'_>, query: Option<&str>) -> Translated {
        let named = parameter(query, "dep");
        let Some(department) = named.as_deref().and_then(message::department) else {
            return Translated::Failed(failed::DEPARTMENT_REFUSED);
        };
        let key = format!("grades/message/{department}");
        self.kept_or_asked(held, &key, async |service: &Service<'_>| {
            let asked = tonapi::grades::notice(service, department).await;
            let keep_secs = asked.as_ref().ok().and_then(|asked| asked.keep_secs);
            (message::translate(asked.as_ref().map(|asked| &asked.value).map_err(|why| *why)), keep_secs)
        })
        .await
    }

    // GET /__ent_auth/grades/evaluation-distribution?semestre=…&eval=…
    // (translate/grades/distribution.rs).
    pub(super) async fn grades_distribution(&self, held: &Held<'_>, query: Option<&str>) -> Translated {
        let (asked_semester, asked_evaluation) = (parameter(query, "semestre"), parameter(query, "eval"));
        // « current »: the semester of the report the page shows first.
        let current = asked_semester.as_deref() == Some("current");
        let semester = asked_semester.as_deref().and_then(|id| if current { Some(id) } else { scodoc_id(id) });
        let (Some(semester), Some(evaluation)) = (semester, asked_evaluation.as_deref().and_then(scodoc_id)) else {
            return Translated::Failed(failed::IDS_REFUSED);
        };
        let key = format!("grades/distribution/{semester}/{evaluation}");
        self.kept_or_asked(held, &key, async |service: &Service<'_>| {
            let semester = if current {
                match report(service, None).await.map(|body| report::semester_of(&body)) {
                    Ok(Some(id)) => id,
                    // A student without a semester has no evaluation.
                    Ok(None) => return (Translated::Failed(failed::UNKNOWN_EVALUATION), None),
                    Err(other) => return (other, None),
                }
            } else {
                semester.to_string()
            };
            let asked = tonapi::grades::distribution(service, &semester, evaluation).await;
            let keep_secs = asked.as_ref().ok().and_then(|asked| asked.keep_secs);
            (translate::grades::distribution::translate(asked.as_ref().map(|asked| &asked.value).map_err(|why| *why)), keep_secs)
        })
        .await
    }

    // GET /__ent_auth/grades/report.pdf?semestre=… (translate/grades/transcript.rs).
    // Never kept: Node asks for it each time too.
    pub(super) async fn grades_transcript(&self, held: &Held<'_>, query: Option<&str>) -> Translated {
        let asked_semester = parameter(query, "semestre");
        let Some(semester) = asked_semester.as_deref().and_then(scodoc_id) else {
            return Translated::Failed(failed::SEMESTER_REFUSED);
        };
        let _turn = held.memory.turn(Turn::Service(ServiceKind::Grades)).await;
        let service = Service { held, net: self.net };
        let asked: Result<_, Unanswered> = tonapi::grades::transcript(&service, semester).await.map(|asked| asked.value);
        translate::grades::transcript::translate(asked, semester)
    }

    // A grades route whose answer is JSON: its turn, the answer kept under
    // `key`, or `ask` and its answer kept as long as tonAPI says.
    async fn kept_or_asked<F>(&self, held: &Held<'_>, key: &str, ask: F) -> Translated
    where
        F: AsyncFnOnce(&Service<'_>) -> (Translated, Option<u32>),
    {
        let _turn = held.memory.turn(Turn::Service(ServiceKind::Grades)).await;
        if let Some(body) = held.memory.answer(key) {
            return translate::kept_answer(body);
        }
        let service = Service { held, net: self.net };
        let (translated, keep_secs) = ask(&service).await;
        if let (Translated::Answer(response), Some(seconds)) = (&translated, keep_secs) {
            held.memory.keep_answer(key, seconds, response.body());
        }
        translated
    }
}
