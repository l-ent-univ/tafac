// Université Rennes 2 — values shared by the client and server configs.
// Pure data only: this file is imported by Node at runtime, so it must not
// import assets (images, CSS) or browser-only modules.
// Not to be confused with univ-rennes/ (Université de Rennes). Portal and
// login research: docs/univ-rennes-2/.

import { TAFAC_CONTACT_EMAIL, TAFAC_TEAM } from '../tafac.js'

export const id = 'univ-rennes-2'

export const university = {
  name: 'Université Rennes 2',
  shortName: 'Rennes 2',
  // /rennes2: this university's landing page (its button to its login).
  slug: 'rennes2',
  // Listed on dev servers only until a real sign-in has been checked.
  devOnly: true,
  // The 2016 logo is a square badge (the striped "2" over its name), shown
  // taller than a wordmark (login, landing, sidebar).
  logoShape: 'square',
}

export const branding = {
  appName: 'Tafac',
  defaultTitle: "Tafac | Cours, notes et services de ton université",
  seoTitle: "Tafac | Client alternatif ENT Université Rennes 2",
  seoDescription: "Client alternatif non officiel aux services numériques de l'Université Rennes 2. Projet étudiant libre, non affilié à l'université.",
  pwaDescription: "Tes services de l'Université Rennes 2 sur une seule page. Projet étudiant non affilié à l'université.",
  nameInText: 'l’Université Rennes 2',
  logoAlt: 'Université Rennes 2',
  sidebarLogoAlt: "Tafac - Université Rennes 2",
  loginFooterLine: "Projet étudiant non officiel, non affilié à l'Université Rennes 2",
  loginPasswordNote: "Ton mot de passe sert uniquement à te connecter au site de l'université et n'est jamais enregistré",
  about: {
    intro: "est un client alternatif aux services numériques de l'Université Rennes 2.",
    disclaimer:
      "Tafac est un projet étudiant indépendant, non officiel et non affilié à l'Université Rennes 2. Tes identifiants servent uniquement à te connecter et ne sont jamais stockés.",
    repoUrl: 'https://github.com/l-ent-univ/tafac',
    // « Équipe » in À propos: the same Tafac team for every university.
    team: TAFAC_TEAM,
    // À propos › Aide: the button to write to the team.
    contactEmail: TAFAC_CONTACT_EMAIL,
  },
  // Part of Papillon, as every Tafac instance (see univ-rennes/shared.js).
  papillon: { url: 'https://papillon.bzh' },
}

// The student portal is a Drupal site (not uPortal): auth.portal = 'drupal'
// in server.js, and "/" redirects to the Apereo CAS until signed in.
export const entOrigin = 'https://etudiants.univ-rennes2.fr'
export const casOrigin = 'https://cas.univ-rennes2.fr'
export const portalEntryPath = '/'

// Planning from TEMPO (planning.api 'tempo'), mail from Partage, Moodle
// from Cursus; the other services come later (docs/univ-rennes-2/ent.md).
export const features = {
  ade: true,
  planning: true,
  moodle: true,
  grades: false,
  mail: true,
  moodleDeadlines: true,
  // « Certificat de scolarité » in Réglages › Compte, from Mon Dossier Web.
  schoolCertificate: true,
  weather: { enabled: true, defaultCity: 'Rennes' },
  // Demo account (demo@tafac.fr / tafac-demo): sample data, no university call.
  demo: true,
}

// TEMPO, the student's own timetable: its tile opens the Planning page.
export const planningServiceUrl = 'https://tempo.univ-rennes2.fr/'

// Webmail ("Messagerie"): RENATER Partage (Zimbra), behind Shibboleth
// (shibboleth.uhb.fr) → CAS. Opened through /__ent_auth/mail/open.
export const mailWebmailUrl = 'https://webmail.univ-rennes2.fr/'

// Moodle « Cursus », signed in through its CAS login (moodle.casLoginPath).
export const moodleOrigin = 'https://cursus.univ-rennes2.fr'

export const gradesCopy = {}

// Look of the automatic icons (server/appIcons.js), see univ-exemple/shared.js.
export const appIcons = {
  style: 'phosphor-duotone',
  colorMode: 'soft',
}
