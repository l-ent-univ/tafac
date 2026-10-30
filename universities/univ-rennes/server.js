// Université de Rennes — server-side configuration.
// Never imported by client code: holds origins, auth-flow parameters and the
// reverse-engineered ADE mobile-app credentials.
import { fileURLToPath } from 'node:url'
import { appIcons, id, casOrigin, entOrigin, establishmentNames, features, gradesCopy, gradesOrigin, mailWebmailUrl, moodleOrigin, planningServiceUrl, portalEntryPath, university } from './shared.js'

export default {
  id,
  // Single source of truth for feature flags, shared with the client config.
  features,

  origins: {
    ent: entOrigin,
    cas: casOrigin,
    // Set any of these to null when the university has no such service —
    // the matching feature flag must be false too.
    ade: 'https://campus-app.univ-rennes.fr',
    moodle: moodleOrigin,
    planning: 'https://planning.univ-rennes.fr',
  },

  auth: {
    portalEntryPath,
  },

  moodle: {
    shibbolethLoginPath: '/auth/shibboleth/index.php',
    // Shibboleth WAYF entity id used to pre-select the university on the
    // federation discovery page.
    wayfEntityId: 'urn:mace:cru.fr:federation:univ-rennes1.fr',
    // "Échéances Moodle" widget (features.moodleDeadlines): hosts the
    // server-side SAML sign-in chain may visit, besides Moodle and CAS
    // (the university WAYF and Shibboleth IdP). HTTPS only.
    signInDomains: ['wayf.univ-rennes.fr', 'ident-shib.univ-rennes1.fr'],
  },

  // Credentials of the official "Campus" mobile app, required by the ADE
  // mobile API. Reverse-engineered per university (see docs/ADDING_A_UNIVERSITY.md).
  ade: {
    // Establishment code sent in the ADE login body.
    etab: 'UR',
    passwordKey: 'jfkgltshGD6_"hrj',
    passwordIv: 'fgghjhgkdthykhjg',
    appHeaders: {
      Accept: 'application/json',
      'content-type': 'application/json',
      session: 'null',
      'X-lang': 'fr',
      'X-nav-lang': 'fr-FR',
      'X-App-version': '2.4.5',
      'User-Agent': 'App-Campus-Mobile-2.4.5',
      DeviceId: 'null',
      DeviceVersion: '20030107',
      DeviceOs: 'Web',
      DeviceManufacturer: 'Google Inc.',
      DeviceModel: '',
    },
  },

  planning: {
    serviceUrl: planningServiceUrl,
    api: 'portal-rest',
    gwtClientId: 'Z0pqq18',
  },

  grades: {
    ...gradesCopy,
    origin: gradesOrigin,
  },

  // "Mails récents" widget and the mail page (features.mail). The server
  // signs in to the webmail with the user's CAS session and reads the inbox
  // via the provider API. Only 'zimbra' is implemented (see
  // server/entAuthApp.js). maxMessages: the mail page's list (the widget
  // shows the first two).
  mail: {
    provider: 'zimbra',
    origin: 'https://partage.univ-rennes.fr',
    webmailUrl: mailWebmailUrl,
    maxMessages: 20,
    // Hosts the SAML sign-in chain may visit, besides the webmail and CAS
    // hosts (RENATER's Partage SP and the university IdP).
    signInDomains: ['partage.renater.fr', 'univ-rennes1.fr', 'univ-rennes.fr'],
    // The automatic signature of a sent mail (server/mailSend.js): the
    // university's name and logo, and the establishments with a line of
    // their own (by client.js's establishments.byId ids), each with its
    // logo. PNG, as mail clients show it (scripts/render-mail-logos.mjs).
    signature: {
      university: university.name,
      logo: { file: fileURLToPath(new URL('./assets/mail/logo.png', import.meta.url)), alt: university.name },
      establishments: {
        iutlan: {
          label: establishmentNames.iutlan,
          logo: { file: fileURLToPath(new URL('./assets/mail/iutlan.png', import.meta.url)), alt: establishmentNames.iutlan },
        },
      },
    },
  },

  // Certificat de scolarité (features.schoolCertificate): the ESUP
  // MonDossierWeb instance behind CAS, and the caption of its menu button
  // that lists the certificates (server/schoolCertificate.js).
  schoolCertificate: {
    origin: 'https://mdw.univ-rennes.fr',
    menuCaption: 'Inscriptions',
  },

  // Launch relay (/__ent_auth/launch): besides the hosts above, the domains
  // whose services the ENT and the extra services (client.js) link to,
  // subdomains included. Other links open directly in the browser
  // (server/launchTargets.js).
  launch: {
    allowedDomains: ['univ-rennes.fr', 'univ-rennes1.fr', 'iut-lannion.loxya.app'],
  },

  // Look of the automatic icons: see shared.js.
  appIcons,
}
