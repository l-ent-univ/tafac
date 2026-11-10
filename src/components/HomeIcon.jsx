import { useEffect, useRef } from 'react'

// The « Accueil » icon row's icons as short 3D clips with a transparent
// background. Each one turns once and stops front-facing, where the flat
// icon sits; they start one after the other, as a canon (`order`).
//
// Two encodings of the same clip, as no browser plays both with transparency:
// HEVC with alpha (.mov) for WebKit, VP9 with alpha (.webm) for the others.
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

// The canon: the first icon's start, then the gap to each next one.
const CANON_FIRST_MS = 150
const CANON_STEP_MS = 110

// Every iOS browser is WebKit; on a Mac only Safari is.
function isWebKit() {
  const agent = navigator.userAgent
  return /AppleWebKit/.test(agent) && !/Chrome|Chromium|Edg|OPR|Android/.test(agent)
}

function HomeIcon({ src, size = 22, order = 0, className = '' }) {
  const videoRef = useRef(null)
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
    <video
      ref={videoRef}
      src={isWebKit() ? clip.mov : clip.webm}
      poster={clip.still}
      width={size}
      height={size}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      className={`${className} object-contain`}
      aria-hidden="true"
      // Once more under the pointer.
      onPointerEnter={(event) => {
        const video = event.currentTarget
        if (!video.paused && !video.ended) return
        video.currentTime = 0
        video.play().catch(() => {})
      }}
    />
  )
}

export default HomeIcon
