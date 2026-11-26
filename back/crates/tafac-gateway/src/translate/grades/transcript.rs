// GET /__ent_auth/grades/report.pdf?semestre=<id>&type=BUT: a semester's
// report as the IUT's gateway prints it.
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   200, the PDF, `inline; filename="releve-<id>.pdf"`, never kept
//       tonAPI asks the IUT's gateway for the same file, for the student of
//       the session: answered here. The type (BUT, DUT) is the one of the
//       student's report, whatever the request says.
//   502 { error }: the gateway gave no PDF (tonAPI's `not_found`). Node.
//   401 { error }: nobody signed in. Node.
//   404 for the demo account: Node.
//   400 { error }: a semester id that isn't one. Node.
//   500 { error }: ScoDoc down or answering something else. Node.

use tonapi_providers::Download;

use super::super::{answer, unanswered, Translated, Unanswered};

// `semester`: the id asked for, already checked to be one.
pub fn translate(asked: Result<Download, Unanswered>, semester: &str) -> Translated {
    let file = match asked {
        Ok(file) => file,
        Err(why) => return unanswered(why),
    };
    if !file.bytes.starts_with(b"%PDF") {
        return Translated::Node("the report is not a PDF".to_string());
    }
    Translated::Answer(
        answer(200)
            .header("content-type", "application/pdf")
            .header("content-disposition", format!("inline; filename=\"releve-{semester}.pdf\""))
            .header("cache-control", "private, no-store")
            .body(file.bytes)
            .unwrap(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ANSWERED_BY;

    fn file(bytes: &[u8]) -> Download {
        Download { content_type: "application/pdf".to_string(), file_name: "releve-901.pdf".to_string(), bytes: bytes.to_vec() }
    }

    #[test]
    fn the_pdf_goes_as_node_sends_it() {
        let Translated::Answer(response) = translate(Ok(file(b"%PDF-1.4 a report")), "901") else { panic!("an answer") };
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "application/pdf");
        assert_eq!(response.headers()["content-disposition"], "inline; filename=\"releve-901.pdf\"");
        assert_eq!(response.headers()["cache-control"], "private, no-store");
        assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
        assert_eq!(response.body(), b"%PDF-1.4 a report");
    }

    #[test]
    fn anything_but_a_pdf_is_nodes() {
        assert!(matches!(translate(Ok(file(b"<html>Connexion</html>")), "901"), Translated::Node(_)));
        assert!(matches!(translate(Err(Unanswered::Problem(tonapi_core::ErrorCode::NotFound)), "901"), Translated::Node(_)));
    }
}
