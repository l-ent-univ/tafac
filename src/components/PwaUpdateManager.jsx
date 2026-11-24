import { useCallback, useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import RefreshedPrompt from './RefreshedPrompt'
import { flushAnalytics, track } from '../analytics'
import { APP_NAME } from '../seo'
import { isNativeApp } from '../desktopApp'

const LOCAL_PWA_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
const LOCAL_PWA_RESET_KEY = 'l-ent:local-pwa-reset'
const UPDATE_PROMPT_TITLE = 'Une nouvelle version est prête'
const UPDATE_PROMPT_DESCRIPTION = `Une nouvelle version de ${APP_NAME} est disponible. Applique-la maintenant pour la mettre à jour`

// Updates are announced discreetly (the small "Nouvelle version" notice in the
// sidebar / header), never with the big prompt. If the student doesn't click
// it, the update applies itself at the start of the Nth launch that finds it
// waiting — right after the page loads, never while they're typing.
const AUTO_UPDATE_AFTER_LAUNCHES = 3
const PENDING_UPDATE_LAUNCHES_KEY = 'l-ent:pending-update-launches'
// Only apply automatically when the update is found at startup, not when a
// new version lands in the middle of a session.
const STARTUP_WINDOW_MS = 15_000

let launchCountedThisPageLoad = false

function readPendingLaunches() {
  try {
    return Number(localStorage.getItem(PENDING_UPDATE_LAUNCHES_KEY)) || 0
  } catch {
    return 0
  }
}

function writePendingLaunches(count) {
  try {
    if (count > 0) {
      localStorage.setItem(PENDING_UPDATE_LAUNCHES_KEY, String(count))
    } else {
      localStorage.removeItem(PENDING_UPDATE_LAUNCHES_KEY)
    }
  } catch {
    // Storage unavailable: the notice still works, only auto-update is skipped.
  }
}

// Counts this page load as one launch with an update waiting (once per load)
// and returns the running total.
function countPendingUpdateLaunch() {
  if (launchCountedThisPageLoad) {
    return readPendingLaunches()
  }
  launchCountedThisPageLoad = true
  const count = readPendingLaunches() + 1
  writePendingLaunches(count)
  return count
}

function isAtStartup() {
  return typeof performance !== 'undefined' && performance.now() < STARTUP_WINDOW_MS
}

// Activates the waiting service worker directly and reloads once it controls
// the page. The plugin's own skip-waiting path can lag ~30 s when called right
// after startup; posting to registration.waiting takes effect immediately.
async function activateWaitingWorker() {
  const registration = await navigator.serviceWorker?.getRegistration()
  const waiting = registration?.waiting
  if (!waiting) {
    return false
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  waiting.postMessage({ type: 'SKIP_WAITING' })
  return true
}

function isUserTyping() {
  const element = document.activeElement
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)))
}

function isLocalPwaHost(hostname = '') {
  return LOCAL_PWA_HOSTS.has(hostname) || hostname.endsWith('.local')
}

function LocalPwaManager({ forceOpen, onForceOpenChange, onApplyHandlerChange }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return undefined
    }

    let cancelled = false

    async function cleanupLocalPwa() {
      const registrations = await navigator.serviceWorker.getRegistrations()
      const hadRegistrations = registrations.length > 0

      if (hadRegistrations) {
        await Promise.allSettled(registrations.map((registration) => registration.unregister()))
      }

      if ('caches' in window) {
        const cacheKeys = await caches.keys()
        await Promise.allSettled(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
      }

      if (cancelled) {
        return
      }

      // Reload once after cleanup so localhost immediately picks up the network bundle.
      if (hadRegistrations && navigator.serviceWorker.controller) {
        const alreadyReset = sessionStorage.getItem(LOCAL_PWA_RESET_KEY) === '1'

        if (!alreadyReset) {
          sessionStorage.setItem(LOCAL_PWA_RESET_KEY, '1')
          window.location.reload()
          return
        }
      }

      sessionStorage.removeItem(LOCAL_PWA_RESET_KEY)
    }

    void cleanupLocalPwa()

    return () => {
      cancelled = true
    }
  }, [])

  const closePreview = useCallback(() => {
    onForceOpenChange(false)
  }, [onForceOpenChange])

  const reloadPreview = useCallback(() => {
    onForceOpenChange(false)
    window.location.reload()
  }, [onForceOpenChange])

  useEffect(() => {
    onApplyHandlerChange?.(reloadPreview)
    return () => onApplyHandlerChange?.(null)
  }, [reloadPreview, onApplyHandlerChange])

  return (
    <RefreshedPrompt
      visible={forceOpen}
      title={UPDATE_PROMPT_TITLE}
      description={UPDATE_PROMPT_DESCRIPTION}
      dismissLabel="Plus tard"
      confirmLabel="Mettre à jour"
      onDismiss={closePreview}
      onConfirm={reloadPreview}
    />
  )
}

function ProductionPwaManager({ forceOpen, onForceOpenChange, onUpdateAvailable, onApplyHandlerChange }) {
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false)
  const [hasPendingUpdate, setHasPendingUpdate] = useState(false)
  const [shouldAutoApply, setShouldAutoApply] = useState(false)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedRefresh() {
      setIsApplyingUpdate(false)
      setHasPendingUpdate(true)
      onUpdateAvailable?.()

      const launches = countPendingUpdateLaunch()
      if (launches >= AUTO_UPDATE_AFTER_LAUNCHES && isAtStartup()) {
        setShouldAutoApply(true)
      }
    },
    onRegisteredSW(_swUrl, registration) {
      // No update waiting at launch (applied, or installed when all tabs were
      // closed): restart the launch count for the next one.
      if (!registration?.waiting && !launchCountedThisPageLoad) {
        writePendingLaunches(0)
      }
    },
    onRegisterError(error) {
      console.error('PWA registration failed', error)
    },
  })

  // The big prompt only opens on demand (debug panel preview); a detected
  // update shows the small notice instead.
  const visible = forceOpen

  const dismissPrompt = useCallback(() => {
    setIsApplyingUpdate(false)
    onForceOpenChange(false)
  }, [onForceOpenChange])

  const applyUpdate = useCallback(async () => {
    if (isApplyingUpdate) {
      return
    }

    setIsApplyingUpdate(true)
    writePendingLaunches(0)
    // Sent right away: applying the update reloads the page.
    track('pwa_update_applied')
    flushAnalytics()

    try {
      if (needRefresh || hasPendingUpdate) {
        if (!(await activateWaitingWorker())) {
          await updateServiceWorker(true)
        }
        return
      }

      onForceOpenChange(false)
      window.location.reload()
    } catch (error) {
      console.error('Failed to apply PWA update', error)
      setIsApplyingUpdate(false)
    }
  }, [hasPendingUpdate, isApplyingUpdate, needRefresh, onForceOpenChange, updateServiceWorker])

  useEffect(() => {
    onApplyHandlerChange?.(applyUpdate)
    return () => onApplyHandlerChange?.(null)
  }, [applyUpdate, onApplyHandlerChange])

  // Nth launch with the update still waiting: apply it now, at startup.
  useEffect(() => {
    if (!shouldAutoApply) return
    setShouldAutoApply(false)
    if (!isUserTyping()) {
      void applyUpdate()
    }
  }, [applyUpdate, shouldAutoApply])

  return (
    <RefreshedPrompt
      visible={visible}
      title={UPDATE_PROMPT_TITLE}
      description={UPDATE_PROMPT_DESCRIPTION}
      dismissLabel="Plus tard"
      confirmLabel="Mettre à jour"
      confirmBusy={isApplyingUpdate}
      onDismiss={dismissPrompt}
      onConfirm={applyUpdate}
    />
  )
}

export default function PwaUpdateManager({ forceOpen = false, onForceOpenChange, onUpdateAvailable, onApplyHandlerChange }) {
  const isLocalRuntime = typeof window !== 'undefined' && isLocalPwaHost(window.location.hostname)

  // The apps (desktop, iOS) load the page from the app itself, which
  // updates them: a service worker would keep serving the page of an
  // earlier version after an update. None registered, and one left by an
  // earlier version removed, as on localhost.
  if (isLocalRuntime || isNativeApp()) {
    return (
      <LocalPwaManager
        forceOpen={forceOpen}
        onForceOpenChange={onForceOpenChange}
        onApplyHandlerChange={onApplyHandlerChange}
      />
    )
  }

  return (
    <ProductionPwaManager
      forceOpen={forceOpen}
      onForceOpenChange={onForceOpenChange}
      onUpdateAvailable={onUpdateAvailable}
      onApplyHandlerChange={onApplyHandlerChange}
    />
  )
}
