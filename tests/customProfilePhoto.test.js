import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUSTOM_PROFILE_PHOTO_KEY,
  clearStoredCustomProfilePhoto,
  computeSquareCrop,
  getStoredCustomProfilePhoto,
} from '../src/customProfilePhoto.js'

function createStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

const PHOTO = 'data:image/webp;base64,AAAA'

test('the photo is read back for its own user only', () => {
  const storage = createStorage({ [CUSTOM_PROFILE_PHOTO_KEY]: JSON.stringify({ user: 'jdupont', value: PHOTO }) })
  assert.equal(getStoredCustomProfilePhoto('jdupont', storage), PHOTO)
  assert.equal(getStoredCustomProfilePhoto('mmartin', storage), null)
})

test('anything that is not an image data URL is ignored', () => {
  for (const value of ['https://evil.example/a.png', 'javascript:alert(1)', 42, null]) {
    const storage = createStorage({ [CUSTOM_PROFILE_PHOTO_KEY]: JSON.stringify({ user: 'jdupont', value }) })
    assert.equal(getStoredCustomProfilePhoto('jdupont', storage), null)
  }
  assert.equal(getStoredCustomProfilePhoto('jdupont', createStorage({ [CUSTOM_PROFILE_PHOTO_KEY]: '{broken' })), null)
})

test('clearing removes the photo', () => {
  const storage = createStorage({ [CUSTOM_PROFILE_PHOTO_KEY]: JSON.stringify({ user: 'jdupont', value: PHOTO }) })
  clearStoredCustomProfilePhoto(storage)
  assert.equal(getStoredCustomProfilePhoto('jdupont', storage), null)
})

test('the crop is a square centred across, a bit high down a portrait', () => {
  assert.deepEqual(computeSquareCrop(400, 400), { sx: 0, sy: 0, size: 400 })
  assert.deepEqual(computeSquareCrop(1600, 900), { sx: 350, sy: 0, size: 900 })
  assert.deepEqual(computeSquareCrop(900, 1600), { sx: 0, sy: 210, size: 900 })
})
