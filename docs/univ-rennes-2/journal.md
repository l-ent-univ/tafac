# Université Rennes 2 : journal

## 2026-10-27 : catalogue des applications

Périmètre : portail étudiant et catalogue uniquement. Pas d'exploration des services, pas d'action modifiant le compte.

Déroulé :

1. Un `GET` anonyme sur `https://etudiants.univ-rennes2.fr` (sans suivre la redirection) : `302` vers `cas.univ-rennes2.fr/login` avec `service=…/casservice?destination=/`.
2. Le titulaire se connecte lui-même (identifiants + MFA) dans son navigateur. L'extension de navigation de l'assistant n'étant pas disponible, il lance dans la console un script de relevé en lecture seule (liens : nom, rubrique, hôte, chemin sans paramètres ; noms des paramètres ; requêtes `fetch`/XHR de la page). Aucune valeur de cookie, ticket ou paramètre n'est conservée.
3. Pages relevées : page de connexion CAS (premier essai, avant la fin de la connexion), accueil du portail, `/tous-outils`, accueil de TEMPO (ouvert par le titulaire).
4. Constats : portail Drupal rendu côté serveur, aucune requête JSON pour le catalogue, 47 entrées dans 7 rubriques. Détail dans [ent.md](ent.md).

Exclu volontairement : contenu de la rubrique « Ma filière » et des actualités personnalisées de l'accueil (elles révèlent la formation du compte).

## Inconnues à lever

Portail et connexion :

- Version de Drupal et du CAS ; type de second facteur ; noms des cookies de session (`SESS…` côté Drupal ? `TGC` côté CAS ?).
- Le flux CAS est-il compatible avec celui de Tafac (formulaire `execution` / `_eventId`) malgré la MFA ?
- `/tous-outils` varie-t-il selon le profil (étudiant, doctorant, campus Mazier) ? Paramètres du filtre exposé de la vue `outils`.
- La barre `/barre-portail/jquery.barre-portail-R2.js` est-elle construite en JavaScript à partir d'une source réutilisable (fichier statique, JSON) ? À vérifier en lisant le script, sans l'exécuter ailleurs.
- `/user` (« Mon espace ») : contient-il des données de profil utiles (nom affiché, formation) pour le rattachement ?

Destinations à préciser (sans ouvrir les services) :

- Hôte cible du paramètre `service` pour « Mon compte lecteur », « Mes listes de diffusion », « Mon Compte Sésame ».
- Contenu de `/article/emploi-temps-ma-filiere` et de `/formation/mon-dossier-scolarite` : vers quoi pointent-ils ?
- Logiciel de TEMPO, de `pjweb`, `frais-ead`, `appui`, `resonances`, `socle`, `map`, `annuaire`.

Pour une session suivante, si l'intégration est décidée (hors périmètre de ce relevé) :

- TEMPO `/api/events` : méthode, paramètres de période, authentification (session CAS ?), format.
- Cursus : l'entrée `?authCAS=CAS` permet-elle de réutiliser le ticket CAS sans WAYF ?
- Webmail Partage : même interface que `partage.univ-rennes.fr`, utilisée par Tafac pour Rennes ?
- Mon Dossier Web : accès aux notes.
