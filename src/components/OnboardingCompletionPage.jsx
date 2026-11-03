// The student's first name, when known: « Super Camille ! Tout est prêt ! »;
// without one, « Super ! Tout est prêt ! » (the same in « tu » and « vous »).
function getCompletionName(userName) {
  if (typeof userName !== 'string') {
    return ''
  }

  const [firstName] = userName.trim().split(/\s+/)
  return firstName || ''
}

function OnboardingCompletionPage({ userName, isLeaving = false }) {
  const displayName = getCompletionName(userName)

  return (
    <section className={`onboarding-completion-page ${isLeaving ? 'onboarding-completion-page--leaving' : ''} flex flex-1 items-center justify-center bg-bg px-8 py-10 max-sm:px-5 max-sm:py-8`} aria-label="Configuration terminée">
      <div className={`onboarding-completion-panel ${isLeaving ? 'onboarding-completion-panel--leaving' : ''} flex w-full max-w-[760px] flex-col items-center justify-center text-center`}>
        <h1 className="m-0 max-w-[680px] text-[2.8rem] font-bold leading-[0.94] text-text max-sm:text-[2.1rem]">
          Super{displayName ? ` ${displayName}` : ''} ! Tout est prêt !
        </h1>
      </div>
    </section>
  )
}

export default OnboardingCompletionPage
