import { useRef } from 'react'
import { Icon } from '@iconify/react'
import { copy, copyText } from '../landingCopy'
import { useDragToPlay } from '../landingMotion'

// The cards' demo content (landingCopy.json, `floatingWidgets`).
const WIDGETS = copy.floatingWidgets

// A small card in the dashboard widgets' look, floating by the landing's last
// block: a title, then whatever it shows. Decorative (the whole scene is
// aria-hidden).
// It can be grabbed and dragged around, and springs back once let go: the
// wrapper takes the drag (useDragToPlay), the card inside keeps its tilt and
// its drift.
function MiniCard({ title, badge = null, className = '', style, children }) {
  const ref = useRef(null)
  useDragToPlay(ref)

  return (
    <div ref={ref} className={`landing-drag pointer-events-auto absolute ${className}`}>
      <div
        style={style}
        className="landing-float w-[176px] corners-[18px] border border-white bg-white/95 p-3 text-left shadow-[0_2px_6px_rgb(52_18_0/0.08),0_18px_36px_-16px_rgb(52_18_0/0.3)] dark:border-white/10 dark:bg-[#1c1c1c]/95"
      >
        <p className="m-0 flex items-center gap-1.5 text-[12px] font-medium leading-none text-text-secondary font-body">
          {title}
          {badge ? <span className="inline-flex size-4 items-center justify-center rounded-full bg-[#2563eb] text-[10px] font-bold text-white">{badge}</span> : null}
        </p>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  )
}

// The four widgets (demo content) floating around the landing's last block,
// over its left and right edges, each tilted and drifting at its own pace
// (.landing-float in overrides.css: --float-*). Laid over the block's wrapper
// (absolute, the full size of it); from 900 px up only, where the text
// leaves room beside it. Still with reduced motion. Each can be dragged
// around (MiniCard).
function FloatingWidgets({ className = '' }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 select-none max-2xl:hidden ${className}`}>
      <MiniCard
        title={copyText(WIDGETS.nextClass.title)}
        style={{ '--float-duration': '5.2s', '--float-delay': '-1s', rotate: '-8deg' }}
        className="left-[3%] top-[10%]"
      >
        <div className="flex gap-2">
          <span className="w-1 shrink-0 rounded-full bg-[#f59e0b]" />
          <div className="min-w-0">
            <p className="m-0 truncate text-[13px] font-bold leading-tight text-text">{copyText(WIDGETS.nextClass.course)}</p>
            <p className="m-0 truncate text-[11px] leading-tight text-text-secondary font-body">{copyText(WIDGETS.nextClass.room)}</p>
          </div>
        </div>
        <p className="m-0 mt-1.5 flex items-center gap-1 text-[12px] font-bold text-text">
          <Icon icon="carbon:time" className="size-3.5" />
          {copyText(WIDGETS.nextClass.time)}
        </p>
      </MiniCard>

      <MiniCard
        title={copyText(WIDGETS.latestGrade.title)}
        style={{ '--float-duration': '6.4s', '--float-delay': '-3s', rotate: '7deg' }}
        className="right-[4%] top-[8%]"
      >
        <p className="m-0 truncate text-[11px] leading-tight text-text-secondary font-body">{copyText(WIDGETS.latestGrade.subject)}</p>
        <p className="m-0 mt-1 text-[26px] font-bold leading-none text-text">
          {copyText(WIDGETS.latestGrade.grade)}<span className="text-[14px] font-medium text-text-secondary"> {copyText(WIDGETS.latestGrade.outOf)}</span>
        </p>
      </MiniCard>

      <MiniCard
        title={copyText(WIDGETS.mail.title)}
        badge={copyText(WIDGETS.mail.badge)}
        style={{ '--float-duration': '5.8s', '--float-delay': '-2s', rotate: '5deg' }}
        className="left-[1%] top-[48%]"
      >
        <p className="m-0 flex items-center gap-1.5 truncate text-[12px] font-bold leading-tight text-text">
          <span className="size-1.5 shrink-0 rounded-full bg-[#2563eb]" />
          {copyText(WIDGETS.mail.from)}
        </p>
        <p className="m-0 truncate text-[11px] leading-tight text-text-secondary font-body">{copyText(WIDGETS.mail.subject)}</p>
      </MiniCard>

      <MiniCard
        title={copyText(WIDGETS.deadlines.title)}
        style={{ '--float-duration': '6.8s', '--float-delay': '-4.5s', rotate: '-6deg' }}
        className="right-[2%] top-[44%]"
      >
        <p className="m-0 truncate text-[12px] font-bold leading-tight text-text">{copyText(WIDGETS.deadlines.task)}</p>
        <p className="m-0 mt-0.5 text-[11px] font-semibold leading-tight text-[#dc2626] dark:text-[#f87171]">{copyText(WIDGETS.deadlines.status)}</p>
      </MiniCard>
    </div>
  )
}

export default FloatingWidgets
