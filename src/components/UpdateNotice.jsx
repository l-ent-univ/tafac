import { useCallback, useState } from 'react'
import { Icon } from '@iconify/react'

function UpdateNotice({ onUpdateClick, className = '' }) {
  const [isApplying, setIsApplying] = useState(false)

  const handleClick = useCallback(async () => {
    if (isApplying) return
    setIsApplying(true)
    try {
      await onUpdateClick?.()
    } catch (error) {
      console.error('Failed to apply update', error)
      setIsApplying(false)
    }
  }, [isApplying, onUpdateClick])

  return (
    <div className={`flex items-center gap-2 px-3 py-2 corners-[16px] border border-border/70 bg-widget-bg/60 text-[13px] font-body leading-[1.3] ${className}`}>
      <Icon icon="carbon:rocket" className="w-[14px] h-[14px] shrink-0 text-text-muted" aria-hidden="true" />
      <span
        className="bg-[linear-gradient(90deg,var(--color-text-muted)_0%,var(--color-text)_50%,var(--color-text-muted)_100%)] bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer"
        style={{ animationDuration: '3s' }}
      >
        Nouvelle version
      </span>
      <button
        type="button"
        onClick={handleClick}
        disabled={isApplying}
        className="ml-auto bg-transparent border-0 p-0 text-text font-medium underline underline-offset-2 decoration-text-muted/40 hover:decoration-text cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        {isApplying ? 'Mise à jour…' : 'Mettre à jour'}
      </button>
    </div>
  )
}

export default UpdateNotice
