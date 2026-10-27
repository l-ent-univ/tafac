# Ajouter votre université

> Tafac s'appelait auparavant l'ent : certains identifiants techniques (`%LENT_*%`, `l-ent:*`) gardent l'ancien nom.

Tafac est conçu pour être forké : toute la configuration propre à une université vit dans un seul dossier, `universities/<id>/`. Le reste du code (frontend React, backend Express) est générique.

Trois exemples sont fournis :

- **`universities/univ-rennes/`** — l'implémentation de référence, complète (CAS + ADE + Planning GWT + Moodle + établissements + icônes de services).
- **`universities/example-minimal/`** — le strict minimum (ENT uPortal + CAS). Bon point de départ : copiez-le, renommez-le, remplissez vos valeurs.
- **`universities/univ-exemple/`** — université fictive de démonstration : origins factices, mais compte démo (`demo@tafac.fr` / `tafac-demo`) et widgets activés. Sert à tester le flux d'ajout et le choix d'université de bout en bout (listée en dev seulement, `/exemple` partout).

## Démarrage rapide

```bash
cp -r universities/example-minimal universities/univ-exemple
# éditez universities/univ-exemple/{shared,client,server}.js (id, origins, branding)
npm run dev                              # toutes les universités : choisissez la vôtre, ou /<slug>
UNIVERSITY=univ-exemple npm run dev      # la vôtre seule, sans liste
npm run build                            # un seul build pour toutes les universités
UNIVERSITY=univ-exemple npm start        # production, votre université seule
```

Le build est le même pour toutes les universités : `UNIVERSITY` ne compte qu'à l'exécution. La page charge au démarrage le `client.js` de son université (un fichier par université, téléchargé à la demande).

### Sur l'instance commune (toutes les universités)

Avec `MULTI_UNIVERSITY=1` (ou sans `UNIVERSITY`), toutes les universités du dossier `universities/` (sauf `example-*`, ou la liste `UNIVERSITIES`) sont servies sur la même adresse. Votre université apparaît dans la liste de la page de connexion avec son nom et son logo, et a sa page `/<slug>` (sa landing, dont le bouton mène à sa connexion). Dans `shared.js` :

```js
export const university = {
  name: 'Université de Rennes',   // nom dans la liste
  shortName: 'Rennes',
  slug: 'rennes',                 // tafac.fr/rennes (défaut : l'id sans « univ- »)
  devOnly: true,                  // optionnel : listée seulement en dev, /<slug> marche partout
}
```

Le logo de la liste est `assets/logo.svg` (ou `.png`, `.webp`, `.jpg`), servi par `/__ent_auth/universities/<id>/logo`.

Les anciennes adresses par université restent routées vers elle : le sous-domaine `<id-sans-tirets>.<domaine>`, ou les noms exportés dans `shared.js` :

```js
export const hostnames = ['rennes.tafac.example', 'ent-rennes.example.fr']
```

## Les trois fichiers d'une université

| Fichier | Chargé par | Contenu |
| --- | --- | --- |
| `shared.js` | Node **et** navigateur | Données pures partagées : id, origins publics, flags de features, textes de branding. **Aucun import d'asset** (le serveur Node doit pouvoir l'importer). |
| `client.js` | Navigateur uniquement (chargé au démarrage de la page, lu via `@university`) | Config complète côté client : branding + logo, liens d'aide, catégories/icônes de services, établissements. Peut importer des images. |
| `server.js` | Node uniquement | Origins internes (CAS, ADE, Moodle, Planning), paramètres du flux d'auth, clés ADE rétro-ingéniérées. **Jamais envoyé au navigateur.** |

## Champs de configuration

### Obligatoires

- `id` — identifiant du dossier (kebab-case).
- `origins.ent` — origine du portail ENT (uPortal). Le proxy local ne relaie que cet hôte.
- `origins.cas` (serveur + client) — origine du SSO CAS. Le flux de connexion implémenté est **CAS 2.0 avec formulaire** (scraping des champs `execution`/`_eventId`), le standard Jasig/Apereo utilisé par la plupart des universités françaises.
- `origins.moodle` (optionnel, `client.js`) — origine Moodle, pour le lien « Moodle » de la sidebar et de la barre d'onglets mobile (`/my/`, via `/__ent_auth/launch`). Requiert `features.moodle`. Le lien « Messagerie » n'a besoin que de `features.mail`.
- `auth.portalEntryPath` — page d'atterrissage uPortal (souvent `/f/services/normal/render.uP`). Sert de point d'entrée de connexion, de `Referer` par défaut et de preuve d'authentification. Le serveur rejoue cette entrée avec le seul cookie CAS `TGC` (conservé chiffré dans le cookie de session) pour rétablir la session ENT en silence quand elle a expiré.
- `auth.casLogoutPath` (optionnel, défaut `/logout`) — chemin de déconnexion du CAS Apereo, appelé à la déconnexion pour clore la session SSO côté université.
- `branding` — `appName`, `defaultTitle`, `seoTitle`, `seoDescription`, `logo` (+ `logoAlt`, `loginFooterLine`, `loginPasswordNote` (ligne sous le formulaire de connexion sur le mot de passe), `alternateNames` (anciens noms, pour les moteurs de recherche), `about.*`, `papillon` (`{ url }` : les mentions « Fait partie de Papillon » de la landing, de la connexion et d'À propos ; à omettre si l'instance n'est pas faite par l'équipe de Papillon)). `nameInText` : le nom de l'université au milieu d'une phrase (« l’Université de Rennes »), repris par la landing de `tafac.fr/<slug>` (`{university}` dans `src/landingCopy.json`) ; sans lui, « votre université ». La description doit dire que le client n'est pas officiel. Sur un serveur qui sert toutes les universités, `/<slug>` est la landing de l'université (déconnecté), avec son `seoTitle` et sa `seoDescription`, et figure dans le sitemap : c'est elle qui ressort quand on cherche l'ENT de cette université. Utilisé par la page de connexion, la sidebar, le SEO, le manifest PWA et `index.html` (placeholders `%LENT_*%`).
  - `lockup` / `lockupDark` (optionnels, `client.js` uniquement) — visuel combiné « Tafac × université » affiché dans la sidebar et le header (comme Rennes). Sans eux, le logo Tafac et votre `logo` sont composés côte à côte automatiquement.
  - `heroImages` (optionnel, `client.js` uniquement) — photos affichées en fond du haut du tableau de bord, en fondu vers le fond uni : `[{ src, credit: { author, license, url }, position? }]`. Plusieurs photos tournent chaque jour. Chaque établissement peut définir ses propres `heroImages` dans `establishments.byId`. Sans photo, un placeholder générique est affiché. Le crédit apparaît dans le footer : utilisez des images libres de droits (ex. Wikimedia Commons) et renseignez auteur + licence.
- `features` — l'interrupteur général (voir ci-dessous).

### Features (dégradation gracieuse)

```js
export const features = {
  ade: false,        // API mobile ADE Campus (widget "prochain cours", arbres, emplois du temps)
  planning: false,   // Planning GWT (adesoft) — lien "Planning" + résolution du prochain cours
  moodle: false,     // relais de connexion Moodle via Shibboleth WAYF
  grades: false,     // notes ScoDoc — true | false | 'disabled' (pastille visible, données démo)
  mail: false,       // widget « Mails récents » (lecture de la boîte de réception via le webmail)
  moodleDeadlines: false, // widget « Échéances Moodle » (devoirs/tests à rendre) — distinct de `moodle`
  sidebarLatestGrade: false, // « Dernière note » en bas de la barre latérale, qui ouvre « Mes notes » sur cette note (requiert `grades`)
  weather: { enabled: true, defaultCity: 'Paris' },
  serviceCategories: false, // filtres par catégorie au-dessus de la grille d'applications (voir services.categories)
  demo: true,        // compte de démonstration (demo@tafac.fr)
}
```

Un feature à `false` : le serveur répond `{ disabled: true }` sur les endpoints concernés et le frontend masque les widgets/liens. Mettez aussi l'origin correspondant à `null` dans `server.js`.

### Optionnels

- `links` — `forgotPassword`, `activateAccount`, `manageAccount`. Absent → lien masqué.
- `establishments` — détection de la composante (IUT, UFR…) depuis l'arbre ADE et gating par composante :
  ```js
  establishments: {
    detectFromAdeTree: [{ includes: ['iut lannion'], id: 'iutlan' }],
    fallbackId: 'other',
    byId: {
      iutlan: {
        label: 'IUT de Lannion',
        gradeWidgets: true,       // widgets de notes
        nextClassWidget: true,    // widget prochain cours
        extraServices: [{ id: '…', title: '…', href: '…', target: '_blank' }],
        logo: iutLannionLogo,     // optionnel, à la place du logo de l'université
        logoDark: iutLannionLogoDark,
        logoShape: 'square',
      },
    },
  }
  ```
  Omettez le bloc entier si votre université n'a qu'un seul « établissement ».

  **Logo d'un établissement** (optionnel, `client.js` uniquement) — une composante sur son propre site (un IUT délocalisé, une antenne) peut avoir son logo : il remplace celui de l'université à côté du logo Tafac, dans la sidebar et le header, pour les étudiants détectés dans cet établissement. Un établissement sans `logo` garde celui de l'université, de même que les étudiants sans établissement détecté (`fallbackId`). Avec un `lockup`, l'établissement qui a un logo passe à la composition automatique « Tafac + logo ».
  - `logo` — l'image (import d'un fichier dans `assets/`, par exemple `assets/establishments/<id>.svg`).
  - `logoDark` (optionnel) — sa version pour le mode sombre. Sans elle, le logo est inversé en mode sombre : bien pour un logo d'une couleur, pas pour un logo en couleurs.
  - `logoAlt` (optionnel) — son texte alternatif ; par défaut, le `label` de l'établissement.
  - `logoShape` (optionnel) — `'wide'` (par défaut, un logo en longueur) ou `'square'` (un logo carré ou presque, affiché plus haut pour se lire comme un logo en longueur).

  Les mêmes `logoDark` et `logoShape` s'appliquent au `logo` de `branding`.

  Chaque étudiant peut masquer ce logo, ou afficher celui de l'université à la place de celui de sa composante, dans Réglages › Apparence › Logo.
- `services.getAppIcon(title)` — retourne une icône faite main pour une application ENT à partir de son titre (voir `universities/univ-rennes/app-icons/`). Retournez `null` pour laisser l'icône automatique (voir [Icônes des applications](#icônes-des-applications)).
- `services.categories` — mots-clés → catégories de la grille d'applications.
- `services.titleOverrides` — (optionnel) renomme des applications ENT : `{ 'titre ent en minuscules': 'Titre affiché' }`.
- `services.isUnavailableApplication(app)` — masque complètement certaines applications.
- `grades.serviceUrl` (client) — URL publique du service de notes (ScoDoc), ouverte via `/__ent_auth/launch` depuis les widgets et le lien « Mes notes » quand `features.grades === true`.
- `mailWebmailUrl` (shared) — URL publique du webmail (« Messagerie »), réutilisée par `mail.webmailUrl` côté serveur ; le widget l'ouvre via `/__ent_auth/launch`.
- `grades` (copy) — `unavailableTitle`, `unavailableDetail`, `disabledPillLabel` quand `features.grades === 'disabled'` ; `unavailableTitle`/`unavailableDetail` servent aussi de message d'erreur serveur quand ScoDoc ne répond pas.

### Serveur uniquement (`server.js`)

- `origins.ade` / `origins.moodle` / `origins.planning` — `null` si absent.
- `moodle.shibbolethLoginPath` + `moodle.wayfEntityId` — l'entityID Shibboleth de votre université sur la page WAYF de la fédération (visible dans l'URL `user_idp=` lors d'une connexion Moodle manuelle).
- `moodle.signInDomains` — requis quand `features.moodleDeadlines === true` (endpoint `GET /__ent_auth/moodle/deadlines`, contrat dans `src/entApi.js#getMoodleDeadlines`) : domaines que la connexion SSO Moodle côté serveur peut visiter (HTTPS uniquement) en plus de `origins.moodle` et du CAS, typiquement le WAYF et l'IdP Shibboleth (Rennes : `['wayf.univ-rennes.fr', 'ident-shib.univ-rennes1.fr']`). Le serveur rejoue la chaîne du relais Moodle (Shibboleth → WAYF → IdP → CAS → POST SAML) avec une copie du cookie jar de session, récupère le `sesskey` sur `/my/`, puis appelle `lib/ajax/service.php` : `core_calendar_get_action_events_by_timesort` (à faire, retards ≤ 7 jours inclus) et `core_calendar_get_calendar_upcoming_view` (devoirs/tests déjà rendus, et liste de repli). 6 échéances max sur 30 jours, cache 5 min par session ; les liens passent par `/__ent_auth/launch`. Requiert aussi `features.moodle` (relais) pour les liens. Le compte démo renvoie des échéances fictives.
- `ade.etab`, `ade.passwordKey`, `ade.passwordIv`, `ade.appHeaders` — identité de l'app mobile « Campus » de votre université. **Ces valeurs se rétro-ingénient par campus** (interception du trafic de l'app mobile officielle) ; voir `API_GUIDE.md` et `src/knownEndpoints.js` pour la méthodologie utilisée à Rennes.
- `planning.gwtClientId` — identifiant client GWT du Planning adesoft (visible dans les requêtes RPC de `myplanning.jsp`).
- `grades.origin` — origine du ScoDoc (ex. `https://notes9.iutlan.univ-rennes1.fr`). Le serveur y rejoue la session CAS (`/services/doAuth.php`) puis lit `data.php?q=dataPremièreConnexion` et la photo étudiante. Requis quand `features.grades === true`.
  Pour l'histogramme d'une évaluation, `GET /__ent_auth/grades/evaluation-distribution?semestre=<id|current>&eval=<id>` relaie `data.php?q=listeNotes&eval=<id>` (notes de la promo ramenées sur 20, anonymes) uniquement pour une évaluation du relevé de l'étudiant, et répond `{ status: 'ok', counts: [21 effectifs, barre i = notes dans [i, i+1[, 20/20 dans la barre 20], total, bins: 'integer' }` ou `{ status: 'unavailable', reason: 'disabled' | 'too-few' | 'hidden' }` (`disabled` : option `histogramme` de la passerelle désactivée ; `too-few` : moins de 6 notes, la passerelle répond `['too low']` ; `hidden` : relevé non publié ou notes masquées par le département). Cache 10 min par session ; contrat client dans `src/entApi.js#getEvaluationDistribution`, binning dans `src/evaluationDistribution.js`.
- `mail` — requis quand `features.mail === true` (endpoint `GET /__ent_auth/mail/recent`, contrat dans `src/entApi.js#getRecentMail`) :
  ```js
  mail: {
    provider: 'zimbra',                         // seul fournisseur implémenté (Zimbra / RENATER Partage)
    origin: 'https://partage.univ-rennes.fr',   // origine du webmail
    webmailUrl: mailWebmailUrl,                 // page d'entrée du webmail (défaut : origin)
    maxMessages: 5,                             // 1–20
    signInDomains: ['partage.renater.fr'],        // domaines autorisés pendant la connexion SSO (HTTPS uniquement), en plus du webmail et du CAS
  }
  ```
  Le serveur parcourt la chaîne SSO du webmail (Shibboleth → CAS) avec une copie du cookie jar de session, puis lit la boîte via l'API Zimbra (SOAP `SearchRequest`/`GetFolderRequest`, repli REST `/service/home/~/inbox?fmt=json`). Résultat mis en cache 2 min par session. Le compte démo renvoie des mails fictifs. Pour un autre webmail (SOGo, Roundcube, Exchange…), ajoutez une fonction dans `MAIL_PROVIDERS` (`server/entAuthApp.js`) qui renvoie `{ unreadCount, webmailHref, messages }` ; un `provider` inconnu répond `500 { error: 'Mail provider not configured' }`.
- `launch.allowedDomains` (optionnel) — domaines que le relais `/__ent_auth/launch` peut ouvrir avec la session, sous-domaines compris (Rennes : `['univ-rennes.fr', 'univ-rennes1.fr', 'iut-lannion.loxya.app']`). Les hôtes des origines et URLs de service de la config (ENT, CAS, ADE, Moodle, planning, notes, webmail, certificat) et les `signInDomains` sont déjà autorisés. Toute autre cible est renvoyée vers `/` par le relais et ouverte directement par le navigateur (`launch-preview` répond `useServerLaunch: false`, `reason: 'target-not-allowed'`). Ajoutez ici les domaines des applications de l'ENT protégées par le CAS de l'université, et ceux de vos `extraServices` (`client.js`).

## Icônes des applications

Chaque tuile d'application (grille « Toutes les applications », favoris, favoris de la sidebar) reçoit une icône et une couleur **automatiquement**, sans rien configurer :

1. **Icône faite main** si `services.getAppIcon(title)` en renvoie une (Rennes : `universities/univ-rennes/app-icons/`). Elle a toujours la priorité.
2. Sinon, **icône automatique** choisie par le serveur (`server/appIcons.js`) : un *concept* (`mail`, `calendar`, `course`, `library`, `wifi`, `printing`, `visio`, `office`, `help`, `restaurant`, `sport`, `jobs`, `card`, `payment`…, 59 au total) d'après des mots-clés français et anglais du titre (puis de la description, puis de la catégorie), et une *teinte*, tirée du hash de l'id du service en évitant les teintes déjà les plus utilisées. Sans mot-clé reconnu : concept `generic`.
3. Pendant le chargement ou en cas d'échec : la lettre sur fond coloré, à la même taille.

Le premier choix pour un service est **mémorisé pour toute l'université** dans `<DATA_DIR>/app-icons/<id>.json` (voir [SELF_HOSTING.md](SELF_HOSTING.md#icônes-automatiques-des-applications)) : tous les étudiants voient la même tuile, et modifier la liste de mots-clés ne change pas les tuiles existantes, seulement celles des services jamais vus. Un service ajouté au portail a donc tout de suite une tuile correcte.

### Style des icônes et couleurs (`server.js` → `appIcons`)

Le concept et la teinte sont dessinés selon le style de chaque université :

```js
appIcons: {
  style: 'carbon',      // 'carbon' (défaut, comme le reste de l'UI), 'phosphor', 'phosphor-fill', 'phosphor-duotone', 'tabler'
  colorMode: 'pastel',  // 'pastel' (défaut : tuile vive, pictogramme foncé), 'soft' (teinte légère), 'vivid' (tuile saturée, pictogramme blanc), 'mono' (sans couleur)
  icons: { mail: 'mdi:email-outline' }, // optionnel : remplace l'icône d'un concept par n'importe quelle icône Iconify
}
```

Chaque mode de couleur a sa variante sombre. Le fichier ne garde que le concept et la teinte : changer de style ou de mode redessine toutes les tuiles sans rien remélanger. Une valeur inconnue empêche le serveur de démarrer (comme un id d'université inconnu). Exemples : Rennes en `carbon` + `pastel`, l'université de démo en `phosphor-duotone` + `soft`.

Pour améliorer les choix, ajoutez des mots-clés dans `APP_ICON_RULES` (`server/appIcons.js`, test dans `tests/appIcons.test.js`) ; un nouveau concept doit avoir une icône dans chaque style (`ICONS_BY_CONCEPT`). Pour corriger une tuile déjà attribuée, éditez le fichier JSON (voir SELF_HOSTING) ou ajoutez une icône faite main.

## Checklist de validation

1. `npm run lint && npm test && npm run build` — tout doit passer.
2. `npm run dev`, puis `/<slug>` et son bouton « Se connecter à mon ENT » — page de connexion : logo, textes, liens d'aide corrects ; votre université figure dans la liste de `/universites`.
3. Connexion démo (`demo@tafac.fr` / `tafac-demo`) si `features.demo` — dashboard, grille d'applications.
4. **Connexion réelle** avec un compte étudiant — c'est le seul test qui exerce CAS, le proxy ENT et les services activés.
5. `grep -ri '<votre-univ>' src/ server/` ne doit rien retourner : tout doit vivre dans `universities/<id>/`.

## Ce qui n'est pas couvert

Le backend suppose un ENT **uPortal** derrière un **CAS Apereo**. Si votre université utilise un autre portail (ex : Esup-Pod seul, ENT non-uPortal) ou un autre SSO (OIDC, SAML direct), il faudra adapter `server/entAuthApp.js` (fonction `performEntLogin` et endpoints `/__ent_auth/*`). Les contributions généralisant ces points sont bienvenues.
