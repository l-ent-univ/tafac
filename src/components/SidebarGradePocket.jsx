import { useEffect, useState } from 'react'
import SidebarStatPocket from './SidebarStatPocket'
import { getLatestGrade } from '../entApi'
import {
  DEMO_LATEST_GRADE,
  GRADES_FEATURE_DISABLED,
  GRADES_UNAVAILABLE_DETAIL,
  GRADES_UNAVAILABLE_MESSAGE,
  GRADES_UNAVAILABLE_TITLE,
} from '../gradeFeatureState'

function formatGrade(grade) {
  return {
    noteDisplay: grade?.note ? String(parseFloat(grade.note)) : '—',
    noteMax: grade?.noteSur ? String(Math.round(parseFloat(grade.noteSur))) : '20',
    gradeName: grade?.description || '',
    resourceLabel: grade?.resource || '',
  }
}

function DisabledSidebarGradePocket() {
  const { noteDisplay, noteMax, gradeName } = formatGrade(DEMO_LATEST_GRADE)

  return (
    <SidebarStatPocket
      icon="ph:chart-pie-slice"
      label="Dernière note"
      value={noteDisplay}
      max={noteMax}
      caption={gradeName}
      ariaLabel={`Dernière note indisponible: ${GRADES_UNAVAILABLE_MESSAGE}`}
      tooltipPrimary={GRADES_UNAVAILABLE_TITLE}
      tooltipSecondary={GRADES_UNAVAILABLE_DETAIL}
      disabled
    />
  )
}

// A click opens « Mes notes » on that grade (`onOpen(grade)`), as the
// dashboard's "Dernière note" does.
function LiveSidebarGradePocket({ onOpen }) {
  const [grade, setGrade] = useState(null)

  useEffect(() => {
    let mounted = true
    getLatestGrade()
      .then((data) => {
        if (mounted && data && !data.error) {
          setGrade(data)
        }
      })
      .catch(() => {})
    return () => { mounted = false }
  }, [])

  if (!grade) return null

  const { noteDisplay, noteMax, gradeName, resourceLabel } = formatGrade(grade)
  const ariaTooltipParts = [gradeName, resourceLabel].filter(Boolean).join(' — ')

  return (
    <SidebarStatPocket
      icon="ph:chart-pie-slice"
      label="Dernière note"
      value={noteDisplay}
      max={noteMax}
      onClick={() => onOpen(grade)}
      caption={gradeName}
      ariaLabel={`Dernière note: ${noteDisplay} sur ${noteMax}${ariaTooltipParts ? ` (${ariaTooltipParts})` : ''}`}
      tooltipPrimary={gradeName}
      tooltipSecondary={resourceLabel}
    />
  )
}

function SidebarGradePocket({ onOpen }) {
  if (GRADES_FEATURE_DISABLED) {
    return <DisabledSidebarGradePocket />
  }

  return <LiveSidebarGradePocket onOpen={onOpen} />
}

export default SidebarGradePocket
