import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { navigateTo } from '../appRoute'
import { useWidgetLoadReport } from '../analytics'
import { getAbsencesSummary, getRequestErrorKind } from '../entApi'
import {
  DEMO_ABSENCES,
  GRADES_DISABLED_PILL_LABEL,
  GRADES_FEATURE_DISABLED,
  GRADES_UNAVAILABLE_DETAIL,
  GRADES_UNAVAILABLE_MESSAGE,
  GRADES_UNAVAILABLE_TITLE,
  positionGradeTooltipFromElement,
  positionGradeTooltipFromPointer,
} from '../gradeFeatureState'

const CARD_CLASSES = 'absences-widget widget-card shadow-md flex-[0_1_280px] h-[140px] p-4 border rounded-[22px] overflow-hidden text-base leading-6 min-w-0 max-2xl:flex-[1_1_calc(50%-6px)] max-2xl:min-w-0 max-md:h-[124px] max-md:p-3 max-md:rounded-[20px] max-xs:flex-[1_1_calc(50%-4px)] max-xs:h-[140px] relative'

function AbsencesHeader({ badge = null }) {
  return (
    <div className="flex items-center justify-between min-w-0 pr-4">
      <span className="m-0 min-w-0 leading-[1.06] text-base font-medium text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[15px]">
        Absences
      </span>
      {badge}
    </div>
  )
}

function AbsencesValue({ value, unitLabel, hasUnjustified = false }) {
  const barColor = hasUnjustified ? '#ef4444' : '#10b981'

  return (
    <div className="flex items-center gap-[8px] max-md:items-end">
      <div
        className="w-[6px] h-[39px] rounded-[25px] shrink-0 relative overflow-hidden max-md:h-[34px]"
        style={{ background: barColor }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 rounded-[25px]"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 70%)' }}
        />
      </div>
      <div className="flex items-baseline gap-[6px] leading-[1.06]">
        <span
          className={`font-display text-[37px] font-bold leading-none whitespace-nowrap max-md:text-[32px] ${
            hasUnjustified ? 'text-error' : 'text-text'
          }`}
        >
          {value}
        </span>
        <span className="text-[13px] font-semibold text-text-muted whitespace-nowrap">
          {unitLabel}
        </span>
      </div>
    </div>
  )
}

function DisabledWidgetAbsences({ visible }) {
  const data = DEMO_ABSENCES

  return (
    <article
      className={`${CARD_CLASSES} grade-feature-disabled ${visible ? 'widget-card-visible' : ''}`}
      aria-label={`Absences indisponibles: ${GRADES_UNAVAILABLE_MESSAGE}`}
      aria-disabled="true"
      tabIndex={0}
      onFocus={positionGradeTooltipFromElement}
      onPointerMove={positionGradeTooltipFromPointer}
    >
      <div className="grade-disabled-content flex h-full flex-col justify-between">
        <AbsencesHeader
          badge={
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-success-bg text-success-text">
              À jour
            </span>
          }
        />
        <div className="flex-1 flex flex-col justify-end gap-[6px]">
          <AbsencesValue value={data.unjustified} unitLabel="injustifiée" hasUnjustified={false} />
          <div className="flex items-center justify-between text-[12px] font-semibold text-text-muted">
            <span>Justifiées : {data.justified}</span>
            <span>Retards : {data.late}</span>
          </div>
        </div>
      </div>
      <span className="grade-disabled-pill" aria-hidden="true">{GRADES_DISABLED_PILL_LABEL}</span>
      <span className="grade-disabled-hover-note" role="tooltip">
        <span className="grade-disabled-hover-title">{GRADES_UNAVAILABLE_TITLE}</span>
        <span className="grade-disabled-hover-detail">{GRADES_UNAVAILABLE_DETAIL}</span>
      </span>
    </article>
  )
}

function LiveWidgetAbsences({ visible }) {
  const [data, setData] = useState(null)
  const [loadOutcome, setLoadOutcome] = useState(null)
  useWidgetLoadReport('absences', loadOutcome)

  useEffect(() => {
    let mounted = true
    let retryTimer = null

    const load = (attempt) => {
      getAbsencesSummary()
        .then((result) => {
          if (!mounted) return
          if (result && !result.error) {
            setData(result)
            setLoadOutcome({ status: 'ok' })
          } else if (attempt === 0 && !result?.disabled) {
            retryTimer = window.setTimeout(() => load(1), 3000)
          } else if (!result?.disabled) {
            setLoadOutcome(result?.empty ? { status: 'empty' } : { status: 'error', errorKind: result?.errorKind })
          }
        })
        .catch((error) => {
          if (!mounted) return
          if (attempt === 0) {
            retryTimer = window.setTimeout(() => load(1), 3000)
          } else {
            setLoadOutcome({ status: 'error', errorKind: getRequestErrorKind(error) })
          }
        })
    }

    load(0)
    return () => {
      mounted = false
      window.clearTimeout(retryTimer)
    }
  }, [])

  if (!data) {
    return null
  }

  const isUnpublished = Boolean(data.unpublished)
  const hasUnjustified = data.unjustifiedCount > 0
  const unjustifiedValue = isUnpublished ? '—' : (data.totals?.unjustified ?? `${data.unjustifiedCount}`)
  const justifiedValue = data.totals?.justified ?? `${data.justifiedCount}`
  const lateValue = data.totals?.late ?? `${data.lateCount}`

  const handleOpenAbsences = () => {
    navigateTo('absences')
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleOpenAbsences()
    }
  }

  const badge = isUnpublished ? (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-bg-subtle text-text-muted">
      Non publiées
    </span>
  ) : hasUnjustified ? (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-error-bg text-error">
      À justifier
    </span>
  ) : data.totalCount === 0 ? (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-success-bg text-success-text">
      Aucune
    </span>
  ) : (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-success-bg text-success-text">
      À jour
    </span>
  )

  const unitLabel = isUnpublished ? 'absences' : `injustifiée${data.unjustifiedCount > 1 ? 's' : ''}`

  return (
    <article
      className={`${CARD_CLASSES} border-white bg-widget-bg flex flex-col justify-between text-text cursor-pointer ${
        visible ? 'widget-card-visible' : ''
      }`}
      aria-label={`Absences: ${unjustifiedValue} ${unitLabel} - Ouvrir mes absences`}
      role="link"
      tabIndex={0}
      onClick={handleOpenAbsences}
      onKeyDown={handleKeyDown}
    >
      <Icon
        icon="carbon:chevron-right"
        className="grade-corner-arrow absolute top-[14px] right-[14px] w-[15px] h-[15px] text-text opacity-0 transition-opacity duration-150 ease-in-out shrink-0"
        aria-hidden="true"
      />
      <AbsencesHeader badge={badge} />
      <div className="flex-1 flex flex-col justify-end gap-[6px]">
        <AbsencesValue
          value={unjustifiedValue}
          unitLabel={unitLabel}
          hasUnjustified={hasUnjustified}
        />
        {isUnpublished ? (
          <div className="text-[12px] font-semibold text-text-muted">
            Non publiées par le département
          </div>
        ) : data.totalCount === 0 ? (
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-success-text">
            <Icon icon="carbon:checkmark-outline" className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Aucune absence enregistrée</span>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[12px] font-semibold text-text-muted">
            <span>Justifiées : {justifiedValue}</span>
            <span>Retards : {lateValue}</span>
          </div>
        )}
      </div>
    </article>
  )
}

function WidgetAbsences({ visible = false }) {
  if (GRADES_FEATURE_DISABLED) {
    return <DisabledWidgetAbsences visible={visible} />
  }

  return <LiveWidgetAbsences visible={visible} />
}

export default WidgetAbsences
