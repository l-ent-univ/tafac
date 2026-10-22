import { dayText, daysBetween, relativeDayText } from './planningDates'

// Each announcement kind's icon, short label and tint (mailSignals), the
// same on the dashboard and the planning: amber for the site, red for a
// class called off, blue for one moved.
const AMBER = 'bg-[#fff1d6] text-[#b76e00] dark:bg-[#3a2a0d] dark:text-[#f2b544]'
const BLUE = 'bg-[#e6f0ff] text-[#1d5fd1] dark:bg-[#14243f] dark:text-[#7aa7ff]'

export const SIGNAL_STYLES = {
  closure: { icon: 'carbon:locked', short: 'Site fermé', tint: AMBER },
  strike: { icon: 'carbon:warning-alt', short: 'Grève', tint: AMBER },
  cancelled: { icon: 'carbon:close-outline', short: 'Annulé', tint: 'bg-error-bg text-error' },
  postponed: { icon: 'carbon:time', short: 'Reporté', tint: BLUE },
  room: { icon: 'carbon:location', short: 'Salle changée', tint: BLUE },
  related: { icon: 'carbon:information', short: 'Info blocus', tint: BLUE },
}

// A class's chip text: the new room when the mail names it.
export function signalChipText(notice) {
  if (notice.kind === 'room' && notice.signal.room) return `Salle ${notice.signal.room}`
  return SIGNAL_STYLES[notice.kind].short
}

// The days of an announcement, as words: "Demain · Vendredi 23 octobre",
// "Du lundi 19 au mercredi 21 octobre" (a run of three or more), else
// "Mardi 20 octobre, mercredi 21 octobre et aujourd’hui".
export function describeDays(days, todayKey) {
  if (!days.length) return 'Date non précisée'
  const labels = days.map((day) => relativeDayText(day, todayKey))
  if (days.length === 1) {
    return labels[0] === dayText(days[0]) ? labels[0] : `${labels[0]} · ${dayText(days[0])}`
  }
  const isRun = days.every((day, index) => index === 0 || daysBetween(days[index - 1], day) === 1)
  if (isRun && days.length >= 3) return `Du ${dayText(days[0])} au ${dayText(days.at(-1)).toLowerCase()}`
  const words = labels.map((label, index) => (index ? label.charAt(0).toLowerCase() + label.slice(1) : label))
  return `${words.slice(0, -1).join(', ')} et ${words.at(-1)}`
}
