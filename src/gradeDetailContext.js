import { createContext, useContext } from 'react'

// Opens the grade detail sheet from any evaluation row of "Mes notes":
// `open({ moduleCode, evaluationId, isNew, from })`; `write({ moduleCode,
// evaluationId })` a mail about it, null without the in-app mail page.
// Null outside GradesPage, where rows stay plain.
export const GradeDetailContext = createContext(null)

export function useGradeDetail() {
  return useContext(GradeDetailContext)
}
