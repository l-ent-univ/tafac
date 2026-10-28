// Client-safe config for Université Rennes 2.
import logo from './assets/logo.svg'
import heroVillejeanBatimentB from './assets/hero/villejean-batiment-b.webp'
import heroVillejeanBatimentsBD from './assets/hero/villejean-batiments-b-d.webp'
import heroVillejeanNuit from './assets/hero/villejean-nuit.webp'
import {
  appIcons,
  id,
  branding,
  casOrigin,
  entOrigin,
  establishmentNames,
  features,
  gradesCopy,
  mailSignatureShowsLogin,
  mailWebmailUrl,
  moodleOrigin,
  planningServiceUrl,
  portalEntryPath,
  university,
} from './shared.js'

export default {
  id,
  // Icon set of the subjects in "Mes notes", the tiles' one (shared.js).
  appIconStyle: appIcons.style,

  university,

  branding: {
    ...branding,
    logo,
    // A square badge in one colour, inverted in dark mode (shared.js).
    logoShape: university.logoShape,
    // Top of the dashboard, one a day (credits in the footer): the Villejean
    // campus, from Wikimedia Commons, cut to 1920×800.
    heroImages: [
      {
        src: heroVillejeanBatimentsBD,
        credit: {
          author: 'XIIIfromTOKYO',
          license: 'CC BY-SA 3.0',
          url: 'https://commons.wikimedia.org/wiki/File:Universit%C3%A9_Rennes2_-_B%C3%A2timents_B_et_D_-_panorama_depuis_la_pr%C3%A9sidence.jpg',
        },
      },
      {
        src: heroVillejeanBatimentB,
        credit: {
          author: 'Procrastineur49',
          license: 'CC BY 4.0',
          url: 'https://commons.wikimedia.org/wiki/File:B%C3%A2timent_B_Rennes_2.jpg',
        },
      },
      {
        src: heroVillejeanNuit,
        credit: {
          author: 'Electzik',
          license: 'CC BY 3.0',
          url: 'https://commons.wikimedia.org/wiki/File:Campus_Villejean_E-L_nuit.JPG',
        },
      },
    ],
  },

  // Help link of the CAS login page ("Gérer mon compte Sésame UR2").
  links: {
    manageAccount: 'https://services.univ-rennes2.fr/sesame/index.php/aide',
  },

  origins: {
    ent: entOrigin,
    cas: casOrigin,
    // Sidebar / tab bar "Moodle" link (features.moodle).
    moodle: moodleOrigin,
  },

  auth: {
    portalEntryPath,
  },

  features,

  planning: {
    serviceUrl: planningServiceUrl,
    // TEMPO gives the student's own timetable: no group to choose.
    personal: true,
    providerName: 'TEMPO',
    // Shown when TEMPO has no class for the account all year (a campus or
    // course outside it): the campuses' ADE, as the portal lists them.
    otherTimetables: [
      { label: 'ADE Rennes', href: 'https://ade-rennes.univ-rennes2.fr/direct/index.jsp?projectId=1' },
      { label: 'ADE Mazier', href: 'https://ade-mazier.univ-rennes2.fr/direct/index.jsp?projectId=2' },
    ],
  },

  // Mail: the "Mails récents" card and the in-app mail page (Partage's
  // Zimbra, as Rennes'), reading and sending.
  mail: {
    // For the mail page: the university's own mail domains,
    // sub-domains included (etudiant.univ-rennes2.fr…). A sender from any
    // other domain has it shown next to their name in the list, so a
    // display name copying the university's stands out (src/mailDomain.js).
    // uhb.fr: Rennes 2's former name (Université Haute-Bretagne), still on
    // some of its hosts (shibboleth.uhb.fr).
    ownDomains: ['univ-rennes2.fr', 'uhb.fr'],
    // The webmail's links (its public entry, where its sign-in lands): the
    // app lists' tiles leading there open the mail page (mailPortalApp.js).
    webmailUrls: [mailWebmailUrl, 'https://webmail.etudiant.univ-rennes2.fr/'],
    // The automatic signature's « Identifiant : » line (shared.js), as the
    // server writes it in the mail sent.
    signature: { showLogin: mailSignatureShowsLogin },
  },

  // One establishment for everyone, with the "Prochain cours" card.
  establishments: {
    fallbackId: 'rennes2',
    byId: {
      rennes2: {
        label: establishmentNames.rennes2,
        nextClassWidget: true,
      },
    },
  },

  services: {
    getAppIcon: () => null,
    categories: [],
    // The Drupal portal can't store favourites: they stay in the browser.
    localFavorites: true,
  },

  grades: gradesCopy,
}
