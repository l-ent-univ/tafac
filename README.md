<p align="center">
  <img src="src/assets/tafac-wordmark.svg" alt="Tafac" width="220" />
</p>

<p align="center">
  Les cours, les notes et les services de ton université, au même endroit.
</p>

<p align="center">
  <a href="https://tafac.fr">Accéder à Tafac</a> ·
  <a href="#démarrer-en-local">Développer</a> ·
  <a href="#auto-hébergement">Auto-héberger</a> ·
  <a href="docs/ADDING_A_UNIVERSITY.md">Ajouter une université</a>
</p>

Tafac est un client web alternatif aux espaces numériques de travail universitaires (ENT). Il rassemble les applications de l’ENT, l’emploi du temps, les notes, la messagerie et les échéances Moodle dans une interface adaptée au téléphone comme à l’ordinateur.

Tafac est un **projet étudiant libre, indépendant et non officiel**, sans affiliations aux universités. Ce projet fait partie de [Papillon](https://papillon.bzh). L’intégration réelle présente dans ce dépôt est celle de l’Université de Rennes, avec des fonctionnalités spécifiques à l’IUT de Lannion.

## Ce que propose Tafac

| Espace | Fonctionnalités |
| --- | --- |
| **Accueil** | Résumé de la journée, prochain cours, dernière note, mails récents et échéances Moodle, selon les services disponibles pour la dite université. |
| **Applications** | Catalogue issu de l’ENT avec les applications disponibles            |
| **Planning** | Choix de la formation et des groupes TD/TP, différentes vues disponibles avec les détails des cours et des prochaines séances. |
| **Export calendrier** | Téléchargement d’un fichier `.ics` couvrant 60 jours à partir du lundi de la semaine courante, importable dans un agenda. Il s’agit pour le momet d’un export ponctuel et non d’un abonnement synchronisé. |
| **Messagerie** | Boîte mail de l’université (RENATER Partage / Zimbra) dans l’application : conversations, recherche, dossiers, actions et balayage sur téléphone ; rédaction avec mise en forme, pièces jointes, brouillons, signatures et envoi annulable ; impression et PDF d’une conversation ; mail prérempli au sujet d’une note ou d’un cours. |
| **Mes notes** | Cette partie est spécifique aux B.U.T et supporte les relevés ScoDoc par semestre, UE, matières et SAÉ, détail des évaluations, statistiques disponibles, crédits ECTS et téléchargement du relevé PDF lorsque le département le propose. |
| **Simulateur** | Modification de notes et ajout d’évaluations fictives pour estimer leur effet sur les moyennes et la validation des UE (Pour B.U.T uniquement). La simulation reste dans l’interface et ne modifie pas ScoDoc. |
| **Compte** | Réglage du groupe TD/TP, quels widgets à afficher, changement du thème clair/sombre/automatique, fond personnalisé, couleurs et certificat de scolarité lorsque l’intégration est disponible. |
| **Application installable** | PWA avec installation sur l’écran d’accueil et proposition des mises à jour. Les services universitaires nécessitent une connexion réseau. |

Les moyennes recalculées et les simulations sont indicatives : les résultats publiés par l’établissement restent la référence. La page de notes est conçue pour les relevés **BUT** de ScoDoc ; elle ne prend pas en charge tous les formats de cursus.

## Universités et compatibilité

Le dépôt fournit trois configurations :

| Dossier | Usage |
| --- | --- |
| `universities/univ-rennes/` | Intégration finie : ENT uPortal, CAS, planning ADE, ScoDoc de l’IUT de Lannion, Moodle/FOAD, messagerie Partage et MonDossierWeb. |
| `universities/univ-exemple/` | Université fictive pour tester le choix d’université et la démonstration. Ses adresses ne désignent aucun service réel. Elle est masquée dans la liste en production, mais reste accessible par `/exemple` si elle est servie. |
| `universities/example-minimal/` | Point de départ pour une nouvelle intégration. Exclu de la liste des universités servies par défaut. |

La disponibilité dépend de l’université, de l’établissement, du compte et des services en amont. Dans la configuration Rennes actuelle, les widgets de notes et de prochain cours sont activés pour l’IUT de Lannion. La présence d’un établissement dans les règles de détection ne signifie pas que toutes les intégrations y sont disponibles.

L’authentification implémentée repose sur un portail **uPortal et un formulaire CAS**. Ajouter une université utilisant un autre système peut nécessiter un nouvel adaptateur, au-delà d’un changement de configuration.

## Démarrer en local

> Une partie du code a été générée avec l’aide d’outils d’intelligence artificielle générative, mais systématiquement relue et vérifiée

Utiliser **Node.js 24** et npm pour suivre l’environnement de la CI et de l’image Docker.

```sh
git clone https://github.com/l-ent-univ/tafac.git
cd tafac
npm ci
npm run dev
```

Ouvrir l’adresse indiquée par Vite, généralement `http://localhost:5173`. Le serveur de développement inclut le backend Express : il n’y a pas de second serveur à lancer. Aucun compte universitaire ni secret n’est nécessaire pour essayer la démonstration.

### Essayer la démonstration

Utiliser l’accès démo de la page de connexion, ou saisir :

| Champ | Valeur |
| --- | --- |
| Identifiant | `demo@tafac.fr` |
| Mot de passe | `tafac-demo` |

Les données universitaires de démonstration sont fictives. Ce mode permet de parcourir l’application sans se connecter à un ENT réel ; il ne valide pas le fonctionnement des intégrations universitaires.

### Choisir les universités servies

Sans variable `UNIVERSITY`, le serveur propose les universités configurées. Pour travailler sur Rennes uniquement :

```sh
UNIVERSITY=univ-rennes npm run dev
```

Pour sélectionner explicitement plusieurs configurations :

```sh
MULTI_UNIVERSITY=1 UNIVERSITIES=univ-rennes,univ-exemple npm run dev
```

Les liens `/rennes` et `/exemple` ouvrent la page d’accueil de l’université correspondante, si celle-ci est servie, d’où son bouton mène à sa connexion. Ces pages sont pré-rendues pour les moteurs de recherche et listées dans le sitemap (sauf les universités `devOnly`).

**Un seul build frontend contient les configurations clientes de toutes les universités.** Le navigateur télécharge celle qui lui est attribuée au démarrage. Il n’est pas nécessaire de construire un `dist/` par université ; `build:all` est actuellement un alias de `build`.

### Commandes du projet

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Vite avec rechargement à chaud et backend intégré. |
| `npm run lint` | Vérification ESLint. |
| `npm test` | Tests avec le runner natif de Node.js. Certains ouvrent des serveurs HTTP locaux temporaires. |
| `npm run build` | Compilation de l’interface et génération du service worker dans `dist/`. |
| `npm run build:all` | Même compilation que `npm run build`. |
| `npm run preview` | Prévisualisation locale du build avec le backend ; cookies en mode développement. |
| `npm start` | Serveur de production Express ; nécessite un build et `SESSION_SECRET`. |

## Architecture

L’interface utilise **React 19**, **Vite 7**, **Tailwind CSS 4** et **Iconify**. Le backend repose sur **Express 5**, les API natives de Node.js et des adaptateurs pour les services universitaires. Le code applicatif est écrit en JavaScript avec des modules ES.

```text
Navigateur : React / PWA
    │
    ├── /__ent_auth/*    Connexion, session et services intégrés
    └── /__ent_proxy/*   Requêtes vers le portail ENT
              │
       Serveur Express
              │
       Sélection de l’université
              │
       CAS · uPortal · ADE · ScoDoc · Moodle · Zimbra · MonDossierWeb
```

Au démarrage, le navigateur consulte `/__ent_auth/universities`, puis charge le `client.js` adapté avant d’importer l’application. Côté serveur, chaque université dispose de son propre backend configuré. Une requête authentifiée est routée vers l’université inscrite dans sa session ; le formulaire de connexion peut en sélectionner une nouvelle.

| Fichier ou dossier | Responsabilité |
| --- | --- |
| `src/main.jsx`, `src/universityBoot.js` | Initialisation, choix d’université et chargement de l’application. |
| `src/App.jsx` | Session, onboarding, tableau de bord et navigation principale. |
| `src/components/` | Écrans, widgets, fenêtres et composants partagés. |
| `src/entApi.js` | Appels au backend, normalisation des réponses et caches côté client. |
| `src/gradesReport.js`, `src/gradeSimulation.js` | Lecture des relevés, calculs et projections de notes. |
| `src/planning*.js`, `src/usePlanning*.js` | Dates, vues, chargement et export du planning. |
| `src/profileStorage.js`, `src/universityStorage.js` | Préférences locales et séparation des réglages entre universités. |
| `server.js` | Entrée de production : API, fichiers compilés et page HTML avec métadonnées. |
| `server/universitiesApp.js` | Registre public et routage des requêtes entre universités. |
| `server/entAuthApp.js` | Connexion CAS, sessions, proxy ENT et intégrations des services. |
| `server/sessionCookie.js` | Chiffrement, durée de vie et rotation des cookies de session. |
| `planningPortalApi.js` | Adaptateur du portail planning REST, utilisé pour Rennes. |
| `planningRpc.js`, `adeApi.js`, `adeUpcomingResolver.js` | Adaptateurs planning GWT et ADE mobile, résolution des cours à venir. |
| `server/appIcons.js` | Attribution et persistance des icônes des applications. |
| `universities/` | Configuration, identité et ressources de chaque université. |
| `tests/` | Tests des calculs, adaptateurs, sessions, routage, exports et comportements de l’interface. |
| `deploy/`, `Dockerfile` | Image de production et déploiement avec Caddy. |

## Configuration

| Variable | Effet |
| --- | --- |
| `UNIVERSITY` | Université unique, ou université par défaut en mode multiple. Valeur de repli : `univ-rennes`. |
| `MULTI_UNIVERSITY` | `1` pour le choix entre universités, `0` pour une seule. Sans valeur explicite, le mode multiple est activé si `UNIVERSITY` n’est pas définie. L’image Docker impose `1` par défaut. |
| `UNIVERSITIES` | Liste d’identifiants séparés par des virgules en mode multiple. Par défaut, tous les dossiers sauf ceux commençant par `example`. L’université par défaut est également incluse. |
| `PORT` | Port du serveur de production, `3000` par défaut. |
| `SESSION_SECRET` | Secret servant à dériver la clé de chiffrement des sessions. Obligatoire en production, au moins 32 octets. |
| `SESSION_SECRET_PREVIOUS` | Anciens secrets, séparés par des virgules, acceptés pendant une rotation. |
| `DATA_DIR` | Dossier des icônes persistantes : `./data` par défaut, `/app/data` dans Docker. |
| `TRUST_PROXY` | Proxys autorisés à transmettre l’adresse du client à Express, notamment pour limiter les tentatives de connexion. Par défaut : réseaux locaux et privés. |
| `POSTHOG_PROJECT_KEY` | Active les événements PostHog côté serveur. Absent : PostHog désactivé. |
| `POSTHOG_HOST` | Destination PostHog, `https://eu.i.posthog.com` par défaut. |
| `POSTHOG_IN_DEV` | `1` pour autoriser PostHog dans le serveur Vite, avec une clé configurée. |
| `ANALYTICS_EXCLUDED_USERS` | Identifiants ENT dont les événements PostHog sont ignorés, séparés par des virgules. |
| `BUILD_HASH` | Référence de commit affichée dans « À propos », fournie au moment du build si Git n’est pas disponible. |

Passer `UNIVERSITY`, `MULTI_UNIVERSITY` et `UNIVERSITIES` dans l’environnement du processus. Le serveur Vite lit aussi les variables de session, de statistiques et `DATA_DIR` dans `.env` / `.env.local`. En production, `npm start` ne charge pas automatiquement de fichier `.env` ; Docker Compose le transmet au conteneur, ou Node peut le charger explicitement avec `node --env-file=.env server.js`.

Les anciens noms `MULTI_TENANT` et `TENANTS` restent acceptés. Le fichier `.env.example` à la racine contient encore des commentaires sur l’ancien fonctionnement par builds et sous-domaines : pour le déploiement actuel, utiliser [`deploy/example.env`](deploy/example.env) et les variables ci-dessus.

## Sessions et données

**Les identifiants passent par le serveur Tafac**, qui les transmet au CAS de l’université et peut les utiliser pour initialiser ADE pendant la connexion. Le mot de passe n’est pas conservé dans la session ni enregistré par le backend. Le navigateur peut proposer de le mémoriser dans son propre gestionnaire de mots de passe.

Après connexion, Tafac conserve les cookies nécessaires aux services universitaires. Une partie de ces cookies, dont le ticket CAS, est transportée dans un cookie Tafac chiffré avec **AES-256-GCM**. En production, ce cookie est `HttpOnly`, `Secure`, `SameSite=Lax` et préfixé `__Host-`. La durée maximale prévue est de 30 jours depuis la connexion, mais la session universitaire peut expirer plus tôt.

Il n’y a pas de base de données applicative à installer. Les sessions actives et les caches des services sont en mémoire serveur ; les choix d’icônes des applications sont persistés dans `DATA_DIR`. Le navigateur conserve des préférences et certains caches locaux. Les réglages liés à l’université sont séparés lors d’un changement d’établissement.

La messagerie passe par le serveur Tafac, qui relaie chaque requête au webmail de l’université (Zimbra) avec la session de l’étudiant : rien n’est écrit sur disque, les pièces jointes sont transmises en flux. La connexion au webmail et la dernière liste de mails restent en mémoire pour la session et sont effacées à la déconnexion. Les brouillons et la signature personnalisée sont enregistrés dans le compte de messagerie, pas par Tafac.

Sans secret en développement, une clé temporaire est créée : redémarrer le serveur invalide les sessions. En production, conserver un secret stable. Pour le renouveler sans déconnecter immédiatement les sessions existantes, placer l’ancien dans `SESSION_SECRET_PREVIOUS`.

### Statistiques et services externes

Deux dispositifs distincts sont présents :

- **PostHog**, facultatif et appelé par le serveur : événements filtrés par une liste de propriétés autorisées, sans SDK PostHog dans le navigateur.
- **Simple Analytics**, chargé côté navigateur dans les builds de production pour compter les pages vues lorsque le réglage de statistiques est activé. L’absence de clé PostHog ne désactive donc pas toute mesure d’audience.

Le réglage **Statistiques anonymes**, activé par défaut, permet de désactiver les deux. Le fonctionnement détaillé et les propriétés autorisées sont décrits dans [`docs/ANALYTICS.md`](docs/ANALYTICS.md) (écrit à l'aide d'IAg).

D’autres fonctionnalités font appel à des services externes : GitHub pour les contributeurs et Iconify pour les icônes. Une instance auto-hébergée conserve ces dépendances tant que leur code ou leur configuration n’est pas adapté.

## Auto-hébergement

Le dépôt fournit une image Docker réunissant le frontend et le serveur Express, ainsi qu’un déploiement Caddy pour HTTPS. L’image conserve son nom historique (l'ent) :

```text
ghcr.io/l-ent-univ/l-ent:latest
```

Depuis une copie du dépôt, sur un serveur disposant de Docker Compose :

```sh
cd deploy
cp example.env .env
openssl rand -base64 32
```

Reporter le secret généré dans `SESSION_SECRET` du fichier `.env`, puis remplacer `tafac.example.fr` dans `Caddyfile` par un domaine pointant vers le serveur. Les ports 80 et 443 doivent être accessibles à Caddy.

Pour ne servir que Rennes, ajouter dans ce même `.env` :

```dotenv
MULTI_UNIVERSITY=0
UNIVERSITY=univ-rennes
```

Démarrer l’instance :

```sh
docker compose up -d
docker compose logs -f lent
```

Le déploiement monte un volume pour les icônes et des volumes pour Caddy. **HTTPS est nécessaire en production**, notamment pour le cookie de session sécurisé. Pour les mises à jour, le choix d’une version fixe, un autre reverse proxy ou la gestion des icônes, consulter [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

Hors Docker, compiler avec `npm ci` puis `npm run build`, fournir les variables d’environnement et lancer `npm start` derrière un reverse proxy HTTPS. Le serveur utilise aussi les sources du dépôt et ses dépendances de production ; conserver seulement `dist/` est insuffisant.

## Ajouter une université

Créer un nouveau dossier à partir du modèle minimal, avec un identifiant encore inutilisé :

```sh
cp -R universities/example-minimal universities/univ-mon-campus
```

Adapter les trois fichiers de configuration :

| Fichier | Contenu |
| --- | --- |
| `shared.js` | Identifiant, noms, slug, textes publics et fonctionnalités. Données pures, lisibles par Node et le navigateur. |
| `client.js` | Identité visuelle, images, liens, établissements et configuration de l’interface. Tout son contenu peut être envoyé au navigateur. |
| `server.js` | Origines des services, paramètres de connexion et adaptateurs côté serveur. |

Ajouter un logo dans `assets/`, renseigner les origines CAS/uPortal et n’activer que les intégrations configurées, puis lancer :

```sh
UNIVERSITY=univ-mon-campus npm run dev
```

Les services optionnels ont leurs propres paramètres. Les notes distinguent notamment trois états : `true` pour l’intégration active, `false` pour la masquer et `'disabled'` pour afficher son indisponibilité. L’ajout d’une configuration cliente nécessite ensuite de reconstruire le frontend.

Le guide [`docs/ADDING_A_UNIVERSITY.md`](docs/ADDING_A_UNIVERSITY.md) détaille les champs, les intégrations et la personnalisation.

## Contribuer

Les contributions peuvent porter sur les intégrations universitaires, les fonctionnalités, l’interface, l’accessibilité, les tests ou la documentation. Pour un problème d’intégration, préciser l’université, le service concerné et les étapes de reproduction, sans publier d’identifiants, de cookies, de relevés ni d’autres données étudiantes.

Avant de proposer une modification :

```sh
npm run lint
npm test
npm run build
```

Une contribution qui modifie un adaptateur ou un calcul doit inclure une vérification adaptée, avec des données fictives ou anonymisées. La démonstration facilite les essais d’interface, mais une validation avec le service réel reste nécessaire pour confirmer une nouvelle intégration.

La [CI](.github/workflows/ci.yml) exécute lint, tests et build. Les pull requests déclenchent aussi une construction Docker sans publication. Après vérification, les pushes sur `main` publient une release et une image pour `linux/amd64` et `linux/arm64`, sauf si le message du commit de tête contient `[skip release]`. La version est calculée à partir des messages de commits conventionnels.

## Équipe et licence

Tafac est porté par [Tom](https://github.com/tom-things) et [Lucas Lavajo](https://github.com/tryon-dev), avec les [contributeurs du projet](https://github.com/l-ent-univ/tafac/graphs/contributors).

Le projet fait partie de l’écosystème [Papillon](https://papillon.bzh).

Le code est distribué sous **GNU AGPL-3.0-only** ; le texte complet est disponible dans [`LICENSE`](LICENSE). Les ressources tierces, notamment les polices et les photographies, conservent leurs licences et attributions respectives.
