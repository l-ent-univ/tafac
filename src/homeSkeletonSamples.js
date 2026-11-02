// What « Accueil »'s cards render while they load, laid out unseen and drawn
// as a skeleton by skullet (<Skeleton loading>): rows shaped like real ones.
// Only their lengths matter, the text never shows. Once a card has shown
// real rows, skullet keeps their shape under the card's `id` for the next
// visit (layout only, forgotten on sign-out: forgetShapes in App).

// Dev only: `?skeletons` in the address keeps the cards loading, skeletons
// up, to look at them (a fast load shows none: skullet waits 150ms first).
export const FORCE_SKELETONS = Boolean(import.meta.env?.DEV)
  && typeof location !== 'undefined'
  && new URLSearchParams(location.search).has('skeletons')

const SAMPLE_DAY = new Date(2026, 0, 5)

function at(hours, minutes = 0) {
  const date = new Date(SAMPLE_DAY)
  date.setHours(hours, minutes, 0, 0)
  return date
}

export const SAMPLE_MESSAGES = [
  { id: 'sample-1', from: { name: 'Prénom Nom', email: 'prenom.nom@example.org' }, subject: 'Objet d’un mail reçu récemment', receivedAt: at(10, 12).toISOString(), unread: true },
  { id: 'sample-2', from: { name: 'Scolarité', email: 'scolarite@example.org' }, subject: 'Un autre objet un peu plus court', receivedAt: at(9, 3).toISOString(), unread: false },
  { id: 'sample-3', from: { name: 'Prénom Nom', email: 'nom@example.org' }, subject: 'Objet d’un mail plus ancien', receivedAt: at(8, 40).toISOString(), unread: false },
]

export const SAMPLE_DEADLINES = [
  { id: 'sample-1', type: 'assign', title: 'Dossier à rendre en ligne', courseName: 'Nom du cours', dueAt: at(18).toISOString() },
  { id: 'sample-2', type: 'quiz', title: 'Questionnaire', courseName: 'Nom d’un autre cours', dueAt: at(23, 59).toISOString() },
  { id: 'sample-3', type: 'assign', title: 'Rendu de projet', courseName: 'Nom du cours', dueAt: at(12).toISOString() },
]

export const SAMPLE_CLASSES = [
  { key: 'sample-1', title: 'Intitulé du cours', location: 'Salle', teacher: 'Enseignant', start: at(8, 30), end: at(10), isNow: false },
  { key: 'sample-2', title: 'Intitulé d’un autre cours', location: 'Salle', teacher: 'Enseignant', start: at(10, 15), end: at(11, 45), isNow: false },
  { key: 'sample-3', title: 'Intitulé du cours', location: 'Salle', teacher: 'Enseignant', start: at(13, 30), end: at(16, 30), isNow: false },
]

export const SAMPLE_GRADES = [
  { id: 'sample-1', moduleCode: 'S1', moduleTitle: 'Nom de la matière', description: 'Intitulé de l’évaluation', date: at(9).toISOString(), grade: { value: 15.5 }, weights: [] },
  { id: 'sample-2', moduleCode: 'S2', moduleTitle: 'Matière', description: 'Évaluation', date: at(9).toISOString(), grade: { value: 13 }, weights: [] },
  { id: 'sample-3', moduleCode: 'S3', moduleTitle: 'Nom de la matière', description: 'Intitulé d’une évaluation', date: at(9).toISOString(), grade: { value: 16.5 }, weights: [] },
]
