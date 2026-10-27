# Université Rennes 2

Recherche préalable à un éventuel `universities/univ-rennes-2/`. Aucune configuration Tafac n'existe encore pour cet établissement.

> Établissement distinct de l'Université de Rennes (`universities/univ-rennes/`). Ne pas mélanger les observations.

| Fichier | Contenu |
| --- | --- |
| [ent.md](ent.md) | Portail (Drupal), connexion CAS, source du catalogue, tableau des 47 entrées de « Tous les outils » |
| [journal.md](journal.md) | Journal daté et inconnues à lever |

## En bref

- Portail étudiant **Drupal**, pas uPortal : le catalogue est une page HTML (`/tous-outils`), sans JSON.
- Connexion par **Apereo CAS** (`cas.univ-rennes2.fr`), compte « Sésame », MFA demandée.
- Candidates pour Tafac : TEMPO (planning), Cursus (Moodle), Mon Dossier Web (notes), Partage (mail).

## Carte des hôtes

| Hôte | Rôle | Source |
| --- | --- | --- |
| `etudiants.univ-rennes2.fr` | Portail étudiant (Drupal), catalogue `/tous-outils` | [vu] |
| `cas.univ-rennes2.fr` | SSO Apereo CAS « Sesame Login » | [vu] / [déduit] |
| `services.univ-rennes2.fr` | Gestion du compte Sésame `/sesame/`, ISOU `/isou/`, salles info `/dsi/salles-info/` | [vu] |
| `tempo.univ-rennes2.fr` | TEMPO, emploi du temps personnel (`/api/events`) | [vu] |
| `ade-rennes.univ-rennes2.fr`, `ade-mazier.univ-rennes2.fr` | ADE Campus, accès direct par campus | [déduit] |
| `cursus.univ-rennes2.fr` | Moodle « Cursus » | [déduit] |
| `webmail.univ-rennes2.fr` | Partage (Zimbra) | [déduit] |
| `mondossierweb.univ-rennes2.fr` | Mon Dossier Web | [déduit] |
| `uportal.univ-rennes2.fr` | Ancien uPortal, sert IP Web (inscriptions pédagogiques) | [déduit] |
| `pjweb.univ-rennes2.fr`, `frais-ead.univ-rennes2.fr` | Pièces justificatives, paiement EAD | [vu] (logiciel [inconnu]) |
| `conventions-stage.univ-rennes2.fr`, `pstage.univ-rennes2.fr` | ESUP-Stage, ESUP-Pstage | [vu] |
| `tickets.univ-rennes2.fr` | Request Tracker (self-service) | [déduit] |
| `print.univ-rennes2.fr:9192`, `credit-papercut.univ-rennes2.fr` | PaperCut et rechargement | [vu] / [inconnu] |
| `mes-disques-reseau.univ-rennes2.fr` | Horde, disques réseau M et K | [vu] |
| `via.univ-rennes2.fr` | Classes virtuelles VIA | [vu] |
| `annuaire.univ-rennes2.fr`, `map.univ-rennes2.fr`, `appui.univ-rennes2.fr`, `resonances.univ-rennes2.fr`, `socle.univ-rennes2.fr` | Annuaire, plan, insertion, offres, SOcle | [vu] (logiciels [inconnu]) |
| `www.bu.univ-rennes2.fr`, `tutos.bu.univ-rennes2.fr` | Bibliothèques | [vu] |
