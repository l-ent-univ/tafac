// The dashboard wallpaper picked in Réglages › Apparence: a folder's photo
// of the day (`image: null`), one photo of a folder (`image`: its src), or
// the student's own image (`folder: 'custom'`).

export const WALLPAPER_FOLDERS = ['university', 'tafac']

// A stored choice, or null when it isn't one.
export function normalizeWallpaperChoice(value) {
  if (!value || typeof value !== 'object') return null
  if (value.folder === 'custom') return { folder: 'custom', image: null }
  if (!WALLPAPER_FOLDERS.includes(value.folder)) return null
  return { folder: value.folder, image: typeof value.image === 'string' && value.image ? value.image : null }
}

// The photo of the day of the university's folder, or of Tafac's when the
// university has no photos (no such folder then).
export function defaultWallpaperChoice(folderImages = () => []) {
  return { folder: folderImages('university').length > 0 ? 'university' : 'tafac', image: null }
}

// What shows. Never picked: the student's own image when there is one (as
// before the gallery), else the default (above). Their own image picked but
// since removed, or a folder without photos: the default. A picked photo no
// longer in its folder (a new build renamed it, the university dropped
// it): that folder's photo of the day.
// `folderImages(folder)` lists a folder's photos ({ src }).
export function effectiveWallpaperChoice(choice, { hasCustom = false, folderImages = () => [] } = {}) {
  const fallback = defaultWallpaperChoice(folderImages)
  if (!choice) return hasCustom ? { folder: 'custom', image: null } : fallback
  if (choice.folder === 'custom') return hasCustom ? choice : fallback
  if (folderImages(choice.folder).length === 0) return fallback
  if (choice.image && !folderImages(choice.folder).some((image) => image.src === choice.image)) {
    return { folder: choice.folder, image: null }
  }
  return choice
}

export function isSameWallpaperChoice(a, b) {
  return Boolean(a && b) && a.folder === b.folder && (a.image ?? null) === (b.image ?? null)
}

// The analytics value of a choice: which folder, a daily photo or one
// picked (never which photo).
export function wallpaperChoiceAnalyticsValue(choice) {
  if (choice.folder === 'custom') return 'custom'
  return `${choice.folder}_${choice.image ? 'photo' : 'daily'}`
}
