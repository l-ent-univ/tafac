import { deliverFile } from './mailPrint'

// The student card (src/components/StudentCards/) as a PNG, from its <svg>
// as shown. Its <image>s (photo, logo) are inlined first: an SVG drawn
// through an <img> loads nothing from outside.

const SCALE = 2

async function toDataUrl(src) {
  if (!src || src.startsWith('data:')) return src
  const response = await fetch(src)
  if (!response.ok) throw new Error(`Image not loaded (${response.status}).`)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function svgToPngBlob(svg) {
  const clone = svg.cloneNode(true)
  await Promise.all([...clone.querySelectorAll('image')].map(async (image) => {
    const src = image.getAttribute('href')
    try {
      image.setAttribute('href', await toDataUrl(src))
    } catch {
      // An image that can't be read (CORS, offline): the card goes without it.
      image.remove()
    }
  }))

  const { width, height } = svg.viewBox.baseVal
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const markup = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width * SCALE
    canvas.height = height * SCALE
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG not made.'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

// What deliverFile did: 'shared', 'cancelled' or 'downloaded'.
export async function saveStudentCard(svg, name = 'Carte_etudiante.png') {
  const blob = await svgToPngBlob(svg)
  return deliverFile(blob, name)
}
