# Ajouter votre université

> Tafac s'appelait auparavant l'ent : certains identifiants techniques (`%LENT_*%`, `l-ent:*`) gardent l'ancien nom.

Tafac est conçu pour être forké : la configuration propre à une université vit dans `universities/<id>/` pour la page, et dans les réglages de [tonAPI](https://github.com/l-ent-univ/tonAPI) (`universities/<id>/university.toml`) pour le serveur. Le reste du code (la page React, la passerelle Rust de `back/`) est générique.

Trois universités servent de modèle :

- **`universities/univ-rennes/`** — l'implémentation de référence, complète (CAS + ADE + Planning GWT + Moodle + établissements + icônes de services).
- **`universities/univ-rennes-2/`** — portail Drupal, planning TEMPO, Moodle par le CAS, messagerie Zimbra, un seul établissement, sans icônes faites main. Bon point de départ : copiez-le, renommez-le, remplacez ses valeurs par les vôtres.
- **`universities/univ-sorbonne-nouvelle/`** — portail iSorbonne, Planning GWT avec l'emploi du temps personnel, listée en dev seulement (`devOnly`).

Le compte démo (`demo@tafac.fr` / `tafac-demo`) marche pour toute université qui a `features.demo`.

## Démarrage rapide

```bash
cp -r universities/univ-rennes-2 universities/univ-mon-campus
# éditez universities/univ-mon-campus/{shared,client}.js (id, origins, branding) et assets/
# côté serveur : ses réglages dans tonAPI et son id dans la passerelle (« Côté serveur » plus bas)
npm run dev                                 # toutes les universités : choisissez la vôtre, ou /<slug>
UNIVERSITY=univ-mon-campus npm run dev      # la vôtre seule, sans liste
npm run build                               # un seul build pour toutes les universités
# production : la passerelle (back/), votre université seule avec UNIVERSITY (SELF_HOSTING.md)
```

Le build est le même pour toutes les universités : `UNIVERSITY` ne compte qu'à l'exécution. La page charge au démarrage le `client.js` de son université (un fichier par université, téléchargé à la demande).

### Sur l'instance commune (toutes les universités)

Avec `MULTI_UNIVERSITY=1` (ou sans `UNIVERSITY`), toutes les universités du dossier `universities/` (ou la liste `UNIVERSITIES`) sont servies sur la même adresse. Votre université apparaît dans la liste de la page de connexion avec son nom et son logo, et a sa page `/<slug>` (sa landing, dont le bouton mène à sa connexion). Dans `shared.js` :

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

## Les fichiers d'une université

| Fichier | Chargé par | Contenu |
| --- | --- | --- |
| `shared.js` | la page, le build et les scripts | Données pures partagées : id, origins publics, flags de features, textes de branding, style des icônes. **Aucun import d'asset** (Node doit pouvoir l'importer au build). |
| `client.js` | Navigateur uniquement (chargé au démarrage de la page, lu via `@university`) | Config complète côté client : branding + logo, liens d'aide, catégories/icônes de services, établissements. Peut importer des images. |

Côté serveur, il n'y a plus de fichier dans `universities/` : voir « Côté serveur » plus bas.

## Champs de configuration

### Obligatoires

- `id` — identifiant du dossier (kebab-case).
- `origins.ent` — origine du portail ENT (uPortal). Le proxy local ne relaie que cet hôte.
- `origins.cas` (serveur + client) — origine du SSO CAS. Le flux de connexion implémenté est **CAS 2.0 avec formulaire** (scraping des champs `execution`/`_eventId`), le standard Jasig/Apereo utilisé par la plupart des universités françaises.
- `origins.moodle` (optionnel, `client.js`) — origine Moodle, pour le lien « Moodle » de la sidebar et de la barre d'onglets mobile (`/my/`, via `/__ent_auth/launch`). Requiert `features.moodle`. Le lien « Messagerie » n'a besoin que de `features.mail`.
- `auth.portalEntryPath` — page d'atterrissage uPortal (souvent `/f/services/normal/render.uP`). Sert de point d'entrée de connexion, de `Referer` par défaut et de preuve d'authentification. Le serveur rejoue cette entrée avec le seul cookie CAS `TGC` (conservé chiffré dans le cookie de session) pour rétablir la session ENT en silence quand elle a expiré.
- Le logiciel du portail (uPortal, Drupal, iSorbonne) est un fournisseur de tonAPI, choisi dans son `university.toml` ; la passerelle le reconnaît (`back/crates/tafac-gateway/src/portals.rs`). Avant, c'était `auth.portal` : Avec Drupal, la session est vérifiée sur `portalEntryPath` (classe `user-logged-in` du `<body>`). Drupal n'a ni API layout ni userinfo : la grille d'applications reste vide et le compte n'a pas de prénom. Exemple : `universities/univ-rennes-2/`. Avec `'isorbonne'` (portail JSF maison de la Sorbonne Nouvelle), la session est vérifiée sur `portalEntryPath` (lien `/ENT/logout.xhtml` et formulaire `portalForm`), le nom vient de ce lien et la grille des tuiles de la page (`catalog.path`). Exemple : `universities/univ-sorbonne-nouvelle/`.
- La grille d'applications lit `GET /__ent_auth/apps` : une seule liste, `{ id, title, description, url, iconUrl, category, favorite }`, quel que soit le portail (`src/portalApps.js`). La passerelle la donne par tonAPI, quel que soit le portail. Les favoris restent dans le navigateur ; ils partent une fois de ceux que le portail marque `favorite`.
- `auth.casLogoutPath` (optionnel, défaut `/logout`) — chemin de déconnexion du CAS Apereo, appelé à la déconnexion pour clore la session SSO côté université.
- Le second facteur du CAS est réglé dans tonAPI (`university.toml`). Avec `'esup-otp'` (Esup OTP), un CAS qui répond à un mot de passe juste par sa page de code fait passer le formulaire de connexion à l'étape du code (`401` avec `code: 'mfa_required'`, puis `'mfa_invalid'` si le code est refusé). Le serveur lit sur cette page l'adresse de l'API Esup OTP, l'uid et le hash de l'étudiant, demande à l'API ses méthodes et l'envoi d'un code (tonAPI) : à la demande de l'étudiant (`sendCode: 'sms' | 'mail'`), ou d'office quand c'est sa seule méthode (pas d'application, un seul de SMS et mail), comme le fait la page de l'université. L'API doit être sur un hôte autorisé (`origins`, `launch.allowedDomains`), sinon seul le code d'une application d'authentification est proposé. Notification push, WebAuthn et carte NFC ne sont pas pris en charge. Sans cette clé, un CAS qui demande un code reste un échec de connexion. Exemple : `universities/univ-rennes/`.
- `branding` — `appName`, `defaultTitle`, `seoTitle`, `seoDescription`, `logo` (+ `logoAlt`, `loginFooterLine`, `loginPasswordNote` (ligne sous le formulaire de connexion sur le mot de passe), `alternateNames` (anciens noms, pour les moteurs de recherche), `about.*` (dont `about.team` et `about.contactEmail`, l'équipe et l'adresse de la section « Aide » d'À propos : les mêmes pour toutes les universités, à importer de `universities/tafac.js`), `papillon` (`{ url }` : les mentions « Fait partie de Papillon » de la landing, de la connexion et d'À propos ; à omettre si l'instance n'est pas faite par l'équipe de Papillon)). `nameInText` : le nom de l'université au milieu d'une phrase (« l’Université de Rennes »), repris par la landing de `tafac.fr/<slug>` (`{university}` dans `src/landingCopy.json`) ; sans lui, « votre université ». Les textes de `branding` s'adressent à l'étudiant en le vouvoyant (ou de façon impersonnelle pour ceux qu'un étudiant tutoyé voit aussi, comme `about.disclaimer`) : ils ne suivent pas `register`. La description doit dire que le client n'est pas officiel. Sur un serveur qui sert toutes les universités, `/<slug>` est la landing de l'université (déconnecté), avec son `seoTitle` et sa `seoDescription`, et figure dans le sitemap : c'est elle qui ressort quand on cherche l'ENT de cette université. Utilisé par la page de connexion, la sidebar, le SEO, le manifest PWA et `index.html` (placeholders `%LENT_*%`).
  - `lockup` / `lockupDark` (optionnels, `client.js` uniquement) — visuel combiné « Tafac × université » affiché dans la sidebar et le header (comme Rennes). Sans eux, le logo Tafac et votre `logo` sont composés côte à côte automatiquement.
  - `heroImages` (optionnel, `client.js` uniquement) — photos affichées en fond du haut du tableau de bord, en fondu vers le fond uni : `[{ src, credit: { author, license, url }, position? }]`. Plusieurs photos tournent chaque jour. Chaque établissement peut définir ses propres `heroImages` dans `establishments.byId`. Sans photo, ce sont celles de Tafac (`src/assets/wallpapers/tafac/`), et Réglages › Apparence ne propose que ce dossier. Un établissement peut partir sur les photos de Tafac (une par jour) plutôt que les siennes tant que l'étudiant n'a rien choisi : `establishments.byId.<id>.defaultWallpaperFolder: 'tafac'` (l'IUT de Lannion). Le crédit apparaît dans le footer : utilisez des images libres de droits (ex. Wikimedia Commons) et renseignez auteur + licence.
- `features` — l'interrupteur général (voir ci-dessous).
- `register` — `'vous'` ou `'tu'` : comment l'app s'adresse à l'étudiant (« Choisissez votre université » ou « Choisis ton université »). À déclarer explicitement dans `shared.js` (repris par `client.js`) ; absent, `'vous'`. Un établissement peut avoir le sien : `establishments.byId.<id>.register` (l'IUT de Lannion tutoie, le reste de l'Université de Rennes vouvoie). Le registre est résolu par `src/register.js` (`resolveRegister`), et chaque texte qui s'adresse à l'étudiant donne ses deux formes avec `r('tu…', 'vous…')`. Avant la connexion (landing, choix de l'université, page de connexion), c'est celui de l'université, ou `'vous'` sans université (`universities/neutral.js`).

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
  demo: true,        // compte de démonstration (demo@tafac.fr), servi par la page sans le serveur (src/demoServer.js)
}
```

Un feature à `false` : le serveur répond `{ disabled: true }` sur les endpoints concernés et le frontend masque les widgets/liens.

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
        absenceReasons: ['protest'], // optionnel : raisons en plus dans « Assiduité › Justifier » (ids de src/absenceMail.js, `optional`)
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
- `services.launchRelay` — (optionnel) `true` quand les applications du portail sont derrière le CAS : chaque tuile s'ouvre alors par `/__ent_auth/launch`, qui y connecte l'étudiant. Sans lui, une tuile est un lien simple. Exemple : `universities/univ-rennes/`.
- `services.isUnavailableApplication(app)` — masque complètement certaines applications.
- `planning.directory` (optionnel, `client.js`) — ce que propose le panneau « Salles et personnels » du planning : `{ kinds: ['room', 'person', 'group'], bySite: true }`, la valeur par défaut d'un planning ADE (`planning.providerName` absent ou `'ADE'`), qui liste les salles et le personnel du site de l'étudiant. `kinds` réduit les onglets (une seule nature : pas d'onglets, et le panneau s'appelle « Salles » pour les salles seules) ; `bySite: false` liste tout l'arbre, par son premier dossier, quand il n'est pas rangé par site. Exemple : `universities/univ-rennes-2/` (les salles de TEMPO). Les ressources viennent de `/__ent_auth/timetable/tree`, qui doit en donner pour ces natures.
- `grades.serviceUrl` (client) — URL publique du service de notes (ScoDoc), ouverte via `/__ent_auth/launch` depuis les widgets et le lien « Mes notes » quand `features.grades === true`.
- `mailWebmailUrl` (shared) — URL publique du webmail (« Messagerie »), réutilisée par `mail.webmailUrl` côté serveur ; le widget l'ouvre via `/__ent_auth/launch`.
- `mail.ownDomains` (optionnel, `client.js`) — domaines mail de l'université, sous-domaines compris (Rennes : `['univ-rennes.fr', 'univ-rennes1.fr']`). Dans la page Messagerie, le lecteur affiche toujours le domaine de l'expéditeur à côté de son nom ; la liste ne l'affiche que pour un domaine hors de cette liste, pour repérer un nom d'affichage qui imite l'université (`src/mailDomain.js`). Sans lui, les domaines des `origins` (deux derniers labels) en tiennent lieu.
- `grades` (copy) — `unavailableTitle`, `unavailableDetail`, `disabledPillLabel` quand `features.grades === 'disabled'` ; `unavailableTitle`/`unavailableDetail` servent aussi de message d'erreur serveur quand ScoDoc ne répond pas.

### Côté serveur : tonAPI et la passerelle

Le serveur de Tafac est la passerelle Rust de `back/` (`back/README.md`), qui demande à l'université par [tonAPI](https://github.com/l-ent-univ/tonAPI). Pour une nouvelle université :

1. **Dans tonAPI** : `universities/<id>/university.toml` (le portail, le CAS et son second facteur, ADE ou TEMPO, ScoDoc, Moodle, le webmail…), validé par `cargo run -p tonapi-cli -- validate universities`. Un logiciel que tonAPI ne connaît pas encore y devient un fournisseur. Les réglages ADE rétro-ingéniérés (`ade.etab`, clés de l'app « Campus ») et ceux du Planning GWT y vivent aussi.
2. **Dans la passerelle** (`back/crates/tafac-gateway/src/`) :
   - son id dans `routes::UNIVERSITIES` (les universités servies) ;
   - ses domaines dans `launch/targets.rs` (ce que le relais `/__ent_auth/launch` peut ouvrir avec la session, et les chaînes de connexion de Moodle et du webmail) ;
   - sa signature de mail, s'il y en a une, dans `mail/signature_block.rs` (université, logo, établissements, `show_login`), le PNG rendu par `scripts/render-mail-logos.mjs` ;
   - puis épingler le commit de tonAPI qui a ses réglages (`back/crates/tafac-gateway/Cargo.toml`, `cargo update -p tonapi-*` dans `back/` et `src-tauri/`).
3. **Dans Tafac** : `node scripts/universities-directory.mjs` (la liste et les `features` que la passerelle lit, `universities/directory.json`).

Ce que la page lit (les `features`, les liens, les textes) reste dans `shared.js` et `client.js`.

## Icônes des applications

Chaque tuile d'application (grille « Toutes les applications », favoris, favoris de la sidebar) reçoit une icône et une couleur **automatiquement**, sans rien configurer :

1. **Icône faite main** si `services.getAppIcon(title)` en renvoie une (Rennes : `universities/univ-rennes/app-icons/`). Elle a toujours la priorité.
2. Sinon, **icône automatique** choisie par la passerelle (`back/crates/tafac-gateway/src/own/icons.rs`) : un *concept* (`mail`, `calendar`, `course`, `library`, `wifi`, `printing`, `visio`, `office`, `help`, `restaurant`, `sport`, `jobs`, `card`, `payment`…, 59 au total) d'après des mots-clés français et anglais du titre (puis de la description, puis de la catégorie), et une *teinte*, tirée du hash de l'id du service en évitant les teintes déjà les plus utilisées. Sans mot-clé reconnu : concept `generic`.
3. Pendant le chargement ou en cas d'échec : la lettre sur fond coloré, à la même taille.

Le premier choix pour un service est **mémorisé pour toute l'université** dans `<DATA_DIR>/app-icons/<id>.json` (voir [SELF_HOSTING.md](SELF_HOSTING.md#icônes-automatiques-des-applications)) : tous les étudiants voient la même tuile, et modifier la liste de mots-clés ne change pas les tuiles existantes, seulement celles des services jamais vus. Un service ajouté au portail a donc tout de suite une tuile correcte.

### Style des icônes et couleurs (`shared.js` → `appIcons`)

Le concept et la teinte sont dessinés selon le style de chaque université :

```js
appIcons: {
  style: 'carbon',      // 'carbon' (défaut, comme le reste de l'UI), 'phosphor', 'phosphor-fill', 'phosphor-duotone', 'tabler'
  colorMode: 'pastel',  // 'pastel' (défaut : tuile vive, pictogramme foncé), 'soft' (teinte légère), 'vivid' (tuile saturée, pictogramme blanc), 'mono' (sans couleur)
  icons: { mail: 'mdi:email-outline' }, // optionnel : remplace l'icône d'un concept par n'importe quelle icône Iconify
}
```

Chaque mode de couleur a sa variante sombre. Le fichier ne garde que le concept et la teinte : changer de style ou de mode redessine toutes les tuiles sans rien remélanger. Une valeur inconnue fait échouer `node scripts/gateway-data.mjs` et les tests. Exemples : Rennes en `phosphor-duotone` + `soft`, la Sorbonne Nouvelle en `carbon` + `pastel`.

Pour améliorer les choix, ajoutez des mots-clés dans `APP_ICON_RULES` (`src/appIconPicks.js`, que la page et la passerelle partagent ; test dans `tests/appIcons.test.js`) ; un nouveau concept doit avoir une icône dans chaque style (`ICONS_BY_CONCEPT`). La passerelle Rust choisit avec une copie de ces listes et du style de chaque université : après une modification, lancez `node scripts/gateway-data.mjs` (les tests échouent tant que ce n'est pas fait). Pour corriger une tuile déjà attribuée, éditez le fichier JSON (voir SELF_HOSTING) ou ajoutez une icône faite main.

## Checklist de validation

1. `npm run lint && npm run typecheck && npm test && npm run build`, et `cargo test` dans `back/` — tout doit passer.
2. `npm run dev`, puis `/<slug>` et son bouton « Se connecter à mon ENT » — page de connexion : logo, textes, liens d'aide corrects ; votre université figure dans la liste de `/universites`.
3. Connexion démo (`demo@tafac.fr` / `tafac-demo`) si `features.demo` — dashboard, grille d'applications. La page sert la démo elle-même (`src/demoServer.js`), selon les `features` de `shared.js` : rien à écrire côté serveur pour elle.
4. **Connexion réelle** avec un compte étudiant — c'est le seul test qui exerce CAS, le proxy ENT et les services activés.
5. `grep -ri '<votre-univ>' src/` ne doit rien retourner : tout ce qui est propre à l'université vit dans `universities/<id>/`, dans tonAPI et dans les listes de la passerelle ci-dessus.

## Ce qui n'est pas couvert

Un portail, un SSO (OIDC, SAML direct) ou un service que tonAPI ne connaît pas demande un nouveau fournisseur dans tonAPI (`crates/tonapi-providers`), puis sa route dans la passerelle si la page en a besoin d'une nouvelle. Les contributions sont bienvenues.
