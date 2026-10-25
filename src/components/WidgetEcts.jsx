import { useMemo } from 'react'
import { shadeHex } from '../colorContrast'
import { useUeColor } from '../useUeColor'
import { buildGradesReport, formatGrade } from '../gradesReport'
import CardInfoTip from './CardInfoTip'

// Square, as tall as the average card beside it; on phones a card of the
// overview's strip, last (after "UE validées").
const CARD_CLASSES = 'ects-widget widget-card shadow-md size-[188px] shrink-0 p-4 border card-corners overflow-hidden text-base leading-6 border-white bg-widget-bg flex flex-col gap-[6px] text-text max-md:order-2 max-md:h-auto max-md:min-h-[160px] max-md:w-auto max-md:flex-[1_0_clamp(136px,40%,170px)] max-md:snap-start max-md:p-3 relative'

// The piles' drawing space (the card's width, its lower part) and a coin:
// a face (an ellipse) on an edge `THICKNESS` deep, `STEP` apart in a pile.
const VIEW_WIDTH = 188
const VIEW_HEIGHT = 150
const COIN_RX = 19
const COIN_RY = 7.5
const THICKNESS = 5.5
const STEP = 5.5
const BASE_Y = VIEW_HEIGHT - 12
const RIGHT_EDGE = VIEW_WIDTH - 12
const FALLBACK_COLOR = '#611a00'

// A pile a little untidy, the same way every time: each coin a pixel or so
// off the pile's axis.
function coinOffset(pileIndex, coinIndex) {
  return (((coinIndex * 7 + pileIndex * 3) % 5) - 2) * 0.7
}

// One pile per UE, one coin per credit: in the UE's colour once earned, an
// outline for those still to earn. Without per-UE credits, one pile for the
// semester.
function buildPiles(report, credits) {
  const ues = (report?.ues ?? []).filter((ue) => ue.ects?.total > 0)
  const piles = ues.length
    ? ues.map((ue) => ({ code: ue.code, color: ue.color ?? FALLBACK_COLOR, total: ue.ects.total, earned: ue.ects.earned ?? 0 }))
    : [{ code: 'semestre', color: FALLBACK_COLOR, total: credits.total, earned: credits.earned }]
  return piles.map((pile) => ({
    ...pile,
    coins: Math.max(1, Math.round(pile.total)),
    earnedCoins: Math.round(Math.min(pile.earned, pile.total)),
  }))
}

function CoinPiles({ piles }) {
  // The UEs' colours as painted elsewhere on the page (lifted on the dark theme).
  const paintUe = useUeColor()
  // Spread over the card's width, closer when there are many UEs.
  const gap = Math.min(46, (RIGHT_EDGE - 12 - COIN_RX * 2) / Math.max(1, piles.length - 1))
  let order = 0
  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="xMaxYMax meet"
      className="ects-piles pointer-events-none absolute inset-x-0 bottom-0 h-[80%] w-full"
      aria-hidden="true"
    >
      {piles.map((pile, pileIndex) => {
        // Centred as a group under the ring.
        const span = (piles.length - 1) * gap
        const cx = VIEW_WIDTH / 2 - span / 2 + pileIndex * gap
        const color = paintUe(pile.color)
        const edge = shadeHex(color, 0.62)
        return (
          <g key={pile.code}>
            {Array.from({ length: pile.coins }, (_, coinIndex) => {
              const x = cx + coinOffset(pileIndex, coinIndex)
              const y = BASE_Y - THICKNESS - coinIndex * STEP
              const isEarned = coinIndex < pile.earnedCoins
              // Piles rise left to right, coin by coin, in one short stagger.
              const delay = Math.min(order++ * 18, 700)
              return (
                <g key={coinIndex} className={`ects-coin ${isEarned ? '' : 'ects-coin--due'}`} style={{ animationDelay: `${delay}ms` }}>
                  <path
                    d={`M${x - COIN_RX} ${y}v${THICKNESS}a${COIN_RX} ${COIN_RY} 0 0 0 ${COIN_RX * 2} 0v${-THICKNESS}z`}
                    fill={isEarned ? edge : 'none'}
                    className="ects-coin-line"
                  />
                  <ellipse cx={x} cy={y} rx={COIN_RX} ry={COIN_RY} fill={isEarned ? color : 'var(--color-widget-bg)'} className="ects-coin-line" />
                  {isEarned ? <ellipse cx={x} cy={y} rx={COIN_RX * 0.62} ry={COIN_RY * 0.62} fill="none" className="ects-coin-shine" /> : null}
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

// Ring geometry from the Figma card (138px across, a 10.76px stroke), drawn
// smaller by CSS (.ects-ring size) so the card matches the average's height;
// the stroke scales with it.
const RING_SIZE = 138
const RING_STROKE = 10.764
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

// Credits earned this semester against the semester's total, as a ring. The
// arc starts at 3 o'clock and runs clockwise, as in the design. Behind it,
// faint, the credits as piles of coins, one per UE in its colour. Hidden
// until the jury awards some: an empty ring mid-semester only worries.
function WidgetEcts({ releve = null, config = null, visible = false }) {
  // ECTS as buildGradesReport reads them (none when the department turns
  // show_ects off).
  const report = useMemo(() => (releve ? buildGradesReport(releve, { config }) : null), [releve, config])
  const credits = report?.ects ?? null
  const piles = useMemo(() => (credits?.earned && credits.total ? buildPiles(report, credits) : []), [report, credits])

  if (!credits?.earned || !credits.total) {
    return null
  }

  const { earned, total } = credits
  const share = Math.min(1, Math.max(0, earned / total))

  return (
    <article
      className={`${CARD_CLASSES} ${visible ? 'widget-card-visible' : ''}`}
      aria-label={`Crédits ECTS : ${formatGrade(earned)} sur ${formatGrade(total)}`}
    >
      <CoinPiles piles={piles} />
      <div className="relative z-10 flex items-center gap-[5px] min-w-0">
        <span className="m-0 min-w-0 leading-[1.06] text-base font-medium text-text-muted overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[14px]">Crédits ECTS</span>
        <CardInfoTip label="Les crédits ECTS, c’est quoi ?">
          Les crédits ECTS valident ton semestre : chaque UE en apporte un nombre fixe. Le jury les attribue en fin de semestre pour chaque UE validée. En fond, une pile par UE, une pièce par crédit.
        </CardInfoTip>
      </div>
      <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          className="ects-ring block shrink-0 size-[120px] max-md:size-auto max-md:w-full max-md:max-w-[108px]"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={earned}
          aria-label="Crédits ECTS obtenus"
        >
          <circle className="ects-ring-track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} />
          {share > 0 ? (
            <circle
              className="ects-ring-arc"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - share)}
              style={{ '--ects-ring-length': RING_LENGTH }}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="font-display text-[37px] font-bold leading-none max-md:text-[32px]">{formatGrade(earned)}</span>
          <span className="text-[19px] font-medium leading-[1.06] max-md:text-[17px]">/{formatGrade(total)}</span>
        </div>
      </div>
    </article>
  )
}

export default WidgetEcts
