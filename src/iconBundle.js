import { addCollection } from '@iconify/react'
import collections from './iconBundle.json'

// Every Iconify icon the app names, bundled (npm run icons writes
// iconBundle.json): registered before anything renders, so an icon shows
// with the first paint instead of popping in once the Iconify API answers.
// An icon missing from it still loads from the API, as before.
for (const collection of collections) addCollection(collection)
