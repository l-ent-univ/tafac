// The skeleton library (skullet) remembers each card's shape for the next
// visit, in localStorage (`skullet:shapes`): a copy of the card's markup
// with every letter and digit of its text replaced. Its attributes stay,
// though, and some carry the text itself: an aria-label (« Dernière note :
// 15,5 sur 20, Revue de presse »), a title, a link's address. Grades and
// mail subjects are not to rest in the browser (src/entApi.js), so those
// attributes are taken off what is written. Imported first by main.jsx,
// before anything draws.
export const SKELETON_SHAPES_KEY = 'skullet:shapes'

// The markup is a serialized DOM: every attribute value is in double quotes,
// its own quotes escaped.
const TEXT_ATTRIBUTES = / (?:aria-label|aria-description|aria-valuetext|aria-placeholder|title|href|download|placeholder)="[^"]*"/gi

export function scrubShapeMarkup(markup) {
  return typeof markup === 'string' ? markup.replace(TEXT_ATTRIBUTES, '') : markup
}

// The stored value, `{ v, shapes: { id: markup } }`, without those attributes.
// Anything else is written as it is.
export function scrubStoredShapes(value) {
  try {
    const stored = JSON.parse(value)
    if (!stored || typeof stored.shapes !== 'object' || stored.shapes === null) return value
    const shapes = Object.fromEntries(Object.entries(stored.shapes).map(([id, markup]) => [id, scrubShapeMarkup(markup)]))
    return JSON.stringify({ ...stored, shapes })
  } catch {
    return value
  }
}

// skullet writes with localStorage.setItem and offers no hook: that one key
// is cleaned on its way in.
export function installSkeletonPrivacy(storagePrototype = globalThis.Storage?.prototype) {
  if (!storagePrototype || storagePrototype.setItem.skeletonPrivacy) return
  const setItem = storagePrototype.setItem
  function setItemScrubbed(key, value) {
    return setItem.call(this, key, key === SKELETON_SHAPES_KEY ? scrubStoredShapes(String(value)) : value)
  }
  setItemScrubbed.skeletonPrivacy = true
  storagePrototype.setItem = setItemScrubbed
}

installSkeletonPrivacy()
