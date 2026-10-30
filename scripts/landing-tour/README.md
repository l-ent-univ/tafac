# Vidéos de la landing page

Ce générateur reprend le pipeline CDP et l’encodage à 60 images/s des scripts
`rec-lib.mjs`, `rec-run.mjs`, `rec-desk.mjs` et `rec-desk-encode.sh` retrouvés
dans l’historique de création des vidéos. Les fichiers temporaires d’origine
avaient disparu. Le scénario est désormais conservé dans `record.mjs`.

## Scènes

| Bloc | Démonstration |
| --- | --- |
| Ordinateur : préparer sa semaine | Planning en vue semaine |
| Ordinateur : résultats | Moyennes, simulateur : une UE, un 18 ajouté, la moyenne qui monte |
| Ordinateur : mails | Mail de la scolarité, réponse rédigée, document fictif joint |
| Ordinateur : outils | Retour à l’accueil, sur la liste des applications |
| Téléphone : prochaine salle | Carte du prochain cours avec salle et horaire |
| Téléphone : notes | Ouverture de Mes notes |
| Téléphone : mails | Mail de la scolarité et rédaction d’une réponse |
| Téléphone : rendus | Carte des échéances Moodle sur l’accueil |

Aucun mail n’est envoyé. Le compte utilisé est exclusivement le compte démo.
Pendant la prise, le pied de page (« dev · branche ») et les logos de
l’établissement (à côté de celui de Tafac, dans la signature) sont masqués.
Chaque scène produit une image PNG de contrôle. Un contrôle absent interrompt
la capture plutôt que de produire une vidéo qui saute silencieusement une étape.

## Enregistrer

Prérequis : Node avec WebSocket natif, Chromium avec CDP et ffmpeg (libx264,
libwebp), serveur de développement Tafac avec ses routes d’authentification.

1. Démarrer le serveur local : `npm run dev -- --port 5199 --strictPort`.
2. Lancer une instance Chromium dédiée avec `--remote-debugging-port=9223`,
   un `--user-data-dir` temporaire neuf et un seul onglet `about:blank`.
   Ne pas utiliser le profil personnel : le script se connecte au premier onglet.
3. Lancer une capture :

```sh
TOUR_OUTPUT=/tmp/tafac-phone-light node scripts/landing-tour/record.mjs
TOUR_OUTPUT=/tmp/tafac-phone-dark node scripts/landing-tour/record.mjs --dark
TOUR_OUTPUT=/tmp/tafac-desktop-light node scripts/landing-tour/record.mjs --desktop
TOUR_OUTPUT=/tmp/tafac-desktop-dark node scripts/landing-tour/record.mjs --desktop --dark
```

Utiliser une instance et un profil Chromium neufs pour chaque commande : les
favoris, brouillons et préférences de la prise précédente ne doivent pas revenir.
`TOUR_URL` peut préciser une autre URL locale (défaut :
`http://localhost:5199/rennes`), `TOUR_CDP_URL` une autre adresse CDP.
Les durées de lecture sont explicites dans `record.mjs` ; les dates du planning
proviennent du compte démo, sans jour du mois codé en dur.

## Encoder et vérifier

```sh
zsh scripts/landing-tour/rec-encode.sh /tmp/tafac-phone-light
W=1920 H=1200 zsh scripts/landing-tour/rec-encode.sh /tmp/tafac-desktop-light
```

Répéter l’encodage pour les prises sombres. Chaque dossier reçoit `tour.mp4` et
`poster.webp` (si ffmpeg n’a pas libwebp : `ffmpeg -i tour.mp4 -frames:v 1
poster.png` puis `cwebp -q 82 poster.png -o poster.webp`). Le dossier `out` doit être absent avant l’encodage.
Vérifier les PNG, lire la vidéo entière, contrôler la lisibilité, les transitions,
la boucle et la taille avant de remplacer les assets. Le 60 fps de sortie ne
garantit pas 60 images distinctes par seconde si la capture a ralenti.

Les destinations sont dans `src/assets/landing/` :

| Prise | Vidéo | Poster |
| --- | --- | --- |
| Téléphone clair | app-tour.mp4 | app-tour-poster.webp |
| Téléphone sombre | app-tour-dark.mp4 | app-tour-dark-poster.webp |
| Ordinateur clair | app-tour-desktop.mp4 | app-tour-desktop-poster.webp |
| Ordinateur sombre | app-tour-desktop-dark.mp4 | app-tour-desktop-dark-poster.webp |

La capture et l’encodage ne remplacent pas automatiquement les vidéos en place.
Après remplacement, adapter les descriptions accessibles des deux mockups aux
scènes réellement enregistrées.

Dernière prise : 29 octobre 2026 (téléphone environ 21 s, ordinateur
environ 30 s). Le rechargement après la réponse est coupé au montage.
