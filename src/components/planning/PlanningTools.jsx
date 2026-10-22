import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { getAdeTeachers } from '../../entApi'
import { addDays } from '../../planningDates'
import { SECONDARY_BUTTON } from '../../scodocPageUtils'
import { fetchUpcomingEvents } from '../../upcomingClasses'
import FreeRoomsModal from './FreeRoomsModal'
import TeacherCompareModal from './TeacherCompareModal'

// Round like the header's export, its word sliding out on hover or focus.
function ToolButton({ icon, label, accent = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${SECONDARY_BUTTON} group relative h-[42px] shrink-0 cursor-pointer justify-center gap-0! px-3! py-0! max-md:size-10 max-md:p-0 max-md:shadow-xs ${accent ? 'border-brand! text-brand!' : ''}`}
    >
      <Icon icon={icon} className="size-4 shrink-0 max-md:size-[18px]" aria-hidden="true" />
      <span className="planning-export-label max-md:hidden" aria-hidden="true">{label}</span>
    </button>
  )
}

// The planning's extras, in its header: free rooms, and a teacher's week
// next to the student's (common free slots, a reschedule request).
// `events`: the student's classes known so far; `monday`: the shown week
// ("YYYY-MM-DD").
function PlanningTools({ events, monday, selection }) {
  const [isRoomsOpen, setIsRoomsOpen] = useState(false)
  const [isCompareOpen, setIsCompareOpen] = useState(false)
  const [teacher, setTeacher] = useState(null)
  const [teacherState, setTeacherState] = useState({ status: 'idle', events: [] })

  useEffect(() => {
    if (!teacher?.id) {
      setTeacherState({ status: teacher ? 'ok' : 'idle', events: [] })
      return undefined
    }

    const controller = new AbortController()
    setTeacherState({ status: 'loading', events: [] })
    fetchUpcomingEvents({ selection: { resourceId: teacher.id }, signal: controller.signal, startDate: monday, lookaheadDays: 7 })
      .then((result) => setTeacherState({ status: 'ok', events: result.events || [] }))
      .catch((error) => {
        if (error?.name !== 'AbortError') setTeacherState({ status: 'error', events: [] })
      })
    return () => controller.abort()
  }, [teacher, monday])

  // A teacher picked by name only (from a class): their ADE id, when found.
  const selectTeacher = useCallback(async (picked) => {
    if (!picked?.id && picked?.name) {
      const res = await getAdeTeachers(picked.name).catch(() => null)
      const match = res?.teachers?.find((candidate) => candidate.name.toLowerCase() === picked.name.toLowerCase())
      setTeacher(match?.id ? match : picked)
      return
    }
    setTeacher(picked ?? null)
  }, [])

  const weekEvents = useMemo(() => events.filter((event) => event.day >= monday && event.day < addDays(monday, 7)), [events, monday])
  const mondayDate = useMemo(() => new Date(`${monday}T00:00:00`), [monday])

  return (
    <>
      <ToolButton icon="carbon:workspace" label="Salles libres" onClick={() => setIsRoomsOpen(true)} />
      <ToolButton icon="carbon:collaborate" label={teacher ? 'Comparaison' : 'Profs'} accent={Boolean(teacher)} onClick={() => setIsCompareOpen(true)} />
      <FreeRoomsModal isOpen={isRoomsOpen} onClose={() => setIsRoomsOpen(false)} events={events} />
      <TeacherCompareModal
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        studentEvents={weekEvents}
        teacherEvents={teacherState.events}
        selectedTeacher={teacher}
        onSelectTeacher={selectTeacher}
        monday={mondayDate}
        loadingTeacher={teacherState.status === 'loading'}
        studentSelection={selection}
      />
    </>
  )
}

export default PlanningTools
