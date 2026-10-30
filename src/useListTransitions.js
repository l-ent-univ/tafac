import { useCallback, useState } from 'react'

// A list's rows as they come and go, for animating them: each entry is
// { key, item, state }, `state` being 'enter' (new since the last list),
// 'exit' (gone from it, kept where it was) or 'present'. `onSettled(key)`
// once a row's animation ends: a row come in is then present, a row gone
// is dropped. The first list that has rows comes in as it is, without
// enter animations, as does a new list altogether (`resetKey` changed: the
// mail page's folder), swapped in whole.

function mergeEntries(previous, items, getKey) {
  const previousByKey = new Map(previous.map((entry) => [entry.key, entry]))
  const keys = new Set(items.map(getKey))
  const animate = previous.length > 0

  const current = items.map((item) => {
    const key = getKey(item)
    const before = previousByKey.get(key)
    let state = animate ? 'enter' : 'present'
    if (before) state = before.state === 'exit' ? 'enter' : before.state
    return { key, item, state }
  })

  // A row gone stays after the row it followed (still there), or first.
  const exitingAfter = new Map()
  let anchor = null
  for (const entry of previous) {
    if (keys.has(entry.key)) {
      anchor = entry.key
      continue
    }
    const exiting = exitingAfter.get(anchor) ?? []
    exiting.push({ ...entry, state: 'exit' })
    exitingAfter.set(anchor, exiting)
  }

  return [
    ...(exitingAfter.get(null) ?? []),
    ...current.flatMap((entry) => [entry, ...(exitingAfter.get(entry.key) ?? [])]),
  ]
}

export function useListTransitions(items, getKey, resetKey = null) {
  const [previousItems, setPreviousItems] = useState(items)
  const [previousResetKey, setPreviousResetKey] = useState(resetKey)
  const [entries, setEntries] = useState(() => items.map((item) => ({ key: getKey(item), item, state: 'present' })))

  if (resetKey !== previousResetKey) {
    setPreviousResetKey(resetKey)
    setPreviousItems(items)
    setEntries(items.map((item) => ({ key: getKey(item), item, state: 'present' })))
  } else if (items !== previousItems) {
    setPreviousItems(items)
    setEntries(mergeEntries(entries, items, getKey))
  }

  const onSettled = useCallback((key) => {
    setEntries((current) => current
      .filter((entry) => !(entry.key === key && entry.state === 'exit'))
      .map((entry) => (entry.key === key && entry.state === 'enter' ? { ...entry, state: 'present' } : entry)))
  }, [])

  return { entries, onSettled }
}
