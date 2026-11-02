import { useMemo, useState } from 'react'
import assiduityIcon from '../assets/home-icons/assiduity.png'
import { buildAbsenceReport, formatDuration } from '../gradesReport'
import {
  buildSemesterTimeline,
  countAbsencesByStatus,
  formatTimeLeft,
  listOpenJustifications,
  readJustificationWindow,
  sumAbsenceHours,
} from '../assiduity'
import { Skeleton } from 'skullet/react'
import { useSkeletonsForced } from '../skeletonSamples'

// « Accueil »'s « Assiduité » card: the newest semester's absences from
// the relevé (buildAbsenceReport, the passerelle's rules), as the
// « Assiduité » page tops them. The hours not justified, big (red when
// some); the hours missed and the lateness; the semester as a line, each
// absence a mark on its day, today a tick; the soonest delay still open
// to justify one (when the department's notice gives one). The whole card
// opens « Assiduité » (HomeDraftPage). Nothing when the department doesn't
// publish absences, or without a relevé.

const CARD_CLASSES = 'widget-card widget-card-visible @container/assiduity flex flex-col gap-3 border border-white bg-widget-bg p-4 text-text shadow-md card-corners max-md:p-3'

function Header() {
  return (
    <div className="flex min-w-0 items-center gap-[5px]">
      <img src={assiduityIcon} alt="" width="22" height="22" draggable="false" className="mr-[3px] size-[22px] shrink-0 select-none" aria-hidden="true" />
      <span className="min-w-0 truncate text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">Assiduité</span>
    </div>
  )
}

// While the relevé loads: the figures' skeleton (skullet), measured from
// sample ones, so nothing moves when they come in.
export function AssiduityPlaceholder() {
  return (
    <article className={CARD_CLASSES} aria-label="Assiduité, chargement" aria-busy="true">
      <Header />
      <Skeleton loading label="Chargement de l’assiduité" className="mt-auto">
        <div className="flex min-w-0 flex-col gap-[5px]">
          <div className="flex items-end gap-[6px] leading-[1.06]">
            <span className="font-display text-[37px] font-bold leading-none whitespace-nowrap max-md:text-[clamp(28px,8vw,34px)]">2h</span>
            <span className="pb-[3px] text-[15px] font-semibold leading-[1.06] whitespace-nowrap max-md:text-[14px]">non justifiées</span>
          </div>
          <span className="min-w-0 truncate text-[14px] font-medium leading-[1.2] text-text-muted max-md:text-[13px]">6h manquées · 1 retard</span>
        </div>
      </Skeleton>
    </article>
  )
}

// The semester line, small: no names, no buttons (the card is the link).
function MiniLine({ timeline }) {
  return (
    <div className="relative px-[5px]" aria-hidden="true">
      <div className="relative h-[30px]">
        <span className="assiduity-track absolute inset-x-0 bottom-[8px] h-[6px] rounded-full" />
        <span className="assiduity-elapsed assiduity-fill absolute left-0 bottom-[8px] h-[6px] rounded-full" style={{ width: `${timeline.elapsed}%` }} />
        {timeline.today != null ? (
          <span className="assiduity-today absolute bottom-[2px] h-[18px] w-[4px] -translate-x-1/2 rounded-full" style={{ left: `${timeline.today}%` }} />
        ) : null}
        {timeline.marks.map((mark, index) => (
          <span key={mark.id} className="absolute" style={{ left: `${mark.position}%`, bottom: `${8 + mark.stack * 11}px` }}>
            <span className={`assiduity-mark is-${mark.status}`} style={{ '--mark-order': index }} />
          </span>
        ))}
      </div>
      <div className="relative h-[12px]">
        {timeline.months.map((month) => (
          <span key={month.key} className="absolute top-0 whitespace-nowrap font-body text-[10px] font-semibold uppercase leading-none tracking-[0.04em] text-text-muted" style={{ left: `${month.position}%` }}>
            {month.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// `payload`: the grades answer (the relevé's semester, its `absences`);
// `status`: 'loading', 'ok', 'empty', 'error' (HomeDraftPage's grades).
function WidgetAssiduity({ payload, releve, config, status }) {
  const skeletonsForced = useSkeletonsForced()
  // Read once: the card is redrawn as the page loads, the line stays put.
  const [now] = useState(() => new Date())
  const report = useMemo(() => (releve ? buildAbsenceReport(payload, releve, config) : null), [payload, releve, config])
  const entries = useMemo(() => (report?.visible ? report.entries : []), [report])
  const sums = useMemo(() => sumAbsenceHours(entries), [entries])
  const counts = useMemo(() => countAbsencesByStatus(entries), [entries])
  const timeline = useMemo(() => buildSemesterTimeline({
    start: releve?.semestre?.date_debut,
    end: releve?.semestre?.date_fin,
    entries,
    now,
  }), [releve, entries, now])
  const open = useMemo(() => listOpenJustifications(entries, readJustificationWindow(report?.notice), now), [entries, report, now])

  if (status === 'loading' || skeletonsForced) return <AssiduityPlaceholder />
  if (!report?.visible) return null

  const missed = sums.justified + sums.unjustified
  const unjustified = report.totals?.unjustified ?? formatDuration(sums.unjustified)
  const hasUnjustified = sums.unjustified > 0 || counts.unjustified > 0
  const details = entries.length
    ? [
        missed > 0 ? `${formatDuration(missed)} manquées` : null,
        counts.late ? `${counts.late} retard${counts.late > 1 ? 's' : ''}` : null,
      ].filter(Boolean).join(' · ')
    : 'Aucune absence ce semestre'
  const soonest = open[0] ?? null

  return (
    <article
      className={CARD_CLASSES}
      aria-label={`Assiduité : ${unjustified} non justifiées${details ? `, ${details}` : ''}${soonest ? `, ${formatTimeLeft(soonest.hoursLeft)} pour justifier` : ''}`}
    >
      <Header />
      {/* The figures, then the line beside them on a wide card, under them
          on a narrow one. */}
      <div className="mt-auto flex flex-col gap-3 @min-[460px]/assiduity:flex-row @min-[460px]/assiduity:items-end @min-[460px]/assiduity:gap-6">
        <div className="flex min-w-0 shrink-0 flex-col gap-[5px]">
          <div className="flex items-end gap-[6px] leading-[1.06]">
            <span className={`font-display text-[37px] font-bold leading-none whitespace-nowrap max-md:text-[clamp(28px,8vw,34px)] ${hasUnjustified ? 'text-error' : 'text-text'}`}>{unjustified}</span>
            <span className="pb-[3px] text-[15px] font-semibold leading-[1.06] whitespace-nowrap max-md:text-[14px]">non justifiées</span>
          </div>
          <span className="min-w-0 truncate text-[14px] font-medium leading-[1.2] text-text-muted max-md:text-[13px]">{details}</span>
        </div>
        {timeline ? <div className="min-w-0 flex-1"><MiniLine timeline={timeline} /></div> : null}
      </div>
      {soonest ? (
        <span className="status-tag status-tag--error inline-flex min-w-0 items-center gap-1.5 self-start rounded-full px-2.5 py-[6px] font-body text-[13px] font-semibold leading-none text-error">
          <span className="whitespace-nowrap">{formatTimeLeft(soonest.hoursLeft)} pour justifier</span>
          {soonest.entry.subjectTitle ? <span className="min-w-0 truncate font-medium opacity-80">· {soonest.entry.subjectTitle}</span> : null}
        </span>
      ) : null}
    </article>
  )
}

export default WidgetAssiduity
