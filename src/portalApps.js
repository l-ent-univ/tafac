// The portal's applications, from the list the server gives (GET
// /__ent_auth/apps) to the tiles the page shows. Pure, see
// tests/portalApps.test.js; AvailableApplications passes the config in.
//
// The list is one model whatever the portal: { id, title, description, url,
// iconUrl, category, favorite }. `id` is the portal's own name for the
// application: the key its favourite, its place and its icon are kept by.
// `url` is where the application is. `favorite`: starred on the portal.

// A tile's key: its id. (A shortcut of the university's config has one too.)
export function getApplicationKey(application = {}) {
  return application.fname || application.id
}

export function compareTitles(left = '', right = '') {
  return String(left).localeCompare(String(right), 'fr', { sensitivity: 'base' })
}

function isWebAddress(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

// The tiles of the list, in its order, each application once.
//   titleOverrides  the university's own names: lowercased portal title →
//                   title shown
//   getCategory     a title's category, or null (the university's keywords)
//   isUnavailable   an application the university leaves out
//   launchRelay     whether a tile opens through the launch relay, which
//                   signs the student in to the application (`relay`)
// An entry without an id, a title or a web address is no tile.
export function toApplications(apps, { titleOverrides = {}, getCategory = () => null, isUnavailable = () => false, launchRelay = false } = {}) {
  const applications = []
  const seenIds = new Set()

  for (const app of Array.isArray(apps) ? apps : []) {
    const id = typeof app?.id === 'string' ? app.id.trim() : ''
    const portalTitle = typeof app?.title === 'string' ? app.title.trim() : ''
    if (!id || !portalTitle || !isWebAddress(app.url) || seenIds.has(id)) {
      continue
    }

    // NFC: the portal may send accents decomposed ("e" + combining accent).
    const title = titleOverrides[portalTitle.normalize('NFC').toLowerCase()] ?? portalTitle
    const application = {
      id,
      // Listed by the portal, as opposed to a shortcut of the config.
      listed: true,
      relay: launchRelay === true,
      title,
      description: typeof app.description === 'string' ? app.description.trim() : '',
      href: app.url.trim(),
      target: '_blank',
      starred: app.favorite === true,
    }
    if (isUnavailable(application)) {
      continue
    }

    const category = getCategory(title)
    if (category) {
      application.category = category
    }

    seenIds.add(id)
    applications.push(application)
  }

  return applications
}

// Puts each app only found among the portal's favourites back among the
// other apps, as if it weren't one: where it sat last time (right after the
// closest app that preceded it and is still listed), or, never seen there,
// at its alphabetical place among the others. Never in a pile at the end.
export function placeInUsualOrder(regularApps, favoriteOnlyApps, rememberedKeys) {
  const rememberedIndex = new Map(rememberedKeys.map((key, index) => [key, index]))
  const result = [...regularApps]
  const unknown = []
  const known = []

  for (const app of favoriteOnlyApps) {
    const index = rememberedIndex.get(getApplicationKey(app))
    if (index === undefined) {
      unknown.push(app)
    } else {
      known.push([index, app])
    }
  }

  known.sort(([left], [right]) => left - right)
  for (const [index, app] of known) {
    let insertAt = 0
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const position = result.findIndex((listed) => getApplicationKey(listed) === rememberedKeys[previous])
      if (position !== -1) {
        insertAt = position + 1
        break
      }
    }
    result.splice(insertAt, 0, app)
  }

  unknown.sort((left, right) => compareTitles(left.title, right.title))
  for (const app of unknown) {
    const position = result.findIndex((listed) => compareTitles(listed.title, app.title) > 0)
    result.splice(position === -1 ? result.length : position, 0, app)
  }

  return result
}

// The full list in its usual order. A portal that moves a starred app out
// of its list (uPortal: into its favourites folder) leaves it at the end of
// the server's list, with the others it starred: that last run of starred
// apps is put back among the rest (placeInUsualOrder), `rememberedKeys`
// being the order shown last time.
export function orderApplications(applications, rememberedKeys = []) {
  let regularCount = applications.length
  while (regularCount > 0 && applications[regularCount - 1].starred) {
    regularCount -= 1
  }
  // Every app starred: the portal's own order is all there is.
  if (regularCount === 0) {
    return [...applications]
  }

  return placeInUsualOrder(applications.slice(0, regularCount), applications.slice(regularCount), rememberedKeys)
}

// The favourites' keys, which stay in the browser. `storedKeys`: what the
// browser holds, null when it never held any: the favourites then start
// from the apps starred on the portal, once. `seeded` says so, for the
// caller to store them.
export function resolveFavoriteKeys(storedKeys, applications) {
  if (Array.isArray(storedKeys)) {
    return { keys: storedKeys.filter((key) => typeof key === 'string'), seeded: false }
  }

  return {
    keys: applications.filter((application) => application.starred).map(getApplicationKey),
    seeded: true,
  }
}
