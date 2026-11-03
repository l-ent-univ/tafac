import { r } from './register.js'

// User-picked profile photo (Mon compte). Like the custom background, the
// image never leaves the browser: it is cropped to a square, downscaled and
// re-encoded client-side, then kept in localStorage (scoped to the signed-in
// user) as a data URL. No request is made for it, so it shows at once, with
// or without the ENT.

export const CUSTOM_PROFILE_PHOTO_KEY = 'l-ent:custom-profile-photo'

// Sharp at the 72px account avatar on 3x screens, and small (~20-40 KB) so it
// fits next to a custom background in the ~5 MB localStorage quota.
const SIZE = 320
const QUALITY = 0.85
const MAX_DATA_URL_LENGTH = 300_000

function readStored(storage, userId) {
  try {
    const stored = JSON.parse(storage.getItem(CUSTOM_PROFILE_PHOTO_KEY) || 'null')
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

export function getStoredCustomProfilePhoto(userId = null, storage = globalThis.localStorage) {
  if (!storage) return null
  return readStored(storage, userId)
}

export function clearStoredCustomProfilePhoto(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(CUSTOM_PROFILE_PHOTO_KEY)
  } catch {
    // Storage unavailable
  }
}

// The square kept from a `width` × `height` image: centred across, and a bit
// above centre down a portrait, where a face usually is.
export function computeSquareCrop(width, height) {
  const size = Math.min(width, height)
  return {
    sx: Math.round((width - size) / 2),
    sy: Math.round((height - size) * (height > width ? 0.3 : 0.5)),
    size,
  }
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // Phone photos carry their rotation in EXIF: apply it.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Older engines reject the options bag: try the <img> path.
    }
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

// Crops and resizes `file`, stores it for `userId` and returns the data URL.
// Throws an Error with a French, user-facing message on failure.
export async function saveCustomProfilePhoto(file, userId = null) {
  // Some pickers (Android, Files) give no type: let decoding decide then.
  if (!file || (file.type && !/^image\//.test(file.type))) {
    throw new Error(r('Choisis un fichier image (JPEG, PNG, WebP…)', 'Choisissez un fichier image (JPEG, PNG, WebP…)'))
  }

  let image
  try {
    image = await loadImage(file)
  } catch {
    throw new Error(/hei[cf]/i.test(`${file.type} ${file.name}`)
      ? 'Ce navigateur ne lit pas les photos HEIC, choisis un JPEG ou un PNG'
      : 'Impossible de lire cette image')
  }

  const width = image.width || image.naturalWidth
  const height = image.height || image.naturalHeight
  if (!width || !height) {
    image.close?.()
    throw new Error('Impossible de lire cette image')
  }

  const { sx, sy, size } = computeSquareCrop(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(SIZE, size)
  canvas.height = canvas.width
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, sx, sy, size, size, 0, 0, canvas.width, canvas.height)
  image.close?.()

  let dataUrl = encodeCanvas(canvas, QUALITY)
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    dataUrl = encodeCanvas(canvas, 0.6)
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error('Image trop lourde, essaie une autre image')
  }

  try {
    localStorage.setItem(CUSTOM_PROFILE_PHOTO_KEY, JSON.stringify({ user: userId || null, value: dataUrl }))
  } catch {
    throw new Error('Pas assez d’espace sur cet appareil pour enregistrer la photo')
  }

  // Read it back: a storage that drops writes silently would otherwise show
  // the photo now and lose it on the next visit.
  if (getStoredCustomProfilePhoto(userId) !== dataUrl) {
    throw new Error('Ce navigateur n’a pas pu enregistrer la photo')
  }

  return dataUrl
}
