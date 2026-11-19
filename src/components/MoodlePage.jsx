import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import PageEmptyState from './PageEmptyState'
import PageLoading from './PageLoading'
import PageActionButton from './PageActionButton'
import { onDesktopCommand } from '../desktopMenu'
import { reportSessionExpired } from '../entApi'
import { INITIAL_MOODLE_STATE, askMoodle, isSlotCovered, readMoodleState, readMoodleTheme, sameMoodleState, sameMoodleTheme, slotBounds } from '../desktopMoodle'
import { r } from '../register'

// « Moodle » in the apps: Moodle itself, inside the window, next to the
// sidebar (on a phone: the whole width, above the tab bar). Not an iframe
// (Moodle refuses to be framed): the app lays a web view of its own over
// this page's slot (src-tauri/src/moodle.rs; on iOS a view of the app's own,
// moodle_ios.rs) and keeps it there as the slot moves. The page keeps the
// toolbar above it.
//
// The view is native, so it sits over everything the page draws: while a
// sheet, a dialog or a menu is over the slot, it hides, and comes back
// after. Leaving the page hides it; coming back shows it where it was (same
// Moodle page, nothing reloaded). It only shows once Moodle is there: until
// then, and when Moodle can't be reached or the server couldn't sign in to
// it, the slot says so itself. When the server found the student's session
// expired, the app signs out (App's onSessionExpired).
//
// `target`: a page of Moodle's to open on (a deadline's activity), taken
// once (`onTargetHandled`). `signsInOnMoodle`: show Moodle's own sign-in page instead (the demo
// account has no session to renew). `onHistoryChange`: whether Moodle can go
// back and forward, for the menu bar (null off the page).

const RETRY_STATE_MS = 1000
// A cover that came or went without the page's tree changing (a transition).
const RESYNC_MS = 500
// The palette eases from one pick to the next (tokens.css): its colours are
// read again once it has settled.
const THEME_SETTLES_MS = 400

function ToolbarButton({ icon, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="glass-solid inline-flex size-8 shrink-0 items-center justify-center rounded-full text-text cursor-pointer transition-[background-color,opacity] duration-150 hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon icon={icon} className="size-4" aria-hidden="true" />
    </button>
  )
}

function MoodlePage({ target = null, onTargetHandled = () => {}, signsInOnMoodle = false, onHistoryChange = null }) {
  const slotRef = useRef(null)
  const [view, setView] = useState(INITIAL_MOODLE_STATE)
  // The app refused to make the view (no window, no Moodle for the session).
  const [refused, setRefused] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // The view, made where the slot is (hidden until Moodle is there), or
  // sent to `target`.
  const targetRef = useRef(target)
  useEffect(() => {
    targetRef.current = target
  }, [target])
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return undefined
    let cancelled = false
    const asked = targetRef.current
    askMoodle('open', { ...slotBounds(slot.getBoundingClientRect()), ...(asked ? { target: asked } : null), theme: readMoodleTheme() }).then((taken) => {
      if (!cancelled) setRefused(!taken)
    })
    if (asked) onTargetHandled()
    return () => {
      cancelled = true
    }
  }, [target, attempt, onTargetHandled])

  // Moodle's pages wear the app's theme (src-tauri/src/moodle_style.rs): a
  // change of theme, of palette or of its intensity reaches them while they
  // are open.
  useEffect(() => {
    const root = document.documentElement
    let sent = readMoodleTheme()
    let timer = 0
    const send = () => {
      const next = readMoodleTheme()
      if (sameMoodleTheme(sent, next)) return
      sent = next
      void askMoodle('theme', next)
    }
    const changed = new MutationObserver(() => {
      send()
      window.clearTimeout(timer)
      timer = window.setTimeout(send, THEME_SETTLES_MS)
    })
    changed.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style'] })
    return () => {
      changed.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  // What the view says of itself, as it changes.
  useEffect(() => {
    let cancelled = false
    let since = null
    const follow = async () => {
      while (!cancelled) {
        const next = await readMoodleState(since)
        if (cancelled) return
        if (!next) {
          await new Promise((resolve) => window.setTimeout(resolve, RETRY_STATE_MS))
          continue
        }
        since = next.version
        setView((current) => (sameMoodleState(current, next) ? current : next))
      }
    }
    void follow()
    return () => {
      cancelled = true
    }
  }, [])

  // The view went away with the window it had moved to: made again here.
  useEffect(() => {
    if (view.phase === 'gone') setAttempt((value) => value + 1)
  }, [view.phase, view.version])

  // The server found the session expired on the way to Moodle.
  useEffect(() => {
    if (view.phase === 'expired') reportSessionExpired()
  }, [view.phase])

  // On screen once Moodle is there, and while nothing of the page's is over
  // the slot; where the slot is, as it moves.
  const wanted = !refused && (view.phase === 'ready' || (view.phase === 'signin' && signsInOnMoodle))
  useEffect(() => {
    const slot = slotRef.current
    if (!slot || !wanted) return undefined
    let frame = 0
    let shown = false
    let placed = ''

    const sync = () => {
      frame = 0
      if (isSlotCovered(slot)) {
        if (shown) {
          shown = false
          void askMoodle('hide')
        }
        return
      }
      const bounds = slotBounds(slot.getBoundingClientRect())
      const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
      if (shown && key === placed) return
      placed = key
      void askMoodle(shown ? 'bounds' : 'show', bounds)
      shown = true
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(sync)
    }

    const resize = new ResizeObserver(schedule)
    resize.observe(slot)
    // Sheets, menus and notes come and go anywhere in the page.
    const covers = new MutationObserver(schedule)
    covers.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'] })
    window.addEventListener('resize', schedule)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('animationend', schedule, true)
    const timer = window.setInterval(schedule, RESYNC_MS)
    schedule()

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearInterval(timer)
      resize.disconnect()
      covers.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('transitionend', schedule, true)
      document.removeEventListener('animationend', schedule, true)
      void askMoodle('hide')
    }
  }, [wanted])

  const command = useCallback((name) => () => void askMoodle('command', { command: name }), [])
  const usable = wanted
  const canGoBack = usable && view.back
  const canGoForward = usable && view.forward

  // The menu bar: « Actualiser » (⌘R), « Précédent » (⌘[), « Suivant » (⌘]).
  useEffect(() => onDesktopCommand(({ command: name }) => {
    if (!usable) return
    if (name === 'refresh') void askMoodle('command', { command: 'reload' })
    if (name === 'back' && canGoBack) void askMoodle('command', { command: 'back' })
    if (name === 'forward' && canGoForward) void askMoodle('command', { command: 'forward' })
  }), [usable, canGoBack, canGoForward])
  useEffect(() => {
    onHistoryChange?.({ back: canGoBack, forward: canGoForward })
  }, [onHistoryChange, canGoBack, canGoForward])
  useEffect(() => () => onHistoryChange?.(null), [onHistoryChange])

  const retry = () => {
    if (refused) {
      setRefused(false)
      setAttempt((value) => value + 1)
      return
    }
    void askMoodle('command', { command: 'retry' })
  }

  // 'none': the view isn't made yet (the app is asking the server where
  // Moodle is), a wait like 'opening'. 'signin': Moodle asks to sign in and
  // the server couldn't, the session still valid (a step of the sign-in
  // down): unavailable, as a page that didn't load. 'expired': the app
  // signs out, nothing to show meanwhile.
  const isExpired = view.phase === 'expired'
  const isFailed = !isExpired && (refused || view.phase === 'failed' || (view.phase === 'signin' && !signsInOnMoodle))
  // There is one view: another window of the app took it.
  const isElsewhere = !refused && view.phase === 'elsewhere'
  const isOpening = !refused && ['opening', 'none', 'gone'].includes(view.phase)

  return (
    <section className="moodle-page flex flex-col" aria-label="Moodle">
      {/* The window's top band (it moves the window): the toolbar, its
          buttons clickable, the page's title between them. */}
      <div className="moodle-toolbar relative flex h-[52px] shrink-0 items-center gap-2 px-4">
        <ToolbarButton icon="ph:arrow-left" label="Précédent" onClick={command('back')} disabled={!canGoBack} />
        <ToolbarButton icon="ph:arrow-right" label="Suivant" onClick={command('forward')} disabled={!canGoForward} />
        {usable && view.loading ? (
          <ToolbarButton icon="ph:x" label="Arrêter le chargement" onClick={command('stop')} />
        ) : (
          <ToolbarButton icon="ph:arrow-clockwise" label="Recharger" onClick={command('reload')} disabled={!usable} />
        )}
        <ToolbarButton icon="ph:house" label="Tableau de bord Moodle" onClick={command('home')} disabled={!usable} />
        <p className="m-0 min-w-0 flex-1 truncate px-2 text-center font-body text-[13px] font-medium leading-none text-text-muted" title={usable ? view.title : undefined}>
          {usable ? view.title : ''}
        </p>
        {usable && view.file ? <ToolbarButton icon="ph:download-simple" label="Télécharger" onClick={command('download')} /> : null}
        <ToolbarButton icon="ph:arrow-square-out" label="Ouvrir dans le navigateur" onClick={command('browser')} disabled={view.phase === 'none' || refused || isElsewhere} />
        {usable && view.loading ? <span className="moodle-loading" aria-hidden="true" /> : null}
      </div>
      <div className="moodle-slot relative min-h-0 flex-1 overflow-hidden">
        {/* The view's place (inside the slot's hairlines), and under it what
            is seen until Moodle is there, or when it can't be. */}
        <div ref={slotRef} className="absolute inset-0 flex flex-col items-center justify-center">
          {isExpired ? null : isElsewhere ? (
            <PageEmptyState icon="ph:app-window" title="Moodle est ouvert dans une autre fenêtre" action={<PageActionButton label="Afficher ici" onClick={() => setAttempt((value) => value + 1)} />} />
          ) : isFailed ? (
            <PageEmptyState icon="ph:warning" title="Moodle indisponible" action={<PageActionButton label="Réessayer" onClick={retry} />}>
              {r('Moodle ne répond pas, réessaie dans un moment', 'Moodle ne répond pas, réessayez dans un moment')}
            </PageEmptyState>
          ) : isOpening ? (
            <PageLoading className="min-h-0" />
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default MoodlePage
