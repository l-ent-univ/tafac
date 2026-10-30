# Parité entre universités

Tafac sert plusieurs universités avec le même code. Ce qui est ajouté pour l'une ne doit ni casser ni changer les autres, sauf intention explicite. Cette liste sert de garde-fou : un agent la relit avant chaque commit fait dans une session Claude Code (hook `PreToolUse` dans `.claude/settings.json`). Elle se complète au fil des cas rencontrés.

Universités à vérifier : **toutes celles du dépôt au moment du commit**, pas une liste figée. Chaque dossier de `universities/` est une université (`shared.js`, `client.js`, `server.js`), les `example-*` compris, plus `universities/neutral.js` (la page sans université). Une université ajoutée entre-temps est donc vérifiée comme les autres. Pour chacune, ses particularités se lisent dans sa config : quelles `features` sont actives, quelles clés elle définit ou non, quelles valeurs elle donne aux clés qui choisissent un fournisseur.

## Ce qui bloque un commit

1. **Comportement non conditionné** : du code partagé (`server/`, `src/`, `*.js` à la racine) change pour toutes les universités ce qui ne devait concerner qu'une seule. Toute particularité passe par une clé de config (`universities/<id>/*.js`) dont l'absence garde le comportement d'avant pour les autres.
2. **Clé de config sans défaut** : une nouvelle clé lue sans repli (`config.x.y` qui casse si `x` manque) alors que d'autres universités ne la définissent pas.
3. **Chemin d'un autre fournisseur cassé** : un changement touche une branche choisie par la config sans vérifier les autres valeurs. Toute clé de config qui sert à choisir un comportement en est une, y compris celles ajoutées après l'écriture de cette liste. Pour la trouver, chercher dans le code modifié les lectures de `universityConfig.*`, `FEATURES.*` et `features?.*`, puis comparer les valeurs de chaque université. Exemples connus :
   - portail : `auth.portal` (`'uportal'` par défaut, `'drupal'`) ;
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
- **Documentation** : une nouvelle clé de config absente de `docs/ADDING_A_UNIVERSITY.md`.
- **Tests** : une nouvelle logique pure sans test, ou un test qui ne couvre qu'une variante.
- **Signature des mails** : un établissement ou un logo ajouté à `client.js` (`establishments.byId`, `branding.logo`) sans son entrée dans `server.js › mail.signature` (et son PNG rendu par `scripts/render-mail-logos.mjs`) n'apparaît pas dans la signature des mails envoyés. De même, `mail.signature.showLogin` doit avoir la même valeur dans `client.js` et `server.js` (une constante de `shared.js`) : sinon le composeur montre une ligne « Identifiant » que le mail envoyé n'a pas, ou l'inverse.
- **Noms d'enseignants du planning** : chaque fournisseur les écrit à sa façon (ADE « M. Lemoine », « LEMOINE Thomas », plusieurs joints par « - » ; TEMPO « Martin C. », souvent aucun). Du code qui lit `teacher` d'un événement (suggestions de destinataires, `src/teacherRecipients.js`) doit couvrir chaque forme et l'absence de nom, sans jamais deviner une adresse.
- **`devOnly`** : une université encore en `devOnly: true` qui reçoit une fonctionnalité annoncée comme publique.
