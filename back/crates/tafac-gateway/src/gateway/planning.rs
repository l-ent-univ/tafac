// The planning's routes, answered with tonAPI's own model:
//
//   GET /__ent_auth/timetable?from=&to=&resources=      the classes of a range
//   GET /__ent_auth/timetable/tree?kind=                 the tree of groups,
//                                                        teachers and rooms
//   GET /__ent_auth/timetable/resources?kind=&q=&limit=  the ones searched for
//
// Unlike the other moved routes, nothing is translated here: the page reads
// what tonAPI's server gives on its /v1 routes of the same names, `{ data,
// meta }`, and a refusal as `application/problem+json` with tonAPI's stable
// code (an unknown resource, a provider that can't do it, a link instead of
// a service). Nothing of Node's words, then: these routes were never Node's.
//
// What stays the gateway's, as for any service:
//
//   the session     the CAS ticket, and the planning service's own session
//                   (ADE's tokens, TEMPO's cookie) held from one question to
//                   the next (tonapi/timetable.rs)
//   its turn        one question at a time for a session: ADE gives its
//                   token to one of several sign-ins made at once, and the
//                   page asks several weeks at once
//   the parameters  read before anything is asked, as tonAPI's server reads
//                   them (tonapi-server/src/routes/data.rs), but for the
//                   range: up to 430 days, a whole academic year of TEMPO's
//                   (1 July to 31 August the next year), which the page asks
//                   to know whether a student has a timetable there at all
//   a lost session  tonAPI's `session_expired`, for the CAS to say whether
//                   the session is over (mod.rs)
//
// Nothing is kept: the page keeps its weeks itself, as long as `meta`'s
// `cacheSecs` says, and tonAPI keeps the tree for every student.

use chrono::{Datelike, Duration, NaiveDate, Utc};
use serde::Serialize;
use tonapi_config::ServiceKind;
use tonapi_core::{ErrorCode, Meta, Problem, ResourceKind};
use tonapi_providers::ResourceQuery;

use super::services::parameter;
use super::Gateway;
use crate::session::memory::Turn;
use crate::session::Held;
use crate::tonapi::{self, Said, Service, Unanswered};
use crate::translate::{self, answer, Translated};

// A range asked of the planning, both days included: a TEMPO academic year.
pub(crate) const MAX_RANGE_DAYS: i64 = 430;
// tonAPI's own limits (tonapi-server/src/routes/data.rs).
const MAX_RESOURCES: usize = 30;
const MAX_RESOURCE_LENGTH: usize = 64;
const DEFAULT_RESOURCES_LISTED: usize = 100;
const MAX_RESOURCES_LISTED: usize = 50_000;
const MAX_SEARCH_LENGTH: usize = 100;

const PROBLEM_TYPE: &str = "application/problem+json";

// tonAPI's answer, as its server writes it.
#[derive(Serialize)]
struct DataResponse<'a, T> {
    data: &'a T,
    meta: &'a Meta,
}

impl Gateway {
    // GET /__ent_auth/timetable?from=AAAA-MM-JJ&to=AAAA-MM-JJ&resources=…
    pub(super) async fn timetable(&self, held: &Held<'_>, query: Option<&str>) -> Translated {
        let (from, to) = match range(query, held.university.timezone) {
            Ok(range) => range,
            Err(refused) => return refused,
        };
        let resources = match requested_resources(parameter(query, "resources").as_deref()) {
            Ok(resources) => resources,
            Err(refused) => return refused,
        };
        self.planning(held, async |service| tonapi::timetable::courses(service, from, to, &resources).await).await
    }

    // GET /__ent_auth/timetable/tree?kind=room,teacher
    pub(super) async fn timetable_tree(&self, held: &Held<'_>, query: Option<&str>) -> Translated {
        let kinds = match requested_kinds(parameter(query, "kind").as_deref()) {
            Ok(kinds) => kinds,
            Err(refused) => return refused,
        };
        self.planning(held, async |service| tonapi::timetable::tree(service, &kinds).await).await
    }

    // GET /__ent_auth/timetable/resources?kind=room&q=amphi&limit=20
    pub(super) async fn timetable_resources(&self, held: &Held<'_>, query: Option<&str>) -> Translated {
        let searched = match resource_query(query) {
            Ok(searched) => searched,
            Err(refused) => return refused,
        };
        self.planning(held, async |service| tonapi::timetable::resources(service, &searched).await).await
    }

    // One of the planning's questions, with the planning's turn held: tonAPI's
    // answer as it gave it.
    async fn planning<T, F>(&self, held: &Held<'_>, ask: F) -> Translated
    where
        T: Serialize,
        F: AsyncFnOnce(&Service<'_>) -> Result<Said<T>, Unanswered>,
    {
        let _turn = held.memory.turn(Turn::Service(ServiceKind::Timetable)).await;
        let service = Service { held, net: self.net };
        match ask(&service).await {
            Ok(Said { said: Ok(fetched), keep_secs }) => {
                let meta = Meta {
                    university: held.session.university.clone(),
                    establishment: held.memory.snapshot().component.map(|component| component.id),
                    provider: fetched.provider.to_string(),
                    fetched_at: Utc::now().fixed_offset(),
                    cache_secs: keep_secs,
                };
                let body = serde_json::to_vec(&DataResponse { data: &fetched.data, meta: &meta }).unwrap_or_default();
                translate::kept_answer(body)
            }
            Ok(Said { said: Err(problem), .. }) if problem.code == ErrorCode::SessionExpired => Translated::Lost,
            Ok(Said { said: Err(problem), .. }) => Translated::Answer(problem_answer(&problem)),
            Err(why) => translate::unanswered(why),
        }
    }
}

// A refusal, as tonAPI's server writes one.
pub(crate) fn problem_answer(problem: &Problem) -> http::Response<Vec<u8>> {
    answer(problem.status)
        .header("content-type", PROBLEM_TYPE)
        .header("cache-control", "no-store")
        .body(serde_json::to_vec(problem).unwrap_or_default())
        .unwrap()
}

// A planning route with no answer of tonAPI's: the university didn't answer
// in time, or tonAPI failed. `why`: words of this crate, never anything of
// the account.
pub(crate) fn unavailable(why: &str) -> http::Response<Vec<u8>> {
    problem_answer(&Problem::new(ErrorCode::ServiceUnavailable).detail(why))
}

fn refused(detail: impl Into<String>) -> Translated {
    Translated::Answer(problem_answer(&Problem::new(ErrorCode::InvalidRequest).detail(detail)))
}

// `from` and `to`, both included. Without them: the week of today at the
// university, Monday to Sunday.
fn range(query: Option<&str>, timezone: chrono_tz::Tz) -> Result<(NaiveDate, NaiveDate), Translated> {
    let day = |name: &str| match parameter(query, name) {
        None => Ok(None),
        Some(written) => NaiveDate::parse_from_str(&written, "%Y-%m-%d").map(Some).map_err(|_| refused(format!("`{name}` : une date `AAAA-MM-JJ`"))),
    };
    let (asked_from, asked_to) = (day("from")?, day("to")?);
    let today = Utc::now().with_timezone(&timezone).date_naive();
    let monday = today - Duration::days(i64::from(today.weekday().num_days_from_monday()));
    let from = asked_from.unwrap_or(monday);
    // Dates at the edges of what the format takes: refused before any sum.
    let plausible = |day: NaiveDate| (1900..=2200).contains(&day.year());
    if !plausible(from) || asked_to.is_some_and(|to| !plausible(to)) {
        return Err(refused("dates entre 1900 et 2200 seulement"));
    }
    let to = asked_to.unwrap_or(from + Duration::days(6));
    if to < from {
        return Err(refused("`to` précède `from`"));
    }
    if (to - from).num_days() >= MAX_RANGE_DAYS {
        return Err(refused(format!("{MAX_RANGE_DAYS} jours au plus de `from` à `to`")));
    }
    Ok((from, to))
}

// The ids of `resources`, comma-separated: none empty, none twice.
fn requested_resources(written: Option<&str>) -> Result<Vec<String>, Translated> {
    let mut resources: Vec<String> = Vec::new();
    for id in written.unwrap_or_default().split(',').map(str::trim) {
        if id.is_empty() || resources.iter().any(|known| known == id) {
            continue;
        }
        let plain = id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
        if !plain || id.len() > MAX_RESOURCE_LENGTH {
            return Err(refused("`resources` : identifiant de ressource invalide"));
        }
        if resources.len() == MAX_RESOURCES {
            return Err(refused(format!("`resources` : {MAX_RESOURCES} ressources au plus")));
        }
        resources.push(id.to_string());
    }
    Ok(resources)
}

// The kinds of `kind`, comma-separated. None: every kind.
fn requested_kinds(written: Option<&str>) -> Result<Vec<ResourceKind>, Translated> {
    let mut kinds = Vec::new();
    for name in written.unwrap_or_default().split(',').map(str::trim) {
        let kind = match name {
            "" => continue,
            "group" => ResourceKind::Group,
            "teacher" => ResourceKind::Teacher,
            "room" => ResourceKind::Room,
            "other" => ResourceKind::Other,
            _ => return Err(refused("`kind` : `group`, `teacher`, `room` ou `other`, séparés par des virgules")),
        };
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    Ok(kinds)
}

// `kind`, `q` and `limit` of /timetable/resources.
fn resource_query(query: Option<&str>) -> Result<ResourceQuery, Translated> {
    let search = parameter(query, "q").map(|searched| searched.trim().to_string()).filter(|searched| !searched.is_empty());
    if search.as_ref().is_some_and(|searched| searched.chars().count() > MAX_SEARCH_LENGTH) {
        return Err(refused(format!("`q` : {MAX_SEARCH_LENGTH} caractères au plus")));
    }
    let limit = match parameter(query, "limit") {
        None => DEFAULT_RESOURCES_LISTED,
        Some(written) => written.parse::<usize>().ok().filter(|limit| (1..=MAX_RESOURCES_LISTED).contains(limit)).ok_or_else(|| refused(format!("`limit` : entre 1 et {MAX_RESOURCES_LISTED}")))?,
    };
    Ok(ResourceQuery { kinds: requested_kinds(parameter(query, "kind").as_deref())?, search, limit: Some(limit) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refusal(translated: Translated) -> (u16, serde_json::Value) {
        let Translated::Answer(response) = translated else { panic!("a refusal is an answer") };
        assert_eq!(response.headers()["content-type"], PROBLEM_TYPE);
        (response.status().as_u16(), serde_json::from_slice(response.body()).unwrap())
    }

    fn day(written: &str) -> NaiveDate {
        NaiveDate::parse_from_str(written, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn a_range_is_two_days_or_this_week() {
        let paris = chrono_tz::Europe::Paris;
        let asked = range(Some("from=2026-11-23&to=2026-11-29"), paris).ok().unwrap();
        assert_eq!(asked, (day("2026-11-23"), day("2026-11-29")));
        // Without them: Monday to Sunday of this week.
        let (from, to) = range(None, paris).ok().unwrap();
        assert_eq!((from.weekday(), (to - from).num_days()), (chrono::Weekday::Mon, 6));
        // A TEMPO academic year fits, a day more doesn't.
        assert!(range(Some("from=2026-07-01&to=2027-08-31"), paris).is_ok());
        assert!(range(Some("from=2026-07-01&to=2027-09-04"), paris).is_err());
        for written in ["from=2026-11-23&to=2026-11-01", "from=23/11/2026", "from=2026-11-23&to=demain", "from=0001-01-01"] {
            let (status, problem) = refusal(range(Some(written), paris).err().unwrap());
            assert_eq!((status, problem["code"].as_str()), (400, Some("invalid_request")), "{written}");
        }
    }

    #[test]
    fn the_resources_are_read_as_tonapis_server_reads_them() {
        assert_eq!(requested_resources(Some("14961, 800,14961,,")).ok().unwrap(), ["14961", "800"]);
        assert!(requested_resources(None).ok().unwrap().is_empty());
        let too_many = (0..31).map(|n| n.to_string()).collect::<Vec<_>>().join(",");
        for written in ["1;2", "a/b", too_many.as_str(), &"9".repeat(65)] {
            assert_eq!(refusal(requested_resources(Some(written)).err().unwrap()).0, 400, "{written}");
        }
    }

    #[test]
    fn kinds_and_a_search_are_read_too() {
        assert_eq!(requested_kinds(Some("room, teacher,room")).ok().unwrap(), [ResourceKind::Room, ResourceKind::Teacher]);
        assert!(requested_kinds(None).ok().unwrap().is_empty());
        assert!(requested_kinds(Some("salle")).is_err());
        let searched = resource_query(Some("kind=room&q=%20amphi%20lannion%20&limit=20")).ok().unwrap();
        assert_eq!((searched.kinds, searched.search.as_deref(), searched.limit), (vec![ResourceKind::Room], Some("amphi lannion"), Some(20)));
        assert_eq!(resource_query(None).ok().unwrap().limit, Some(100));
        for written in ["limit=0", "limit=50001", "limit=beaucoup", &format!("q={}", "a".repeat(101))] {
            assert!(resource_query(Some(written)).is_err(), "{written}");
        }
    }

    #[test]
    fn a_refusal_is_tonapis_problem() {
        let problem = Problem::new(ErrorCode::ServiceAbsent).detail("le service `timetable` n'est pas proposé").link("https://planning.exemple.test/");
        let response = problem_answer(&problem);
        assert_eq!(response.status(), 404);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()[crate::ANSWERED_BY], "tonapi");
        let said: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(said["code"], "service_absent");
        assert_eq!(said["link"], "https://planning.exemple.test/");
        assert_eq!(said["type"], "urn:tonapi:problem:service_absent");
        assert_eq!(unavailable("the university is slow to answer").status(), 502);
    }
}
