// Turns the ScoDoc payloads relayed by the notes9 passerelle into what the
// "Mes notes" page renders. Pure data: no browser or @university import, so
// the tests run it straight in Node.
//
// Payload shapes (ScoDoc 9 BUT bulletin, wrapped by the passerelle):
// - first connection: { auth, config, semestres, relevé, absences, totauxAbsences? }
// - one semester:     { relevé, absences, totauxAbsences?, config? }
// In a BUT relevé, evaluation notes are already on /20 and note.min/moy/max
// are promo stats; ScoDoc leaves module averages empty (only UE averages are
// official), so the page shows an indicative module average it computes.

export const GRADE_SCALE = 20

// Histogram binning of the passerelle (see evaluationDistribution.js).
export { bucketOfGrade } from './evaluationDistribution.js'

const EVALUATION_TYPE_LABELS = {
  1: 'Rattrapage',
  2: 'Session 2',
  3: 'Bonus',
}

// "Rattrapage", "Session 2", "Bonus" for an evaluation_type, null for a
// normal evaluation: the label its grade carries wherever it's shown.
export function evaluationTypeLabel(type) {
  return EVALUATION_TYPE_LABELS[Number(type ?? 0)] ?? null
}

// ScoDoc's evaluation_type values.
const EVALUATION_NORMAL = 0
const EVALUATION_RATTRAPAGE = 1
const EVALUATION_SESSION2 = 2

const SPECIAL_GRADE_LABELS = {
  '~': { kind: 'pending', label: 'En attente' },
  ATT: { kind: 'pending', label: 'En attente' },
  ABS: { kind: 'absent', label: 'Absent' },
  EXC: { kind: 'excused', label: 'Excusé' },
  NP: { kind: 'absent', label: 'Non présenté' },
}

export function parseGradeNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const text = String(value ?? '').trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return null
  }

  return Number(text)
}

// What a raw ScoDoc note value means: a number, or one of its codes.
export function describeGrade(rawValue) {
  const number = parseGradeNumber(rawValue)
  if (number != null) {
    return { kind: 'number', value: number, label: formatGrade(number) }
  }

  const code = String(rawValue ?? '').trim()
  if (!code || code === '-' || code === 'NA') {
    return { kind: 'none', value: null, label: '—' }
  }

  const special = SPECIAL_GRADE_LABELS[code.toUpperCase()]
  return special
    ? { kind: special.kind, value: null, label: special.label }
    : { kind: 'other', value: null, label: code }
}

// 15.5 → "15,5", 14 → "14", 12.333 → "12,33" (French decimal comma).
export function formatGrade(value, maxDecimals = 2) {
  const number = parseGradeNumber(value)
  if (number == null) {
    return '—'
  }

  return number.toLocaleString('fr-FR', { maximumFractionDigits: maxDecimals, minimumFractionDigits: 0 })
}

function readStats(source) {
  if (!source || typeof source !== 'object') {
    return { value: parseGradeNumber(source), min: null, moy: null, max: null }
  }

  return {
    value: parseGradeNumber(source.value),
    min: parseGradeNumber(source.min),
    moy: parseGradeNumber(source.moy),
    max: parseGradeNumber(source.max),
  }
}

function readRank(value, total) {
  const rank = String(value ?? '').trim()
  const count = Number.parseInt(total, 10)
  if (!rank) {
    return null
  }

  // ScoDoc writes ex aequo ranks as "12 ex".
  return {
    value: rank.replace(/\s*ex$/i, ' ex æquo'),
    total: Number.isFinite(count) && count > 0 ? count : null,
  }
}

function readEcts(source) {
  const earned = parseGradeNumber(source?.acquis)
  const total = parseGradeNumber(source?.total)
  return earned == null && total == null ? null : { earned, total }
}

function readGroupNames(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => String(group?.group_name ?? group?.nom ?? group ?? '').trim())
    .filter((name, index, names) => name && names.indexOf(name) === index)
}

function readGroupRanks(groups) {
  if (!groups || typeof groups !== 'object') {
    return []
  }

  return Object.entries(groups)
    .map(([key, entry]) => {
      const name = String(entry?.group_name ?? entry?.nom ?? key).trim()
      const rank = Array.isArray(entry) ? readRank(entry[0], entry[1]) : readRank(entry?.value, entry?.total)
      return rank ? { name, ...rank } : null
    })
    .filter(Boolean)
}

function readEvaluationDate(evaluation) {
  const date = evaluation?.date_debut ?? evaluation?.date ?? null
  return typeof date === 'string' && date ? date : null
}

function normalizeEvaluation(evaluation, index) {
  const type = Number(evaluation?.evaluation_type ?? 0)
  const weights = Object.entries(evaluation?.poids ?? {})
    .map(([ue, weight]) => ({ ue, weight: parseGradeNumber(weight) }))
    .filter((entry) => entry.weight != null && entry.weight > 0)

  return {
    id: String(evaluation?.id ?? `evaluation-${index}`),
    description: String(evaluation?.description ?? '').trim() || 'Évaluation',
    date: readEvaluationDate(evaluation),
    // ScoDoc's evaluation_type: 0 normal, 1 rattrapage, 2 session 2, 3 bonus.
    type,
    typeLabel: evaluationTypeLabel(type),
    // Only normal evaluations with a UE weight move the averages.
    canSimulate: type === 0 && weights.length > 0,
    coef: parseGradeNumber(evaluation?.coef),
    grade: describeGrade(evaluation?.note?.value),
    promo: {
      min: parseGradeNumber(evaluation?.note?.min),
      moy: parseGradeNumber(evaluation?.note?.moy),
      max: parseGradeNumber(evaluation?.note?.max),
    },
    weights,
  }
}

// What a grade counts for in ScoDoc's averages: its value, 0 for an
// unjustified absence, nothing while pending or once excused.
function countGrade(grade) {
  if (grade?.kind === 'number') return grade.value
  if (grade?.kind === 'absent') return 0
  return null
}

function weightedMean(entries, type) {
  let weighted = 0
  let weightSum = 0
  for (const entry of entries) {
    if (entry.type !== type || entry.value == null || !(entry.weight > 0)) continue
    weighted += entry.value * entry.weight
    weightSum += entry.weight
  }
  return weightSum > 0 ? weighted / weightSum : null
}

// A module's result from its evaluations, `entries` as { type, value,
// weight } (value: what the grade counts for, null when it doesn't), the way
// ScoDoc does it (app/comp/moy_mod.py): the weighted mean of the normal
// evaluations; then, if the module has session 2 evaluations, their mean
// replaces it once there is one; otherwise the rattrapages' mean replaces it
// when it's better (never a missing one). Bonus evaluations are left out.
function resolveModuleAverage(entries) {
  const normal = weightedMean(entries, EVALUATION_NORMAL)
  if (entries.some((entry) => entry.type === EVALUATION_SESSION2)) {
    return weightedMean(entries, EVALUATION_SESSION2) ?? normal
  }
  const rattrapage = weightedMean(entries, EVALUATION_RATTRAPAGE)
  return normal != null && rattrapage != null && rattrapage > normal ? rattrapage : normal
}

// The module's average by coefficient, ScoDoc's rules above (an unjustified
// absence counts 0, a rattrapage or a session 2 replaces): what the module
// would weigh if every UE counted its evaluations the same way. Indicative
// only: ScoDoc's official averages are per UE.
export function computeIndicativeAverage(evaluations) {
  return resolveModuleAverage((evaluations ?? []).map((evaluation) => ({
    type: evaluation.type ?? EVALUATION_NORMAL,
    value: countGrade(evaluation.grade),
    weight: evaluation.coef ?? 1,
  })))
}

function normalizeModules(section, kind, ueByCode) {
  return Object.entries(section ?? {}).map(([code, module]) => {
    const evaluations = (module?.evaluations ?? []).map(normalizeEvaluation)
    const officialAverage = parseGradeNumber(module?.moyenne?.value ?? module?.moyenne)
    const average = officialAverage ?? computeIndicativeAverage(evaluations)
    const sectionKey = kind === 'sae' ? 'saes' : 'ressources'
    const ueCoefs = Object.values(ueByCode)
      .map((ue) => {
        const link = ue.raw?.[sectionKey]?.[code]
        const coef = parseGradeNumber(link?.coef)
        return coef != null && coef > 0 ? { ue: ue.code, coef, color: ue.color } : null
      })
      .filter(Boolean)

    return {
      id: String(module?.id ?? code),
      code,
      title: String(module?.titre ?? code),
      kind,
      average,
      averageIsIndicative: officialAverage == null && average != null,
      evaluations,
      ueCoefs,
      gradedCount: evaluations.filter((evaluation) => evaluation.grade.kind === 'number').length,
      pendingCount: evaluations.filter((evaluation) => evaluation.grade.kind === 'pending').length,
    }
  })
}

function normalizeUeModules(ue, modulesByCode) {
  return ['ressources', 'saes'].flatMap((sectionKey) => (
    Object.entries(ue?.[sectionKey] ?? {}).map(([code, link]) => ({
      code,
      title: modulesByCode.get(code)?.title ?? code,
      kind: sectionKey === 'saes' ? 'sae' : 'resource',
      coef: parseGradeNumber(link?.coef),
      average: parseGradeNumber(link?.moyenne?.value ?? link?.moyenne),
    }))
  ))
}

function nonZero(value) {
  const number = parseGradeNumber(value)
  return number != null && number !== 0 ? number : null
}

// The jury's code for each UE (semestre.decision_ue, once the jury has
// ruled), by ScoDoc id and by acronym (the relevé's UE key).
function readUeDecisions(semestre) {
  const decisions = new Map()
  for (const entry of Array.isArray(semestre?.decision_ue) ? semestre.decision_ue : []) {
    const code = typeof entry?.code === 'string' ? entry.code.trim().toUpperCase() : ''
    if (!code) continue
    if (entry.ue_id != null) decisions.set(`id:${entry.ue_id}`, code)
    if (entry.acronyme) decisions.set(`code:${entry.acronyme}`, code)
  }
  return decisions
}

const PASS_MARK = 10
// ScoDoc's codes for a validated UE, its ECTS awarded (codes_cursus.py,
// CODES_UE_VALIDES): ADM and CMP by right, ADJ, ADJR and ADSUP by the jury.
const VALIDATING_UE_CODES = new Set(['ADM', 'CMP', 'ADJ', 'ADJR', 'ADSUP'])

// Whether a UE of the report is validated, and how. `state`: 'validated',
// 'below' (under 10, not validated) or 'pending' (no average yet).
// `validatedBy`: 'average' (10/20 or more), 'capitalization' (validated in
// an earlier semester), 'compensation' or 'jury' (under 10, yet validated:
// the jury's CMP, or its ADJ/ADJR/ADSUP; without a code, its ECTS all
// awarded, which in BUT means compensation), null when not validated.
// Before the jury nothing is awarded, so only the average speaks.
export function describeUeValidation(ue) {
  const average = ue?.average?.value ?? null
  if (ue?.capitalized) return { state: 'validated', validatedBy: 'capitalization' }
  if (average != null && average >= PASS_MARK) return { state: 'validated', validatedBy: 'average' }

  const decision = ue?.decision ?? null
  const ects = ue?.ects
  const awarded = decision
    ? VALIDATING_UE_CODES.has(decision)
    : ects?.total > 0 && ects.earned != null && ects.earned >= ects.total
  if (awarded) return { state: 'validated', validatedBy: !decision || decision === 'CMP' ? 'compensation' : 'jury' }
  return { state: average == null ? 'pending' : 'below', validatedBy: null }
}

function normalizeUes(ues, { decisions = new Map(), capitalized = {} } = {}) {
  return Object.entries(ues ?? {}).map(([code, ue]) => {
    const average = readStats(ue?.moyenne)

    return {
      code,
      title: String(ue?.titre ?? code),
      color: typeof ue?.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(ue.color) ? ue.color : null,
      average,
      rank: readRank(ue?.moyenne?.rang, ue?.moyenne?.total),
      ects: readEcts(ue?.ECTS),
      bonus: nonZero(ue?.bonus),
      malus: nonZero(ue?.malus),
      // ScoDoc lists a UE validated in an earlier semester under
      // ues_capitalisees (its own `capitalise` is still a TODO there).
      capitalized: Boolean(ue?.capitalise) || Boolean(capitalized?.[code]),
      decision: decisions.get(`id:${ue?.id}`) ?? decisions.get(`code:${code}`) ?? null,
      raw: ue,
    }
  })
}

function readOption(options, key) {
  return options?.[key] !== false && options?.[key] !== 0
}

function readSituation(semestre) {
  const lines = []
  const yearCode = semestre?.decision_annee?.code
  if (yearCode) lines.push(`Décision annuelle : ${yearCode}`)
  const semesterCode = semestre?.decision?.code
  if (semesterCode) lines.push(`Décision du semestre : ${semesterCode}`)
  if (typeof semestre?.situation === 'string' && semestre.situation.trim()) {
    lines.push(htmlToPlainText(semestre.situation))
  }
  return lines
}

export function getReleveDepartment(releve) {
  const department = releve?.etudiant?.dept_acronym
    ?? String(releve?.etudiant?.photo_url ?? '').split('/')[2]
  return typeof department === 'string' && department.trim() ? department.trim() : null
}

function isDepartmentListed(list, department) {
  const entries = String(list ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries.length === 0 || (department != null && entries.includes(department))
}

// Mirrors the passerelle: a department list left empty means "everyone".
export function canDownloadReportPdf(config, department) {
  return Boolean(config?.releve_PDF) && isDepartmentListed(config?.liste_dep_publi_PDF, department)
}

function canShowAppreciations(config, department) {
  return isDepartmentListed(config?.liste_dep_affichage_appreciations, department)
}

export function buildGradesReport(releve, { config = null } = {}) {
  if (!releve || typeof releve !== 'object') {
    return { status: 'empty' }
  }

  if (releve.publie === false) {
    return { status: 'unpublished', message: htmlToPlainText(releve.message) || "Le relevé de ce semestre n'est pas publié." }
  }

  if (releve.type && releve.type !== 'BUT') {
    return { status: 'unsupported', type: releve.type }
  }

  const department = getReleveDepartment(releve)
  const options = releve.options ?? {}
  const semestre = releve.semestre ?? {}
  const ues = normalizeUes(releve.ues, { decisions: readUeDecisions(semestre), capitalized: releve.ues_capitalisees })
  const ueByCode = Object.fromEntries(ues.map((ue) => [ue.code, ue]))
  const resources = normalizeModules(releve.ressources, 'resource', ueByCode)
  const saes = normalizeModules(releve.saes, 'sae', ueByCode)
  const modulesByCode = new Map([...resources, ...saes].map((module) => [module.code, module]))
  const showRanks = readOption(options, 'show_rangs')
  const showUeRanks = showRanks && readOption(options, 'show_ue_rangs')

  const latest = [...resources, ...saes]
    .flatMap((module) => module.evaluations
      .filter((evaluation) => evaluation.date && evaluation.grade.kind === 'number')
      .map((evaluation) => ({ ...evaluation, moduleCode: module.code, moduleTitle: module.title, moduleKind: module.kind })))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 6)

  const semesterAverage = readStats(semestre.notes)

  return {
    status: 'ok',
    department,
    student: {
      firstName: String(releve.etudiant?.prenom ?? '').trim() || null,
      lastName: String(releve.etudiant?.nom ?? '').trim() || null,
    },
    formation: {
      acronym: releve.formation?.acronyme ?? null,
      title: releve.formation?.titre ?? releve.formation?.titre_officiel ?? null,
    },
    semester: {
      number: semestre.numero ?? null,
      year: semestre.annee_universitaire ?? null,
      start: semestre.date_debut ?? null,
      end: semestre.date_fin ?? null,
      groups: readGroupNames(semestre.groupes),
    },
    publishedAt: releve.date ?? null,
    average: semesterAverage,
    // ScoDoc sends the promo stats even when show_minmax/show_moypromo hide
    // them from the passerelle's page: shown whenever they're there.
    showPromoStats: [...resources, ...saes].some((module) => module.evaluations
      .some((evaluation) => ['min', 'moy', 'max'].some((key) => evaluation.promo[key] != null))),
    rank: showRanks ? readRank(semestre.rang?.value, semestre.rang?.total) : null,
    groupRanks: showRanks ? readGroupRanks(semestre.rang?.groupes) : [],
    ects: readOption(options, 'show_ects') ? readEcts(semestre.ECTS) : null,
    absenceSummary: semestre.absences && readOption(options, 'show_abs')
      ? {
          unjustified: parseGradeNumber(semestre.absences.injustifie),
          total: parseGradeNumber(semestre.absences.total),
          unit: String(semestre.absences.metrique ?? '').trim() || null,
        }
      : null,
    situation: readSituation(semestre),
    ues: ues.map(({ raw, ...ue }) => ({
      ...ue,
      rank: showUeRanks ? ue.rank : null,
      modules: normalizeUeModules(raw, modulesByCode),
    })),
    resources,
    saes,
    latest,
    appreciations: canShowAppreciations(config, department)
      ? (Array.isArray(releve.appreciation) ? releve.appreciation : [])
          .map((entry) => htmlToPlainText(entry?.comment ?? entry))
          .filter(Boolean)
      : [],
  }
}

// What one evaluation counts for in ScoDoc's averages: a number, 0 for an
// unjustified absence, nothing for pending/excused.
function readCountedGrade(rawValue) {
  return countGrade(describeGrade(rawValue))
}

// A module's average in each UE it feeds (`ueCodes`: those where its
// coefficient isn't 0), ScoDoc's BUT rule: its evaluations weighted by
// coefficient × the evaluation's weight toward that UE, then
// resolveModuleAverage's rattrapage and session 2. A session 2 only replaces
// once it has an average in every one of those UEs, as in ScoDoc; a
// rattrapage, UE by UE. `overrides` (evaluation id → grade on /20) replace
// real or missing grades.
function computeModuleUeAverages(evaluations, ueCodes, overrides) {
  const entriesByUe = Object.fromEntries(ueCodes.map((ueCode) => [ueCode, (evaluations ?? []).map((evaluation) => {
    const id = String(evaluation?.id ?? '')
    return {
      type: Number(evaluation?.evaluation_type ?? EVALUATION_NORMAL),
      value: id in overrides ? overrides[id] : readCountedGrade(evaluation?.note?.value),
      weight: (parseGradeNumber(evaluation?.coef) ?? 1) * (parseGradeNumber(evaluation?.poids?.[ueCode]) ?? 0),
    }
  })]))

  const hasSession2 = (evaluations ?? []).some((evaluation) => Number(evaluation?.evaluation_type) === EVALUATION_SESSION2)
  if (!hasSession2) return Object.fromEntries(ueCodes.map((ueCode) => [ueCode, resolveModuleAverage(entriesByUe[ueCode])]))
  // With a session 2, rattrapages don't count: its mean in every UE, or the
  // normal evaluations' everywhere.
  const usesSession2 = ueCodes.every((ueCode) => weightedMean(entriesByUe[ueCode], EVALUATION_SESSION2) != null)
  const type = usesSession2 ? EVALUATION_SESSION2 : EVALUATION_NORMAL
  return Object.fromEntries(ueCodes.map((ueCode) => [ueCode, weightedMean(entriesByUe[ueCode], type)]))
}

// UE averages recomputed from the evaluations, with `overrides`
// (evaluation id → grade on /20) replacing real or missing grades.
export function computeUeAverages(releve, overrides = {}) {
  // Module → its average in each UE with a coefficient for it.
  const moduleAverages = {}
  for (const sectionKey of ['ressources', 'saes']) {
    for (const [moduleCode, module] of Object.entries(releve?.[sectionKey] ?? {})) {
      const ueCodes = Object.entries(releve?.ues ?? {})
        .filter(([, ue]) => parseGradeNumber(ue?.[sectionKey]?.[moduleCode]?.coef))
        .map(([ueCode]) => ueCode)
      moduleAverages[`${sectionKey}:${moduleCode}`] = computeModuleUeAverages(module?.evaluations, ueCodes, overrides)
    }
  }

  const averages = {}
  for (const [ueCode, ue] of Object.entries(releve?.ues ?? {})) {
    let weighted = 0
    let coefSum = 0

    for (const sectionKey of ['ressources', 'saes']) {
      for (const [moduleCode, link] of Object.entries(ue?.[sectionKey] ?? {})) {
        const moduleCoef = parseGradeNumber(link?.coef)
        if (!moduleCoef) continue
        const moduleAverage = moduleAverages[`${sectionKey}:${moduleCode}`]?.[ueCode]
        if (moduleAverage == null) continue
        weighted += moduleAverage * moduleCoef
        coefSum += moduleCoef
      }
    }

    averages[ueCode] = coefSum > 0 ? weighted / coefSum : null
  }

  return averages
}

function clampGrade(value) {
  return Math.min(GRADE_SCALE, Math.max(0, value))
}

// "What if" averages. The simulated change is applied on top of ScoDoc's
// official UE averages, so bonus, malus and ScoDoc's own rounding stay in;
// the general average moves with the UEs, weighted by their ECTS.
export function projectAverages(releve, overrides) {
  const baseline = computeUeAverages(releve)
  const simulated = computeUeAverages(releve, overrides)
  const ues = {}
  let weightedDelta = 0
  let weightedProjected = 0
  let weightSum = 0

  for (const [ueCode, ue] of Object.entries(releve?.ues ?? {})) {
    const official = parseGradeNumber(ue?.moyenne?.value)
    const simulatedValue = simulated[ueCode]
    let projected = official
    if (simulatedValue != null) {
      projected = clampGrade(official != null && baseline[ueCode] != null
        ? official + (simulatedValue - baseline[ueCode])
        : simulatedValue)
    }

    ues[ueCode] = { official, projected }
    if (projected == null) continue

    const weight = parseGradeNumber(ue?.ECTS?.total) || 1
    weightedDelta += (projected - (official ?? projected)) * weight
    weightedProjected += projected * weight
    weightSum += weight
  }

  const officialGeneral = parseGradeNumber(releve?.semestre?.notes?.value)
  let general = null
  if (weightSum > 0) {
    general = clampGrade(officialGeneral != null ? officialGeneral + weightedDelta / weightSum : weightedProjected / weightSum)
  }

  return { ues, general: { official: officialGeneral, projected: general } }
}

function estimatePromoAverage(releve, projectedUes) {
  let weighted = 0
  let weightSum = 0

  for (const [ueCode, ue] of Object.entries(releve?.ues ?? {})) {
    const promo = parseGradeNumber(ue?.moyenne?.moy)
    if (promo == null || projectedUes[ueCode]?.projected == null) continue
    const weight = parseGradeNumber(ue?.ECTS?.total) || 1
    weighted += promo * weight
    weightSum += weight
  }

  return weightSum > 0 ? weighted / weightSum : null
}

// "Moyenne Générale" card. ScoDoc's semester average when the relevé
// carries it; when the department blocks it (or it isn't computed yet), the
// UE averages weighted by their ECTS, like ScoDoc does. The promo average
// the same way: ScoDoc's when it sends the student's (show_moypromo only
// hides it from the passerelle's page), else the UEs' promo averages
// weighted by their ECTS, over the UEs the student's average counts (a
// blocked general average comes with a placeholder promo one).
export function computeGeneralAverage(releve) {
  const official = parseGradeNumber(releve?.semestre?.notes?.value)
  const projection = projectAverages(releve, {})
  const average = official ?? projection.general.projected
  const promoAverage = official != null
    ? parseGradeNumber(releve?.semestre?.notes?.moy)
    : estimatePromoAverage(releve, projection.ues)

  return { average, promoAverage, source: official != null ? 'semestre.notes' : 'ues-ects' }
}

// Whether the jury has ruled: a code on the semester's decision or, for a BUT
// (where ScoDoc leaves the semester's empty), on its year's. Its averages are
// then final.
export function hasJuryDecision(releve) {
  const semestre = releve?.semestre
  return [semestre?.decision?.code, semestre?.decision_annee?.code]
    .some((code) => typeof code === 'string' && code.trim() !== '')
}

// Whether any evaluation of the semester has a grade that counts (an
// unjustified absence counts, as 0).
export function hasCountedGrade(releve) {
  return ['ressources', 'saes'].some((sectionKey) => Object.values(releve?.[sectionKey] ?? {})
    .some((module) => (module?.evaluations ?? []).some((evaluation) => readCountedGrade(evaluation?.note?.value) != null)))
}

// Everything the "Moyenne Générale" card shows for one semester's relevé, or
// null when there's no average to show: also without a single grade yet, even
// if ScoDoc sends an average (capitalised UEs, bonus…), as it means nothing yet.
export function summarizeAverage(releve) {
  if (!hasCountedGrade(releve)) return null
  const { average, promoAverage, source } = computeGeneralAverage(releve)
  if (average == null) return null

  return {
    average,
    promoAverage,
    // The department hides ScoDoc's average: this one is rebuilt from the UEs.
    estimated: source !== 'semestre.notes',
    // After the jury: the average won't move any more.
    final: hasJuryDecision(releve),
    history: computeAverageHistory(releve, average),
    semesterEnd: releve?.semestre?.date_fin ?? null,
    source,
  }
}

function readEvaluationDay(evaluation) {
  const date = String(evaluation?.date_debut ?? evaluation?.date ?? '')
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null
}

// { average, ects }: the UE averages weighted by ECTS, and the ECTS they cover.
function weightUesByEcts(releve, ueAverages) {
  let weighted = 0
  let weightSum = 0
  for (const [ueCode, ue] of Object.entries(releve?.ues ?? {})) {
    const value = ueAverages[ueCode]
    if (value == null) continue
    const weight = parseGradeNumber(ue?.ECTS?.total) || 1
    weighted += value * weight
    weightSum += weight
  }
  return { average: weightSum > 0 ? weighted / weightSum : null, ects: weightSum }
}

// How the general average moved over the semester: one point per day that
// brought a grade, recomputed from the evaluations graded by then (UE
// averages from computeUeAverages, weighted by ECTS). It starts once the
// average covers at least half the ECTS today's does: a first lone grade (an
// absence counted 0…) would otherwise open on a meaningless cliff. The whole
// curve is shifted so its last point is `currentAverage` (the card's value:
// ScoDoc's bonus and rounding stay in). Fewer than two points: no curve.
export function computeAverageHistory(releve, currentAverage = null) {
  const days = new Set()
  for (const sectionKey of ['ressources', 'saes']) {
    for (const module of Object.values(releve?.[sectionKey] ?? {})) {
      for (const evaluation of module?.evaluations ?? []) {
        const day = readEvaluationDay(evaluation)
        if (day && readCountedGrade(evaluation?.note?.value) != null) days.add(day)
      }
    }
  }

  const points = []
  for (const day of [...days].sort()) {
    const upToDay = { ...releve }
    for (const sectionKey of ['ressources', 'saes']) {
      upToDay[sectionKey] = Object.fromEntries(Object.entries(releve?.[sectionKey] ?? {}).map(([code, module]) => [
        code,
        { ...module, evaluations: (module?.evaluations ?? []).filter((evaluation) => (readEvaluationDay(evaluation) ?? '') <= day) },
      ]))
    }
    const { average, ects } = weightUesByEcts(releve, computeUeAverages(upToDay))
    if (average != null) points.push({ date: day, average, ects })
  }

  const finalEcts = points[points.length - 1]?.ects ?? 0
  const covered = points.filter((point) => point.ects >= finalEcts / 2)
  if (covered.length < 2) return []
  const offset = currentAverage != null ? currentAverage - covered[covered.length - 1].average : 0
  return covered.map((point) => ({ date: point.date, average: clampGrade(point.average + offset) }))
}

// "New since last visit": evaluations whose grade signature (id + value)
// isn't in `seenSignatures`. A semester never seen before has nothing new.
export function gradeSignature(evaluation) {
  return `${evaluation.id}:${evaluation.grade.kind === 'number' ? evaluation.grade.value : evaluation.grade.kind}`
}

export function findNewGrades(report, seenSignatures) {
  if (!Array.isArray(seenSignatures)) {
    return new Set()
  }

  const seen = new Set(seenSignatures)
  return new Set([...report.resources, ...report.saes]
    .flatMap((module) => module.evaluations)
    .filter((evaluation) => evaluation.grade.kind === 'number' && !seen.has(gradeSignature(evaluation)))
    .map((evaluation) => evaluation.id))
}

export function listGradeSignatures(report) {
  return [...report.resources, ...report.saes]
    .flatMap((module) => module.evaluations)
    .map(gradeSignature)
}

// Semester picker entries, newest first (ScoDoc lists them oldest first).
export function listGradesSemesters(semestres) {
  return (Array.isArray(semestres) ? semestres : [])
    .filter((semester) => semester?.formsemestre_id != null)
    .map((semester) => ({
      id: String(semester.formsemestre_id),
      number: semester.semestre_id ?? null,
      title: String(semester.titre ?? '').trim() || null,
      year: String(semester.annee_scolaire ?? '').trim() || null,
    }))
    .reverse()
}

// 13.5 → "13h30", as the passerelle writes absence hours.
export function formatHour(value) {
  const number = parseGradeNumber(value)
  if (number == null) {
    return ''
  }

  const hours = Math.floor(number)
  const minutes = Math.round((number - hours) * 60)
  return `${hours}h${String(minutes).padStart(2, '0')}`
}

function formatDuration(hours) {
  if (hours <= 0) return '0h'
  const formatted = formatHour(hours)
  return formatted.endsWith('h00') ? formatted.slice(0, -2) : formatted
}

function findModuleLabel(releve, subject) {
  if (Number.isInteger(subject)) {
    const entry = Object.entries({ ...releve?.ressources, ...releve?.saes })
      .find(([, module]) => module?.id === subject)
    return entry ? `${entry[0]} – ${entry[1].titre}` : null
  }

  const text = String(subject ?? '').trim()
  return text || null
}

function formatTeacher(value) {
  const name = String(value ?? '').split('@')[0].split('.').join(' ').trim()
  return name ? name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : null
}

const ABSENCE_TOTAL_UNITS = {
  heure: (value) => `${formatGrade(value)}h`,
  demi: (value) => `${formatGrade(value)} demi-journée${value > 1 ? 's' : ''}`,
  journee: (value) => `${formatGrade(value)} journée${value > 1 ? 's' : ''}`,
  compte: (value) => formatGrade(value),
}

// The "Rapport d'absences": same visibility rules and totals as the passerelle.
export function buildAbsenceReport(payload, releve, config) {
  const department = getReleveDepartment(releve)
  if (config && (!config.afficher_absences || !isDepartmentListed(config.liste_dep_publi_absences, department))) {
    return { visible: false }
  }

  const totals = { justified: 0, unjustified: 0, late: 0 }
  const entries = []
  // Numeric start hour per entry: the formatted "8h00" sorts after "10h00".
  const startHours = new Map()
  let spansSeveralDays = false

  for (const [date, list] of Object.entries(payload?.absences ?? {})) {
    for (const absence of Array.isArray(list) ? list : []) {
      if (!absence || absence.statut === 'present') continue

      const start = parseGradeNumber(absence.debut) ?? 0
      const end = parseGradeNumber(absence.fin) ?? start
      const justified = absence.justifie === true || absence.justifie === 'true'
      const status = justified ? 'justified' : absence.statut === 'retard' ? 'late' : 'unjustified'

      if (justified) totals.justified += end - start
      else if (status === 'late') totals.late += 1
      else totals.unjustified += end - start

      const endDate = absence.dateFin && absence.dateFin !== date ? absence.dateFin : null
      if (endDate) spansSeveralDays = true

      const entry = {
        id: `${date}-${start}-${entries.length}`,
        date,
        endDate,
        start: formatHour(start),
        end: formatHour(end),
        subject: findModuleLabel(releve, absence.matiereComplet),
        teacher: formatTeacher(absence.enseignant),
        status,
      }
      entries.push(entry)
      startHours.set(entry, start)
    }
  }

  entries.sort((left, right) => right.date.localeCompare(left.date) || startHours.get(right) - startHours.get(left))

  let totalLabels = {
    justified: formatDuration(totals.justified),
    unjustified: formatDuration(totals.unjustified),
    late: String(totals.late),
  }

  // ScoDoc's own totals, in the unit the passerelle is configured for.
  const scodocTotals = payload?.totauxAbsences?.absent
  const unit = config?.metrique_absences
  if (scodocTotals && ABSENCE_TOTAL_UNITS[unit]) {
    const justified = parseGradeNumber(scodocTotals.justifie?.[unit])
    const unjustified = parseGradeNumber(scodocTotals.non_justifie?.[unit])
    totalLabels = {
      ...totalLabels,
      ...(justified != null ? { justified: ABSENCE_TOTAL_UNITS[unit](justified) } : null),
      ...(unjustified != null ? { unjustified: ABSENCE_TOTAL_UNITS[unit](unjustified) } : null),
    }
  }

  return {
    visible: true,
    notice: htmlToPlainText(config?.message_rapport_absences) || null,
    entries,
    // Hour totals mean nothing once an absence spans several days.
    totals: spansSeveralDays && !scodocTotals ? null : totalLabels,
  }
}

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  euro: '€',
  rsquo: '’',
  laquo: '«',
  raquo: '»',
}

// ScoDoc messages and appreciations are HTML written by staff. The page shows
// them as text (line breaks kept) rather than injecting markup.
export function htmlToPlainText(html) {
  if (html == null) {
    return ''
  }

  return String(html)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
      }
      return HTML_ENTITIES[name.toLowerCase()] ?? entity
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
