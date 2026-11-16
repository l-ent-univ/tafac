import { getIcon, iconLoaded, loadIcons } from '@iconify/react'

// The page's own icons as pictures, for what the iOS app draws itself (its
// tab bar, its menus): PNG in base64, three pixels to the point.
const SCALE = 3

function png(side, paint, doc) {
  const canvas = Object.assign(doc.createElement('canvas'), { width: side, height: side })
  paint(canvas.getContext('2d'), side)
  return canvas.toDataURL('image/png').split(',')[1] || null
}

// An Iconify icon, `points` a side, as a black picture on nothing: what
// shows it colours it itself. null: no such icon here.
export async function drawIcon(name, points, doc = document) {
  const icon = getIcon(name)
  if (!icon) return null
  const { body, left = 0, top = 0, width = 16, height = 16 } = icon
  const side = points * SCALE
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${side}" height="${side}" style="color:#000">${body}</svg>`
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  return png(side, (context) => context.drawImage(image, 0, 0, side, side), doc)
}

// name@points → its picture, drawn once (null: couldn't be).
const pictures = new Map()

// The same, fetching the icon first when it isn't here yet.
export function iconPicture(name, points, doc = document) {
  const key = `${name}@${points}`
  if (!pictures.has(key)) {
    const loaded = iconLoaded(name) ? Promise.resolve() : new Promise((resolve) => loadIcons([name], () => resolve()))
    pictures.set(key, loaded.then(() => drawIcon(name, points, doc)).catch(() => null))
  }
  return pictures.get(key)
}

// A dot of a CSS colour, as the page's menu draws a colour to pick; an
// empty string is « none »: a ring, struck through.
export function dotPicture(color, points, doc = document) {
  try {
    return png(points * SCALE, (context, side) => {
      const middle = side / 2
      context.beginPath()
      context.arc(middle, middle, middle - 1.5, 0, Math.PI * 2)
      if (color) {
        context.fillStyle = color
        context.fill()
        return
      }
      context.lineWidth = 3
      context.strokeStyle = '#8e8e93'
      context.moveTo(side * 0.2, side * 0.8)
      context.lineTo(side * 0.8, side * 0.2)
      context.stroke()
    }, doc)
  } catch {
    return null
  }
}
