// GET /__ent_auth/apps: the applications the portal lists for the student.
//
// The page reads tonAPI's own model here, not a portal's layout: one list,
// the same whatever the portal (Node gives the same list for the portals
// it reads itself, server/entAuthApp.js).
//
//   200 { authenticated: true, sessionMode: null, apps: [{ id, title,
//       description, url, iconUrl, category, favorite }] }
//       `id` is the portal's own name for the application (uPortal's
//       fname): what the page keeps its favourites, its order and its icons
//       by. `url` is where the application is, never an address of the
//       portal's when the portal says another. `favorite`: starred on the
//       portal, which the page starts its own favourites from, once.
//       Answered here.
//   401 { error: 'session_expired' } with X-Tafac-Session: expired, the
//       cookie cleared: the CAS no longer knows the ticket. Answered here
//       (translate/expired.rs), and Node is told.
//   502 { error }: the portal is down or slow, or answered what tonAPI
//       doesn't read. Answered here (translate/failed.rs), in the sentence
//       the page shows as it is.
//   200 { authenticated: false, apps: null }: nobody signed in, another
//       university. Answered here (gateway/nobody.rs).

use tonapi_core::App;

use super::{json_answer, unanswered, Translated, Unanswered};

pub fn translate(asked: Result<&[App], Unanswered>) -> Translated {
    match asked {
        Ok(apps) => json_answer(&serde_json::json!({ "authenticated": true, "sessionMode": null, "apps": apps })),
        Err(why) => unanswered(why),
    }
}

#[cfg(test)]
mod tests {
    use super::super::Failure;
    use super::*;

    fn body(translated: Translated) -> serde_json::Value {
        let Translated::Answer(response) = translated else { panic!("an answer made here") };
        assert_eq!(response.status(), 200);
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn the_list_is_tonapis_own_field_for_field() {
        let apps = [
            App {
                id: "webapp-planning".to_string(),
                title: "Mon emploi du temps".to_string(),
                description: Some("Le planning".to_string()),
                url: "https://planning.exemple.test/".to_string(),
                icon_url: None,
                category: Some("Scolarité".to_string()),
                favorite: true,
            },
            App { id: "aide".to_string(), title: "Aide".to_string(), description: None, url: "https://ent.exemple.test/p/aide".to_string(), icon_url: None, category: None, favorite: false },
        ];
        assert_eq!(
            body(translate(Ok(&apps))),
            serde_json::json!({ "authenticated": true, "sessionMode": null, "apps": [
                { "id": "webapp-planning", "title": "Mon emploi du temps", "description": "Le planning", "url": "https://planning.exemple.test/", "iconUrl": null, "category": "Scolarité", "favorite": true },
                { "id": "aide", "title": "Aide", "description": null, "url": "https://ent.exemple.test/p/aide", "iconUrl": null, "category": null, "favorite": false },
            ] })
        );
        // A portal that lists nothing is no error.
        assert_eq!(body(translate(Ok(&[])))["apps"], serde_json::json!([]));
    }

    #[test]
    fn what_tonapi_cant_answer_is_the_cas_to_ask_or_the_portals_error() {
        assert!(matches!(translate(Err(Unanswered::Problem(tonapi_core::ErrorCode::SessionExpired))), Translated::Lost));
        for why in [Unanswered::Slow, Unanswered::NoTicket, Unanswered::Failed, Unanswered::Problem(tonapi_core::ErrorCode::UpstreamChanged), Unanswered::Problem(tonapi_core::ErrorCode::ServiceUnavailable)] {
            let Translated::Failed(failure) = translate(Err(why)) else { panic!("{why}") };
            assert_eq!(failure, Failure::Unavailable(why.to_string()));
        }
    }
}
