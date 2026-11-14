# Parité entre universités

Tafac sert plusieurs universités avec le même code. Ce qui est ajouté pour l'une ne doit ni casser ni changer les autres, sauf intention explicite. Cette liste sert de garde-fou : un agent la relit avant chaque commit fait dans une session Claude Code (hook `PreToolUse` dans `.claude/settings.json`). Elle se complète au fil des cas rencontrés. Elle couvre aussi la parité entre le site et l'appli de bureau (dernière section) : le même CSS sert les deux, avec des variantes.

Universités à vérifier : **toutes celles du dépôt au moment du commit**, pas une liste figée. Chaque dossier de `universities/` est une université (`shared.js`, `client.js`, `server.js`), les `example-*` compris, plus `universities/neutral.js` (la page sans université). Une université ajoutée entre-temps est donc vérifiée comme les autres. Pour chacune, ses particularités se lisent dans sa config : quelles `features` sont actives, quelles clés elle définit ou non, quelles valeurs elle donne aux clés qui choisissent un fournisseur.

## Ce qui bloque un commit

1. **Comportement non conditionné** : du code partagé (`server/`, `src/`, `*.js` à la racine) change pour toutes les universités ce qui ne devait concerner qu'une seule. Toute particularité passe par une clé de config (`universities/<id>/*.js`) dont l'absence garde le comportement d'avant pour les autres.
2. **Clé de config sans défaut** : une nouvelle clé lue sans repli (`config.x.y` qui casse si `x` manque) alors que d'autres universités ne la définissent pas.
3. **Chemin d'un autre fournisseur cassé** : un changement touche une branche choisie par la config sans vérifier les autres valeurs. Toute clé de config qui sert à choisir un comportement en est une, y compris celles ajoutées après l'écriture de cette liste. Pour la trouver, chercher dans le code modifié les lectures de `universityConfig.*`, `FEATURES.*` et `features?.*`, puis comparer les valeurs de chaque université. Exemples connus :
   - portail : `auth.portal` (`'uportal'` par défaut, `'drupal'`) ;
   - second facteur à la connexion : `auth.mfa` (absent = aucune étape de code, `'esup-otp'`) ;
   - planning : `planning.api` (`'portal-rest'`, `'tempo'`, absent = Planning GWT), `planning.personal` ;
   - Moodle : `moodle.casLoginPath` (CAS) ou Shibboleth par défaut ;
   - mail : `mail.provider`, `mail.page` ;
   - notes : `features.grades` (vrai, faux ou `'disabled'`) ;
   - `features.*` en général : un widget, une route ou une entrée de menu doit rester masqué quand sa feature est absente.
4. **Mode démo cassé** : chaque route qui appelle un service universitaire doit répondre au compte démo avant tout appel réseau (`isDemoSession`), pour toutes les universités qui ont `features.demo`.
5. **Forme des données divergente** : deux fournisseurs d'une même donnée doivent rendre la même forme au frontend (événements de planning, `account`, layout d'applications, mails, échéances). Un champ ajouté pour l'un est optionnel (`null` ou absent) pour les autres, et le frontend le gère.
6. **Clé de stockage** : une clé `localStorage` existante est renommée (interdit), ou une nouvelle clé propre à une université n'est pas déclarée dans `src/universityStorage.js` (et, si c'est un réglage, dans `src/settingsTransfer.js`, `src/components/WelcomeFromLent.jsx`, `src/components/debug/debugUtils.js`).
7. **Données personnelles** : identifiants, numéro étudiant, nom, notes ou emploi du temps réels dans un fichier commité.

## Ce qui mérite un avertissement (sans bloquer)

- **Visuel** : une taille ou une mise en page qui dépend de la forme d'un logo (`logoShape` `'wide'`/`'square'`), d'une photo de fond, d'un lockup, d'un nombre d'éléments, doit rester correcte pour chaque université (page de connexion, accueil « Compatible avec », sidebar, en-tête, mode sombre avec logo inversé).
- **Textes** : un texte qui nomme un service (« ADE », « ScoDoc », « Moodle ») alors qu'une université en utilise un autre (`planning.providerName`).
- **Tutoiement / vouvoiement** : un nouveau texte qui s'adresse à l'étudiant (« tes notes », « Choisis… », « Reconnecte-toi ») écrit en dur dans une seule forme. Il passe par `r('forme tu', 'forme vous')` de `src/register.js`, appelé au moment de l'affichage (pas dans une constante de module : elle garderait le registre du chargement ; un objet de libellés prend des getters). Le registre vient de `register` dans la config de l'université (`'vous'` partout, `'tu'` pour l'établissement `iutlan` de Rennes) : une université sans `register` vouvoie. Les textes de `branding` et de `universities/neutral.js` sont en « vous » ou impersonnels, le serveur reste impersonnel.
- **Documentation** : une nouvelle clé de config absente de `docs/ADDING_A_UNIVERSITY.md`.
- **Tests** : une nouvelle logique pure sans test, ou un test qui ne couvre qu'une variante.
- **Signature des mails** : un établissement ou un logo ajouté à `client.js` (`establishments.byId`, `branding.logo`) sans son entrée dans `server.js › mail.signature` (et son PNG rendu par `scripts/render-mail-logos.mjs`) n'apparaît pas dans la signature des mails envoyés. De même, `mail.signature.showLogin` doit avoir la même valeur dans `client.js` et `server.js` (une constante de `shared.js`) : sinon le composeur montre une ligne « Identifiant » que le mail envoyé n'a pas, ou l'inverse.
- **Noms d'enseignants du planning** : chaque fournisseur les écrit à sa façon (ADE « M. Lemoine », « LEMOINE Thomas », plusieurs joints par « - » ; TEMPO « Martin C. », souvent aucun). Du code qui lit `teacher` d'un événement (suggestions de destinataires, `src/teacherRecipients.js`) doit couvrir chaque forme et l'absence de nom, sans jamais deviner une adresse.
- **`devOnly`** : une université encore en `devOnly: true` qui reçoit une fonctionnalité annoncée comme publique.

## Web et appli de bureau

L'appli de bureau (`src-tauri/`, `docs/DESKTOP.md`) affiche la même page que tafac.fr, avec des variantes CSS posées sur `<html>` par `src/desktopApp.js` :

- `data-desktop-app` (toute appli de bureau) : flèche au lieu de la main sur les boutons, pas de rebond au défilement, liens et images non déplaçables ;
- `data-desktop-macos` (macOS) : pas de barre de titre (les boutons de la fenêtre dans le coin haut de la sidebar), sidebar collée aux bords et transparente sur la matière système, panneaux de droite (lecteur de mail, « Salles et personnels ») collés au bord droit dans leur couleur, composeur plein écran sous les boutons de la fenêtre, colonne de contenu décalée par une marge (`.app-column`), sidebar repliée à 84px au lieu de 72 (`src/sidebarWidth.js`), bande de 52px en haut qui déplace la fenêtre (`src/desktopWindowDrag.js`), largeur minimale 1024px (jamais la mise en page téléphone).

Les règles sont à la fin de `src/overrides.css`. Windows et Linux gardent leur barre de titre, une sidebar flottante et la mise en page téléphone sous 1024px.

Bloque un commit :

- **Variante non conditionnée** : du CSS ou du JS propre à l'appli qui s'applique aussi au site (pas derrière `:root[data-desktop-app]`, `:root[data-desktop-macos]`, `isDesktopApp()` ou `isMacDesktopApp()`), ou l'inverse : un changement pour le site qui défait une règle de l'appli.
- **Mise à jour contournée (appli)** : dans `src/main.jsx`, un appel au serveur (`/__ent_auth`, `/__ent_proxy`) ajouté avant la réponse de `startDesktopUpdates()`, ou du code propre aux mises à jour (`src/desktopUpdate.js`, `/__desktop/update/*`) qui s'exécute hors de l'appli. Une version trop ancienne affiche « Mise à jour nécessaire » sans rien demander à l'université ; le site, lui, ne connaît pas ces routes.
- **Accroche renommée** : une classe ou un attribut sur lequel s'appuient les règles de l'appli (`.sidebar-panel`, `.sidebar-panel--compact`, `.sidebar-peek`, `.app-column`, `main`, `data-tauri-drag-region` sur les `<aside>` de la sidebar, `--sidebar-width`, `.mail-reader-panel`, `.side-panel`, `--mail-reader-width`, `--side-panel-width`, `.mail-composer.is-fullscreen`) renommé ou déplacé sans mettre à jour `src/overrides.css` et `src/desktopWindowDrag.js`.

Mérite un avertissement :

- **Sous la sidebar (macOS)** : un fond opaque qui passe sous la sidebar (bande pleine largeur, ombre étalée, élément fixe sur toute la fenêtre, fond sur `html`, `body`, `main` ou le conteneur du tableau de bord) cache la matière système. Ce qui doit aller d'un bord à l'autre s'arrête au bord de `.app-column`.
- **Plein écran (macOS)** : un élément qui couvre toute la fenêtre (comme le composeur plein écran) commence à 52px du haut, sous les boutons de la fenêtre.
- **Coin des boutons de la fenêtre (macOS)** : rien de cliquable ni de lisible dans les 52px du haut de la sidebar, ni sous les boutons quand elle est repliée (84px). Une forme qui suppose la sidebar flottante (coins arrondis, marge de 12px, ombre, position `top-3 left-3`) doit avoir sa variante collée.
- **Bande du haut (macOS)** : dans les 52px du haut de la fenêtre, un appui sur ce qui n'est pas reconnu comme cliquable déplace la fenêtre. Un élément cliquable placé là est un `button`, un `a`, un rôle ARIA interactif, a un `tabindex` ou la classe `cursor-pointer`.
- **Contraste sur la matière (macOS)** : le texte et les icônes de la sidebar se lisent sur la matière système, claire ou sombre selon le thème de l'app (`src/desktopWindowTheme.js`) et teintée par le bureau derrière la fenêtre. Pas de couleur qui suppose le fond plein de la sidebar du site.
- **Curseur** : une nouvelle règle `cursor: pointer` plus spécifique que celle de `data-desktop-app` remet la main dans l'appli.
- **Menu de l'appli** : une page ajoutée à la sidebar (`buildNavItems`) arrive seule dans « Aller » ; une nouvelle recherche ou actualisation propre à une page répond à `onDesktopCommand` (`src/desktopMenu.js`) et se déclare dans l'état envoyé par `App.jsx`, sinon l'entrée du menu reste grisée.
- **Mises à jour (appli)** : « Mise à jour prête » est dans le pied de la sidebar, au-dessus du compte (`DesktopUpdateRow` ; repliée, `CompactDesktopUpdateButton` dans `data-sidebar-foot`) : sous 236px de large, son bouton passe sous le texte. « Mise à jour nécessaire » et la note du menu sont dans une racine à part (`DesktopUpdateLayer`, `z-[80]` et `z-[70]`, montée par `src/main.jsx` avant `App`) : un élément plein écran placé au-dessus les cacherait, et leurs textes restent impersonnels (ni « tu » ni « vous » : l'université n'est pas encore connue). Ils se vérifient en clair et en sombre, sur la matière de la sidebar comme sur le fond plein.
- **Impression (appli)** : un nouvel élément fixe ou un nouveau panneau se masque dans le `@media print` de la fin de `src/overrides.css`, sinon il s'imprime.
- **Largeurs** : une mise en page qui ne marche qu'à partir de 1024px ou qu'en dessous se vérifie aussi pour l'appli Windows/Linux, qui descend à 380px.
