// The student's photo as the account data or the ENT give it, made into an
// <img> source: the account modal shows it, the debug menu inspects it.
import { ENT_ORIGIN, buildEntProxyHref } from './entApi'

// A query token so the browser fetches the photo again instead of its cache.
export function appendPreviewToken(url, token) {
  if (!url) {
    return null
  }

  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}ts=${encodeURIComponent(token)}`
}

const PROFILE_PHOTO_KEY_PATTERN = /(?:^|[_-])(picture|photo|avatar|portrait|image)(?:$|[_-])/i

function normalizeProfilePhotoSource(value) {
  const source = String(value ?? '').trim()

  if (!source) {
    return null
  }

  if (/^data:image\//i.test(source)) {
    return {
      src: source,
      kind: 'data-uri',
    }
  }

  if (/^https?:\/\//i.test(source)) {
    if (source.startsWith(ENT_ORIGIN)) {
      return {
        src: buildEntProxyHref(source),
        kind: 'ent-url',
      }
    }

    return {
      src: source,
      kind: 'url',
    }
  }

  if (source.startsWith('/')) {
    return {
      src: buildEntProxyHref(source),
      kind: 'relative-url',
    }
  }

  if (source.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(source)) {
    return {
      src: `data:image/jpeg;base64,${source.replace(/\s+/g, '')}`,
      kind: 'base64',
    }
  }

  return null
}

export function findProfilePhotoCandidate(node, currentPath = 'account', visited = new WeakSet(), depth = 0) {
  if (!node || depth > 6) {
    return null
  }

  if (typeof node !== 'object') {
    return null
  }

  if (visited.has(node)) {
    return null
  }

  visited.add(node)

  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const match = findProfilePhotoCandidate(node[index], `${currentPath}[${index}]`, visited, depth + 1)
      if (match) {
        return match
      }
    }
    return null
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = `${currentPath}.${key}`

    if (typeof value === 'string' && PROFILE_PHOTO_KEY_PATTERN.test(key)) {
      const normalized = normalizeProfilePhotoSource(value)

      if (normalized) {
        return {
          ...normalized,
          fieldPath: nextPath,
          rawValue: value,
        }
      }
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') {
      const match = findProfilePhotoCandidate(value, `${currentPath}.${key}`, visited, depth + 1)
      if (match) {
        return match
      }
    }
  }

  return null
}
