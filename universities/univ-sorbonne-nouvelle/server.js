// Université Sorbonne Nouvelle — server-side configuration.
import { appIcons, id, casOrigin, entOrigin, features, gradesCopy, moodleOrigin, planningOrigin, planningServiceUrl, portalEntryPath, schoolCertificateOrigin } from './shared.js'

export default {
  id,
  features,

  origins: {
    ent: entOrigin,
    cas: casOrigin,
    // No ADE mobile API ("Campus" app): the timetable comes from the
    // Planning's GWT client (planningRpc.js).
    ade: null,
    moodle: moodleOrigin,
    planning: planningOrigin,
  },

  planning: {
    serviceUrl: planningServiceUrl,
    // Values of myplanning.jsp's own RPC requests (ADE 6.12): its client id,
    // project and « Planning_ENT » display configuration.
    gwtClientId: 'aHcZolc',
    projectId: 5,
    displayConfigurationName: 'Planning_ENT',
    // The student's own groups, found at login from their enrolment codes,
    // are their timetable: no group to pick (planningRpc.js).
    personal: true,
  },

  auth: {
    // iSorbonne: session read on the entry page, no layout or userinfo API
    // (server/portalSession.js).
    portal: 'isorbonne',
    portalEntryPath,
    // The CAS lives under /cas: its login (for the Planning's own sign-in)
    // and its logout.
    casBasePath: '/cas',
    casLogoutPath: '/cas/logout',
  },

  // Applications grid: the tiles of the entry page itself.
  catalog: {
    path: portalEntryPath,
  },

  // Launch relay: the university's services sign in with the CAS session
  // (univ-paris3.fr: its former name, still on some hosts).
  launch: {
    allowedDomains: ['sorbonne-nouvelle.fr', 'univ-paris3.fr'],
  },

  // Moodle (features.moodle, moodleDeadlines): iCampus's CAS login goes
  // straight to the CAS and back with a ticket, no Shibboleth.
  moodle: {
    casLoginPath: '/login/index.php?authCAS=CAS',
  },

  // Certificat de scolarité (features.schoolCertificate): the PDF behind
  // MonDossierWeb's « Inscriptions » menu (server/schoolCertificate.js).
  schoolCertificate: {
    origin: schoolCertificateOrigin,
  },

  grades: gradesCopy,

  appIcons,
}
