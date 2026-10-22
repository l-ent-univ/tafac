// Demo ScoDoc data for the demo account, shaped like the notes9 passerelle
// answers (ScoDoc 9 BUT bulletin): a BUT MMI history from S1 to S5, parcours
// "Développement web et dispositifs interactifs", spread so every case of
// "Mes notes" shows somewhere (see the comment above each semester).
//
// Only the evaluations, coefficients, promo stats and ranks are written by
// hand: the module, UE and semester averages are computed from them the way
// ScoDoc does (see computeDemoAverages), so the relevés stay consistent.
// Evaluation notes are on /20 and note.min/moy/max are promo stats; module
// averages are left empty, as ScoDoc does for BUT. Values are strings where
// ScoDoc sends strings ("14.50").

import { buildDistribution, createSeededRandom, generateDemoGrades } from './evaluationDistribution.js'

const DEMO_GRADES_SEMESTERS = Object.freeze([
  { formsemestre_id: 9101, titre: 'BUT MMI', annee_scolaire: '2024/2025', semestre_id: 1 },
  { formsemestre_id: 9102, titre: 'BUT MMI', annee_scolaire: '2024/2025', semestre_id: 2 },
  { formsemestre_id: 9103, titre: 'BUT MMI', annee_scolaire: '2025/2026', semestre_id: 3 },
  { formsemestre_id: 9104, titre: 'BUT MMI', annee_scolaire: '2025/2026', semestre_id: 4 },
  { formsemestre_id: 9105, titre: 'BUT MMI', annee_scolaire: '2026/2027', semestre_id: 5 },
])

// Long enough to fold behind "Lire la suite" on a phone.
export const DEMO_GRADES_DEPARTMENT_MESSAGE = '<p>Les jurys du semestre 5 auront lieu le <b>28 janvier</b>.<br>Pensez à vérifier vos notes et à signaler toute erreur à votre enseignant avant le 20 janvier.</p><p>Les rattrapages se dérouleront la semaine du 12 janvier : la convocation vous sera envoyée par mail. Toute absence à un rattrapage doit être justifiée auprès du secrétariat dans les 48 heures.</p>'

// The five MMI competences, one per UE, each with the colour the department
// gives it in every semester.
const DEMO_COMPETENCES = Object.freeze({
  comprendre: { titre: 'Comprendre les écosystèmes numériques', color: '#b80004' },
  concevoir: { titre: 'Concevoir une réponse stratégique', color: '#f97b3d' },
  exprimer: { titre: 'Exprimer un message', color: '#feb40b' },
  developper: { titre: 'Développer pour le web', color: '#80cb3f' },
  entreprendre: { titre: 'Entreprendre dans le numérique', color: '#05162e' },
})

const DEMO_FORMATION = Object.freeze({
  acronyme: 'BUT MMI',
  titre: "BUT Métiers du Multimédia et de l'Internet",
  titre_officiel: "Bachelor Universitaire de Technologie Métiers du Multimédia et de l'Internet",
})

// Everything shown: the demo is there to see every part of the page.
const DEMO_OPTIONS = Object.freeze({
  show_abs: true,
  show_ects: true,
  show_minmax: true,
  show_moypromo: true,
  show_rangs: true,
  show_ue_rangs: true,
})

const DEMO_GRADES_CONFIG = Object.freeze({
  releve_PDF: false,
  afficher_absences: true,
  liste_dep_publi_absences: '',
  metrique_absences: 'heure',
  message_rapport_absences: "Les causes de l’absence doivent être notifiées par écrit à l'aide d'un justificatif dans les 48 heures à compter du début de l’absence au secrétariat du département.",
  liste_dep_affichage_appreciations: 'MMI',
  autoriser_justificatifs: false,
  // Fictive: lets the "Justifier" button show in the demo.
  absence_secretariat: 'secretariat@exemple.fr',
})

const EVALUATION_NORMAL = 0
const EVALUATION_RATTRAPAGE = 1
const EVALUATION_SESSION2 = 2

// One evaluation: `stats` are the promo's [min, moy, max]. `poids` defaults
// to 1 toward every UE of its module (see module()); `time`, its slot.
function evaluation(id, date, description, value, [min, moy, max] = ['', '', ''], { coef = '1.00', type = EVALUATION_NORMAL, poids = null, time = ['08:15', '10:15'] } = {}) {
  return { id, date, description, value, min, moy, max, coef, type, poids, time }
}

// One ressource or SAÉ: its coefficient in each UE it feeds.
function module(code, id, titre, coefs, evaluations = []) {
  return { code, id, titre, coefs, evaluations }
}

function buildEvaluation(spec, moduleCoefs) {
  return {
    id: spec.id,
    description: spec.description,
    date: spec.date,
    date_debut: `${spec.date}T${spec.time[0]}:00`,
    date_fin: `${spec.date}T${spec.time[1]}:00`,
    coef: spec.type === EVALUATION_NORMAL ? spec.coef : null,
    evaluation_type: spec.type,
    poids: spec.poids ?? Object.fromEntries(Object.keys(moduleCoefs).map((ue) => [ue, 1])),
    note: { value: spec.value, min: spec.min, moy: spec.moy, max: spec.max },
    url: '',
  }
}

function readNote(value) {
  if (value === 'ABS') return 0
  const number = Number(value)
  return value !== '' && Number.isFinite(number) ? number : null
}

const formatNote = (value) => (value == null ? '~' : value.toFixed(2))
const clampNote = (value) => Math.min(20, Math.max(0, value))

// A module's average in one UE, ScoDoc's BUT rule: its normal evaluations
// weighted by coef × weight toward the UE (an unjustified absence counts 0,
// excused and pending ones don't count); a rattrapage replaces it when
// better, a session 2 grade replaces it. (The demo's modules have at most
// one of either, weighing toward every UE of the module.)
function computeModuleUeAverage(evaluations, ueCode) {
  let weighted = 0
  let weightSum = 0
  let average = null

  for (const entry of evaluations) {
    const note = readNote(entry.note.value)
    const weight = Number(entry.poids[ueCode] ?? 0)
    if (entry.evaluation_type !== EVALUATION_NORMAL || note == null || !weight) continue
    weighted += note * Number(entry.coef) * weight
    weightSum += Number(entry.coef) * weight
  }
  if (weightSum > 0) average = weighted / weightSum

  for (const entry of evaluations) {
    const note = readNote(entry.note.value)
    if (note == null || !entry.poids[ueCode]) continue
    if (entry.evaluation_type === EVALUATION_RATTRAPAGE && average != null && note > average) average = note
    if (entry.evaluation_type === EVALUATION_SESSION2) average = note
  }

  return average
}

// Module → UE averages, UE averages (coefficient-weighted, then bonus and
// malus; a capitalised UE keeps its earlier average when better) and the
// semester's (UEs weighted by ECTS), as ScoDoc computes them.
function computeDemoAverages(ueSpecs, modules) {
  const ues = {}
  for (const ue of ueSpecs) {
    const links = { ressources: {}, saes: {} }
    let weighted = 0
    let coefSum = 0

    for (const entry of modules) {
      const coef = entry.coefs[ue.code]
      if (!coef) continue
      const average = computeModuleUeAverage(entry.evaluations, ue.code)
      links[entry.section][entry.code] = { id: entry.id, coef, moyenne: formatNote(average) }
      if (average == null) continue
      weighted += average * coef
      coefSum += coef
    }

    let average = coefSum > 0 ? clampNote(weighted / coefSum + (ue.bonus ?? 0) - (ue.malus ?? 0)) : null
    if (ue.capitalise) average = Math.max(average ?? 0, ue.capitalise.moyenne)
    ues[ue.code] = { links, average }
  }

  let weighted = 0
  let ectsSum = 0
  for (const ue of ueSpecs) {
    const { average } = ues[ue.code]
    if (average == null) continue
    weighted += Number(formatNote(average)) * ue.ects
    ectsSum += ue.ects
  }

  return { ues, semester: ectsSum > 0 ? weighted / ectsSum : null }
}

function buildDemoStudent() {
  return {
    prenom: 'Camille',
    nom: 'MARTIN',
    civilite: 'X',
    dept_acronym: 'MMI',
    photo_url: '/ScoDoc/MMI/api/etudiant/photo',
  }
}

const formatPoints = (value) => (value ? value.toFixed(2) : null)

// A whole relevé from one semester's spec (see the S1…S5 specs below).
function buildDemoReleve(spec) {
  const modules = spec.modules.map((entry) => ({
    ...entry,
    section: entry.code.startsWith('SAÉ') ? 'saes' : 'ressources',
    evaluations: entry.evaluations.map((item) => buildEvaluation(item, entry.coefs)),
  }))
  const averages = computeDemoAverages(spec.ues, modules)
  const section = (key) => Object.fromEntries(modules
    .filter((entry) => entry.section === key)
    .map((entry) => [entry.code, { id: entry.id, titre: entry.titre, moyenne: {}, evaluations: entry.evaluations }]))

  const ues = Object.fromEntries(spec.ues.map((ue, index) => {
    const competence = DEMO_COMPETENCES[ue.competence]
    const { links, average } = averages.ues[ue.code]
    return [ue.code, {
      id: ue.id,
      titre: competence.titre,
      numero: index + 1,
      type: 0,
      color: competence.color,
      competence: null,
      moyenne: { value: formatNote(average), min: ue.stats[0], max: ue.stats[2], moy: ue.stats[1], rang: ue.rang, total: spec.effectif },
      bonus: formatPoints(ue.bonus),
      malus: formatPoints(ue.malus),
      capitalise: ue.capitalise?.date ?? null,
      ressources: links.ressources,
      saes: links.saes,
      // Before the jury, nothing is awarded yet.
      ECTS: { acquis: spec.finished && ue.validated !== false ? ue.ects : 0, total: ue.ects },
    }]
  }))
  // After the jury, its code for each UE (codes_cursus.py): ADM from 10/20,
  // CMP under 10 when compensated, AJ when not validated. A capitalised UE
  // keeps its earlier validation and gets no code here.
  const decisionUe = spec.finished
    ? spec.ues.filter((ue) => !ue.capitalise).map((ue) => {
        const average = averages.ues[ue.code].average
        const code = ue.validated === false ? 'AJ' : Number(formatNote(average)) >= 10 ? 'ADM' : 'CMP'
        return { ue_id: ue.id, acronyme: ue.code, titre: DEMO_COMPETENCES[ue.competence].titre, code, ects: ue.ects }
      })
    : null
  const ectsTotal = spec.ues.reduce((sum, ue) => sum + ue.ects, 0)
  const ectsEarned = Object.values(ues).reduce((sum, ue) => sum + ue.ECTS.acquis, 0)
  const [min, moy, max] = spec.stats

  return {
    version: '0',
    type: 'BUT',
    date: spec.date,
    publie: true,
    etat_inscription: 'I',
    etudiant: buildDemoStudent(),
    formation: DEMO_FORMATION,
    formsemestre_id: spec.id,
    options: DEMO_OPTIONS,
    ressources: section('ressources'),
    saes: section('saes'),
    ues,
    semestre: {
      numero: spec.numero,
      annee_universitaire: spec.year,
      date_debut: spec.start,
      date_fin: spec.end,
      inscription: '',
      groupes: spec.groups,
      notes: { value: formatNote(averages.semester), min, moy, max },
      // Group ranks are keyed by group id, as ScoDoc does.
      rang: { value: spec.rang, total: spec.effectif, groupes: spec.groupRanks },
      ECTS: { acquis: ectsEarned, total: ectsTotal },
      absences: spec.absenceSummary,
      ...(spec.decision ? { decision: spec.decision, decision_annee: spec.decisionAnnee } : null),
      ...(decisionUe ? { decision_ue: decisionUe } : null),
    },
    appreciation: spec.appreciation ?? [],
  }
}

function group(id, name, partition) {
  return { id, group_name: name, partition: { partition_name: partition } }
}

const BUT1_GROUPS = [group(4111, 'TD A', 'TD'), group(4112, 'TP 2', 'TP')]
const BUT23_GROUPS = [group(5121, 'TD B', 'TD'), group(5123, 'TP 3', 'TP'), group(5130, 'DWeb-DI', 'Parcours')]

// S1, BUT1: five UEs (3 + 2 tiles). UE1.3 ends under 10 (warning icon) and
// is validated by compensation with UE2.3 (jury code CMP on the semester).
// An unjustified absence on an evaluation (ABS, counts 0) and a rattrapage
// that replaces a weak module average. R1.03 counts in three UEs.
const S1 = {
  id: 9101,
  numero: 1,
  year: '2024/2025',
  start: '2024-09-02',
  end: '2025-01-19',
  date: '2025-07-04T09:30:00Z',
  finished: true,
  effectif: 92,
  groups: BUT1_GROUPS,
  stats: ['5.82', '11.64', '16.90'],
  rang: '31',
  groupRanks: { 4111: { value: '14', total: 46 }, 4112: { value: '7', total: 23 } },
  absenceSummary: { injustifie: 4, total: 8, metrique: 'H.' },
  decision: { code: 'CMP', etat: 'I', date: '2025-02-06T14:00:00+01:00' },
  decisionAnnee: { annee_scolaire: 2024, date: '2025-07-03T12:00:00+02:00', code: 'ADM', ordre: 1 },
  appreciation: [{ comment: 'Bon début de BUT. L’expression écrite et orale reste à travailler : le semestre 2 doit permettre de valider l’UE 3 par compensation.' }],
  ues: [
    { code: 'UE1.1', id: 1001, competence: 'comprendre', ects: 6, stats: ['5.10', '11.70', '17.20'], rang: '24' },
    { code: 'UE1.2', id: 1002, competence: 'concevoir', ects: 6, stats: ['4.80', '11.50', '17.60'], rang: '29' },
    // Under 10: validated by compensation with UE2.3, so its ECTS are awarded.
    { code: 'UE1.3', id: 1003, competence: 'exprimer', ects: 6, stats: ['4.20', '11.10', '16.80'], rang: '71' },
    { code: 'UE1.4', id: 1004, competence: 'developper', ects: 6, stats: ['3.90', '11.30', '18.10'], rang: '9' },
    { code: 'UE1.5', id: 1005, competence: 'entreprendre', ects: 6, stats: ['5.60', '11.80', '16.90'], rang: '27' },
  ],
  modules: [
    module('R1.01', 11001, 'Anglais', { 'UE1.1': 2, 'UE1.3': 2 }, [
      evaluation(30101, '2024-09-26', 'Compréhension orale', '13.50', ['5.00', '11.20', '18.00']),
      evaluation(30102, '2024-11-21', 'Présentation orale', '12.00', ['4.50', '11.60', '17.50'], { coef: '2.00' }),
    ]),
    module('R1.02', 11002, 'Culture numérique', { 'UE1.1': 3, 'UE1.2': 1 }, [
      evaluation(30103, '2024-10-03', 'QCM histoire du web', '15.25', ['6.50', '12.40', '19.00']),
      evaluation(30104, '2024-12-12', 'Dossier de veille', '13.00', ['5.00', '12.10', '17.50'], { coef: '2.00' }),
    ]),
    module('R1.03', 11003, 'Stratégies de communication', { 'UE1.1': 2, 'UE1.2': 3, 'UE1.5': 1 }, [
      evaluation(30105, '2024-10-17', 'Analyse de campagne', '11.50', ['3.00', '10.90', '17.00']),
      // Weighs half as much toward UE1.5 as toward the two others.
      evaluation(30106, '2025-01-09', 'Partiel', '12.75', ['4.25', '11.30', '18.25'], { coef: '2.00', poids: { 'UE1.1': 1, 'UE1.2': 1, 'UE1.5': 0.5 } }),
    ]),
    module('R1.04', 11004, 'Expression, communication et rhétorique', { 'UE1.3': 3 }, [
      evaluation(30107, '2024-10-10', 'Commentaire de texte', '6.50', ['3.00', '10.40', '16.00']),
      evaluation(30108, '2024-12-05', 'Exposé argumentatif', '7.00', ['4.00', '11.00', '16.50']),
      // Better than the module's 6.75: replaces it.
      evaluation(30109, '2025-01-14', 'Commentaire de texte', '8.50', ['5.00', '8.80', '12.00'], { type: EVALUATION_RATTRAPAGE }),
    ]),
    module('R1.05', 11005, 'Écriture multimédia et narration', { 'UE1.3': 2 }, [
      // Unjustified absence that day (see the absences): counts 0.
      evaluation(30110, '2024-11-14', 'Écriture de scénario', 'ABS', ['5.50', '12.20', '17.00']),
      evaluation(30111, '2024-12-19', 'Storyboard', '11.00', ['6.00', '12.50', '18.00'], { coef: '2.00' }),
    ]),
    module('R1.06', 11006, 'Production graphique', { 'UE1.3': 2, 'UE1.4': 1 }, [
      evaluation(30112, '2024-10-24', 'Affiche typographique', '8.00', ['4.00', '11.80', '17.50']),
      evaluation(30113, '2024-12-17', 'Charte graphique', '10.50', ['5.50', '12.00', '18.50'], { coef: '2.00' }),
    ]),
    module('R1.08', 11008, 'Production audio et vidéo', { 'UE1.3': 2 }, [
      evaluation(30114, '2024-11-28', 'Montage vidéo', '7.00', ['3.50', '11.40', '17.00']),
    ]),
    module('R1.10', 11010, 'Développement web', { 'UE1.4': 3 }, [
      evaluation(30115, '2024-09-30', 'TP HTML et CSS', '16.00', ['7.00', '13.20', '20.00']),
      evaluation(30116, '2024-11-25', 'Contrôle JavaScript', '14.50', ['2.50', '10.80', '19.50'], { coef: '2.00' }),
    ]),
    module('R1.12', 11012, 'Intégration', { 'UE1.4': 2 }, [
      evaluation(30117, '2024-12-02', 'Maquette responsive', '15.00', ['6.00', '12.60', '19.00']),
    ]),
    module('R1.14', 11014, 'Économie et droit du numérique', { 'UE1.5': 2 }, [
      evaluation(30118, '2024-11-07', 'Étude de cas RGPD', '12.50', ['5.00', '11.90', '17.00']),
      evaluation(30119, '2025-01-08', 'Partiel', '11.25', ['4.00', '10.20', '16.75'], { coef: '2.00' }),
    ]),
    module('R1.15', 11015, 'Gestion de projet', { 'UE1.2': 1, 'UE1.5': 2 }, [
      evaluation(30120, '2024-10-21', 'Rétroplanning', '14.00', ['8.00', '12.90', '18.00']),
    ]),
    module('SAÉ 1.01', 12001, 'Audit de communication numérique', { 'UE1.1': 4, 'UE1.2': 4 }, [
      evaluation(30121, '2024-11-04', 'Rapport d’audit', '13.00', ['7.00', '12.30', '17.00'], { coef: '2.00' }),
      evaluation(30122, '2024-11-18', 'Soutenance', '14.50', ['8.50', '12.80', '18.00']),
    ]),
    module('SAÉ 1.02', 12002, 'Production audiovisuelle', { 'UE1.3': 4 }, [
      evaluation(30123, '2025-01-10', 'Clip de présentation', '8.00', ['5.00', '12.10', '17.50'], { coef: '2.00' }),
    ]),
    module('SAÉ 1.03', 12003, 'Création d’un site web', { 'UE1.4': 4, 'UE1.5': 3 }, [
      evaluation(30124, '2025-01-13', 'Site vitrine', '15.50', ['7.50', '12.70', '18.50'], { coef: '2.00' }),
      // Only for UE1.5: the project's management, not its code.
      evaluation(30125, '2025-01-16', 'Dossier de gestion de projet', '12.00', ['6.00', '11.50', '16.50'], { poids: { 'UE1.5': 1 } }),
    ]),
  ],
}

// S2, BUT1: UE2.3 at ~12 makes up for UE1.3 (year average ≥ 10). A bonus on
// UE2.1, a malus on UE2.4 (unjustified absences), an excused evaluation
// (EXC, a justified absence that day), an ex aequo UE rank. UE2.5 is
// capitalised: validated in an earlier cursus, ScoDoc keeps that better
// average over this semester's. SAÉ 2.02 counts in three UEs.
const S2 = {
  id: 9102,
  numero: 2,
  year: '2024/2025',
  start: '2025-01-20',
  end: '2025-06-27',
  date: '2025-07-04T09:30:00Z',
  finished: true,
  effectif: 90,
  groups: BUT1_GROUPS,
  stats: ['6.40', '11.92', '17.15'],
  rang: '22',
  groupRanks: { 4111: { value: '11', total: 45 }, 4112: { value: '5', total: 22 } },
  absenceSummary: { injustifie: 3, total: 9, metrique: 'H.' },
  decision: { code: '', etat: 'I', date: '' },
  decisionAnnee: { annee_scolaire: 2024, date: '2025-07-03T12:00:00+02:00', code: 'ADM', ordre: 1 },
  appreciation: [{ comment: 'Progrès nets à l’oral comme à l’écrit. Attention à l’assiduité en développement web.' }],
  ues: [
    // Bonus for a cultural activity, already in the average.
    { code: 'UE2.1', id: 2001, competence: 'comprendre', ects: 6, stats: ['5.70', '12.00', '17.40'], rang: '15', bonus: 0.2 },
    { code: 'UE2.2', id: 2002, competence: 'concevoir', ects: 6, stats: ['5.30', '11.80', '17.10'], rang: '26' },
    // Compensates UE1.3: (UE1.3 + UE2.3) / 2 ≥ 10.
    { code: 'UE2.3', id: 2003, competence: 'exprimer', ects: 6, stats: ['4.90', '11.60', '16.70'], rang: '30' },
    // Malus for the unjustified absences, already taken off.
    { code: 'UE2.4', id: 2004, competence: 'developper', ects: 6, stats: ['4.10', '11.40', '18.20'], rang: '18 ex', malus: 0.5 },
    { code: 'UE2.5', id: 2005, competence: 'entreprendre', ects: 6, stats: ['5.80', '11.90', '16.60'], rang: '21', capitalise: { date: '2024-07-05', moyenne: 12.4 } },
  ],
  modules: [
    module('R2.01', 21001, 'Anglais', { 'UE2.1': 2, 'UE2.3': 2 }, [
      evaluation(40101, '2025-02-06', 'Compréhension écrite', '14.00', ['6.00', '11.90', '18.50']),
      evaluation(40102, '2025-04-03', 'Oral en interaction', '13.25', ['5.50', '12.00', '18.00'], { coef: '2.00' }),
    ]),
    module('R2.02', 21002, 'Culture numérique', { 'UE2.1': 3 }, [
      // Excused: justified absence that day, doesn't count.
      evaluation(40103, '2025-03-13', 'Exposé sur les usages', 'EXC', ['7.00', '12.80', '18.00']),
      evaluation(40104, '2025-05-22', 'Partiel', '14.50', ['5.00', '11.70', '18.50'], { coef: '2.00' }),
    ]),
    module('R2.03', 21003, 'Stratégies de communication', { 'UE2.1': 2, 'UE2.2': 3 }, [
      evaluation(40105, '2025-03-20', 'Plan de communication', '13.00', ['6.00', '11.80', '17.00'], { coef: '2.00' }),
    ]),
    module('R2.04', 21004, 'Expression, communication et rhétorique', { 'UE2.3': 3 }, [
      evaluation(40106, '2025-02-27', 'Argumentaire écrit', '12.00', ['5.00', '11.20', '16.50']),
      evaluation(40107, '2025-05-06', 'Débat', '12.50', ['6.50', '12.10', '17.50']),
    ]),
    module('R2.06', 21006, 'Production graphique', { 'UE2.3': 2, 'UE2.4': 1 }, [
      evaluation(40108, '2025-03-27', 'Identité visuelle', '12.75', ['5.25', '12.30', '18.00'], { coef: '2.00' }),
    ]),
    module('R2.08', 21008, 'Production audio et vidéo', { 'UE2.3': 2 }, [
      evaluation(40109, '2025-04-10', 'Podcast', '13.00', ['6.00', '12.40', '17.50']),
    ]),
    module('R2.10', 21010, 'Développement web', { 'UE2.4': 3 }, [
      evaluation(40110, '2025-03-06', 'PHP et formulaires', '14.00', ['3.00', '10.90', '19.00'], { coef: '2.00' }),
      evaluation(40111, '2025-05-15', 'Contrôle', '12.50', ['2.00', '10.40', '18.50']),
    ]),
    module('R2.11', 21011, 'Intégration', { 'UE2.4': 2 }, [
      evaluation(40112, '2025-04-17', 'Intégration accessible', '15.50', ['6.50', '12.80', '19.00']),
    ]),
    module('R2.12', 21012, 'Hébergement', { 'UE2.4': 1 }, [
      evaluation(40113, '2025-02-13', 'Mise en ligne', '16.00', ['8.00', '13.60', '20.00']),
    ]),
    module('R2.14', 21014, 'Économie et droit du numérique', { 'UE2.5': 2 }, [
      evaluation(40114, '2025-05-27', 'Partiel', '8.50', ['3.50', '10.60', '16.00']),
    ]),
    module('R2.15', 21015, 'Gestion de projet', { 'UE2.2': 1, 'UE2.5': 2 }, [
      evaluation(40115, '2025-04-24', 'Budget prévisionnel', '9.00', ['4.00', '11.20', '17.00']),
    ]),
    module('SAÉ 2.01', 22001, 'Exploration des usages', { 'UE2.1': 4, 'UE2.2': 3 }, [
      evaluation(40116, '2025-03-31', 'Enquête utilisateurs', '14.00', ['7.00', '12.60', '17.50'], { coef: '2.00' }),
      evaluation(40117, '2025-04-14', 'Restitution', '13.50', ['8.00', '12.90', '18.00']),
    ]),
    module('SAÉ 2.02', 22002, 'Concevoir un produit et sa communication', { 'UE2.2': 4, 'UE2.3': 4, 'UE2.5': 3 }, [
      evaluation(40118, '2025-06-05', 'Dossier de conception', '12.50', ['6.50', '12.00', '17.00'], { coef: '2.00' }),
      // The pitch weighs toward expression and entrepreneurship only.
      evaluation(40119, '2025-06-12', 'Pitch', '9.00', ['5.00', '11.40', '16.50'], { poids: { 'UE2.3': 1, 'UE2.5': 1 } }),
    ]),
    module('SAÉ 2.03', 22003, 'Produire un site web dynamique', { 'UE2.4': 4 }, [
      evaluation(40120, '2025-06-10', 'Site dynamique', '15.00', ['6.00', '12.50', '18.50'], { coef: '2.00' }),
    ]),
  ],
}

// S3, BUT2: UE3.1 under 10 and not made up by UE4.1 (year average < 10): not
// validated, its 6 ECTS missing (24/30, a dashed coin pile). A session 2
// grade replaces a module average. Every UE gets the sport bonus, and the
// semester rank is ex aequo. The year ends in PASD (passage de droit).
const S3 = {
  id: 9103,
  numero: 3,
  year: '2025/2026',
  start: '2025-09-01',
  end: '2026-01-18',
  date: '2026-07-03T09:30:00Z',
  finished: true,
  effectif: 88,
  groups: BUT23_GROUPS,
  stats: ['6.95', '11.80', '16.70'],
  rang: '27 ex',
  groupRanks: { 5121: { value: '13', total: 44 }, 5123: { value: '6', total: 22 }, 5130: { value: '10', total: 30 } },
  absenceSummary: { injustifie: 2, total: 5, metrique: 'H.' },
  decision: { code: '', etat: 'I', date: '' },
  decisionAnnee: { annee_scolaire: 2025, date: '2026-07-02T12:00:00+02:00', code: 'PASD', ordre: 1 },
  appreciation: [],
  ues: [
    // Under 10, not compensated by UE4.1: no ECTS.
    { code: 'UE3.1', id: 3001, competence: 'comprendre', ects: 6, stats: ['4.60', '11.20', '16.40'], rang: '66', bonus: 0.15, validated: false },
    { code: 'UE3.2', id: 3002, competence: 'concevoir', ects: 6, stats: ['5.20', '11.70', '17.00'], rang: '55', bonus: 0.15 },
    { code: 'UE3.3', id: 3003, competence: 'exprimer', ects: 6, stats: ['5.90', '12.10', '17.30'], rang: '28', bonus: 0.15 },
    { code: 'UE3.4', id: 3004, competence: 'developper', ects: 6, stats: ['3.40', '11.50', '18.60'], rang: '7', bonus: 0.15 },
    { code: 'UE3.5', id: 3005, competence: 'entreprendre', ects: 6, stats: ['6.10', '11.90', '16.80'], rang: '25', bonus: 0.15 },
  ],
  modules: [
    module('R3.01', 31001, 'Anglais', { 'UE3.1': 2, 'UE3.3': 2 }, [
      evaluation(50101, '2025-09-25', 'Compréhension orale', '12.00', ['5.50', '11.60', '18.00']),
      evaluation(50102, '2025-11-20', 'Présentation d’une étude de cas', '13.50', ['6.00', '12.20', '18.50'], { coef: '2.00' }),
    ]),
    module('R3.03', 31003, 'Stratégies de communication', { 'UE3.1': 2, 'UE3.2': 3 }, [
      evaluation(50103, '2025-10-09', 'Analyse de marché', '8.50', ['4.00', '11.10', '16.50'], { coef: '2.00' }),
      evaluation(50104, '2026-01-08', 'Partiel', '11.00', ['3.50', '10.80', '17.50'], { coef: '2.00' }),
    ]),
    module('R3.04', 31004, 'Expérience utilisateur', { 'UE3.1': 3 }, [
      evaluation(50105, '2025-10-16', 'Tests utilisateurs', '7.00', ['4.50', '11.40', '17.00']),
      evaluation(50106, '2025-12-11', 'Partiel', '5.50', ['2.50', '10.20', '16.50'], { coef: '2.00' }),
      // After the jury's first session, replaces the module's average.
      evaluation(50107, '2026-01-15', 'Partiel', '6.50', ['4.00', '8.60', '12.50'], { type: EVALUATION_SESSION2 }),
    ]),
    module('R3.05', 31005, 'Écriture multimédia et narration', { 'UE3.3': 2 }, [
      evaluation(50108, '2025-11-06', 'Narration interactive', '14.00', ['6.00', '12.40', '18.00']),
    ]),
    module('R3.07', 31007, 'Création et design interactif', { 'UE3.3': 3, 'UE3.2': 1 }, [
      evaluation(50109, '2025-10-02', 'Maquettes Figma', '13.50', ['6.50', '12.60', '18.50']),
      evaluation(50110, '2025-12-04', 'Prototype animé', '12.00', ['5.00', '12.10', '18.00'], { coef: '2.00' }),
    ]),
    module('R3.10', 31010, 'Développement front', { 'UE3.4': 3 }, [
      evaluation(50111, '2025-09-29', 'TP JavaScript moderne', '16.50', ['5.00', '12.30', '19.50']),
      evaluation(50112, '2025-11-24', 'Contrôle Vue.js', '15.00', ['2.50', '10.60', '19.00'], { coef: '2.00' }),
    ]),
    module('R3.11', 31011, 'Développement back', { 'UE3.4': 3 }, [
      evaluation(50113, '2025-10-20', 'TP PHP objet', '14.00', ['3.00', '11.20', '18.50']),
      evaluation(50114, '2025-12-15', 'Contrôle SQL', '13.50', ['2.00', '10.50', '19.00'], { coef: '2.00' }),
    ]),
    module('R3.12', 31012, 'Déploiement de services', { 'UE3.4': 1 }, [
      evaluation(50115, '2025-11-13', 'Mise en production', '15.50', ['7.00', '13.00', '19.00']),
    ]),
    module('R3.14', 31014, 'Entrepreneuriat', { 'UE3.5': 2 }, [
      evaluation(50116, '2025-12-02', 'Business model', '12.50', ['6.50', '12.00', '17.50']),
    ]),
    module('R3.15', 31015, 'Gestion de projet', { 'UE3.2': 1, 'UE3.5': 2 }, [
      evaluation(50117, '2025-10-23', 'Méthodes agiles', '13.00', ['7.00', '12.40', '17.00']),
    ]),
    module('SAÉ 3.01', 32001, 'Analyse d’usages et préconisations', { 'UE3.1': 4, 'UE3.2': 3 }, [
      evaluation(50118, '2025-11-17', 'Rapport d’analyse', '8.50', ['5.50', '11.80', '16.50'], { coef: '2.00' }),
      evaluation(50119, '2025-12-08', 'Soutenance', '10.50', ['6.00', '12.20', '17.00']),
    ]),
    module('SAÉ 3.02', 32002, 'Dispositif interactif', { 'UE3.3': 3, 'UE3.4': 4, 'UE3.5': 3 }, [
      evaluation(50120, '2026-01-12', 'Démonstration', '15.00', ['7.00', '12.80', '18.50'], { coef: '2.00' }),
      evaluation(50121, '2026-01-14', 'Dossier technique', '14.00', ['6.50', '12.20', '18.00'], { poids: { 'UE3.4': 1, 'UE3.5': 0.5 } }),
    ]),
  ],
}

// S4, BUT2: everything validated (30/30). UE4.1 is just above 10, not
// enough to make up for UE3.1. SAÉ 4.01 counts in four UEs, the internship
// in two.
const S4 = {
  id: 9104,
  numero: 4,
  year: '2025/2026',
  start: '2026-01-19',
  end: '2026-06-30',
  date: '2026-07-03T09:30:00Z',
  finished: true,
  effectif: 86,
  groups: BUT23_GROUPS,
  stats: ['7.60', '12.25', '17.90'],
  rang: '14',
  groupRanks: { 5121: { value: '7', total: 43 }, 5123: { value: '3', total: 21 }, 5130: { value: '5', total: 29 } },
  absenceSummary: { injustifie: 0, total: 2, metrique: 'H.' },
  // As ScoDoc sends a BUT year after its jury: no semester code, the year's.
  decision: { code: '', etat: 'I', date: '' },
  decisionAnnee: { annee_scolaire: 2025, date: '2026-07-02T12:00:00+02:00', code: 'PASD', ordre: 1 },
  appreciation: [{ comment: 'Très bon semestre, travail régulier et sérieux.' }],
  ues: [
    // Validated on its own, but its average with UE3.1 stays under 10.
    { code: 'UE4.1', id: 4001, competence: 'comprendre', ects: 6, stats: ['5.40', '11.60', '16.80'], rang: '57' },
    { code: 'UE4.2', id: 4002, competence: 'concevoir', ects: 6, stats: ['7.20', '12.30', '17.60'], rang: '15' },
    { code: 'UE4.3', id: 4003, competence: 'exprimer', ects: 6, stats: ['6.80', '12.40', '17.20'], rang: '20' },
    { code: 'UE4.4', id: 4004, competence: 'developper', ects: 6, stats: ['6.10', '12.20', '18.40'], rang: '8' },
    { code: 'UE4.5', id: 4005, competence: 'entreprendre', ects: 6, stats: ['7.90', '12.80', '17.80'], rang: '12' },
  ],
  modules: [
    module('R4.01', 41001, 'Stratégie de communication', { 'UE4.1': 1, 'UE4.2': 3 }, [
      evaluation(60101, '2026-02-12', 'Recommandation stratégique', '13.00', ['6.00', '11.90', '17.00'], { coef: '2.00' }),
      evaluation(60102, '2026-03-19', 'QCM', '15.25', ['5.50', '12.30', '19.00']),
    ]),
    module('R4.02', 41002, 'Anglais', { 'UE4.1': 2, 'UE4.3': 2 }, [
      evaluation(60301, '2026-02-05', 'Compréhension écrite', '9.00', ['5.00', '11.80', '18.00']),
      evaluation(60302, '2026-04-02', 'Entretien d’embauche simulé', '12.50', ['6.50', '12.60', '18.50'], { coef: '2.00' }),
    ]),
    module('R4.03', 41003, 'Référencement et analyse d’audience', { 'UE4.1': 3 }, [
      evaluation(60303, '2026-03-12', 'Audit SEO', '7.00', ['4.00', '11.30', '17.00'], { coef: '2.00' }),
    ]),
    module('R4.06', 41006, 'Création et design interactif', { 'UE4.3': 3 }, [
      evaluation(60304, '2026-02-26', 'Design system', '14.50', ['7.00', '12.90', '18.50'], { coef: '2.00' }),
    ]),
    module('R4.08', 41008, 'Développement back', { 'UE4.4': 4 }, [
      evaluation(60181, '2026-03-05', 'API REST', '16.50', ['3.00', '11.60', '19.00'], { coef: '2.00' }),
    ]),
    module('R4.10', 41010, 'Développement front', { 'UE4.4': 3 }, [
      evaluation(60305, '2026-03-26', 'Application monopage', '15.00', ['4.50', '12.00', '19.50'], { coef: '2.00' }),
    ]),
    module('R4.12', 41012, 'Entrepreneuriat', { 'UE4.5': 2 }, [
      evaluation(60306, '2026-03-17', 'Étude de marché', '13.50', ['7.50', '12.70', '17.50']),
    ]),
    module('SAÉ 4.01', 42001, 'Site e-commerce', { 'UE4.1': 1, 'UE4.2': 4, 'UE4.3': 3, 'UE4.4': 4 }, [
      evaluation(60201, '2026-05-28', 'Soutenance finale', '15.00', ['8.00', '12.80', '18.00'], { coef: '3.00', poids: { 'UE4.1': 0.5, 'UE4.2': 1, 'UE4.3': 1, 'UE4.4': 1 } }),
    ]),
    module('SAÉ 4.02', 42002, 'Stage', { 'UE4.4': 3, 'UE4.5': 4 }, [
      evaluation(60307, '2026-06-18', 'Rapport de stage', '14.00', ['8.50', '13.10', '18.00'], { coef: '2.00' }),
      evaluation(60308, '2026-06-24', 'Soutenance de stage', '15.50', ['9.00', '13.60', '19.00']),
    ]),
  ],
}

// S5, BUT3 (current): in progress, no jury, no ECTS yet (the ECTS card stays
// hidden). Three UEs. Grades from the last days for "Dernières notes" and
// the "Nouveau" badges; an absence (ABS) made up by a rattrapage, an
// excused evaluation, pending ones (~ and ATT), a subject without any
// evaluation yet, a bonus on UE5.3.
const S5 = {
  id: 9105,
  numero: 5,
  year: '2026/2027',
  start: '2026-09-01',
  end: '2027-01-24',
  date: '2026-10-14T16:20:00Z',
  finished: false,
  effectif: 84,
  groups: BUT23_GROUPS,
  stats: ['7.84', '12.44', '17.40'],
  rang: '9',
  groupRanks: { 5121: { value: '4', total: 42 }, 5123: { value: '2', total: 21 }, 5130: { value: '3', total: 28 } },
  absenceSummary: { injustifie: 2, total: 6, metrique: 'H.' },
  ues: [
    { code: 'UE5.1', id: 5001, competence: 'concevoir', ects: 10, stats: ['6.90', '12.40', '17.80'], rang: '12' },
    { code: 'UE5.2', id: 5002, competence: 'exprimer', ects: 10, stats: ['5.10', '12.05', '16.90'], rang: '24' },
    { code: 'UE5.3', id: 5003, competence: 'developper', ects: 10, stats: ['7.40', '12.88', '18.20'], rang: '6', bonus: 0.1 },
  ],
  modules: [
    module('R5.07', 51007, 'UX Writing', { 'UE5.1': 3, 'UE5.2': 2 }, [
      evaluation(70101, '2026-09-17', 'Atelier persona', '14.00', ['6.50', '12.60', '18.00'], { poids: { 'UE5.1': 1, 'UE5.2': 0.5 } }),
      evaluation(70102, '2026-10-06', 'Audit éditorial', '17.00', ['8.00', '13.90', '19.00'], { coef: '2.00' }),
    ]),
    module('R5.11', 51011, 'Développement Front', { 'UE5.3': 4 }, [
      evaluation(70111, '2026-09-24', 'Composants React', '16.00', ['4.00', '12.50', '19.50'], { coef: '2.00' }),
      // Justified absence that day (see the absences): excused.
      evaluation(70113, '2026-10-06', 'Quiz hooks', 'EXC', ['6.00', '13.40', '19.00'], { time: ['14:00', '15:00'] }),
      evaluation(70112, '2026-10-09', 'Accessibilité UI', '18.00', ['9.00', '13.20', '18.50']),
      evaluation(70114, '2026-10-14', 'TP état et effets', '15.50', ['6.00', '12.40', '19.00']),
    ]),
    module('R5.04', 51004, 'Gestion de projet', { 'UE5.1': 2 }, [
      evaluation(70141, '2026-09-22', 'Note de cadrage', '11.50', ['5.00', '11.80', '16.00']),
      // Held, not graded yet.
      evaluation(70142, '2026-10-13', 'Soutenance de cadrage', '~'),
    ]),
    module('R5.02', 51002, 'Anglais', { 'UE5.2': 2 }, [
      evaluation(70121, '2026-09-15', 'Compréhension écrite', 'ABS', ['7.00', '13.10', '18.00']),
      evaluation(70122, '2026-10-01', 'Oral : pitch produit', '12.75', ['8.25', '12.40', '17.50']),
      // Better than the module's average with the absence: replaces it.
      evaluation(70123, '2026-10-08', 'Compréhension écrite', '13.50', ['9.00', '11.00', '13.50'], { type: EVALUATION_RATTRAPAGE }),
    ]),
    module('R5.03', 51003, 'Accessibilité numérique', { 'UE5.2': 1, 'UE5.3': 2 }, [
      evaluation(70131, '2026-10-12', 'Audit RGAA', '16.50', ['8.00', '13.10', '18.50'], { coef: '2.00' }),
    ]),
    // No evaluation yet.
    module('R5.09', 51009, 'Culture numérique', { 'UE5.2': 1 }),
    module('R5.12', 51012, 'Développement back-end', { 'UE5.3': 3 }, [
      evaluation(70151, '2026-09-29', 'QCM Node.js', '13.00', ['4.50', '11.90', '18.00']),
      // Handed in, waiting for its grade.
      evaluation(70152, '2026-10-13', 'TP API REST', 'ATT', ['', '', ''], { coef: '2.00' }),
    ]),
    module('SAÉ 5.01', 52001, 'Prototype interactif', { 'UE5.1': 4, 'UE5.3': 4 }, [
      evaluation(70201, '2026-09-30', 'Sprint review', '15.50', ['9.50', '12.70', '17.00'], { coef: '2.00', poids: { 'UE5.1': 0.5, 'UE5.3': 1 } }),
      evaluation(70202, '2026-10-10', 'Démo client', '14.00', ['7.00', '12.10', '16.50']),
    ]),
    module('SAÉ 5.02', 52002, 'Portfolio', { 'UE5.2': 3 }, [
      evaluation(70211, '2026-10-02', 'Revue de portfolio', '9.50', ['5.50', '11.40', '16.00']),
      evaluation(70212, '2026-10-14', 'Pitch portfolio', '13.00', ['6.50', '12.20', '17.50']),
    ]),
  ],
}

// Absences as the passerelle lists them, per day; hours as decimals (8.25 =
// 8h15). They add up to each semester's `absences` summary.
const DEMO_ABSENCES = {
  9101: {
    '2024-10-15': [
      { debut: 10.5, fin: 12.5, statut: 'absent', justifie: false, enseignant: 'claire.rivoal@univ-rennes.fr', matiereComplet: 11002 },
    ],
    '2024-11-14': [
      { debut: 8.25, fin: 10.25, statut: 'absent', justifie: false, enseignant: 'yann.kerboriou@univ-rennes.fr', matiereComplet: 11005 },
    ],
    '2024-12-09': [
      { debut: 8.25, fin: 12.25, statut: 'absent', justifie: true, enseignant: 'thomas.lemoine@univ-rennes.fr', matiereComplet: 11010 },
    ],
    '2025-01-07': [
      { debut: 13.5, fin: 13.75, statut: 'retard', justifie: false, enseignant: 'julie.morvan@univ-rennes.fr', matiereComplet: 11001 },
    ],
  },
  9102: {
    '2025-02-11': [
      { debut: 8.25, fin: 10.25, statut: 'absent', justifie: false, enseignant: 'thomas.lemoine@univ-rennes.fr', matiereComplet: 21010 },
    ],
    '2025-03-13': [
      { debut: 8.25, fin: 12.25, statut: 'absent', justifie: true, enseignant: 'claire.rivoal@univ-rennes.fr', matiereComplet: 21002 },
    ],
    '2025-04-29': [
      { debut: 10.5, fin: 11.5, statut: 'absent', justifie: false, enseignant: 'thomas.lemoine@univ-rennes.fr', matiereComplet: 21010 },
    ],
    '2025-05-20': [
      { debut: 14, fin: 16, statut: 'absent', justifie: true, enseignant: 'anne.lefur@univ-rennes.fr', matiereComplet: 22002 },
    ],
    '2025-06-03': [
      { debut: 8.25, fin: 8.5, statut: 'retard', justifie: false, enseignant: 'julie.morvan@univ-rennes.fr', matiereComplet: 21001 },
    ],
  },
  9103: {
    '2025-10-07': [
      { debut: 13.5, fin: 15.5, statut: 'absent', justifie: false, enseignant: 'marc.le.goff@univ-rennes.fr', matiereComplet: 31004 },
    ],
    '2025-12-16': [
      { debut: 8.25, fin: 11.25, statut: 'absent', justifie: true, enseignant: 'anne.lefur@univ-rennes.fr', matiereComplet: 32001 },
    ],
  },
  9104: {
    '2026-03-03': [
      { debut: 14, fin: 16, statut: 'absent', justifie: true, enseignant: 'thomas.lemoine@univ-rennes.fr', matiereComplet: 41010 },
    ],
  },
  9105: {
    '2026-09-25': [
      { debut: 8.25, fin: 10.25, statut: 'absent', justifie: false, enseignant: 'thomas.lemoine@univ-rennes.fr', matiereComplet: 51011 },
    ],
    '2026-09-29': [
      { debut: 13.5, fin: 15.5, statut: 'absent', justifie: true, enseignant: 'anne.lefur@univ-rennes.fr', matiereComplet: 52001 },
    ],
    '2026-10-06': [
      { debut: 10.25, fin: 10.5, statut: 'retard', justifie: false, enseignant: 'julie.morvan@univ-rennes.fr', matiereComplet: 'R5.02 - Anglais' },
      { debut: 14, fin: 16, statut: 'absent', justifie: true, enseignant: 'thomas.lemoine@univ-rennes.fr', matiereComplet: 51011 },
    ],
  },
}

const DEMO_SEMESTER_SPECS = Object.freeze({ 9101: S1, 9102: S2, 9103: S3, 9104: S4, 9105: S5 })
const CURRENT_SEMESTER_ID = 9105

function buildDemoSemester(semesterId) {
  const spec = DEMO_SEMESTER_SPECS[semesterId]
  return spec
    ? { 'relevé': buildDemoReleve(spec), absences: JSON.parse(JSON.stringify(DEMO_ABSENCES[semesterId] ?? {})) }
    : null
}

// The first-connection answer: the semester list and the current relevé.
export function buildDemoGradesPayload() {
  return {
    auth: { session: 'demo', statut: 10 },
    config: DEMO_GRADES_CONFIG,
    semestres: DEMO_GRADES_SEMESTERS.map((semester) => ({ ...semester })),
    ...buildDemoSemester(CURRENT_SEMESTER_ID),
  }
}

// One semester's answer (/__ent_auth/grades/semester/:id), null for an
// unknown id.
export function buildDemoSemesterGradesPayload(semesterId) {
  const semester = buildDemoSemester(String(semesterId))
  return semester ? { config: DEMO_GRADES_CONFIG, ...semester } : null
}

// A demo evaluation's promo histogram (/__ent_auth/grades/evaluation-
// distribution): made-up grades matching its promo min/moy/max, seeded by its
// id. Everyone sits a normal evaluation but a few absentees; a rattrapage or
// a session 2 only gathers the students who needed it. null for an unknown
// semester or evaluation.
export function buildDemoEvaluationDistribution(semesterId, evaluationId) {
  const spec = DEMO_SEMESTER_SPECS[semesterId === 'current' ? CURRENT_SEMESTER_ID : semesterId]
  const item = spec?.modules
    .flatMap((entry) => entry.evaluations)
    .find((entry) => String(entry.id) === String(evaluationId))
  if (!item) {
    return null
  }

  const [min, moy, max] = [item.min, item.moy, item.max].map(readNote)
  if (min == null || moy == null || max == null) {
    // Nothing graded yet: ScoDoc has no grade to count.
    return buildDistribution([])
  }

  const random = createSeededRandom(`${item.id}:size`)
  const total = item.type === EVALUATION_NORMAL
    ? spec.effectif - Math.floor(random() * 4)
    : Math.round(spec.effectif * (0.12 + random() * 0.1))
  // ABS/EXC/pending grades aren't counted by ScoDoc.
  const grade = /^\d+(\.\d+)?$/.test(item.value) ? Number(item.value) : null

  return buildDistribution(generateDemoGrades({ seed: item.id, total, min, moy, max, grade }))
}
