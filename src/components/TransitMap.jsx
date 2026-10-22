import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// The network on an OpenStreetMap background (« Bus » › Plan du réseau):
// each line in its colour (the chosen one on top, the others faded), its
// stops as dots, home and the campus marked, the student's position when
// shared. A stop tapped is picked (its departures). Loaded on its own
// (React.lazy): Leaflet stays out of the main bundle.
// shortcut: tiles from tile.openstreetmap.org, fine for a student app's
// traffic under OSM's usage policy; move to a tile provider if it grows.

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function pinIcon(className, label) {
  return L.divIcon({ className: `transit-pin ${className}`, html: `<span>${label}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] })
}

export default function TransitMap({ network, routeId = null, homePlaceId = null, campus = null, position = null, selectedPlaceId = null, onSelectPlace }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const fittedRef = useRef(null)

  useEffect(() => {
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, preferCanvas: true })
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION, className: 'transit-map-tiles' }).addTo(map)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    // A new map has no view yet (StrictMode makes it twice): frame it again.
    fittedRef.current = null
    // The container's size settles after the page's slide-in.
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !network) return
    layer.clearLayers()

    const routeColor = new Map(network.routes.map((route) => [route.id, route.color]))
    const lines = routeId
      ? [...network.lines.filter((line) => line.routeId !== routeId), ...network.lines.filter((line) => line.routeId === routeId)]
      : network.lines
    for (const line of lines) {
      const chosen = !routeId || line.routeId === routeId
      L.polyline(line.shape, {
        color: routeColor.get(line.routeId) ?? '#6B7280',
        weight: chosen ? 5 : 3,
        opacity: chosen ? 0.9 : 0.18,
        interactive: false,
      }).addTo(layer)
    }

    const served = routeId
      ? new Set(network.lines.filter((line) => line.routeId === routeId).flatMap((line) => line.placeIds))
      : null
    for (const place of network.places) {
      if (served && !served.has(place.id)) continue
      const selected = place.id === selectedPlaceId
      // Every stop of the network: small, so the lines stay readable.
      L.circleMarker([place.lat, place.lon], {
        radius: selected ? 8 : routeId ? 5 : 3,
        color: selected ? '#111827' : '#ffffff',
        weight: routeId || selected ? 2 : 1,
        fillColor: selected ? '#ffffff' : (routeId ? routeColor.get(routeId) : '#374151'),
        fillOpacity: 1,
      })
        .bindTooltip(place.name, { direction: 'top', offset: [0, -6] })
        .on('click', () => onSelectPlace?.(place.id))
        .addTo(layer)
    }

    const home = network.places.find((place) => place.id === homePlaceId)
    if (home) L.marker([home.lat, home.lon], { icon: pinIcon('is-home', '⌂'), keyboard: false }).bindTooltip(`Ton arrêt : ${home.name}`).addTo(layer)
    if (campus) L.marker([campus.lat, campus.lon], { icon: pinIcon('is-campus', '★'), keyboard: false }).bindTooltip(campus.label).addTo(layer)
    if (position) L.circleMarker([position.lat, position.lon], { radius: 7, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('Toi').addTo(layer)

    // Framed once on the network (or the chosen line), not on every update.
    const frameKey = routeId ?? '*'
    const framePoints = (routeId ? network.lines.filter((line) => line.routeId === routeId) : network.lines).flatMap((line) => line.shape)
    if (framePoints.length && fittedRef.current !== frameKey) {
      map.fitBounds(L.latLngBounds(framePoints), { padding: [24, 24], maxZoom: 15 })
      fittedRef.current = frameKey
    }
  }, [campus, homePlaceId, network, onSelectPlace, position, routeId, selectedPlaceId])

  return <div ref={containerRef} className="transit-map h-[420px] w-full overflow-hidden rounded-[22px] border border-border max-md:h-[340px] max-md:rounded-[20px]" role="region" aria-label="Carte du réseau de bus" />
}
