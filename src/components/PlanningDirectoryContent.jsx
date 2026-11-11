import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { entryPlace, roomCapacity, roomLabel, searchDirectory, sectionEntries, siteEntries } from '../planningDirectory'
import { SECONDARY_BUTTON } from '../scodocPageUtils'
import { usePlanningDirectory } from '../usePlanningDirectory'
import MailSearchField from './MailSearchField'
import RoomIcon from './RoomIcon'
import SegmentedControl from './SegmentedControl'
import { getSenderInitial } from './mailSender'
import { directoryTintStyle } from '../directoryTint'
import { SHIMMER_CLASSES } from './widgetListUtils'
import { r } from '../register.js'

const TABS = [
  { id: 'room', label: 'Salles', placeholder: 'Salle, bâtiment…' },
  { id: 'person', label: 'Personnels', placeholder: 'Nom, département…' },
  { id: 'group', label: 'Formations', placeholder: 'Groupe, formation…' },
]
const SKELETON_ROWS = 8

// A person's badge, as a mail's sender's (MailRowContent, mailSender.js):
// their first letter on a colour of their own, by name (ADE gives no
// address).
function PersonBadge({ name }) {
  const badgeStyle = directoryTintStyle({ kind: 'person', name })
  return (
    <span
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-[9px] text-[15px] font-semibold leading-none ${badgeStyle ? 'app-icon--auto' : 'bg-bg-muted text-text-muted'}`}
      style={badgeStyle ?? undefined}
      aria-hidden="true"
    >
      {getSenderInitial(name)}
    </span>
  )
}

// A group's icon: people, in a colour of their own as a room's model
// (directoryTintStyle; .room-icon), no tile behind.
function GroupIcon({ entry }) {
  const tint = directoryTintStyle(entry)
  return (
    <span className={`inline-flex size-9 shrink-0 items-center justify-center ${tint ? 'room-icon' : 'text-text-muted'}`} style={tint ?? undefined} aria-hidden="true">
      <Icon icon="ph:users-three-duotone" className="size-7" />
    </span>
  )
}

// One room, person or group: its name (a room's seats apart, on the
// right), its icon before it (a room's model, RoomIcon; a person's badge;
// a group's people), where it is under it (`detail`). The one shown in the
// planning is marked.
function DirectoryRow({ entry, detail, selected, onPick }) {
  const isRoom = entry.kind === 'room'
  const seats = isRoom ? roomCapacity(entry.name) : null
  const name = isRoom ? roomLabel(entry.name) : entry.name
  return (
    <li className="flex min-w-0">
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={() => onPick(entry)}
        className={`flex min-w-0 flex-1 items-center gap-3 rounded-[12px] border-0 px-3 py-2 text-left cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand ${
          selected ? 'bg-brand-subtle' : 'bg-transparent hover:bg-bg-subtle'
        }`}
      >
        {isRoom ? <RoomIcon entry={entry} /> : entry.kind === 'group' ? <GroupIcon entry={entry} /> : <PersonBadge name={entry.name} />}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={`truncate font-body text-[15px] leading-tight ${selected ? 'font-semibold text-brand' : 'font-medium text-text'}`}>{name}</span>
          {detail ? <span className="truncate font-body text-[13px] leading-tight text-text-muted">{detail}</span> : null}
        </span>
        {seats ? <span className="shrink-0 font-body text-[13px] font-medium text-text-muted">{seats} places</span> : null}
        {selected ? <Icon icon="ph:check-bold" className="size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
      </button>
    </li>
  )
}

// « Formations »' notice, once: the groups here are to look at, the
// student's own is changed in Réglages › Planning (`onOpenSettings`).
// Gone for good on this device once closed or followed.
const GROUP_NOTICE_KEY = 'l-ent:directory-group-notice-seen'

function readGroupNoticeSeen() {
  try {
    return localStorage.getItem(GROUP_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

function GroupSettingsNotice({ onOpenSettings }) {
  const [seen, setSeen] = useState(readGroupNoticeSeen)
  // Folding away (its row from 1fr to 0fr), then gone.
  const [leaving, setLeaving] = useState(false)
  if (seen) return null
  const forget = () => {
    setSeen(true)
    try {
      localStorage.setItem(GROUP_NOTICE_KEY, '1')
    } catch {
      // Storage unavailable: hidden for the visit.
    }
  }
  const dismiss = () => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) forget()
    else setLeaving(true)
  }
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}
      onTransitionEnd={(event) => {
        if (leaving && event.target === event.currentTarget && event.propertyName === 'grid-template-rows') forget()
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="widget-card widget-card-visible relative mb-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 card-corners-sm border bg-widget-bg p-4 animate-modal-card-in" role="note">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-subtle text-brand" aria-hidden="true">
            <Icon icon="ph:users-three-duotone" className="size-[22px]" />
          </span>
          <div className="grid min-w-0 gap-1 pr-7">
            <p className="m-0 font-body text-[15px] font-semibold leading-tight text-text">
              {r('Ton groupe ne change pas', 'Votre groupe ne change pas')}
            </p>
            <p className="m-0 font-body text-[14px] leading-snug text-text-secondary">
              {r('Pour changer ton groupe définitivement, va dans les réglages', 'Pour changer votre groupe définitivement, allez dans les réglages')}
            </p>
          </div>
          <button
            type="button"
            className="material col-start-2 inline-flex h-9 items-center gap-2 justify-self-start rounded-full px-3.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            onClick={() => {
              forget()
              onOpenSettings()
            }}
          >
            <Icon icon="ph:gear-six" className="size-4 shrink-0" aria-hidden="true" />
            {/* The font on a span: index.css gives buttons `font: inherit`, outside Tailwind's layers. */}
            <span className="font-body text-[14px] font-semibold leading-none">Changer de groupe</span>
          </button>
          <button
            type="button"
            className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-full border-0 bg-transparent text-text-muted cursor-pointer transition-colors duration-150 hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-brand"
            aria-label="Masquer"
            onClick={dismiss}
          >
            <Icon icon="ph:x" className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

function DirectoryNote({ children }) {
  return <p className="m-0 px-3 py-6 text-center font-body text-[14px] leading-snug text-text-muted">{children}</p>
}

// « Salles et personnels »' content, the same in the wide screen's side
// panel (PlanningDirectoryPanel) and the phone's sheet
// (PlanningDirectorySheet): a search field and the tabs (Salles,
// Personnels, Formations) held at the top in `stickyClassName`'s box under
// the container's own `header` (its title and close button), the list
// under them. The ADE tree's rooms and staff (usePlanningDirectory), asked
// once it's first shown: the student's own site's by building or
// department (`siteLabel`, their group's; among the groups, their own
// formation first: `formationLabel`), any other by a search. A pick shows
// that one's timetable in the planning (`onPick(entry)`); `shownId`: the
// one shown. `tab` and `query` are the container's (PlanningPage's: they
// outlast the panel and the sheet), changed with `onTabChange` and
// `onQueryChange`. `inputRef`: the search field, for the panel to focus
// it. `onOpenGroupSettings`: Réglages › Planning, offered once on
// « Formations » (GroupSettingsNotice).
function PlanningDirectoryContent({ header = null, stickyClassName = '', user = null, siteLabel = null, formationLabel = null, shownId = null, onPick, onOpenGroupSettings = null, tab, onTabChange, query, onQueryChange, inputRef = null }) {
  const directory = usePlanningDirectory({ user, enabled: true })
  const { entries, status } = directory
  const results = useMemo(() => searchDirectory(entries, tab, query, { siteLabel }), [entries, tab, query, siteLabel])
  const sections = useMemo(
    () => sectionEntries(siteEntries(entries, tab, siteLabel), tab, { first: tab === 'group' ? formationLabel : null }),
    [entries, tab, siteLabel, formationLabel],
  )

  const tabInfo = TABS.find((choice) => choice.id === tab) ?? TABS[0]
  const isSearching = query.trim().length > 0
  let body
  if (status === 'loading' || status === 'idle') {
    body = (
      <ul className="m-0 grid list-none gap-1 p-0" aria-label="Chargement" aria-busy="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li key={index} className="grid gap-1.5 px-3 py-2.5">
            <span className={`h-3.5 ${index % 3 ? 'w-[45%]' : 'w-[60%]'} rounded-full ${SHIMMER_CLASSES}`} />
            <span className={`h-3 w-[35%] rounded-full ${SHIMMER_CLASSES}`} />
          </li>
        ))}
      </ul>
    )
  } else if (status === 'unsupported') {
    body = <DirectoryNote>Non disponible pour cette université</DirectoryNote>
  } else if (status === 'unavailable') {
    body = (
      <div className="grid justify-items-center gap-3 py-6">
        <DirectoryNote>{r('ADE n’a pas répondu. Vérifie ta connexion, puis réessaie', 'ADE n’a pas répondu. Vérifiez votre connexion, puis réessayez')}</DirectoryNote>
        <button type="button" className={`${SECONDARY_BUTTON} cursor-pointer`} onClick={directory.retry}>Réessayer</button>
      </div>
    )
  } else if (isSearching) {
    body = results.length ? (
      <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Résultats">
        {results.map((entry) => (
          <DirectoryRow key={entry.id} entry={entry} detail={entryPlace(entry)} selected={entry.id === shownId} onPick={onPick} />
        ))}
      </ul>
    ) : <DirectoryNote>{{ room: 'Aucune salle trouvée', person: 'Aucun nom trouvé', group: 'Aucun groupe trouvé' }[tab]}</DirectoryNote>
  } else if (sections.length) {
    body = (
      <div className="grid gap-5">
        {sections.map((section) => (
          <section key={section.title} className="grid gap-1" aria-label={section.title || undefined}>
            {section.title ? <h3 className="m-0 px-3 font-body text-[13px] font-semibold text-text-muted">{section.title}</h3> : null}
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {section.entries.map((entry) => (
                <DirectoryRow key={entry.id} entry={entry} detail={entry.detail} selected={entry.id === shownId} onPick={onPick} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  } else {
    body = (
      <DirectoryNote>
        {{
          room: r('Recherche une salle par son nom ou son bâtiment', 'Recherchez une salle par son nom ou son bâtiment'),
          person: r('Recherche une personne par son nom', 'Recherchez une personne par son nom'),
          group: r('Recherche un groupe par son nom ou sa formation', 'Recherchez un groupe par son nom ou sa formation'),
        }[tab]}
      </DirectoryNote>
    )
  }

  return (
    <>
      {/* Held at the top as the list scrolls under it. */}
      <div className={stickyClassName}>
        {header}
        {/* Enter shows the first result. */}
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            if (results[0]) onPick(results[0])
          }}
        >
          <MailSearchField value={query} onChange={onQueryChange} placeholder={tabInfo.placeholder} label={`Rechercher dans ${tabInfo.label.toLowerCase()}`} inputRef={inputRef} />
        </form>
        <SegmentedControl
          kind="tabs"
          options={TABS.map((choice) => ({ value: choice.id, label: choice.label }))}
          value={tab}
          onChange={onTabChange}
          label="Annuaire"
        />
      </div>
      <div role="tabpanel" aria-label={tabInfo.label}>
        {tab === 'group' && onOpenGroupSettings && status === 'loaded' ? <GroupSettingsNotice onOpenSettings={onOpenGroupSettings} /> : null}
        {body}
      </div>
    </>
  )
}

export default PlanningDirectoryContent
