import universityConfig from '@university'

// Dashboard widgets the user can show or hide from "Mon compte", in display
// order. `isAvailable` mirrors the university / establishment gating, so the
// settings only list widgets this student can actually get.
const getEstablishmentConfig = (establishment) => universityConfig.establishments?.byId?.[establishment] ?? null

export const DASHBOARD_WIDGETS = [
  {
    id: 'greeting',
    label: 'Carte de bienvenue',
    icon: 'ph:hand-waving',
    isAvailable: () => true,
  },
  {
    id: 'nextClass',
    label: 'Prochain cours',
    icon: 'carbon:calendar',
    isAvailable: (establishment) => Boolean(getEstablishmentConfig(establishment)?.nextClassWidget),
  },
  {
    id: 'latestGrade',
    label: 'Dernière note',
    icon: 'carbon:chart-pie',
    isAvailable: (establishment) => Boolean(universityConfig.features?.grades)
      && Boolean(getEstablishmentConfig(establishment)?.gradeWidgets),
  },
  {
    id: 'absences',
    label: 'Absences',
    icon: 'carbon:event-schedule',
    isAvailable: (establishment) => Boolean(universityConfig.features?.grades)
      && Boolean(getEstablishmentConfig(establishment)?.gradeWidgets),
  },
  {
    id: 'mail',
    label: 'Mails récents',
    icon: 'carbon:email',
    isAvailable: () => Boolean(universityConfig.features?.mail),
  },
  {
    id: 'deadlines',
    label: 'Échéances Moodle',
    icon: 'carbon:task',
    isAvailable: () => Boolean(universityConfig.features?.moodleDeadlines),
  },
  {
    id: 'crous',
    label: 'Menu du RU',
    icon: 'carbon:restaurant',
    isAvailable: () => Boolean(universityConfig.features?.crous && universityConfig.crous?.region),
  },
  {
    id: 'transit',
    label: 'Bus',
    icon: 'carbon:bus',
    isAvailable: (establishment) => Boolean(universityConfig.features?.transit && universityConfig.transit?.campuses?.[establishment]),
  },
]

export function isWidgetAvailable(widgetId, establishment) {
  return Boolean(DASHBOARD_WIDGETS.find((widget) => widget.id === widgetId)?.isAvailable(establishment))
}

export function getAvailableWidgets(establishment) {
  return DASHBOARD_WIDGETS.filter((widget) => widget.isAvailable(establishment))
}
