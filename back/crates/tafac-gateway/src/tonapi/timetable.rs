// The planning: ADE's portal at Rennes, TEMPO at Rennes 2.
//
// tonAPI signs in to the planning service with the CAS ticket and leaves its
// session (ADE's tokens, TEMPO's cookie) in the memory of the student's
// session: the next question, a week later in the page, signs in to nothing.
// The tree of groups, teachers and rooms is kept by tonAPI itself, the same
// for every student of a profile: a question for it asks ADE for nothing
// once one student has read it.
//
// Each question's answer goes to the page as tonAPI gives it, its refusals
// too (gateway/planning.rs): none of them is translated.

use chrono::NaiveDate;
use tonapi_config::ServiceKind;
use tonapi_core::{Course, ResourceKind, ResourceNode, TimetableResource};
use tonapi_providers::ResourceQuery;

use super::{Said, Service, Unanswered};

// The classes of `from..=to`: the student's own, or those of the resources
// asked for (ids of the tree: a group, a teacher, a room).
pub(crate) async fn courses(service: &Service<'_>, from: NaiveDate, to: NaiveDate, resources: &[String]) -> Result<Said<Vec<Course>>, Unanswered> {
    service.ask_as_said(ServiceKind::Timetable, async |context| tonapi_providers::timetable_of(context, from, to, resources).await).await
}

// The tree of the university's resources, of these kinds (all without any),
// the groups the student follows marked.
pub(crate) async fn tree(service: &Service<'_>, kinds: &[ResourceKind]) -> Result<Said<Vec<ResourceNode>>, Unanswered> {
    service.ask_as_said(ServiceKind::Timetable, async |context| tonapi_providers::timetable_tree(context, kinds).await).await
}

// The resources the query names, each with its path in the tree.
pub(crate) async fn resources(service: &Service<'_>, query: &ResourceQuery) -> Result<Said<Vec<TimetableResource>>, Unanswered> {
    service.ask_as_said(ServiceKind::Timetable, async |context| tonapi_providers::timetable_resources(context, query).await).await
}
