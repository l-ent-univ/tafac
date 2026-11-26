import { useEffect, useState, useSyncExternalStore } from 'react'
import { getBackendAnswers, subscribeBackendAnswers } from './backendTrace.js'

// Dev only (App.jsx mounts it under `import.meta.env.DEV`): shows which
// side answered what the page displays. An outline around each marked
// component (src/dev/backendTrace.js#markBackend), orange when the Rust
// gateway answered its route and green when the Node server did, and a
// panel with every route asked, who answered, and how long it took.

const SIDES = {
  rust: { label: 'RUST', color: '#CE422B' },
  node: { label: 'NODE', color: '#3C873A' },
  none: { label: '…', color: '#8A8A8A' },
}
const SHOWN_KEY = 'l-ent:dev-backend-marks'
const MEASURE_EVERY_MS = 400

function readShown() {
  try {
    return window.localStorage.getItem(SHOWN_KEY) !== '0'
  } catch {
    return true
  }
}

// The last answer among a mark's routes.
function latestAnswer(routes, answers) {
  return answers.filter((answer) => routes.includes(answer.route)).sort((left, right) => right.at - left.at)[0] ?? null
}

// Where a mark is on the screen: its wrapper has no box, its children do.
function measureMarks(answers) {
  const boxes = []
  for (const element of document.querySelectorAll('[data-backend-routes]')) {
    const routes = element.dataset.backendRoutes.split(',')
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const child of element.children) {
      const rect = child.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      left = Math.min(left, rect.left)
      top = Math.min(top, rect.top)
      right = Math.max(right, rect.right)
      bottom = Math.max(bottom, rect.bottom)
    }
    if (!Number.isFinite(left) || bottom < 0 || top > window.innerHeight) continue
    const answer = latestAnswer(routes, answers)
    boxes.push({ key: `${routes[0]}:${Math.round(left)}:${Math.round(top)}`, left, top, width: right - left, height: bottom - top, answer, routes })
  }
  return boxes
}

function sameBoxes(current, next) {
  return current.length === next.length && current.every((box, index) => {
    const other = next[index]
    return box.key === other.key && box.width === other.width && box.height === other.height && box.answer === other.answer
  })
}

function Tag({ side, children }) {
  return (
    <span style={{ background: side.color, color: '#fff', font: '700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace', padding: '3px 5px', borderRadius: 4, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function Outline({ box }) {
  const side = SIDES[box.answer?.by ?? 'none']
  return (
    <div style={{ position: 'fixed', left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6, border: `2px dashed ${side.color}`, borderRadius: 14, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 8, top: -9 }}>
        <Tag side={side}>
          {side.label}
          {box.answer ? ` · ${box.answer.milliseconds} ms` : ' · pas encore demandé'}
        </Tag>
      </div>
    </div>
  )
}

function Panel({ answers, shown, onToggleShown }) {
  const [open, setOpen] = useState(true)
  const byRust = answers.filter((answer) => answer.by === 'rust').length
  return (
    <div style={{ position: 'fixed', left: 12, bottom: 12, maxWidth: 'min(460px, calc(100vw - 24px))', background: 'rgba(20, 20, 22, 0.94)', color: '#f4f4f5', borderRadius: 12, font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace', boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)', pointerEvents: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
        <button type="button" onClick={() => setOpen((current) => !current)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }} aria-expanded={open}>
          {open ? '▾' : '▸'} Qui répond ?
        </button>
        <Tag side={SIDES.rust}>RUST {byRust}</Tag>
        <Tag side={SIDES.node}>NODE {answers.length - byRust}</Tag>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={shown} onChange={onToggleShown} />
          contours
        </label>
      </div>
      {open ? (
        <div style={{ maxHeight: '40vh', overflowY: 'auto', padding: '0 10px 10px' }}>
          {answers.length === 0 ? <div style={{ opacity: 0.7 }}>Aucune requête encore.</div> : null}
          {answers.map((answer) => (
            <div key={answer.route} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <Tag side={SIDES[answer.by]}>{SIDES[answer.by].label}</Tag>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={answer.route}>
                {answer.route.replace('/__ent_auth', '')}
              </span>
              <span style={{ opacity: answer.status >= 400 ? 1 : 0.75, color: answer.status >= 400 ? '#fca5a5' : 'inherit', whiteSpace: 'nowrap' }}>
                {answer.status} · {answer.milliseconds} ms · ×{answer.count}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BackendMarks() {
  const answers = useSyncExternalStore(subscribeBackendAnswers, getBackendAnswers)
  const [shown, setShown] = useState(readShown)
  const [boxes, setBoxes] = useState([])

  useEffect(() => {
    if (!shown) {
      setBoxes([])
      return undefined
    }
    // One measure per frame at most, and nothing redrawn when nothing moved:
    // the marks must not slow down the page they describe.
    let frame = 0
    const measure = () => {
      frame = 0
      const next = measureMarks(answers)
      setBoxes((current) => (sameBoxes(current, next) ? current : next))
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    schedule()
    const interval = window.setInterval(schedule, MEASURE_EVERY_MS)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.clearInterval(interval)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [answers, shown])

  const toggleShown = () => {
    setShown((current) => {
      try {
        window.localStorage.setItem(SHOWN_KEY, current ? '0' : '1')
      } catch {
        // Private mode: the choice lasts for the page.
      }
      return !current
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none' }} data-dev-backend-marks>
      {boxes.map((box) => <Outline key={box.key} box={box} />)}
      <Panel answers={answers} shown={shown} onToggleShown={toggleShown} />
    </div>
  )
}

export default BackendMarks
