import { useLayoutEffect, useMemo, useRef } from 'react'
import { KEPT_PAGE_CLASS, settleAnimations } from '../keptPages'
import { PageVisitContext } from '../pageVisit'

// A page's place in the app's column, with its switch effect (.page-enter).
// `kept`: its entry among the pages kept, in the iOS app (src/keptPages.js);
// without one the page is only there while shown, as everywhere else.
// Kept and not `shown`, it stays mounted, out of the layout (`hidden`: no
// box, no animation, no paint), and its content is told so
// (src/pageVisit.js). Shown again, it comes back with the switch effect
// alone: the animations that start over inside it are taken to their end.
function KeptPage({ kept = null, shown = true, children }) {
  const ref = useRef(null)
  const wasShownRef = useRef(shown)
  useLayoutEffect(() => {
    if (shown && !wasShownRef.current) settleAnimations(ref.current)
    wasShownRef.current = shown
  }, [shown])

  const visit = kept?.visit ?? 1
  const page = useMemo(() => ({ shown, visit }), [shown, visit])

  return (
    <PageVisitContext value={page}>
      <div ref={ref} className={`${kept ? `${KEPT_PAGE_CLASS} ` : ''}page-enter flex-1 min-h-0 4xl:flex-none 4xl:min-h-0`} hidden={!shown}>
        {children}
      </div>
    </PageVisitContext>
  )
}

export default KeptPage
