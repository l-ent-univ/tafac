import { useRef } from 'react'
import { Icon } from '@iconify/react'
import { copy, copyText } from '../landingCopy'
import { useRevealOnce } from '../landingMotion'

// What each device brings (landingCopy.json, `features`; the icons here,
// item by item), beside its mockup: `computer` with the laptop, `phone`
// with the phone. What each page does is the showcase's (LandingShowcase).
const SHOWCASES = {
  computer: {
    id: 'sur-ordinateur',
    icons: ['carbon:cursor-1', 'carbon:side-panel-open', 'carbon:printer', 'carbon:side-panel-close'],
  },
  phone: {
    id: 'sur-telephone',
    icons: ['carbon:mobile', 'carbon:touch-1', 'carbon:arrows-horizontal', 'carbon:asleep'],
  },
}

// A heading and the features as a list of pills, in the dashboard's card
// style (solid, as with the wallpaper off): the icon, then the title over a
// short line. Beside a device mockup it reads from the left; under it
// (below 1024 px), centred, the pills still reading from the left. On
// narrow phones, where the text may wrap, the corners round less.
// Once the list is on screen, the pills come in one by one, then the note
// (data-revealed, .landing-feature in overrides.css).
function FeatureShowcase({ variant = 'computer', className = '' }) {
  const { id, icons } = SHOWCASES[variant]
  const { title, intro, items, note } = copy.features[variant]
  const features = items.map((item, index) => ({ ...item, icon: icons[index] ?? 'carbon:checkmark' }))
  const listRef = useRef(null)
  const isRevealed = useRevealOnce(listRef)

  return (
    <section
      id={id}
      data-revealed={isRevealed || undefined}
      className={`landing-features scroll-mt-28 flex flex-col items-start text-left max-4xl:items-center max-4xl:text-center ${className}`}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="m-0 text-[clamp(28px,3.4vw,40px)] font-bold leading-[1] text-text">
        {copyText(title)}
      </h2>
      <p className="m-0 mt-3 max-w-[58ch] text-balance text-base font-medium leading-snug text-text-muted font-body">
        {copyText(intro)}
      </p>
      <ul ref={listRef} className="m-0 mt-6 flex w-full max-w-[520px] list-none flex-col gap-2 p-0 text-left">
        {features.map((feature, index) => (
          <li
            key={feature.icon + index}
            style={{ '--reveal-index': index }}
            className="landing-feature flex items-center gap-3 rounded-full border border-white bg-white py-2 pl-2 pr-6 shadow-[0_1px_3px_rgb(52_18_0/0.06),0_10px_28px_-14px_rgb(52_18_0/0.16)] dark:border-white/10 dark:bg-[#1c1c1c] max-sm:corners-[24px] max-sm:pr-4"
          >
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-text" aria-hidden="true">
              <Icon icon={feature.icon} className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-col">
              <h3 className="m-0 text-[15px] font-bold leading-tight text-text">{copyText(feature.title)}</h3>
              {feature.body ? <p className="m-0 text-balance text-sm leading-snug text-text-muted font-body">{copyText(feature.body)}</p> : null}
            </span>
          </li>
        ))}
      </ul>
      {note ? (
        <p style={{ '--reveal-index': features.length }} className="landing-feature m-0 mt-4 max-w-[520px] text-balance text-[13px] leading-snug text-text-muted font-body">
          {copyText(note)}
        </p>
      ) : null}
    </section>
  )
}

export default FeatureShowcase
