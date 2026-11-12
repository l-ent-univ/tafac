import { useEffect, useRef, useState } from 'react'
import hillsMov from '../assets/landing/footer-hills.mov?url'
import hillsPoster from '../assets/landing/footer-hills-poster.webp'
import hillsStill from '../assets/landing/footer-hills-still.webp'
import hillsWebm from '../assets/landing/footer-hills.webm?url'
import { isWebKit } from '../alphaVideo'
import { useVisiblePlayback } from '../landingMotion'

// The page's last picture: a meadow across the whole width, on the page's
// own background (the clip is transparent above the hills). The app's icons
// come over the hills and roll down into the valley, once the meadow is on
// screen, and again each time it comes back. The poster (the empty meadow)
// stays up until the clip has a frame to show; neither is fetched before the
// page's bottom is near. With reduced motion, the clip's last frame instead:
// the icons at rest in the valley.
function FooterHills({ className = '' }) {
  const imageRef = useRef(null)
  const videoRef = useRef(null)
  const [live, setLive] = useState(false)

  // Which clip, or none, is only known in the browser (the page is also
  // rendered ahead, without one).
  useEffect(() => {
    const image = imageRef.current
    const video = videoRef.current
    if (!image || !video) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) image.src = hillsStill
    else video.src = isWebKit() ? hillsMov : hillsWebm
  }, [])
  // A third of it on screen is enough: on a wide, short window it is taller than the window.
  useVisiblePlayback(videoRef, 0.35)

  return (
    <div aria-hidden="true" className={`pointer-events-none relative aspect-[16/9] w-full select-none ${className}`}>
      <img
        ref={imageRef}
        src={hillsPoster}
        alt=""
        width="1600"
        height="900"
        loading="lazy"
        decoding="async"
        draggable="false"
        className={`block size-full ${live ? 'invisible' : ''}`}
      />
      <video
        ref={videoRef}
        width="1600"
        height="900"
        muted
        playsInline
        preload="none"
        disablePictureInPicture
        className={`absolute inset-0 size-full ${live ? '' : 'invisible'}`}
        onPlaying={() => setLive(true)}
      />
    </div>
  )
}

export default FooterHills
