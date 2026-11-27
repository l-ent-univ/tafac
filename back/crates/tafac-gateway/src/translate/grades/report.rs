// GET /__ent_auth/grades and GET /__ent_auth/grades/semester/<id>: the
// report the « Mes notes » page, the grades' widgets and the Assiduité page
// all read.
//
// Node's answers (server/entAuthApp.js), and who gives each now:
//
//   200 { authenticated: true, sessionMode, grades }
//       `grades` is the JSON of the IUT's ScoDoc gateway as it comes:
//       { auth, config, semestres, relevé, absences, totauxAbsences } for
//       the current semester, { relevé, absences, totauxAbsences } for one
//       asked for. tonAPI reads the same answer into its own report:
//       answered here, with ScoDoc's shape written back from it.
//   200 { authenticated: false, grades: null }: nobody signed in.
//       Answered here (gateway/nobody.rs).
//   the same for a student without a semester, `grades` being ScoDoc's own
//       empty report: answered here, written back as empty.
//   400 { error }: a semester id that isn't one. Answered here, in Node's
//       words (translate/failed.rs).
//   401 with X-Tafac-Session: expired: the CAS no longer knows the ticket.
//       Answered here (translate/expired.rs), and Node is told.
//   500 { error }: ScoDoc down, slow, or answering something else; a
//       student ScoDoc doesn't know, or whose component has none (tonAPI's
//       `service_absent`); a semester ScoDoc has no report for. Answered
//       here (translate/failed.rs).
//   404 { disabled: true }: a university without grades. It is not one of
//       routes.rs' universities for this route.
//
// What is written back is what the page reads (src/gradesReport.js,
// src/entApi.js, src/gradeSimulation.js, src/assiduity.js), under ScoDoc's
// names and in ScoDoc's forms: a grade is "12.50", one not given yet "~",
// an empty one "". Where the two differ, on purpose or for lack of it:
//   - nothing of the student is written (`auth`, `etudiant` but for the
//     department): the page reads none of it;
//   - what the IUT hides (ranks, credits earned) isn't in tonAPI's report:
//     `options` says so, and the page shows what it would have shown;
//   - the PDF and the absences are shown or not by one switch each, where
//     ScoDoc has a switch and a list of departments: the answer is the same;
//   - an evaluation's `description` is tonAPI's name for it, which differed
//     from ScoDoc's text in three evaluations of a past semester on a real
//     account (why isn't known yet: spaces, probably);
//   - a jury's `decision_annee.date` is the day, where ScoDoc gives the day
//     and the hour: the page doesn't show it;
//   - a semester's id written in %XX in the path, which Node's router
//     decodes, is no id here: the page writes its digits.

use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveTime, TimeZone, Timelike};
use chrono_tz::Tz;
use serde_json::{json, Map, Value};
use tonapi_core::{Absence, AbsenceReport, Evaluation, EvaluationKind, Grade, GradeReport, GradeStats, ModuleGrades, SemesterGrades, UnitGrade};

use super::super::{json_answer, unanswered, Translated, Unanswered};

// ScoDoc's word for a grade not given yet, and tonAPI's.
const PENDING: &str = "~";
const PENDING_STATUS: &str = "ATT";

// A number the way ScoDoc writes its grades: "07.50".
fn number(value: f64) -> Value {
    Value::String(format!("{value:05.2}"))
}

fn grade(grade: Option<Grade>) -> Value {
    grade.map_or_else(|| Value::String(PENDING.to_string()), |grade| number(grade.value))
}

fn stat(value: Option<f64>) -> Value {
    value.map_or_else(|| Value::String(PENDING.to_string()), number)
}

// An id as ScoDoc gives it: a number when it is one.
fn id(text: &str) -> Value {
    text.parse::<i64>().map_or_else(|_| Value::String(text.to_string()), Value::from)
}

// "12/84" or "4 ex/84": the place and how many were ranked; "5": the place.
fn rank(rank: Option<&str>) -> (Value, Value) {
    let Some(rank) = rank else { return (Value::String("-".to_string()), json!(0)) };
    match rank.rsplit_once('/') {
        Some((place, total)) => (Value::String(place.trim().to_string()), total.trim().parse::<u32>().map_or(json!(0), Value::from)),
        None => (Value::String(rank.to_string()), json!(0)),
    }
}

// { value, min, moy, max }, with ScoDoc's "~" where there is none.
fn scored(value: Value, stats: Option<GradeStats>) -> Map<String, Value> {
    let stats = stats.unwrap_or_default();
    let mut scored = Map::new();
    scored.insert("value".to_string(), value);
    scored.insert("min".to_string(), stat(stats.min));
    scored.insert("moy".to_string(), stat(stats.mean));
    scored.insert("max".to_string(), stat(stats.max));
    scored
}

// The day's midnight in the university's time, as ScoDoc dates an
// evaluation that has no hour.
fn midnight(day: NaiveDate, timezone: Tz) -> Option<String> {
    timezone.from_local_datetime(&day.and_time(NaiveTime::MIN)).earliest().map(|at| at.to_rfc3339())
}

fn evaluation(evaluation: &Evaluation, timezone: Tz) -> Value {
    let value = match (evaluation.grade, evaluation.status.as_deref()) {
        (Some(grade), _) => number(grade.value),
        (None, Some(PENDING_STATUS)) => Value::String(PENDING.to_string()),
        (None, Some(status)) => Value::String(status.to_string()),
        (None, None) => Value::String(String::new()),
    };
    // The hour when ScoDoc gave one, the day's midnight otherwise.
    let begins = evaluation.start.map(|start| start.to_rfc3339()).or_else(|| evaluation.date.and_then(|day| midnight(day, timezone)));
    let ends = evaluation.end.map(|end| end.to_rfc3339()).or_else(|| begins.clone());
    let kind = match evaluation.kind {
        EvaluationKind::Normal => 0,
        EvaluationKind::Resit => 1,
        EvaluationKind::SecondSession => 2,
        EvaluationKind::Bonus => 3,
    };
    json!({
        "id": id(&evaluation.id),
        "description": evaluation.name,
        "date_debut": begins,
        "date": begins,
        "date_fin": ends,
        "evaluation_type": kind,
        "coef": evaluation.coefficient.map(number),
        "note": scored(value, evaluation.stats),
        "poids": evaluation.weights,
    })
}

fn module(module: &ModuleGrades, timezone: Tz) -> Value {
    json!({
        "id": module.id.as_deref().map(id),
        "titre": module.name,
        // ScoDoc leaves a module's own average empty in a BUT.
        "moyenne": module.average.map_or_else(|| json!({}), |average| json!({ "value": number(average.value) })),
        "evaluations": module.evaluations.iter().map(|found| evaluation(found, timezone)).collect::<Vec<_>>(),
    })
}

// ScoDoc keeps a semester's modules in two lists; tonAPI says which is which.
fn is_sae(module: &ModuleGrades) -> bool {
    module.kind.as_deref() == Some("sae")
}

fn unit(unit: &UnitGrade, saes: &[&str]) -> Value {
    let (place, total) = rank(unit.rank.as_deref());
    let mut average = scored(grade(unit.average), unit.stats);
    // ScoDoc writes an unranked unit's place as an empty text.
    average.insert("rang".to_string(), if unit.rank.is_some() { place } else { Value::String(String::new()) });
    average.insert("total".to_string(), total);

    let link = |link: &tonapi_core::UnitModule| json!({ "coef": link.coefficient, "moyenne": grade(link.average) });
    let links = |sae: bool| -> Map<String, Value> {
        unit.modules.iter().filter(|link| saes.contains(&link.code.as_str()) == sae).map(|found| (found.code.clone(), link(found))).collect()
    };
    json!({
        "titre": unit.name,
        "color": unit.color,
        "moyenne": average,
        "bonus": number(unit.bonus.unwrap_or(0.0)),
        "malus": number(unit.malus.unwrap_or(0.0)),
        "capitalise": unit.capitalized.then_some(true),
        "ressources": links(false),
        "saes": links(true),
        "ECTS": { "acquis": unit.ects_earned, "total": unit.ects },
    })
}

fn semester_part(semester: &SemesterGrades) -> Value {
    let (place, total) = rank(semester.rank.as_deref());
    // How many were ranked is said even where the rank itself is hidden.
    let total = semester.ranked.map_or(total, Value::from);
    let group_ranks: Map<String, Value> = semester
        .group_ranks
        .iter()
        .map(|ranked| {
            // By the group's id, as ScoDoc keys them, when it is known.
            let key = semester.groups.iter().find(|group| group.name == ranked.group).and_then(|group| group.id.clone()).unwrap_or_else(|| ranked.group.clone());
            let (place, total) = rank(Some(&ranked.rank));
            (key, json!({ "value": place, "total": total, "group_name": ranked.group }))
        })
        .collect();
    let decision = |decision: &Option<tonapi_core::JuryDecision>| decision.as_ref().map(|decision| json!({ "code": decision.code, "date": decision.date.map(|date| date.to_string()) }));
    let unit_decisions: Vec<Value> =
        semester.units.iter().filter_map(|unit| Some(json!({ "acronyme": unit.code, "code": unit.decision.as_ref()? }))).collect();

    let mut part = Map::new();
    part.insert("numero".to_string(), json!(semester.number));
    part.insert("annee_universitaire".to_string(), json!(semester.year));
    part.insert("date_debut".to_string(), json!(semester.start.map(|date| date.to_string())));
    part.insert("date_fin".to_string(), json!(semester.end.map(|date| date.to_string())));
    part.insert(
        "groupes".to_string(),
        semester
            .groups
            .iter()
            .map(|group| json!({ "id": group.id.as_deref().map(id), "group_name": group.name, "partition": { "partition_name": group.partition } }))
            .collect(),
    );
    part.insert("notes".to_string(), Value::Object(scored(grade(semester.average), semester.stats)));
    part.insert("rang".to_string(), json!({ "value": place, "total": total, "groupes": group_ranks }));
    if semester.ects.is_some() || semester.ects_earned.is_some() {
        part.insert("ECTS".to_string(), json!({ "acquis": semester.ects_earned, "total": semester.ects }));
    }
    if let Some(decision) = decision(&semester.decision) {
        part.insert("decision".to_string(), decision);
    }
    if let Some(decision) = decision(&semester.year_decision) {
        part.insert("decision_annee".to_string(), decision);
    }
    if !unit_decisions.is_empty() {
        part.insert("decision_ue".to_string(), Value::Array(unit_decisions));
    }
    Value::Object(part)
}

// ScoDoc's « relevé », from one semester of tonAPI's report.
fn releve(semester: &SemesterGrades, timezone: Tz) -> Value {
    let saes: Vec<&str> = semester.modules.iter().filter(|module| is_sae(module)).map(|module| module.code.as_str()).collect();
    let modules = |sae: bool| -> Map<String, Value> { semester.modules.iter().filter(|found| is_sae(found) == sae).map(|found| (found.code.clone(), module(found, timezone))).collect() };
    let capitalised: Map<String, Value> = semester.units.iter().filter(|unit| unit.capitalized).map(|unit| (unit.code.clone(), json!(true))).collect();

    let mut releve = Map::new();
    if let Some(kind) = &semester.kind {
        releve.insert("type".to_string(), json!(kind));
    }
    if let Some(updated) = semester.updated_at {
        releve.insert("date".to_string(), json!(updated.to_rfc3339()));
    }
    // No `publie` at all is ScoDoc's answer for a department that hides its
    // grades: the page tells it from an unpublished report.
    if let Some(published) = semester.published {
        releve.insert("publie".to_string(), json!(published));
    }
    if let Some(notice) = &semester.notice {
        releve.insert("message".to_string(), json!(notice));
    }
    releve.insert("etudiant".to_string(), json!({ "dept_acronym": semester.department }));
    releve.insert("formation".to_string(), json!({ "acronyme": semester.program }));
    releve.insert("formsemestre_id".to_string(), id(&semester.id));
    // What the IUT hides isn't in tonAPI's report: the switch is read back
    // from what is there.
    releve.insert(
        "options".to_string(),
        json!({
            "show_rangs": semester.rank.is_some() || !semester.group_ranks.is_empty(),
            "show_ue_rangs": semester.units.iter().any(|unit| unit.rank.is_some()),
            "show_ects": semester.ects.is_some() || semester.units.iter().any(|unit| unit.ects_earned.is_some()),
            "show_abs": true,
        }),
    );
    releve.insert("appreciation".to_string(), json!([]));
    releve.insert("ressources".to_string(), Value::Object(modules(false)));
    releve.insert("saes".to_string(), Value::Object(modules(true)));
    releve.insert("ues_capitalisees".to_string(), Value::Object(capitalised));
    releve.insert("ues".to_string(), Value::Object(semester.units.iter().map(|found| (found.code.clone(), unit(found, &saes))).collect()));
    releve.insert("semestre".to_string(), semester_part(semester));
    Value::Object(releve)
}

// An hour of the day as ScoDoc counts it: 8.25 is a quarter past eight.
fn decimal_hour(at: DateTime<FixedOffset>) -> f64 {
    f64::from(at.hour()) + f64::from(at.minute()) / 60.0
}

fn absence(absence: &Absence, status: &str) -> Value {
    json!({
        "idAbs": id(&absence.id),
        "statut": status,
        "justifie": absence.justified,
        "debut": decimal_hour(absence.start),
        "fin": decimal_hour(absence.end),
        "dateFin": absence.end.date_naive().to_string(),
        "matiereComplet": absence.module_id.as_deref().map(id),
        "enseignant": absence.teacher,
    })
}

// ScoDoc's absences: by day, each with what it was (absent, late).
fn absences(report: &AbsenceReport) -> Value {
    let mut days: BTreeMap<String, Vec<(DateTime<FixedOffset>, Value)>> = BTreeMap::new();
    for (list, status) in [(&report.absences, "absent"), (&report.lates, "retard")] {
        for found in list {
            days.entry(found.start.date_naive().to_string()).or_default().push((found.start, absence(found, status)));
        }
    }
    let by_day: Map<String, Value> = days
        .into_iter()
        .map(|(day, mut entries)| {
            entries.sort_by_key(|(start, _)| *start);
            (day, entries.into_iter().map(|(_, entry)| entry).collect())
        })
        .collect();
    Value::Object(by_day)
}

// ScoDoc's « relevé » for a student without a semester, as the IUT's
// gateway gives it: nothing in it.
fn empty_releve() -> Value {
    json!({ "etudiant": { "dept_acronym": null }, "ressources": [], "saes": [] })
}

// What the IUT's gateway is set up for, as far as the page reads it.
// `semester`: the report's, when the student has one.
fn config(semester: Option<&SemesterGrades>, report: &AbsenceReport) -> Value {
    json!({
        "releve_PDF": semester.is_some_and(|semester| semester.transcript == Some(true)),
        "liste_dep_publi_PDF": "",
        "afficher_absences": report.visible == Some(true),
        "liste_dep_publi_absences": "",
        "metrique_absences": report.unit,
        "message_rapport_absences": report.notice,
    })
}

// `current`: the first-connection answer (GET /grades), with the student's
// semesters and the gateway's settings; otherwise one semester's
// (GET /grades/semester/<id>).
pub fn translate(asked: Result<&(GradeReport, AbsenceReport), Unanswered>, current: bool, timezone: Tz) -> Translated {
    let (grades, absent) = match asked {
        Ok(report) => report,
        Err(why) => return unanswered(why),
    };
    // None for a student without a semester: ScoDoc's own empty answer.
    let semester = grades.semesters.first();

    let mut payload = Map::new();
    if current {
        payload.insert("config".to_string(), config(semester, absent));
        payload.insert(
            "semestres".to_string(),
            grades
                .available
                .iter()
                .map(|listed| json!({ "titre": listed.name, "formsemestre_id": id(&listed.id), "semestre_id": listed.number, "annee_scolaire": listed.year }))
                .collect(),
        );
    }
    payload.insert("relevé".to_string(), semester.map_or_else(empty_releve, |semester| releve(semester, timezone)));
    payload.insert("absences".to_string(), absences(absent));
    if let Some(totals) = &absent.unit_totals {
        payload.insert("totauxAbsences".to_string(), json!({ "absent": { "justifie": totals.justified, "non_justifie": totals.unjustified } }));
    }
    json_answer(&json!({ "authenticated": true, "sessionMode": null, "grades": payload }))
}

// The current semester's id in an answer made above: the evaluation's
// distribution is asked for by « current ».
pub(crate) fn semester_of(answer: &[u8]) -> Option<String> {
    let answer: Value = serde_json::from_slice(answer).ok()?;
    match answer.get("grades")?.get("relevé")?.get("formsemestre_id")? {
        Value::Number(id) => Some(id.to_string()),
        Value::String(id) => Some(id.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use tonapi_core::{AbsenceTotals, ErrorCode};

    use super::super::super::Failure;
    use super::*;

    fn no_absences() -> AbsenceReport {
        AbsenceReport {
            absences: Vec::new(),
            totals: AbsenceTotals { justified: 0, unjustified: 0 },
            lates: Vec::new(),
            visible: None,
            unit: None,
            unit_totals: None,
            notice: None,
        }
    }

    #[test]
    fn a_student_without_a_semester_gets_scodocs_empty_report() {
        let report = (GradeReport::default(), no_absences());
        let Translated::Answer(response) = translate(Ok(&report), true, chrono_tz::Europe::Paris) else { panic!("an answer") };
        let answer: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!((response.status(), &answer["authenticated"]), (http::StatusCode::OK, &true.into()));
        let grades = &answer["grades"];
        assert_eq!(grades["semestres"], json!([]));
        assert_eq!(grades["relevé"], json!({ "etudiant": { "dept_acronym": null }, "ressources": [], "saes": [] }));
        assert_eq!((&grades["config"]["releve_PDF"], &grades["absences"]), (&false.into(), &json!({})));
        // No semester to ask a distribution of.
        assert_eq!(semester_of(response.body()), None);
    }

    #[test]
    fn no_report_is_the_routes_error_or_the_cas_to_ask() {
        let failed = |why| translate(Err(why), false, chrono_tz::Europe::Paris);
        // A semester ScoDoc has no report for, a component without ScoDoc.
        for code in [ErrorCode::NotFound, ErrorCode::ServiceAbsent, ErrorCode::UpstreamChanged] {
            let Translated::Failed(failure) = failed(Unanswered::Problem(code)) else { panic!("{code}") };
            assert_eq!(failure, Failure::Unavailable(code.as_str().to_string()));
        }
        assert!(matches!(failed(Unanswered::Problem(ErrorCode::SessionExpired)), Translated::Lost));
    }
}
