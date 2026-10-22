import { useState } from 'react'
import { Icon } from '@iconify/react'
import { distanceMeters } from '../transitApi'
import { PAGE_CARD } from './AppPage'
import { SegmentedControl } from './ScodocUi'
import { LineBadge } from './TransitUi'

// A line as a metro-style plan (« Bus » › Plan du réseau › Lignes): its
// stops down a rail in the line's colour, one direction at a time, the
// other lines served at each stop, home and the campus flagged. A stop
// tapped is picked (its departures).

const CAMPUS_RADIUS_M = 500

export default function TransitLineDiagram({ network, routeId, homePlaceId = null, campus = null, selectedPlaceId = null, onSelectPlace }) {
  const route = network.routes.find((entry) => entry.id === routeId)
  const directions = network.lines.filter((line) => line.routeId === routeId)
  const [directionId, setDirectionId] = useState(directions[0]?.directionId ?? 0)
  const line = directions.find((entry) => entry.directionId === directionId) ?? directions[0]
  if (!route || !line) return null

  const places = new Map(network.places.map((place) => [place.id, place]))
  const routes = new Map(network.routes.map((entry) => [entry.id, entry]))

  return (
    <div className={`${PAGE_CARD} grid gap-3 p-4 max-md:p-3`}>
      {directions.length > 1 ? (
        <SegmentedControl
          label="Sens"
          size="sm"
          options={directions.map((entry) => ({ value: entry.directionId, label: `→ ${entry.headsign || places.get(entry.placeIds.at(-1))?.name}` }))}
          value={line.directionId}
          onChange={setDirectionId}
          className="max-w-full overflow-x-auto"
        />
      ) : null}
      <ol className="m-0 grid list-none p-0" style={{ '--line-color': route.color }}>
        {line.placeIds.map((placeId, index) => {
          const place = places.get(placeId)
          if (!place) return null
          const isEnd = index === 0 || index === line.placeIds.length - 1
          const isHome = placeId === homePlaceId
          const isCampus = campus && distanceMeters(campus, place) <= CAMPUS_RADIUS_M
          const connections = place.routeIds.filter((id) => id !== routeId).map((id) => routes.get(id)).filter(Boolean)
          return (
            <li key={`${placeId}-${index}`} className="transit-diagram-stop relative">
              <button
                type="button"
                onClick={() => onSelectPlace?.(placeId)}
                className={`flex min-h-10 w-full min-w-0 cursor-pointer items-center gap-3 rounded-[12px] border-0 bg-transparent py-0 pr-2 pl-0 text-left text-text transition-colors hover:bg-row-hover ${placeId === selectedPlaceId ? 'bg-row-hover' : ''}`}
                aria-current={placeId === selectedPlaceId ? 'true' : undefined}
              >
                <span className="relative flex w-8 shrink-0 justify-center self-stretch" aria-hidden="true">
                  <span className={`transit-diagram-rail ${index === 0 ? 'is-first' : ''} ${index === line.placeIds.length - 1 ? 'is-last' : ''}`} />
                  <span className={`transit-diagram-dot relative z-[1] my-auto ${isEnd ? 'is-end' : ''}`} />
                </span>
                <span className={`min-w-0 flex-1 truncate font-body text-[14px] leading-tight ${isEnd ? 'font-bold' : 'font-medium'}`}>{place.name}</span>
                {isHome ? <Icon icon="carbon:home" className="size-4 shrink-0 text-brand" aria-label="Ton arrêt" /> : null}
                {isCampus ? <Icon icon="carbon:education" className="size-4 shrink-0 text-brand" aria-label={campus.label} /> : null}
                <span className="flex shrink-0 gap-1">
                  {connections.slice(0, 4).map((connection) => (
                    <LineBadge key={connection.id} line={connection.shortName} color={connection.color} textColor={connection.textColor} size="sm" />
                  ))}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
