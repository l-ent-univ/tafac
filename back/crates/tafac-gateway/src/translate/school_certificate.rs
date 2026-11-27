// The school certificate (« Certificat de scolarité », in the settings):
//
//   GET /__ent_auth/documents/school-certificate/status   is there one?
//   GET /__ent_auth/documents/school-certificate          the PDF
//
// tonAPI lists the student's documents (at Rennes, the certificates ESUP
// MonDossierWeb offers, one a school year, the newest first) and gives the
// file of one. The certificate is the first document of that kind that can
// be downloaded.
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   status
//     200 { available: true, schoolYear: '2026-2027' }: here, and kept as
//         long as tonAPI says (the school records are slow to ask).
//     200 { available: false }: no certificate for this student (kept the
//         same); or the school records down, slow, or answering what
//         tonAPI doesn't read (not kept: asked again next time). Here.
//     404 { available: false }: no such service for the university. Here.
//   the PDF
//     200, the file, `attachment` under its own name (in ASCII for old
//         clients, the exact name in `filename*`), never kept: here.
//     404 { ok: false, error }: no certificate for this student, or no
//         such service for the university. Here.
//     502 { ok: false, error }: the school records failed. Here.
//   both
//     401 { error: 'session_expired' }, `X-Tafac-Session: expired`: the
//         CAS no longer knows the session. Here (translate/expired.rs).
//         Node took the CAS's login form in place of the school records
//         for « no certificate », and kept that answer a quarter of an
//         hour.
//     401 for nobody signed in: answered here (gateway/nobody.rs).

use http::header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE};
use http::HeaderValue;
use tonapi_core::{Document, DocumentKind, ErrorCode};
use tonapi_providers::Download;

use super::settled::Settled;
use super::{answer, json_response, Unanswered};

const NO_SERVICE: &str = "No certificate service for this university.";
const NO_CERTIFICATE: &str = "Aucun certificat de scolarité disponible.";
const FAILED: &str = "Certificat indisponible pour le moment.";

fn json(status: u16, body: &serde_json::Value) -> http::Response<Vec<u8>> {
    json_response(status, serde_json::to_vec(body).unwrap_or_default())
}

// The certificate among the student's documents: the newest that can be
// downloaded (tonAPI lists the newest first).
pub fn certificate(documents: &[Document]) -> Option<&Document> {
    documents.iter().find(|document| document.kind == DocumentKind::Certificate && document.downloadable)
}

// « 2026-2027 », from the year a school year starts in.
fn school_year(document: &Document) -> Option<String> {
    let start: u32 = document.year.as_deref()?.trim().parse().ok()?;
    Some(format!("{start}-{}", start.checked_add(1)?))
}

// The status, and whether it is an answer to keep.
pub fn status(asked: Result<&[Document], Unanswered>) -> (Settled, bool) {
    let unavailable = || json(200, &serde_json::json!({ "available": false }));
    match asked {
        Ok(documents) => match certificate(documents) {
            Some(found) => (Settled::Answer(json(200, &serde_json::json!({ "available": true, "schoolYear": school_year(found) }))), true),
            None => (Settled::Answer(unavailable()), true),
        },
        Err(Unanswered::Problem(ErrorCode::ServiceAbsent | ErrorCode::NotImplemented)) => (Settled::Answer(json(404, &serde_json::json!({ "available": false }))), false),
        Err(Unanswered::Problem(ErrorCode::SessionExpired)) => (Settled::Lost { otherwise: unavailable() }, false),
        Err(_) => (Settled::Answer(unavailable()), false),
    }
}

fn refused(status: u16, error: &str) -> http::Response<Vec<u8>> {
    json(status, &serde_json::json!({ "ok": false, "error": error }))
}

// No certificate among the documents tonAPI listed.
pub fn none() -> Settled {
    Settled::Answer(refused(404, NO_CERTIFICATE))
}

// The file's answer when tonAPI has none to give: for the list asked
// first, and for the file itself.
pub fn unanswered(why: Unanswered) -> Settled {
    match why {
        Unanswered::Problem(ErrorCode::NotFound) => none(),
        Unanswered::Problem(ErrorCode::ServiceAbsent | ErrorCode::NotImplemented) => Settled::Answer(refused(404, NO_SERVICE)),
        Unanswered::Problem(ErrorCode::SessionExpired) => Settled::Lost { otherwise: refused(502, FAILED) },
        _ => Settled::Answer(refused(502, FAILED)),
    }
}

// A letter without its accent, where it is one a French name is written
// with: what Node's « NFD, then the marks away » comes to for them.
fn without_accent(character: char) -> Option<char> {
    Some(match character {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'ç' => 'c',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ñ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ý' | 'ÿ' => 'y',
        'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'A',
        'Ç' => 'C',
        'È' | 'É' | 'Ê' | 'Ë' => 'E',
        'Ì' | 'Í' | 'Î' | 'Ï' => 'I',
        'Ñ' => 'N',
        'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => 'O',
        'Ù' | 'Ú' | 'Û' | 'Ü' => 'U',
        'Ý' => 'Y',
        _ => return None,
    })
}

// Content-Disposition for a file saved under its own name
// (buildAttachmentHeader): plain ASCII for old clients, the exact name in
// `filename*` (RFC 5987, as encodeURIComponent writes it).
fn attachment(file_name: &str) -> String {
    let ascii: String = file_name
        .chars()
        .map(|character| match character {
            '"' | '\\' => '_',
            ' '..='~' => character,
            other => without_accent(other).unwrap_or('_'),
        })
        .collect();
    let exact: String = file_name
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => (byte as char).to_string(),
            other => format!("%{other:02X}"),
        })
        .collect();
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{exact}")
}

// The PDF, as tonAPI got it from the school records.
pub fn file(asked: Result<Download, Unanswered>) -> Settled {
    let file = match asked {
        Ok(file) => file,
        Err(why) => return unanswered(why),
    };
    if !file.bytes.starts_with(b"%PDF") {
        return Settled::Answer(refused(502, FAILED));
    }
    let disposition = HeaderValue::from_str(&attachment(&file.file_name)).unwrap_or(HeaderValue::from_static("attachment"));
    Settled::Answer(answer(200).header(CONTENT_TYPE, "application/pdf").header(CONTENT_DISPOSITION, disposition).header(CACHE_CONTROL, "no-store").body(file.bytes).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ANSWERED_BY;

    fn document(id: &str, kind: DocumentKind, year: Option<&str>, downloadable: bool) -> Document {
        Document { id: id.to_string(), title: "Certificat de scolarité".to_string(), kind, year: year.map(str::to_string), session: None, downloadable, url: None }
    }

    fn answered(settled: Settled) -> http::Response<Vec<u8>> {
        let Settled::Answer(response) = settled else { panic!("an answer") };
        response
    }

    fn body(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn the_status_is_the_newest_certificate_that_can_be_downloaded() {
        let documents = [
            document("releve", DocumentKind::SemesterTranscript, Some("2026"), true),
            document("lien", DocumentKind::Certificate, Some("2027"), false),
            document("certificat-2026", DocumentKind::Certificate, Some("2026"), true),
            document("certificat-2025", DocumentKind::Certificate, Some("2025"), true),
        ];
        assert_eq!(certificate(&documents).map(|found| found.id.as_str()), Some("certificat-2026"));
        let (settled, kept) = status(Ok(&documents));
        let response = answered(settled);
        assert_eq!((response.status(), body(&response), kept), (http::StatusCode::OK, serde_json::json!({ "available": true, "schoolYear": "2026-2027" }), true));
        assert_eq!(response.headers()["cache-control"], "no-store");

        // A certificate whose year tonAPI couldn't read is one all the same.
        let (settled, _) = status(Ok(&[document("certificat", DocumentKind::Certificate, None, true)]));
        assert_eq!(body(&answered(settled)), serde_json::json!({ "available": true, "schoolYear": null }));

        // None for this student: said, and kept.
        let (settled, kept) = status(Ok(&documents[..2]));
        let response = answered(settled);
        assert_eq!((response.status(), body(&response), kept), (http::StatusCode::OK, serde_json::json!({ "available": false }), true));
    }

    #[test]
    fn a_status_that_cant_be_read_says_none_and_isnt_kept() {
        for why in [Unanswered::Slow, Unanswered::Failed, Unanswered::Problem(ErrorCode::ServiceUnavailable), Unanswered::Problem(ErrorCode::UpstreamChanged)] {
            let (settled, kept) = status(Err(why));
            let response = answered(settled);
            assert_eq!((response.status(), body(&response), kept), (http::StatusCode::OK, serde_json::json!({ "available": false }), false));
        }
        let (settled, kept) = status(Err(Unanswered::Problem(ErrorCode::ServiceAbsent)));
        let response = answered(settled);
        assert_eq!((response.status(), body(&response), kept), (http::StatusCode::NOT_FOUND, serde_json::json!({ "available": false }), false));
        let (Settled::Lost { otherwise }, false) = status(Err(Unanswered::Problem(ErrorCode::SessionExpired))) else { panic!("the CAS to ask") };
        assert_eq!((otherwise.status(), body(&otherwise)), (http::StatusCode::OK, serde_json::json!({ "available": false })));
    }

    #[test]
    fn the_pdf_is_saved_under_its_own_name() {
        let pdf = Download { content_type: "application/pdf".to_string(), file_name: "Certificat_de_Scolarité_X0001_2026-2027_CAMILLE_DEMO.pdf".to_string(), bytes: b"%PDF-1.4 a certificate".to_vec() };
        let response = answered(file(Ok(pdf)));
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "application/pdf");
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
        assert_eq!(
            response.headers()["content-disposition"],
            "attachment; filename=\"Certificat_de_Scolarite_X0001_2026-2027_CAMILLE_DEMO.pdf\"; filename*=UTF-8''Certificat_de_Scolarit%C3%A9_X0001_2026-2027_CAMILLE_DEMO.pdf"
        );
        assert_eq!(response.body(), b"%PDF-1.4 a certificate");
    }

    #[test]
    fn a_name_is_never_more_than_a_name_in_the_header() {
        assert_eq!(attachment("a \"b\"\\c\r\nœ€.pdf"), "attachment; filename=\"a _b__c____.pdf\"; filename*=UTF-8''a%20%22b%22%5Cc%0D%0A%C5%93%E2%82%AC.pdf");
        assert_eq!(attachment("Élève (1)~!*'.pdf"), "attachment; filename=\"Eleve (1)~!*'.pdf\"; filename*=UTF-8''%C3%89l%C3%A8ve%20(1)~!*'.pdf");
    }

    #[test]
    fn a_file_that_isnt_one_is_worded_here() {
        let not_a_pdf = Download { content_type: "application/pdf".to_string(), file_name: "c.pdf".to_string(), bytes: b"<html>Connexion</html>".to_vec() };
        for (settled, status, error) in [
            (file(Ok(not_a_pdf)), 502, FAILED),
            (file(Err(Unanswered::Slow)), 502, FAILED),
            (file(Err(Unanswered::Problem(ErrorCode::UpstreamChanged))), 502, FAILED),
            (file(Err(Unanswered::Problem(ErrorCode::NotFound))), 404, NO_CERTIFICATE),
            (none(), 404, NO_CERTIFICATE),
            (unanswered(Unanswered::Problem(ErrorCode::ServiceAbsent)), 404, NO_SERVICE),
        ] {
            let response = answered(settled);
            assert_eq!((response.status().as_u16(), body(&response)), (status, serde_json::json!({ "ok": false, "error": error })));
        }
        let Settled::Lost { otherwise } = file(Err(Unanswered::Problem(ErrorCode::SessionExpired))) else { panic!("the CAS to ask") };
        assert_eq!((otherwise.status().as_u16(), body(&otherwise)), (502, serde_json::json!({ "ok": false, "error": FAILED })));
    }

    // The sentences are the ones Node's routes say.
    #[test]
    fn the_refusals_are_nodes_words() {
        let node = include_str!("../../../../../server/entAuthApp.js");
        for sentence in [NO_SERVICE, NO_CERTIFICATE, FAILED] {
            assert!(node.contains(&format!("'{sentence}'")), "{sentence}");
        }
    }
}
