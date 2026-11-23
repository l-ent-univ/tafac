import { Icon } from '@iconify/react'
import { copy, copyText } from '../landingCopy'
import { useWindowsAppDownload } from '../useWindowsAppDownload'

// Signed out, on Windows in a browser, once a release has a Windows build:
// the desktop app beside the way in. Nothing for anyone else (and in the
// pre-rendered page), so it doesn't compete with « Me connecter ».
function LandingWindowsApp({ className = '' }) {
  const url = useWindowsAppDownload()
  if (!url) return null

  return (
    <a
      href={url}
      className={`inline-flex items-center gap-2 rounded-full border border-border/70 px-4 py-2 text-[14px] font-semibold text-text-secondary no-underline transition-colors hover:text-text font-body ${className}`}
    >
      <Icon icon="ph:windows-logo" className="size-4" aria-hidden="true" />
      {copyText(copy.hero.windowsApp)}
    </a>
  )
}

export default LandingWindowsApp
