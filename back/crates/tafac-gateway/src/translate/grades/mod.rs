// The grades' routes: tonAPI's report as the page gets ScoDoc's from Node.
//
//   report.rs        GET /__ent_auth/grades and /grades/semester/<id>
//   message.rs       GET /__ent_auth/grades/department-message
//   distribution.rs  GET /__ent_auth/grades/evaluation-distribution
//   transcript.rs    GET /__ent_auth/grades/report.pdf
//
// Node relays the JSON of the IUT's ScoDoc gateway as it is, and the page
// reads it directly (src/gradesReport.js). tonAPI gives its own report, the
// same for every software. report.rs writes ScoDoc's shape back from it:
// every field the page reads, under the name and in the form ScoDoc gives
// it. What the page never reads isn't written (the student's name and
// numbers least of all).

pub mod distribution;
pub mod message;
pub mod report;
pub mod transcript;

// A ScoDoc id (a semester's, an evaluation's): a whole number, as Node's
// parseGradesSemesterId reads it. Anything else is Node's to refuse.
pub(crate) fn scodoc_id(value: &str) -> Option<&str> {
    let id = value.trim();
    ((1..=10).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_digit())).then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_id_is_a_whole_number_as_node_reads_it() {
        assert_eq!(scodoc_id(" 1234 "), Some("1234"));
        for refused in ["", "12a", "-1", "1.5", "12345678901", "current", "1/2"] {
            assert_eq!(scodoc_id(refused), None, "{refused}");
        }
    }
}
