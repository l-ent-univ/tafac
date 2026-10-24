import { buildDailyBriefing } from './dailyBriefing'
import {
  buildDemoMailPayload,
  buildDemoMoodleDeadlinesPayload,
  buildDemoUpcomingPayload,
} from './demoAccount'
import { buildDemoGradesPayload } from './demoGrades'
import { listGradedEvaluations } from './entApi'
import { NEXT_CLASS_LOOKAHEAD_DAYS, getTodayDateString } from './upcomingClasses'

const DAY_MS = 24 * 60 * 60 * 1000
const GREETING_NAMES = ['Camille', 'Lucas', 'Inès', 'Hugo', 'Léa', 'Nathan']
const MAX_FRAMES = 6
// Mails and deadlines the cards show at once (WidgetRecentMail,
// WidgetDeadlines).
const LIST_ROWS = 2

// The dashboard's widgets on the landing page, filled with the demo account's
// data in the shapes the widgets load (their `preview` props). Each widget
// gets a few frames the page cycles through. Nothing here talks to the server.
export function buildLandingPreview(now = new Date()) {
  const upcoming = buildDemoUpcomingPayload({
    date: getTodayDateString(),
    lookaheadDays: NEXT_CLASS_LOOKAHEAD_DAYS,
  })
  const classes = { events: upcoming.events, complete: upcoming.complete }
  const deadlines = buildDemoMoodleDeadlinesPayload({ now: now.getTime(), moodleHref: null })
  const mail = buildDemoMailPayload({ now: now.getTime(), webmailHref: null })
  const grades = listGradedEvaluations({ authenticated: true, grades: buildDemoGradesPayload() })

  // The briefing of the next days (the demo week), one per name.
  const briefings = [...new Set(Array.from({ length: 7 }, (_, day) => buildDailyBriefing({
    classes,
    deadlines: deadlines.items,
    now: new Date(now.getTime() + day * DAY_MS),
  })).filter(Boolean))]
  // The upcoming classes one after the other: each frame drops the one before.
  const futureEvents = upcoming.events.filter((event) => new Date(event.start) > now)

  return {
    greetings: GREETING_NAMES.map((displayName, index) => ({
      displayName,
      greeting: briefings[index % Math.max(briefings.length, 1)] ?? null,
    })),
    upcomingEvents: Array.from(
      { length: Math.min(MAX_FRAMES, Math.max(futureEvents.length, 1)) },
      (_, index) => futureEvents.slice(index),
    ),
    latestGrades: Array.isArray(grades) ? grades.slice(0, MAX_FRAMES) : [],
    mail: chunk(mail.messages, LIST_ROWS).map((messages) => ({ status: 'ok', ...mail, messages })),
    deadlines: chunk(deadlines.items, LIST_ROWS).map((items) => ({ status: 'ok', ...deadlines, items })),
  }
}

function chunk(list, size) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size))
}
