import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { navigateTo } from '../appRoute'
import { dashboardSignals, groupByThread, groupSiteSignals, noticeForEvent, signalTitle } from '../mailSignals'
import { requestMailMessage } from '../mailSelection'
import { isMailPageAvailable } from '../navItems'
import { formatTime, relativeDayText, startOfWeek, toDayKey } from '../planningDates'
import { useMailSignals } from '../useMailSignals'
import { usePlanningWeeks } from '../usePlanningWeeks'
import { SIGNAL_STYLES, describeDays } from '../mailSignalStyles'
import { INLINE_BUTTON } from './AppPage'

const DISMISSED_KEY = 'l-ent:mail-signals-dismissed'

function readDismissed() {
  try {
    const stored = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

// The classes it touches: "TD Réseaux, 10h00 – 12h00" or "3 cours :
// Anglais, TD Réseaux…".
function classesText(classes) {
  if (classes.length === 1) {
    const [only] = classes
    return `${only.title}, ${formatTime(only.start)} – ${formatTime(only.end)}`
  }
  const titles = [...new Set(classes.map((event) => event.title))]
  return `${classes.length} cours : ${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '…' : ''}`
}

// A mail's subject as listed in a thread: without the list tags
// ("[iutlan-2627]"), "Re:" or "Tr:" turned into a badge.
function displaySubject(subject) {
  let label = String(subject ?? '').trim()
  let tag = null
  for (let previous = ''; previous !== label;) {
    previous = label
    label = label.replace(/^\[[^\]]*\]\s*/, '')
    const prefix = label.match(/^(re|tr|fw|fwd)\s*:\s*/i)
    if (prefix) {
      tag = tag ?? (/^re/i.test(prefix[1]) ? 'Réponse' : 'Transfert')
      label = label.slice(prefix[0].length)
    }
  }
  return { label: label || '(Sans objet)', tag }
}

// The dashboard's rows: the site blocked or on strike, one row each however
// many mails announced it (groupSiteSignals), then the other announcements,
// one row per thread (a reply and its first mail: groupByThread). `mails`:
// newest first; `days`: today and after.
function buildRows(signals, establishment, todayKey) {
  const siteWide = (signal) => signal.kind === 'closure' || signal.kind === 'strike'
  const groups = groupSiteSignals(signals, establishment).map((group) => ({
    key: group.kind,
    kind: group.kind,
    title: signalTitle(group.signals[0]),
    days: group.days.filter((day) => day >= todayKey),
    mails: group.signals,
  }))
  const others = groupByThread(signals.filter((signal) => !siteWide(signal))).map((thread) => ({
    key: thread.signals[0].id,
    kind: thread.kind,
    title: [signalTitle(thread.signals[0]), thread.signals.find(({ room }) => room)?.room].filter(Boolean).join(' · '),
    days: thread.days.filter((day) => day >= todayKey),
    mails: thread.signals,
  }))
  return [...groups, ...others]
}

// What the student's mails announce (mailSignals), at the top of the
// dashboard, titled and carded as the sections of Mes notes: one row per
// announcement, when it happens, the classes of the student's planning it
// touches (`selection`, `user`: their group, usePlanningWeeks), the mail it
// comes from. "Voir au planning" opens that day (`onOpenPlanningDay`, with
// the in-app planning), "Voir le mail" the mail in Messagerie. Site-wide
// news only for the student's site (`establishment`); each row's × hides it
// for good on this device.
function MailSignalsNotice({ establishment, selection = null, user = null, onOpenPlanningDay = null }) {
  const signals = useMailSignals()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [todayKey] = useState(() => toDayKey(Date.now()))
  // The row whose mails are unfolded (its key), one at a time.
  const [openRow, setOpenRow] = useState(null)
  const rows = buildRows(dashboardSignals(signals, establishment, todayKey).filter((signal) => !dismissed.includes(signal.id)), establishment, todayKey).slice(0, 4)
  const { events, load } = usePlanningWeeks({ selection, user })
  // The weeks of the days announced, asked of the planning.
  const weeksKey = [...new Set(rows.flatMap((row) => row.days).map(startOfWeek))].join(',')
  useEffect(() => {
    if (weeksKey) weeksKey.split(',').forEach((monday) => load(monday))
  }, [weeksKey, load])

  if (!rows.length) return null

  // A row's mails, all of them: a new one about it brings the row back.
  const dismiss = (ids) => {
    const next = [...dismissed, ...ids].slice(-50)
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable: hidden for this visit.
    }
  }
  const openMail = (signal) => {
    if (isMailPageAvailable()) {
      requestMailMessage(signal.id)
      navigateTo('mail', { source: 'dashboard_card' })
    } else if (signal.href) {
      window.open(signal.href, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <section className="grid gap-3" aria-labelledby="mail-signals-title">
      <div className="flex items-center gap-[5px] text-brand">
        <Icon icon="carbon:email" className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
        <h2 id="mail-signals-title" className="m-0 font-body text-base font-medium leading-[1.06]">Dans tes mails</h2>
      </div>
      <ul className="@container widget-card widget-card-visible m-0 list-none overflow-hidden rounded-[22px] border bg-widget-bg p-0 max-md:rounded-[20px]">
        {rows.map((row, index) => {
          const { icon, tint } = SIGNAL_STYLES[row.kind]
          const { days, mails } = row
          const classes = events.filter((event) => days.includes(event.day) && noticeForEvent(mails, event, establishment))
          const planningDay = classes[0]?.day ?? days[0] ?? null
          return (
            // A narrow card puts the buttons under the text, not beside it.
            <li key={row.key} className={`flex flex-wrap items-start gap-x-3.5 gap-y-2.5 py-3.5 pr-3 pl-4 ${index ? 'border-t border-border' : ''}`}>
              <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] ${tint}`} aria-hidden="true">
                <Icon icon={icon} className="size-[18px]" />
              </span>
              <span className="grid min-w-0 flex-1 gap-1.5 font-body">
                <span className="text-[15px] font-semibold leading-tight text-text">{row.title}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-tight text-text-secondary">
                  <Icon icon="carbon:calendar" className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{describeDays(days, todayKey)}</span>
                </span>
                {classes.length ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium leading-tight text-text-secondary">
                    <Icon icon="carbon:education" className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{classesText(classes)}</span>
                  </span>
                ) : null}
                <span className="truncate text-[12.5px] font-medium leading-tight text-text-muted">{`D’après « ${mails[0].subject} »`}</span>
                {/* Several mails about it: a pill that unfolds them (sliding
                    open and shut, as Mes notes' subjects), each one opening
                    in Messagerie. */}
                {mails.length > 1 ? (
                  <>
                    <button
                      type="button"
                      className={`mail-thread-toggle inline-flex items-center gap-1.5 justify-self-start rounded-full border border-border px-2.5 py-1 font-body text-[12.5px] font-semibold leading-none cursor-pointer transition-colors duration-150 ${openRow === row.key ? 'bg-text text-bg' : 'bg-widget-bg text-text-secondary hover:bg-bg-subtle hover:text-text'}`}
                      aria-expanded={openRow === row.key}
                      aria-controls={`mail-thread-${row.key}`}
                      onClick={() => setOpenRow((current) => (current === row.key ? null : row.key))}
                    >
                      <Icon icon="carbon:email" className="size-3.5" aria-hidden="true" />
                      {`${mails.length} mails`}
                      <Icon icon="carbon:chevron-down" className={`size-3.5 transition-transform duration-200 ${openRow === row.key ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                    <div id={`mail-thread-${row.key}`} className={`mail-thread-panel ${openRow === row.key ? 'is-open' : ''}`}>
                      <div className="mail-thread-panel-inner">
                        <ul className="m-0 mt-0.5 grid list-none overflow-hidden rounded-[16px] border border-border bg-bg-subtle/60 p-1">
                          {mails.map((mail, mailIndex) => {
                            const { label, tag } = displaySubject(mail.subject)
                            return (
                              <li key={mail.id} className="mail-thread-item" style={{ '--i': mailIndex }}>
                                <button
                                  type="button"
                                  className="group flex w-full min-w-0 items-center gap-3 rounded-[12px] border-0 bg-transparent px-2.5 py-2 text-left font-body cursor-pointer transition-colors duration-150 hover:bg-widget-bg"
                                  onClick={() => openMail(mail)}
                                >
                                  <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full ${tag ? 'bg-brand-subtle text-text-secondary' : tint}`} aria-hidden="true">
                                    <Icon icon={tag === 'Réponse' ? 'carbon:reply' : tag === 'Transfert' ? 'carbon:share' : 'carbon:email'} className="size-4" />
                                  </span>
                                  <span className="grid min-w-0 flex-1 gap-1">
                                    <span className="flex min-w-0 items-center gap-1.5">
                                      {tag ? <span className="shrink-0 rounded-full bg-brand-subtle px-[7px] py-[3px] text-[11px] font-semibold leading-none text-text-secondary">{tag}</span> : null}
                                      <span className="min-w-0 truncate text-[13.5px] font-semibold leading-tight text-text">{label}</span>
                                    </span>
                                    <span className="truncate text-[12px] font-medium leading-tight text-text-muted">
                                      {[mail.from, relativeDayText(mail.receivedKey, todayKey)].filter(Boolean).join(' · ')}
                                    </span>
                                  </span>
                                  <Icon icon="carbon:arrow-right" className="size-4 shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    </div>
                  </>
                ) : null}
              </span>
              {/* Beside the text, or on their own row under it (order) while
                  the × stays in the corner. */}
              <span className="order-2 flex shrink-0 flex-wrap items-center justify-end gap-1.5 @max-[560px]:order-4 @max-[560px]:basis-full @max-[560px]:justify-start @max-[560px]:pl-[50px]">
                {onOpenPlanningDay && planningDay ? (
                  <button type="button" className={INLINE_BUTTON} onClick={() => onOpenPlanningDay(planningDay)}>
                    <Icon icon="carbon:calendar" className="size-3.5" aria-hidden="true" />
                    Voir au planning
                  </button>
                ) : null}
                <button type="button" className={INLINE_BUTTON} onClick={() => openMail(mails[0])}>
                  {mails.length > 1 ? 'Dernier mail' : 'Voir le mail'}
                  <Icon icon="carbon:arrow-right" className="size-3.5" aria-hidden="true" />
                </button>
              </span>
              <button
                type="button"
                className="order-3 -my-0.5 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
                onClick={() => dismiss(mails.map(({ id }) => id))}
                aria-label={`Masquer « ${row.title} »`}
                title="Masquer"
              >
                <Icon icon="carbon:close" className="size-4" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default MailSignalsNotice
