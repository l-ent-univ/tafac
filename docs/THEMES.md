# Couleurs et thèmes

Toutes les couleurs de l'interface passent par `src/tokens.css`, en trois couches. Chaque couche ne lit que celle du dessus.

1. **Palette** : les couleurs brutes, nommées pour ce qu'elles sont (`--sand-1`, `--night-3`, `--red-700`). Lues seulement dans `tokens.css`.
2. **Rôles** : ce à quoi sert une couleur (`--surface-card`, `--ink-muted`, `--line`, `--danger`). Les composants et `overrides.css` n'utilisent que ça, jamais un hex.
3. **Thèmes** : `[data-theme]` associe les rôles à la palette. Ajouter un thème, c'est ajouter un bloc en bas de `tokens.css`, rien d'autre.

## Les rôles

| Rôle | Classe Tailwind | Pour | Ancien nom |
|---|---|---|---|
| `--surface-page` | `bg-page` | fond de la page | `bg-bg` |
| `--surface-sunken` | `bg-sunken` | creux : piste d'un sélecteur, zone en retrait | `bg-bg-surface` |
| `--surface-subtle` | `bg-subtle` | fond discret, survol d'une carte | `bg-bg-subtle` |
| `--surface-strong` | `bg-strong` | remplissage marqué : puce, squelette | `bg-bg-muted` |
| `--surface-field` | `bg-field` | champ de saisie | `bg-bg-input` |
| `--surface-card` | `bg-card` | carte, widget, feuille | `bg-widget-bg` |
| `--surface-raised` | `bg-raised` | menu, popover | `bg-context-bg` |
| `--surface-thumb` | — | curseur d'un sélecteur segmenté | `#ffffff`, `#383838` |
| `--ink` | `text-ink` | texte principal, icônes | `text-text` |
| `--ink-secondary` | `text-ink-secondary` | texte secondaire | `text-text-secondary` |
| `--ink-muted` | `text-ink-muted` | légende, date, aide | `text-text-muted` |
| `--ink-faint` | `text-ink-faint` | désactivé, placeholder | `text-text-30` |
| `--line` / `--line-strong` | `border-line` / `border-line-strong` | séparateur / bord de champ | `border-border` / `border-border-input` |
| `--state-hover` / `--state-press` | `bg-state-hover` / `bg-state-press` | voile d'encre au survol, à l'appui | nouveau |
| `--brand` / `--on-brand` | `bg-brand` / `text-on-brand` | bouton plein et son texte | `bg-brand` / `text-bg` |
| `--brand-soft` | `bg-brand-soft` | sélection, bouton léger | `bg-brand-subtle` |
| `--danger`, `--warning`, `--success`, `--info` (+ `-soft`) | `text-danger`, `bg-danger-soft`… | états | `text-error`… ; `warning` et `info` nouveaux |
| `--favorite`, `--flag`, `--notify` | `text-favorite`, `text-flag`, `bg-notify` | étoile, drapeau du mail, pastille | `#eab308`, `#f0932b`, `#2563eb` |
| `--scrim` / `--shadow-tint` | `bg-scrim` | voile derrière une feuille / teinte des ombres | `bg-backdrop` / `--color-shadow` |
| `--on-photo` | `text-on-photo` | texte sur le fond d'écran | `text-white` |

Les nuances intermédiaires d'encre passent par l'opacité de Tailwind (`text-ink/60`, `border-ink/16`) ou, en CSS, `color-mix(in srgb, var(--ink) 16%, transparent)`. Pas de `rgb(52 18 0 / …)` ni de `rgb(255 255 255 / …)` : l'encre change de couleur avec le thème, le littéral non.

## Palettes

Deuxième axe à côté de clair/sombre : `<html data-palette>` teinte toute l'interface à partir d'une teinte (Réglages › Apparence › Couleurs). Sable, la palette d'origine, ne pose pas d'attribut et garde ses couleurs telles quelles.

Une palette, c'est deux nombres : `--p-hue` (teinte OKLCH, 0–360) et `--p-tint` (force de la teinte des surfaces, 1 = celle des préréglages ; de 0,3 à 1,5 sur le cadran, 2 au cran 11). `src/theme.js` les pose en style inline sur `<html>` avec la marque qu'il en déduit (`--p-brand-l`, `--p-brand-c` : la luminosité la plus haute qui garde 4,5:1 sous du texte blanc et sur la surface discrète, et le chroma que la teinte demande dans la limite du gamut sRGB, `brandFor`). La recette de `tokens.css`, un seul bloc `:root[data-palette]`, en tire les surfaces, l'encre, la marque et les matières, en clair et en sombre. L'encre discrète y est à 70 % (64 % en sombre) : 4,5:1 ou plus sur toutes les surfaces, quelle que soit la teinte.

Un troisième nombre, `--p-contrast` (0 à 1), reste dans la recette, fixé à 0,5 : les réglages n'ont plus de curseur pour lui et rien ne le pose. Sous le milieu, l'encre s'adoucirait, les surfaces se rapprocheraient de la page (`--p-depth`) et les traits pâliraient ; au-dessus, l'encre foncerait et les traits s'affirmeraient. Les tests gardent la recette juste à tous les contrastes, pour le jour où il reviendrait.

### Le sélecteur

`PalettePicker` (`src/components/PalettePicker.jsx`), à la manière de Dia. Une ligne de la carte des réglages : le nom du choix, puis une rangée de pastilles, une par préréglage (`PALETTES` : Sable, Océan, Forêt, Lavande, Rose, Corail, Soleil). Sable, la première, est le retour aux couleurs d'origine. Un tap choisit une couleur ; elle garde l'intensité déjà réglée (celle du milieu en venant de Sable). La pastille choisie porte un anneau et, sauf Sable, un crayon : un second tap ouvre le cadran dessous. Sur un téléphone, les pastilles passent sous le nom. L'intensité ne se lit que sur le cadran.

Le cadran (`IntensityDial`) règle l'intensité, de 1 à 10 : un bouton dans un anneau, onze repères autour (le premier est le pied de l'échelle, toujours allumé ; un cran tous les 22,5°, le 5 en haut), une étoile après le dernier et un petit afficheur à sept segments. `INTENSITY_TINTS` (`src/theme.js`) donne la teinte de chaque cran : 0,3 au 1, 1 au 5 (celle des préréglages), 1,5 au 10. On tourne le bouton en faisant le tour avec le pointeur, n'importe où sur le cadran : il saute de cran en cran avec un ressort, les repères s'allument jusqu'à lui, le fond du cadran se charge de la couleur et toute l'interface suit ; le choix est gardé au relâchement. Un appui sur l'échelle y envoie le bouton. Le bouton ne traverse jamais le vide du bas : poussé au-delà d'un bout, il y reste jusqu'à ce que le pointeur revienne.

Le 11 : en tournant au-delà du 10 jusqu'à l'étoile (à 4° près ; il ne lâche qu'à mi-chemin du 10), le cadran passe à 11. Les repères gonflent, des éclats partent de l'anneau, l'afficheur s'éclaire, et la teinte monte à 2 : à 10 les surfaces les plus claires sont déjà au bord du sRGB sur la plupart des teintes, le 11 fonce donc les autres et le thème sombre. Les contrastes tiennent (voir les tests).

Au clavier : les flèches passent d'une pastille à l'autre ; sur le cadran, elles tournent d'un cran (au-dessus de 10, c'est 11), Début et Fin vont aux bouts de l'échelle, Échap ou Tab le referme et rend le focus à la pastille. Un appui ailleurs, un défilement ou un redimensionnement le referme aussi. Le cadran est dans un portail, en position fixe sous la pastille (au-dessus s'il n'y a pas la place), pour que la carte et le panneau qui défile ne le coupent pas.

Une teinte gardée d'avant les pastilles, qu'aucune ne porte, a la sienne en bout de rangée, nommée d'après sa famille (`hueName` : Rose, Rouge, Corail, Orange, Ambre, Jaune, Citron, Vert, Émeraude, Turquoise, Cyan, Bleu, Indigo, Violet, Pourpre). Un préréglage garde son nom à toute intensité ; hors du cran 5, son id stocké est `custom`.

Les couleurs du cadran sont les siennes (`--dial-hue`, `--dial-level`, dans `overrides.css`), comme celles d'un cours : la couleur réglée est la donnée. Pendant le geste, React ne rend qu'à chaque changement de cran, et la page n'est repeinte qu'à ce moment (`applyPalette`). Le coût par cran est celui de la page elle-même : un recalcul de style de tout le document et un rafraîchissement de tout ce qui est teinté.

Entre deux choix (une pastille, un cran du cadran, une touche ; pas en quittant Sable), l'interface glisse d'une couleur à l'autre : `--p-hue`, `--p-tint`, `--p-brand-l` et `--p-brand-c` sont enregistrées par `@property` dans `tokens.css` et ont une transition de 320 ms sur `:root[data-palette]`. `applyPalette` écrit la teinte sous l'angle le plus proche de l'actuel (355 → 35 s'écrit 395) pour prendre le court chemin ; `data-palette-live` (posé deux images en quittant Sable, qui n'a rien d'où glisser) coupe la transition. `prefers-reduced-motion` la coupe aussi, comme le ressort du bouton et les éclats du 11.

### Stockage

`l-ent:palette` garde `{ value, hue, tint, brandL, brandC }` : l'id du préréglage ou `custom`, et les nombres que le script de `index.html` pose sur `<html>` avant le premier rendu (il ne fait que lire, bornes vérifiées ; `theme.js` recalcule la marque depuis la teinte une fois l'application chargée). Sable n'enregistre rien. Un `contrast` resté d'avant le retrait du curseur est ignoré. La couleur de la barre du navigateur (`theme-color`) est la couleur de page du thème, calculée en JS (`paletteColors`, `src/oklch.js`).

Ajouter un préréglage : une ligne dans `PALETTES` (id, nom, teinte, intensité), rien d'autre. `tests/themePalettes.test.js` vérifie que la recette de `tokens.css` est celle qu'il mesure, que `index.html` lit bien les nombres, et, pour les 360 teintes, les onze crans du cadran et cinq contrastes, que la marque et l'encre discrète tiennent 4,5:1 sur les surfaces, en clair et en sombre.

Ce qui ne suit pas encore une palette : les couleurs écrites en dur, qui attendent l'étape 2 de la migration (un bouton crème ici, un gris neutre là).

## Matières

Une matière redéfinit des rôles de surface sur un conteneur : tout ce qu'il contient suit. C'est déjà le cas du verre des widgets (`.widget-card` dans `overrides.css`) et des cartes pleines sans fond d'écran (`.dashboard-no-wallpaper`). Les classes de rôle sont en `@theme inline` : `bg-card` lit `--surface-card` là où il est utilisé, donc une matière l'atteint.

Attention : redéfinir un rôle ne change pas les anciens noms dérivés de lui (`--color-widget-bg` est calculé une fois sur `:root`). Tant que la migration n'est pas finie, une matière redéfinit les deux.

## Règles

- Pas de hex, `rgb()` ou couleur Tailwind (`bg-white`, `text-black`, `bg-[#1c1c1c]`) hors de `tokens.css`. Exceptions : les couleurs de données (cours, UE, notes, météo), qui viennent du JS, et les images générées en canvas.
- Pas de `dark:` pour une couleur : si une couleur change avec le thème, c'est un rôle. `dark:` reste pour ce qui n'est pas une couleur (`dark:invert`, `dark:hidden`).
- Un besoin sans rôle : ajouter le rôle dans les deux thèmes, pas un littéral.

## Migration

État de départ (9 novembre 2026) : 408 couleurs littérales dans `overrides.css`, 93 classes arbitraires et 163 couleurs Tailwind dans le JSX, 146 variantes `dark:`.

1. **Fondation** (fait) : `tokens.css`, rôles dans Tailwind, anciens noms en alias à l'identique. Aucun changement visible : les 27 anciennes variables donnent la même valeur dans les deux thèmes.
2. **Remplacement mécanique**, sans changement visible : anciens noms vers les rôles dans le JSX (`text-text-muted` → `text-ink-muted`…), littéraux d'encre et de blanc/noir translucides vers les rôles dans `overrides.css`, paires `x dark:y` remplacées par un seul rôle. Une page par PR.
3. **Décisions visuelles**, une à une :
   - `--ink-muted` clair de 50 % à 62 % : 3,35:1 aujourd'hui sur la page, sous le minimum AA (4,5:1) ; 4,87:1 à 62 %. 328 usages.
   - Fusionner les quasi-doublons : `--surface-sunken`/`--surface-subtle` (`#efede7`/`#edebe5`, `#1a1a1a`/`#1e1e1e`), les cinq rouges (`#b91c1c`, `#d1342f`, `#dc2626`, `#f87171`, `#ff6b63`) en `--danger`.
   - Survol par voile (`--state-hover`) au lieu d'une surface redéfinie par matière.
   - `#b76e00` (avertissement, 4,0:1) remplacé par `--warning` (`#9a5b00`, 5,2:1).
4. **Nouveaux thèmes** : les palettes de couleur sont faites (voir plus haut). Restent candidats Noir (OLED, page `#000`) et contraste élevé automatique (`prefers-contrast: more`).
5. **Garde-fou** : un test qui compte les littéraux hors de `tokens.css` et échoue s'il augmente.
