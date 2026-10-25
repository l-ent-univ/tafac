// Université de Rennes — values shared by the client and server configs.
// Pure data only: this file is imported by Node at runtime, so it must not
// import assets (images, CSS) or browser-only modules.

export const id = 'univ-rennes'

export const university = {
  name: 'Université de Rennes',
  shortName: 'Rennes',
  // /rennes: this university's landing page (its button to its login).
  slug: 'rennes',
}

// Branding text (no assets here — the logo lives in client.js so this file
// stays importable by Node).
export const branding = {
  appName: 'Tafac',
  defaultTitle: "Tafac | Cours, notes et services de ton université",
  // Says what it is and that it isn't the university's (search results,
  // link previews, the installed app).
  seoTitle: "Tafac – Ton ENT de l'Université de Rennes en une app",
  seoDescription:
    "Emploi du temps ADE, notes ScoDoc, mails et rendus Moodle de l'Université de Rennes sur une seule page. Projet étudiant libre, non affilié à l'université.",
  pwaDescription:
    "Emploi du temps, notes ScoDoc, mails et rendus Moodle sur une seule page. Projet étudiant non affilié à l'Université de Rennes.",
  // Former names, for search engines (the site's name in results).
  alternateNames: ["l'ent"],
  // How the landing's copy names the university mid-sentence ({university}
  // in src/landingCopy.json; on tafac.fr/rennes).
  nameInText: 'l’Université de Rennes',
  logoAlt: 'Université de Rennes',
  sidebarLogoAlt: "Tafac - Université de Rennes",
  loginFooterLine: "Projet étudiant non officiel, non affilié à l'Université de Rennes",
  // Under the login form: what happens to the password (server/entAuthApp.js
  // keeps only the CAS session, never the password).
  loginPasswordNote: "Ton mot de passe sert uniquement à te connecter au site de l'université et n'est jamais enregistré",
  about: {
    intro: "est un client alternatif aux services numériques de l'Université de Rennes.",
    disclaimer:
      "Tafac est un projet étudiant indépendant, non officiel et non affilié à l'Université de Rennes. Tes identifiants servent uniquement à te connecter et ne sont jamais stockés.",
    repoUrl: 'https://github.com/l-ent-univ/tafac',
    // « Équipe » in À propos: a name and a GitHub login each.
    team: [
      { name: 'Tom', login: 'tom-things' },
      { name: 'Lucas Lavajo', login: 'tryon-dev' },
    ],
  },
  // Tafac is part of Papillon (same team). The one switch for every mention
  // of it (src/papillon.js): delete the block and they all go. Branding
  // rather than a `features` entry, as it hides no widget or endpoint and
  // carries the link, like `about.repoUrl`.
  papillon: { url: 'https://papillon.bzh' },
}

// Public origin of the ENT portal — used by the frontend to normalize URLs
// before sending them through the local proxy, and by the server as the
// proxy target.
export const entOrigin = 'https://services-numeriques.univ-rennes.fr'

// CAS SSO origin. Public: browsers are redirected there during login; the
// frontend uses it to recognize CAS hops in launch chains.
export const casOrigin = 'https://sso-cas.univ-rennes.fr'

// uPortal landing page: login entry point, default Referer for proxied
// requests, and the URL whose response proves a CAS login landed back
// authenticated.
export const portalEntryPath = '/f/services/normal/render.uP'

// Feature switchboard. A missing/false feature hides its widgets, nav items
// and server endpoints.
export const features = {
  ade: true,
  planning: true,
  moodle: true,
  grades: true,
  mail: true,
  moodleDeadlines: true,
  // « Certificat de scolarité » in Réglages › Compte, from MonDossierWeb.
  schoolCertificate: true,
  // « Dernière note » at the bottom of the sidebar, opening « Mes notes » on
  // that grade (needs `grades`). Off: the dashboard's card already shows it.
  sidebarLatestGrade: false,
  weather: { enabled: true, defaultCity: 'Rennes' },
  serviceCategories: false,
  demo: true,
}

// Public launch URL of the planning service (opened through /__ent_auth/launch).
export const planningServiceUrl = 'https://planning.univ-rennes.fr/portal/planning/calendar'

export const gradesOrigin = 'https://notes9.iutlan.univ-rennes1.fr'
export const gradesServiceUrl = `${gradesOrigin}/services/doAuth.php?href=${encodeURIComponent(`${gradesOrigin}/`)}`

// Moodle (FOAD). Public: the sidebar and tab bar link to it, the server signs
// in there for the "Échéances Moodle" widget.
export const moodleOrigin = 'https://foad.univ-rennes.fr'

// Webmail ("Messagerie"): RENATER Partage (Zimbra), behind Shibboleth → CAS.
// Opened through /__ent_auth/launch by the "Mails récents" widget.
export const mailWebmailUrl = 'https://partage.univ-rennes.fr/'

// Fallback copy shown when the upstream grade service is unavailable.
export const gradesCopy = {
  unavailableTitle: 'Notes indisponibles',
  unavailableDetail: 'ScoDoc ne répond pas pour le moment',
  disabledPillLabel: 'Notes indisponibles',
}

// Look of the automatic icons (server/appIcons.js): the application tiles,
// and the subjects of "Mes notes" (src/subjectIcons.js), which is why it
// lives here, read by both configs.
//   style: 'carbon' | 'phosphor' | 'phosphor-fill' | 'phosphor-duotone' | 'tabler'
//   colorMode: 'pastel' | 'soft' | 'vivid' | 'mono'
//   icons: { mail: 'mdi:email-outline' }   // replaces single concepts (tiles only)
export const appIcons = {
  style: 'phosphor-duotone',
  colorMode: 'soft',
}
