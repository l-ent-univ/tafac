import { useId, useMemo } from 'react'
import { Icon } from '@iconify/react'
import { groupCollections } from '../planningDirectory'
import { directoryTintStyle } from '../directoryTint'
import { r } from '../register.js'
import SmoothSurface from './SmoothSurface'

// A group to pick: a small key with its short name (its full one in the
// tooltip), all of a width while their names are short, so they line up
// from a year to the next. The one shown in the planning in the brand's
// colour (`shown`); the student's own ringed, a person before its name
// (`own`).
function GroupKey({ entry, label, shown, own, onPick }) {
  const look = shown
    ? 'lent-button'
    : `border-0 bg-state-hover text-text transition-[background-color,scale] duration-150 hover:bg-state-press active:scale-[0.96] active:bg-state-press ${own ? 'shadow-[inset_0_0_0_1.5px_var(--color-brand)]' : ''}`
  return (
    <li className="flex min-w-0">
      <button
        type="button"
        title={own ? `${entry.name} · ${r('Ton groupe', 'Votre groupe')}` : entry.name}
        aria-label={own ? `${entry.name}, ${r('ton groupe', 'votre groupe')}` : entry.name}
        aria-current={shown || undefined}
        onClick={() => onPick(entry)}
        className={`relative inline-flex h-9 min-w-[52px] max-w-full items-center justify-center gap-[3px] corners-[10px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${own && label.length <= 3 ? 'px-[5px]' : 'px-2.5'} ${look}`}
      >
        {shown ? <SmoothSurface /> : null}
        {/* Tight beside a short name (« 1A1 »): its key stays as wide as the others. */}
        {own ? <Icon icon="ph:user-fill" className="size-3 shrink-0" aria-hidden="true" /> : null}
        {/* The font on a span: index.css gives buttons `font: inherit`, outside Tailwind's layers.
            A full line's height: the ellipsis' clip would cut accents and descenders on a tighter one. */}
        <span className="min-w-0 truncate font-body text-[14px] font-semibold leading-5">{label}</span>
      </button>
    </li>
  )
}

// A year of a formation, one row: its name, then its groups, those of a
// TD kept side by side (the TD's name before them where theirs don't say
// it). `labels`: where the formation's years have their names: 'side', a
// column on the left (above the groups in a narrow card); 'above', names
// too long for the column; 'none', its groups right under the formation.
function YearRow({ year, labels, shownId, ownId, onPick }) {
  const labelId = useId()
  const side = labels === 'side'
  return (
    <div
      role="group"
      aria-labelledby={year.label ? labelId : undefined}
      className={`grid grid-cols-[minmax(0,1fr)] items-start gap-x-2 gap-y-1 border-t border-border py-2 ${side ? '@min-[300px]:grid-cols-[60px_minmax(0,1fr)]' : ''}`}
    >
      {labels === 'none' ? null : (
        <h4 id={labelId} className={`m-0 font-body text-[13px] font-medium leading-[18px] text-text-muted [overflow-wrap:anywhere] ${side ? '@min-[300px]:py-[9px]' : ''}`}>{year.label}</h4>
      )}
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1.5">
        {year.tds.map((td) => (
          <div key={td.id} className="flex min-w-0 flex-wrap items-center gap-1.5">
            {td.label ? <span className="pr-0.5 font-body text-[13px] font-medium text-text-muted" aria-hidden="true">{td.label}</span> : null}
            <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0" aria-label={td.name || undefined}>
              {td.groups.map(({ entry, label }) => (
                <GroupKey key={entry.id} entry={entry} label={label} shown={entry.id === shownId} own={entry.id === ownId} onPick={onPick} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

// The longest year's name its column holds (« 1re année »).
const SIDE_LABEL_LENGTH = 9

// A formation, one card: its name in full (a cap in a colour of its own
// before it, « Ta formation » after it on the student's), then a row per
// year.
function FormationCard({ formation, shownId, ownId, onPick }) {
  const titleId = useId()
  const tint = directoryTintStyle({ kind: 'group', id: formation.id })
  const named = formation.years.filter((year) => year.label)
  const labels = named.length === 0 ? 'none' : named.every((year) => year.label.length <= SIDE_LABEL_LENGTH) ? 'side' : 'above'
  return (
    // An even hairline all round (the rows' hover ring, PlanningDirectoryContent):
    // the glass cards' bright top edge vanished on the panel, the card
    // looking cut off under the tabs.
    <section className="min-w-0 card-corners-sm bg-card px-3.5 pt-3 pb-1.5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-text)_10%,transparent),0_1px_2px_rgb(0_0_0/0.05)] dark:bg-white/4 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]" aria-labelledby={titleId}>
      <header className="flex min-w-0 items-start gap-2 pb-2.5">
        <span className={`inline-flex shrink-0 ${tint ? 'room-icon' : 'text-text-muted'}`} style={tint ?? undefined} aria-hidden="true">
          <Icon icon="ph:graduation-cap-duotone" className="size-5" />
        </span>
        <h3 id={titleId} className="m-0 min-w-0 flex-1 font-body text-[15px] font-semibold leading-5 text-text [overflow-wrap:anywhere]">{formation.label}</h3>
        {formation.own ? (
          <span className="shrink-0 font-body text-[12.5px] font-medium leading-5 text-text-muted">{r('Ta formation', 'Votre formation')}</span>
        ) : null}
      </header>
      {/* The rows lay themselves out on the card's width, a panel's or a phone's. */}
      <div className="@container">
        {formation.years.map((year) => (
          <YearRow key={year.id} year={year} labels={labels} shownId={shownId} ownId={ownId} onPick={onPick} />
        ))}
      </div>
    </section>
  )
}

// « Formations » without a search: the site's groups as small collections,
// a card per formation with its years in rows and each year's groups as
// keys, all in sight (groupCollections). The student's own formation
// first, their own group (`ownId`) marked in it; the group shown in the
// planning marked too: `shownId`, their own when none is. `entries`: the
// site's groups (siteEntries); `formationLabel`: their formation's name,
// for when their group isn't among them. `onPick(entry)`: a group picked.
function PlanningGroupCollections({ entries, formationLabel = null, ownId = null, shownId = null, onPick }) {
  const collections = useMemo(() => groupCollections(entries, { ownId, first: formationLabel }), [entries, ownId, formationLabel])
  const currentId = shownId ?? ownId
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {collections.map((formation) => (
        <FormationCard key={formation.id} formation={formation} shownId={currentId} ownId={ownId} onPick={onPick} />
      ))}
    </div>
  )
}

export default PlanningGroupCollections
