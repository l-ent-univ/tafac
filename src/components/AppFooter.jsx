import { useState } from 'react'
import { Icon } from '@iconify/react'
import { useDevBranch } from '../useDevBranch'
import AboutModal from './AboutModal'

/* global __BUILD_HASH__ */

function AppFooter({ heroCredit = null }) {
  const [aboutOpen, setAboutOpen] = useState(false)
  const devBranch = useDevBranch()

  return (
    <footer className="flex items-center justify-center gap-[6px] pt-1 pb-4 px-4 text-text-muted text-[12px]">
      <span className="font-mono">
        {import.meta.env.DEV ? `dev${devBranch ? ` · ${devBranch}` : ''}` : `build ${typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'}`}
      </span>
      <button
        type="button"
        className="inline-flex items-center justify-center border-0 bg-transparent text-text-muted transition-colors duration-120 hover:text-text cursor-pointer p-0"
        onClick={() => setAboutOpen(true)}
        aria-label="À propos"
      >
        <Icon icon="carbon:information" className="h-[14px] w-[14px]" />
      </button>
      {heroCredit?.author ? (
        <>
          <span aria-hidden="true">·</span>
          <a
            className="text-text-muted no-underline transition-colors duration-120 hover:text-text"
            href={heroCredit.url}
            target="_blank"
            rel="noreferrer"
          >
            Photo : {heroCredit.author}{heroCredit.license ? `, ${heroCredit.license}` : ''}
          </a>
        </>
      ) : null}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </footer>
  )
}

export default AppFooter
