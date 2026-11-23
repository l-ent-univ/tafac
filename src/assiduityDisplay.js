import { parseDay } from './assiduity'
import { ABSENCE_STATUS_LABELS } from './absenceMail'

// How an absence reads, shared by the « Assiduité » page and « Accueil »'s
// card (its marks' popover): the status pills, the days, « Justifier ».

export const DAY_SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
export const DAY_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

// How each status reads: its pill, its mark on the semester line.
export const STATUS_STYLES = {
  // Engraved tags (.status-tag): pressed into the card, not justified
  // tinted red; a lateness's edge dashed, as lighter.
  unjustified: { pill: 'status-tag status-tag--error text-error', icon: 'ph:warning-circle' },
  justified: { pill: 'status-tag status-tag--carved text-text-secondary', icon: 'ph:check-circle' },
  late: { pill: 'status-tag status-tag--carved status-tag--dashed text-text-secondary', icon: 'ph:clock' },
}

export const capitalize = (text) => (text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text)

// « ven 25 sept » (no full stop after the month).
export function formatDay(value, format = DAY_SHORT) {
  const day = parseDay(value)
  return day ? format.format(day).replace('.', '') : ''
}

// What a mark says to a screen reader: « Vendredi 25 septembre, 8h15 –
// 10h15, Relations presse, Non justifiée ».
export function describeEntry(entry) {
  return [
    capitalize(formatDay(entry.date, DAY_LONG)),
    `${entry.start} – ${entry.end}`,
    entry.subjectTitle,
    ABSENCE_STATUS_LABELS[entry.status],
  ].filter(Boolean).join(', ')
}

// Whether « Justifier » is offered: an absence not justified, a lateness.
export const canJustify = (entry) => entry.status === 'unjustified' || entry.status === 'late'
