import { r } from './register.js'

// « Nouveautés »: what changed in the app, written for students.
//
// Adding an entry is one object, at the TOP of CHANGELOG (newest first):
//
//   {
//     id: 'mon-entree',          // unique and never changed: devices remember the ids they've seen
//     date: '2026-10-12',        // YYYY-MM-DD, the day it ships
//     title: 'Un titre court',
//     body: 'Une ou deux phrases concrètes, sans jargon.',
//     // A title or body that addresses the student is a getter, with both
//     // forms (src/register.js): get body() { return r('Tes notes…', 'Vos notes…') }
//     icon: 'ph:calendar-blank',   // optional, any Iconify name (carbon: or ph: like the rest)
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
    id: 'salles-et-personnels',
    date: '2026-11-09',
    title: 'Salles et personnels',
    get body() {
      return r(
        'Le planning d’une salle, d’un enseignant ou de n’importe quel groupe\u202f: ouvre «\u202fSalles et personnels\u202f» en haut du Planning. «\u202f×\u202f» sur son nom ramène au tien.',
        'Le planning d’une salle, d’un enseignant ou de n’importe quel groupe\u202f: ouvrez «\u202fSalles et personnels\u202f» en haut du Planning. «\u202f×\u202f» sur son nom ramène au vôtre.',
      )
    },
    icon: 'ph:user-list',
    // The ADE portal's tree (/ade/directory): Rennes only for now.
    universities: ['univ-rennes'],
    audience: ['planning-page'],
  },
  {
    id: 'assiduite',
    date: '2026-11-03',
    title: 'Assiduité',
    get body() {
      return r(
        'Tes absences et retards du semestre, justifiés ou non, par matière et au fil du semestre. « Justifier » prépare le mail au secrétariat, justificatif en photo ou en PDF compris. Une carte sur l’accueil, et sur téléphone l’onglet s’ajoute dans Réglages › Apparence.',
        'Vos absences et retards du semestre, justifiés ou non, par matière et au fil du semestre. « Justifier » prépare le mail au secrétariat, justificatif en photo ou en PDF compris. Une carte sur l’accueil, et sur téléphone l’onglet s’ajoute dans Réglages › Apparence.',
      )
    },
    icon: 'ph:user-check',
    // The page comes with « Mes notes » (the relevé's absences).
    audience: ['grades-page'],
  },
  {
    id: 'bonjour-bonsoir',
    date: '2026-11-03',
    title: 'Bonjour ou bonsoir',
    get body() {
      return r(
        'L’accueil te salue selon l’heure : « Bonsoir » à partir de 18 h.',
        'L’accueil vous salue selon l’heure : « Bonsoir » à partir de 18 h.',
      )
    },
    icon: 'ph:moon-stars',
  },
  {
    id: 'nouvel-accueil',
    date: '2026-11-02',
    title: 'Un nouvel accueil',
    get body() {
      return r(
        'Ta journée résumée en une phrase, et l’essentiel sur une seule page. Tes applications favorites sont juste en dessous, toutes les autres dans «\u202fToutes les applications\u202f». Choisis tes cartes dans Réglages\u202f›\u202fAccueil.',
        'Votre journée résumée en une phrase, et l’essentiel sur une seule page. Vos applications favorites sont juste en dessous, toutes les autres dans «\u202fToutes les applications\u202f». Choisissez vos cartes dans Réglages\u202f›\u202fAccueil.',
      )
    },
    icon: 'ph:house',
  },
  {
    id: 'photo-de-profil',
    date: '2026-11-02',
    get title() { return r('Ta photo de profil', 'Votre photo de profil') },
    get body() {
      return r(
        'Dans Réglages\u202f›\u202fCompte, touche l’appareil photo sur ta photo pour en choisir une autre. Elle reste sur cet appareil.',
        'Dans Réglages\u202f›\u202fCompte, touchez l’appareil photo sur votre photo pour en choisir une autre. Elle reste sur cet appareil.',
      )
    },
    icon: 'ph:user-circle',
  },
  {
    id: 'messagerie',
    date: '2026-10-28',
    get title() { return r('Ta messagerie dans l’appli', 'Votre messagerie dans l’appli') },
    get body() {
      return r(
        'Lis tes mails en conversations, cherche et passe d’un dossier à l’autre. Écris avec de la mise en forme, des pièces jointes, des brouillons et ta signature, réponds ou transfère, imprime ou enregistre en PDF. Les mails récents de l’accueil et les tuiles du webmail l’ouvrent directement.',
        'Lisez vos mails en conversations, cherchez et passez d’un dossier à l’autre. Écrivez avec de la mise en forme, des pièces jointes, des brouillons et votre signature, répondez ou transférez, imprimez ou enregistrez en PDF. Les mails récents de l’accueil et les tuiles du webmail l’ouvrent directement.',
      )
    },
    icon: 'ph:envelope-simple',
    features: ['mail'],
    audience: ['mail-page'],
    spotlight: true,
  },
  {
    id: 'planning',
    date: '2026-10-19',
    get title() { return r('Ton emploi du temps dans l’appli', 'Votre emploi du temps dans l’appli') },
    get body() {
      return r(
        'Tes cours par jour, par semaine ou en liste, sur la page Planning. Touche un cours pour voir sa fiche et ses prochaines séances, et exporte ton planning en .ics vers ton agenda.',
        'Vos cours par jour, par semaine ou en liste, sur la page Planning. Touchez un cours pour voir sa fiche et ses prochaines séances, et exportez votre planning en .ics vers votre agenda.',
      )
    },
    icon: 'ph:calendar-blank',
    features: ['planning'],
    audience: ['planning-page'],
    spotlight: true,
  },
  {
    id: 'simulateur-fluide',
    date: '2026-10-19',
    title: 'Un simulateur plus fluide sur iPhone',
    get body() {
      return r(
        'Dans Mes notes, la roue de «\u202fSimuler\u202f» suit ton doigt sans à-coups sur iPhone, iPad et Safari.',
        'Dans Mes notes, la roue de «\u202fSimuler\u202f» suit votre doigt sans à-coups sur iPhone, iPad et Safari.',
      )
    },
    icon: 'ph:gauge',
    universities: ['univ-rennes'],
    features: ['grades'],
    audience: ['grades-page'],
  },
  {
    id: 'mes-notes',
    date: '2026-10-16',
    get title() { return r('Tes notes, enfin dans l’appli', 'Vos notes, enfin dans l’appli') },
    get body() {
      return r(
        'Moyenne, UE validées, crédits ECTS\u202f: ton relevé ScoDoc tient sur une page, semestre par semestre. Touche une note pour voir combien elle pèse dans chaque UE. Et avec «\u202fSimuler\u202f», teste tes prochaines notes sans rien toucher aux vraies.',
        'Moyenne, UE validées, crédits ECTS\u202f: votre relevé ScoDoc tient sur une page, semestre par semestre. Touchez une note pour voir combien elle pèse dans chaque UE. Et avec «\u202fSimuler\u202f», testez vos prochaines notes sans rien toucher aux vraies.',
      )
    },
    icon: 'ph:chart-pie-slice',
    universities: ['univ-rennes'],
    features: ['grades'],
    audience: ['grades-page'],
    spotlight: true,
  },
  {
    id: 'resume-du-jour',
    date: '2026-10-12',
    get title() { return r('Le résumé de ta journée', 'Le résumé de votre journée') },
    get body() {
      return r(
        'Sous ton prénom, une petite phrase te dit combien de cours t’attendent et à quelle heure tu finis. Le soir, elle passe au lendemain.',
        'Sous votre prénom, une petite phrase vous dit combien de cours vous attendent et à quelle heure vous finissez. Le soir, elle passe au lendemain.',
      )
    },
    icon: 'ph:sun-horizon',
    features: ['ade'],
  },
  {
    id: 'certificat-de-scolarite',
    date: '2026-10-12',
    get title() { return r('Ton certificat de scolarité en un clic', 'Votre certificat de scolarité en un clic') },
    get body() {
      return r(
        'Télécharge-le en PDF depuis Réglages\u202f›\u202fCompte, sans aller le chercher ailleurs.',
        'Téléchargez-le en PDF depuis Réglages\u202f›\u202fCompte, sans aller le chercher ailleurs.',
      )
    },
    icon: 'ph:file-pdf',
    features: ['schoolCertificate'],
  },
  {
    id: 'accueil-compact-telephone',
    date: '2026-10-12',
    title: 'Un accueil plus compact sur téléphone',
    get body() {
      return r(
        'Les cartes prennent moins de place, et tu passes des mails aux échéances d’un glissement de doigt. Celle où il y a le plus à voir s’affiche en premier.',
        'Les cartes prennent moins de place, et vous passez des mails aux échéances d’un glissement de doigt. Celle où il y a le plus à voir s’affiche en premier.',
      )
    },
    icon: 'ph:device-mobile',
    features: ['mail', 'moodleDeadlines'],
  },
  {
    id: 'navigation',
    date: '2026-10-12',
    title: 'Une barre d’onglets sur téléphone',
    get body() {
      return r(
        'En bas de l’écran, l’accueil et tes raccourcis restent à portée de pouce. Sur ordi, tire le bord de la barre latérale pour l’élargir ou la réduire.',
        'En bas de l’écran, l’accueil et vos raccourcis restent à portée de pouce. Sur ordi, tirez le bord de la barre latérale pour l’élargir ou la réduire.',
      )
    },
    icon: 'ph:squares-four',
    features: ['planning'],
  },
  {
    id: 'raccourcis-messagerie-moodle',
    date: '2026-10-12',
    title: 'Messagerie et Moodle en un geste',
    get body() {
      return r(
        'Les deux ont leur raccourci dans la barre latérale, et en bas de l’écran sur téléphone. Un appui et tu y es, sans te reconnecter.',
        'Les deux ont leur raccourci dans la barre latérale, et en bas de l’écran sur téléphone. Un appui et vous y êtes, sans vous reconnecter.',
      )
    },
    icon: 'ph:envelope-simple',
    features: ['mail', 'moodle'],
  },
  {
    id: 'apparence',
    date: '2026-10-12',
    title: 'Thème sombre et photo de fond',
    get body() {
      return r(
        'Dans Réglages\u202f›\u202fApparence, choisis entre clair, sombre ou automatique (comme ton téléphone). Tu peux aussi masquer la photo\u202f: les cartes deviennent pleines et bien nettes.',
        'Dans Réglages\u202f›\u202fApparence, choisissez entre clair, sombre ou automatique (comme votre téléphone). Vous pouvez aussi masquer la photo\u202f: les cartes deviennent pleines et bien nettes.',
      )
    },
    icon: 'ph:moon',
  },
  {
    id: 'reglages-en-sections',
    date: '2026-10-12',
    title: 'Des Réglages mieux rangés',
    get body() {
      return r(
        'Compte, Planning, Apparence… Chaque chose a sa section. Et ce qui touche à ta vie privée est expliqué directement dedans.',
        'Compte, Planning, Apparence… Chaque chose a sa section. Et ce qui touche à votre vie privée est expliqué directement dedans.',
      )
    },
    icon: 'ph:gear-six',
  },
  {
    id: 'applications',
    date: '2026-10-12',
    title: 'Des applications plus faciles à trouver',
    get body() {
      return r(
        'Chaque application a sa vraie icône, logo Moodle compris. La recherche ignore les accents et connaît les synonymes («\u202fmail\u202f» trouve la messagerie), et tes favoris s’ajoutent instantanément.',
        'Chaque application a sa vraie icône, logo Moodle compris. La recherche ignore les accents et connaît les synonymes («\u202fmail\u202f» trouve la messagerie), et vos favoris s’ajoutent instantanément.',
      )
    },
    icon: 'ph:squares-four',
  },
]
