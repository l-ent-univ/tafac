// The page's context menu (src/components/ContextMenu.jsx) as the iOS app's
// menu plugin reads it (src/iosMenu.js, src-tauri/plugins/menu).

// A step of indentation (a folder in a folder): the system's menu has none.
const INDENT = '\u00a0\u00a0\u00a0\u00a0'

// Not a list the system couldn't draw: each label in its own font.
export function canBeNative(items) {
  return items.every((item) => item === 'separator' || !item.labelStyle)
}

// A label in two parts (« Semestre 5 · 2026/2027 ») is a line and a
// smaller one under it in the system's menu, which would otherwise break it
// where it likes.
const PARTS = ' · '

// A dropdown's choices and actions (src/components/Dropdown.jsx) as menu
// items: the choice in force ticked, the actions past a separator. An id
// says which one it is (`option:2`, `action:0`).
export function dropdownMenuItems(options, selectedIndex, actions = []) {
  return [
    ...options.map((option, index) => {
      const [label, ...rest] = String(option.label).split(PARTS)
      return { id: `option:${index}`, label, ...(rest.length > 0 ? { subtitle: rest.join(PARTS) } : null), checked: index === selectedIndex }
    }),
    ...(actions.length > 0 ? ['separator'] : []),
    ...actions.map((action, index) => ({ id: `action:${index}`, label: action.label, icon: action.icon })),
  ]
}

// `pictures`: one per item, in order ({ image, template } or null). A
// count at a line's end goes after its label, in brackets.
export function nativeMenuItems(items, pictures = []) {
  return items.map((item, index) => {
    if (item === 'separator') return { separator: true }
    const label = `${INDENT.repeat(item.depth || 0)}${item.label}${item.detail != null ? ` (${item.detail})` : ''}`
    return {
      id: String(item.id),
      label,
      ...(item.subtitle ? { subtitle: item.subtitle } : null),
      ...pictures[index],
      ...(item.destructive ? { destructive: true } : null),
      ...(item.disabled ? { disabled: true } : null),
      ...(item.checked ? { checked: true } : null),
    }
  })
}
