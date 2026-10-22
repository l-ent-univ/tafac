// Reading a RU's coming days (crousApi.fetchCrous): which day to show,
// what closures are announced. No imports, so the tests run them in Node.

// "2026-10-20" in local time.
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// The CROUS's opening hours, "MIDI : 11h30-13h45, du lundi au vendredi
// SOIR : 18h-20h, du lundi au jeudi", as { time: '11h30-13h45', detail:
// 'Midi du lundi au vendredi · Soir 18h-20h, du lundi au jeudi' }.
export function readOpeningHours(hours) {
  const text = String(hours ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const rawTime = /\d{1,2}h\d{0,2}\s*[-–]\s*\d{1,2}h\d{0,2}/.exec(text)?.[0] ?? null
  const time = rawTime?.replace(/\s/g, '') ?? null
  const parts = text
    .split(/\s*(?=\b(?:MIDI|SOIR|MATIN)\s*:)/i)
    .map((part) => part.replace(/^(MIDI|SOIR|MATIN)\s*:\s*/i, (_, label) => `${label.charAt(0)}${label.slice(1).toLowerCase()} `).trim())
    .filter(Boolean)
  const detail = parts
    .map((part, index) => (index === 0 && rawTime ? part.replace(rawTime, '').replace(/\s*,\s*/, ' ').replace(/\s+/g, ' ').trim() : part))
    .join(' · ')
  return { time, detail: detail || null }
}

export function hasMenu(day) {
  return Boolean(day?.meals.some((meal) => meal.sections.length))
}

// The day to show first: today's menu, else the next one with a menu
// (`isToday` false then, so the page can say so); null when the RU has
// published none (many don't put their menu online).
export function pickMenuDay(days = [], now = new Date()) {
  const today = todayKey(now)
  const withMenu = days.filter((day) => day.date >= today && hasMenu(day))
  return { day: withMenu[0] ?? null, isToday: withMenu[0]?.date === today }
}

// The closures announced for the coming days, in plain words: the CROUS's
// "Structure fermée du Lundi 26 Octobre 2026 au Vendredi 30 Octobre 2026"
// becomes "Fermé du lundi 26 octobre au vendredi 30 octobre".
export function describeClosures(days = [], now = new Date()) {
  const today = todayKey(now)
  const year = String(now.getFullYear())
  const notices = new Set()
  for (const day of days) {
    if (day.date < today || hasMenu(day)) continue
    for (const meal of day.meals) {
      if (meal.notice) notices.add(meal.notice)
    }
  }
  return [...notices].map((notice) => {
    const text = notice
      .replace(/^structure fermée/i, 'Fermé')
      .replace(/\b(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche|Janvier|Février|Mars|Avril|Mai|Juin|Juillet|Août|Septembre|Octobre|Novembre|Décembre)\b/g, (word) => word.toLowerCase())
      .replaceAll(` ${year}`, '')
    return text.charAt(0).toUpperCase() + text.slice(1)
  })
}
