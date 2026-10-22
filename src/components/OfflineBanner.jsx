import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { isOnline } from '../offlineStorage'

export default function OfflineBanner({ className = '' }) {
  const [online, setOnline] = useState(() => isOnline())

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-[13px] font-body shadow-xs animate-in fade-in slide-in-from-top-1 ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="size-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
        <Icon icon="carbon:cloud-offline" className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="font-semibold truncate">Mode hors-ligne actif</span>
        <span className="hidden sm:inline text-amber-800/80 dark:text-amber-300/80">
          — Vos cours, notes et devoirs enregistrés restent accessibles.
        </span>
      </div>
      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/20 shrink-0">
        Lecture seule
      </span>
    </div>
  )
}
