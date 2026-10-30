// Helpers shared by the list-style dashboard cards ("Mails récents",
// "Échéances") and the mail page: date parsing, the "14h32" clock notation, the shimmer
// placeholder look and the last-known service URL kept for error states.

export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export const SHIMMER_CLASSES = 'bg-[linear-gradient(90deg,var(--color-bg-muted)_0%,var(--color-bg-subtle)_50%,var(--color-bg-muted)_100%)] bg-[length:200%_100%] animate-shimmer'

const clockFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

export function parseDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// Calendar days between two dates (0 = same day, 1 = tomorrow, -1 = yesterday).
export function calendarDayDiff(date, now = new Date()) {
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS)
}

// "15h15", matching the next-class card notation.
export function formatClockTime(date) {
  return clockFormatter.format(date).replace(':', 'h')
}

// Mail-client style timestamp, matching the "15h15" notation used by the
// next-class card: "14h32" today, "hier", "lun." this week, "12 sept." older.
export function formatReceivedAt(date, now = new Date()) {
  if (!date) return ''
  const dayDiff = -calendarDayDiff(date, now)
  if (dayDiff <= 0) return formatClockTime(date)
  if (dayDiff === 1) return 'hier'
  if (dayDiff < 7) return weekdayFormatter.format(date)
  return dayMonthFormatter.format(date)
}

export function getSenderLabel(from) {
  return from?.name?.trim() || from?.email?.trim() || 'Expéditeur inconnu'
}

export function openInNewTab(href) {
  if (href) window.open(href, '_blank', 'noopener,noreferrer')
}

export function readStoredHref(key) {
  try {
    return localStorage.getItem(key) || null
  } catch {
    return null
  }
}

export function storeHref(key, href) {
  try {
    if (href) localStorage.setItem(key, href)
  } catch {
    // Storage unavailable: the card just loses its error-state fallback.
  }
}
