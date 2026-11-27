// The planning's resources as the page uses them, from tonAPI's tree
// (/__ent_auth/timetable/tree: tonAPI's ResourceNode, `selected` on the
// groups the student follows). Tafac's own reading of it, which the server
// no longer does:
//
//   adeTreeRoot / focusAdeTree   the groups' tree as the group picker reads
//                                it (App.jsx): the student's path in it, the
//                                default year, TD and TP read from that
//                                path, and the tree focused on one node
//   buildDirectory               « Salles et personnels » (planningDirectory.js):
//                                every room, teacher and group, under its
//                                folders
//
// Pure, see tests/planningTree.test.js.

function normalizeLabel(value, fallback = '') {
  const label = String(value ?? '').replace(/\s+/g, ' ').trim()
  return label || fallback
}

// The containers the picker never offers: the root, and each category.
const ROOT_ID = '-100'
const STUDENTS_ID = '-1'
const CONTAINER_IDS = new Set([ROOT_ID, STUDENTS_ID, '-2', '-3'])

function toPickerNode(node, parentPath) {
  const name = normalizeLabel(node?.name)
  const path = `${parentPath}.${name}`
  return {
    id: String(node?.id ?? ''),
    name,
    path,
    children: (Array.isArray(node?.children) ? node.children : []).map((child) => toPickerNode(child, path)),
  }
}

// tonAPI's groups (its tree of `kind: group`) as the picker reads a tree:
// a root, « Etudiants » under it, and each node with its children and its
// path (the names from the root, joined by « . »).
export function adeTreeRoot(groups) {
  const students = {
    id: STUDENTS_ID,
    name: 'Etudiants',
    path: 'Ressources.Etudiants',
    children: [],
  }
  students.children = (Array.isArray(groups) ? groups : []).map((node) => toPickerNode(node, students.path))
  return { id: ROOT_ID, name: 'Ressources', path: 'Ressources', children: [students] }
}

// The groups the student follows (tonAPI's `selected`), in the tree's order,
// as { id, name }.
export function followedGroups(groups) {
  const followed = []
  const walk = (nodes) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node?.selected === true) followed.push({ id: String(node.id), name: normalizeLabel(node.name, `Ressource ${node.id}`) })
      walk(node?.children)
    }
  }
  walk(groups)
  return followed
}

export function findTreePath(root, targetId, path = []) {
  if (!root) return null
  const nextPath = [...path, root]
  if (String(root.id) === String(targetId)) return nextPath
  for (const child of root.children ?? []) {
    const match = findTreePath(child, targetId, nextPath)
    if (match) return match
  }
  return null
}

function cloneNode(node, children = []) {
  return { ...node, children }
}

function meaningfulPath(pathNodes = []) {
  return pathNodes.filter((node) => !CONTAINER_IDS.has(String(node?.id ?? '')))
}

// A year of a course: « Licence 2 », « BUT 3 », « L1 », « MMI A2 », « 2e année ».
function looksLikeLevel(node) {
  const label = normalizeLabel(node?.name)
  return [
    /\b(?:licence|master|but|bachelor)\s*[1-9]\b/i,
    /\b(?:L|M)\s*[1-3]\b/,
    /\b[A-Z]{2,}\s+A[1-5]\b/i,
    /\b(?:1re|[1-5](?:e|ème))\s+ann[eé]e\b/i,
  ].some((pattern) => pattern.test(label))
}

// A folder of TD or TP groups (« Groupes TD »), not a group itself.
function isGroupContainer(node) {
  return /^(?:groupes?|classes?)\s+(?:td|tp)\b/i.test(normalizeLabel(node?.name))
}

function looksLikeTd(node) {
  const label = normalizeLabel(node?.name)
  if (!label || isGroupContainer(node)) return false
  return /\bTD\s*[-_. ]?[A-Z0-9]+\b/i.test(label)
    || /^\d+[A-Z]\b/i.test(label)
    || /^groupe\s+[A-Z0-9]+\b/i.test(label)
}

// The picker's steps along a group's path: its establishment, its course,
// its year, its TD and the group itself, each once.
export function selectionPath(pathNodes = []) {
  const meaningful = meaningfulPath(pathNodes)
  if (meaningful.length === 0) return meaningful

  const detectedLevelIndex = meaningful.findIndex(looksLikeLevel)
  const levelIndex = detectedLevelIndex >= 0 ? detectedLevelIndex : Math.min(2, meaningful.length - 1)
  const programIndex = Math.max(0, levelIndex - 1)
  const contextIndex = Math.max(0, programIndex - 1)
  const candidateTdNodes = meaningful.slice(levelIndex + 1, -1)
  const tdNode = candidateTdNodes.find(looksLikeTd)
    ?? candidateTdNodes.find((node) => !isGroupContainer(node))
    ?? null
  const selected = [
    meaningful[contextIndex],
    meaningful[programIndex],
    meaningful[levelIndex],
    tdNode,
    meaningful.at(-1),
  ]
  return selected.filter((node, index, nodes) => (
    node && nodes.findIndex((candidate) => candidate && String(candidate.id) === String(node.id)) === index
  ))
}

function leafDescendants(node, leaves = []) {
  const children = node?.children ?? []
  if (children.length === 0) {
    leaves.push(node)
    return leaves
  }
  for (const child of children) leafDescendants(child, leaves)
  return leaves
}

// A year's choices: its groups, those of a « Groupes TD » folder in place
// of the folder.
function levelOptions(node) {
  return (node?.children ?? []).flatMap((child) => (isGroupContainer(child) ? child.children ?? [] : [child]))
}

// The path down to a node, each step with only the next one under it, but
// the expanded node with all its children (or `expandedChildren`).
function focusedTree(pathNodes, expandedNodeId, expandedChildren = null) {
  if (pathNodes.length === 0) return null
  let focusedChild = null
  for (let index = pathNodes.length - 1; index >= 0; index -= 1) {
    const node = pathNodes[index]
    let children = focusedChild ? [focusedChild] : []
    if (String(node.id) === String(expandedNodeId)) {
      const sourceChildren = expandedChildren ?? node.children ?? []
      children = sourceChildren.map((child) => (
        focusedChild && String(child.id) === String(focusedChild.id) ? focusedChild : cloneNode(child)
      ))
      if (focusedChild && !children.some((child) => String(child.id) === String(focusedChild.id))) {
        children.unshift(focusedChild)
      }
    }
    focusedChild = cloneNode(node, children)
  }
  return focusedChild
}

// The student's default group as the picker stores a selection: the group
// itself, and the course, year and TD read from its path.
function defaultSelectionOf(resource, pathNodes = []) {
  if (!resource) return null
  const path = selectionPath(pathNodes)
  const establishmentNode = path[0] ?? null
  const programNode = path[1] ?? establishmentNode
  const yearNode = path[2] ?? null
  const tdNode = path[3] ?? null
  const finalNode = path.at(-1) ?? null
  const tpNode = finalNode && String(finalNode.id) !== String(tdNode?.id) ? finalNode : null
  const parentNode = tpNode ? tdNode : yearNode
  const contextLabel = [establishmentNode, programNode]
    .map((node) => normalizeLabel(node?.name))
    .filter(Boolean)
    .join(' / ')
  const id = (node) => (node?.id == null ? null : String(node.id))
  return {
    resourceId: resource.id,
    label: resource.name,
    parentResourceId: id(parentNode),
    parentLabel: normalizeLabel(parentNode?.name) || null,
    contextLabel: contextLabel || resource.name,
    programResourceId: id(programNode),
    programLabel: normalizeLabel(programNode?.name) || resource.name,
    yearResourceId: id(yearNode),
    yearLabel: normalizeLabel(yearNode?.name) || null,
    tdResourceId: id(tdNode),
    tdLabel: normalizeLabel(tdNode?.name) || null,
    tpResourceId: id(tpNode),
    tpLabel: normalizeLabel(tpNode?.name) || null,
  }
}

// The tree as the group picker asks it (App.jsx), from the whole tree
// (adeTreeRoot) and the groups the student follows (followedGroups):
//
//   requestedResourceId   a node to focus on, a step of the picker (its
//                         children offered); none: the student's own group
//   fallbackResourceId    a group standing in for the student's own when
//                         they follow none (the one ScoDoc names)
//
// → { root (the focused tree), currentResourceId, focusResourceId,
// currentPathIds, selectionPathIds, defaultSelection, resources }.
export function focusAdeTree(fullRoot, { requestedResourceId = '', fallbackResourceId = '', ownResources = [] } = {}) {
  const fallbackId = String(fallbackResourceId ?? '').trim()
  const fallbackNode = ownResources.length === 0 && fallbackId ? findTreePath(fullRoot, fallbackId)?.at(-1) ?? null : null
  const resources = fallbackNode ? [{ id: String(fallbackNode.id), name: fallbackNode.name }] : ownResources
  const requestedId = String(requestedResourceId ?? '').trim()
  const requestedPath = requestedId ? findTreePath(fullRoot, requestedId) ?? [] : []
  const accountResource = resources.find(({ id }) => id === requestedId) ?? resources[0] ?? null
  const accountPath = accountResource ? findTreePath(fullRoot, accountResource.id) ?? [] : []
  const currentPath = requestedPath.length > 0 ? requestedPath : accountPath
  const currentResource = currentPath.at(-1) ?? accountResource
  const initialSelectionPath = selectionPath(accountPath)
  const requestedSelectionPath = requestedId ? selectionPath(currentPath) : []
  const expandedNode = requestedId
    ? currentResource
    : initialSelectionPath[1] ?? initialSelectionPath[0] ?? currentResource
  const requestedLevelNode = requestedSelectionPath[2] ?? null
  const requestedTdNode = requestedSelectionPath[3] ?? null
  const requestedIsLevel = requestedId && String(currentResource?.id) === String(requestedLevelNode?.id)
  const requestedIsTd = requestedId
    && String(currentResource?.id) === String(requestedTdNode?.id)
    && String(requestedTdNode?.id) !== String(requestedLevelNode?.id)
  const expandedChildren = requestedIsTd
    ? leafDescendants(expandedNode).map((node) => cloneNode(node))
    : requestedIsLevel
      ? levelOptions(expandedNode).map((node) => cloneNode(node))
      : null
  const root = focusedTree(currentPath, expandedNode?.id ?? currentResource?.id ?? fullRoot?.id, expandedChildren)
    ?? cloneNode(fullRoot ?? { id: ROOT_ID, name: 'Ressources', path: 'Ressources' }, fullRoot?.children ?? [])

  return {
    root,
    currentResourceId: currentResource?.id ?? null,
    focusResourceId: currentResource?.id || fullRoot?.id || ROOT_ID,
    currentPathIds: currentPath.map(({ id }) => String(id)),
    selectionPathIds: (requestedId ? requestedSelectionPath : initialSelectionPath).map(({ id }) => String(id)),
    defaultSelection: requestedId ? null : defaultSelectionOf(accountResource, accountPath),
    resources,
  }
}

// « Salles et personnels »: each room, teacher and group of tonAPI's trees,
// with the folders above it. The folders are listed once (`groups`: kind
// and names, from the tree's top) and each entry is [id, name, group
// index]: ~16,000 of them at Rennes. A name stays as ADE gives it
// (« B09B - Amphi TA (009) [142P] », « DUPONT Christophe »).
const DIRECTORY_KINDS = { room: 'room', teacher: 'person', group: 'group' }

// Folders left out with all they hold: placeholders, not places.
const HIDDEN_FOLDERS = new Set(['Appariteurs - Salles fictives'].map((name) => normalizeLabel(name).toLocaleLowerCase('fr')))

export function buildDirectory(trees) {
  const groups = []
  const groupIndex = new Map()
  const items = []
  const seen = new Set()

  const groupFor = (kind, names) => {
    const key = `${kind}::${names.join('\u0000')}`
    if (!groupIndex.has(key)) {
      groupIndex.set(key, groups.length)
      groups.push({ kind, path: names })
    }
    return groupIndex.get(key)
  }

  const walk = (node, kind, names) => {
    const children = node?.children ?? []
    const name = normalizeLabel(node?.name)
    if (node?.folder !== true && children.length === 0) {
      const id = String(node?.id ?? '').trim()
      if (!id || !name || seen.has(id)) return
      seen.add(id)
      items.push([id, name, groupFor(kind, names)])
      return
    }
    if (HIDDEN_FOLDERS.has(name.toLocaleLowerCase('fr'))) return
    const nextNames = name ? [...names, name] : names
    for (const child of children) walk(child, kind, nextNames)
  }

  for (const node of Array.isArray(trees) ? trees : []) {
    const kind = DIRECTORY_KINDS[node?.kind]
    if (kind) walk(node, kind, [])
  }
  return { groups, items }
}
