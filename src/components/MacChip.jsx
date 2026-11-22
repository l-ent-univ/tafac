import { useId } from 'react'

// « Tafac pour Mac »'s two chips (MacAppDownloadModal), drawn in the site's
// materials and read from its variables, so the theme and the palettes
// carry over:
// - Apple Silicon: the primary button's (.lent-button): the brand's face,
//   its edge the face deepened, the white rim lit at the top and fading
//   down, the short brand shadow; « M » in the button's ink on an engraved
//   square.
// - Intel: the same, in the mail's blue (its unread count's tag,
//   .mail-unread-pill), « x86 » in that tag's ink.
// The pins: little pills in the favourites' yellow (--color-favorite).
// 80×82, the die 56 px square.

const PIN_OFFSETS = [18, 28, 38, 48, 58]

const M_PATH = 'M32.2994 48.708C31.7448 48.708 31.3201 48.5607 31.0254 48.266C30.7308 47.954 30.5834 47.5207 30.5834 46.966V32.978C30.5834 32.5273 30.6788 32.146 30.8694 31.834C31.0774 31.5047 31.3374 31.262 31.6494 31.106C31.9788 30.95 32.3168 30.872 32.6634 30.872C33.0448 30.872 33.3914 30.9413 33.7034 31.08C34.0328 31.2187 34.3361 31.4527 34.6134 31.782C34.8908 32.094 35.1594 32.5273 35.4194 33.082L40.4634 44.418H39.6054L44.5974 33.082C44.8748 32.5273 45.1521 32.094 45.4294 31.782C45.7068 31.4527 46.0101 31.2187 46.3394 31.08C46.6688 30.9413 47.0241 30.872 47.4054 30.872C47.9254 30.872 48.3848 31.0453 48.7834 31.392C49.1994 31.7387 49.4074 32.2587 49.4074 32.952V46.966C49.4074 47.5207 49.2601 47.954 48.9654 48.266C48.6881 48.5607 48.2634 48.708 47.6914 48.708C47.1368 48.708 46.7121 48.5607 46.4174 48.266C46.1228 47.954 45.9754 47.5207 45.9754 46.966L46.0274 35.526H46.5994L42.0494 46.68C41.8761 47.148 41.5901 47.486 41.1914 47.694C40.7928 47.902 40.3941 48.006 39.9954 48.006C39.5794 48.006 39.1721 47.902 38.7734 47.694C38.3921 47.4687 38.1061 47.1307 37.9154 46.68L33.3394 35.5H33.9374L34.0154 46.966C34.0154 47.5207 33.8681 47.954 33.5734 48.266C33.2788 48.5607 32.8541 48.708 32.2994 48.708Z'

const X86_PATH = 'M24.8828 45.5L27.5781 41.2422L24.8594 36.8984H27.4766L29 39.75H29.1406L30.6641 36.8984H33.1484L30.4375 41.1484L33.1641 45.5H30.6406L29.0312 42.6562H28.8906L27.2891 45.5H24.8828ZM39.2188 45.75C38.3125 45.75 37.5156 45.612 36.8281 45.3359C36.1406 45.0547 35.6042 44.6667 35.2188 44.1719C34.8333 43.6719 34.6406 43.0964 34.6406 42.4453V42.4297C34.6406 41.9401 34.7526 41.4974 34.9766 41.1016C35.2057 40.7057 35.5182 40.3776 35.9141 40.1172C36.3099 39.8516 36.763 39.6693 37.2734 39.5703V39.5234C36.612 39.362 36.0755 39.0599 35.6641 38.6172C35.2578 38.1693 35.0547 37.638 35.0547 37.0234V37.0078C35.0547 36.4245 35.2318 35.9062 35.5859 35.4531C35.9401 34.9948 36.4297 34.6354 37.0547 34.375C37.6797 34.1094 38.401 33.9766 39.2188 33.9766C40.0365 33.9766 40.7578 34.1094 41.3828 34.375C42.0078 34.6354 42.4974 34.9948 42.8516 35.4531C43.2057 35.9062 43.3828 36.4245 43.3828 37.0078V37.0234C43.3828 37.638 43.1771 38.1693 42.7656 38.6172C42.3542 39.0599 41.8203 39.362 41.1641 39.5234V39.5703C41.6745 39.6693 42.1276 39.8516 42.5234 40.1172C42.9193 40.3776 43.2292 40.7057 43.4531 41.1016C43.6823 41.4974 43.7969 41.9401 43.7969 42.4297V42.4453C43.7969 43.0964 43.6042 43.6719 43.2188 44.1719C42.8333 44.6667 42.2943 45.0547 41.6016 45.3359C40.9141 45.612 40.1198 45.75 39.2188 45.75ZM39.2188 44.0312C39.6302 44.0312 39.9948 43.9583 40.3125 43.8125C40.6302 43.6615 40.8776 43.4557 41.0547 43.1953C41.237 42.9297 41.3281 42.6276 41.3281 42.2891V42.2734C41.3281 41.9349 41.2396 41.6354 41.0625 41.375C40.8854 41.1094 40.638 40.901 40.3203 40.75C40.0026 40.599 39.6354 40.5234 39.2188 40.5234C38.8021 40.5234 38.4349 40.599 38.1172 40.75C37.7995 40.901 37.5495 41.1094 37.3672 41.375C37.1901 41.6354 37.1016 41.9349 37.1016 42.2734V42.2891C37.1016 42.6276 37.1927 42.9297 37.375 43.1953C37.5573 43.4557 37.8073 43.6615 38.125 43.8125C38.4427 43.9583 38.8073 44.0312 39.2188 44.0312ZM39.2188 38.8125C39.5781 38.8125 39.8958 38.7474 40.1719 38.6172C40.4479 38.4818 40.6615 38.2969 40.8125 38.0625C40.9688 37.8281 41.0469 37.5573 41.0469 37.25V37.2344C41.0469 36.9271 40.9688 36.6562 40.8125 36.4219C40.6562 36.1875 40.4401 36.0052 40.1641 35.875C39.8932 35.7448 39.5781 35.6797 39.2188 35.6797C38.8594 35.6797 38.5417 35.7448 38.2656 35.875C37.9896 36.0052 37.7734 36.1875 37.6172 36.4219C37.4609 36.6562 37.3828 36.9271 37.3828 37.2344V37.25C37.3828 37.5573 37.4609 37.8281 37.6172 38.0625C37.7734 38.2969 37.9896 38.4818 38.2656 38.6172C38.5417 38.7474 38.8594 38.8125 39.2188 38.8125ZM50.3281 45.7891C49.6719 45.7891 49.0625 45.6719 48.5 45.4375C47.9375 45.2031 47.4427 44.8464 47.0156 44.3672C46.5938 43.888 46.263 43.2839 46.0234 42.5547C45.7891 41.8255 45.6719 40.9635 45.6719 39.9688V39.9531C45.6719 38.6979 45.8594 37.6224 46.2344 36.7266C46.6146 35.8255 47.1536 35.1354 47.8516 34.6562C48.5495 34.1771 49.3776 33.9375 50.3359 33.9375C51.0651 33.9375 51.7214 34.0703 52.3047 34.3359C52.888 34.6016 53.3672 34.9635 53.7422 35.4219C54.1224 35.8802 54.3698 36.4036 54.4844 36.9922L54.5 37.0703H52.1953L52.1641 37C52.0755 36.7604 51.9453 36.5547 51.7734 36.3828C51.6068 36.2057 51.4036 36.0677 51.1641 35.9688C50.9245 35.8698 50.651 35.8203 50.3438 35.8203C49.8021 35.8203 49.3568 35.9818 49.0078 36.3047C48.6589 36.6276 48.3958 37.0651 48.2188 37.6172C48.0469 38.1693 47.9453 38.7865 47.9141 39.4688C47.9089 39.5469 47.9062 39.625 47.9062 39.7031C47.9062 39.776 47.9062 39.8542 47.9062 39.9375L48.2578 41.8203C48.2578 42.2161 48.349 42.5729 48.5312 42.8906C48.7135 43.2083 48.9609 43.4609 49.2734 43.6484C49.5859 43.8307 49.9323 43.9219 50.3125 43.9219C50.6927 43.9219 51.0365 43.8307 51.3438 43.6484C51.6562 43.4661 51.9036 43.2214 52.0859 42.9141C52.2734 42.6016 52.3672 42.2526 52.3672 41.8672V41.8516C52.3672 41.4557 52.2786 41.1068 52.1016 40.8047C51.9245 40.4974 51.6823 40.2552 51.375 40.0781C51.0729 39.901 50.724 39.8125 50.3281 39.8125C49.9427 39.8125 49.5938 39.8984 49.2812 40.0703C48.9688 40.2422 48.7188 40.4792 48.5312 40.7812C48.349 41.0781 48.2578 41.4219 48.2578 41.8125V41.8203H47.7891V39.7266H48.0625C48.2031 39.4349 48.401 39.1641 48.6562 38.9141C48.9115 38.6641 49.2318 38.4635 49.6172 38.3125C50.0026 38.1562 50.4531 38.0781 50.9688 38.0781C51.7031 38.0781 52.3464 38.237 52.8984 38.5547C53.4505 38.8724 53.8802 39.3099 54.1875 39.8672C54.4948 40.4245 54.6484 41.0599 54.6484 41.7734V41.7891C54.6484 42.5547 54.4635 43.2396 54.0938 43.8438C53.7292 44.4479 53.2214 44.9245 52.5703 45.2734C51.9245 45.6172 51.1771 45.7891 50.3281 45.7891Z'

// The pins, 5 a side: little pills in the favourites' yellow, a hairline
// of it deepened round.
function Pins() {
  const pins = PIN_OFFSETS.flatMap((offset) => [
    [offset, 4, 4, 10], [offset, 66, 4, 10], [4, offset, 10, 4], [66, offset, 10, 4],
  ])
  return pins.map(([x, y, width, height]) => (
    <rect
      key={`${x}-${y}`}
      x={x}
      y={y}
      width={width}
      height={height}
      rx="2"
      style={{ fill: 'var(--color-favorite)', stroke: 'color-mix(in oklab, var(--color-favorite), black 30%)', strokeWidth: 0.75 }}
    />
  ))
}

// The white rim inside the die's edge, bright at the top, fading down.
function Rim({ id, top, mid, bottom }) {
  return (
    <linearGradient id={id} x1="0" y1="12" x2="0" y2="68" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="white" stopOpacity={top} />
      <stop offset="0.42" stopColor="white" stopOpacity={mid} />
      <stop offset="1" stopColor="white" stopOpacity={bottom} />
    </linearGradient>
  )
}

// A shadow of two drops, near and far, as the materials' box-shadows.
function Drop({ id, color, near, far }) {
  return (
    <filter id={id} x="-20%" y="-20%" width="140%" height="150%" colorInterpolationFilters="sRGB">
      <feDropShadow dx="0" dy={near[0]} stdDeviation={near[1]} floodColor={color} floodOpacity={near[2]} />
      <feDropShadow dx="0" dy={far[0]} stdDeviation={far[1]} floodColor={color} floodOpacity={far[2]} />
    </filter>
  )
}

export function ChipAppleSilicon({ className = '' }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 80 82" width="80" height="82" fill="none" className={className} aria-hidden="true">
      <defs>
        <Rim id={`${id}-rim`} top={0.32} mid={0.1} bottom={0.02} />
        <Drop id={`${id}-drop`} color="rgb(52 18 0)" near={[1, 0.5, 0.22]} far={[2, 1.5, 0.16]} />
        <linearGradient id={`${id}-well`} x1="0" y1="20" x2="0" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="black" stopOpacity="0.34" />
          <stop offset="0.1" stopColor="black" stopOpacity="0.2" />
          <stop offset="1" stopColor="black" stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <Pins />
      {/* The edge, a pixel round, the face deepened; the drop under it. */}
      <rect x="11" y="11" width="58" height="58" rx="13" filter={`url(#${id}-drop)`} style={{ fill: 'color-mix(in oklab, var(--color-brand), black 40%)' }} />
      <rect x="12" y="12" width="56" height="56" rx="12" style={{ fill: 'var(--color-brand)' }} />
      <rect x="12.5" y="12.5" width="55" height="55" rx="11.5" stroke={`url(#${id}-rim)`} />
      {/* Engraved into the face: its lip, then the well. */}
      <rect x="20" y="21" width="40" height="40" rx="8" fill="white" fillOpacity="0.08" />
      <rect x="20" y="20" width="40" height="40" rx="8" style={{ fill: 'var(--color-brand)' }} />
      <rect x="20" y="20" width="40" height="40" rx="8" fill={`url(#${id}-well)`} />
      <path d={M_PATH} style={{ fill: 'var(--color-bg)' }} />
    </svg>
  )
}

export function ChipIntel({ className = '' }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 80 82" width="80" height="82" fill="none" className={className} aria-hidden="true">
      <defs>
        <Rim id={`${id}-rim`} top={0.32} mid={0.1} bottom={0.02} />
        <Drop id={`${id}-drop`} color="rgb(10 40 90)" near={[1, 0.5, 0.22]} far={[2, 1.5, 0.16]} />
        <linearGradient id={`${id}-well`} x1="0" y1="20" x2="0" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="black" stopOpacity="0.3" />
          <stop offset="0.1" stopColor="black" stopOpacity="0.16" />
          <stop offset="1" stopColor="black" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <Pins />
      <rect x="11" y="11" width="58" height="58" rx="13" filter={`url(#${id}-drop)`} className="fill-[color-mix(in_oklab,#1a73e8,black_40%)] dark:fill-[color-mix(in_oklab,#5b9dff,black_40%)]" />
      <rect x="12" y="12" width="56" height="56" rx="12" className="fill-[#1a73e8] dark:fill-[#5b9dff]" />
      <rect x="12.5" y="12.5" width="55" height="55" rx="11.5" stroke={`url(#${id}-rim)`} />
      <rect x="20" y="21" width="40" height="40" rx="8" fill="white" fillOpacity="0.1" />
      <rect x="20" y="20" width="40" height="40" rx="8" className="fill-[#1a73e8] dark:fill-[#5b9dff]" />
      <rect x="20" y="20" width="40" height="40" rx="8" fill={`url(#${id}-well)`} />
      <path d={X86_PATH} className="fill-white dark:fill-[#0f0f0f]" />
    </svg>
  )
}
