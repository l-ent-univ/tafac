// Whether a request was started by another site (a link in a mail read
// elsewhere, a page somewhere), as the browser says in Sec-Fetch-Site
// (server/launchRelay/requestSite.ts).
//
// The relay asks the university's services with the student's CAS ticket. A
// link to it from another site would make those requests without the
// student having asked for anything here, so such a request is answered as
// nobody's: the browser goes to the service itself. `none` is the student's
// own doing (an address typed, a bookmark); no header at all is an old
// browser, or an app's bridge.

use http::HeaderMap;

pub(crate) fn is_cross_site(headers: &HeaderMap) -> bool {
    let site = headers.get("sec-fetch-site").and_then(|value| value.to_str().ok()).unwrap_or_default().trim().to_ascii_lowercase();
    !site.is_empty() && site != "same-origin" && site != "none"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(site: Option<&str>) -> bool {
        let mut headers = HeaderMap::new();
        if let Some(site) = site {
            headers.insert("sec-fetch-site", site.parse().unwrap());
        }
        is_cross_site(&headers)
    }

    // Node's own cases (tests/routeErrors.test.ts).
    #[test]
    fn a_request_started_by_another_site_is_told_from_the_students_own() {
        assert!(said(Some("cross-site")));
        assert!(said(Some("same-site")));
        assert!(said(Some(" Cross-Site ")));
        assert!(!said(Some("same-origin")));
        // An address typed or a bookmark; an old browser, an app's bridge.
        assert!(!said(Some("none")));
        assert!(!said(None));
        assert!(!said(Some("")));
    }
}
