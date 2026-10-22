import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { getAdeTeachers } from '../../entApi'
import { extractTeachersFromEvents, findCommonFreeSlots, generateRescheduleMessage } from '../../planningUtils'
import { CARD_CLASSES, SECONDARY_BUTTON } from '../../scodocPageUtils'

export default function TeacherCompareModal({
  isOpen,
  onClose,
  studentEvents = [],
  teacherEvents = [],
  selectedTeacher,
  onSelectTeacher,
  monday,
  loadingTeacher = false,
  studentSelection = null,
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [minDuration, setMinDuration] = useState(90) // in minutes
  const [copied, setCopied] = useState(false)
  const [selectedCourseTitle, setSelectedCourseTitle] = useState('')

  // Distinct teachers detected from student events
  const detectedTeachers = useMemo(() => {
    return extractTeachersFromEvents(studentEvents)
  }, [studentEvents])

  // Distinct courses for student this week
  const studentCourseTitles = useMemo(() => {
    const set = new Set()
    for (const ev of studentEvents) {
      if (ev.title) set.add(ev.title)
    }
    return Array.from(set).sort()
  }, [studentEvents])

  // Set default course title when teacher is chosen
  useEffect(() => {
    if (selectedTeacher) {
      const match = studentEvents.find((ev) => {
        if (ev.teachers?.some((t) => t.name === selectedTeacher.name || t.id === selectedTeacher.id)) return true
        if (ev.teacher && ev.teacher.includes(selectedTeacher.name)) return true
        return false
      })
      if (match?.title) {
        setSelectedCourseTitle(match.title)
      } else if (studentCourseTitles[0]) {
        setSelectedCourseTitle(studentCourseTitles[0])
      }
    }
  }, [selectedTeacher, studentEvents, studentCourseTitles])

  // Search teachers via API when query changes
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q || q.length < 2) {
      setSearchResults([])
      return undefined
    }

    let active = true
    setIsSearching(true)
    const timeout = setTimeout(() => {
      getAdeTeachers(q)
        .then((res) => {
          if (active && Array.isArray(res?.teachers)) {
            setSearchResults(res.teachers)
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) setIsSearching(false)
        })
    }, 250)

    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [searchQuery])

  // Compute common free slots
  const commonSlots = useMemo(() => {
    if (!selectedTeacher) return []
    return findCommonFreeSlots({
      studentEvents,
      teacherEvents,
      monday,
      minDurationMinutes: minDuration,
    })
  }, [selectedTeacher, studentEvents, teacherEvents, monday, minDuration])

  // Group label
  const groupLabel = studentSelection?.tpLabel || studentSelection?.tdLabel || 'notre groupe'

  // Generated message
  const generatedMessage = useMemo(() => {
    if (!selectedTeacher) return ''
    return generateRescheduleMessage({
      teacherName: selectedTeacher.name,
      courseTitle: selectedCourseTitle || 'notre cours',
      groupName: groupLabel,
      slots: commonSlots,
    })
  }, [selectedTeacher, selectedCourseTitle, groupLabel, commonSlots])

  const handleCopy = () => {
    if (!generatedMessage) return
    navigator.clipboard.writeText(generatedMessage).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => {})
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[26px] border border-border bg-widget-bg shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Icon icon="carbon:collaborate" className="size-5" />
            </div>
            <div>
              <h2 id="teacher-modal-title" className="m-0 font-body text-[18px] font-bold text-text">
                Disponibilités Enseignant & Déplacement
              </h2>
              <p className="m-0 font-body text-[12px] text-text-muted">
                Superpose l'emploi du temps pour trouver des créneaux libres communs
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex size-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
          >
            <Icon icon="carbon:close" className="size-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex flex-col gap-6 overflow-y-auto p-6 [scrollbar-width:thin]">
          {/* Section 1: Select Teacher */}
          <div className="flex flex-col gap-3">
            <label className="font-body text-[14px] font-semibold text-text">
              1. Choisis un enseignant
            </label>

            {/* Quick chips of teachers detected in student's schedule */}
            {detectedTeachers.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-text-muted">
                  Enseignants détectés dans ton planning cette semaine :
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {detectedTeachers.map((t) => {
                    const isSelected = selectedTeacher?.name === t.name
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => {
                          onSelectTeacher(t)
                          setSearchQuery('')
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-body text-[13px] font-medium transition-all ${
                          isSelected
                            ? 'bg-brand text-bg shadow-xs font-semibold'
                            : 'border border-border bg-bg-subtle text-text hover:border-brand/40 hover:bg-brand/5'
                        }`}
                      >
                        <Icon icon="carbon:user-avatar" className="size-3.5 opacity-75" />
                        <span>{t.name}</span>
                        {isSelected && <Icon icon="carbon:checkmark" className="size-3" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Free text search input for any teacher */}
            <div className="relative mt-1">
              <Icon icon="carbon:search" className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un autre enseignant par nom..."
                className="w-full rounded-xl border border-border bg-bg-surface py-2 pl-9 pr-8 font-body text-[14px] text-text placeholder:text-text-muted focus:border-brand focus:outline-hidden"
              />
              {isSearching && (
                <Icon icon="carbon:renew" className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-text-muted" />
              )}
            </div>

            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-widget-bg p-1 shadow-md">
                {searchResults.map((t) => (
                  <button
                    key={t.id || t.name}
                    type="button"
                    onClick={() => {
                      onSelectTeacher(t)
                      setSearchResults([])
                      setSearchQuery('')
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-body text-[13px] text-text hover:bg-bg-subtle"
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="text-[11px] text-brand">Sélectionner</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Results & Common Free Slots */}
          {selectedTeacher ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-subtle/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-body text-[14px] font-bold text-text">
                    {selectedTeacher.name}
                  </span>
                  <span className="rounded-full bg-accent-bg px-2 py-0.5 text-[11px] font-semibold text-accent-text dark:text-accent-text">
                    {loadingTeacher ? 'Chargement…' : `${teacherEvents.length} cours ce prof cette semaine`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectTeacher(null)}
                  className="text-[12px] font-medium text-text-muted hover:text-text hover:underline"
                >
                  Désélectionner
                </button>
              </div>

              {/* Slot duration selector */}
              <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-border/50">
                <span className="font-body text-[13px] font-medium text-text-secondary">
                  Durée de cours recherchée :
                </span>
                <div className="flex items-center gap-1 rounded-full border border-border bg-widget-bg p-0.5">
                  {[
                    { label: '1h', mins: 60 },
                    { label: '1h30', mins: 90 },
                    { label: '2h', mins: 120 },
                    { label: '3h', mins: 180 },
                  ].map((opt) => (
                    <button
                      key={opt.mins}
                      type="button"
                      onClick={() => setMinDuration(opt.mins)}
                      className={`rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                        minDuration === opt.mins
                          ? 'bg-brand text-bg shadow-2xs'
                          : 'text-text-secondary hover:text-text'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Free slots list */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-body text-[13px] font-semibold text-text">
                    Créneaux libres en commun trouvés :
                  </span>
                  <span className="text-[12px] font-bold text-success-text dark:text-success-text">
                    {commonSlots.length} créneau(x)
                  </span>
                </div>

                {commonSlots.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-3 text-center font-body text-[13px] text-text-muted">
                    Aucun créneau commun d'au moins {Math.floor(minDuration / 60)}h{minDuration % 60 ? minDuration % 60 : ''} trouvé cette semaine entre 8h et 18h30. Essaie de réduire la durée ou de changer de semaine.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {commonSlots.map((slot) => (
                      <div
                        key={`${slot.startMs}-${slot.endMs}`}
                        className="flex items-center justify-between rounded-xl border border-success-text/40 bg-success-bg px-3 py-2 text-success-text dark:text-success-text"
                      >
                        <div className="flex flex-col">
                          <span className="font-body text-[12px] font-bold">
                            {slot.dayName.split(' ')[0]} {slot.startTime} – {slot.endTime}
                          </span>
                          <span className="text-[11px] opacity-75">
                            {Math.floor(slot.durationMinutes / 60)}h{slot.durationMinutes % 60 ? slot.durationMinutes % 60 : ''} libres
                          </span>
                        </div>
                        <Icon icon="carbon:checkmark-filled" className="size-4 text-success-text" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 3: Ready-to-copy message */}
              <div className="mt-2 flex flex-col gap-2.5 pt-3 border-t border-border/50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="font-body text-[13px] font-bold text-text shrink-0">
                    Message pré-rempli pour l'enseignant :
                  </span>
                  {studentCourseTitles.length > 1 && (
                    <select
                      value={selectedCourseTitle}
                      onChange={(e) => setSelectedCourseTitle(e.target.value)}
                      className="max-w-full sm:max-w-[280px] truncate rounded-lg border border-border bg-muted-fill px-2 py-1 text-[12px] font-medium text-text"
                    >
                      {studentCourseTitles.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="relative rounded-xl border border-border bg-widget-bg p-3">
                  <pre className="m-0 whitespace-pre-wrap font-body text-[12px] leading-relaxed text-text-secondary select-all">
                    {generatedMessage}
                  </pre>
                  <div className="mt-3 flex flex-col sm:flex-row items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="w-full sm:flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-brand py-2 font-body text-[13px] font-semibold text-bg transition-transform hover:scale-[1.01] active:scale-[0.99]"
                    >
                      <Icon icon={copied ? 'carbon:checkmark' : 'carbon:copy'} className="size-4" />
                      <span>{copied ? 'Copié dans le presse-papier !' : 'Copier le message'}</span>
                    </button>
                    {selectedTeacher && (
                      <a
                        href={`mailto:${selectedTeacher.email || ''}?subject=${encodeURIComponent(`Demande de déplacement de cours – ${selectedCourseTitle || 'Planning'} (${groupLabel})`)}&body=${encodeURIComponent(generatedMessage)}`}
                        className="w-full sm:flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-border bg-muted-fill py-2 font-body text-[13px] font-semibold text-text hover:bg-muted-fill dark:hover:bg-brand-hover transition-colors no-underline"
                      >
                        <Icon icon="carbon:email" className="size-4 text-brand" />
                        <span>Ouvrir dans mon mail</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-6 text-center text-text-muted">
              <Icon icon="carbon:user-avatar" className="size-8 opacity-40" />
              <p className="m-0 font-body text-[13px]">
                Sélectionne un enseignant ci-dessus pour comparer vos emplois du temps et calculer vos disponibilités communes.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-border px-6 py-3.5 bg-bg-surface/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border bg-widget-bg px-4 py-2 font-body text-[13px] font-semibold text-text hover:bg-bg-subtle"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
