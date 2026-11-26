// GET /__ent_auth/grades/evaluation-distribution?semestre=<id>&eval=<id>:
// how the class did at one evaluation, behind a grade's histogram.
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   200 { authenticated: true, status: 'ok', counts, total, bins: 'integer' }
//       `counts`: how many grades at each whole point, 21 of them (0 to
//       20). tonAPI counts the same grades the same way: answered here.
//   200 { authenticated: true, status: 'unavailable', reason }
//       'disabled' (the IUT shares no histogram), 'hidden' (the report
//       isn't published), 'too-few' (fewer than six grades). tonAPI says
//       which: answered here.
//   404 { error }: an evaluation that isn't in the student's own report
//       (tonAPI's `not_found`: it checks the same). Node, which words it.
//   200 { authenticated: false, … 'signed-out' }: nobody signed in. Node.
//   200 or 404 for the demo account: Node.
//   400 { error }: ids that aren't ids. Node.
//   500 { error }: ScoDoc down or answering something else. Node.

use tonapi_core::{DistributionUnavailable, GradeDistribution};

use super::super::{json_answer, unanswered, Translated, Unanswered};

pub fn translate(asked: Result<&GradeDistribution, Unanswered>) -> Translated {
    let distribution = match asked {
        Ok(distribution) => distribution,
        Err(why) => return unanswered(why),
    };
    let reason = match distribution.unavailable {
        None => {
            return json_answer(&serde_json::json!({
                "authenticated": true, "status": "ok", "counts": distribution.counts, "total": distribution.total, "bins": "integer",
            }))
        }
        Some(DistributionUnavailable::Disabled) => "disabled",
        Some(DistributionUnavailable::Hidden) => "hidden",
        Some(DistributionUnavailable::TooFew) => "too-few",
    };
    json_answer(&serde_json::json!({ "authenticated": true, "status": "unavailable", "reason": reason }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(asked: Result<&GradeDistribution, Unanswered>) -> Option<serde_json::Value> {
        match translate(asked) {
            Translated::Answer(response) => Some(serde_json::from_slice(response.body()).unwrap()),
            Translated::Node(_) | Translated::Lost => None,
        }
    }

    fn unavailable(reason: DistributionUnavailable) -> GradeDistribution {
        GradeDistribution { counts: Vec::new(), total: 0, out_of: 20.0, unavailable: Some(reason) }
    }

    #[test]
    fn the_counts_are_nodes_field_for_field() {
        let mut counts = vec![0_u32; 21];
        counts[12] = 4;
        counts[20] = 2;
        let distribution = GradeDistribution { counts: counts.clone(), total: 6, out_of: 20.0, unavailable: None };
        assert_eq!(answer(Ok(&distribution)).unwrap(), serde_json::json!({ "authenticated": true, "status": "ok", "counts": counts, "total": 6, "bins": "integer" }));
    }

    #[test]
    fn why_there_is_none_is_said_as_node_says_it() {
        for (reason, said) in [(DistributionUnavailable::Disabled, "disabled"), (DistributionUnavailable::Hidden, "hidden"), (DistributionUnavailable::TooFew, "too-few")] {
            assert_eq!(answer(Ok(&unavailable(reason))).unwrap(), serde_json::json!({ "authenticated": true, "status": "unavailable", "reason": said }));
        }
        // An evaluation that isn't the student's: Node's 404.
        assert!(answer(Err(Unanswered::Problem(tonapi_core::ErrorCode::NotFound))).is_none());
    }
}
