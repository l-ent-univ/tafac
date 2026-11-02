import universityConfig from '@university'

// Dashboard widgets the user can show or hide from Réglages › Tableau de
// bord, as the « Accueil » page lays them out. `isAvailable` mirrors the
// university / establishment gating, so the settings only list widgets this
// student can actually get. `grades`: needs « Mes notes » too (App checks
// it). `home: false`: not a card of « Accueil » (the old dashboard's
// greeting card, hidden from its own « × »), left out of the settings.
const getEstablishmentConfig = (establishment) => universityConfig.establishments?.byId?.[establishment] ?? null

const hasGradeWidgets = (establishment) => Boolean(universityConfig.features?.grades)
  && Boolean(getEstablishmentConfig(establishment)?.gradeWidgets)

export const DASHBOARD_WIDGETS = [
  {
    id: 'greeting',
    label: 'Carte de bienvenue',
    icon: 'ph:hand-waving',
    home: false,
    isAvailable: () => true,
  },
  {
    id: 'nextClass',
    label: 'Prochains cours',
    icon: 'ph:calendar-blank',
    isAvailable: (establishment) => Boolean(getEstablishmentConfig(establishment)?.nextClassWidget),
  },
  {
    id: 'average',
    label: 'Moyenne générale',
    icon: 'ph:chart-line-up',
    grades: true,
    isAvailable: hasGradeWidgets,
  },
  {
    id: 'mail',
    label: 'Mails récents',
    icon: 'ph:envelope-simple',
    isAvailable: () => Boolean(universityConfig.features?.mail),
  },
  {
    // « Dernière note » on the old dashboard.
    id: 'latestGrade',
    label: 'Dernières notes',
    icon: 'ph:chart-pie-slice',
    grades: true,
    isAvailable: hasGradeWidgets,
  },
  {
    id: 'deadlines',
    label: 'Échéances',
    icon: 'ph:check-square',
    isAvailable: () => Boolean(universityConfig.features?.moodleDeadlines),
  },
]

export function isWidgetAvailable(widgetId, establishment) {
  return Boolean(DASHBOARD_WIDGETS.find((widget) => widget.id === widgetId)?.isAvailable(establishment))
}

export function getAvailableWidgets(establishment) {
  return DASHBOARD_WIDGETS.filter((widget) => widget.isAvailable(establishment))
}

// The cards of « Accueil » this student can get, for the settings.
export function getHomeWidgets(establishment, { gradesAvailable = true } = {}) {
  return getAvailableWidgets(establishment)
    .filter((widget) => widget.home !== false && (gradesAvailable || !widget.grades))
}
