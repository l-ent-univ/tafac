import { useEffect, useState } from 'react'

// Dev only: the git branch the dev server runs from (vite.config.js →
// /__dev/git-branch), shown next to "dev" in the footer. Asked again when the
// tab comes back, so a branch switch shows without a reload. Null in a build.
export function useDevBranch() {
  const [branch, setBranch] = useState(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    let cancelled = false

    async function load() {
      try {
        const response = await fetch('/__dev/git-branch', { cache: 'no-store' })
        const payload = await response.json()
        if (!cancelled) setBranch(typeof payload?.branch === 'string' ? payload.branch : null)
      } catch {
        // No dev server route (vite preview): "dev" alone.
      }
    }

    function reloadIfVisible() {
      if (document.visibilityState === 'visible') void load()
    }

    void load()
    document.addEventListener('visibilitychange', reloadIfVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', reloadIfVisible)
    }
  }, [])

  return branch
}
