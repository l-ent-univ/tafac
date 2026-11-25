// The routes another service of the university answers: Moodle today, the
// grades and the planning next.
//
// Each goes the same way, as Node's own route does:
//
//   its turn        one question at a time to a service of a session: the
//                   page asking twice at once signs in once
//   the answer kept as long as tonAPI says it may be given again (Node's
//                   own caches: the deadlines, five minutes)
//   the question    asked with the CAS ticket and the service's session
//                   remembered from the last one (tonapi/)
//   the translator  tonAPI's answer as the page gets it from Node
//
// A route added here is three lines: its question, its translator, its key.

use tonapi_config::ServiceKind;

use super::Gateway;
use crate::session::cookie::NodeSession;
use crate::session::handed;
use crate::tonapi::{self, Service};
use crate::translate::{self, Translated};
use crate::universities::University;

impl Gateway {
    // GET /__ent_auth/moodle/deadlines (translate/moodle_deadlines.rs).
    pub(super) async fn moodle_deadlines(&self, university: &University, session: &NodeSession) -> Translated {
        const KEY: &str = "moodle/deadlines";
        let remembered = self.memory.of(&session.id, &handed::cas_cookies(university, session));
        let _turn = remembered.turn(ServiceKind::Homework).await;
        if let Some(body) = remembered.answer(KEY) {
            return translate::kept_answer(body);
        }
        let service = Service { university, session, remembered: &remembered, net: self.net };
        let asked = tonapi::homework::read(&service).await;
        let keep_secs = asked.as_ref().ok().and_then(|asked| asked.keep_secs);
        let homework = asked.as_ref().map(|asked| asked.value.as_slice()).map_err(|why| *why);
        let translated = translate::moodle_deadlines::translate(homework, university, chrono::Utc::now());
        if let (Translated::Answer(response), Some(seconds)) = (&translated, keep_secs) {
            remembered.keep_answer(KEY, seconds, response.body());
        }
        translated
    }
}
