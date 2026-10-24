// Minimal example university: only the ENT portal + CAS login are configured.
// Every optional feature is off. Copy this directory (or univ-rennes/ for a
// full-featured example) to add your university — see docs/ADDING_A_UNIVERSITY.md.

export const id = 'example-minimal'

export const university = {
  name: 'Mon Université',
  shortName: 'MonUniv',
  // /monuniv opens the login page of this university.
  slug: 'monuniv',
}

export const branding = {
  appName: 'Tafac',
  defaultTitle: "Tafac | Cours, notes et services de ton université",
  seoTitle: "Tafac | Client alternatif ENT Mon Université",
  seoDescription: "Client alternatif non officiel à l'ENT de Mon Université.",
  logoAlt: 'Mon Université',
  sidebarLogoAlt: "Tafac — Mon Université",
  loginFooterLine: "Projet étudiant non officiel, non affilié à Mon Université",
  about: {
    intro: 'est un client alternatif aux services numériques de Mon Université.',
    disclaimer: 'Client non officiel, indépendant et non affilié à Mon Université.',
  },
}

// REQUIRED: the uPortal-based ENT portal and its CAS SSO.
export const entOrigin = 'https://ent.example.fr'
export const casOrigin = 'https://cas.example.fr'
export const portalEntryPath = '/f/services/normal/render.uP'

// Everything off: the dashboard shows only the applications grid.
export const features = {
  ade: false,
  planning: false,
  moodle: false,
  grades: false,
  mail: false,
  moodleDeadlines: false,
  weather: { enabled: true, defaultCity: 'Paris' },
  demo: true,
}

export const planningServiceUrl = null

export const gradesCopy = {}

// Look of the automatic icons (server/appIcons.js): the application tiles,
// and the subjects of "Mes notes" (src/subjectIcons.js), which is why it
// lives here, read by both configs.
//   style: 'carbon' | 'phosphor' | 'phosphor-fill' | 'phosphor-duotone' | 'tabler'
//   colorMode: 'pastel' | 'soft' | 'vivid' | 'mono'
//   icons: { mail: 'mdi:email-outline' }   // replaces single concepts (tiles only)
export const appIcons = {
  style: 'carbon',
  colorMode: 'pastel',
}
