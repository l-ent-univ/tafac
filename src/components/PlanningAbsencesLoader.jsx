import { useEffect, useMemo } from 'react'
import { buildAbsenceReport } from '../gradesReport'
import { useScodocReleve } from '../useScodocReleve'

// Mounted only while the planning shows the absences (the ScoDoc relevé is
// asked then, not before): hands PlanningPage the semester's absences, as
// the « Assiduité » page reads them; none when the department doesn't
// publish them. shortcut: the semester ScoDoc's pages have picked (the
// newest at first), not the one of the week shown.
function PlanningAbsencesLoader({ onEntries }) {
  const { entry, releve, config } = useScodocReleve()
  const entries = useMemo(() => {
    if (entry.status !== 'ok' || !releve) return []
    const report = buildAbsenceReport(entry.payload, releve, config)
    return report.visible ? report.entries : []
  }, [entry.status, entry.payload, releve, config])
  useEffect(() => {
    onEntries(entries)
  }, [entries, onEntries])
  return null
}

export default PlanningAbsencesLoader
