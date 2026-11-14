import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { coverSourceRect, pickWallpaperTint } from '../wallpaperInk'
import { GLOW_ENTER, createWallpaperGlow } from '../wallpaperGlowShader'

// The whole switch, in ms: the light crosses, then the canvas fades away.
const GLOW_DURATION = 1050
// Without the shader (reduced motion, no WebGL): the old photo's fade.
const FADE_DURATION = 160
// A photo that takes longer to come: no effect, the preview just changes.
const LOAD_TIMEOUT = 600
const MAX_PIXEL_RATIO = 2
// The tiny copy the light takes its colours from, in pixels across.
const HAZE_WIDTH = 48
// The preview's corners (corners-[14px]), for the light on its frame.
const CORNER_RADIUS = 14

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

// A photo, loaded and decoded.
function loadImage(src) {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  return image.decode().then(() => image)
}

// The preview's size in the canvas's pixels (the screen's, two per CSS
// pixel at most): as laid out, which can fall between two pixels, and the
// whole number of them the canvas takes. Null when it has no size.
function measure(canvas) {
  const style = getComputedStyle(canvas)
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  const width = parseFloat(style.width) * ratio
  const height = parseFloat(style.height) * ratio
  if (!(width >= 1) || !(height >= 1)) return null
  return { ratio, width, height, pixelWidth: Math.round(width), pixelHeight: Math.round(height) }
}

// A photo as the preview frames it (background-size: cover at `position`,
// centred without one), on a canvas of the preview's size in pixels.
function frameCover(image, box, position) {
  const canvas = document.createElement('canvas')
  canvas.width = box.pixelWidth
  canvas.height = box.pixelHeight
  const source = coverSourceRect({
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    boxWidth: box.width,
    boxHeight: box.height,
    position: position ?? 'center',
    area: { left: 0, top: 0, width: box.width, height: box.height },
  })
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height)
  return canvas
}

// A canvas halved again and again down to `width` pixels across: its
// colours, averaged, without its detail.
function shrink(source, width) {
  let current = source
  while (current.width > width) {
    const next = document.createElement('canvas')
    next.width = Math.max(width, Math.round(current.width / 2))
    next.height = Math.max(1, Math.round((current.height * next.width) / current.width))
    next.getContext('2d').drawImage(current, 0, 0, next.width, next.height)
    current = next
  }
  return current
}

// The glow of a wallpaper switch, over the preview of Réglages › Apparence
// (WallpaperSetting): when its photo changes, a canvas covers it for a
// second, the old photo dissolving into the new one behind a band of light
// in the new photo's colours (wallpaperGlowShader.js). Nothing on the first
// render, nothing at rest: the canvas only exists while it plays. With
// reduced motion or without WebGL, the old photo just fades out, fast.
// Fills its parent (the preview, positioned), under the caption.
// `src`, `position`: the photo shown; `enabled`: the wallpaper is on.
export default function WallpaperSwitchGlow({ src, position = null, enabled = true }) {
  // The photo of the last render, and the switch playing: `from` what the
  // preview showed, `to` what it shows now, `still` without the shader.
  const [shown, setShown] = useState({ src, position })
  const [run, setRun] = useState(null)
  // The canvas is fully there: it hides the page's photo by itself.
  const [covered, setCovered] = useState(false)
  const canvasRef = useRef(null)
  const holdRef = useRef(null)
  const glowRef = useRef(null)

  // Set while rendering, not after: no frame of the new photo before the
  // old one is held over it.
  if (shown.src !== src) {
    setShown({ src, position })
    // A second pick before the first has drawn: still from the photo held.
    const from = run && !covered ? run.from : shown
    if (enabled && from.src && src && (covered || from.src !== src)) {
      setRun({ from, to: { src, position }, still: prefersReducedMotion() })
    } else {
      setRun(null)
      setCovered(false)
    }
  }

  useLayoutEffect(() => {
    if (!run) return undefined
    let cancelled = false
    let frame = 0
    let timeout = 0
    let fade = null
    const canvas = canvasRef.current
    const finish = () => {
      if (cancelled) return
      setRun((current) => (current === run ? null : current))
      setCovered(false)
    }
    const fadeOut = () => {
      const hold = holdRef.current
      if (!hold?.animate) {
        finish()
        return
      }
      fade = hold.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_DURATION, easing: 'ease-out', fill: 'forwards' })
      fade.finished.then(finish, () => {})
    }
    const cleanup = () => {
      cancelled = true
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
      fade?.cancel()
      canvas?.removeEventListener('webglcontextlost', finish)
    }

    const box = run.still || !canvas ? null : measure(canvas)
    if (!box) {
      fadeOut()
      return cleanup
    }

    // One renderer for the canvas's whole life: a pick while it plays goes
    // on from the frame it shows.
    let glow = glowRef.current
    if (!glow) {
      canvas.width = box.pixelWidth
      canvas.height = box.pixelHeight
      glow = createWallpaperGlow(canvas)
      glowRef.current = glow
    }
    if (!glow) {
      fadeOut()
      return cleanup
    }
    canvas.addEventListener('webglcontextlost', finish)
    const frozen = glow.freeze()

    // A little less light on the dark theme, where it would glare. The
    // canvas comes in over the old photo held in the page, unless it
    // already shows the frame it goes on from.
    const look = {
      seed: Math.random() * 40,
      gain: document.documentElement.dataset.theme === 'dark' ? 0.86 : 1,
      radius: (CORNER_RADIUS * box.ratio) / box.pixelHeight,
      enter: !frozen,
    }
    timeout = setTimeout(finish, LOAD_TIMEOUT)
    Promise.all([frozen ? null : loadImage(run.from.src), loadImage(run.to.src)])
      .then(([fromImage, toImage]) => {
        if (cancelled) return
        clearTimeout(timeout)
        if (fromImage) glow.setFrom(frameCover(fromImage, box, run.from.position))
        const target = frameCover(toImage, box, run.to.position)
        const haze = shrink(target, HAZE_WIDTH)
        const tint = pickWallpaperTint(haze.getContext('2d').getImageData(0, 0, haze.width, haze.height).data)
        glow.setTo(target, haze, tint ?? '#ffffff')

        let start = null
        let holding = true
        const tick = (now) => {
          if (start === null) start = now
          const time = Math.min(1, (now - start) / GLOW_DURATION)
          try {
            glow.draw(time, look)
          } catch {
            // Never a canvas left over the preview.
            finish()
            return
          }
          if (holding && (!look.enter || time >= GLOW_ENTER)) {
            holding = false
            setCovered(true)
          }
          if (time < 1) frame = requestAnimationFrame(tick)
          else finish()
        }
        frame = requestAnimationFrame(tick)
      })
      // A photo that can't be read (another origin, a broken file): no effect.
      .catch(finish)

    return cleanup
  }, [run])

  // The renderer goes with its canvas: when the switch ends, or with the
  // preview.
  const playing = Boolean(run)
  useEffect(() => {
    if (!playing) return undefined
    return () => {
      glowRef.current?.dispose()
      glowRef.current = null
    }
  }, [playing])

  if (!run) return null

  return (
    // Each layer rounded as the preview is, not clipped by this one: a
    // canvas keeps its own corners in every browser.
    <span className="pointer-events-none absolute inset-0 block" aria-hidden="true">
      {/* The old photo, held until the canvas shows it. */}
      {covered ? null : (
        <span
          ref={holdRef}
          className="absolute inset-0 corners-[14px] bg-cover bg-center"
          style={{ backgroundImage: `url("${run.from.src}")`, ...(run.from.position ? { backgroundPosition: run.from.position } : null) }}
        />
      )}
      {run.still ? null : <canvas ref={canvasRef} className="absolute inset-0 h-full w-full corners-[14px]" />}
    </span>
  )
}
