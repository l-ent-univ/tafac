# Auto-héberger Tafac avec Docker

> Tafac s'appelait auparavant l'ent. L'image Docker garde l'ancien nom (`ghcr.io/l-ent-univ/l-ent`) pour que les installations existantes continuent de recevoir les mises à jour.

Chaque merge sur `main` publie une release GitHub et une image Docker multi-architecture (amd64 et arm64) :

```
ghcr.io/l-ent-univ/l-ent:latest     # dernière version
ghcr.io/l-ent-univ/l-ent:0.4.1      # version précise
ghcr.io/l-ent-univ/l-ent:0.4        # dernière 0.4.x
```

L'image contient le serveur Express et le frontend de chaque université (mode multi-tenant, `MULTI_TENANT=1`). Elle écoute sur le port 3000 et tourne avec un utilisateur non root. Elle n'écrit sur le disque que dans `/app/data` (icônes automatiques des applications, voir plus bas), monté en volume par `docker-compose.yml`.

## Prérequis

- Un serveur avec Docker et Docker Compose.
- Un nom de domaine dont l'enregistrement A/AAAA pointe vers ce serveur.
- Les ports 80 et 443 ouverts : **HTTPS est obligatoire** (cookie de session `Secure`, PWA, service worker).

## Installation

1. Copier le dossier [`deploy/`](../deploy) sur le serveur.
2. Créer `.env` à partir de `deploy/example.env` et y mettre un secret de session :
   ```sh
   cp example.env .env
   echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env
   ```
   Le serveur refuse de démarrer sans ce secret. Gardez-le : le changer déconnecte tout le monde.
3. Remplacer `tafac.example.fr` par votre domaine dans `Caddyfile`. Caddy obtient et renouvelle le certificat TLS tout seul.
4. Lancer :
   ```sh
   docker compose up -d
   docker compose logs -f lent
   ```

Derrière un autre reverse proxy (nginx, Traefik…), il suffit de transmettre `X-Forwarded-Proto` et `X-Forwarded-Host` au conteneur.

## Mettre à jour

```sh
docker compose pull && docker compose up -d
```

Pour figer une version, remplacer `latest` par un numéro (`ghcr.io/l-ent-univ/l-ent:0.4.1`) dans `docker-compose.yml`. Les notes de chaque version sont sur la page [Releases](https://github.com/l-ent-univ/tafac/releases).

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `SESSION_SECRET` | Secret de session (au moins 32 octets) | **obligatoire** |
| `UNIVERSITY` | Université servie quand le nom d'hôte ne correspond à aucune | `univ-rennes` |
| `TENANTS` | Universités servies (ids séparés par des virgules) | toutes |
| `POSTHOG_PROJECT_KEY` | Mesure d'audience anonyme ([ANALYTICS.md](ANALYTICS.md)) | désactivée |
| `PORT` | Port interne du conteneur | `3000` |
| `DATA_DIR` | Dossier des icônes automatiques des applications et des rappels de bus | `/app/data` dans l'image, `./data` sinon |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Clés des notifications push des rappels de bus | une paire créée au premier lancement dans `$DATA_DIR/transit-push/vapid.json` |
| `VAPID_SUBJECT` | Contact donné aux services push (`mailto:` ou `https:`) | l'URL du dépôt |
| `TRUST_PROXY` | Proxys dont l'en-tête `X-Forwarded-For` donne l'IP de l'étudiant (valeur `trust proxy` d'Express) | adresses locales et privées (Caddy, réseau Docker) |

## Icônes automatiques des applications

Le serveur donne à chaque application du portail une icône et une couleur (voir [ADDING_A_UNIVERSITY.md](ADDING_A_UNIVERSITY.md#icônes-des-applications)) et mémorise ce choix pour que tous les étudiants d'une université voient la même tuile, d'un jour à l'autre. Avec les [rappels de bus](#rappels-de-bus), c'est la seule donnée que le serveur écrit :

- un fichier JSON par université : `$DATA_DIR/app-icons/<université>.json` (dans le conteneur : `/app/data/app-icons/univ-rennes.json`…), sur le volume `lent_data` ;
- par service : son identifiant de portail, le concept d'icône, la teinte, le titre et la date du premier passage. **Aucune donnée d'étudiant** : ce sont les mêmes services pour tout le monde ;
- écriture atomique (fichier temporaire puis renommage), 500 services au plus par université. Une session démo n'y écrit que les services de démonstration.

Sans volume, ou si le dossier n'est pas accessible en écriture, tout continue de fonctionner : les icônes sont choisies en mémoire (de façon déterministe) et un avertissement `[app-icons]` apparaît dans les logs ; elles ne sont simplement pas gardées d'un redémarrage à l'autre.

**Corriger ou réinitialiser** (le fichier est relu dès qu'il change, sans redémarrage) :

```sh
docker compose exec lent cat /app/data/app-icons/univ-rennes.json
docker compose exec lent vi /app/data/app-icons/univ-rennes.json   # ou docker cp aller-retour
```

```json
"moodle-foad": { "icon": "course", "color": "blue", "title": "Moodle - FOAD", "assignedAt": "2026-10-12" }
```

- **Changer une tuile** : remplacer `icon` par un autre concept (`library`, `sport`… : liste dans `server/appIcons.js`, dessiné dans le style de l'université) ou par un nom Iconify précis (`ph:basketball`, utilisé tel quel), et/ou `color` par une teinte (`red`, `orange`, `yellow`, `lime`, `green`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `fuchsia`, `pink`). Une entrée invalide est ignorée et choisie à nouveau.
- Le style d'icônes et le mode de couleur se règlent par université dans le code (`appIcons` dans `universities/<id>/server.js`, voir [ADDING_A_UNIVERSITY.md](ADDING_A_UNIVERSITY.md#style-des-icônes-et-couleurs-serverjs--appicons)).
- **Refaire le choix d'un service** : supprimer son entrée. **Tout réinitialiser** : supprimer le fichier.
- Un fichier JSON illisible n'est jamais écrasé : le serveur passe en mémoire seule jusqu'à ce qu'il soit réparé.
- Les icônes faites main (`services.getAppIcon`, dans le code de l'université) restent prioritaires.

## Rappels de bus

La page « Bus » (`features.transit` et le bloc `transit` de l'université : GTFS, GTFS-RT, campus) peut envoyer des notifications push : bus du matin, bus retour, retard en temps réel, dernier bus parti avant la fin des cours. Le téléphone calcule lui-même ses bus et confie au serveur, pour les 7 jours à venir, seulement « à telle heure, tel bus, à tel arrêt » :

- un fichier par université : `$DATA_DIR/transit-push/<université>.json`, sur le volume `lent_data` : l'abonnement push du navigateur et ses rappels. **Ni nom, ni identifiant ENT, ni emploi du temps** ;
- la paire de clés VAPID dans `$DATA_DIR/transit-push/vapid.json` (ou `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`). Changer de clés invalide les abonnements : les étudiants devront réactiver les rappels ;
- le serveur n'envoie qu'aux services push des navigateurs (Google, Mozilla, Apple, Microsoft), jamais à une autre adresse ; un abonnement révoqué (404/410) est effacé, un rappel passé aussi.

Sur iPhone, les notifications ne marchent que dans l'app ajoutée à l'écran d'accueil (iOS 16.4 et plus).

## Changer de domaine

Une PWA installée est liée à son domaine : déménager Tafac vers un nouveau domaine oblige les utilisateurs à réinstaller l'app et leur fait perdre leurs réglages locaux. Prévoir une période de transition où l'ancien domaine reste en ligne.

## Publication (mainteneurs)

Le workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) :

- sur chaque pull request : lint, tests, build de toutes les universités et build Docker (sans publication) ;
- sur chaque push sur `main` : la même vérification, puis une release `vX.Y.Z` avec des notes générées depuis les PR, puis l'image Docker.

Le numéro de version suit les messages de commit depuis la dernière release : `feat` incrémente la mineure, `type!:` ou `BREAKING CHANGE` la majeure (la mineure tant qu'on est en 0.x), le reste le correctif. Mettre `[skip release]` dans le message du commit de tête pour ne rien publier.

Après la toute première publication, rendre le paquet public : organisation GitHub → **Packages** → `l-ent` → **Package settings** → **Change visibility** → Public. Sinon il faut un `docker login ghcr.io` pour le télécharger.
