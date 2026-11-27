// Moodle: what is due, and what was handed in.
//
// tonAPI signs in to Moodle with the CAS ticket (through the federation at
// Rennes: WAYF, IdP, CAS), reads the timeline and the upcoming events in one
// request, and leaves its Moodle session in the memory of the session: the
// next question, five minutes later, signs in to nothing.

use tonapi_config::ServiceKind;
use tonapi_core::Homework;

use super::{Asked, Service, Unanswered};

pub(crate) async fn read(service: &Service<'_>) -> Result<Asked<Vec<Homework>>, Unanswered> {
    service.ask(ServiceKind::Homework, async |context| tonapi_providers::homework(context).await).await
}
