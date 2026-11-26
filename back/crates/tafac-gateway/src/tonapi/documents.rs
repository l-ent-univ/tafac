// The school records: the documents the university gives the student (at
// Rennes, the school certificates of ESUP MonDossierWeb), and the file of
// one.
//
// tonAPI opens the school records with the CAS ticket and plays the part of
// the browser there (the records have no other way to a file). Each
// question opens the records anew: one at a time for a session (the
// gateway's turn), as two would share the records' own session and undo
// each other.

use tonapi_config::ServiceKind;
use tonapi_core::Document;
use tonapi_providers::Download;

use super::{Asked, Service, Unanswered};

pub(crate) async fn list(service: &Service<'_>) -> Result<Asked<Vec<Document>>, Unanswered> {
    service.ask(ServiceKind::Documents, async |context| tonapi_providers::documents(context).await).await
}

// `id`: a document of the list's.
pub(crate) async fn file(service: &Service<'_>, id: &str) -> Result<Asked<Download>, Unanswered> {
    service.ask(ServiceKind::Documents, async |context| tonapi_providers::document(context, id).await).await
}
