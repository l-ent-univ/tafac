import { useMemo } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { buildUeWash, formatGradeDay } from '../gradesSubjects'
import { buildGradesPreview, buildMailPreview, buildPlanningPreview } from '../landingShowcasePreview'
import { agendaDayText } from '../planningDates'
import { assignSubjectIcons } from '../subjectIcons'
import { useUeColor } from '../useUeColor'
import GreetingCard from './GreetingCard'
import { CARD_CLASSES as GRADE_CARD_CLASSES, LatestGradeCardBody } from './LatestGradesList'
import MailRowContent from './MailRowContent'
import { getSenderBadgeStyle, getSenderInitial } from './mailSender'
import { PlanningListCard } from './PlanningListView'
import WidgetAverageGrade from './WidgetAverageGrade'
import WidgetDeadlines from './WidgetDeadlines'
import WidgetLatestGrade from './WidgetLatestGrade'
import WidgetNextClass from './WidgetNextClass'
import WidgetRecentMail from './WidgetRecentMail'
import WidgetUes from './WidgetUes'
import { formatReceivedAt, getSenderLabel, parseDate } from './widgetListUtils'

// The landing showcase's previews (LandingShowcase), one per page of the
// app: its real cards and rows, filled with the demo account's data
// (src/landingPreview.js for the dashboard's widgets,
// src/landingShowcasePreview.js for the rest), never loading anything. A
// picture of the page: the showcase puts them in an inert frame, its text
// says what they show.

const noop = () => {}

// What the app's right-click menu looks like (ContextMenu), standing still
// where a pointer opened it.
function StillContextMenu({ items, className = '' }) {
  return (
    <div className={`landing-preview-menu pointer-events-none absolute z-10 min-w-[232px] p-[5px] border border-border corners-[16px] bg-context-bg shadow-[0_1px_3px_rgb(52_18_0/0.08),0_18px_44px_-12px_var(--color-shadow)] ${className}`}>
      {items.map((item) => (
        <div key={item.label} className={`flex min-h-[34px] items-center gap-[10px] px-[10px] corners-[11px] text-text ${item.active ? 'bg-context-hover' : ''}`}>
          <Icon icon={item.icon} className="size-[16px] shrink-0 text-text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-tight">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

// The dashboard: the greeting, the next class, the latest grade, the mails
// and the deadlines, as the top of the page sets them (`preview`:
// buildLandingPreview's, its first frame).
function HomePreview({ preview }) {
  const greeting = preview.greetings[0]
  return (
    <div className="landing-preview-home grid grid-cols-2 gap-3 max-md:gap-2">
      <div className="col-span-2 grid">
        <GreetingCard displayName={greeting?.displayName ?? ''} greeting={greeting?.greeting ?? null} visible headingAs="p" />
      </div>
      <WidgetNextClass visible preview={preview.upcomingEvents[0] ?? []} />
      {preview.latestGrades[0] ? <WidgetLatestGrade visible preview={preview.latestGrades[0]} /> : null}
      <div className="grid max-md:col-span-2">
        <WidgetRecentMail visible preview={preview.mail[0] ?? { status: 'ok', unreadCount: 0, webmailHref: null, messages: [] }} />
      </div>
      <div className="grid max-md:col-span-2">
        <WidgetDeadlines visible preview={preview.deadlines[0] ?? { status: 'ok', moodleHref: null, items: [] }} />
      </div>
    </div>
  )
}

// « Mes notes »: the average and its line, « UE validées », then the latest
// grades as the page's cards (their subject's icon, the wash of their UEs).
function GradesPreview() {
  const grades = useMemo(() => buildGradesPreview(), [])
  const paintUe = useUeColor()
  const ueColors = Object.fromEntries((grades.report.ues ?? []).map((ue) => [ue.code, paintUe(ue.color)]))
  const subjectIcon = useMemo(() => assignSubjectIcons(
    [...grades.report.resources, ...grades.report.saes]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((module) => module.title),
    universityConfig.appIconStyle,
  ), [grades])

  return (
    <div className="landing-preview-grades grid gap-3 max-md:gap-2">
      <div className="flex items-stretch gap-3 max-md:gap-2">
        <WidgetAverageGrade releve={grades.releve} visible />
        <WidgetUes releve={grades.releve} config={grades.config} visible />
      </div>
      <p className="m-0 mt-2 flex items-center gap-[6px] font-body text-base font-medium leading-none text-text">
        <Icon icon="carbon:recently-viewed" className="size-[17px]" aria-hidden="true" />
        Dernières notes
      </p>
      <ul className="m-0 grid list-none grid-cols-3 gap-3 p-0 max-md:grid-cols-2 max-md:gap-2">
        {grades.latest.map((grade, index) => (
          <li key={`${grade.moduleCode}-${grade.id}`} className={`flex min-w-0 ${index === 2 ? 'max-md:hidden' : ''}`}>
            <div className={GRADE_CARD_CLASSES.replace('cursor-pointer', '')}>
              <LatestGradeCardBody
                moduleTitle={grade.moduleTitle}
                moduleCode={grade.moduleCode}
                day={formatGradeDay(grade.date)}
                title={grade.description || grade.moduleTitle}
                value={String(parseFloat(grade.grade.value.toFixed(2)))}
                icon={subjectIcon(grade.moduleTitle)}
                wash={buildUeWash(grade.weights, ueColors)}
                typeLabel={grade.typeLabel}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// The Planning as a list, on the page's colour: a heading per day (its
// classes counted), its classes as the list's cards; the first day's
// second class with its right-click menu open on « Écrire au sujet de ce
// cours ». On phones, the first day only.
function PlanningPreview() {
  const planning = useMemo(() => buildPlanningPreview(), [])

  return (
    <div className="landing-preview-planning landing-preview-sheet relative grid min-w-0 gap-5 corners-[22px] border p-4 max-md:gap-4 max-md:p-3">
      {planning.days.map(({ day, count, classes }, dayIndex) => {
        const heading = agendaDayText(day, planning.todayKey)
        return (
          <div key={day} className={`relative grid gap-2.5 ${dayIndex > 0 ? 'max-md:hidden' : ''}`}>
            <p className="m-0 flex min-w-0 items-center gap-[5px] font-body text-base font-medium leading-[1.06] text-brand">
              <Icon icon="carbon:calendar" className="size-[17px] shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">
                {heading.title}
                {heading.detail ? <span className="text-text-muted"> · {heading.detail}</span> : null}
              </span>
              <span className="ml-auto shrink-0 text-[13px] text-text-muted">{count} cours</span>
            </p>
            <ul className="m-0 grid list-none gap-2 p-0">
              {classes.map(({ event, accent, ongoing }, index) => (
                <li key={event.id} className="relative">
                  <PlanningListCard event={event} accent={accent} ongoing={ongoing} onOpen={noop} />
                  {dayIndex === 0 && index === 1 ? (
                    <StillContextMenu
                      className="top-[58%] right-8 max-md:right-2"
                      items={[
                        { label: 'Voir le détail', icon: 'carbon:view' },
                        { label: 'Écrire au sujet de ce cours', icon: 'carbon:email', active: true },
                        { label: 'Copier', icon: 'carbon:copy' },
                      ]}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

// The Messagerie: the inbox's rows as the list shows them, and the
// composer as « Écrire au sujet de cette note » opens it.
function MailPreview() {
  const mail = useMemo(() => buildMailPreview(), [])
  const now = new Date()
  const composer = mail.composer
  const teacher = composer?.to ?? null
  const teacherBadge = teacher ? getSenderBadgeStyle(teacher.email.toLowerCase()) : null

  return (
    <div className="landing-preview-mail relative grid min-w-0 pb-16 max-md:pb-0">
      <div className="landing-preview-sheet min-w-0 corners-[22px] border px-4 pt-3 pb-1 w-[86%] max-md:w-auto max-md:px-3">
        <p className="m-0 flex items-center gap-2 pb-1 font-body text-[15px] font-semibold text-text">
          <Icon icon="carbon:email" className="size-[17px]" aria-hidden="true" />
          Réception
          <span className="mail-unread-pill inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[6px] text-[11px] font-semibold leading-none tabular-nums">{mail.unreadCount}</span>
        </p>
        <ul className="m-0 list-none p-0">
          {mail.messages.map((message) => (
            <li key={message.id} className="flex min-w-0 flex-col gap-[3px] border-b border-border py-3 last:border-b-0">
              <MailRowContent
                message={message}
                person={message.from}
                sender={getSenderLabel(message.from)}
                senderDomain={message.domainCue}
                timeLabel={formatReceivedAt(parseDate(message.receivedAt), now)}
              />
            </li>
          ))}
        </ul>
      </div>
      {composer ? (
        <div className="landing-preview-composer absolute right-0 bottom-0 w-[min(400px,64%)] min-w-0 overflow-hidden corners-[22px] border text-text max-md:relative max-md:-mt-8 max-md:ml-auto max-md:w-[94%]">
          <div className="flex items-center gap-3 px-4 pt-3 pb-2.5">
            <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-bg-subtle text-text" aria-hidden="true">
              <Icon icon="carbon:close" className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-tight">{composer.subject}</span>
            <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-text text-bg" aria-hidden="true">
              <Icon icon="carbon:arrow-up" className="size-4" />
            </span>
          </div>
          <div className="border-t border-border text-[13px]">
            <div className="flex min-h-[36px] items-center gap-2 border-b border-border px-4">
              <span className="shrink-0 font-medium text-text-muted">À :</span>
              {teacher ? (
                <span className="inline-flex min-w-0 items-center gap-[7px] font-medium">
                  <span
                    className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold leading-none ${teacherBadge ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
                    style={teacherBadge ?? undefined}
                    aria-hidden="true"
                  >
                    {getSenderInitial(teacher.name)}
                  </span>
                  <span className="truncate">{teacher.name}</span>
                </span>
              ) : null}
            </div>
            <div className="flex min-h-[36px] items-center gap-2 border-b border-border px-4">
              <span className="shrink-0 font-medium text-text-muted">Objet :</span>
              <span className="min-w-0 truncate font-semibold">{composer.subject}</span>
            </div>
          </div>
          <div className="mail-composer-body px-4 pt-3 pb-1 text-[13px] leading-[1.45]">
            <p className="m-0">Bonjour,</p>
            <p className="m-0 mt-2">{composer.about}</p>
            <table data-mail-summary="" className="mt-3! text-[12.5px]!">
              <tbody>
                {composer.rows.slice(0, 5).map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// The preview of the tab `kind` ('home', 'grades', 'planning', 'mail').
// `preview`: buildLandingPreview's (the dashboard's widgets).
function LandingShowcasePreview({ kind, preview }) {
  if (kind === 'home') return <HomePreview preview={preview} />
  if (kind === 'grades') return <GradesPreview />
  if (kind === 'planning') return <PlanningPreview />
  if (kind === 'mail') return <MailPreview />
  return null
}

export default LandingShowcasePreview
