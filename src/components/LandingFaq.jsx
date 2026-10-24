import { useState } from 'react'
import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { copy, copyText, renderCopy } from '../landingCopy'

const repoUrl = universityConfig.branding.about?.repoUrl ?? null

// Questions shown before « Voir plus de questions ».
const FIRST_QUESTIONS = 4

// PLACEHOLDER copy, for the landing page's mockup: to rewrite before launch
// (landingCopy.json, `faq`; the order and the emojis here).
// Each answer says only what the code does (the login and the session:
// server/entAuthApp.js, server/sessionCookie.js; the notes and the next
// class per establishment: `establishments` in the university's client.js;
// the install: PwaInstallPrompt; the statistics: docs/ANALYTICS.md). Check
// it again before changing a word.
// The GitHub ones only where the repo is set.
const QUESTIONS = [
  { id: 'gratuit', emoji: '💸' },
  { id: 'officiel', emoji: '🏫' },
  { id: 'appareils', emoji: '📱' },
  { id: 'identifiants', emoji: '🔑' },
  { id: 'motDePasse', emoji: '🔐' },
  { id: 'donnees', emoji: '🛡️' },
  { id: 'session', emoji: '⏱️' },
  { id: 'installer', emoji: '📲' },
  { id: 'notes', emoji: '📊' },
  { id: 'universite', emoji: '🎓' },
  repoUrl ? { id: 'contribuer', emoji: '🧑‍💻' } : null,
  repoUrl ? { id: 'contact', emoji: '🐞' } : null,
]
  .filter(Boolean)
  .map((entry) => ({ ...entry, ...copy.faq.questions[entry.id] }))

// "Questions fréquentes": what students ask before signing in, in the
// look of Papillon's own FAQ: a card per question, its emoji first and a
// chevron last, opening on a click (<details>, one at a time) with the
// answer under the question's text. Opens and closes smoothly where the
// browser can (.landing-faq in overrides.css). The first FIRST_QUESTIONS
// only, the rest behind a button.
function LandingFaq({ className = '' }) {
  const [isExpanded, setExpanded] = useState(false)
  const hiddenCount = isExpanded ? 0 : Math.max(QUESTIONS.length - FIRST_QUESTIONS, 0)
  const questions = hiddenCount > 0 ? QUESTIONS.slice(0, FIRST_QUESTIONS) : QUESTIONS

  return (
    <section id="faq" className={`landing-faq scroll-mt-28 flex justify-center px-6 max-md:px-4 ${className}`} aria-labelledby="faq-title">
      <div className="flex w-full max-w-[820px] flex-col items-center">
        <h2 id="faq-title" className="m-0 text-balance text-center text-[clamp(28px,3.4vw,40px)] font-bold leading-[1.05] text-text">
          {copyText(copy.faq.title)}
        </h2>
        <div className="mt-10 flex w-full flex-col gap-3 max-md:mt-8">
          {questions.map(({ id, emoji, question, answer }) => (
            <details
              key={id}
              name="landing-faq"
              className="group rounded-[20px] border border-border bg-white px-6 transition-shadow duration-300 hover:shadow-[0_6px_20px_-10px_rgb(52_18_0/0.25)] open:shadow-[0_6px_20px_-10px_rgb(52_18_0/0.25)] dark:border-white/10 dark:bg-[#1c1c1c] max-md:rounded-[18px] max-md:px-4"
            >
              <summary className="flex cursor-pointer list-none items-center gap-4 py-5 text-left text-[18px] font-bold leading-snug text-text max-md:gap-3 max-md:py-4 max-md:text-base [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="w-7 shrink-0 text-center text-[24px] leading-none max-md:w-6 max-md:text-[20px]">{emoji}</span>
                <span className="min-w-0 flex-1">{copyText(question)}</span>
                <Icon
                  icon="carbon:chevron-down"
                  className="size-5 shrink-0 text-text transition-transform duration-300 group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="m-0 pb-5 pl-11 pr-9 text-[16px] leading-relaxed text-text-secondary font-body max-md:pb-4 max-md:pl-9 max-md:pr-0 max-md:text-[15px]">
                {renderCopy(answer)}
              </p>
            </details>
          ))}
        </div>
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="mt-6 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-white px-5 text-[15px] font-semibold text-text transition-colors hover:bg-bg-subtle dark:border-white/10 dark:bg-[#1c1c1c] dark:hover:bg-[#242424]"
            onClick={() => setExpanded(true)}
          >
            {copyText(copy.faq.showMore)}
            <Icon icon="carbon:chevron-down" className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  )
}

export default LandingFaq
