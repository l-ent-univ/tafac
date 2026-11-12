import { useEffect, useRef, useState } from 'react'
import { isWebKit } from '../alphaVideo'

// The « Accueil » icon row's icons as short 3D clips with a transparent
// background. Each one turns once and stops front-facing, where the flat
// icon sits; they start one after the other, as a canon (`order`).
//
// Two encodings of the same clip (alphaVideo.js): .mov for WebKit, .webm for
// the others.
// `still` is the clip's last frame: the poster, and the whole icon for whoever
// asked for less motion.
const flatIcons = import.meta.glob('../assets/home-icons/*.png', { eager: true, import: 'default' })
const clips = import.meta.glob('../assets/home-icons-3d/*.{webm,mov,png}', { eager: true, query: '?url', import: 'default' })

const nameOf = (path) => path.split('/').pop().replace(/\.[^.]+$/, '')

// Flat icon's URL -> its clip, so a caller only passes the icon it already had.
const CLIP_BY_FLAT_ICON = new Map(Object.entries(flatIcons).flatMap(([path, url]) => {
  const name = nameOf(path)
  const file = (extension) => clips[`../assets/home-icons-3d/${name}.${extension}`]
  return file('webm') && file('mov') && file('png')
    ? [[url, { name, webm: file('webm'), mov: file('mov'), still: file('png') }]]
    : []
}))

// The canon: the first icon's start, then the gap to each next one. It starts
// once the row's arrival (.home-icon-deal: 60ms + 45ms an icon, 700ms long) is
// over: Safari draws nothing of a video under a blur filter.
const CANON_FIRST_MS = 780
const CANON_STEP_MS = 110

// The clip's turn eases in and out: a quarter of the way through the clip is
// not a quarter turn. These convert between the two, so that the pointer
// turns the icon evenly.
const turnAt = (progress) => (progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2)
const progressAt = (turn) => (turn < 0.5 ? Math.cbrt(turn / 4) : 1 - Math.cbrt(2 * (1 - turn)) / 2)

function HomeIcon({ src, size = 22, order = 0, className = '' }) {
  const videoRef = useRef(null)
  // The pointer's hold on the icon: where it came in, and the turn it found.
  const scrubRef = useRef(null)
  // The still stays up until the clip has a frame on screen, then gives way.
  const [live, setLive] = useState(false)
  const clip = CLIP_BY_FLAT_ICON.get(src) ?? null
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const video = videoRef.current
    if (!video || !clip) return undefined
    const timer = window.setTimeout(() => {
      // Refused (a data saver, a background tab): the poster stays, which is the icon.
      video.play().catch(() => {})
    }, CANON_FIRST_MS + order * CANON_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [clip, order])

  if (!clip) {
    return <img src={src} alt="" width={size} height={size} draggable="false" className={className} aria-hidden="true" />
  }
  if (reduceMotion) {
    return <img src={clip.still} alt="" width={size} height={size} draggable="false" className={className} aria-hidden="true" />
  }
  return (
    <span
      className={`${className} relative`}
      aria-hidden="true"
      // Under a mouse the icon follows the pointer: crossing it turns it once
      // round, either way. Let go, it finishes its turn to face front again.
      onPointerEnter={(event) => {
        const video = videoRef.current
        if (event.pointerType !== 'mouse' || !video || !Number.isFinite(video.duration)) return
        video.pause()
        scrubRef.current = { x: event.clientX, turn: video.ended ? 0 : turnAt(video.currentTime / video.duration), frame: 0 }
      }}
      onPointerMove={(event) => {
        const scrub = scrubRef.current
        const video = videoRef.current
        if (!scrub || !video) return
        const width = event.currentTarget.getBoundingClientRect().width || size
        const turn = scrub.turn + (event.clientX - scrub.x) / width
        const wrapped = turn - Math.floor(turn)
        // One seek per frame at most, and none while the last one is still landing.
        window.cancelAnimationFrame(scrub.frame)
        scrub.frame = window.requestAnimationFrame(() => {
          if (video.seeking) return
          video.currentTime = progressAt(wrapped) * video.duration
          setLive(true)
        })
      }}
      onPointerLeave={() => {
        const scrub = scrubRef.current
        const video = videoRef.current
        if (!scrub || !video) return
        window.cancelAnimationFrame(scrub.frame)
        scrubRef.current = null
        if (video.currentTime > 0 && !video.ended) video.play().catch(() => {})
      }}
    >
      <img src={clip.still} alt="" width={size} height={size} draggable="false" className={`block size-full ${live ? 'invisible' : ''}`} />
      <video
        ref={videoRef}
        src={isWebKit() ? clip.mov : clip.webm}
        width={size}
        height={size}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        className={`absolute inset-0 size-full object-contain ${live ? '' : 'invisible'}`}
        onPlaying={() => setLive(true)}
      />
    </span>
  )
}

export default HomeIcon
