import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { getAdeRoomEvents, getAdeRooms } from '../../entApi'
import { addDays, findFreeRooms, formatDateOnly } from '../../planningUtils'
import AppSheet from '../AppSheet'
import Dropdown from '../Dropdown'
import LoadingDots from '../LoadingDots'
import { SegmentedControl } from '../ScodocUi'
import { INLINE_BUTTON } from '../AppPage'

// « Salles libres »: every room of a building (ADE's "Salles"), free or
// busy now. The building is picked once and remembered; by default the one
// holding most of the student's own courses. On a weekend or after the last
// courses, the next school day's morning instead, said as such.

const BUILDING_STORAGE_KEY = 'l-ent:free-rooms-building'
const DAY_END_HOUR = 19
const DAY_START_HOUR = 8

function readStoredBuilding() {
  try {
    return localStorage.getItem(BUILDING_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeBuilding(key) {
  try {
    localStorage.setItem(BUILDING_STORAGE_KEY, key)
  } catch {
    // Storage blocked: the pick lasts until the sheet closes.
  }
}

function buildingKey(room) {
  return room.path?.length ? room.path.join(' › ') : 'Autres salles'
}

// When to look: now on a school day before the last courses, else the
// next school day at 8h, with why.
function resolveMoment(now = new Date()) {
  const day = now.getDay()
  const isWeekend = day === 0 || day === 6
  if (!isWeekend && now.getHours() < DAY_END_HOUR) {
    return { at: now, isToday: true, reason: null }
  }
  let next = addDays(now, 1)
  while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1)
  const at = new Date(next.getFullYear(), next.getMonth(), next.getDate(), DAY_START_HOUR, 0)
  const dayName = at.toLocaleDateString('fr-FR', { weekday: 'long' })
  return {
    at,
    isToday: false,
    reason: isWeekend
      ? `Le campus est fermé le week-end : voici les salles de ${dayName} matin.`
      : `Les cours sont finis pour aujourd’hui : voici les salles de ${dayName} matin.`,
  }
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours} h${rest ? String(rest).padStart(2, '0') : ''}` : `${rest} min`
}

export default function FreeRoomsModal({ isOpen, onClose, events = [] }) {
  const [rooms, setRooms] = useState({ status: 'loading', list: [] })
  const [building, setBuilding] = useState(() => readStoredBuilding())
  const [occupancy, setOccupancy] = useState({ status: 'idle', key: null, events: [] })
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState('free')
  const moment = useMemo(() => (isOpen ? resolveMoment() : null), [isOpen])

  useEffect(() => {
    if (!isOpen || rooms.status === 'ok') return undefined
    let cancelled = false
    getAdeRooms()
      .then((data) => {
        if (cancelled) return
        setRooms(data?.available && data.rooms?.length
          ? { status: 'ok', list: data.rooms }
          : { status: 'unavailable', list: [] })
      })
      .catch(() => { if (!cancelled) setRooms({ status: 'error', list: [] }) })
    return () => { cancelled = true }
  }, [isOpen, rooms.status])

  const buildings = useMemo(() => {
    const groups = new Map()
    for (const room of rooms.list) {
      const key = buildingKey(room)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(room)
    }
    return groups
  }, [rooms.list])

  // The remembered building, else the one with most of the student's rooms.
  const activeBuilding = useMemo(() => {
    if (building && buildings.has(building)) return building
    let best = null
    let bestScore = -1
    const locations = events.map((event) => String(event.location ?? '')).filter(Boolean)
    for (const [key, list] of buildings) {
      const score = list.filter((room) => locations.some((location) => location.includes(room.name))).length
      if (score > bestScore) {
        best = key
        bestScore = score
      }
    }
    return best
  }, [building, buildings, events])

  const buildingRooms = useMemo(() => buildings.get(activeBuilding) ?? [], [buildings, activeBuilding])
  const day = moment ? formatDateOnly(moment.at) : null
  const occupancyKey = activeBuilding && day ? `${activeBuilding}|${day}` : null

  // One request per building and day; an answer for another one is dropped.
  const requestedKeyRef = useRef(null)
  useEffect(() => {
    if (!isOpen || !occupancyKey || requestedKeyRef.current === occupancyKey || !buildingRooms.length) return
    requestedKeyRef.current = occupancyKey
    setOccupancy({ status: 'loading', key: occupancyKey, events: [] })
    getAdeRoomEvents(buildingRooms.map((room) => room.id), day)
      .then((list) => { if (requestedKeyRef.current === occupancyKey) setOccupancy({ status: 'ok', key: occupancyKey, events: list }) })
      .catch(() => {
        if (requestedKeyRef.current !== occupancyKey) return
        requestedKeyRef.current = null
        setOccupancy({ status: 'error', key: occupancyKey, events: [] })
      })
  }, [isOpen, occupancyKey, buildingRooms, day])

  const results = useMemo(
    () => (occupancy.status === 'ok' && moment ? findFreeRooms(occupancy.events, moment.at, buildingRooms) : []),
    [occupancy, moment, buildingRooms],
  )
  const freeCount = results.filter((result) => result.isFree).length
  const query = searchQuery.trim().toLowerCase()
  const visible = results.filter((result) => (
    (filterMode === 'all' || result.isFree)
    && (!query || result.room.toLowerCase().includes(query) || result.currentClass?.toLowerCase().includes(query))
  ))

  const handleBuildingChange = (key) => {
    setBuilding(key)
    storeBuilding(key)
  }

  let body
  if (rooms.status === 'loading' || (rooms.status === 'ok' && occupancy.status !== 'ok' && occupancy.status !== 'error')) {
    body = <LoadingDots label="Recherche des salles" className="w-full py-12 text-text-muted" />
  } else if (rooms.status === 'unavailable') {
    body = <EmptyRooms icon="carbon:building" text="Ton compte ADE ne donne pas accès à la liste des salles." />
  } else if (rooms.status === 'error' || occupancy.status === 'error') {
    body = <EmptyRooms icon="carbon:cloud-offline" text="ADE ne répond pas pour le moment. Réessaie dans quelques minutes." />
  } else if (!visible.length) {
    body = (
      <EmptyRooms
        icon="carbon:search"
        text={query ? 'Aucune salle ne correspond à ta recherche.' : 'Aucune salle libre dans ce bâtiment à ce moment-là.'}
      />
    )
  } else {
    body = (
      <ul className="m-0 grid list-none gap-2 p-0">
        {visible.map((item) => (
          <li key={item.room} className={`flex items-center gap-3 rounded-[18px] border border-white bg-widget-bg px-3.5 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-border ${item.isFree ? '' : 'opacity-70'}`}>
            <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${item.isFree ? 'bg-success-bg text-success-text' : 'bg-muted-fill text-text-muted'}`} aria-hidden="true">
              <Icon icon={item.isFree ? 'carbon:checkmark' : 'carbon:user-multiple'} className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-body text-[15px] font-semibold text-text">{item.room}</span>
              <span className="truncate font-body text-[13px] font-medium text-text-muted">
                {item.isFree
                  ? (item.untilTime ? `Libre jusqu’à ${item.untilTime}` : 'Libre jusqu’au soir')
                  : `${item.currentClass} · libre à ${item.untilTime}`}
              </span>
            </span>
            {item.isFree ? (
              <span className="shrink-0 rounded-full bg-success-bg px-2.5 py-1 font-body text-[12px] font-semibold text-success-text">
                {item.availableMinutes >= 999 ? 'Journée' : formatDuration(item.availableMinutes)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    )
  }

  const buildingOptions = [...buildings.keys()].sort((left, right) => left.localeCompare(right, 'fr'))
    .map((key) => ({ value: key, label: `${key} (${buildings.get(key).length})` }))

  return (
    <AppSheet
      open={isOpen}
      onClose={onClose}
      icon="carbon:workspace"
      title="Salles libres"
      subtitle={occupancy.status === 'ok'
        ? `${freeCount} salle${freeCount > 1 ? 's' : ''} libre${freeCount > 1 ? 's' : ''} sur ${results.length}${moment?.isToday ? ' en ce moment' : ''}`
        : 'Les salles de ton bâtiment, d’après ADE'}
      toolbar={rooms.status === 'ok' ? (
        <div className="grid gap-3">
          {moment?.reason ? (
            <p className="m-0 flex items-start gap-2 rounded-[14px] bg-accent-bg px-3 py-2 font-body text-[13px] font-medium text-accent-text">
              <Icon icon="carbon:calendar" className="mt-px size-4 shrink-0" aria-hidden="true" />
              {moment.reason}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {buildingOptions.length > 1 ? (
              <Dropdown
                label="Bâtiment"
                options={buildingOptions}
                value={activeBuilding}
                onChange={handleBuildingChange}
                // The building alone on the button ("Bâtiment 05 - INFO"):
                // the whole ADE path doesn't fit; the menu keeps it.
                triggerLabel={activeBuilding ? `${activeBuilding.split(' › ').at(-1)} (${buildingRooms.length})` : null}
                className="max-w-full"
                triggerClassName={`${INLINE_BUTTON} max-w-full`}
              />
            ) : null}
            <label className="relative min-w-[180px] flex-1">
              <span className="sr-only">Rechercher une salle</span>
              <Icon icon="carbon:search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Rechercher (A101, amphi…)"
                className="h-9 w-full rounded-full border border-border bg-widget-bg pl-9 pr-3 font-body text-[14px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
              />
            </label>
            <SegmentedControl
              label="Salles affichées"
              options={[
                { value: 'free', label: 'Libres', count: occupancy.status === 'ok' ? freeCount : null },
                { value: 'all', label: 'Toutes', count: occupancy.status === 'ok' ? results.length : null },
              ]}
              value={filterMode}
              onChange={setFilterMode}
            />
          </div>
        </div>
      ) : null}
      footer={<span className="font-body text-[12px] font-medium text-text-muted">D’après les réservations ADE : une salle libre peut rester fermée à clé.</span>}
    >
      {body}
    </AppSheet>
  )
}

function EmptyRooms({ icon, text }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" role="status">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted-fill text-text" aria-hidden="true">
        <Icon icon={icon} className="size-6" />
      </span>
      <p className="m-0 max-w-[340px] font-body text-[14px] font-medium text-text-secondary">{text}</p>
    </div>
  )
}
