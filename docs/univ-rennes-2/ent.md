# Université Rennes 2 : portail étudiant et catalogue des applications

Relevé du 27 octobre 2026, avec un compte étudiant, depuis la console du navigateur du titulaire (pas de HAR, pas de capture brute). Seul le catalogue est documenté : les applications n'ont pas été explorées, sauf la page d'accueil de TEMPO (voir plus bas).

> Ne pas confondre avec `universities/univ-rennes/` (Université de Rennes, `services-numeriques.univ-rennes.fr`). Rien n'est repris de cette implémentation, sauf comme point de comparaison signalé `[code]`.

Légende : `[vu]` observé le 27/10/2026, `[code]` lu dans Tafac, `[déduit]` inférence motivée, `[inconnu]` à lever.

## Portail

| Élément | Valeur | Source |
| --- | --- | --- |
| Hôte | `https://etudiants.univ-rennes2.fr` | [vu] |
| Logiciel | Drupal 8+ (pas uPortal) | [vu] `/sites/default/files/js/…`, classes `user-logged-in path-frontpage`, vues `view-id-outils` et `view-id-categories_outils` ; [déduit] 8+ d'après le nommage des vues et des blocs |
| Thème | `bootstrap_rennes2_color`, barre commune `/barre-portail/jquery.barre-portail-R2.js` | [vu] |
| Titre des pages | `<page> \| Portail étudiant` | [vu] |
| Version | non affichée (`meta generator` vide) | [inconnu] |

Tafac ne sait aujourd'hui lire qu'un portail uPortal 5 (`/api/v4-3/dlm/layout.json`, `server/entAuthApp.js:991`, `src/entApi.js:1392`) avec une entrée `render.uP` (`auth.portalEntryPath`) `[code]`. Rennes 2 demande donc une autre source de catalogue.

## Connexion observée

1. `GET https://etudiants.univ-rennes2.fr/` sans session → `302` vers `https://cas.univ-rennes2.fr/login?service=https://etudiants.univ-rennes2.fr/casservice?destination=/` `[vu]`.
2. Page de connexion CAS : titre « Authentification Sesame Login », thème `/themes/uhb/`, `/webjars/` (jQuery 3.7.1, Material Components Web 14.0.0), `cas.js`, `sesame.js` `[vu]`. Logiciel : Apereo CAS 6.x ou 7.x `[déduit]` (structure `webjars` + MDC de l'interface par défaut). Version exacte `[inconnu]`.
3. MFA : demandée au titulaire pendant la connexion, effectuée par lui ; type de second facteur non relevé `[inconnu]`.
4. Retour sur le portail par `/casservice?destination=<chemin>` : convention du module `cas` de Drupal `[déduit]`. Déconnexion : `/caslogout` `[vu]`.
5. Gestion du compte « Sésame UR2 » : `https://services.univ-rennes2.fr/sesame/` (lien d'aide de la page CAS) `[vu]`.

Noms des cookies de session du portail et du CAS : non relevés `[inconnu]`.

## Source du catalogue

- Le catalogue complet est la page **`GET /tous-outils`** (titre « Tous les outils »), rendue côté serveur en HTML `[vu]`.
- Aucune requête `fetch` ou XHR n'est faite par cette page ni par l'accueil `[vu]` : pas de layout JSON à consommer.
- Structure HTML `[vu]` :
  - bloc `block-toc-js` : sommaire des rubriques (ancres internes) ;
  - vue `view-id-categories_outils` (affichage `block_categories_outils`) : liste des catégories ;
  - vue `view-id-outils` (affichage `page_par_categorie`) : les outils groupés par titre de rubrique, avec un filtre exposé `block-views-exposed-filter-blockoutils-page-par-categorie` (paramètres du filtre non relevés `[inconnu]`) ;
  - certains outils ont un second lien sans texte vers une page d'aide du portail (article ou page « formation »).
- Une extraction côté Tafac reviendrait à parcourir `main` dans l'ordre du document : titre `h2/h3` = rubrique, `a[href]` = application `[déduit]`.
- La barre d'accès rapide de toutes les pages reprend un sous-ensemble : Partage / mails, TEMPO, Cursus, Tickets / Demandes, Annuaire, Plan des campus, puis « Tous les outils » `[vu]`.

## Applications de « Tous les outils »

47 entrées dans 7 rubriques (hors ancres du sommaire et liens d'aide secondaires). Chemins sans paramètres ; les noms de paramètres sont indiqués quand ils renseignent sur l'accès.

« Accès » : `CAS` = le lien passe par `cas.univ-rennes2.fr` ou un point d'entrée CAS de l'application ; `Fédération` = Shibboleth / RENATER ; `Public` = pas de connexion attendue ; `Portail` = page de `etudiants.univ-rennes2.fr`.

### Bureau

| Nom affiché | Destination | Logiciel probable | Accès | Intérêt Tafac |
| --- | --- | --- | --- | --- |
| TEMPO | `tempo.univ-rennes2.fr/` | [inconnu] ; titre « Tempo - Mon emploi du temps », appel `/api/events` [vu] | [inconnu] | **planning** |
| Partage / mails | `webmail.univ-rennes2.fr/` | Partage RENATER (Zimbra) [déduit : nom] | [inconnu] | **mail** |
| Tickets / Demandes | `tickets.univ-rennes2.fr/SelfService/` | Request Tracker [déduit : chemin `/SelfService/`] | [inconnu] | autre |
| Imprimer (avec Mobility Print) | `etudiants.univ-rennes2.fr/vie-etudiante/numerique/limpression-photocopie-numerisation` | page d'information | Portail | autre |
| Mon compte Papercut | `print.univ-rennes2.fr:9192/app` (`service`) | PaperCut [vu : nom ; déduit : port 9192] | CAS [déduit : paramètre `service`] | autre |
| Recharger mon compte papercut | `credit-papercut.univ-rennes2.fr/` | [inconnu] | [inconnu] | autre |
| Mon compte lecteur | `cas.univ-rennes2.fr/login` (`service`) | [inconnu] (destination dans `service`, non relevée) | CAS [vu] | autre |
| Mes disques réseau M et K | `mes-disques-reseau.univ-rennes2.fr/horde/login.php` (`url`, `app`, `backend_key`) | Horde [vu : chemin] | [inconnu] | documents |
| Mes listes de diffusion | `cas.univ-rennes2.fr/login` (`service`) | [inconnu] (destination non relevée) | CAS [vu] | autre |
| Envoi de gros fichiers | `filesender.renater.fr/Shibboleth.sso/Login` (`target`, `SAMLDS`, `entityID`) | FileSender RENATER [vu] | Fédération [vu] | autre |

### Enseignement

| Nom affiché | Destination | Logiciel probable | Accès | Intérêt Tafac |
| --- | --- | --- | --- | --- |
| Cursus | `cursus.univ-rennes2.fr/login/index.php` (`authCAS`) | Moodle [déduit : `/login/index.php`, `/course/index.php`, `authCAS` du plugin CAS de Moodle] | CAS [déduit] | **devoirs**, documents |
| Emploi du temps de ma filière | `etudiants.univ-rennes2.fr/article/emploi-temps-ma-filiere` | page d'information | Portail | planning (contenu non relevé) |
| Emploi du temps Rennes | `ade-rennes.univ-rennes2.fr/direct/index.jsp` (`projectId`) | ADE Campus [déduit : hôte, `/direct/index.jsp`] | [inconnu] | planning |
| Emploi du temps Mazier | `ade-mazier.univ-rennes2.fr/direct/index.jsp` (`projectId`) | ADE Campus [déduit : idem] | [inconnu] | planning |
| Méthodologie informatique | `cursus.univ-rennes2.fr/course/index.php` (`categoryid`) | Moodle (catégorie de cours) [déduit] | CAS [déduit] | autre |
| Méthodologie professionnelle | `etudiants.univ-rennes2.fr/formation/methodologie-professionnelle` | page d'information | Portail | autre |
| Classes virtuelles (VIA) | `via.univ-rennes2.fr/ShibLara.aspx` (`target`) | VIA [vu : nom] | Fédération [déduit : `Shib…`] | autre |
| Liste des logiciels par salle informatique | `services.univ-rennes2.fr/dsi/salles-info/` | [inconnu] | [inconnu] | autre |

### Scolarité

| Nom affiché | Destination | Logiciel probable | Accès | Intérêt Tafac |
| --- | --- | --- | --- | --- |
| Mon Compte Sésame | `cas.univ-rennes2.fr/login` (`service`) | gestion de compte, probablement `services.univ-rennes2.fr/sesame/` [déduit : lien d'aide du CAS] | CAS [vu] | autre |
| Mon Dossier Scolarité | `mondossierweb.univ-rennes2.fr/` | Mon Dossier Web (ESUP) [déduit : nom d'hôte] | [inconnu] | **notes** |
| Mes inscriptions aux enseignements | `uportal.univ-rennes2.fr/redirect_consult_ipweb.jsp` | IP Web Apogée derrière un ancien uPortal [déduit : hôte, `ipweb`] | [inconnu] | autre |
| Réclamation des résultats | `etudiants.univ-rennes2.fr/formation/resultats/reclamation-resultats` | page d'information | Portail | autre |
| Amethis | `amethis.doctorat.org/amethis-client` | Amethis [vu : nom] | lien externe | autre |
| Paiement Frais EAD | `frais-ead.univ-rennes2.fr/` | [inconnu] | [inconnu] | autre |
| Pièces justificatives | `pjweb.univ-rennes2.fr/` | [inconnu] | [inconnu] | documents |

### Vie étudiante

| Nom affiché | Destination | Logiciel probable | Accès | Intérêt Tafac |
| --- | --- | --- | --- | --- |
| Recharger ma carte « Vie universitaire » | `mon-espace.izly.fr/` | Izly [vu] | lien externe | autre |
| Le sport (SIUAPS) | `siuaps.univ-rennes.fr/` | site d'information | Public [déduit] | autre |
| Mes activités sportives | `mon-espace.siuaps.univ-rennes.fr/auth/shibboleth/login.php` | [inconnu] (chemin de type Moodle `auth/shibboleth`) | Fédération [déduit] | autre |
| Buddy System R2 | `www.univ-rennes2.fr/formation/venir-etudier-france/buddy-system` | page d'information | Public | autre |
| Demander une salle ou du matériel | `etudiants.univ-rennes2.fr/vie-etudiante/associations/demander-salle-ou-materiel` | page du portail | Portail | autre |

### Orientation - Stages - Insertion

| Nom affiché | Destination | Logiciel probable | Accès | Intérêt Tafac |
| --- | --- | --- | --- | --- |
| Conventions (ESUP-Stage) | `conventions-stage.univ-rennes2.fr/` | ESUP-Stage [vu : nom] | [inconnu] | autre |
| Avenants (Ancienne application de stages) | `pstage.univ-rennes2.fr/esup-pstage/stylesheets/stage/welcome.xhtml` | ESUP-Pstage [vu : chemin] | [inconnu] | autre |
| APPUI | `appui.univ-rennes2.fr/` | [inconnu] | [inconnu] | autre |
| Offres stages/emplois | `resonances.univ-rennes2.fr/` | [inconnu] | [inconnu] | autre |

### Informations générales

| Nom affiché | Destination | Logiciel probable | Accès | Intérêt Tafac |
| --- | --- | --- | --- | --- |
| Annuaire | `annuaire.univ-rennes2.fr/cas/login` | [inconnu] | CAS [déduit : chemin] | autre |
| ISOU | `services.univ-rennes2.fr/isou/` | Isou (météo des services, ESUP) [déduit : nom] | [inconnu] | autre (état des services) |
| Plan des campus | `map.univ-rennes2.fr/` | [inconnu] | [inconnu] | autre |

### Ressources

| Nom affiché | Destination | Logiciel probable | Accès | Intérêt Tafac |
| --- | --- | --- | --- | --- |
| BU en ligne | `www.bu.univ-rennes2.fr/` | site de la BU | Public | autre |
| Bases de données BU | `www.bu.univ-rennes2.fr/ressource` | site de la BU | Public | autre |
| Tutoriels de la BU | `tutos.bu.univ-rennes2.fr/` | [inconnu] | Public [déduit] | autre |
| Vidéos (Aire d'U) | `www.lairedu.fr/` | site externe | Public | autre |
| SOcle | `socle.univ-rennes2.fr/` | [inconnu] | [inconnu] | autre |
| Dumas - Mémoires de master | `dumas.ccsd.cnrs.fr/MEM-UNIV-UR2HB` | DUMAS (CCSD) [vu] | Public | autre |
| Thèses de Rennes 2 en ligne | `univ-rennes2.hal.science/UR2-HB-T` | HAL [vu] | Public | autre |
| Portail HAL Rennes 2 | `univ-rennes2.hal.science/` | HAL [vu] | Public | autre |
| France Université Numérique (FUN) | `www.fun-mooc.fr/` | site externe | Public | autre |
| Canal U | `www.canal-u.tv/` | site externe | Public | autre |

## Note sur TEMPO

Le titulaire a ouvert la page d'accueil de TEMPO et y a lancé le même relevé `[vu]` : titre « Tempo - Mon emploi du temps », navigation « Aujourd'hui / Période précédente / Période suivante », une requête `fetch`/XHR vers `/api/events`. Méthode, paramètres, format de réponse et mode d'authentification : non relevés `[inconnu]`. C'est la seule incursion hors du portail ; aucun autre service n'a été ouvert.

## Comparaison avec ce que Tafac sait déjà faire

| Besoin | Rennes 2 | Tafac aujourd'hui |
| --- | --- | --- |
| Connexion | Apereo CAS `cas.univ-rennes2.fr` [déduit] | CAS 2.0 avec formulaire (`execution`/`_eventId`) [code] `docs/ADDING_A_UNIVERSITY.md` ; compatibilité avec ce CAS à vérifier |
| Catalogue | HTML Drupal `/tous-outils` [vu] | `layout.json` uPortal 5 uniquement [code] |
| Mail | Partage `webmail.univ-rennes2.fr` [déduit] | lecture d'un webmail Partage pour Rennes, `mailWebmailUrl` [code] `universities/univ-rennes/shared.js:100` |
| Planning | TEMPO (`/api/events`) et ADE direct [vu/déduit] | API mobile ADE Campus et Planning GWT [code] ; TEMPO non pris en charge |
| Devoirs | Moodle Cursus, entrée CAS [déduit] | Moodle via Shibboleth WAYF [code] `universities/univ-rennes/server.js` ; une entrée CAS directe serait différente |
| Notes | Mon Dossier Web [déduit] | ScoDoc [code] ; Mon Dossier Web non pris en charge |
