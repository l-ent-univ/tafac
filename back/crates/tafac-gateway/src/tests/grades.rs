// The grades' routes on the made-up campus: tonAPI signs in to the IUT's
// ScoDoc gateway with the CAS ticket, and its report goes to the page in
// ScoDoc's own shape. What the routes refuse is refused in Node's words.

use super::{ask, asked, error_of, never, unavailable, GET, NO_HEADERS};
use crate::testing::*;
use crate::ANSWERED_BY;

const GRADES: &str = "/__ent_auth/grades";
const SIGN_IN: &str = "/scodoc/services/doAuth.php";
const DATA: &str = "/scodoc/services/data.php";
const PDF: &str = "/scodoc/services/bulletin_PDF.php";

#[test]
fn the_report_is_scodocs_as_the_page_reads_it() {
    let campus = campus();
    let gateway = campus.gateway();
    let answer = ask(&gateway, GRADES, &campus.alive()).unwrap();
    assert_eq!((&answer["authenticated"], &answer["sessionMode"]), (&true.into(), &serde_json::Value::Null));
    let grades = &answer["grades"];

    // What only comes with the first connection: the student's semesters,
    // and what the gateway is set up for.
    let semesters: Vec<_> = grades["semestres"].as_array().unwrap().iter().map(|listed| (listed["formsemestre_id"].as_i64().unwrap(), listed["semestre_id"].as_i64().unwrap())).collect();
    assert_eq!(semesters, [(890, 2), (901, 3)]);
    assert_eq!(grades["config"]["releve_PDF"], true);
    assert_eq!((&grades["config"]["afficher_absences"], &grades["config"]["metrique_absences"]), (&true.into(), &"demi".into()));
    assert_eq!(grades["config"]["message_rapport_absences"], "Justifier sous 48 heures.");

    // The report, under ScoDoc's names and in ScoDoc's forms.
    let report = &grades["relevé"];
    assert_eq!((&report["formsemestre_id"], &report["type"], &report["publie"]), (&901.into(), &"BUT".into(), &true.into()));
    assert_eq!(report["etudiant"], serde_json::json!({ "dept_acronym": "DEMO" }));
    let module = &report["ressources"]["R1.01"];
    assert_eq!((&module["id"], &module["titre"], &module["moyenne"]), (&5101.into(), &"Développement web".into(), &serde_json::json!({})));
    assert_eq!(
        module["evaluations"][0],
        serde_json::json!({
            "id": 7301, "description": "Contrôle 7301", "evaluation_type": 0, "coef": "01.00",
            "date_debut": "2026-09-11T00:00:00+02:00", "date": "2026-09-11T00:00:00+02:00", "date_fin": "2026-09-11T00:00:00+02:00",
            "note": { "value": "12.50", "min": "04.00", "moy": "11.20", "max": "19.00" },
            "poids": { "UE1.1": 1.0 },
        })
    );
    assert_eq!(module["evaluations"][1]["note"]["value"], "~");
    assert_eq!(report["saes"]["SAÉ 1.01"]["moyenne"], serde_json::json!({ "value": "15.00" }));
    let unit = &report["ues"]["UE1.1"];
    assert_eq!(unit["moyenne"], serde_json::json!({ "value": "12.50", "min": "05.00", "moy": "11.00", "max": "17.00", "rang": "4", "total": 56 }));
    assert_eq!((&unit["color"], &unit["capitalise"], &unit["bonus"]), (&"#6125C1".into(), &serde_json::Value::Null, &"00.00".into()));
    assert_eq!(unit["ressources"]["R1.01"], serde_json::json!({ "coef": 3.0, "moyenne": "12.50" }));
    assert_eq!(unit["saes"]["SAÉ 1.01"], serde_json::json!({ "coef": 8.0, "moyenne": "15.00" }));
    assert_eq!(unit["ECTS"], serde_json::json!({ "acquis": 0.0, "total": 5.0 }));
    let semester = &report["semestre"];
    assert_eq!(semester["notes"], serde_json::json!({ "value": "13.96", "min": "08.00", "moy": "12.00", "max": "16.50" }));
    assert_eq!(semester["rang"], serde_json::json!({ "value": "12", "total": 56, "groupes": { "61": { "value": "3", "total": 28, "group_name": "TD B" } } }));
    assert_eq!(semester["groupes"], serde_json::json!([{ "id": 61, "group_name": "TD B", "partition": { "partition_name": "TD" } }]));
    assert_eq!(report["options"], serde_json::json!({ "show_rangs": true, "show_ue_rangs": true, "show_ects": true, "show_abs": true }));

    // The absences of the same answer: by day, the late arrival too.
    let day = grades["absences"]["2026-10-05"].as_array().unwrap();
    assert_eq!(
        day[0],
        serde_json::json!({
            "idAbs": 79015, "statut": "absent", "justifie": false, "debut": 8.0, "fin": 10.0, "dateFin": "2026-10-05",
            "matiereComplet": 5101, "enseignant": "prof@exemple.test",
        })
    );
    assert_eq!((&day[1]["statut"], &day[1]["debut"], &day[1]["justifie"]), (&"retard".into(), &10.25.into(), &true.into()));
    assert_eq!(grades["totauxAbsences"], serde_json::json!({ "absent": { "justifie": { "demi": 1.0 }, "non_justifie": { "demi": 2.0 } } }));

    // Nothing of the student but the department.
    let written = answer.to_string();
    for personal in ["Jeanne", "Doe", "21901234"] {
        assert!(!written.contains(personal), "{personal}");
    }
    // tonAPI was handed the CAS ticket, and nothing of the portal's session.
    let seen = campus.seen.lock().unwrap().clone();
    assert!(seen.iter().any(|(path, cookies)| path.starts_with("/cas/login") && cookies.contains("TGC=the-ticket")));
    assert!(seen.iter().all(|(_, cookies)| !cookies.contains("JSESSIONID")));
    assert_eq!((campus.asked(SIGN_IN), campus.asked(DATA)), (2, 1));
}

#[test]
fn the_report_is_kept_and_scodocs_session_with_it() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let first = ask(&gateway, GRADES, &cookie).unwrap();
    assert_eq!(ask(&gateway, GRADES, &cookie).unwrap(), first);
    assert_eq!(campus.asked(DATA), 1);

    // Another semester: asked with the session ScoDoc gave, no sign-in.
    let other = ask(&gateway, "/__ent_auth/grades/semester/890", &cookie).unwrap();
    assert_eq!(other["grades"]["relevé"]["formsemestre_id"], 890);
    // Neither the semesters nor the settings come with it, as from ScoDoc.
    assert!(other["grades"].get("semestres").is_none() && other["grades"].get("config").is_none());
    assert_eq!(other["grades"]["absences"], serde_json::json!({}));
    assert_eq!((campus.asked(SIGN_IN), campus.asked(DATA)), (2, 2));
    assert_eq!(ask(&gateway, "/__ent_auth/grades/semester/890", &cookie).unwrap(), other);
    assert_eq!(campus.asked(DATA), 2);
}

#[test]
fn what_node_refuses_is_refused_here_in_its_words() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    // Ids that aren't ids: Node's own 400, on any server, nothing asked.
    for (path, said) in [
        ("/__ent_auth/grades/semester/abc", "Invalid semester id."),
        ("/__ent_auth/grades/semester/12345678901", "Invalid semester id."),
        ("/__ent_auth/grades/department-message", "Invalid department."),
        ("/__ent_auth/grades/department-message?dep=a%20b", "Invalid department."),
        ("/__ent_auth/grades/evaluation-distribution?semestre=901", "Invalid semester or evaluation id."),
        ("/__ent_auth/grades/evaluation-distribution?semestre=x&eval=7301", "Invalid semester or evaluation id."),
        ("/__ent_auth/grades/evaluation-distribution?semestre=current&eval=abc", "Invalid semester or evaluation id."),
        ("/__ent_auth/grades/report.pdf", "Invalid semester id."),
        ("/__ent_auth/grades/report.pdf?semestre=current", "Invalid semester id."),
    ] {
        assert_eq!(error_of(&gateway, path, &cookie), (400, serde_json::json!({ "error": said })), "{path}");
    }
    // A path Node's own route doesn't read an id from is no route of the
    // page's: Node's, as any other.
    for path in ["/__ent_auth/grades/semester/12/34x", "/__ent_auth/grades/semester/12/34", "/__ent_auth/grades/semester/"] {
        assert!(block_on(gateway.answer(&asked(&GET, path, &NO_HEADERS, &[]), || Some(cookie.clone()), never)).is_none(), "{path}");
    }
    assert!(campus.seen.lock().unwrap().is_empty());
}

#[test]
fn what_scodoc_doesnt_have_is_said_as_node_says_it() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    // A semester ScoDoc has no report for: the route's error.
    assert_eq!(error_of(&gateway, "/__ent_auth/grades/semester/123", &cookie), unavailable());
    // An error isn't kept: ScoDoc is asked again the next time.
    let asked_before = campus.asked(DATA);
    assert_eq!(error_of(&gateway, "/__ent_auth/grades/semester/123", &cookie), unavailable());
    assert!(campus.asked(DATA) > asked_before);
    // The session lives, and the report it does have is given.
    assert!(ask(&gateway, GRADES, &cookie).is_some());
}

#[test]
fn a_departments_notice_is_its_text() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let answer = ask(&gateway, "/__ent_auth/grades/department-message?dep=DEMO", &cookie).unwrap();
    assert_eq!(answer, serde_json::json!({ "authenticated": true, "message": "Jury le 12 février.\nSalle A." }));
    ask(&gateway, "/__ent_auth/grades/department-message?dep=DEMO", &cookie).unwrap();
    assert_eq!(campus.asked(DATA), 1);
}

#[test]
fn a_distribution_is_for_an_evaluation_of_the_students_own_report() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    // « current »: the semester of the report, read (and kept) first.
    let answer = ask(&gateway, "/__ent_auth/grades/evaluation-distribution?semestre=current&eval=7301", &cookie).unwrap();
    assert_eq!((&answer["authenticated"], &answer["status"], &answer["bins"], &answer["total"]), (&true.into(), &"ok".into(), &"integer".into(), &9.into()));
    let counts = answer["counts"].as_array().unwrap();
    assert_eq!(counts.len(), 21);
    assert_eq!((&counts[9], &counts[20]), (&2.into(), &1.into()));
    // The report, then tonAPI's own reading of the semester, then the grades.
    assert_eq!(campus.asked(DATA), 3);

    // By its id, and again: the first is asked, the second kept.
    let by_id = ask(&gateway, "/__ent_auth/grades/evaluation-distribution?semestre=901&eval=7301", &cookie).unwrap();
    assert_eq!(by_id, answer);
    ask(&gateway, "/__ent_auth/grades/evaluation-distribution?semestre=901&eval=7301", &cookie).unwrap();
    assert_eq!(campus.asked(DATA), 5);
    // The report the page asks for next is the one already read.
    ask(&gateway, GRADES, &cookie).unwrap();
    assert_eq!(campus.asked(DATA), 5);

    // An evaluation that isn't in the student's report: Node's 404, which
    // the page reads as « no such evaluation ».
    let unknown = error_of(&gateway, "/__ent_auth/grades/evaluation-distribution?semestre=901&eval=9999", &cookie);
    assert_eq!(unknown, (404, serde_json::json!({ "error": "Unknown evaluation." })));
}

#[test]
fn the_pdf_is_the_gateways_file() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let request = asked(&GET, "/__ent_auth/grades/report.pdf?semestre=901&type=BUT", &NO_HEADERS, &[]);
    let response = block_on(gateway.answer(&request, || Some(cookie.clone()), never)).unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-type"], "application/pdf");
    assert_eq!(response.headers()["content-disposition"], "inline; filename=\"releve-901.pdf\"");
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    assert_eq!(response.headers()[ANSWERED_BY], "tonapi");
    assert!(response.body().starts_with(b"%PDF"));
    // For the student of the session, whose id never comes from the page.
    let asked = campus.seen.lock().unwrap().iter().find(|(path, _)| path.starts_with(PDF)).cloned().unwrap();
    assert!(asked.0.contains("etudiant=21901234") && asked.0.contains("sem_id=901") && asked.0.contains("type=BUT"));
}

#[test]
fn every_grades_question_of_a_session_signs_in_once() {
    let campus = campus();
    let gateway = campus.gateway();
    let cookie = campus.alive();
    let one = |target: &'static str| async {
        let request = asked(&GET, target, &NO_HEADERS, &[]);
        gateway.answer(&request, || Some(cookie.clone()), never).await
    };
    let (report, notice, other) = block_on(async { tokio::join!(one(GRADES), one("/__ent_auth/grades/department-message?dep=DEMO"), one("/__ent_auth/grades/semester/890")) });
    assert!(report.is_some() && notice.is_some() && other.is_some());
    assert_eq!(campus.asked(SIGN_IN), 2);
}
