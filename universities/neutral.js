// Tafac without a university: the page shown before the student picks one
// (tafac.fr serves every university), the SEO text and the installed app's
// manifest. Pure data, read by Node (server.js, vite.config.js) and by the
// browser (src/neutralUniversity.js). Not a university: it has no directory,
// so listUniversityIds() never lists it.

import { TAFAC_CONTACT_EMAIL, TAFAC_TEAM } from './tafac.js'

export const university = {
  name: 'Tafac',
  shortName: 'Tafac',
}

// Same fields as a university's branding (shared.js), in neutral words.
export const branding = {
  appName: 'Tafac',
  defaultTitle: 'Tafac | Cours, notes et services de ton université',
  seoTitle: 'Tafac – Tout ton ENT en une seule app',
  seoDescription:
    "Emploi du temps, notes, mails et rendus Moodle sur une seule page. Projet étudiant libre, non affilié aux universités.",
  pwaDescription:
    "Emploi du temps, notes, mails et rendus Moodle sur une seule page. Projet étudiant non affilié aux universités.",
  // Former names, for search engines (the site's name in results).
  alternateNames: ["l'ent"],
  // How the landing's copy names the university mid-sentence ({university}
  // in src/landingCopy.json).
  nameInText: 'ton université',
  logoAlt: 'Tafac',
  sidebarLogoAlt: 'Tafac',
  loginFooterLine: 'Projet étudiant non officiel, non affilié aux universités',
  loginPasswordNote: "Ton mot de passe sert uniquement à te connecter au site de ton université et n'est jamais enregistré",
  about: {
    intro: 'est un client alternatif aux services numériques des universités.',
    disclaimer:
      'Tafac est un projet étudiant indépendant, non officiel et non affilié aux universités. Tes identifiants servent uniquement à te connecter et ne sont jamais stockés.',
    repoUrl: 'https://github.com/l-ent-univ/tafac',
    team: TAFAC_TEAM,
    // À propos › Aide: the button to write to the team.
    contactEmail: TAFAC_CONTACT_EMAIL,
  },
  // Tafac is part of Papillon, made by the same team.
  papillon: { url: 'https://papillon.bzh' },
}
