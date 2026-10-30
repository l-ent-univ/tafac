import { useRef } from 'react'
import universityConfig from '@university'
import { Icon } from '@iconify/react'
import { copy, copyText } from '../landingCopy'
import { DEVICE_FEATURES, listDeviceFeatures } from '../landingShowcase'
import { useRevealOnce } from '../landingMotion'
import LaptopMockup from './LaptopMockup'
import PhoneMockup from './PhoneMockup'

// What Tafac brings (landingCopy.json, `features`; their icons and what
// each needs: DEVICE_FEATURES), those this university has.
const ITEMS = listDeviceFeatures(universityConfig).map((index) => ({ ...copy.features.items[index], icon: DEVICE_FEATURES[index].icon }))

// The app on a computer and a phone at once: the laptop (its flower and
// island around it) with the phone in front of its right side, in the dark
// theme, each playing its tour; under them, what it brings as pills in the
// dashboard's card style (solid, as with the wallpaper off), two columns
// from 1024 px: the icon, then the title over a short line. Once the list
// is on screen, the pills come in one by one (data-revealed,
// .landing-feature in overrides.css); on narrow phones, where the text may
// wrap, their corners round less. The phone rises a little as it comes in
// (.landing-device).
function FeatureShowcase({ className = '' }) {
  const { title, intro } = copy.features
  const listRef = useRef(null)
  const isRevealed = useRevealOnce(listRef)

  return (
    <section
      id="sur-tes-appareils"
      className={`relative z-20 flex scroll-mt-28 justify-center px-6 max-md:px-4 ${className}`}
      aria-labelledby="sur-tes-appareils-title"
    >
      <div className="flex w-full max-w-[1080px] flex-col items-center">
        <h2 id="sur-tes-appareils-title" className="m-0 text-balance text-center text-[clamp(28px,3.4vw,40px)] font-bold leading-[1.05] text-text">
          {copyText(title)}
        </h2>
        <p className="m-0 mt-3 max-w-[52ch] text-balance text-center text-base font-medium leading-snug text-text-muted font-body">
          {copyText(intro)}
        </p>
        <div className="relative mt-14 w-full max-w-[900px] pr-[6%] max-md:mt-10 max-md:pr-[10%]">
          <LaptopMockup decorated />
          <div className="landing-device absolute right-0 -bottom-[6%] w-[21%] max-md:w-[28%]">
            <PhoneMockup decorated={false} darkScreen />
          </div>
        </div>
        <ul
          ref={listRef}
          data-revealed={isRevealed || undefined}
          className="landing-features m-0 mt-20 grid w-full list-none grid-cols-2 gap-2.5 p-0 text-left max-4xl:mt-16 max-4xl:max-w-[560px] max-4xl:grid-cols-1"
        >
          {ITEMS.map((item, index) => (
            <li
              key={item.title}
              style={{ '--reveal-index': index }}
              className="landing-feature flex items-center gap-3 rounded-full border border-white bg-white py-2 pl-2 pr-6 shadow-[0_1px_3px_rgb(52_18_0/0.06),0_10px_28px_-14px_rgb(52_18_0/0.16)] dark:border-white/10 dark:bg-[#1c1c1c] max-sm:corners-[24px] max-sm:pr-4"
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-text" aria-hidden="true">
                <Icon icon={item.icon} className="size-[18px]" />
              </span>
              <span className="flex min-w-0 flex-col">
                <h3 className="m-0 text-[15px] font-bold leading-tight text-text">{copyText(item.title)}</h3>
                {item.body ? <p className="m-0 text-balance text-sm leading-snug text-text-muted font-body">{copyText(item.body)}</p> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default FeatureShowcase
