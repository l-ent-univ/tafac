// The routes that give the student a file of their own: the photo ScoDoc
// keeps, and the school certificate (translate/student_pic.rs,
// translate/school_certificate.rs). Answered to their end here
// (settled.rs).
//
// Each goes as a service's route goes (services.rs): its turn, the question
// asked with the CAS ticket and the service's session the student's session
// holds, the translator. A file is never kept: only « is there a
// certificate », as long as tonAPI says.

use tonapi_config::ServiceKind;

use super::Gateway;
use crate::session::memory::Turn;
use crate::session::Held;
use crate::tonapi::{self, Service};
use crate::translate::settled::Settled;
use crate::translate::{school_certificate, student_pic};

// The certificate's status, and the document it is about (tonAPI's own
// name for it), kept together.
const STATUS_KEY: &str = "documents/school-certificate/status";
const CERTIFICATE_KEY: &str = "documents/school-certificate/id";

// `?meta=1`, given once.
fn wants_meta(query: Option<&str>) -> bool {
    let mut given = url::form_urlencoded::parse(query.unwrap_or_default().as_bytes()).filter(|(name, _)| name == "meta");
    matches!((given.next(), given.next()), (Some((_, value)), None) if value == "1")
}

impl Gateway {
    // GET /__ent_auth/student-pic (translate/student_pic.rs). Asked each
    // time, as Node asks: the page says when it wants it anew.
    pub(super) async fn student_picture(&self, held: &Held<'_>, query: Option<&str>) -> Settled {
        // ScoDoc's own session takes one question at a time (services.rs).
        let _turn = held.memory.turn(Turn::Service(ServiceKind::Grades)).await;
        let service = Service { held, net: self.net };
        let asked = tonapi::picture::read(&service).await.map(|asked| asked.value);
        student_pic::translate(asked, wants_meta(query))
    }

    // GET /__ent_auth/documents/school-certificate/status
    // (translate/school_certificate.rs).
    pub(super) async fn certificate_status(&self, held: &Held<'_>) -> Settled {
        // One question at a time to the school records: two would share
        // their session there and undo each other.
        let _turn = held.memory.turn(Turn::Service(ServiceKind::Documents)).await;
        if let Some(body) = held.memory.answer(STATUS_KEY) {
            return Settled::Answer(crate::translate::json_response(200, body));
        }
        let service = Service { held, net: self.net };
        let asked = tonapi::documents::list(&service).await;
        let keep_secs = asked.as_ref().ok().and_then(|asked| asked.keep_secs);
        let documents = asked.as_ref().map(|asked| asked.value.as_slice()).map_err(|why| *why);
        let (settled, kept) = school_certificate::status(documents);
        if let (Settled::Answer(response), true, Some(seconds)) = (&settled, kept, keep_secs) {
            held.memory.keep_answer(STATUS_KEY, seconds, response.body());
            // The certificate found, for the file asked next.
            if let Some(found) = documents.ok().and_then(school_certificate::certificate) {
                held.memory.keep_answer(CERTIFICATE_KEY, seconds, found.id.as_bytes());
            }
        }
        settled
    }

    // GET /__ent_auth/documents/school-certificate
    // (translate/school_certificate.rs). Never kept: asked each time.
    pub(super) async fn certificate(&self, held: &Held<'_>) -> Settled {
        let _turn = held.memory.turn(Turn::Service(ServiceKind::Documents)).await;
        let service = Service { held, net: self.net };
        // Which document it is: the one the status found, or asked now.
        let known = held.memory.answer(CERTIFICATE_KEY).and_then(|id| String::from_utf8(id).ok());
        let id = match known {
            Some(id) => id,
            None => match tonapi::documents::list(&service).await {
                Ok(asked) => match school_certificate::certificate(&asked.value) {
                    Some(found) => found.id.clone(),
                    None => return school_certificate::none(),
                },
                Err(why) => return school_certificate::unanswered(why),
            },
        };
        let asked = tonapi::documents::file(&service, &id).await.map(|asked| asked.value);
        school_certificate::file(asked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_photos_meta_is_asked_one_way() {
        assert!(wants_meta(Some("meta=1&ts=1795680000000")));
        for query in [None, Some(""), Some("meta=0"), Some("meta=true"), Some("meta=1&meta=1"), Some("ts=1")] {
            assert!(!wants_meta(query), "{query:?}");
        }
    }
}
