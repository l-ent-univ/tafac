![Tafac](src/assets/lent-logo.svg)

> **l'ent s'appelle désormais Tafac.** Même app, même équipe, nouveau nom : l'instance officielle est sur **[tafac.fr](https://tafac.fr)**.  
> Certains identifiants techniques gardent l'ancien nom (image Docker `ghcr.io/l-ent-univ/l-ent`, clés `l-ent:*` du `localStorage`, cookie `__Host-lent_session`) : c'est voulu, les renommer déconnecterait les utilisateurs et effacerait leurs réglages.

Interface alternative pour les portails ENT des universités françaises.  
Regroupe notes, emploi du temps et services dans une seule page.

Université supportée : **Université de Rennes**. Le projet est conçu pour être modulaire et accepter facilement de nouvelles universités et écoles : toute la partie spécifique à une université tient dans un seul dossier de configuration. **[Ajoutez la vôtre →](#-ajoutez-votre-université)**

> Client non officiel, indépendant et non affilié aux universités concernées.  
> La majorité du backend a été développée avec l'aide d'outils d'IA. S'attendre à un code peu optimisé !

---

## Contexte

Les portails ENT (uPortal + CAS, le standard des universités françaises) exposent les données étudiantes (notes, planning, services) à travers plusieurs interfaces séparées et datées. Tafac les agrège dans un dashboard unique, utilisable sur mobile comme sur desktop.

## 🎓 Ajoutez votre université

Si votre université utilise un ENT uPortal derrière un CAS (probablement le cas), l'ajouter ne demande **aucune modification du code**; uniquement un dossier de configuration :

```bash
cp -r universities/example-minimal universities/univ-lavotre
# remplissez universities/univ-lavotre/{shared,client,server}.js
# (nom, logo, URL de l'ENT et du CAS le reste est optionnel)
npm run dev    # toutes les universités, votre dossier inclus
UNIVERSITY=univ-lavotre npm run dev    # ou la vôtre seule
```

- Chaque feature (ADE, planning, Moodle, notes…) est **optionnelle** : ce que votre université n'a pas est proprement masqué.
- `universities/univ-rennes/` sert d'implémentation de référence complète, `universities/univ-exemple/` de démo jouable (compte `demo@tafac.fr` / `tafac-demo`).
- Une fois testée avec un vrai compte étudiant, **ouvrez une Pull Request** : votre université rejoint l'instance officielle (tafac.fr, choix de l'université à la connexion, lien direct `tafac.fr/<slug>`), ou déployez votre fork vous-même pour elle seule.

Guide pas-à-pas : **[docs/ADDING_A_UNIVERSITY.md](docs/ADDING_A_UNIVERSITY.md)**

## Fonctionnalités

- Affichage temporairement désactivé de la moyenne générale, moyenne de promo et dernière note
- Prochain cours et planning via ADE Campus et Planning GWT
- Accès aux 30+ applications universitaires avec recherche et favoris
- Météo locale (Open-Meteo)
- Mode clair / sombre
- PWA installable (iOS, Android)
- Onboarding pour sélectionner année, groupe TD et TP

> Attention : Le projet a uniquement été testé pour le BUT MMI à Lannion et peut ne pas fonctionner correctement pour les autres formations de l'Université de Rennes

## Stack


| Couche   | Technologies                     |
| -------- | -------------------------------- |
| Frontend | React 19, Tailwind CSS 4, Vite 7 |
| Backend  | Node.js, Express 5               |
| PWA      | vite-plugin-pwa, Service Worker  |


## Installation

Prérequis : Node.js 18+, npm.

```bash
git clone https://github.com/l-ent-univ/tafac.git
cd tafac
npm install
npm run dev
```

### Production

```bash
npm run build
npm run start
```

Le serveur Express écoute sur le port `3000` (configurable via `PORT`).

### Variables d'environnement


| Variable         | Description                                                        | Requis           |
| ---------------- | ------------------------------------------------------------------ | ---------------- |
| `PORT`           | Port du serveur (défaut : 3000)                                    | Non              |
| `SESSION_SECRET` | Secret dont dérive la clé de chiffrement du cookie de session (≥ 32 octets, voir [Sécurité](#sécurité--confidentialité)) | Oui (production) |
| `SESSION_SECRET_PREVIOUS` | Ancien(s) secret(s), séparés par des virgules, encore acceptés en lecture pendant une rotation | Non |
| `UNIVERSITY`     | Seule université servie ; avec `MULTI_UNIVERSITY=1`, université par défaut (défaut : `univ-rennes`) | Non |
| `MULTI_UNIVERSITY` | `1` : toutes les universités (choix à la connexion), `0` : `UNIVERSITY` seule. Absent : toutes si `UNIVERSITY` n'est pas définie. Ancien nom : `MULTI_TENANT` | Non |
| `UNIVERSITIES`   | Universités servies (ids séparés par `,`, défaut : toutes sauf `example-*`). Ancien nom : `TENANTS` | Non |
| `POSTHOG_PROJECT_KEY` | Clé PostHog : active la mesure d'audience anonyme côté serveur (absente = désactivée) | Non |
| `POSTHOG_HOST`   | Hôte PostHog (défaut : `https://eu.i.posthog.com`, UE)              | Non              |
| `ANALYTICS_EXCLUDED_USERS` | Identifiants ENT dont les événements ne sont jamais envoyés (séparés par `,`), par exemple les développeurs de l'instance | Non |
| `POSTHOG_IN_DEV` | `1` pour que `npm run dev` envoie aussi à PostHog (coupé sinon) | Non |
| `DATA_DIR`       | Dossier où le serveur mémorise les icônes automatiques des applications (défaut : `./data`, voir [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md#icônes-automatiques-des-applications)) | Non |

## Toutes les universités sur une adresse

Un seul build et un seul serveur servent toutes les universités sur la même adresse (tafac.fr) :

```bash
npm run build                     # un seul dist/ pour toutes les universités
MULTI_UNIVERSITY=1 npm start      # ou sans UNIVERSITY
```

- **Avant la connexion**, la page est neutre (Tafac, sans université) et propose la liste des universités. Chacune a son lien direct, `/<slug>` (`tafac.fr/rennes`), qui ouvre son formulaire. Le choix est gardé dans le navigateur (`l-ent:university`) ; « Changer d'université » ramène à la liste.
- **Une fois connecté**, l'université est celle de la session : son id est dans le cookie de session chiffré, et le serveur n'envoie les requêtes qu'aux services de cette université. Changer d'université, c'est se déconnecter.
- La page charge au démarrage la config de son université (`universities/<id>/client.js`, un fichier par université, téléchargé à la demande) : `GET /__ent_auth/universities` lui dit lesquelles existent et à laquelle elle est connectée.
- Les anciennes adresses par université restent routées : premier label du nom d'hôte égal à l'id sans tirets (`univrennes.…`) ou nom listé dans l'export `hostnames` de `shared.js`. Les sessions ouvertes avant ce changement (sans université dans le cookie) appartiennent à l'université de leur adresse, Rennes sur le domaine racine.
- Les réglages propres à une université (établissement, TP, favoris…) sont mis de côté quand le navigateur passe à une autre, puis remis en revenant (`src/universityStorage.js`).

**Une seule université** (instance auto-hébergée) : `UNIVERSITY=<id>` sans `MULTI_UNIVERSITY` (ou `MULTI_UNIVERSITY=0`). Pas de liste, sa config au démarrage, ses textes SEO : comme avant.

Sur Render (plan gratuit) : build command `npm install && npm run build`, start command `MULTI_UNIVERSITY=1 node server.js`.

Avec Docker (serveur perso, VPS…) : chaque merge sur `main` publie une image `ghcr.io/l-ent-univ/l-ent`, voir [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) (Docker Compose + Caddy pour le HTTPS).

## Sécurité & confidentialité

- Tafac ne maintient pas de base de données applicative dédiée pour stocker les comptes étudiants.
- Les données sont récupérées à la demande depuis les services de l'université configurée : CAS, ENT, ADE et Planning.
- Le mot de passe ne sert qu'à la requête de connexion au CAS : il n'est jamais conservé, ni côté navigateur, ni en mémoire serveur, ni dans le cookie. La session repose sur le ticket CAS (cookie `TGC`), qui ouvre ensuite ADE, Moodle, la messagerie ou ScoDoc sans mot de passe.
- Le cookie de session (`__Host-lent_session` : `Secure`, `HttpOnly`, `SameSite=Lax`) contient une copie **chiffrée** (AES-256-GCM, clé dérivée de `SESSION_SECRET`) des cookies universitaires, dont le `TGC`. Il permet de rester connecté (30 jours glissants, plafonnés à 30 jours depuis la connexion, et en pratique à la durée de vie du ticket CAS côté université) et de rétablir la session en silence après un redémarrage du serveur.
- La déconnexion ferme aussi la session CAS côté université (`/logout`), ce qui rend inutilisable toute copie du cookie.
- Les caches sensibles côté client sont vidés à la déconnexion et lors d'un échec de rafraîchissement de session.
- Le menu debug est réservé au mode développement et n'est pas exposé dans le build de production.
- Le point d'entrée de connexion est protégé par un rate limiting basique contre les tentatives répétées.
- Mesure d'audience anonyme optionnelle (désactivée sans `POSTHOG_PROJECT_KEY`) : sans cookie, envoyée depuis le serveur vers PostHog UE, identifiant quotidien non réversible, aucune note, aucun mail, aucun identifiant. Désactivable dans *Mon compte*. Détails et réglages PostHog obligatoires : **[docs/ANALYTICS.md](docs/ANALYTICS.md)**.
- Le projet vise une surface de stockage minimale, mais un déploiement sérieux nécessite tout de même HTTPS et une variable `SESSION_SECRET` forte en production.

### Auto-hébergement : secret de session

- `node server.js` refuse de démarrer sans `SESSION_SECRET`, ou si elle fait moins de 32 octets (le code ne contient aucune clé de secours : c'est un dépôt public). Générez-la avec `openssl rand -base64 32`.
- Le serveur de production exige HTTPS : le cookie porte le préfixe `__Host-` et l'attribut `Secure` (les navigateurs l'acceptent aussi sur `http://localhost`). En dev (`npm run dev`), sans `SESSION_SECRET` une clé aléatoire est tirée à chaque démarrage ; mettez-en une dans `.env.local` pour garder vos sessions entre deux redémarrages.
- **Rotation sans déconnecter personne** : placez l'ancienne valeur dans `SESSION_SECRET_PREVIOUS` (plusieurs valeurs possibles, séparées par des virgules), mettez la nouvelle dans `SESSION_SECRET`, redéployez. Les anciens cookies sont relus puis ré-émis avec la nouvelle clé ; retirez `SESSION_SECRET_PREVIOUS` quelques jours plus tard.
- **Kill switch** : changer `SESSION_SECRET` sans renseigner `SESSION_SECRET_PREVIOUS` invalide instantanément toutes les sessions (tout le monde doit se reconnecter).


## Architecture

```
tafac/
├── universities/          # ★ Une université = un dossier de config
│   ├── univ-rennes/       #   Référence complète (Rennes)
│   ├── univ-exemple/      #   Université fictive de démonstration
│   └── example-minimal/   #   Squelette minimal à copier
├── server.js              # Lanceur production (une ou toutes les universités)
├── server/
│   ├── universitiesApp.js # Aiguillage des requêtes vers l'université de la session
│   └── entAuthApp.js      # Backend d'une université, partagé prod/dev : auth CAS, proxy, API
├── adeApi.js              # Client ADE (emploi du temps)
├── planningRpc.js         # Client RPC planning (GWT)
├── adeUpcomingResolver.js # Résolution des prochains cours
├── src/
│   ├── App.jsx            # Composant racine, auth
│   ├── entApi.js          # Client API portail ENT
│   ├── weatherApi.js      # API météo
│   ├── profileStorage.js  # Préférences utilisateur
│   ├── components/
│   │   ├── WidgetContainer.jsx
│   │   ├── WidgetNextClass.jsx
│   │   ├── AvailableApplications.jsx
│   │   ├── OnboardingPage.jsx
│   │   └── ...
│   └── assets/
└── public/
```

La config d'une université est lue côté serveur (`universities/<id>/server.js`) et chargée côté frontend au démarrage de la page : l'alias Vite `@university` désigne `src/university.js`, rempli par `src/universityBoot.js` avec `universities/<id>/client.js` (ou la config neutre `universities/neutral.js` avant le choix) avant le chargement d'`App`. Aucun autre fichier ne contient de valeur propre à une université.

## Intégrations

Tafac communique avec les systèmes suivants :

- **CAS SSO** : authentification centralisée
- **Portail ENT** : layout, portlets, marketplace
- **ADE Campus** : emploi du temps (sessions chiffrées)
- **Planning** : planning détaillé via GWT RPC
- **Notes** : relevé ScoDoc (moyenne, dernière note, photo étudiante)
- **Open-Meteo** : météo (API libre)

## Nouveautés (changelog)

Les nouveautés visibles par les étudiants vivent dans [`src/changelog.js`](src/changelog.js). Quand un appareil a des entrées qu'il n'a pas encore vues, une petite pastille « Nouveautés » apparaît sur le tableau de bord ; elle disparaît dès que la liste est ouverte. La liste complète reste accessible dans Réglages › À propos.

Pour annoncer une nouveauté, ajoutez **un objet en tête de `CHANGELOG`** : `id` unique (jamais modifié ensuite), `date` (`AAAA-MM-JJ`), `title`, `body` (une ou deux phrases, en tutoyant, sans jargon) et, au besoin, une `icon` Iconify. Une entrée qui ne concerne pas tout le monde déclare `universities: ['univ-rennes']` et/ou `features: ['mail']` (toutes les fonctionnalités listées doivent être actives dans `universityConfig.features`) ; ailleurs, elle est invisible et n'allume pas la pastille. Le commentaire en tête du fichier détaille les règles.

La première visite d'un appareil marque silencieusement toutes les entrées existantes comme vues (clé `l-ent:changelog-seen`) : seules les nouveautés publiées ensuite allument la pastille.

## Contribution

1. Forkez le projet
2. Créez une branche (`git checkout -b feat/univ-lavotre` ou `feat/ma-fonctionnalite`)
3. Committez (`git commit -m 'feat: ajouter mon université'`)
4. Pushez (`git push origin feat/univ-lavotre`)
5. Ouvrez une Pull Request

## Licence

[GNU Affero General Public License v3.0](LICENSE)

Toute version modifiée déployée publiquement doit rendre son code source disponible.

## Crédits

Fait par [@tom-things](https://github.com/tom-things)