import { useEffect, useState } from 'react'
import { readWindowsInstaller, shouldOfferWindowsApp } from './windowsAppDownload'

// The Windows installer's address for a visitor on Windows in a browser, null
// everywhere else (and while it is read): what the landing page and the
// sidebar show their download from. Read after mount, so the pre-rendered
// landing page is the same for everyone.
export function useWindowsAppDownload() {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!shouldOfferWindowsApp()) return undefined
    let cancelled = false
    void readWindowsInstaller().then((installer) => {
      if (!cancelled) setUrl(installer)
    })
    return () => { cancelled = true }
  }, [])

  return url
}
