import { useEffect, useState } from 'react'
import { pickWallpaperTint } from './wallpaperInk'

// The wallpaper's main colour ("#rrggbb", wallpaperInk.js), read from a
// small copy of the image; null without an image, until it has loaded, or
// when its pixels can't be read (another origin without CORS).
export function useWallpaperTint(src) {
  const [tint, setTint] = useState({ src: null, color: null })
  useEffect(() => {
    if (!src) return undefined
    let cancelled = false
    const image = new Image()
    image.decoding = 'async'
    const read = () => {
      if (cancelled) return
      let color = null
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 48
        canvas.height = 48
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        color = pickWallpaperTint(context.getImageData(0, 0, canvas.width, canvas.height).data)
      } catch {
        color = null
      }
      setTint({ src, color })
    }
    image.addEventListener('load', read)
    image.src = src
    return () => {
      cancelled = true
      image.removeEventListener('load', read)
    }
  }, [src])
  return src && tint.src === src ? tint.color : null
}
