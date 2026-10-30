// « Nouveautés »: what changed in the app, written for students.
//
// Adding an entry is one object, at the TOP of CHANGELOG (newest first):
//
//   {
//     id: 'mon-entree',          // unique and never changed: devices remember the ids they've seen
//     date: '2026-10-12',        // YYYY-MM-DD, the day it ships
//     title: 'Un titre court',
//     body: 'Une ou deux phrases concrètes, en tutoyant, sans jargon.',
//     icon: 'carbon:calendar',   // optional, any Iconify name (carbon: or ph: like the rest)
//     universities: ['univ-rennes'],  // optional: only these universityConfig.id
//     features: ['mail', 'moodle'],   // optional: only where all these universityConfig.features are on
//     audience: ['grades-page'],      // optional: only students who have all of these (see below)
//     spotlight: true,                // optional: announced by its own dashboard card, not the pill (see below)
//   },
//
// An entry with neither `universities` nor `features` is shown everywhere.
// With both, it has to pass both. A feature counts as on when it's `true` (or
// an object without `enabled: false`, like `weather`), so `grades: 'disabled'`
// counts as off. `audience` narrows it to students, for what only some of a
// university's students get; App.jsx says what this student has
// (setChangelogAudience): 'grades-page' for a BUT student of a school with
// « Mes notes », 'planning-page' for a signed-in student of a school with
// the Planning page (features.planning, as its nav item), 'mail-page' for a
// signed-in student of a school with the in-app mail page. Where an entry doesn't apply, it's invisible: no pill, not in
// the list. Copy rules: ’ apostrophes, a narrow no-break space (`\u202f`)
// before : ! ? » and after «, and no app name (each university brands its own).
//
// Students see a small « Nouveautés » pill on the dashboard until they open
// the list. A device's first visit marks everything already here as seen, so
// only entries added afterwards light the pill up (src/changelogState.js).
// Same-day entries keep the order they have here.
//
// A `spotlight` entry is a launch: instead of lighting the pill, it gets its
// own card on the dashboard (LaunchCard: GradesLaunchCard for « Mes notes »,
// PlanningLaunchCard for the Planning, MailLaunchCard for the Messagerie) and a « Nouveau » mark on its tab
// (navItems' `announcedBy`), until the card is closed or the page visited.
// One card at a time, the newest first: the next one waits for the next
// visit (getLaunchId). It still shows in the list, as new if the list opens
// first.

export const CHANGELOG = [
  {
    id: 'messagerie',
    date: '2026-10-28',
    title: 'Ta messagerie dans l’appli',
    body: 'Lis tes mails en conversations, cherche et passe d’un dossier à l’autre. Écris avec de la mise en forme, des pièces jointes, des brouillons et ta signature, réponds ou transfère, imprime ou enregistre en PDF. Les mails récents de l’accueil et les tuiles du webmail l’ouvrent directement.',
    icon: 'carbon:email',
    features: ['mail'],
    audience: ['mail-page'],
    spotlight: true,
  },
  {
    id: 'planning',
    date: '2026-10-19',
    title: 'Ton emploi du temps dans l’appli',
    body: 'Tes cours par jour, par semaine ou en liste, sur la page Planning. Touche un cours pour voir sa fiche et ses prochaines séances, et exporte ton planning en .ics vers ton agenda.',
    icon: 'carbon:calendar',
    features: ['planning'],
    audience: ['planning-page'],
    spotlight: true,
  },
  {
    id: 'simulateur-fluide',
    date: '2026-10-19',
    title: 'Un simulateur plus fluide sur iPhone',
    body: 'Dans Mes notes, la roue de «\u202fSimuler\u202f» suit ton doigt sans à-coups sur iPhone, iPad et Safari.',
    icon: 'ph:gauge',
    universities: ['univ-rennes'],
    features: ['grades'],
    audience: ['grades-page'],
  },
  {
    id: 'mes-notes',
    date: '2026-10-16',
    title: 'Tes notes, enfin dans l’appli',
    body: 'Moyenne, UE validées, crédits ECTS\u202f: ton relevé ScoDoc tient sur une page, semestre par semestre. Touche une note pour voir combien elle pèse dans chaque UE. Et avec «\u202fSimuler\u202f», teste tes prochaines notes sans rien toucher aux vraies.',
    icon: 'carbon:chart-pie',
    universities: ['univ-rennes'],
    features: ['grades'],
    audience: ['grades-page'],
    spotlight: true,
  },
  {
    id: 'resume-du-jour',
    date: '2026-10-12',
    title: 'Le résumé de ta journée',
    body: 'Sous ton prénom, une petite phrase te dit combien de cours t’attendent et à quelle heure tu finis. Le soir, elle passe au lendemain.',
    icon: 'ph:sun-horizon',
    features: ['ade'],
  },
  {
    id: 'certificat-de-scolarite',
    date: '2026-10-12',
    title: 'Ton certificat de scolarité en un clic',
    body: 'Télécharge-le en PDF depuis Réglages\u202f›\u202fCompte, sans aller le chercher ailleurs.',
    icon: 'carbon:document-pdf',
    features: ['schoolCertificate'],
  },
  {
    id: 'accueil-compact-telephone',
    date: '2026-10-12',
    title: 'Un accueil plus compact sur téléphone',
    body: 'Les cartes prennent moins de place, et tu passes des mails aux échéances d’un glissement de doigt. Celle où il y a le plus à voir s’affiche en premier.',
    icon: 'carbon:mobile',
    features: ['mail', 'moodleDeadlines'],
  },
  {
    id: 'navigation',
    date: '2026-10-12',
    title: 'Une barre d’onglets sur téléphone',
    body: 'En bas de l’écran, l’accueil et tes raccourcis restent à portée de pouce. Sur ordi, tire le bord de la barre latérale pour l’élargir ou la réduire.',
    icon: 'ph:squares-four',
    features: ['planning'],
  },
  {
    id: 'raccourcis-messagerie-moodle',
    date: '2026-10-12',
    title: 'Messagerie et Moodle en un geste',
    body: 'Les deux ont leur raccourci dans la barre latérale, et en bas de l’écran sur téléphone. Un appui et tu y es, sans te reconnecter.',
    icon: 'carbon:email',
    features: ['mail', 'moodle'],
  },
  {
    id: 'apparence',
    date: '2026-10-12',
    title: 'Thème sombre et photo de fond',
    body: 'Dans Réglages\u202f›\u202fApparence, choisis entre clair, sombre ou automatique (comme ton téléphone). Tu peux aussi masquer la photo\u202f: les cartes deviennent pleines et bien nettes.',
    icon: 'carbon:moon',
  },
  {
    id: 'reglages-en-sections',
    date: '2026-10-12',
    title: 'Des Réglages mieux rangés',
    body: 'Compte, Planning, Apparence… Chaque chose a sa section. Et ce qui touche à ta vie privée est expliqué directement dedans.',
    icon: 'carbon:settings',
  },
  {
    id: 'applications',
    date: '2026-10-12',
    title: 'Des applications plus faciles à trouver',
    body: 'Chaque application a sa vraie icône, logo Moodle compris. La recherche ignore les accents et connaît les synonymes («\u202fmail\u202f» trouve la messagerie), et tes favoris s’ajoutent instantanément.',
    icon: 'carbon:app-switcher',
  },
]
