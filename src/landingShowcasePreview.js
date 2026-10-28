// The data of the landing showcase's previews (LandingShowcasePreviews):
// « Mes notes », the Planning and the Messagerie as the app shows them,
// filled with the demo account's data, built here with the app's own
// functions (the relevé's report, a class as the Planning reads it, the mail
// « Écrire au sujet de cette note » writes). Nothing here talks to the
// server. Pure (no React, no @university), see
// tests/landingShowcasePreview.test.js.
import { buildDemoGradesPayload, buildDemoMailPayload, buildDemoUpcomingPayload } from './demoAccount.js'
import { assignAccent } from './eventAccents.js'
import { findEvaluation } from './gradeDetail.js'
import { buildGradeMailSubject, buildGradeSummaryRows, describeGradeMailAbout, findModuleTeacher } from './gradeMail.js'
import { buildGradesReport } from './gradesReport.js'
import { getMailAddressDomain, isOwnMailDomain } from './mailDomain.js'
import { toDayKey } from './planningDates.js'
import { isOngoing, toPlanningEvent } from './planningEvents.js'

// Grade cards, days and classes (in all), and mails each preview shows.
const LATEST_GRADES = 3
const PLANNING_DAYS = 2
const PLANNING_CLASSES = 4
const MAIL_ROWS = 3
// The mail page's domain for the demo's own senders (its addresses are the
// Université de Rennes'): only a sender from elsewhere shows theirs.
export const DEMO_OWN_MAIL_DOMAINS = ['univ-rennes.fr']

// « Mes notes »: the relevé (its cards read it as the page does), the
// latest grades, newest first, and the UEs' colours.
export function buildGradesPreview() {
  const payload = buildDemoGradesPayload()
  const releve = payload['relevé']
  const report = buildGradesReport(releve, { config: payload.config })
  return {
    releve,
    config: payload.config,
    report,
    latest: report.latest.slice(0, LATEST_GRADES),
  }
}

// « Écrire au sujet de cette note » on the latest grade: the composer's
// recipient (the subject's teacher, from the relevé's absences), subject,
// the line about it and the summary box's rows.
export function buildGradeMailPreview(grades = buildGradesPreview()) {
  const latest = grades.latest[0]
  const found = latest ? findEvaluation(grades.report, latest.moduleCode, latest.id) : null
  if (!found) return null
  const { module, evaluation } = found
  return {
    to: findModuleTeacher(buildDemoGradesPayload().absences, module),
    subject: buildGradeMailSubject(module, evaluation),
    about: describeGradeMailAbout(module, evaluation),
    rows: buildGradeSummaryRows(module, evaluation, { showPromoStats: Boolean(grades.report.showPromoStats) }),
  }
}

// The Planning as its list shows it: the first days from today with
// classes still to come (PLANNING_DAYS, PLANNING_CLASSES classes in all at
// most), each class with its colour (handed out in the order the courses
// come, as the page does) and whether it's on now; `count`, all of the
// day's.
export function buildPlanningPreview(now = new Date()) {
  const todayKey = toDayKey(now)
  const events = buildDemoUpcomingPayload({ date: todayKey, lookaheadDays: 14 }).events
    .map(toPlanningEvent)
    .filter(Boolean)
    .sort((left, right) => left.start - right.start)
  let assigned = {}
  const accents = new Map()
  for (const event of events) {
    const result = assignAccent(assigned, event.title)
    assigned = result.assigned
    accents.set(event.id, result.index)
  }
  const upcoming = events.filter((event) => event.end > now.getTime())
  const dayKeys = [...new Set(upcoming.map((event) => event.day))].slice(0, PLANNING_DAYS)
  const shown = new Set(upcoming.filter((event) => dayKeys.includes(event.day)).slice(0, PLANNING_CLASSES))
  return {
    todayKey,
    days: dayKeys.map((day) => ({
      day,
      count: upcoming.filter((event) => event.day === day).length,
      classes: upcoming
        .filter((event) => event.day === day && shown.has(event))
        .map((event) => ({ event, accent: accents.get(event.id) ?? 0, ongoing: isOngoing(event, now.getTime()) })),
    })).filter((entry) => entry.classes.length > 0),
  }
}

// The domain the list shows by a sender's name (src/mailDomain.js): only
// for one outside the university's (the demo's own) domains.
function describeDomainCue(address) {
  const domain = getMailAddressDomain(address?.email)
  return domain && address?.name && !isOwnMailDomain(domain, DEMO_OWN_MAIL_DOMAINS) ? `@${domain}` : null
}

// The Messagerie: the inbox's first mails, the first one from outside the
// university among them (its domain by its name), and the mail about the
// latest grade.
export function buildMailPreview(now = new Date()) {
  const mail = buildDemoMailPayload({ now: now.getTime(), webmailHref: null })
  const messages = mail.messages.map((message) => ({ ...message, domainCue: describeDomainCue(message.from) }))
  const outsider = messages.find((message) => message.domainCue)
  const shown = messages.slice(0, MAIL_ROWS - (outsider ? 1 : 0))
  return {
    unreadCount: mail.unreadCount,
    messages: outsider && !shown.includes(outsider) ? [...shown, outsider] : messages.slice(0, MAIL_ROWS),
    composer: buildGradeMailPreview(),
  }
}
