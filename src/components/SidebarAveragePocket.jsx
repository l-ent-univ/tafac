import { useEffect, useState } from 'react'
import SidebarStatPocket from './SidebarStatPocket'
import { navigateTo } from '../appRoute'
import { GRADES_LAUNCH_HREF, getAverageGrade } from '../entApi'
import {
  DEMO_AVERAGE_GRADE,
  GRADES_FEATURE_DISABLED,
  GRADES_UNAVAILABLE_DETAIL,
  GRADES_UNAVAILABLE_MESSAGE,
  GRADES_UNAVAILABLE_TITLE,
} from '../gradeFeatureState'

function DisabledSidebarAveragePocket() {
  const averageDisplay = String(parseFloat(DEMO_AVERAGE_GRADE.average))
  const promoDisplay = String(parseFloat(DEMO_AVERAGE_GRADE.promoAverage))

  return (
    <SidebarStatPocket
      icon="carbon:summary-kpi"
      label="Moyenne"
      value={averageDisplay}
      max="20"
      caption={`Promo : ${promoDisplay}`}
      ariaLabel={`Moyenne indisponible: ${GRADES_UNAVAILABLE_MESSAGE}`}
      tooltipPrimary={GRADES_UNAVAILABLE_TITLE}
      tooltipSecondary={GRADES_UNAVAILABLE_DETAIL}
      disabled
    />
  )
}

function LiveSidebarAveragePocket() {
  const [data, setData] = useState(null)

  useEffect(() => {
    let mounted = true
    getAverageGrade()
      .then((result) => {
        if (mounted && result && !result.error) {
          setData(result)
        }
      })
      .catch(() => {})
    return () => { mounted = false }
  }, [])

  if (!data) return null

  const averageDisplay = data.average != null ? String(parseFloat(data.average)) : '—'
  const promoDisplay = data.promoAverage != null ? String(parseFloat(data.promoAverage)) : null

  return (
    <SidebarStatPocket
      icon="carbon:summary-kpi"
      label="Moyenne"
      value={averageDisplay}
      max="20"
      accentHue={330}
      onClick={() => navigateTo('grades')}
      caption={promoDisplay ? `Promo : ${promoDisplay}` : ''}
      ariaLabel={`Moyenne du semestre: ${averageDisplay} sur 20${promoDisplay ? ` (promo: ${promoDisplay})` : ''}`}
      tooltipPrimary="Moyenne du semestre"
      tooltipSecondary={promoDisplay ? `Promo: ${promoDisplay}/20` : ''}
    />
  )
}

function SidebarAveragePocket() {
  if (GRADES_FEATURE_DISABLED) {
    return <DisabledSidebarAveragePocket />
  }

  return <LiveSidebarAveragePocket />
}

export default SidebarAveragePocket
