import universityShowcase from '../../universities/showcase.js'
import { copy, copyText } from '../landingCopy'

const universities = universityShowcase.filter((entry) => !entry.devOnly || import.meta.env.DEV)
// Logos per half of the track: the list repeated so one half is wider than
// the strip, whatever the number of universities.
const MIN_LOGOS_PER_HALF = 8
const half = Array.from(
  { length: Math.ceil(MIN_LOGOS_PER_HALF / Math.max(universities.length, 1)) },
  () => universities,
).flat()

const LOGO_CLASSES = 'block h-8 w-auto max-w-[160px] object-contain opacity-50 grayscale dark:invert'

// "Compatible avec :" and the universities' logos scrolling sideways. The
// track holds the logos twice and slides by one half, so the loop is seamless
// (.landing-marquee-track in overrides.css). A single university: its logo,
// still.
function UniversityMarquee({ className = '' }) {
  if (universities.length === 0) return null

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <p className="m-0 text-sm font-medium text-text-muted font-body">{copyText(copy.hero.compatible)}</p>
      {universities.length === 1 ? (
        <img className={LOGO_CLASSES} src={universities[0].logo} alt={universities[0].name} draggable="false" />
      ) : (
        <div className="landing-marquee w-full overflow-hidden" role="list" aria-label="Universités compatibles">
          <div className="landing-marquee-track flex w-max">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center gap-12 pr-12" aria-hidden={copy === 1 || undefined}>
                {half.map((entry, index) => (
                  <img
                    key={`${entry.id}-${index}`}
                    role={copy === 0 && index < universities.length ? 'listitem' : undefined}
                    className={LOGO_CLASSES}
                    src={entry.logo}
                    alt={copy === 0 && index < universities.length ? entry.name : ''}
                    draggable="false"
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default UniversityMarquee
