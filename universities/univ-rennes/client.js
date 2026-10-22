// Université de Rennes — client-safe configuration.
// Everything in this file is bundled into the browser build: no secrets here.
// This is the reference implementation forks should copy (see docs/ADDING_A_UNIVERSITY.md).
import logo from './assets/logo.svg'
import heroLannionBrelevenez from './assets/hero/lannion-brelevenez.webp'
import heroLannionIut from './assets/hero/lannion-iut.webp'
import heroLannionLeguer from './assets/hero/lannion-leguer.webp'
import heroRennesBeaulieu1 from './assets/hero/rennes-beaulieu-1.webp'
import heroRennesBeaulieu2 from './assets/hero/rennes-beaulieu-2.webp'
import {
  appIcons,
  id,
  branding,
  casOrigin,
  crous,
  entOrigin,
  features,
  gradesCopy,
  gradesServiceUrl,
  moodleOrigin,
  planningServiceUrl,
  portalEntryPath,
  transit,
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
    // Optional dashboard hero photos (rotated daily). Establishments can
    // override them with their own `heroImages`; without any, l'ent shows a
    // generic placeholder. Credit is rendered in the footer.
    heroImages: [
      {
        src: heroRennesBeaulieu1,
        credit: {
          author: 'Anthony Carré',
          license: 'CC0',
          url: 'https://commons.wikimedia.org/wiki/File:Beaulieu_1_Universit%C3%A9_de_Rennes.JPG',
        },
      },
      {
        src: heroRennesBeaulieu2,
        credit: {
          author: 'Sylenius',
          license: 'CC BY 2.5',
          url: 'https://commons.wikimedia.org/wiki/File:Campus_beaulieu.jpg',
        },
      },
    ],
  },

  // Optional outage banner (dashboard + login page); remove once the
  // service is back.
  serviceNotice: {
    title: "L'université a coupé l'accès à Moodle hors campus",
    detail: "Décision de la DSI de l'Université de Rennes suite à une faille de sécurité mondiale, sans lien avec Tafac. Moodle reste accessible depuis les salles de TD/TP ou le Wi-Fi de l'université (eduroam, univ-rennes) en attendant le rétablissement",
  },

  // Optional help links (login page + account modal); omit an entry to hide it.
  links: {
    forgotPassword: 'https://docinfo.univ-rennes1.fr/documentation/compte-jai-oublie-mon-mot-de-passe',
    activateAccount: 'https://sesame.univ-rennes1.fr/motdepasse/public/activate',
    manageAccount: 'https://sesame.univ-rennes.fr/comptes/',
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
  crous,
  transit,

  planning: {
    serviceUrl: planningServiceUrl,
    selectionLabels: {
      year: 'Niveau',
      td: 'Classe TD',
      tp: 'Classe TP',
    },
  },

  grades: {
    ...gradesCopy,
    serviceUrl: gradesServiceUrl,
  },

  // Optional: detection of the student's establishment (faculty/campus) from
  // their ADE tree path, plus per-establishment feature gating. Omit the whole
  // block for universities with a single establishment.
  establishments: {
    // Ordered substring rules, matched against the lowercased ADE tree path.
    detectFromAdeTree: [
      { includes: ['enssat', 'ingénieur', 'ingenieur', 'photonique'], id: 'enssat' },
      { includes: ['iut lannion', 'iut de lannion', 'iutlan', 'iut-lannion', 'but '], id: 'iutlan' },
      { includes: ['iut saint-brieuc', 'iut de saint-brieuc', 'iutsaib'], id: 'iutsaib' },
      { includes: ['iut saint-malo', 'iut de saint-malo', 'iutsai'], id: 'iutsai' },
      { includes: ['osur'], id: 'ods' },
      { includes: ['odontologie'], id: 'ufro' },
      { includes: ['pharmacie'], id: 'ufrp' },
      { includes: ['médecine', 'medecine'], id: 'ufrm' },
      { includes: ['faculté des sciences', 'faculte des sciences', 'istic'], id: 'ufrs' },
      { includes: ['droit', 'science politique'], id: 'fdse' },
    ],
    fallbackId: 'iutlan',
    byId: {
      iutlan: {
        label: 'IUT de Lannion',
        heroImages: [
          {
            src: heroLannionIut,
            position: 'center 50%',
            credit: {
              author: 'Tom Heliere',
            },
          },
          {
            src: heroLannionBrelevenez,
            credit: {
              author: 'Laurent',
              license: 'CC BY-SA 3.0',
              url: 'https://commons.wikimedia.org/wiki/File:VueDeLannionEtBrelevenez.jpg',
            },
          },
          {
            src: heroLannionLeguer,
            credit: {
              author: 'Kev22',
              license: 'CC BY-SA 4.0',
              url: 'https://commons.wikimedia.org/wiki/File:Lannion_-_Le_L%C3%A9guer_03.jpg',
            },
          },
        ],
        gradeWidgets: true,
        nextClassWidget: true,
        extraServices: [
          // ScoDoc shortcut, opened through the CAS launch relay. Only listed
          // while the grade service is live.
          ...(features.grades === true
            ? [{
                id: 'lent-iutlan-notes9',
                title: 'Notes IUT Lannion',
                description: 'Consulter ses notes et résultats',
                href: gradesServiceUrl,
                target: '_blank',
              }]
            : []),
          {
            id: 'lent-iutlan-loxya',
            title: 'Loxya',
            description: 'Location de matériel audiovisuel',
            href: 'https://iut-lannion.loxya.app/external/login',
            target: '_blank',
          },
        ],
      },
      enssat: {
        label: 'ENSSAT',
        heroImages: [
          {
            src: heroLannionBrelevenez,
            credit: {
              author: 'Laurent',
              license: 'CC BY-SA 3.0',
              url: 'https://commons.wikimedia.org/wiki/File:VueDeLannionEtBrelevenez.jpg',
            },
          },
          {
            src: heroLannionLeguer,
            credit: {
              author: 'Kev22',
              license: 'CC BY-SA 4.0',
              url: 'https://commons.wikimedia.org/wiki/File:Lannion_-_Le_L%C3%A9guer_03.jpg',
            },
          },
        ],
        gradeWidgets: false,
        nextClassWidget: true,
        extraServices: [
          {
            id: 'enssat-pegase',
            title: 'Dossier étudiant (Pégase)',
            description: 'Consulter ses notes et son dossier étudiant',
            href: 'https://mdw-pegase.univ-rennes.fr',
            target: '_blank',
          },
        ],
      },
    },
  },

  services: {
    // No getAppIcon: tiles use the automatic icons (server/appIcons.js,
    // style set in server.js).
    // Lowercased ENT title → title shown in l'ent.
    titleOverrides: {
      'mon emploi du temps': 'Planning',
      'prêt de matériel': 'Loxya',
    },
    // Keyword → category map applied to ENT service titles.
    categories: [
      { label: 'Scolarité', keywords: ['notes', 'dossier étudiant', 'apogée', 'contrat pédagogique', 'stages', 'évaluation orthographique', 'contrats étudiants'] },
      { label: 'Communication', keywords: ['messagerie', 'annuaire', 'listes de diffusion', 'webconférence', 'webconference'] },
      { label: 'Pédagogie', keywords: ['moodle', 'foad', 'mooc', 'modules auto-formatifs', 'création de modules', 'téléformation', 'klaxoon'] },
      { label: 'Ressources', keywords: ['mediaserver', 'nudgis', 'ori-oai', 'portail des thèses', 'recherche documentaire', 'documentation des services', 'espaces de stockage', 'mise en ligne', 'loxya', 'prêt de matériel'] },
      { label: 'Compte', keywords: ['sésame', 'sesame', 'compte informatique', 'mfa', 'authentification', "crédits d'impression"] },
      { label: 'Outils', keywords: ['microsoft 365', 'esup signature', 'emplois du temps', 'emploi du temps', 'planning', 'assistance'] },
    ],
  },
}
