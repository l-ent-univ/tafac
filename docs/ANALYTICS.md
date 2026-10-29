# Mesure d'audience anonyme

> Tafac s'appelait auparavant l'ent : les identifiants techniques (clés `l-ent:*`, ids `lent-*`) gardent l'ancien nom.

Tafac peut mesurer son audience de façon anonyme, pour savoir quels widgets marchent, quelles applications sont ouvertes et si les connexions réussissent. Le dispositif est conçu pour rester dans le cadre de l'**exemption de consentement de la CNIL** (« mesure d'audience exemptée ») : aucun cookie, aucun identifiant persistant, aucune donnée personnelle, finalité strictement statistique, et un interrupteur pour la désactiver.

Un seul outil, **PostHog**, **sans cookie et hébergé dans l'UE**, appelé uniquement par le serveur, pour les événements détaillés ci-dessous. Aucun script tiers ne s'exécute dans la page. **Désactivé par défaut** : sans la variable `POSTHOG_PROJECT_KEY`, rien n'est créé, mis en file ni envoyé. L'interrupteur *Statistiques anonymes* le coupe.

Une fenêtre « Tes données restent à toi » (`src/components/PrivacyModal.jsx`) explique tout cela aux étudiants ; elle s'ouvre depuis *Mon compte* et depuis « À propos ».

## Fonctionnement

```
navigateur ──(événements filtrés)──▶ /__ent_auth/analytics (serveur Tafac) ──posthog-node──▶ PostHog (UE)
```

- **Le navigateur ne parle jamais à PostHog** et ne charge aucun script PostHog. `src/analytics.js` met les événements en lot et les envoie à notre propre serveur, via `navigator.sendBeacon` (ou `fetch` avec `keepalive` en secours).
- **Le serveur filtre tout** avec une liste blanche stricte (`server/analyticsSchema.js`, seul fichier qui définit ce qui peut partir). Les événements et propriétés inconnus sont supprimés sans erreur. Chaque valeur conservée doit être un enum, un booléen ou un court identifiant `[a-z0-9-]`. Aucun texte libre n'est accepté.
- **Envoi depuis le serveur** (`server/analytics.js`, `posthog-node`) : PostHog ne voit que l'IP du serveur, jamais celle de l'étudiant. Aucun en-tête `X-Forwarded-For` ni propriété `$ip` n'est transmis, et la GeoIP est désactivée (`disableGeoip`).
- **Pas de profils** : chaque événement porte `$process_person_profile: false`. Il n'y a ni `identify()`, ni autocapture, ni session replay, ni heatmaps.
- L'endpoint répond toujours `204` (`413` si le corps dépasse 8 Ko), accepte au plus 20 événements par requête et ignore les requêtes cross-site. Les erreurs sont avalées : la mesure d'audience ne peut pas casser l'application.

### Identifiant anonyme quotidien

`distinct_id = HMAC-SHA256(sel_du_jour, id_de_session)`, tronqué à 32 caractères hexadécimaux.

- Le **sel** est tiré au hasard (32 octets) pour chaque jour UTC. Il est gardé **en mémoire uniquement** : jamais écrit sur disque, jamais journalisé. Il est remplacé au changement de jour et l'ancien est oublié. Un redémarrage du serveur en tire aussi un nouveau.
- Conséquence : on peut compter des **visiteurs uniques par jour**, mais deux jours différents ne peuvent pas être reliés, et l'identifiant ne permet de retrouver ni la session ni l'étudiant.
- L'id de session est lui-même un UUID aléatoire, recréé à chaque connexion. On compte donc des sessions uniques par jour plutôt que des personnes.
- **Sans session** (page de connexion), seuls `login_result` et `pwa_update_applied` sont acceptés. Ils reçoivent un UUID aléatoire **par requête**, qui n'est relié à rien. Les autres événements sans session sont rejetés. Pour ces deux événements, comptez les occurrences et non les « utilisateurs uniques ».

## Événements et propriétés

Contexte ajouté automatiquement à chaque événement :

| Propriété | Valeurs | Source |
| --- | --- | --- |
| `device` | `mobile` (< 768 px), `tablet` (< 1024 px), `desktop` | largeur de la fenêtre |
| `browser` | `chromium`, `firefox`, `safari`, `other` | famille déduite du user-agent (le UA lui-même n'est pas envoyé) |
| `standalone` | booléen | PWA installée (`display-mode: standalone`) |
| `lang` | 2 lettres (`fr`, `en`…) | langue du navigateur |
| `establishment` | id d'établissement de la config (`iutlan`, `ufrs`…) | établissement mémorisé (grands groupes) |
| `formation` | identifiant court de la formation (`but-mmi`, `but-info`…, 32 caractères max) | niveau « formation » de la sélection ADE de l'étudiant, converti en slug. Jamais l'année, le TD ni le TP (groupes trop petits) |
| `university` | id de l'université (`univ-rennes`) | **ajouté par le serveur**, depuis sa config |
| `demo` | booléen | **ajouté par le serveur** depuis la session (compte démo ou non) |

| Événement | Quand | Propriétés propres |
| --- | --- | --- |
| `dashboard_viewed` | une fois par affichage du tableau de bord | — |
| `widget_loaded` | une fois par widget et par affichage, quand le premier chargement aboutit (cache ou réseau). Les rafraîchissements en arrière-plan ne sont pas envoyés. | `widget` : `greeting`, `nextClass`, `latestGrade`, `mail`, `deadlines` · `status` : `ok`, `empty`, `error` · `duration_bucket` : `<500ms`, `<1s`, `<3s`, `<10s`, `10s+` · `error_kind` (si `error`) : `http_4xx`, `http_5xx`, `network`, `timeout`, `other` |
| `app_opened` | ouverture d'une application | `app` : identifiant technique de l'application (fname du portail ou id de service local, normalisé `[a-z0-9-]{1,64}`, ex. `lent-iutlan-notes9`) · `source` : `grid`, `favorites`, `sidebar`, `tabbar` · `in_app` (tuiles) : booléen, l'application des notes a ouvert « Mes notes » au lieu de ScoDoc, ou celle de l'emploi du temps la page Planning au lieu du service |
| `setting_changed` | changement d'un réglage dans Mon compte | `setting` : `widget_visibility`, `app_descriptions`, `custom_background`, `wallpaper`, `theme`, `analytics` · `value` : `on`, `off` (`auto`, `light`, `dark` pour `theme`) · `widget` (pour `widget_visibility`) : mêmes valeurs que ci-dessus. La désactivation des statistiques n'est **jamais** envoyée. |
| `login_result` | après la réponse du serveur de connexion | `result` : `success`, `failure` · `demo` : booléen |
| `pwa_update_applied` | application d'une mise à jour de la PWA | — |
| `settings_imported` | arrivée depuis l'ancienne adresse l'ent avec un lien de transfert des réglages (une fois par arrivée, souvent avant la connexion) | `has_settings` : booléen, au moins un réglage a été repris |
| `page_viewed` | une fois par arrivée sur « Mes notes » ou sur le Planning (pas à chaque rendu) | `page` : `grades`, `planning` · `source` : `nav` (barre latérale), `tabbar` (barre d'onglets mobile), `tile` (tuile de l'application des notes ou de l'emploi du temps), `dashboard_card` (carte « Dernière note » ou « Prochain cours »), `sidebar_card` (« Dernière note » de la barre latérale, pour `grades` seulement), `launch_card` (carte d'annonce de « Mes notes » ou du Planning, sur le tableau de bord), `history` (précédent, suivant, rechargement), `other` · `view` (pour `planning` seulement) : la vue à l'ouverture, `day`, `two_days` (téléphone), `week` (grand écran), `list`. `device` dit s'il s'agit des vues du téléphone ou du grand écran (`desktop`, ≥ 1024 px). |
| `grades_loaded` | une fois par arrivée sur « Mes notes », quand le semestre affiché à l'ouverture a fini de charger (cache ou réseau). Les changements de semestre et rafraîchissements ne sont pas envoyés. | `status` : `ok`, `empty` (pas de relevé ou pas encore de note), `unpublished` (relevé non publié), `unsupported` (relevé autre que BUT, ou aucun relevé ScoDoc), `error` · `duration_bucket` : comme `widget_loaded` · `error_kind` (si `error`) : comme `widget_loaded` |
| `grades_action` | une action sur « Mes notes » | `action` : `semester_changed`, `ue_view_opened` (une tuile d'UE ouverte en grand par l'étudiant), `grade_detail_opened`, `pdf_downloaded` (relevé PDF téléchargé), `explainer_opened` (« Comment ça marche ? »), `department_message_expanded` (« Lire la suite » du message du département) · `from` (pour `grade_detail_opened`) : `latest` (« Dernières notes »), `ue_view`, `subjects` (« Matières et SAÉ »), `dashboard` (« Dernière note » du tableau de bord) |
| `simulator_step` | étapes du simulateur de notes | `step` : `opened`, `ue_picked`, `reveal_shown`, `back_to_edit` (« Modifier mes notes »), `closed` · avec `reveal_shown` seulement : `edited_bucket` (notes modifiées) : `1`, `2-3`, `4+` · `added_grades` : booléen, des notes ajoutées à la main ont reçu une valeur · `ue_direction` : `up`, `down`, `same`, `new` (l'UE n'avait pas encore de moyenne) · `ue_validated` : booléen, l'UE simulée est validée · `crossed_pass_mark` : booléen, l'UE simulée passe de non validée à validée · avec `closed` seulement : `reached` : `dial` (choix de l'UE), `edit` (saisie), `reveal` (résultat), l'étape la plus avancée atteinte |
| `planning_loaded` | une fois par arrivée sur le Planning, quand la semaine affichée à l'ouverture a fini de charger (cache ou réseau). Les autres semaines, les « Réessayer » et les rafraîchissements ne sont pas envoyés. | `status` : `ok` (des cours cette semaine), `empty` (aucun cours cette semaine), `unavailable` (ADE n'a pas répondu), `unconfigured` (pas encore de groupe choisi) · `duration_bucket` : comme `widget_loaded` · `error_kind` (si `unavailable`) : comme `widget_loaded` |
| `planning_action` | une action sur le Planning (ou son export depuis Réglages) | `action` : `view_changed`, `day_changed`, `week_changed`, `today` (« Aujourd’hui »), `calendar_picked` (un jour choisi dans le calendrier du mois), `day_opened` (l'en-tête d'un jour de la semaine, grand écran), `course_opened` (fiche d'un cours ouverte), `occurrence_opened` (une prochaine séance choisie dans la fiche), `retry` (« Réessayer »), `open_account` (« Ouvrir Mon compte » pour choisir son groupe), `ics_exported` · `view` (pour `view_changed` : la vue choisie ; pour `course_opened` : la vue d'où la fiche est ouverte) : comme `page_viewed` · pour `day_changed` et `week_changed` : `via` : `arrow` (flèches, grand écran), `keyboard` (← →), `swipe` (glissé sur les heures ou la liste), `strip` (glissé sur la bande de la semaine), `pill` (un jour touché dans la bande) · `steps` : `1`, `2-3`, `4+`. Ces deux actions sont envoyées **une fois par rafale** (les pas rapprochés de moins de 1,5 s par le même moyen n'en font qu'un), jamais à chaque pas. · pour `ics_exported` : `from` : `header` (bouton du Planning), `settings` (Réglages) · `result` : `ok`, `empty` (aucun cours à exporter), `error` |
| `launch_card` | annonce du lancement de « Mes notes » ou du Planning (une seule carte à la fois) | `action` : `shown` (carte affichée sur le tableau de bord, une fois par montage), `cta` (« Voir mes notes », « Voir mon planning »), `dismissed` (fermée), `tab_marker` (clic sur l'entrée « Mes notes » ou « Planning » de la barre latérale ou des onglets tant qu'elle porte « Nouveau ») · `launch` : `grades`, `planning`, la page annoncée (absent dans les versions antérieures au Planning, qui n'annonçaient que « Mes notes » : compté comme `grades`) |

### « Mes notes » : ce qui part, et ce qui ne part jamais

Les événements de « Mes notes » décrivent l'usage de la page, jamais son contenu. Ils ne portent **aucune note, moyenne, écart de points, nombre de notes exact, nom ou code d'UE, de ressource ou de SAÉ, id d'évaluation ou de semestre, ni texte du message du département**. Les fonctions qui réduisent ce que la page connaît à ces catégories sont dans `src/gradesAnalytics.js` (testées dans `tests/gradesAnalytics.test.js`), et le serveur rejette tout le reste.

Pour le simulateur, `reveal_shown` dit seulement dans quel sens l'UE simulée bouge et si elle finit validée. `crossed_pass_mark: true` implique que l'UE n'était pas validée avant la simulation : c'est la seule information indirecte sur le relevé réel. Elle reste un booléen, rattaché à un identifiant anonyme du jour, sans l'UE concernée.

### Planning : ce qui part, et ce qui ne part jamais

Les événements du Planning décrivent l'usage de la page, jamais l'emploi du temps. Ils ne portent **aucun intitulé de cours, salle, enseignant, groupe, date ou jour consulté, intitulé de la semaine, nombre de cours, ni contenu du fichier .ics**. On sait seulement si la semaine d'ouverture avait des cours (`ok` ou `empty`) et, pour les déplacements, un nombre de pas regroupé (`1`, `2-3`, `4+`), sans sens ni point d'arrivée. Les fonctions qui réduisent ce que la page connaît à ces catégories sont dans `src/planningAnalytics.js` (testées dans `tests/planningAnalytics.test.js`), et le serveur rejette tout le reste : chaque action ne garde que ses propres propriétés.

PostHog ajoute aussi `$lib`, `$lib_version`, `$is_server` et `$geoip_disable` (métadonnées du SDK serveur), ainsi qu'un `timestamp` et un `uuid` d'événement.

## Ce qui n'est jamais collecté

Identifiant ENT, e-mail, nom, prénom, numéro étudiant, id ou cookie de session, cookies CAS/ENT, notes ou moyennes, contenu ou objet des mails, expéditeurs, échéances Moodle, titres de cours ou de devoirs, salles, enseignants, groupe TP/TD, jours ou semaines consultés dans le Planning, contenu de l'export .ics, texte de recherche, ville météo, URL (avec ou sans paramètres), titre des applications, fond d'écran personnalisé, user-agent complet, adresse IP, géolocalisation. Les messages d'erreur ne sont pas transmis non plus, seulement leur catégorie (`error_kind`).

## Désactivation par l'utilisateur

*Mon compte → Statistiques anonymes* (activé par défaut, visible quand le serveur a une clé PostHog). Le choix est mémorisé par utilisateur dans le `localStorage` (`l-ent:anonymous-analytics`). Quand l'interrupteur est coupé, `track()` ne fait plus rien, la file en attente est vidée immédiatement et l'endpoint ne reçoit plus aucune requête. Le texte « À propos » mentionne la mesure d'audience uniquement quand elle est active.

## Configuration

| Variable | Description | Défaut |
| --- | --- | --- |
| `POSTHOG_PROJECT_KEY` | Clé de projet PostHog (`phc_…`). **Absente = mesure désactivée.** | — |
| `POSTHOG_HOST` | Hôte d'ingestion PostHog | `https://eu.i.posthog.com` (UE) |
| `ANALYTICS_EXCLUDED_USERS` | Identifiants ENT, séparés par `,`, dont le serveur ignore les événements (les développeurs de l'instance) : rien n'est envoyé pour eux, ni événement ni marqueur. | — |
| `POSTHOG_IN_DEV` | `1` pour que le serveur de dev (`npm run dev`) envoie aussi à PostHog. Sans elle, le dev n'envoie rien, même avec une clé dans `.env.local` : les essais, souvent faits avec un vrai compte, ne comptent pas. | coupé |

En production (`node server.js`), elles sont lues dans l'environnement. En dev (`npm run dev`), elles peuvent aussi venir de `.env` / `.env.local`, et PostHog n'est utilisé qu'avec `POSTHOG_IN_DEV=1`. Au `SIGTERM`/`SIGINT`, le serveur vide la file PostHog avant de quitter.

### Réglages à faire dans le projet PostHog

L'exemption repose aussi sur la configuration du projet. L'opérateur de l'instance doit :

1. **Créer le projet sur le cloud UE** (`eu.posthog.com`) et garder `POSTHOG_HOST` sur `https://eu.i.posthog.com`.
2. *Project settings → IP data capture* : activer **« Discard client IP data »**.
3. **Profils de personnes** : laisser désactivé le traitement des profils. Les événements portent déjà `$process_person_profile: false` ; ne jamais appeler `identify()` ni `$set`.
4. **Rétention des données** : **25 mois maximum** (recommandation CNIL : 13 mois pour les traceurs, 25 mois pour les données collectées).
5. **Désactiver** session replay, autocapture, heatmaps, surveys et web vitals. Aucun SDK navigateur n'est chargé, mais cela évite qu'un ajout futur les active par défaut.
6. Ne pas joindre ces données à d'autres sources et ne pas les partager avec des tiers.

## Ajouter un événement

À n'ajouter que pour un vrai besoin produit. Déclarez l'événement et ses propriétés (enums de préférence) dans `server/analyticsSchema.js`, appelez `track('nom', { … })` côté client, puis documentez-le ici. Tout ce qui n'est pas déclaré dans le schéma est supprimé par le serveur.
