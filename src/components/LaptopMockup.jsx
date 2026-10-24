import { useRef } from 'react'
import appTourDesktop from '../assets/landing/app-tour-desktop.mp4'
import appTourDesktopDark from '../assets/landing/app-tour-desktop-dark.mp4'
import appTourDesktopDarkPoster from '../assets/landing/app-tour-desktop-dark-poster.webp'
import appTourDesktopPoster from '../assets/landing/app-tour-desktop-poster.webp'
import flower from '../assets/landing/deco-flower.webp'
import island from '../assets/landing/landing-island.webp'
import { usePointerParallax, useVisiblePlayback } from '../landingMotion'

// A tour of the app on a computer (demo account, light or dark theme, nothing
// marked new: the dashboard, Mes notes, the planning's week; 1280 × 800 at
// 1.5×, looping) in a laptop drawn here: a lid with a thin metal edge and a
// black bezel (a camera dot at the top), a hinge, then the base, wider, with
// the notch to open it, on a soft shadow (a gradient, no blur). No brand.
// Sized in cqw, so it all scales with the laptop's width; graphite in the
// dark theme, the screen as it is. When it comes first (`decorated`), the
// phone's flower and island go with it: the flower behind the lid's top
// right corner, the island in front of the base's left end (out past it
// only where the page leaves room); the three follow the pointer at
// different depths (.landing-parallax). `darkScreen`: the same tour in the
// dark theme (as the second device on the page).
function LaptopMockup({ className = '', decorated = false, darkScreen = false }) {
  const ref = useRef(null)
  const videoRef = useRef(null)
  usePointerParallax(ref)
  useVisiblePlayback(videoRef)

  return (
    <div ref={ref} className={`landing-parallax @container relative isolate ${className}`}>
      {decorated ? <img src={flower} alt="" width="256" height="252" draggable="false" className="landing-parallax-back absolute right-[2%] -top-[9%] -z-10 w-[17%] h-auto rotate-12" /> : null}
      <div className="landing-parallax-mid">
        <div className="relative mx-auto w-[86%] rounded-[1.9cqw] bg-linear-to-b from-[#e4e3e1] to-[#c3c2bf] p-[max(1.5px,0.3cqw)] shadow-[0_1px_3px_rgb(52_18_0/0.08),0_30px_60px_-34px_rgb(52_18_0/0.4)] dark:from-[#4a4a4d] dark:to-[#2c2c2e] dark:shadow-[0_30px_60px_-34px_rgb(0_0_0/0.8)]">
          <div className="relative rounded-[1.6cqw] bg-[#121212] p-[1.4cqw] pb-[1.6cqw]">
            <span aria-hidden="true" className="absolute left-1/2 top-[0.45cqw] size-[0.5cqw] -translate-x-1/2 rounded-full bg-[#2a2d33] ring-[max(1px,0.12cqw)] ring-[#1c1c1e]" />
            <div className={`overflow-hidden rounded-[0.4cqw] ${darkScreen ? 'bg-[#191919]' : 'bg-[#fcfbf8]'}`}>
              <video
                ref={videoRef}
                src={darkScreen ? appTourDesktopDark : appTourDesktop}
                poster={darkScreen ? appTourDesktopDarkPoster : appTourDesktopPoster}
                width="1920"
                height="1200"
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="Tafac sur un ordinateur : l’accueil, Mes notes et le planning de la semaine"
                className="block w-full h-auto"
              />
            </div>
          </div>
        </div>
        {/* The hinge, in the lid's shadow. */}
        <div aria-hidden="true" className="mx-auto h-[0.5cqw] w-[80%] rounded-b-[0.4cqw] bg-linear-to-b from-[#2a2a2a] to-[#7d7c79] dark:from-[#0c0c0c] dark:to-[#38383b]" />
        <div aria-hidden="true" className="relative">
          {/* On the ground under the base. */}
          <div className="absolute inset-x-[3%] -bottom-[1.6cqw] h-[3.2cqw] bg-[radial-gradient(closest-side,rgb(52_18_0/0.3),transparent)] dark:bg-[radial-gradient(closest-side,rgb(0_0_0/0.7),transparent)]" />
          <div className="relative h-[2.2cqw] rounded-t-[0.5cqw] rounded-b-[6cqw_1.8cqw] bg-linear-to-b from-[#efeeec] via-[#d5d4d1] via-45% to-[#9b9a97] dark:from-[#5a5a5e] dark:via-[#3c3c3f] dark:to-[#1f1f21]">
            <div className="absolute left-1/2 top-0 h-[0.8cqw] w-[13%] -translate-x-1/2 rounded-b-[1cqw] bg-linear-to-b from-[#b4b3b0] to-[#d3d2cf] dark:from-[#262628] dark:to-[#3b3b3e]" />
          </div>
        </div>
      </div>
      {decorated ? <img src={island} alt="" width="480" height="377" draggable="false" className="landing-parallax-front absolute -bottom-[16%] -left-[4%] w-[28%] h-auto min-[1320px]:-left-[13%] min-[1320px]:w-[32%]" /> : null}
    </div>
  )
}

export default LaptopMockup
