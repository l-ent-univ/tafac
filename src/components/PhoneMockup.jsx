import { useRef } from 'react'
import appTour from '../assets/landing/app-tour.mp4'
import appTourDark from '../assets/landing/app-tour-dark.mp4'
import appTourDarkPoster from '../assets/landing/app-tour-dark-poster.webp'
import appTourPoster from '../assets/landing/app-tour-poster.webp'
import flower from '../assets/landing/deco-flower.webp'
import iphoneFrame from '../assets/landing/iphone-frame.webp'
import island from '../assets/landing/landing-island.webp'
import { usePointerParallax, useVisiblePlayback } from '../landingMotion'

// A tour of the app (demo account, nothing marked new: dashboard, Mes notes,
// Planning; 390 × 797 under a 47 pt status bar, looping) in an iPhone
// frame. The frame's screen is transparent: the video sits behind it,
// inset as the screen is (the frame's 1294 × 2656 original:
// screen from 58 to 1234 across, 51 to 2604 down). When it comes first
// (`decorated`), a flower peeks out from behind its top right corner and a
// little island sits on its bottom left; the three follow the pointer at
// different depths. `darkScreen`: the same tour in the dark theme (as the
// second device on the page), the strip under the status bar to match.
function PhoneMockup({ className = '', decorated = true, darkScreen = false }) {
  const ref = useRef(null)
  const videoRef = useRef(null)
  usePointerParallax(ref)
  useVisiblePlayback(videoRef)

  return (
    <div ref={ref} className={`landing-parallax relative isolate aspect-[640/1314] ${className}`}>
      {decorated ? <img src={flower} alt="" width="256" height="252" draggable="false" className="landing-parallax-back absolute -right-[13%] -top-[4%] -z-10 w-[30%] h-auto rotate-12" /> : null}
      <div className="landing-parallax-mid relative">
        <div className={`absolute left-[4.48%] right-[4.56%] top-[1.92%] bottom-[1.92%] overflow-hidden rounded-[14%/6.5%] pt-[12.05%] ${darkScreen ? 'bg-[#191919]' : 'bg-[#f2efec]'}`}>
          <video
            ref={videoRef}
            src={darkScreen ? appTourDark : appTour}
            poster={darkScreen ? appTourDarkPoster : appTourPoster}
            width="780"
            height="1594"
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Tafac sur un téléphone : l’accueil, Mes notes et le planning"
            className="block w-full h-auto"
          />
        </div>
        <img src={iphoneFrame} alt="" width="640" height="1314" draggable="false" className="relative block w-full h-auto" />
      </div>
      {decorated ? <img src={island} alt="" width="480" height="377" draggable="false" className="landing-parallax-front absolute -bottom-[5%] -left-[34%] w-[72%] h-auto max-md:-left-[16%] max-md:w-[60%]" /> : null}
    </div>
  )
}

export default PhoneMockup
