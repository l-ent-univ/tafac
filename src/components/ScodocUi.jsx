import { Icon } from '@iconify/react'
import { GRADES_LAUNCH_HREF, openGradesService } from '../entApi'
import { CARD_CLASSES, SECONDARY_BUTTON } from '../scodocPageUtils'
import { PRIMARY_BUTTON } from './AppPage'
import { useSlidingIndicator } from '../useSlidingIndicator'
import { SlidingIndicator } from './SlidingIndicator'
import SharedLoadingDots from './LoadingDots'
import { GradesNotice } from './GradesNotice'

// Building blocks shared by the ScoDoc pages ("Mes notes", "Absences").

// A section's title, as on « Mes notes »: an icon and the title in the
// brand colour, a count after it, `aside` at the end of the row.
export function SectionTitle({ id, children, icon = null, count = null, aside = null }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-[5px] text-brand">
        {icon ? <Icon icon={icon} className="w-[17px] h-[17px] shrink-0" aria-hidden="true" /> : null}
        <h2 id={id} className="m-0 font-body text-base font-medium leading-[1.06]">
          {children}
          {count != null ? <span className="ml-1.5 text-text-muted">{count}</span> : null}
        </h2>
      </div>
      {aside ? <div className="ml-auto flex items-center gap-2">{aside}</div> : null}
    </div>
  )
}

// Segmented control whose selection slides from one option to the next.
export function SegmentedControl({ label, options, value, onChange, size = 'md', className = '', style = undefined }) {
  const [groupRef, box] = useSlidingIndicator(`${value}:${options.map((option) => `${option.value}${option.count ?? ''}`).join(',')}`)

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={`relative inline-flex max-w-full gap-1 rounded-full border border-white bg-widget-bg p-1 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-border ${className}`}
      style={style}
    >
      <SlidingIndicator box={box} className="rounded-full bg-accent-bg" />
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-active={selected ? 'true' : undefined}
            onClick={() => onChange(option.value)}
            className={`relative flex shrink-0 flex-col items-center justify-center rounded-full border-0 bg-transparent font-body font-semibold leading-none transition-colors duration-200 ${
              size === 'lg' ? 'gap-1 px-4 py-2' : 'px-3.5 py-1.5 text-[14px]'
            } ${selected ? 'text-accent-text' : 'text-text-secondary hover:text-text'}`}
          >
            <span className={size === 'lg' ? 'text-[15px]' : ''}>
              {option.label}
              {option.count != null ? <span className="ml-1.5 opacity-60">{option.count}</span> : null}
            </span>
            {option.detail ? <span className="text-[11px] font-medium opacity-65">{option.detail}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

// A whole-page state (nothing yet, unavailable…), as PageEmptyState draws
// it: an icon in a soft disc, a title, a line, then `action`.
export function StatusMessage({ icon, title, detail = null, action = null }) {
  return (
    <div className="page-enter flex flex-col items-center justify-center gap-3 px-6 py-14 text-center max-md:py-10" role="status">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-brand-subtle text-text" aria-hidden="true">
        <Icon icon={icon} className="size-[26px]" />
      </span>
      <p className="m-0 font-body text-[17px] font-semibold leading-[1.2] text-text">{title}</p>
      {detail ? (
        <p className="m-0 max-w-[420px] font-body text-[15px] font-medium leading-[1.4] text-text-secondary whitespace-pre-line">{detail}</p>
      ) : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export function LoadingDots({ label }) {
  return (
    <div className="flex items-center gap-3 py-10 text-text-muted">
      <SharedLoadingDots label={label} />
      <span className="font-body text-[14px] font-medium" aria-hidden="true">{label}</span>
    </div>
  )
}

export function OpenScodocButton() {
  if (!GRADES_LAUNCH_HREF) {
    return null
  }

  return (
    <button type="button" onClick={openGradesService} className={SECONDARY_BUTTON}>
      ScoDoc
      <Icon icon="carbon:arrow-up-right" className="size-3.5" aria-hidden="true" />
    </button>
  )
}

// Loading and failure states common to both pages; null once the semester's
// data is there.
export function ScodocLoadState({ data, unavailableTitle }) {
  const { base, entry, activeSemester, retry } = data
  const retryButton = (
    <button type="button" onClick={retry} className={PRIMARY_BUTTON}>
      Réessayer
    </button>
  )

  if (base.status === 'loading') {
    return <LoadingDots label="Récupération de tes données ScoDoc…" />
  }

  if (base.status === 'error') {
    return (
      <StatusMessage
        icon="carbon:cloud-offline"
        title={unavailableTitle}
        detail={base.error}
        action={<div className="flex flex-wrap gap-2">{retryButton}<OpenScodocButton /></div>}
      />
    )
  }

  if (entry.status === 'loading') {
    return <LoadingDots label={`Chargement du ${activeSemester?.number != null ? `semestre ${activeSemester.number}` : 'semestre'}…`} />
  }

  if (entry.status === 'error') {
    return (
      <StatusMessage
        icon="carbon:cloud-offline"
        title="Ce semestre n'a pas pu être chargé"
        detail={entry.error}
        action={<div className="flex flex-wrap gap-2">{retryButton}<OpenScodocButton /></div>}
      />
    )
  }

  return null
}

// Title, subtitle, actions and semester picker of a ScoDoc page. While a
// cached copy is on screen and the fresh one is on its way, a quiet
// "Actualisation…" says so.
export function ScodocPageHeader({ titleId, title, subtitle, actions = null, data }) {
  const { semesters, activeId, selectSemester, refreshing } = data
  const semesterOptions = semesters.map((semester) => ({
    value: semester.id,
    label: semester.number != null ? `S${semester.number}` : semester.title ?? 'Semestre',
    detail: semester.year,
  }))

  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <h1 id={titleId} className="m-0 text-[36px] leading-none tracking-[-0.02em] max-md:text-[30px]">{title}</h1>
          <p className="m-0 flex flex-wrap items-center gap-x-2 font-body text-[15px] font-medium text-text-secondary">
            {subtitle ? <span>{subtitle}</span> : null}
            {refreshing ? (
              <span className="scodoc-refreshing inline-flex items-center gap-1 text-[13px] text-text-muted" role="status">
                <Icon icon="carbon:renew" className="size-3.5 animate-spin" aria-hidden="true" />
                Actualisation…
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          {data.base.status === 'ok' ? <OpenScodocButton /> : null}
        </div>
      </div>
      {semesterOptions.length > 1 ? (
        <div className="-mx-6 overflow-x-auto px-6 py-1 [scrollbar-width:none] max-md:-mx-3 max-md:px-3">
          <SegmentedControl label="Semestre" options={semesterOptions} value={activeId} onChange={selectSemester} size="lg" />
        </div>
      ) : null}
    </header>
  )
}

// The department's message, as « Mes notes » shows it.
export function DepartmentNotice({ message }) {
  if (!message) {
    return null
  }

  return (
    <GradesNotice icon="carbon:bullhorn" label="Message du département" title="Message de ton département" collapsible>
      {message}
    </GradesNotice>
  )
}
