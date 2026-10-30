import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { track, trackGradesAction, useGradesPageReport } from '../analytics'
import { downloadGradesReportPdf } from '../entApi'
import { advanceSimulatorReach, describeGradesLoad, toGradesPageSource } from '../gradesAnalytics'
import { buildGradesReport, canDownloadReportPdf, summarizeAverage } from '../gradesReport'
import { hasSimulatableEvaluation } from '../gradeSimulation'
import { findNewEvaluationIds, formatReportUpdate, listGradedEvaluationIds } from '../gradesSubjects'
import { findEvaluation } from '../gradeDetail'
import { prepareGradeMail } from '../gradeMail'
import { readSeenEvaluationIds, writeSeenEvaluationIds } from '../seenGrades'
import { SECONDARY_BUTTON } from '../scodocPageUtils'
import { assignSubjectIcons } from '../subjectIcons'
import { useScodocReleve } from '../useScodocReleve'
import { useHistorySheet } from '../useHistorySheet'
import { useUeColor } from '../useUeColor'
import GradeDetailProvider from './GradeDetailProvider'
import { useGradeDetail } from '../gradeDetailContext'
import GradesExplainer from './GradesExplainer'
import GradeSimulatorModal from './GradeSimulatorModal'
import GradesNotices from './GradesNotice'
import LatestGradesList from './LatestGradesList'
import LoadingDots from './LoadingDots'
import Material from './Material'
import PageEmptyState from './PageEmptyState'
import SemesterSelect from './SemesterSelect'
import SubjectsList from './SubjectsList'
import ServiceNotice from './ServiceNotice'
import UeSubjectsList from './UeSubjectsList'
import WidgetAverageGrade from './WidgetAverageGrade'
import WidgetEcts from './WidgetEcts'
import WidgetUes from './WidgetUes'

// Why the semester has nothing to show, if it doesn't: no relevé, a relevé
// ScoDoc hasn't published (with its own notice), or no grade yet. Mirrors
// what the cards render: an average, or ECTS already awarded.
function readEmptyReason(releve, config) {
  if (!releve) return { kind: 'missing' }
  const report = buildGradesReport(releve, { config })
  if (report.status === 'unpublished') return { kind: 'unpublished', message: report.message }
  if (report.status !== 'ok') return { kind: 'missing' }
  return summarizeAverage(releve) || report.ects?.earned ? null : { kind: 'noGrades' }
}

function semesterName(semester) {
  return semester?.number != null ? `du semestre ${semester.number}` : 'de ce semestre'
}

// "Releve-S3-2026-2027.pdf"
function buildReportFileName(semester, semesterId) {
  const name = semester?.number != null ? `S${semester.number}` : semesterId
  const year = semester?.year ? `-${semester.year.replace(/[^0-9]+/g, '-')}` : ''
  return `Releve-${name}${year}.pdf`
}

// Top-right of the page: ScoDoc's own PDF relevé for the picked semester,
// downloaded through the server (Klaynight's /grades/report.pdf route). Dots
// while ScoDoc builds it; a short notice if it can't.
function ReportPdfButton({ semesterId, semester, releveType }) {
  const [state, setState] = useState('idle')

  useEffect(() => {
    if (state !== 'error') return undefined
    const timeoutId = window.setTimeout(() => setState('idle'), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [state])

  const handleClick = async () => {
    setState('loading')
    try {
      await downloadGradesReportPdf(semesterId, releveType, buildReportFileName(semester, semesterId))
      trackGradesAction('pdf_downloaded')
      setState('idle')
    } catch {
      setState('error')
    }
  }

  return (
    // On a phone: a round icon button at the end of the title's row (its
    // touch area 44px), the error floating under it rather than squeezing
    // the title.
    <div className="ml-auto flex items-center gap-2 self-center max-md:relative max-md:ml-0">
      {state === 'error' ? (
        <span className="font-body text-[13px] font-medium text-text-secondary max-md:absolute max-md:top-full max-md:right-0 max-md:z-10 max-md:mt-2 max-md:whitespace-nowrap max-md:rounded-full max-md:border max-md:border-border max-md:bg-widget-bg max-md:px-3 max-md:py-2 max-md:leading-none max-md:shadow-md" role="alert">
          PDF indisponible<span className="max-md:hidden"> pour le moment</span>
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={state === 'loading'}
        aria-label={`Télécharger le relevé PDF ${semesterName(semester)}`}
        className={`${SECONDARY_BUTTON} cursor-pointer disabled:cursor-wait max-md:relative max-md:size-10 max-md:justify-center max-md:p-0 max-md:shadow-xs max-md:after:absolute max-md:after:-inset-[3px]`}
      >
        {state === 'loading'
          ? <LoadingDots label={null} className="w-4" />
          : <Icon icon="carbon:document-pdf" className="size-4 max-md:size-[18px]" aria-hidden="true" />}
        <span className="max-md:hidden">PDF</span>
      </button>
    </div>
  )
}

// Next to the PDF, in the same material with the semester's UE colours as
// its rainbow (none: the brand's): opens the simulation sheet
// (GradeSimulatorModal). On a phone an icon in a round button like the
// PDF's (touch area 44px).
function SimulateButton({ onClick, colors = [] }) {
  return (
    <Material
      rainbow={colors}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label="Simuler mes notes"
      className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 font-body text-[14px] font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand max-md:size-10 max-md:justify-center max-md:p-0 max-md:after:absolute max-md:after:-inset-[3px]"
    >
      <Icon icon="carbon:calculator" className="size-4 max-md:size-[18px]" aria-hidden="true" />
      <span className="max-md:hidden">Simuler</span>
    </Material>
  )
}

// At the foot of the page, muted: how fresh the relevé is ("Mis à jour hier
// à 09:05"). Formatted at render, so "aujourd’hui" stays true.
function ReportUpdate({ value }) {
  const label = formatReportUpdate(value)
  if (!label) return null
  return (
    <time dateTime={value} className="font-body text-[13px] font-medium leading-none text-text-muted">{label}</time>
  )
}

// Inside the detail sheet's provider: opens the sheet on the grade the page
// asks for (the page itself sits outside the provider's context).
function OpenGradeDetail({ request, onHandled }) {
  const detail = useGradeDetail()
  useEffect(() => {
    if (!request || !detail) return
    detail.open({ moduleCode: request.moduleCode, evaluationId: request.evaluationId, isNew: request.isNew, from: request.from })
    onHandled()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, detail])
  return null
}

// "Mes notes": the in-app grades page, opened from the sidebar and the tab
// bar. For now the "Moyenne Générale", "Crédits ECTS" and "UE validées" cards for the
// semester picked next to the title; the relevé UI comes on top of
// gradesReport.js.
// `initialGradeRequest`: a grade to open on arrival (the dashboard's
// "Dernière note"), handed back with onInitialGradeRequestHandled once taken.
// `arrivalSource`: how the student got here, for the anonymous analytics
// (src/gradesAnalytics.js); the page mounts once per arrival.
// `onComposeMail(request)`: App's, the mail page opened on a prefilled
// composer (« Écrire au sujet de cette note »); null without the in-app
// mail page, and the action isn't offered.
function GradesPage({ user = null, arrivalSource = 'other', initialGradeRequest = null, onInitialGradeRequestHandled = () => {}, onComposeMail = null }) {
  const { base, semesters, activeId, activeSemester, selectSemester, entry, releve, config, department, departmentMessage } = useScodocReleve()
  const status = base.status === 'error' ? base : entry
  const empty = useMemo(() => (status.status === 'ok' ? readEmptyReason(releve, config) : null), [status.status, releve, config])
  const report = useMemo(() => (status.status === 'ok' && releve ? buildGradesReport(releve, { config }) : null), [status.status, releve, config])
  // Anonymous analytics: page_viewed, then how the semester it opens on
  // loaded (categories only, never what the relevé holds).
  useGradesPageReport(toGradesPageSource(arrivalSource), describeGradesLoad({
    status: status.status,
    errorKind: status.errorKind,
    unavailable: status.unavailable,
    reportStatus: report?.status,
    emptyKind: empty?.kind,
  }))
  // The semester menu (and its wheel): only an actual change counts.
  const changeSemester = (id) => {
    if (id !== activeId) trackGradesAction('semester_changed')
    selectSemester(id)
  }
  // New grades: the semester's graded evaluations not read yet. The
  // baseline is read once per semester shown, so a background refresh
  // doesn't move the badges. A semester's first visit only records what's
  // there (nothing is new); afterwards an evaluation is marked read when its
  // subject is opened (ids only, never a grade).
  const seenBaseline = useMemo(() => (activeId ? readSeenEvaluationIds(user, activeId) : null), [user, activeId])
  const newEvaluationIds = useMemo(
    () => (report ? findNewEvaluationIds(listGradedEvaluationIds(report), seenBaseline) : new Set()),
    [report, seenBaseline],
  )
  useEffect(() => {
    if (report && activeId && seenBaseline == null) writeSeenEvaluationIds(user, activeId, listGradedEvaluationIds(report))
  }, [report, activeId, user, seenBaseline])
  const markEvaluationsRead = useCallback((ids) => {
    if (!activeId || !ids.length) return
    const seen = readSeenEvaluationIds(user, activeId) ?? []
    writeSeenEvaluationIds(user, activeId, [...new Set([...seen, ...ids])])
  }, [user, activeId])
  // A UE opened full page: the page shows only it (see UeSubjectsList).
  const [ueFocused, setUeFocused] = useState(false)
  // The simulation sheet: a history entry of its own, so Back closes it.
  const simulator = useHistorySheet('tafacGradeSimulator')
  // A "Dernières notes" card or a "Compte pour" link asking for a subject (a
  // new object each time, so the same card can ask twice). One-shot: cleared
  // once the list has taken it, or a list rebuilt later (another semester,
  // the page's sections back) would read it again and open that UE.
  const [gradeRequest, setGradeRequest] = useState(null)
  const openSubjectInUe = (ueCode, moduleCode) => setGradeRequest({ ueCode, moduleCode })
  // A grade to show in its detail sheet (a "Dernières notes" card here, the
  // dashboard's "Dernière note"): opened by OpenGradeDetail inside the
  // sheet's provider. Opening a new grade there reads it.
  // `from`: 'latest' or 'dashboard', for the anonymous analytics.
  const [detailRequest, setDetailRequest] = useState(null)
  const openGradeDetail = ({ evaluationId, moduleCode, from }) => {
    const isNew = newEvaluationIds.has(String(evaluationId))
    if (isNew) markEvaluationsRead([String(evaluationId)])
    setDetailRequest({ evaluationId, moduleCode, isNew, from })
  }
  const openGrade = (grade) => openGradeDetail({ evaluationId: grade.id, moduleCode: grade.moduleCode, from: 'latest' })
  // A grade from the dashboard: it's the newest semester's, so show that
  // one, then open it once its relevé is there.
  useEffect(() => {
    if (!initialGradeRequest) return
    const newestId = semesters[0]?.id
    if (newestId && activeId !== newestId) {
      selectSemester(newestId)
      return
    }
    if (!report) return
    openGradeDetail({ ...initialGradeRequest, from: 'dashboard' })
    onInitialGradeRequestHandled()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGradeRequest, report, activeId, semesters])
  useEffect(() => {
    if (!gradeRequest) return undefined
    // After this commit: the list's effect (a child's, run first) has it.
    const timer = window.setTimeout(() => setGradeRequest(null), 0)
    return () => window.clearTimeout(timer)
  }, [gradeRequest])
  // « Écrire au sujet de cette note »: the mail made from the grade (its
  // image drawn first, src/gradeMail.js), then the mail page. Once at a
  // time: a second press while the image is drawn does nothing.
  const absences = entry.payload?.absences ?? null
  const composingRef = useRef(false)
  const writeAboutGrade = useMemo(() => (onComposeMail && report ? async ({ moduleCode, evaluationId }) => {
    const found = findEvaluation(report, moduleCode, evaluationId)
    if (!found || composingRef.current) return
    composingRef.current = true
    try {
      onComposeMail(await prepareGradeMail({ report, module: found.module, evaluation: found.evaluation, absences }))
    } finally {
      composingRef.current = false
    }
  } : null), [onComposeMail, report, absences])
  const latestGrades = report?.latest ?? []
  // UE code → ScoDoc colour (as painted: lifted on the dark theme), to tint
  // each grade with the UEs it counts for.
  const paintUe = useUeColor()
  const ueColors = useMemo(() => Object.fromEntries((report?.ues ?? []).map((ue) => [ue.code, paintUe(ue.color)])), [report, paintUe])
  const simulateColors = useMemo(() => Object.values(ueColors).filter(Boolean), [ueColors])
  // One icon per subject of the semester, in the tiles' icon set, assigned
  // by module code so a subject keeps its icon as grades come in.
  const subjectIcon = useMemo(() => assignSubjectIcons(
    [...(report?.resources ?? []), ...(report?.saes ?? [])]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((module) => module.title),
    universityConfig.appIconStyle,
  ), [report])
  const subjectCount = (report?.resources?.length ?? 0) + (report?.saes?.length ?? 0)
  // A published relevé (grades or not) of a department that offers the PDF.
  const canExportPdf = status.status === 'ok' && Boolean(releve)
    && (!empty || empty.kind === 'noGrades')
    && canDownloadReportPdf(config, department)
  // Something a simulated grade would move, on a semester the page shows.
  const canSimulate = status.status === 'ok' && !empty && hasSimulatableEvaluation(report)
  // Anonymous analytics of the simulator (simulator_step): `opened` and
  // `closed` follow the sheet itself, however it closes (its buttons,
  // Escape, Back), `closed` with the furthest step reached; the sheet
  // reports the steps in between (onStep).
  const isSimulatorShown = simulator.isOpen && canSimulate
  const simulatorReachedRef = useRef(null)
  useEffect(() => {
    if (isSimulatorShown) {
      simulatorReachedRef.current = advanceSimulatorReach(null, 'opened')
      track('simulator_step', { step: 'opened' })
    } else if (simulatorReachedRef.current) {
      track('simulator_step', { step: 'closed', reached: simulatorReachedRef.current })
      simulatorReachedRef.current = null
    }
  }, [isSimulatorShown])
  const reportSimulatorStep = useCallback((step, details = null) => {
    simulatorReachedRef.current = advanceSimulatorReach(simulatorReachedRef.current, step)
    track('simulator_step', { step, ...details })
  }, [])

  let body
  if (status.status === 'error') {
    body = <p className="m-0 font-body text-[15px] font-medium text-text-secondary" role="alert">{status.error}</p>
  } else if (status.status === 'loading') {
    body = <LoadingDots label="Chargement des notes" className="justify-self-start py-2 text-text-muted" />
  } else if (empty?.kind === 'unpublished') {
    body = (
      <PageEmptyState key={activeId} icon="carbon:document-unknown" title="Relevé pas encore publié">
        {empty.message || `Ton relevé ${semesterName(activeSemester)} n’est pas encore visible sur ScoDoc.`}
      </PageEmptyState>
    )
  } else if (empty?.kind === 'noGrades') {
    body = (
      <PageEmptyState key={activeId} icon="carbon:chart-line" title="Pas encore de notes">
        Tes notes {semesterName(activeSemester)} apparaîtront ici dès qu’elles seront saisies sur ScoDoc.
      </PageEmptyState>
    )
  } else if (empty) {
    body = (
      <PageEmptyState key={activeId} icon="carbon:document-blank" title="Aucun relevé pour ce semestre">
        ScoDoc n’a encore rien publié ici.
      </PageEmptyState>
    )
  } else {
    body = (
      // Keyed by semester: switching replays the cards' arrival (ring fill,
      // pulse) and fades the semester in (.semester-fade).
      // While a UE is open full page, everything else steps aside (null
      // slots, so the list keeps its place in the tree and its state).
      // Any evaluation row opens its grade's detail sheet.
      <GradeDetailProvider report={report} semesterId={activeId} subjectIcon={subjectIcon} onWrite={writeAboutGrade}>
        <OpenGradeDetail request={detailRequest} onHandled={() => setDetailRequest(null)} />
        <div key={activeId} className="semester-fade grid gap-8 max-md:gap-6">
          {/* Titled like the dashboard's sections. */}
          {latestGrades.length && !ueFocused ? (
            <section className="grid gap-3" aria-labelledby="latest-grades-title">
              <div className="flex items-center gap-[5px] text-brand">
                <Icon icon="carbon:recently-viewed" className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
                <h2 id="latest-grades-title" className="m-0 font-body text-base font-medium leading-[1.06]">Dernières notes</h2>
              </div>
              <LatestGradesList grades={latestGrades} ueColors={ueColors} subjectIcon={subjectIcon} onOpen={openGrade} />
            </section>
          ) : null}
          {/* The semester's UEs as tiles, each listing the subjects that feed it. */}
          {subjectCount ? (
            <section className="grid gap-3" aria-labelledby="subjects-title">
              <div className={`flex items-center gap-[5px] text-brand ${ueFocused ? 'sr-only' : ''}`}>
                <Icon icon="carbon:certificate" className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
                <h2 id="subjects-title" className="m-0 font-body text-base font-medium leading-[1.06]">Unités d’enseignement</h2>
                {!ueFocused ? <GradesExplainer ues={report.ues} /> : null}
              </div>
              <UeSubjectsList report={report} subjectIcon={subjectIcon} newEvaluationIds={newEvaluationIds} onReadEvaluations={markEvaluationsRead} onFocusChange={setUeFocused} openRequest={gradeRequest} />
            </section>
          ) : null}
          {/* The same subjects one by one, ressources then SAÉ, each opening
              onto its evaluations. */}
          {subjectCount && !ueFocused ? (
            <section className="grid gap-3" aria-labelledby="subject-list-title">
              <div className="flex items-center gap-[5px] text-brand">
                <Icon icon="carbon:book" className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
                <h2 id="subject-list-title" className="m-0 font-body text-base font-medium leading-[1.06]">Matières et SAÉ</h2>
              </div>
              <SubjectsList report={report} ueColors={ueColors} subjectIcon={subjectIcon} onOpenUe={openSubjectInUe} />
            </section>
          ) : null}
        </div>
      </GradeDetailProvider>
    )
  }

  // The semester at a glance: its cards, then the jury decision and the
  // department message under them (keyed by semester like the body).
  const overview = status.status === 'ok' && !empty && !ueFocused ? (
    <div key={activeId} className="semester-fade grid gap-4 max-md:gap-3">
      {/* On a phone, one row scrolling sideways like "Dernières notes" (snap,
          no scrollbar, to the edges of the page's padding, which leaves room
          for the shadows): the average, "UE validées", then the ECTS (CSS
          order), the next card peeking. Each card sets its width. */}
      <div className="flex flex-wrap items-stretch gap-3 max-md:-mx-3 max-md:-mt-2 max-md:-mb-7 max-md:flex-nowrap max-md:gap-2 max-md:overflow-x-auto max-md:snap-x max-md:snap-mandatory max-md:scroll-px-3 max-md:px-3 max-md:pt-2 max-md:pb-7 favorites-scroll-hide">
        <WidgetAverageGrade releve={releve} visible />
        <WidgetEcts releve={releve} config={config} visible />
        <WidgetUes releve={releve} config={config} visible />
      </div>
      <GradesNotices releve={releve} departmentMessage={departmentMessage} />
    </div>
  ) : null

  return (
    <section className="grades-page w-full grid gap-4 pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5 max-md:gap-3" aria-labelledby="grades-page-title">
      {/* The page's top, tinted apart from the detail below: title, the
          semester's overview and its notices. Plain (no box) while a UE is
          open full page, where it holds only the hidden title. On a phone it
          tops the screen (no app top bar here), a little more room above. */}
      <div className={ueFocused ? 'contents' : 'page-top-band grid gap-5 -mx-6 -mt-4 px-6 pt-4 pb-6 4xl:-mt-5 4xl:pt-5 max-md:-mx-3 max-md:-mt-3 max-md:gap-4 max-md:px-3 max-md:pt-5 max-md:pb-4'}>
        {/* The university's outage notice, as on every tab. */}
        <ServiceNotice />
        {/* On a phone, one row: the title, then the semester chip ("S2"),
            Simuler and the PDF at its end, so nothing wraps. */}
        <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-2 max-md:flex-nowrap max-md:items-center max-md:gap-x-2 ${ueFocused ? 'sr-only' : ''}`}>
          <h1 id="grades-page-title" className="m-0 leading-[1.15] text-2xl font-bold max-md:mr-auto max-md:flex max-md:min-h-10 max-md:min-w-0 max-md:items-center max-md:text-[26px] max-md:tracking-[-0.01em]">Mes notes</h1>
          {!ueFocused ? <SemesterSelect semesters={semesters} value={activeId} onChange={changeSemester} /> : null}
          {(canSimulate || canExportPdf) && !ueFocused ? (
            <div className="ml-auto flex items-center gap-2 self-center max-md:ml-0 max-md:shrink-0">
              {canSimulate ? <SimulateButton onClick={simulator.open} colors={simulateColors} /> : null}
              {canExportPdf ? <ReportPdfButton key={activeId} semesterId={activeId} semester={activeSemester} releveType={releve.type} /> : null}
            </div>
          ) : null}
        </div>
        {/* Without cards (empty states), the notices sit above the page's
            message instead; no decision from an unpublished relevé. */}
        {status.status === 'ok' && empty ? (
          <GradesNotices releve={empty?.kind === 'unpublished' ? null : releve} departmentMessage={departmentMessage} />
        ) : null}
        {overview}
      </div>
      {body}
      {/* At the foot of the page: when ScoDoc produced this relevé (nothing
          if it can't be read, or while a UE is open full page). */}
      {report?.publishedAt && !ueFocused ? (
        <p className="m-0 pt-2 text-center">
          <ReportUpdate value={report.publishedAt} />
        </p>
      ) : null}
      {/* Empty for now: its content is still to be designed. */}
      {isSimulatorShown ? (
        <GradeSimulatorModal report={report} releve={releve} config={config} semester={activeSemester} subjectIcon={subjectIcon} onStep={reportSimulatorStep} onClose={simulator.close} />
      ) : null}
    </section>
  )
}

export default GradesPage
