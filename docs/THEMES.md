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

Une palette, c'est deux nombres : `--p-hue` (teinte OKLCH, 0–360) et `--p-tint` (force de la teinte des surfaces, 1 = celle des préréglages, de 0,3 à 1,5). `src/theme.js` les pose en style inline sur `<html>` avec la marque qu'il en déduit (`--p-brand-l`, `--p-brand-c` : la luminosité la plus haute qui garde 4,5:1 sous du texte blanc et sur la surface discrète, et le chroma que la teinte demande dans la limite du gamut sRGB, `brandFor`). La recette de `tokens.css`, un seul bloc `:root[data-palette]`, en tire les surfaces, l'encre, la marque et les matières, en clair et en sombre. L'encre discrète y est à 70 % (64 % en sombre) : 4,5:1 ou plus sur toutes les surfaces, quelle que soit la teinte.

Un troisième nombre, `--p-contrast` (0 à 1, 0,5 par défaut), règle le contraste, comme le curseur d'Arc. Sous le milieu, l'encre s'adoucit, les surfaces se rapprochent de la page (`--p-depth`) et les traits pâlissent ; au-dessus, l'encre fonce et les traits s'affirment, les surfaces gardant leurs écarts (la marque est vérifiée contre elles). L'encre discrète garde 4,5:1 partout : en contraste doux, elle prend une plus grande part de l'encre (`--p-soften`). Sable n'en tient pas compte.

### Le sélecteur

Une carte des réglages comme les autres : le pavé à 8 px des bords, ses coins concentriques à ceux de la carte (`modal-nested-corners` : les 20 px de la carte moins ces 8 px) ; à côté, le nom du choix et sa description, et les préréglages dans une piste comme celle du sélecteur segmenté ; sur un téléphone, le pavé prend la largeur et le reste passe dessous. Une fois une autre palette que Sable choisie, deux lignes se déplient dessous : « Contraste » (`PaletteContrast`, un curseur ; la page suit en direct, la valeur est gardée au relâchement) et « Revenir à Sable ».

Le centre est aimanté : à moins d'un tiers du rayon, le point traîne de plus en plus derrière le pointeur, s'accroche à Sable en dessous de 20 % et ne s'en détache qu'au-delà de 27 %, pour ne pas clignoter à la limite.

`PalettePicker` (`src/components/PalettePicker.jsx`), à la manière d'Arc : un pavé dont la teinte fait le tour (rouge en haut, dans le sens horaire) et dont l'intensité croît du centre vers le bord. Un point se déplace dessus ; toute l'interface suit pendant le geste, et le choix est gardé au relâchement. Le centre (16 % du rayon) est Sable : le retour au défaut est le même geste. Sous le pavé, les préréglages (`PALETTES` : Océan, Forêt, Lavande, Rose, Corail, Soleil), des points sur le pavé ; un tap y amène le point, et un choix qui tombe exactement dessus reprend leur nom, sinon celui de sa famille de teinte (`hueName` : Rose, Rouge, Corail, Orange, Ambre, Jaune, Citron, Vert, Émeraude, Turquoise, Cyan, Bleu, Indigo, Violet, Pourpre). Au clavier, le pavé est un curseur : flèches gauche et droite pour la teinte (6°, 30° avec Maj), haut et bas pour l'intensité, sous le minimum c'est Sable, Début aussi.

Le geste ne passe pas par React : les mouvements du pointeur sont regroupés en une image (`requestAnimationFrame`), qui écrit la position et la couleur du point en variables sur le pavé, le nom et le texte du curseur directement dans le DOM, puis peint la page (`applyPalette`, avec `live`). Le point ne bouge que par `translate` (en unités de conteneur, `cqw`), sans transition pendant le geste ; React ne rend qu'au relâchement. Au doigt (ou au stylet), le point est caché : une loupe au-dessus montre la couleur et son nom. Le coût qui reste par image est celui de la page elle-même : un recalcul de style de tout le document et un rafraîchissement de tout ce qui est teinté, inhérent à la prévisualisation en direct.

Entre deux choix (préréglage, clavier, relâchement depuis Sable exclu), l'interface glisse d'une couleur à l'autre : `--p-hue`, `--p-tint`, `--p-brand-l` et `--p-brand-c` sont enregistrées par `@property` dans `tokens.css` et ont une transition de 320 ms sur `:root[data-palette]`. `applyPalette` écrit la teinte sous l'angle le plus proche de l'actuel (355 → 35 s'écrit 395) pour prendre le court chemin ; `data-palette-live` (posé pendant le geste, et deux images en quittant Sable, qui n'a rien d'où glisser) coupe la transition. `prefers-reduced-motion` la coupe aussi, comme les mouvements du point et de la loupe.

### Stockage

`l-ent:palette` garde `{ value, hue, tint, brandL, brandC, contrast }` : l'id du préréglage ou `custom`, et les nombres que le script de `index.html` pose sur `<html>` avant le premier rendu (il ne fait que lire, bornes vérifiées ; `theme.js` recalcule la marque depuis la teinte une fois l'application chargée). Sable n'enregistre rien, sauf un contraste autre que celui du milieu (`{ value: 'sand', contrast }`), gardé pour la palette suivante. La couleur de la barre du navigateur (`theme-color`) est la couleur de page du thème, calculée en JS (`paletteColors`, `src/oklch.js`).

Ajouter un préréglage : une ligne dans `PALETTES` (id, nom, teinte, intensité), rien d'autre. `tests/themePalettes.test.js` vérifie que la recette de `tokens.css` est celle qu'il mesure, que `index.html` lit bien les nombres, et, pour les 360 teintes, les intensités du pavé et cinq contrastes, que la marque et l'encre discrète tiennent 4,5:1 sur les surfaces, en clair et en sombre.

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
