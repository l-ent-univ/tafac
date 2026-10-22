import universityConfig from '@university'

const gradesCopy = universityConfig.grades ?? {}
const gradesFeature = universityConfig.features?.grades ?? false

// features.grades is a tri-state switch:
//   true       → live ScoDoc data, widgets and "Mes notes" link are clickable
//   'disabled' → widgets stay visible with demo data behind an "unavailable" pill
//   false      → everything grade-related is hidden
export const GRADES_FEATURE_ENABLED = gradesFeature === true
export const GRADES_FEATURE_DISABLED = gradesFeature === 'disabled'

export const GRADES_UNAVAILABLE_TITLE = gradesCopy.unavailableTitle ?? 'Notes indisponibles'
export const GRADES_UNAVAILABLE_DETAIL = gradesCopy.unavailableDetail ?? ''
export const GRADES_UNAVAILABLE_MESSAGE = `${GRADES_UNAVAILABLE_TITLE}. ${GRADES_UNAVAILABLE_DETAIL}`
export const GRADES_DISABLED_PILL_LABEL = gradesCopy.disabledPillLabel ?? 'Notes indisponibles'

export const DEMO_AVERAGE_GRADE = {
  average: '13.7',
  promoAverage: '12.4',
}

export const DEMO_LATEST_GRADE = {
  description: 'Projet démo',
  note: '15.5',
  noteSur: '20',
  resource: 'SAE',
}

export const DEMO_ABSENCES = {
  unjustified: '0 h',
  justified: '4 h',
  late: '1',
  unjustifiedCount: 0,
}

function getTooltipWidth() {
  if (typeof window === 'undefined') {
    return 320
  }

  return Math.min(320, Math.max(0, window.innerWidth - 32))
}

function clampTooltipX(clientX, rect) {
  if (typeof window === 'undefined') {
    return clientX - rect.left
  }

  const tooltipWidth = getTooltipWidth()
  const minX = 16 + tooltipWidth / 2 - rect.left
  const maxX = window.innerWidth - 16 - tooltipWidth / 2 - rect.left
  const relativeX = clientX - rect.left

  return Math.min(Math.max(relativeX, minX), Math.max(minX, maxX))
}

export function positionGradeTooltipFromPointer(event) {
  const rect = event.currentTarget.getBoundingClientRect()

  event.currentTarget.style.setProperty('--grade-tooltip-x', `${clampTooltipX(event.clientX, rect)}px`)
  event.currentTarget.style.setProperty('--grade-tooltip-y', `${event.clientY - rect.top}px`)
}

export function positionGradeTooltipFromElement(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const clientX = rect.left + rect.width / 2

  event.currentTarget.style.setProperty('--grade-tooltip-x', `${clampTooltipX(clientX, rect)}px`)
  event.currentTarget.style.setProperty('--grade-tooltip-y', `${rect.height / 2}px`)
}
