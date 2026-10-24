const GRADE_COLORS_KEY = 'l-ent:grade-colors'
export const DEFAULT_ACCENT_COLOR = '#0073d1'

// One stable random hue per resource code, remembered per browser so the
// accent bar keeps the same colour between visits — and between the
// dashboard's "Dernière note" and the "Dernières notes" of Mes notes.
export function getGradeColor(resource) {
  try {
    const stored = JSON.parse(localStorage.getItem(GRADE_COLORS_KEY) || '{}')
    if (stored[resource]) return stored[resource]
    const hue = Math.floor(Math.random() * 360)
    const color = `hsl(${hue}, 60%, 42%)`
    stored[resource] = color
    localStorage.setItem(GRADE_COLORS_KEY, JSON.stringify(stored))
    return color
  } catch {
    return DEFAULT_ACCENT_COLOR
  }
}
