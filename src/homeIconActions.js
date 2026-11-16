// « Accueil »'s row of icons on a phone (HomePhoneHeader): each icon is a
// way in, to the page or the drawer it stands for. An icon whose page this
// university or this student doesn't have isn't shown; nor is the menu's,
// which has no page.
//
// `open`: what App can open, a function each, null when it isn't there.
// → the icons to show, in the row's order: { id, label, onPress }.
const ICONS = [
  { id: 'apps', label: 'Toutes les applications', opener: 'allApps' },
  { id: 'calendar', label: 'Planning', opener: 'planning' },
  { id: 'grades', label: 'Mes notes', opener: 'grades' },
  { id: 'homework', label: 'Moodle', opener: 'moodle' },
  { id: 'mail', label: 'Messagerie', opener: 'mail' },
]

export function homeIconActions(open = {}) {
  return ICONS
    .filter(({ opener }) => typeof open[opener] === 'function')
    .map(({ id, label, opener }) => ({ id, label, onPress: open[opener] }))
}
