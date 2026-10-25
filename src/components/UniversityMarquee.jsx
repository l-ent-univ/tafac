import { copy, copyText } from '../landingCopy'
import { getListedUniversities } from '../universityRuntime'

// The universities the server lists (the login page's picker too; dev-only
// ones on dev servers only), as known at boot, with a logo. Each one links
// to its own landing page (/<slug>), which search engines then find.
const universities = getListedUniversities()
  .filter((entry) => entry.logoUrl)
  .map((entry) => ({ id: entry.id, name: entry.name, logo: entry.logoUrl, href: `/${entry.slug}` }))
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
        <a href={universities[0].href} className="rounded-md">
          <img className={LOGO_CLASSES} src={universities[0].logo} alt={universities[0].name} draggable="false" />
        </a>
      ) : (
        <nav className="landing-marquee w-full overflow-hidden" aria-label="Universités compatibles">
          <div className="landing-marquee-track flex w-max">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center gap-12 pr-12" aria-hidden={copy === 1 || undefined}>
                {half.map((entry, index) => {
                  // The first of each, once: the others only fill the loop.
                  const isListed = copy === 0 && index < universities.length
                  return (
                    <a
                      key={`${entry.id}-${index}`}
                      href={entry.href}
                      aria-hidden={isListed ? undefined : true}
                      tabIndex={isListed ? undefined : -1}
                      className="shrink-0 rounded-md"
                      draggable="false"
                    >
                      <img className={LOGO_CLASSES} src={entry.logo} alt={isListed ? entry.name : ''} draggable="false" />
                    </a>
                  )
                })}
              </div>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

export default UniversityMarquee
