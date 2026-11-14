import { useEffect, useId, useState } from 'react'

// « Mise à jour nécessaire »'s backdrop: the app's widgets and icons
// pressing through a sheet of cloth from behind, only their silhouettes
// showing, each pushing in and out on its own beat.
//
// Plain SVG lighting. Each silhouette is a rounded box whose outline,
// blurred twice (a dome, not a plateau), is a height map; feDiffuseLighting
// turns it into a relief lit from the top left, in grey around 50 %: flat
// cloth comes out exactly mid-grey (the light's colour is 50 % grey, its
// strength 1 / sin of its elevation). That relief is split in two layers:
// what is above mid-grey as white (the lit slopes), what is below as the
// shadow's colour, each transparent where the cloth is flat, so boxes can
// overlap without seams. Their strengths are the theme's (overrides.css):
// on white cloth the light needs more, on dark cloth the shadow does.
// Each box is its own layer, computed once: the motion is only its opacity
// and a small drift, which the compositor does without lighting again.
// The cloth itself is smooth: no texture, only what presses through.
//
// The scene is drawn on a 1440 × 900 stage, scaled to cover the window.

const STAGE_WIDTH = 1440
const STAGE_HEIGHT = 900
// The relief reaches about 2.5 blurs past a box's edge.
const BLUR = 18
const MARGIN = 90
const ELEVATION = 48
const LIGHT_STRENGTH = (1 / Math.sin((ELEVATION * Math.PI) / 180)).toFixed(4)

// x, y, width, height, corner radius on the stage; the beat's length (s)
// and where in it the box starts. The middle stays clear for the dialog.
const SHAPES = [
  // Left column: the planning, two app icons, a card.
  { x: 96, y: 92, w: 300, h: 214, r: 34, beat: 7.4, phase: 0.1 },
  { x: 118, y: 392, w: 104, h: 104, r: 28, beat: 6.1, phase: 0.55 },
  { x: 262, y: 404, w: 104, h: 104, r: 28, beat: 6.8, phase: 0.2 },
  { x: 104, y: 590, w: 300, h: 208, r: 34, beat: 8.2, phase: 0.75 },
  // Top and bottom middle: icons.
  { x: 612, y: 70, w: 98, h: 98, r: 27, beat: 5.8, phase: 0.35 },
  { x: 744, y: 84, w: 98, h: 98, r: 27, beat: 6.6, phase: 0.85 },
  { x: 596, y: 716, w: 104, h: 104, r: 28, beat: 7.0, phase: 0.6 },
  { x: 742, y: 700, w: 104, h: 104, r: 28, beat: 6.3, phase: 0.05 },
  // Right column: the grades, a tall card, the mail.
  { x: 1006, y: 84, w: 344, h: 190, r: 34, beat: 7.8, phase: 0.45 },
  { x: 1046, y: 354, w: 270, h: 262, r: 34, beat: 8.6, phase: 0.9 },
  { x: 1000, y: 690, w: 330, h: 150, r: 34, beat: 7.2, phase: 0.3 },
]

function useStageScale() {
  const read = () => Math.max(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT)
  const [scale, setScale] = useState(read)
  useEffect(() => {
    const update = () => setScale(read())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return scale
}

function Relief({ shape, filterId }) {
  const width = shape.w + MARGIN * 2
  const height = shape.h + MARGIN * 2
  return (
    <div
      className="cloth-relief"
      style={{
        left: shape.x - MARGIN,
        top: shape.y - MARGIN,
        width,
        height,
        animationDuration: `${shape.beat}s`,
        animationDelay: `${-shape.beat * shape.phase}s`,
      }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {['light', 'shadow'].map((part) => (
          <filter key={part} id={`${filterId}-${part}`} filterUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation={BLUR} result="soft" />
            <feGaussianBlur in="soft" stdDeviation={BLUR} result="height" />
            <feDiffuseLighting in="height" surfaceScale="26" diffuseConstant={LIGHT_STRENGTH} lightingColor="#808080" result="relief">
              <feDistantLight azimuth="225" elevation={ELEVATION} />
            </feDiffuseLighting>
            {/* light: white, as opaque as the relief is above mid-grey;
                shadow: black, as opaque as it is below. */}
            <feColorMatrix
              in="relief"
              type="matrix"
              values={part === 'light'
                ? '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.8 0 0 0 -0.9'
                : '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.8 0 0 0 0.9'}
            />
            {/* The lighting comes in 8-bit steps: smoothed, so no rings. */}
            <feGaussianBlur stdDeviation="3" />
          </filter>
        ))}
        {['light', 'shadow'].map((part) => (
          <rect
            key={part}
            className={`cloth-${part}`}
            x={MARGIN}
            y={MARGIN}
            width={shape.w}
            height={shape.h}
            rx={shape.r}
            fill="#000"
            filter={`url(#${filterId}-${part})`}
          />
        ))}
      </svg>
    </div>
  )
}

function ClothBackdrop() {
  const id = useId().replace(/:/g, '')
  const reliefFilter = `${id}-relief`
  const scale = useStageScale()

  return (
    <div className="cloth-backdrop" aria-hidden="true">
      <div
        className="cloth-stage"
        style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {SHAPES.map((shape, index) => <Relief key={`${shape.x},${shape.y}`} shape={shape} filterId={`${reliefFilter}-${index}`} />)}
      </div>
    </div>
  )
}

export default ClothBackdrop
