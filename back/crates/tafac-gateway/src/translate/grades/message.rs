// GET /__ent_auth/grades/department-message?dep=<department>: the notice a
// department writes above its reports.
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   200 { authenticated: true, message }
//       `message` is what the department wrote (HTML), or null when it
//       wrote nothing. The page shows it as plain text. tonAPI reads the
//       same and gives the text, a line per paragraph: answered here.
//   200 { authenticated: false, message: null }: nobody signed in.
//       Answered here (gateway/nobody.rs).
//   400 { error }: a `dep` that isn't a department's name. Answered here,
//       in Node's words (translate/failed.rs).
//   500 { error }: ScoDoc down or answering something else. Answered here
//       (translate/failed.rs).

use tonapi_core::GradeNotice;

use super::super::{json_answer, unanswered, Translated, Unanswered};

// A department's name, as Node reads it from the request.
pub(crate) fn department(value: &str) -> Option<&str> {
    let name = value.trim();
    let plain = name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'));
    ((1..=40).contains(&name.len()) && plain).then_some(name)
}

pub fn translate(asked: Result<&GradeNotice, Unanswered>) -> Translated {
    match asked {
        Ok(notice) => json_answer(&serde_json::json!({ "authenticated": true, "message": notice.message })),
        Err(why) => unanswered(why),
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::Failure;
    use super::*;

    fn answer(asked: Result<&GradeNotice, Unanswered>) -> Option<serde_json::Value> {
        match translate(asked) {
            Translated::Answer(response) => Some(serde_json::from_slice(response.body()).unwrap()),
            Translated::Failed(_) | Translated::Lost => None,
        }
    }

    #[test]
    fn a_message_or_none_is_nodes_answer() {
        let written = GradeNotice { message: Some("Jury le 12 février.\n• Salle A".to_string()) };
        assert_eq!(answer(Ok(&written)).unwrap(), serde_json::json!({ "authenticated": true, "message": "Jury le 12 février.\n• Salle A" }));
        assert_eq!(answer(Ok(&GradeNotice { message: None })).unwrap(), serde_json::json!({ "authenticated": true, "message": null }));
        // No notice read: the route's error.
        assert!(matches!(translate(Err(Unanswered::Slow)), Translated::Failed(Failure::Unavailable(_))));
    }

    #[test]
    fn a_department_is_a_plain_name() {
        assert_eq!(department(" MMI "), Some("MMI"));
        assert_eq!(department("GEA_2.b-c"), Some("GEA_2.b-c"));
        for refused in ["", "MMI/INFO", "a b", "é", &"x".repeat(41)] {
            assert_eq!(department(refused), None, "{refused}");
        }
    }
}
