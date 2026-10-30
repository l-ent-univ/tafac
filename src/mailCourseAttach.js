// The composer's « Un cours… » (its trombone's menu): a class picked in a
// drawer (MailCoursePicker) goes into the mail as « Écrire au sujet de ce
// cours » puts it there (src/courseMail.js): its summary box and its image
// inline. Pure, so the tests run it straight in Node: which classes the
// drawer lists, by day, and its search.

import { addDays, agendaDayText, startOfWeek } from './planningDates.js'
import { foldMailSearchText } from './mailSearch.js'

// The week before today and the week after: the classes a mail is about
// (one missed, one coming up), the planning's own cache mostly.
export const COURSE_PAST_DAYS = 7
export const COURSE_AHEAD_DAYS = 7

// The days the drawer covers, first and last ("YYYY-MM-DD").
export function courseWindow(todayKey) {
  return { from: addDays(todayKey, -COURSE_PAST_DAYS), to: addDays(todayKey, COURSE_AHEAD_DAYS) }
}

// The Mondays of the weeks it spans (usePlanningWeeks asks a week each).
export function courseWindowMondays(todayKey) {
  const { from, to } = courseWindow(todayKey)
  const mondays = []
  for (let monday = startOfWeek(from); monday <= to; monday = addDays(monday, 7)) mondays.push(monday)
  return mondays
}

// The classes of the window (`events`: usePlanningWeeks', in order), by
// day in the planning list's order (the past week first, today in the
// middle: the drawer opens on it). → [{ day, events }].
export function listCourseDays(events, todayKey) {
  const { from, to } = courseWindow(todayKey)
  const days = new Map()
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.day || event.day < from || event.day > to) continue
    if (!days.has(event.day)) days.set(event.day, [])
    days.get(event.day).push(event)
  }
  return [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, list]) => ({ day, events: list }))
}

// The day the drawer scrolls to: today's, else the next one with classes,
// else the last.
export function pickCourseStartDay(days, todayKey) {
  if (!days.length) return null
  return (days.find((entry) => entry.day >= todayKey) ?? days.at(-1)).day
}

// The days as the search field narrows them: every word found in the
// class's title, room, teacher, group or day (« mardi », « demain »),
// accents and case aside; a day left without a class goes.
export function filterCourseDays(days, query, todayKey) {
  const words = foldMailSearchText(query).split(/\s+/).filter(Boolean)
  if (!words.length) return days
  return days
    .map(({ day, events }) => {
      const { title, detail } = agendaDayText(day, todayKey)
      return {
        day,
        events: events.filter((event) => {
          const text = foldMailSearchText([event.title, event.location, event.teacher, event.group, title, detail].filter(Boolean).join(' '))
          return words.every((word) => text.includes(word))
        }),
      }
    })
    .filter((entry) => entry.events.length)
}
