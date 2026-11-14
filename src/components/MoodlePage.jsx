import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import LoadingDots from './LoadingDots'

// « Moodle » in the desktop app: Moodle itself, inside the window, next to
// the sidebar. Not an iframe (Moodle refuses to be framed): the app lays a
// web view of its own over this page's slot (src-tauri/src/moodle.rs) and
// keeps it there as the slot moves. The page keeps the toolbar above it.
//
// The view is native, so it sits over everything the page draws: while a
// sheet, a dialog or a menu is open, it hides, and comes back after.
// Leaving the page hides it; coming back shows it where it was (same
// Moodle page, nothing reloaded).

const HEADERS = { 'X-Tafac-Desktop': '1', 'Content-Type': 'application/json' }
// What the page opens over Moodle.
const COVERS = '.weather-modal-backdrop, [role="dialog"], [role="alertdialog"], [role="menu"], .context-menu'

function ask(path, body = {}) {
  return fetch(`/__desktop/moodle/${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
}

function readBounds(element) {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

function ToolbarButton({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="glass-solid inline-flex size-8 shrink-0 items-center justify-center rounded-full text-text cursor-pointer transition-[background-color] duration-150 hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-text"
    >
      <Icon icon={icon} className="size-4" aria-hidden="true" />
    </button>
  )
}

function MoodlePage({ launchHref }) {
  const slotRef = useRef(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    const slot = slotRef.current
    if (!slot || !launchHref) return undefined
    let frame = 0
    let covered = false
    let shown = false
    let placed = ''
    let cancelled = false

    const isCovered = () => Boolean(document.querySelector(COVERS))

    const sync = () => {
      frame = 0
      if (cancelled) return
      const nextCovered = isCovered()
      if (nextCovered !== covered) {
        covered = nextCovered
        if (covered) {
          void ask('hide')
          return
        }
        shown = false
      }
      if (covered) return
      const bounds = readBounds(slot)
      const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
      if (shown && key === placed) return
      placed = key
      if (!shown) {
        shown = true
        ask('show', { launch: launchHref, ...bounds })
          .then((response) => { if (!cancelled) setState(response.ok ? 'ready' : 'error') })
          .catch(() => { if (!cancelled) setState('error') })
        return
      }
      void ask('bounds', bounds)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(sync)
    }

    const resize = new ResizeObserver(schedule)
    resize.observe(slot)
    // Sheets and menus come and go anywhere in the page.
    const covers = new MutationObserver(schedule)
    covers.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    schedule()

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      resize.disconnect()
      covers.disconnect()
      window.removeEventListener('resize', schedule)
      void ask('hide')
    }
  }, [launchHref])

  const command = (name) => () => void ask('command', { command: name, home: launchHref })

  return (
    <section className="moodle-page fixed inset-y-0 right-0 flex flex-col" aria-label="Moodle">
      {/* The window's top band (it moves the window): the toolbar, its
          buttons clickable. */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <ToolbarButton icon="ph:arrow-left" label="Précédent" onClick={command('back')} />
        <ToolbarButton icon="ph:arrow-right" label="Suivant" onClick={command('forward')} />
        <ToolbarButton icon="ph:arrow-clockwise" label="Recharger" onClick={command('reload')} />
        <ToolbarButton icon="ph:house" label="Tableau de bord Moodle" onClick={command('home')} />
        <span className="flex-1" />
        <ToolbarButton icon="ph:arrow-square-out" label="Ouvrir dans le navigateur" onClick={command('browser')} />
      </div>
      <div ref={slotRef} className="moodle-slot relative min-h-0 flex-1 overflow-hidden">
        {/* Under the view: seen while it loads, or if it can't open. */}
        <div className="absolute inset-0 flex items-center justify-center text-text-muted">
          {state === 'error' ? (
            <span className="font-body text-[14px] font-medium">Moodle n’a pas pu s’ouvrir dans l’appli</span>
          ) : (
            <LoadingDots label="Ouverture de Moodle" className="text-[18px]" />
          )}
        </div>
      </div>
    </section>
  )
}

export default MoodlePage
