import { Fragment, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { GRADES_LAUNCH_HREF, openGradesService } from '../entApi'
import { buildAbsenceReport, buildJustificationMail, formatDuration, hoursToJustify, summarizeAbsencesBySubject } from '../gradesReport'
import { formatLongDate, getSecretariatEmail, parseIsoDate } from '../scodocPageUtils'
import { APP_NAME } from '../seo'
import { useScodocReleve } from '../useScodocReleve'
import { AppPage, INLINE_BUTTON, PAGE_CARD, PRIMARY_BUTTON, PageButton, PageSection, StatCard, StatRow } from './AppPage'
import { GradesNotice } from './GradesNotice'
import PageGuidedTour from './PageGuidedTour'
import SemesterSelect from './SemesterSelect'
import { DepartmentNotice, ScodocLoadState, SegmentedControl, StatusMessage } from './ScodocUi'

// "Absences": the ScoDoc absence report as its own page, in the frame of
// « Mes notes ». On the band, what may cost something (the totals, the
// unjustified absences and the time left to justify them); below, where the
// hours were missed, then the full history.

const ABSENCES_TOUR_STEPS = [
  {
    id: 'intro',
    title: 'Bienvenue sur tes absences',
    body: 'Suis tes absences et retards enregistrés sur ScoDoc, vérifie tes délais de justification et contacte facilement ton secrétariat.',
    icon: 'carbon:event-schedule',
  },
  {
    id: 'summary',
    target: 'absences-summary',
    title: 'Bilan de ton semestre',
    body: 'Retrouve en un clin d’œil le total de tes heures injustifiées, justifiées et retards. Sois attentif au décompte des heures pour valider ton semestre sans pénalité.',
    icon: 'carbon:hourglass',
  },
  {
    id: 'breakdown',
    target: 'absences-breakdown',
    title: 'Répartition par matière',
    body: 'Vérifie dans quelles ressources ou SAÉ tu as manqué des cours pour éviter d’accumuler trop d’absences dans une même matière.',
    icon: 'carbon:chart-pie',
  },
  {
    id: 'history',
    target: 'absences-history',
    title: 'Historique & Justification rapide',
    body: 'Chaque absence affiche son état et le délai restant pour la justifier. Clique sur « Justifier » pour ouvrir un e-mail officiel pré-rempli prêt à envoyer au secrétariat.',
    icon: 'carbon:email',
  },
]

const ABSENCE_STATUS = {
  justified: { label: 'Justifiée', className: 'bg-success-bg text-success-text' },
  unjustified: { label: 'Injustifiée', className: 'bg-error-bg text-error' },
  late: { label: 'Retard', className: 'bg-[#f3f1eb] text-text-secondary dark:bg-[var(--color-bg-muted)]' },
}

const FILTERS = [
  { value: 'all', label: 'Toutes' },
  { value: 'unjustified', label: 'Injustifiées' },
  { value: 'justified', label: 'Justifiées' },
  { value: 'late', label: 'Retards' },
]

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function groupByMonth(entries) {
  const groups = []
  for (const entry of entries) {
    const date = parseIsoDate(entry.date)
    const key = date ? `${date.getFullYear()}-${date.getMonth()}` : 'unknown'
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      group = {
        key,
        label: date ? capitalize(date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })) : 'Date inconnue',
        entries: [],
      }
      groups.push(group)
    }
    group.entries.push(entry)
  }
  return groups
}

// "2025-09-25" → "25/09/2025", for the pre-filled mail.
function formatNumericDate(value) {
  return String(value ?? '').split('-').reverse().join('/')
}

// Hours left to justify → "Reste 36 h", "Reste 3 h", "Délai dépassé".
function describeDeadline(hours) {
  if (hours == null) return ''
  if (hours <= 0) return 'Délai dépassé'
  if (hours < 1) return 'Reste moins d’1 h'
  return `Reste ${Math.floor(hours)} h`
}

// Copies the secretariat's address, for people whose mail is a webmail that
// the mailto: link doesn't open.
function CopyAddressButton({ address }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked: the address is on screen anyway.
    }
  }

  return (
    <button type="button" onClick={() => void copy()} className={INLINE_BUTTON}>
      <Icon icon={copied ? 'carbon:checkmark' : 'carbon:copy'} className="size-3.5" aria-hidden="true" />
      {copied ? 'Adresse copiée' : 'Copier l’adresse'}
    </button>
  )
}

// The band's overview: the semester's totals, then what needs doing.
function AbsencesOverview({ absences, justification }) {
  const unjustified = absences.entries.filter((entry) => entry.status === 'unjustified')
  const unjustifiedCount = unjustified.length
  // The soonest deadline still open, to say how urgent it is.
  const openDeadlines = unjustified.map((entry) => hoursToJustify(entry)).filter((hours) => hours != null && hours > 0)
  const nextDeadline = openDeadlines.length ? Math.min(...openDeadlines) : null
  const totals = absences.totals

  return (
    <>
      {totals ? (
        <StatRow>
          <StatCard label="Injustifiées" icon="carbon:warning-alt" value={totals.unjustified} tone={unjustifiedCount ? 'alert' : 'default'} />
          <StatCard label="Justifiées" icon="carbon:checkmark-outline" value={totals.justified} />
          <StatCard label="Retards" icon="carbon:time" value={totals.late} />
        </StatRow>
      ) : (
        <GradesNotice icon="carbon:calendar" label="Totaux" title="Pas de totaux en heures">
          Certaines absences couvrent plusieurs jours : le détail est plus bas.
        </GradesNotice>
      )}
      {unjustifiedCount ? (
        <GradesNotice
          icon="carbon:warning-alt"
          label="Absences à justifier"
          title={unjustifiedCount === 1 ? '1 absence n’est pas justifiée' : `${unjustifiedCount} absences ne sont pas justifiées`}
        >
          {nextDeadline != null
            ? `Il te reste ${Math.floor(nextDeadline)} h pour justifier la plus récente.`
            : 'Le délai pour les justifier est dépassé : contacte directement ton secrétariat.'}
        </GradesNotice>
      ) : absences.entries.length ? (
        <GradesNotice icon="carbon:checkmark-outline" label="Absences" title="Toutes tes absences sont justifiées" />
      ) : null}
      {unjustifiedCount && justification ? (
        <div className="flex flex-wrap items-center gap-2">
          <a href={buildJustificationMail({ ...justification, entries: unjustified, formatDate: formatNumericDate }).href} className={PRIMARY_BUTTON}>
            <Icon icon="carbon:email" className="size-4" aria-hidden="true" />
            {unjustifiedCount === 1 ? 'Justifier par mail' : 'Tout justifier par mail'}
          </a>
          <CopyAddressButton address={justification.to} />
          <span className="font-body text-[13px] font-medium text-text-muted">{justification.to}</span>
        </div>
      ) : null}
    </>
  )
}

function SubjectBreakdown({ entries }) {
  const subjects = summarizeAbsencesBySubject(entries)
  if (!subjects.length) {
    return null
  }

  const maxHours = Math.max(...subjects.map((subject) => subject.hours), 1)

  return (
    <PageSection id="absences-subjects-title" icon="carbon:chart-bar" title="Heures manquées par matière">
      <ul className={`${PAGE_CARD} m-0 flex flex-col gap-4 p-5 list-none max-md:p-4`}>
        {subjects.map((subject) => (
          <li key={subject.subject} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-body text-[15px] font-semibold leading-snug text-text">{subject.subject}</span>
              <span className="shrink-0 font-body text-[14px] font-semibold text-text">
                {formatDuration(subject.hours)}
                {subject.unjustifiedHours ? (
                  <span className="font-medium text-error"> · {formatDuration(subject.unjustifiedHours)} injustifiée{subject.unjustifiedHours > 1 ? 's' : ''}</span>
                ) : null}
              </span>
            </div>
            {/* Whole bar: hours missed; red part: the unjustified ones. */}
            <div className="relative h-[8px] overflow-hidden rounded-full bg-[#f3f1eb] dark:bg-[var(--color-bg-muted)]" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded-full bg-text-30" style={{ width: `${(subject.hours / maxHours) * 100}%` }} />
              <span className="absolute inset-y-0 left-0 rounded-full bg-error" style={{ width: `${(subject.unjustifiedHours / maxHours) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </PageSection>
  )
}

function AbsenceHistory({ entries, justification }) {
  const [filter, setFilter] = useState('all')
  const counts = useMemo(() => {
    const result = { all: entries.length, unjustified: 0, justified: 0, late: 0 }
    for (const entry of entries) result[entry.status] += 1
    return result
  }, [entries])
  const visible = filter === 'all' ? entries : entries.filter((entry) => entry.status === filter)
  const options = FILTERS
    .filter((option) => option.value === 'all' || counts[option.value] > 0)
    .map((option) => ({ ...option, count: counts[option.value] }))

  return (
    <PageSection id="absences-history-title" icon="carbon:recently-viewed" title="Historique" count={entries.length}>
      {options.length > 2 ? (
        <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
          <SegmentedControl label="Filtrer les absences" options={options} value={filter} onChange={setFilter} />
        </div>
      ) : null}
      <div className={`${PAGE_CARD} flex flex-col overflow-hidden`}>
        {groupByMonth(visible).map((group) => (
          <Fragment key={group.key}>
            <h3 className="m-0 border-b border-border bg-[#f8f7f3] px-4 py-2 font-body text-[13px] font-semibold text-text-secondary dark:bg-[var(--color-bg-subtle)]">{group.label}</h3>
            <ul className="m-0 flex flex-col p-0 list-none">
              {group.entries.map((entry) => {
                const status = ABSENCE_STATUS[entry.status]
                const date = parseIsoDate(entry.date)
                return (
                  <li key={entry.id} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 max-md:gap-3">
                    <span className="flex w-[44px] shrink-0 flex-col items-center leading-none" aria-hidden="true">
                      <span className="font-display text-[22px] font-bold text-text">{date ? date.getDate() : '—'}</span>
                      <span className="mt-1 font-body text-[11px] font-semibold uppercase text-text-muted">
                        {date ? date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '') : ''}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="sr-only">{formatLongDate(entry.date)}{entry.endDate ? ` au ${formatLongDate(entry.endDate)}` : ''}</span>
                      <span className="font-body text-[15px] font-semibold leading-snug text-text">
                        {entry.subject ?? 'Matière non précisée'}
                      </span>
                      <span className="font-body text-[13px] font-medium leading-snug text-text-muted">
                        {[
                          entry.endDate ? `jusqu’au ${formatLongDate(entry.endDate)}` : `${entry.start} – ${entry.end}`,
                          entry.teacher,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className={`rounded-full px-2.5 py-1 font-body text-[12px] font-semibold ${status.className}`}>{status.label}</span>
                      {entry.status === 'unjustified' && justification ? (
                        <>
                          <span className="font-body text-[12px] font-medium text-text-muted">{describeDeadline(hoursToJustify(entry))}</span>
                          <a href={buildJustificationMail({ ...justification, entries: entry, formatDate: formatNumericDate }).href} className={INLINE_BUTTON}>
                            <Icon icon="carbon:email" className="size-3.5" aria-hidden="true" />
                            Justifier
                          </a>
                        </>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Fragment>
        ))}
      </div>
    </PageSection>
  )
}

function AbsencesPage() {
  const [tourTrigger, setTourTrigger] = useState(0)
  const data = useScodocReleve()
  const { activeId, releve, config, entry, departmentMessage } = data

  useEffect(() => {
    const previousTitle = document.title
    document.title = `Absences · ${APP_NAME}`
    return () => { document.title = previousTitle }
  }, [])

  const absences = useMemo(
    () => (entry.status === 'ok' ? buildAbsenceReport(entry.payload, releve, config) : null),
    [config, entry, releve],
  )
  // Only when the department has a secretariat address to write to.
  const secretariat = getSecretariatEmail(data.department, config)
  const justification = secretariat
    ? {
        to: secretariat,
        student: { firstName: releve?.etudiant?.prenom, lastName: releve?.etudiant?.nom },
        semesterLabel: [data.activeSemester?.number != null ? `S${data.activeSemester.number}` : null, data.activeSemester?.year].filter(Boolean).join(' '),
      }
    : null

  let body
  let overview = null
  if (data.base.status !== 'ok' || entry.status !== 'ok') {
    body = <ScodocLoadState data={data} unavailableTitle="Absences indisponibles" />
  } else if (!absences?.visible) {
    body = (
      <StatusMessage
        icon="carbon:view-off"
        title="Absences non publiées"
        detail="Ton département ne publie pas les absences dans ScoDoc. Rapproche-toi du secrétariat pour les connaître."
      />
    )
  } else if (!absences.entries.length) {
    body = (
      <StatusMessage
        icon="carbon:checkmark-outline"
        title="Aucune absence sur ce semestre"
        detail="Rien n’est enregistré dans ScoDoc pour l’instant."
      />
    )
  } else {
    overview = <AbsencesOverview absences={absences} justification={justification} />
    body = (
      // Keyed by semester: switching fades it in and resets the filter.
      <div key={activeId} className="semester-fade grid gap-8 max-md:gap-6">
        <div data-tour="absences-breakdown"><SubjectBreakdown entries={absences.entries} /></div>
        <div data-tour="absences-history"><AbsenceHistory entries={absences.entries} justification={justification} /></div>
        {absences.notice ? (
          <p className="m-0 font-body text-[13px] font-medium leading-relaxed text-text-muted whitespace-pre-line">{absences.notice}</p>
        ) : null}
      </div>
    )
  }

  return (
    <AppPage
      titleId="absences-page-title"
      title="Absences"
      controls={<SemesterSelect semesters={data.semesters} value={activeId} onChange={data.selectSemester} />}
      actions={(
        <>
          {GRADES_LAUNCH_HREF && data.base.status === 'ok' ? <PageButton icon="carbon:arrow-up-right" label="ScoDoc" onClick={openGradesService} /> : null}
          <PageButton icon="carbon:help" label="Visite guidée" onClick={() => setTourTrigger((count) => count + 1)} />
        </>
      )}
      overview={entry.status === 'ok' && (overview || departmentMessage) ? (
        <div key={activeId} data-tour="absences-summary" className="semester-fade grid gap-4 max-md:gap-3">
          {overview}
          <DepartmentNotice message={departmentMessage} />
        </div>
      ) : null}
    >
      {body}
      <PageGuidedTour
        storageKey="l-ent:tour:absences"
        steps={ABSENCES_TOUR_STEPS}
        manualTrigger={tourTrigger}
      />
    </AppPage>
  )
}

export default AbsencesPage
