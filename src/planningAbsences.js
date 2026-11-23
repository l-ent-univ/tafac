// The planning's classes and the absences ScoDoc holds for them (buildAbsenceReport's
// entries): which class an absence is, which absence a class has. Pure, see
// tests/planningAbsences.test.js.
import { absenceStart } from './assiduity.js'
import { courseKey } from './eventAccents.js'

const HOUR_MS = 3600 * 1000

// Whether the absence (or lateness) falls within the class's hours. A lateness
// has no length: its minute counts. shortcut: only the day an absence starts
// (`endDate` ones, over several days, aren't spread), upgrade if they matter.
function overlaps(entry, event) {
  const from = absenceStart(entry)?.getTime()
  if (from == null) return false
  const to = from + Math.max(0, entry.endHours - entry.startHours) * HOUR_MS
  return from < event.end && Math.max(to, from + 1) > event.start
}

// The absence a class has, if any.
export function absenceOn(entries, event) {
  return entries.find((entry) => overlaps(entry, event)) ?? null
}

// The class an absence is: among those within its hours, the one named for
// its module (the planning's titles carry the code, « R5.11 … »), then for
// its subject, else the first.
export function findFocusedEvent(events, entry) {
  const within = events.filter((event) => overlaps(entry, event))
  const named = (name) => {
    const key = courseKey(name)
    return key ? within.find((event) => courseKey(event.title).includes(key)) : undefined
  }
  return named(entry.moduleCode) ?? named(entry.subjectTitle) ?? within[0] ?? null
}
