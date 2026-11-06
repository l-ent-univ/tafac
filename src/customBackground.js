import { r } from './register.js'

// User-picked dashboard background. The image never leaves the browser: it is
// downscaled and re-encoded client-side, then kept in localStorage (scoped to
// the signed-in user) as a data URL.

export const CUSTOM_BACKGROUND_KEY = 'l-ent:custom-background'

const MAX_WIDTH = 2400
const MAX_HEIGHT = 1600
const QUALITY = 0.82
// Stay well under the ~5 MB localStorage quota shared with the other settings.
const MAX_DATA_URL_LENGTH = 2_500_000

export function getStoredCustomBackground(userId = null) {
  try {
    const stored = JSON.parse(localStorage.getItem(CUSTOM_BACKGROUND_KEY) || 'null')
    if (!stored || typeof stored.value !== 'string' || !stored.value.startsWith('data:image/')) {
      return null
    }
    if (userId && stored.user && stored.user !== userId) {
      return null
    }
    return stored.value
  } catch {
    return null
  }
}

export function clearStoredCustomBackground() {
  try {
    localStorage.removeItem(CUSTOM_BACKGROUND_KEY)
  } catch {
    // Storage unavailable
  }
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }

  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function encodeCanvas(canvas, quality) {
  const webp = canvas.toDataURL('image/webp', quality)
  // Safari < 16 silently falls back to PNG for unsupported types.
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality)
}

// Resizes `file`, stores it for `userId` and returns the data URL.
// Throws an Error with a French, user-facing message on failure.
export async function saveCustomBackground(file, userId = null) {
  if (!file || !/^image\//.test(file.type)) {
    throw new Error(r('Choisis un fichier image (JPEG, PNG, WebP…)', 'Choisissez un fichier image (JPEG, PNG, WebP…)'))
  }

  let image
  try {
    image = await loadImage(file)
  } catch {
    throw new Error('Impossible de lire cette image')
  }

  const scale = Math.min(1, MAX_WIDTH / image.width, MAX_HEIGHT / image.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  image.close?.()

  let dataUrl = encodeCanvas(canvas, QUALITY)
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    dataUrl = encodeCanvas(canvas, 0.6)
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error('Image trop lourde, essaie une image plus petite')
  }

  try {
    localStorage.setItem(CUSTOM_BACKGROUND_KEY, JSON.stringify({ user: userId || null, value: dataUrl }))
  } catch {
    throw new Error('Pas assez d’espace pour enregistrer cette image')
  }

  return dataUrl
}
