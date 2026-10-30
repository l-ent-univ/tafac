import { useEffect, useMemo, useState } from 'react'
import { useWidgetLoadReport } from '../analytics'
import { GRADES_LAUNCH_HREF, getLatestGrade, getRequestErrorKind, openGradesService } from '../entApi'
import universityConfig from '@university'
import { buildUeWash, formatGradeDay } from '../gradesSubjects'
import { gradeCopyText } from '../contextMenuItems'
import { copyToClipboard, useContextMenu } from '../useContextMenu'
import { assignSubjectIcons } from '../subjectIcons'
import { readSeenEvaluationIds } from '../seenGrades'
import { useUeColor } from '../useUeColor'
import { LatestGradeCardBody } from './LatestGradesList'
import {
  DEMO_LATEST_GRADE,
  GRADES_DISABLED_PILL_LABEL,
  GRADES_FEATURE_DISABLED,
  GRADES_UNAVAILABLE_DETAIL,
  GRADES_UNAVAILABLE_MESSAGE,
  GRADES_UNAVAILABLE_TITLE,
  positionGradeTooltipFromElement,
  positionGradeTooltipFromPointer,
} from '../gradeFeatureState'

// On phones the card shares its row with "Prochain cours" (same height, exact
// halves), so the module code moves under the evaluation title.
const CARD_CLASSES = 'latest-grade-widget isolate widget-card shadow-md flex-[0_1_280px] h-[140px] p-4 border card-corners overflow-hidden text-base leading-6 min-w-0 max-2xl:flex-[1_1_calc(50%-6px)] max-2xl:min-w-0 max-md:h-[124px] max-md:p-3 max-xs:flex-[1_1_calc(50%-4px)] max-xs:h-[140px] relative'

function LatestGradeHeader() {
  return (
    <div className="flex items-center gap-[5px] min-w-0">
      <span className="m-0 min-w-0 leading-[1.06] text-base font-medium text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[15px]">Dernière note</span>
    </div>
  )
}

function LatestGradeValue({ noteDisplay, noteMax, accentColor = null }) {
  return (
    <div className="flex items-start gap-[5px] max-md:items-end">
      <div
        className="w-[6px] h-[39px] corners-[25px] shrink-0 relative overflow-hidden max-md:h-[34px]"
        style={accentColor ? { background: accentColor } : undefined}
        aria-hidden="true"
      >
        {accentColor ? (
          <div className="absolute inset-0 corners-[25px]" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 70%)' }} />
        ) : (
          <div className="absolute inset-0 corners-[25px] bg-black dark:bg-white" />
        )}
      </div>
      <div className="flex items-end gap-[3px] leading-[1.06]">
        <span className="font-display text-[37px] font-bold leading-none whitespace-nowrap max-md:text-[32px]">{noteDisplay}</span>
        <span className="text-[19px] font-medium leading-[1.06] whitespace-nowrap pb-[3px] max-md:text-[17px]">/{noteMax}</span>
      </div>
    </div>
  )
}

// features.grades === 'disabled': demo grade, blurred, behind an
// "unavailable" pill. No data is fetched.
function DisabledWidgetLatestGrade({ visible }) {
  const grade = DEMO_LATEST_GRADE
  const noteDisplay = String(parseFloat(grade.note))
  const noteMax = String(Math.round(parseFloat(grade.noteSur)))

  return (
    <article
      className={`${CARD_CLASSES} grade-feature-disabled ${visible ? 'widget-card-visible' : ''}`}
      aria-label={`Dernière note indisponible: ${GRADES_UNAVAILABLE_MESSAGE}`}
      aria-disabled="true"
      tabIndex={0}
      onFocus={positionGradeTooltipFromElement}
      onPointerMove={positionGradeTooltipFromPointer}
    >
      <div className="grade-disabled-content flex h-full flex-col gap-[6px]">
        <LatestGradeHeader />
        <div className="flex-1 flex flex-col gap-[5px] justify-end">
          <LatestGradeValue noteDisplay={noteDisplay} noteMax={noteMax} />
          <div className="flex items-end justify-between gap-2 min-w-0 max-xs:flex-col max-xs:items-start max-xs:gap-[3px]">
            <span className="m-0 leading-[1.06] text-[15px] font-semibold min-w-0 overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[14px] max-xs:max-w-full">{grade.description}</span>
            <span className="m-0 leading-[1.06] text-[12px] font-semibold text-text-muted shrink-0 max-w-[34%] overflow-hidden text-ellipsis whitespace-nowrap text-right max-xs:max-w-full max-xs:text-left">{grade.resource}</span>
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

// features.grades === true: the latest ScoDoc evaluation as a "Dernières
// notes" card of "Mes notes" (LatestGradeCardBody: subject icon, name, day,
// evaluation, grade pill, UE wash), "Nouveau" until read there. A click opens
// it there (onOpenGrade), or the grade service without the in-app page.
// Renders nothing until data is available (or on error).
function LiveWidgetLatestGrade({ visible, user = null, onOpenGrade = null, preview = null }) {
  const [loadedGrade, setGrade] = useState(null)
  const grade = preview ?? loadedGrade
  const [isReady, setIsReady] = useState(false)
  const [loadOutcome, setLoadOutcome] = useState(null)
  useWidgetLoadReport('latestGrade', loadOutcome)

  useEffect(() => {
    if (preview) return undefined
    let mounted = true
    let retryTimer = null

    // One retry after a short delay: a transient ScoDoc hiccup on dashboard
    // load shouldn't hide the card for the whole visit.
    const load = (attempt) => {
      getLatestGrade()
        .then((data) => {
          if (!mounted) return
          if (data && !data.error) {
            setGrade(data)
            setLoadOutcome({ status: 'ok' })
          } else if (attempt === 0 && !data?.disabled) {
            retryTimer = window.setTimeout(() => load(1), 3000)
          } else if (!data?.disabled) {
            setLoadOutcome(data?.empty ? { status: 'empty' } : { status: 'error', errorKind: data?.errorKind })
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
  }, [preview])

  useEffect(() => {
    if (!grade || isReady || !visible) return undefined
    // Grade arrived late (visible is already true): one frame hidden first,
    // then it animates in.
    const frameId = window.requestAnimationFrame(() => setIsReady(true))
    return () => window.cancelAnimationFrame(frameId)
  }, [grade, visible, isReady])

  // The UE wash in the colours "Mes notes" paints (lifted on the dark theme).
  const paintUe = useUeColor()
  // The same icon as on "Mes notes": assigned over all the semester's subjects.
  const icon = useMemo(() => (grade?.subjectTitles
    ? assignSubjectIcons(grade.subjectTitles, universityConfig.appIconStyle)(grade.resourceTitle)
    : null), [grade])

  const opensInApp = Boolean(onOpenGrade)
  const canOpen = !preview && (opensInApp || Boolean(GRADES_LAUNCH_HREF))
  const open = () => (opensInApp ? onOpenGrade(grade) : openGradesService())
  // Its right-click menu (a long press): what a click does, the grade as
  // text.
  const menuProps = useContextMenu(grade && !preview ? () => [
    canOpen ? { id: 'open', label: 'Voir la note', icon: 'carbon:view', onSelect: open } : null,
    {
      id: 'copy',
      label: 'Copier',
      icon: 'carbon:copy',
      onSelect: () => void copyToClipboard(gradeCopyText({
        title: grade.description || grade.resourceTitle,
        value: Number.isFinite(parseFloat(grade.note)) ? parseFloat(grade.note) : grade.note,
        subject: grade.resourceTitle,
      })),
    },
  ] : null)

  if (!grade) {
    return null
  }

  const value = grade.note ? String(parseFloat(grade.note)) : '—'
  const title = grade.description || grade.resourceTitle
  const day = formatGradeDay(grade.date)
  const wash = buildUeWash(grade.weights, Object.fromEntries(Object.entries(grade.ueColors ?? {}).map(([ue, color]) => [ue, paintUe(color)])))
  // Read on each render: coming back from "Mes notes", the badge follows.
  const seen = grade.id != null && !preview ? readSeenEvaluationIds(user, grade.semesterId) : null
  const isNew = Array.isArray(seen) && !seen.map(String).includes(String(grade.id))
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }

  return (
    <article
      className={`${CARD_CLASSES} border-white bg-widget-bg flex flex-col gap-[6px] text-text max-md:gap-1 ${canOpen ? 'cursor-pointer' : ''} ${isReady ? 'widget-card-visible' : ''}`}
      aria-label={`Dernière note${isNew ? ', nouvelle' : ''} : ${value} sur 20, ${title}${grade.typeLabel ? `, ${grade.typeLabel.toLowerCase()}` : ''}${day ? `, le ${day}` : ''} (${grade.resourceTitle})`}
      role={canOpen ? (opensInApp ? 'button' : 'link') : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? open : undefined}
      onKeyDown={canOpen ? handleKeyDown : undefined}
      {...(preview ? null : menuProps())}
    >
      <LatestGradeCardBody
        moduleTitle={grade.resourceTitle}
        moduleCode={grade.resource}
        day={day}
        title={title}
        value={value}
        icon={icon}
        wash={wash}
        typeLabel={grade.typeLabel ?? null}
        isNew={isNew}
        heading="Dernière note"
      />
    </article>
  )
}

// `preview`: a getLatestGrade() result to show as is (the landing page, which
// changes it): nothing loaded or reported, not clickable.
function WidgetLatestGrade({ visible = false, user = null, onOpenGrade = null, preview = null }) {
  if (GRADES_FEATURE_DISABLED && !preview) {
    return <DisabledWidgetLatestGrade visible={visible} />
  }

  return <LiveWidgetLatestGrade visible={visible} user={user} onOpenGrade={onOpenGrade} preview={preview} />
}

export default WidgetLatestGrade
