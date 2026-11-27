import { useCallback, useEffect, useRef, useState } from 'react'
import { trackPlanningAction } from './analytics'
import { startOfWeek, toDayKey } from './planningDates'
import { mergeEvents, toPlanningEvent } from './planningEvents'
import { ICS_FILE_NAME, ICS_MIME_TYPE, buildIcsCalendar } from './planningIcs'
import { fetchUpcomingEvents } from './upcomingClasses'

// The days exported: the next two months.
const EXPORT_DAYS = 60
// A notice (nothing to export, or it failed) stays this long.
const NOTICE_MS = 4000

function saveFile(text) {
  const url = URL.createObjectURL(new Blob([text], { type: ICS_MIME_TYPE }))
  const link = document.createElement('a')
  link.href = url
  link.download = ICS_FILE_NAME
  document.body.append(link)
  link.click()
  link.remove()
  // Let the download start before the blob goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// The planning's .ics export (the planning's header, Réglages › Planning):
// the group's next 60 days from this week's Monday, asked afresh (the page
// only holds the weeks visited), saved as a file for Google Agenda, Apple
// Calendrier or Outlook (planningIcs). `state`: 'idle', 'loading', then
// 'empty' (no class to export) or 'error' for a few seconds. `from`: where
// the export is ('header', 'settings'), reported with its result
// (ics_exported, an outcome only: never what the file holds).
export function usePlanningExport(selection, { from = 'header' } = {}) {
  const [state, setState] = useState('idle')
  const controllerRef = useRef(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    if (state !== 'error' && state !== 'empty') return undefined
    const timeoutId = window.setTimeout(() => setState('idle'), NOTICE_MS)
    return () => window.clearTimeout(timeoutId)
  }, [state])

  const run = useCallback(async () => {
    if (!selection) return
    const controller = new AbortController()
    controllerRef.current = controller
    setState('loading')
    try {
      const { events } = await fetchUpcomingEvents({
        selection,
        signal: controller.signal,
        startDate: startOfWeek(toDayKey(Date.now())),
        lookaheadDays: EXPORT_DAYS,
      })
      const classes = mergeEvents(events.map(toPlanningEvent))
      if (classes.length === 0) {
        trackPlanningAction('ics_exported', { from, result: 'empty' })
        setState('empty')
        return
      }
      saveFile(buildIcsCalendar(classes, { now: Date.now() }))
      trackPlanningAction('ics_exported', { from, result: 'ok' })
      setState('idle')
    } catch {
      if (controller.signal.aborted) return
      trackPlanningAction('ics_exported', { from, result: 'error' })
      setState('error')
    }
  }, [selection, from])

  return { state, run }
}
