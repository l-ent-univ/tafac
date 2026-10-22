// Times as the « Bus » views and reminders say them (no config import, so
// node tests can load it).

// "7h32"
export function formatClock(ms) {
  const date = new Date(ms)
  return `${date.getHours()}h${String(date.getMinutes()).padStart(2, '0')}`
}

// "dans 4 min", "maintenant", "à 7h32" past the hour.
export function formatCountdown(ms, now = Date.now()) {
  const minutes = Math.round((ms - now) / 60_000)
  if (minutes <= 0) return 'maintenant'
  if (minutes < 60) return `dans ${minutes} min`
  return `à ${formatClock(ms)}`
}
