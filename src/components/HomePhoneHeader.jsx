import HomeIcon from './HomeIcon'
import ServiceNotice from './ServiceNotice'
import UniversityLockup from './UniversityLockup'
import { isDesktopApp, isIosApp } from '../desktopApp'

// « Accueil »'s top: the photo to the page's edges, at full strength, fading
// down into the page; over it the logos and the account; then the row of
// icons, the greeting and the day in a sentence, on the page.
//
// - In the phone layout (a phone, a tablet: below 1024px, usePhoneViewport)
//   it stands in for the app's top bar.
// - `wide` (beside the sidebar): no logos or account, the sidebar has them;
//   larger icons and greeting, the text as wide as the cards
//   (max-w-[1320px], HomeDraftPage). The page scrolls in its column there,
//   which the photo's parallax follows (overrides.css). On the website the
//   photo runs on to the window's left edge, under the floating sidebar;
//   not in the desktop app, whose sidebar is the window's own material.
//
// - The logos sit straight on the photo, in white there (overrides.css), in
//   their own colours without one. Not in the iOS app: the app is Tafac, its
//   icon says so.
// - The account button is the student's own face when there is a photo (the
//   one picked in Mon compte, else the university's), as the sidebar's on a
//   wide screen; their initial without one. Signing out is in Mon compte.
// - Each icon is a way in (`icons`: { id, src, rotate, label, onPress }, the
//   ones there are: src/homeIconActions.js), with room for a finger.
// - The day's sentence comes a moment after the page (`briefingPending`):
//   its two lines are kept for it meanwhile, so nothing under it moves when
//   it arrives. With nothing to say, no room is kept.
// - The photo is behind the page: it goes up at half the page's speed, and
//   always ends in a fade (overrides.css, .home-phone-photo).
// - In the iOS app the account button is of the system's glass
//   (data-ios-glass, src/iosGlass.js): the photo shows through it as the
//   page scrolls.
// - In the iOS app the photo goes up behind the status bar, under a haze of
//   the page's colour for the clock to read (overrides.css, « iOS app ·
//   status bar »).
function HomePhoneHeader({
  wide = false,
  greeting,
  briefing = null,
  briefingPending = false,
  wallpaper = null,
  icons = [],
  establishment = null,
  showUniversityLogo = true,
  logoSource = 'establishment',
  userName = '',
  profilePhotoSrc = null,
  onOpenAccount = null,
}) {
  const hasPhoto = Boolean(wallpaper?.src)
  const credit = hasPhoto ? wallpaper.credit : null
  const showLogos = !wide && !isIosApp()
  const underSidebar = wide && !isDesktopApp()
  const initial = (userName || '?').trim().charAt(0).toUpperCase()

  return (
    <header className={`home-phone-header relative ${wide ? `home-phone-header-wide -mx-6 px-6 pb-2 ${underSidebar ? 'home-phone-header-under-sidebar' : ''}` : '-mx-3 px-5 pb-1'}`} data-photo={hasPhoto ? '' : undefined}>
      {hasPhoto ? (
        <div className="home-phone-photo-frame" aria-hidden="true">
          <div
            className="home-phone-photo"
            style={{ backgroundImage: `url("${wallpaper.src}")`, ...(wallpaper.position ? { backgroundPosition: wallpaper.position } : null) }}
          />
          <div className="home-phone-photo-haze" />
        </div>
      ) : null}

      {wide ? null : (
      <div className={`relative flex items-center ${showLogos ? 'justify-between' : 'justify-end'}`}>
        {showLogos ? <UniversityLockup variant="phone" establishment={establishment} showLogo={showUniversityLogo} logoSource={logoSource} /> : null}
        <button
          type="button"
          aria-label="Mon compte"
          data-ios-glass=""
          onClick={onOpenAccount ?? undefined}
          className={`inline-flex size-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full p-0 text-text transition-transform duration-150 ease-out active:scale-[0.92] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${profilePhotoSrc ? 'home-phone-portrait' : hasPhoto ? 'home-phone-glass' : 'glass-solid'}`}
        >
          {profilePhotoSrc
            ? <img src={profilePhotoSrc} alt="" className="block size-full object-cover" />
            : <span className="font-body text-[15px] font-semibold leading-none" aria-hidden="true">{initial}</span>}
        </button>
      </div>
      )}

      <div className={`relative empty:hidden ${wide ? 'max-w-[1320px]' : 'mt-3'}`}>
        <ServiceNotice />
      </div>

      <div className={`home-phone-text relative ${wide ? `max-w-[1320px] ${hasPhoto ? 'mt-[92px]' : 'mt-10'}` : hasPhoto ? 'mt-[72px]' : 'mt-7'}`}>
        {icons.length > 0 ? (
          <div className={`-ml-1.5 flex items-center ${wide ? 'gap-0.5' : ''}`}>
            {icons.map(({ id, src, rotate, label, onPress }, index) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                onClick={onPress}
                className={`group relative flex shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent p-0 transition-transform duration-150 ease-out active:scale-[0.88] focus-visible:outline-2 focus-visible:outline-text ${wide ? 'h-12 w-11 hover:z-10' : 'h-11 w-10'}`}
              >
                {/* On arrival the icons come into focus one after the other
                    (.home-icon-deal), each turning once as it lands. */}
                <span className="home-icon-deal block" style={{ '--i': index, '--r': `${rotate}deg`, transform: 'rotate(var(--r))' }}>
                  {/* Hovered (a pointer, so beside the sidebar), an icon
                      grows a little with a springy overshoot. */}
                  <HomeIcon
                    src={src}
                    size={wide ? 36 : 28}
                    order={index}
                    className={wide ? 'block size-9 select-none transition-transform duration-[450ms] ease-[cubic-bezier(0.34,1.8,0.5,1)] group-hover:scale-[1.15] motion-reduce:transition-none' : 'block size-7 select-none'}
                  />
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <h1 id="home-draft-title" className={`m-0 mt-1 font-display font-bold ${wide ? 'text-[36px]' : 'text-[30px]'} leading-[1.1] tracking-[-0.015em] text-text`}>{greeting}</h1>
        {/* The sentence's room (15px, 1.35), there before it is: two lines
            on a phone, one where it fits in one (a tablet, a computer). */}
        {briefingPending || briefing ? <div className="mt-1.5 min-h-[20.25px] max-sm:min-h-[40.5px]">{briefing}</div> : null}
        {credit?.author ? (
          <a
            className="mt-2 inline-block max-w-full truncate font-body text-[11px] font-medium leading-4 text-text-muted no-underline"
            href={credit.url || undefined}
            target="_blank"
            rel="noreferrer"
          >
            Photo : {credit.author}{credit.license ? `, ${credit.license}` : ''}
          </a>
        ) : null}
      </div>
    </header>
  )
}

export default HomePhoneHeader
