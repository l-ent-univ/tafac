// Université Rennes 2 — server-side configuration.
import { appIcons, id, casOrigin, entOrigin, features, gradesCopy, mailWebmailUrl, moodleOrigin, planningServiceUrl, portalEntryPath } from './shared.js'

export default {
  id,
  features,

  origins: {
    ent: entOrigin,
    cas: casOrigin,
    // No ADE mobile API: the planning is TEMPO's.
    ade: null,
    moodle: moodleOrigin,
    // TEMPO (tempoApi.js).
    planning: 'https://tempo.univ-rennes2.fr',
  },

  // The student's own timetable, from TEMPO's /api/events (tempoApi.js).
  planning: {
    api: 'tempo',
    serviceUrl: planningServiceUrl,
    timeZone: 'Europe/Paris',
  },

  auth: {
    // Drupal portal: the session is checked on the entry page, there is no
    // layout or userinfo API (server/portalSession.js).
    portal: 'drupal',
    portalEntryPath,
  },

  // Applications grid: the portal's "Tous les outils" page.
  catalog: {
    path: '/tous-outils',
  },

  // Launch relay (/__ent_auth/launch): the university's services sign in
  // with the CAS session. Other links open directly (server/launchTargets.js).
  launch: {
    allowedDomains: ['univ-rennes2.fr'],
  },

  // Moodle (features.moodle, moodleDeadlines): Cursus's CAS login goes
  // straight to the CAS (gateway) and back with a ticket, no Shibboleth.
  moodle: {
    casLoginPath: '/login/index.php?authCAS=CAS',
  },

  // "Mails récents" widget (features.mail): the server signs in to the
  // webmail with the CAS session and reads the inbox (Zimbra API).
  mail: {
    provider: 'zimbra',
    // Where the sign-in lands (Zimbra); webmailUrl is the public entry.
    origin: 'https://webmail.etudiant.univ-rennes2.fr',
    webmailUrl: mailWebmailUrl,
    maxMessages: 20,
    // Hosts the SAML sign-in chain may visit, besides the webmail and CAS
    // hosts (RENATER's Partage SP and the university IdP).
    signInDomains: ['partage.renater.fr', 'uhb.fr', 'univ-rennes2.fr'],
  },

  // Certificat de scolarité (features.schoolCertificate): Mon Dossier Web
  // behind the CAS, its « Inscriptions » menu lists the certificates
  // (server/schoolCertificate.js).
  schoolCertificate: {
    origin: 'https://mondossierweb.univ-rennes2.fr',
    menuCaption: 'Inscriptions',
  },

  grades: gradesCopy,

  // Look of the automatic icons: see shared.js.
  appIcons,
}
