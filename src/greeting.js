// « Accueil »'s greeting: « Bonjour Camille » in the day, « Bonsoir
// Camille » in the evening and at night (from 18h until 5h), « Bonjour »
// without a first name. Pure, see tests/greeting.test.js.

export const EVENING_HOUR = 18
export const MORNING_HOUR = 5

export function greetingWord(date = new Date()) {
  const hour = date.getHours()
  return hour >= EVENING_HOUR || hour < MORNING_HOUR ? 'Bonsoir' : 'Bonjour'
}

export function buildGreeting(firstName, date = new Date()) {
  const name = String(firstName ?? '').trim()
  return name ? `${greetingWord(date)} ${name}` : greetingWord(date)
}
