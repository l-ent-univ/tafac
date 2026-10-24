// Université Exemple — fake university used to test the multi-university
// setup end-to-end (subdomain routing, branding, demo account, widgets).
// Its origins don't exist: only the demo login (demo@tafac.fr / tafac-demo)
// works; real CAS logins fail cleanly.

export const id = 'univ-exemple'

export const university = {
  name: 'Université Exemple',
  shortName: 'Exemple',
}

export const branding = {
  appName: 'Tafac',
  defaultTitle: "Tafac | Cours, notes et services de ton université",
  seoTitle: "Tafac | Client alternatif ENT Université Exemple",
  seoDescription:
    "Instance de démonstration de Tafac pour l'Université Exemple : découvrez le client alternatif d'ENT avec le compte de démo.",
  pwaDescription:
    "Tafac réunit ta vie universitaire avec tes cours, notes et messagerie dans une seule application rapide et agréable à utiliser.",
  logoAlt: 'Université Exemple',
  sidebarLogoAlt: "Tafac — Université Exemple",
  loginFooterLine: "Projet non officiel, non affilié à l'Université Exemple (démo)",
  about: {
    intro: "est un client alternatif aux services numériques de l'Université Exemple. Cette instance est une démonstration : connectez-vous avec le compte démo.",
    disclaimer: "Université fictive servant à tester l'ajout d'universités. Aucun service réel n'est relayé.",
    repoUrl: 'https://github.com/l-ent-univ/tafac',
  },
  // Part of Papillon, as every Tafac instance (see univ-rennes/shared.js).
  papillon: { url: 'https://papillon.bzh' },
}

// Fake origins (.example TLD is reserved for documentation): demo sessions
// never reach them, and real logins fail with a clean CAS error.
export const entOrigin = 'https://ent.univ-exemple.example'
export const casOrigin = 'https://cas.univ-exemple.example'
export const portalEntryPath = '/f/services/normal/render.uP'

// Everything demo mode can back is enabled, so the full dashboard shows.
export const features = {
  ade: true,
  planning: true,
  moodle: false,
  grades: 'disabled',
  mail: false,
  moodleDeadlines: false,
  weather: { enabled: true, defaultCity: 'Paris' },
  demo: true,
}

export const planningServiceUrl = 'https://planning.univ-exemple.example/direct/myplanning.jsp'

export const gradesCopy = {
  unavailableTitle: 'Notes indisponibles en démo',
  unavailableDetail: 'Les notes affichées sont des données de démonstration.',
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
