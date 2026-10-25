import { useMemo } from 'react'
import { buildGradesReport, summarizeAverage } from '../gradesReport'
import { formatRank, nameGroupRanks } from '../gradesSubjects'
import AverageSparkline from './AverageSparkline'
import CardInfoTip from './CardInfoTip'
import {
  DEMO_AVERAGE_GRADE,
  GRADES_DISABLED_PILL_LABEL,
  GRADES_FEATURE_DISABLED,
  GRADES_UNAVAILABLE_DETAIL,
  GRADES_UNAVAILABLE_MESSAGE,
  GRADES_UNAVAILABLE_TITLE,
  positionGradeTooltipFromElement,
  positionGradeTooltipFromPointer,
} from '../gradeFeatureState'

// Card on the "Mes notes" page: the Figma width (443), at least 20px taller
// than its 168 so the evolution line keeps a clear gap above the number (the
// ECTS card beside it matches), stretched to its row. On phones the first,
// widest card of the overview's strip, its texts a size down to fit.
const CARD_CLASSES = 'average-grade-widget widget-card shadow-md w-full max-w-[443px] min-h-[188px] p-4 border card-corners overflow-hidden text-base leading-6 min-w-0 max-md:w-auto max-md:max-w-none max-md:min-h-[160px] max-md:flex-[1_0_clamp(140px,50%,200px)] max-md:snap-start max-md:p-3 relative'

function AverageGradeHeader({ estimated = false, final = false }) {
  return (
    <div className="relative z-10 flex items-center gap-[5px] min-w-0">
      <span className="m-0 min-w-0 leading-[1.06] text-base font-medium text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[14px]">
        Moyenne<span className="max-md:hidden"> Générale</span>
      </span>
      {/* Only when the department hides ScoDoc's average and the card shows the estimate. */}
      {estimated ? (
        <CardInfoTip label="Moyenne approximative : pourquoi ?">
          Moyenne approximative : ton département masque la moyenne officielle. Elle est recalculée à partir de tes moyennes d’UE, pondérées par leurs ECTS.
        </CardInfoTip>
      ) : null}
      {/* The jury has ruled (ScoDoc's decision on the semester or its year). */}
      {final ? (
        <span className="ml-[3px] inline-flex shrink-0 items-center rounded-full bg-brand-subtle px-2 py-[4px] font-body text-[12px] font-semibold leading-none text-text max-md:ml-0 max-md:px-[7px] max-md:text-[11px]">
          {/* "Moyenne finale" on a phone too: the title beside it reads "Moyenne". */}
          <span className="max-md:hidden">Moyenne finale</span>
          <span className="md:hidden">finale</span>
        </span>
      ) : null}
    </div>
  )
}

// The semester rank, only when the department shows ranks; its rank in each
// group in a tip, when ScoDoc gives them.
function SemesterRank({ rank, groups }) {
  return (
    <span className="flex min-w-0 items-center gap-[4px] leading-[1.06] text-[14px] font-medium text-text-muted max-md:text-[12px]">
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{rank.text}</span>
      {groups.length ? (
        <span className="pointer-events-auto inline-flex">
          <CardInfoTip label="Ton rang dans tes groupes">
            <span className="block">Dans tes groupes :</span>
            {groups.map((group) => (
              <span key={group.name} className="block">{group.name} : {formatRank(group).text.replace(/^Rang /, '')}</span>
            ))}
          </CardInfoTip>
        </span>
      ) : null}
    </span>
  )
}

// The average sits at the bottom left like the latest grade's value, with the
// promo average (and the rank, if shown) under it. Pointer events pass through
// to the evolution line drawn behind (its hover), and on to the card.
function AverageGradeValues({ avgDisplay, promoDisplay, ranks = null }) {
  return (
    <div className="pointer-events-none relative z-10 flex-1 flex flex-col gap-[5px] justify-end min-w-0">
      <div className="flex items-end gap-[3px] leading-[1.06]">
        <span className="font-display text-[37px] font-bold leading-none whitespace-nowrap max-md:text-[clamp(26px,8vw,32px)]">{avgDisplay}</span>
        <span className="text-[19px] font-medium leading-[1.06] whitespace-nowrap pb-[3px] max-md:pb-[2px] max-md:text-[15px]">/20</span>
      </div>
      {promoDisplay ? (
        <span className="m-0 leading-[1.06] text-[15px] font-semibold min-w-0 overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[13px]">
          <span className="max-md:hidden">Moy. </span>Promo : {promoDisplay}
        </span>
      ) : null}
      {ranks ? <SemesterRank rank={ranks.rank} groups={ranks.groups} /> : null}
    </div>
  )
}

// features.grades === 'disabled': demo numbers, blurred, behind an
// "unavailable" pill. No data is fetched.
function DisabledWidgetAverageGrade({ visible }) {
  const avgDisplay = String(parseFloat(DEMO_AVERAGE_GRADE.average))
  const promoDisplay = String(parseFloat(DEMO_AVERAGE_GRADE.promoAverage))

  return (
    <article
      className={`${CARD_CLASSES} grade-feature-disabled ${visible ? 'widget-card-visible' : ''}`}
      aria-label={`Moyenne générale indisponible: ${GRADES_UNAVAILABLE_MESSAGE}`}
      aria-disabled="true"
      tabIndex={0}
      onFocus={positionGradeTooltipFromElement}
      onPointerMove={positionGradeTooltipFromPointer}
    >
      <div className="grade-disabled-content flex h-full flex-col gap-[6px]">
        <AverageGradeHeader />
        <AverageGradeValues avgDisplay={avgDisplay} promoDisplay={promoDisplay} />
      </div>
      <span className="grade-disabled-pill" aria-hidden="true">{GRADES_DISABLED_PILL_LABEL}</span>
      <span className="grade-disabled-hover-note" role="tooltip">
        <span className="grade-disabled-hover-title">{GRADES_UNAVAILABLE_TITLE}</span>
        <span className="grade-disabled-hover-detail">{GRADES_UNAVAILABLE_DETAIL}</span>
      </span>
    </article>
  )
}

// features.grades === true: the semester average and the promo's, from the
// relevé the page passes in (the semester picked on "Mes notes"). Not a
// link: the card is read where it is, nothing to open on ScoDoc. Renders
// nothing without an average.
function LiveWidgetAverageGrade({ releve, visible }) {
  const data = useMemo(() => (releve ? summarizeAverage(releve) : null), [releve])
  // buildGradesReport leaves ranks out when the department hides them.
  const ranks = useMemo(() => {
    const report = releve ? buildGradesReport(releve) : null
    const rank = report?.status === 'ok' ? formatRank(report.rank) : null
    return rank ? { rank, groups: nameGroupRanks(report.groupRanks, releve.semestre?.groupes) } : null
  }, [releve])

  if (!data) {
    return null
  }

  const avgDisplay = String(parseFloat(data.average.toFixed(2)))
  const promoDisplay = data.promoAverage != null ? String(parseFloat(data.promoAverage.toFixed(2))) : null

  return (
    <article
      className={`${CARD_CLASSES} border-white bg-widget-bg flex flex-col gap-[6px] text-text ${visible ? 'widget-card-visible' : ''}`}
      aria-label={`Moyenne générale${data.estimated ? ' approximative' : ''}: ${avgDisplay} sur 20${promoDisplay ? ` (promo: ${promoDisplay})` : ''}${ranks ? `, ${ranks.rank.spoken.toLowerCase()}` : ''}`}
    >
      {data.history?.length ? (
        // Behind the title and the number: from under the title to the bottom edge.
        <AverageSparkline history={data.history} semesterEnd={data.semesterEnd} className="absolute inset-x-0 top-[38px] bottom-0 max-md:top-[32px]" />
      ) : null}
      <AverageGradeHeader estimated={Boolean(data.estimated)} final={data.final} />
      <AverageGradeValues avgDisplay={avgDisplay} promoDisplay={promoDisplay} ranks={ranks} />
    </article>
  )
}

function WidgetAverageGrade({ releve = null, visible = false }) {
  if (GRADES_FEATURE_DISABLED) {
    return <DisabledWidgetAverageGrade visible={visible} />
  }

  return <LiveWidgetAverageGrade releve={releve} visible={visible} />
}

export default WidgetAverageGrade
