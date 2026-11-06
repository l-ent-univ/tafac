import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import film from '../assets/landing/tap-film.mp4'
import filmPoster from '../assets/landing/tap-film-poster.webp'
import { copy, copyText } from '../landingCopy'
import { useVisiblePlayback } from '../landingMotion'
import { FILM_CHAPTERS, filmChapterAt } from '../landingShowcase'

// The chapter on screen, followed frame by frame where the browser can
// (requestVideoFrameCallback), otherwise on each timeupdate (a few times a
// second); after a seek too.
function useFilmChapter(videoRef) {
  const [chapter, setChapter] = useState(FILM_CHAPTERS[0].key)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const update = (time) => setChapter(filmChapterAt(time))
    const handleTime = () => update(video.currentTime)
    let frameId = 0
    const hasFrameCallback = 'requestVideoFrameCallback' in video
    const handleFrame = (_now, metadata) => {
      update(metadata.mediaTime)
      frameId = video.requestVideoFrameCallback(handleFrame)
    }
    if (hasFrameCallback) frameId = video.requestVideoFrameCallback(handleFrame)
    video.addEventListener('timeupdate', handleTime)
    video.addEventListener('seeked', handleTime)
    return () => {
      if (hasFrameCallback) video.cancelVideoFrameCallback(frameId)
      video.removeEventListener('timeupdate', handleTime)
      video.removeEventListener('seeked', handleTime)
    }
  }, [videoRef])

  return chapter
}

// The app on a phone, in students' days (the tap film: a cut every page or
// so, each in a blurred real place, looping on the home screen). Beside it
// on wide screens, the pages it goes through: the one on screen stands out
// as it plays, and a click on one takes the film there (with reduced
// motion, where it doesn't play, that page's frame). On phones the title,
// the film, then the pages as chips. Where the university hasn't every page
// it shows, the device section stays instead (showsFilm, LandingPage).
function FilmShowcase({ className = '' }) {
  const { title, intro, videoLabel, chaptersLabel, chapters } = copy.film
  const videoRef = useRef(null)
  useVisiblePlayback(videoRef)
  const currentChapter = useFilmChapter(videoRef)

  const seek = (chapter) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = chapter.start
  }

  return (
    <section
      id="au-quotidien"
      className={`relative z-20 flex scroll-mt-28 justify-center px-6 max-md:px-4 ${className}`}
      aria-labelledby="au-quotidien-title"
    >
      <div className="grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)] items-center gap-x-16 md:grid-cols-[minmax(0,1fr)_minmax(0,440px)] md:grid-rows-[1fr_auto_auto_1fr]">
        <div className="flex flex-col items-center text-center md:col-start-1 md:row-start-2 md:items-start md:text-left">
          <h2 id="au-quotidien-title" className="m-0 text-balance text-[clamp(28px,3.4vw,40px)] font-bold leading-[1.05] text-text">
            {copyText(title)}
          </h2>
          <p className="m-0 mt-3 max-w-[44ch] text-balance text-base font-medium leading-snug text-text-muted font-body">
            {copyText(intro)}
          </p>
        </div>
        <div className="relative mx-auto mt-10 aspect-[4/5] w-full max-w-[440px] overflow-hidden corners-[36px] bg-[#1c1c1c] shadow-[0_2px_8px_rgb(52_18_0/0.08),0_30px_60px_-30px_rgb(52_18_0/0.45)] md:col-start-2 md:row-[1/-1] md:mt-0 max-md:max-w-[400px] max-md:corners-[28px]">
          <video
            ref={videoRef}
            src={film}
            poster={filmPoster}
            width="1200"
            height="1500"
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={copyText(videoLabel)}
            className="block size-full object-cover"
          />
        </div>
        <ul
          aria-label={copyText(chaptersLabel)}
          className="m-0 mt-8 flex list-none flex-col gap-1.5 p-0 md:col-start-1 md:row-start-3 md:mt-8 max-md:flex-row max-md:flex-wrap max-md:justify-center max-md:mt-6"
        >
          {FILM_CHAPTERS.map((chapter) => {
            const text = chapters[chapter.key]
            const isCurrent = chapter.key === currentChapter
            return (
              <li key={chapter.key}>
                <button
                  type="button"
                  aria-pressed={isCurrent}
                  onClick={() => seek(chapter)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-full border py-1.5 pl-1.5 pr-5 text-left font-[inherit] transition-[background-color,border-color,box-shadow,opacity] duration-300 max-md:gap-2 max-md:py-1 max-md:pl-1 max-md:pr-3.5 ${isCurrent
                    ? 'border-white bg-white opacity-100 shadow-[0_1px_3px_rgb(52_18_0/0.06),0_10px_28px_-14px_rgb(52_18_0/0.16)] dark:border-white/10 dark:bg-[#1c1c1c]'
                    : 'border-transparent bg-transparent opacity-60 hover:opacity-100'}`}
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-text max-md:size-8" aria-hidden="true">
                    <Icon icon={chapter.icon} className="size-[18px] max-md:size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-bold leading-tight text-text max-md:text-sm">{copyText(text.label)}</span>
                    <span className="text-sm leading-snug text-text-muted font-body max-md:hidden">{copyText(text.body)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

export default FilmShowcase
