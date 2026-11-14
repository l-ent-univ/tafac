import universityConfig from '@university'
import tafacAerial from './assets/wallpapers/tafac/aerial.webp'
import tafacLake from './assets/wallpapers/tafac/lake.webp'
import tafacLanterns from './assets/wallpapers/tafac/lanterns.webp'
import tafacPlanet from './assets/wallpapers/tafac/planet.webp'

// Tafac's own scenes (the icon hills renders), the same for every university,
// and the photos of one that has none.
const TAFAC_HERO_IMAGES = [
  { src: tafacLake, position: 'center 45%', credit: null },
  { src: tafacPlanet, position: 'center 40%', credit: null },
  { src: tafacLanterns, position: 'center 40%', credit: null },
  { src: tafacAerial, position: null, credit: null },
]

function normalizeHeroImages(images) {
  if (!Array.isArray(images)) {
    return []
  }

  return images
    .map((image) => (typeof image === 'string' ? { src: image } : image))
    .filter((image) => image && typeof image.src === 'string' && image.src)
    .map((image) => ({
      src: image.src,
      position: image.position ?? null,
      credit: image.credit ?? null,
    }))
}

function getDayIndex(date) {
  return Math.floor(date.getTime() / 86_400_000)
}

// Photos the dashboard can show for an establishment: its own first, then the
// university's. Empty when neither configures any (Tafac's are used).
export function listHeroImages(establishment = null) {
  const establishmentImages = normalizeHeroImages(
    universityConfig.establishments?.byId?.[establishment]?.heroImages,
  )
  const universityImages = normalizeHeroImages(universityConfig.branding?.heroImages)
  return establishmentImages.length > 0 ? establishmentImages : universityImages
}

// A folder's photos: Tafac's scenes, or the establishment's or university's
// (none when neither configures any: no such folder then).
export function listWallpaperFolderImages(folder, establishment = null) {
  return folder === 'tafac' ? TAFAC_HERO_IMAGES : listHeroImages(establishment)
}

// Hero photo for the dashboard, from the chosen folder: the university's
// (the establishment's photos first, then the university's), or Tafac's,
// also when the university has none. With several photos, the pick rotates
// daily so it stays stable within a day. `offset` shifts the pick (debug
// menu).
export function resolveHeroImage(establishment = null, date = new Date(), offset = 0, folder = 'university') {
  const ownImages = folder === 'tafac' ? [] : listHeroImages(establishment)
  const candidates = ownImages.length > 0 ? ownImages : TAFAC_HERO_IMAGES
  const count = candidates.length
  return candidates[(((getDayIndex(date) + offset) % count) + count) % count]
}
