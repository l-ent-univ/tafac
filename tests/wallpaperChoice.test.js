import test from 'node:test'
import assert from 'node:assert/strict'
import {
  effectiveWallpaperChoice,
  isSameWallpaperChoice,
  normalizeWallpaperChoice,
  wallpaperChoiceAnalyticsValue,
} from '../src/wallpaperChoice.js'

const folders = {
  university: [{ src: '/hero/a.webp' }, { src: '/hero/b.webp' }],
  tafac: [{ src: '/tafac/lake.webp' }],
}
const folderImages = (folder) => folders[folder] ?? []
const DAILY_UNIVERSITY = { folder: 'university', image: null }
const noUniversityPhotos = (folder) => (folder === 'tafac' ? folders.tafac : [])

test('normalizeWallpaperChoice keeps known folders and drops the rest', () => {
  assert.deepEqual(normalizeWallpaperChoice({ folder: 'tafac', image: '/tafac/lake.webp' }), { folder: 'tafac', image: '/tafac/lake.webp' })
  assert.deepEqual(normalizeWallpaperChoice({ folder: 'university' }), { folder: 'university', image: null })
  assert.deepEqual(normalizeWallpaperChoice({ folder: 'custom', image: 'data:…' }), { folder: 'custom', image: null })
  assert.equal(normalizeWallpaperChoice({ folder: 'elsewhere' }), null)
  assert.equal(normalizeWallpaperChoice('tafac'), null)
  assert.equal(normalizeWallpaperChoice(null), null)
})

test('never picked: own image when stored, else the university of the day', () => {
  assert.deepEqual(effectiveWallpaperChoice(null, { hasCustom: true, folderImages }), { folder: 'custom', image: null })
  assert.deepEqual(effectiveWallpaperChoice(null, { hasCustom: false, folderImages }), DAILY_UNIVERSITY)
})

test('a folder picked shows even with an own image stored', () => {
  assert.deepEqual(effectiveWallpaperChoice({ folder: 'tafac', image: null }, { hasCustom: true, folderImages }), { folder: 'tafac', image: null })
  assert.deepEqual(
    effectiveWallpaperChoice({ folder: 'university', image: '/hero/b.webp' }, { hasCustom: true, folderImages }),
    { folder: 'university', image: '/hero/b.webp' },
  )
})

test('own image picked then removed falls back to the university of the day', () => {
  assert.deepEqual(effectiveWallpaperChoice({ folder: 'custom', image: null }, { hasCustom: false, folderImages }), DAILY_UNIVERSITY)
})

test('a picked photo gone from its folder falls back to that folder of the day', () => {
  assert.deepEqual(
    effectiveWallpaperChoice({ folder: 'tafac', image: '/tafac/old-hash.webp' }, { folderImages }),
    { folder: 'tafac', image: null },
  )
})

test('a university without photos: Tafac of the day, whatever was stored', () => {
  assert.deepEqual(effectiveWallpaperChoice(null, { folderImages: noUniversityPhotos }), { folder: 'tafac', image: null })
  assert.deepEqual(effectiveWallpaperChoice({ folder: 'university', image: null }, { folderImages: noUniversityPhotos }), { folder: 'tafac', image: null })
  assert.deepEqual(effectiveWallpaperChoice({ folder: 'custom', image: null }, { folderImages: noUniversityPhotos }), { folder: 'tafac', image: null })
  assert.deepEqual(
    effectiveWallpaperChoice({ folder: 'tafac', image: '/tafac/lake.webp' }, { folderImages: noUniversityPhotos }),
    { folder: 'tafac', image: '/tafac/lake.webp' },
  )
})

test('isSameWallpaperChoice and the analytics value', () => {
  assert.equal(isSameWallpaperChoice({ folder: 'tafac', image: null }, { folder: 'tafac' }), true)
  assert.equal(isSameWallpaperChoice({ folder: 'tafac', image: null }, { folder: 'tafac', image: '/x' }), false)
  assert.equal(wallpaperChoiceAnalyticsValue({ folder: 'tafac', image: '/x' }), 'tafac_photo')
  assert.equal(wallpaperChoiceAnalyticsValue({ folder: 'university', image: null }), 'university_daily')
  assert.equal(wallpaperChoiceAnalyticsValue({ folder: 'custom', image: null }), 'custom')
})
