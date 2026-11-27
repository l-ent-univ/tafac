// Université Sorbonne Nouvelle (ex-Paris 3) — values shared by the client
// and server configs. Pure data only: imported by Node at runtime, so no
// asset or browser-only import.

import { TAFAC_CONTACT_EMAIL, TAFAC_TEAM } from '../tafac.js'

export const id = 'univ-sorbonne-nouvelle'

export const university = {
  name: 'Université Sorbonne Nouvelle',
  shortName: 'Sorbonne Nouvelle',
  // /sorbonne-nouvelle: this university's landing page.
  slug: 'sorbonne-nouvelle',
  // Listed in dev only until a real sign-in is checked.
  devOnly: true,
}

export const register = 'vous'

export const branding = {
  appName: 'Tafac',
  defaultTitle: "Tafac | Cours, notes et services de votre université",
  seoTitle: "Tafac | Client alternatif ENT Université Sorbonne Nouvelle",
  seoDescription: "Client alternatif non officiel aux services numériques de l'Université Sorbonne Nouvelle. Projet étudiant libre, non affilié à l'université.",
  pwaDescription: "Vos services de l'Université Sorbonne Nouvelle dans une seule app. Projet étudiant non affilié à l'université.",
  nameInText: 'l’Université Sorbonne Nouvelle',
  logoAlt: 'Université Sorbonne Nouvelle',
  sidebarLogoAlt: "Tafac - Université Sorbonne Nouvelle",
  loginFooterLine: "Projet étudiant non officiel, non affilié à l'Université Sorbonne Nouvelle",
  loginPasswordNote: "Votre mot de passe sert uniquement à vous connecter au site de l'université et n'est jamais enregistré",
  about: {
    intro: "est un client alternatif aux services numériques de l'Université Sorbonne Nouvelle.",
    disclaimer:
      "Tafac est un projet étudiant indépendant, non officiel et non affilié à l'Université Sorbonne Nouvelle. Les identifiants servent uniquement à la connexion et ne sont jamais stockés.",
    repoUrl: 'https://github.com/l-ent-univ/tafac',
    team: TAFAC_TEAM,
    contactEmail: TAFAC_CONTACT_EMAIL,
  },
  papillon: { url: 'https://papillon.bzh' },
}

// iSorbonne, the university's own JSF portal (auth.portal 'isorbonne' in
// server.js): its entry page redirects to the Apereo CAS until signed in.
export const entOrigin = 'https://isorbonne.sorbonne-nouvelle.fr'
export const casOrigin = 'https://cas.sorbonne-nouvelle.fr'
export const portalEntryPath = '/ENT/secure/index.xhtml'

// Timetable from the ADE Planning (myplanning.jsp, GWT client, no mobile
// API); Moodle from iCampus; mail is Gmail (no provider).
export const features = {
  ade: true,
  planning: true,
  moodle: true,
  grades: false,
  mail: false,
  moodleDeadlines: true,
  // « Certificat de scolarité » in Réglages › Compte, from « Mon dossier de
  // scolarité » (ESUP MonDossierWeb, schoolCertificateOrigin).
  schoolCertificate: true,
  weather: { enabled: true, defaultCity: 'Paris' },
  demo: true,
}

// ADE Planning, behind the CAS.
export const planningOrigin = 'https://planning.sorbonne-nouvelle.fr'
export const planningServiceUrl = `${planningOrigin}/direct/myplanning.jsp`

// Moodle « iCampus » (still on the former univ-paris3.fr), signed in
// through its CAS login (moodle.casLoginPath in server.js).
export const moodleOrigin = 'https://icampus.univ-paris3.fr'

// ESUP MonDossierWeb under a path of the apps host (iSorbonne's « Mon
// dossier de scolarité » tile), behind the CAS.
export const schoolCertificateOrigin = 'https://apps.sorbonne-nouvelle.fr/esup-mdw'

export const establishmentNames = {
  sorbonneNouvelle: 'Université Sorbonne Nouvelle',
}

export const gradesCopy = {}

// Look of the automatic icons (server/appIcons.js), see univ-rennes/shared.js.
export const appIcons = {
  style: 'carbon',
  colorMode: 'pastel',
}
