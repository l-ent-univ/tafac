import { useEffect, useState } from 'react'

// The repo's contributors, from GitHub's public API, for « Contributeurs » in
// À propos: people only (no bots), most commits first, minus `excluded`
// logins (the team, listed on its own). Asked once per tab and shared; on
// any failure (offline, rate limit) the list stays empty and the section
// simply doesn't show. The last list is remembered (this tab, then the
// browser): the section shows at once, at its size, and is refreshed
// behind it, so nothing moves when GitHub answers.
const requests = new Map()
const resolved = new Map()
const STORAGE_PREFIX = 'l-ent:contributors:'

function readStored(slug) {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_PREFIX + slug) ?? 'null')
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

function writeStored(slug, payload) {
  try {
    localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(payload))
  } catch {
    // No storage: asked again next time, as before.
  }
}

// 'https://github.com/owner/repo' → 'owner/repo', or null.
export function readRepoSlug(url) {
  const match = String(url ?? '').match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return match ? `${match[1]}/${match[2]}` : null
}

// GitHub's answer → [{ login, contributions }], people only, minus `excluded`.
export function readContributors(payload, excluded = []) {
  const skip = new Set(excluded.map((login) => login.toLowerCase()))
  return (Array.isArray(payload) ? payload : [])
    .filter((entry) => entry?.type === 'User' && typeof entry.login === 'string' && !skip.has(entry.login.toLowerCase()))
    .map((entry) => ({ login: entry.login, contributions: Number(entry.contributions) || 0 }))
}

function fetchContributors(slug) {
  let request = requests.get(slug)
  if (!request) {
    request = fetch(`https://api.github.com/repos/${slug}/contributors?per_page=50`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((payload) => {
        // A failure keeps what was known (null: nothing new).
        const kept = Array.isArray(payload)
          ? payload.map((entry) => ({ type: entry?.type, login: entry?.login, contributions: entry?.contributions }))
          : resolved.get(slug) ?? readStored(slug) ?? []
        if (Array.isArray(payload)) writeStored(slug, kept)
        resolved.set(slug, kept)
        return kept
      })
    requests.set(slug, request)
  }
  return request
}

// { contributors, loading }: `loading` while nothing is known yet (the very
// first time), for the section to hold its place meanwhile.
export default function useRepoContributors(repoUrl, excluded = []) {
  const slug = readRepoSlug(repoUrl)
  const excludedKey = excluded.join(',')
  const skip = excludedKey ? excludedKey.split(',') : []
  const known = slug ? resolved.get(slug) ?? readStored(slug) : null
  const [state, setState] = useState(() => ({ slug, payload: known }))
  const payload = state.slug === slug ? state.payload : known

  useEffect(() => {
    if (!slug) return undefined
    let cancelled = false
    fetchContributors(slug).then((next) => {
      if (!cancelled) setState({ slug, payload: next })
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  return {
    contributors: payload ? readContributors(payload, skip) : [],
    loading: Boolean(slug) && payload == null,
  }
}
