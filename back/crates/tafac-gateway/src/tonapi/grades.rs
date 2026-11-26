// ScoDoc: the grades, and what goes with a report.
//
//   report        a semester's grades and absences, from one read of the
//                 IUT's gateway (the current semester, or one asked for)
//   notice        a department's message above its reports
//   distribution  how the class did at one evaluation of the student's report
//   transcript    a semester's report as a PDF
//
// ScoDoc belongs to a component of the university (an IUT): the student's
// is found at the sign-in, or at the first question for a session made
// elsewhere (tonapi/mod.rs). tonAPI then signs in to the IUT's gateway with
// the CAS ticket, and the session holds ScoDoc's own session from then on.

use tonapi_config::ServiceKind;
use tonapi_core::{AbsenceReport, GradeDistribution, GradeNotice, GradeReport};
use tonapi_providers::{Download, Fetched};

use super::{Asked, Service, Unanswered};

// `semester`: the one asked for; None, the current one, with the list of
// the student's semesters and what the IUT's gateway is set up for.
pub(crate) async fn report(service: &Service<'_>, semester: Option<&str>) -> Result<Asked<(GradeReport, AbsenceReport)>, Unanswered> {
    service
        .ask(ServiceKind::Grades, async |context| {
            let (grades, absences) = tonapi_providers::grades_and_absences_of(context, semester).await;
            let (grades, absences) = (grades?, absences?);
            Ok(Fetched { data: (grades.data, absences.data), provider: grades.provider })
        })
        .await
}

pub(crate) async fn notice(service: &Service<'_>, department: &str) -> Result<Asked<GradeNotice>, Unanswered> {
    service.ask(ServiceKind::Grades, async |context| tonapi_providers::grade_notice(context, department).await).await
}

pub(crate) async fn distribution(service: &Service<'_>, semester: &str, evaluation: &str) -> Result<Asked<GradeDistribution>, Unanswered> {
    service.ask(ServiceKind::Grades, async |context| tonapi_providers::grade_distribution(context, semester, evaluation).await).await
}

pub(crate) async fn transcript(service: &Service<'_>, semester: &str) -> Result<Asked<Download>, Unanswered> {
    service.ask(ServiceKind::Grades, async |context| tonapi_providers::grade_transcript(context, semester).await).await
}
