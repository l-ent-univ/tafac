import { getSenderBadgeStyle } from './components/mailSender'

// A room's or a person's own colour in « Salles et personnels » (the mail
// badges' palette, mailSender.js), the same on their icon (RoomIcon, the
// panel's badge) and on the frame round their timetable
// (PlanningViewedFrame). `entry`: { id, name, kind }. Null before the
// palette is known.
export function directoryTintStyle(entry) {
  if (!entry) return null
  if (entry.kind === 'person') return getSenderBadgeStyle(String(entry.name ?? '').toLowerCase())
  return getSenderBadgeStyle(`${entry.kind}:${entry.id}`)
}
