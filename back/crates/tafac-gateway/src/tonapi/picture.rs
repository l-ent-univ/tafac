// ScoDoc: the student's photo.
//
// The IUT's gateway keeps one for each of its students. tonAPI asks it as
// it asks the grades, with ScoDoc's own session the session holds, and
// gives the file only when it is an image a page can show. A component
// without ScoDoc has none.

use tonapi_config::ServiceKind;
use tonapi_providers::Download;

use super::{Asked, Service, Unanswered};

pub(crate) async fn read(service: &Service<'_>) -> Result<Asked<Download>, Unanswered> {
    service.ask(ServiceKind::Grades, async |context| tonapi_providers::student_picture(context).await).await
}
