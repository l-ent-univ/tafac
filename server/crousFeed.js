// CROUS restaurants and their menus, from the feeds behind the official
// « Crous Mobile » app (one region per feed: resto.xml lists the places,
// menu.xml their menus for the coming days, as HTML in CDATA). Public data,
// no sign-in. Plain-text parsing: the feeds' shape is stable and small.

const FEED_ORIGIN = 'http://webservices-v2.crous-mobile.fr/feed'
const FEED_TIMEOUT_MS = 12_000

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

function stripTags(html) {
  return decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function readAttributes(tag) {
  const attributes = {}
  for (const match of tag.matchAll(/([a-z_0-9]+)="([^"]*)"/gi)) {
    attributes[match[1]] = decodeEntities(match[2])
  }
  return attributes
}

function readCdata(text) {
  const match = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(text)
  return match ? match[1] : text
}

// "MIDI : 11h15-13h45, du lundi au vendredi" from the resto's info HTML.
function readOpeningHours(infoHtml) {
  const match = /<h2>\s*Horaires\s*<\/h2>\s*<p>([\s\S]*?)<\/p>/i.exec(infoHtml)
  return match ? stripTags(match[1]) || null : null
}

// resto.xml → [{ id, title, zone, type, lat, lon, hours, description }]
export function parseCrousRestaurants(xml) {
  const restaurants = []
  for (const match of String(xml ?? '').matchAll(/<resto\s([^>]*)>([\s\S]*?)<\/resto>/g)) {
    const attributes = readAttributes(match[1])
    if (!attributes.id || !attributes.title) continue
    const lat = attributes.lat ? Number(attributes.lat) : Number.NaN
    const lon = attributes.lon ? Number(attributes.lon) : Number.NaN
    restaurants.push({
      id: attributes.id,
      title: attributes.title.trim(),
      zone: attributes.zone?.trim() || null,
      type: attributes.type?.trim() || null,
      description: attributes.short_desc?.trim() || null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      hours: readOpeningHours(readCdata(match[2])),
      // closing="1": the place says it's closed for now.
      closed: attributes.closing === '1',
    })
  }
  return restaurants
}

// One day's HTML → [{ name: 'midi', notice, sections: [{ title, items }] }].
// Sections come as "2 - Plats chauds": sorted by their number, which is
// then dropped. A meal without sections carries the CROUS's notice
// ("Structure fermée du …") instead.
export function parseMenuHtml(html) {
  const meals = []
  const parts = String(html ?? '').split(/<h2>/i).slice(1)
  for (const part of parts) {
    const [nameHtml, rest = ''] = part.split(/<\/h2>/i)
    const sections = []
    const notices = []
    for (const block of rest.split(/<h4>/i).slice(1)) {
      const [titleHtml, body = ''] = block.split(/<\/h4>/i)
      const title = stripTags(titleHtml)
      // "menu non communiqué" is the CROUS's placeholder, not a dish.
      const items = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((item) => stripTags(item[1]))
        .filter((item) => item && !/^menu non communiqu/i.test(item))
      if (items.length) {
        const order = /^(\d+)\s*-\s*/.exec(title)
        sections.push({ order: order ? Number(order[1]) : 99, title: title.replace(/^\d+\s*-\s*/, '') || 'Menu', items })
      } else if (title) {
        notices.push(title)
      }
    }
    sections.sort((left, right) => left.order - right.order)
    meals.push({
      name: stripTags(nameHtml) || 'midi',
      notice: notices.join(' ') || null,
      sections: sections.map(({ title, items }) => ({ title, items })),
    })
  }
  return meals
}

// menu.xml → Map(restoId → [{ date: 'YYYY-MM-DD', meals }]) by date.
export function parseCrousMenus(xml) {
  const menus = new Map()
  for (const match of String(xml ?? '').matchAll(/<resto\s+id="([^"]+)">([\s\S]*?)<\/resto>/g)) {
    const days = []
    for (const menu of match[2].matchAll(/<menu\s+date="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/menu>/g)) {
      days.push({ date: menu[1], meals: parseMenuHtml(readCdata(menu[2])) })
    }
    days.sort((left, right) => left.date.localeCompare(right.date))
    menus.set(match[1], days)
  }
  return menus
}

async function fetchFeed(region, file, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${FEED_ORIGIN}/${encodeURIComponent(region)}/externe/${file}`, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`CROUS feed ${file} answered ${response.status}`)
    }
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

// Both feeds of a region, kept `ttlMs`: { restaurants, menus, fetchedAt }.
// A failed refresh keeps serving the last good copy.
export function createCrousFeed({ region, ttlMs = 30 * 60 * 1000, fetchImpl = globalThis.fetch } = {}) {
  let cached = null
  let pending = null

  async function load() {
    const [restoXml, menuXml] = await Promise.all([
      fetchFeed(region, 'resto.xml', fetchImpl),
      fetchFeed(region, 'menu.xml', fetchImpl),
    ])
    cached = { restaurants: parseCrousRestaurants(restoXml), menus: parseCrousMenus(menuXml), fetchedAt: Date.now() }
    return cached
  }

  return async function getFeed() {
    if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached
    pending ??= load().finally(() => { pending = null })
    try {
      return await pending
    } catch (error) {
      if (cached) return cached
      throw error
    }
  }
}
