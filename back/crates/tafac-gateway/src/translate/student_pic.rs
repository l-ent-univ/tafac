// GET /__ent_auth/student-pic: the student's photo, from the ScoDoc of
// their IUT. With `?meta=1`, whether there is one, as JSON (the page asks
// that first, then shows the photo at `previewUrl`).
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   200, the image (png, jpeg, gif, webp, avif or bmp: never SVG, which is
//       a document once opened on its own), `nosniff`, a policy that lets
//       nothing run, never kept. tonAPI asks the IUT's gateway for the
//       same file: answered here.
//   200 { authenticated: true, sessionMode: null, available: true,
//         source: 'scodoc', contentType, size, status: 200,
//         previewUrl: '/__ent_auth/student-pic' } with `meta`: here.
//   404 { available: false, source: 'scodoc' }, and with `meta` 200
//       { …, available: false, source: 'scodoc', previewUrl: null }: the
//       gateway gave no image (tonAPI's `not_found`), or refuses its
//       session while the CAS still knows the student's. Here. Node added
//       what ScoDoc answered instead (`contentType`, `size`, `status`),
//       which tonAPI doesn't say and the page doesn't read.
//   the same with `source: 'none'`: no ScoDoc for the student's component
//       (tonAPI's `service_absent`). Here. Node, which knew one ScoDoc for
//       the whole university, asked it for every student.
//   401 { error: 'session_expired' }, `X-Tafac-Session: expired`: the CAS
//       no longer knows the session. Here (translate/expired.rs).
//   500 { error }: ScoDoc down, slow, or answering what tonAPI doesn't
//       read. Here, in the one sentence Node's production server says
//       (translate/failed.rs holds it to Node's).
//   401 for nobody signed in (200 with `meta`), the demo account: Node.

use http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE};
use http::HeaderValue;
use tonapi_core::ErrorCode;
use tonapi_providers::Download;

use super::failed::UNAVAILABLE;
use super::settled::Settled;
use super::{answer, json_response, Unanswered};

const PICTURE_PATH: &str = "/__ent_auth/student-pic";
// Nothing of the answer runs, were its address opened as a page.
const NOTHING_RUNS: &str = "default-src 'none'; sandbox";

fn json(status: u16, body: &serde_json::Value) -> http::Response<Vec<u8>> {
    json_response(status, serde_json::to_vec(body).unwrap_or_default())
}

// No photo. `source`: where it would come from (`scodoc`), or `none`.
fn none(wants_meta: bool, source: &str) -> http::Response<Vec<u8>> {
    match wants_meta {
        true => json(200, &serde_json::json!({ "authenticated": true, "sessionMode": null, "available": false, "source": source, "previewUrl": null })),
        false => json(404, &serde_json::json!({ "available": false, "source": source })),
    }
}

fn photo(file: Download) -> http::Response<Vec<u8>> {
    let kind = HeaderValue::from_str(&file.content_type).unwrap_or(HeaderValue::from_static("application/octet-stream"));
    let mut response = answer(200).header(CONTENT_TYPE, kind).header(CACHE_CONTROL, "no-store").body(file.bytes).unwrap();
    // In place of the policy every answer carries.
    response.headers_mut().insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(NOTHING_RUNS));
    response
}

// `wants_meta`: `?meta=1`.
pub fn translate(asked: Result<Download, Unanswered>, wants_meta: bool) -> Settled {
    match asked {
        // tonAPI gives a photo only as one of the types an <img> shows.
        Ok(file) if file.content_type.starts_with("image/") && !file.bytes.is_empty() => Settled::Answer(match wants_meta {
            true => json(
                200,
                &serde_json::json!({
                    "authenticated": true, "sessionMode": null, "available": true, "source": "scodoc",
                    "contentType": file.content_type, "size": file.bytes.len(), "status": 200, "previewUrl": PICTURE_PATH,
                }),
            ),
            false => photo(file),
        }),
        Ok(_) | Err(Unanswered::Problem(ErrorCode::NotFound)) => Settled::Answer(none(wants_meta, "scodoc")),
        Err(Unanswered::Problem(ErrorCode::ServiceAbsent | ErrorCode::NotImplemented)) => Settled::Answer(none(wants_meta, "none")),
        Err(Unanswered::Problem(ErrorCode::SessionExpired)) => Settled::Lost { otherwise: none(wants_meta, "scodoc") },
        Err(_) => Settled::Answer(json(500, &serde_json::json!({ "error": UNAVAILABLE }))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ANSWERED_BY;

    fn file(kind: &str, bytes: &[u8]) -> Download {
        Download { content_type: kind.to_string(), file_name: "photo.jpeg".to_string(), bytes: bytes.to_vec() }
    }

    fn answered(settled: Settled) -> http::Response<Vec<u8>> {
        let Settled::Answer(response) = settled else { panic!("an answer") };
        response
    }

    fn body(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn the_photo_goes_as_node_sends_it_and_nothing_of_it_runs() {
        let response = answered(translate(Ok(file("image/jpeg", b"\xff\xd8\xff a photo")), false));
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "image/jpeg");
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(response.headers().get_all("content-security-policy").iter().collect::<Vec<_>>(), ["default-src 'none'; sandbox"]);
        assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
        assert_eq!(response.body(), b"\xff\xd8\xff a photo");

        let meta = answered(translate(Ok(file("image/jpeg", b"\xff\xd8\xff a photo")), true));
        assert_eq!(meta.status(), 200);
        assert_eq!(
            body(&meta),
            serde_json::json!({
                "authenticated": true, "sessionMode": null, "available": true, "source": "scodoc",
                "contentType": "image/jpeg", "size": 11, "status": 200, "previewUrl": "/__ent_auth/student-pic",
            })
        );
    }

    #[test]
    fn no_photo_is_no_error() {
        for (asked, source) in [
            (Err(Unanswered::Problem(ErrorCode::NotFound)), "scodoc"),
            (Ok(file("text/html", b"<html>")), "scodoc"),
            (Ok(file("image/png", b"")), "scodoc"),
            (Err(Unanswered::Problem(ErrorCode::ServiceAbsent)), "none"),
            (Err(Unanswered::Problem(ErrorCode::NotImplemented)), "none"),
        ] {
            let meta = answered(translate(asked.clone(), true));
            assert_eq!(meta.status(), 200);
            assert_eq!(body(&meta), serde_json::json!({ "authenticated": true, "sessionMode": null, "available": false, "source": source, "previewUrl": null }));
            let plain = answered(translate(asked, false));
            assert_eq!((plain.status(), body(&plain)), (http::StatusCode::NOT_FOUND, serde_json::json!({ "available": false, "source": source })));
        }
    }

    #[test]
    fn a_failure_is_worded_here_and_a_lost_session_is_the_cas_to_ask() {
        for why in [Unanswered::Slow, Unanswered::Failed, Unanswered::NoTicket, Unanswered::Problem(ErrorCode::ServiceUnavailable), Unanswered::Problem(ErrorCode::UpstreamChanged)] {
            for wants_meta in [true, false] {
                let response = answered(translate(Err(why), wants_meta));
                assert_eq!((response.status(), body(&response)), (http::StatusCode::INTERNAL_SERVER_ERROR, serde_json::json!({ "error": "Service indisponible pour le moment" })));
            }
        }
        // The CAS still knowing the session, ScoDoc's refusal is no photo.
        let Settled::Lost { otherwise } = translate(Err(Unanswered::Problem(ErrorCode::SessionExpired)), false) else { panic!("the CAS to ask") };
        assert_eq!((otherwise.status(), body(&otherwise)), (http::StatusCode::NOT_FOUND, serde_json::json!({ "available": false, "source": "scodoc" })));
    }
}
