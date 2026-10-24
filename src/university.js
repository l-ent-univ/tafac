// What `import universityConfig from '@university'` gives (vite.config.js):
// the config of the university this page runs for, one of
// universities/<id>/client.js, or the neutral one before a university is
// picked (src/neutralUniversity.js).
//
// It's filled by bootUniversity() (src/universityBoot.js) before main.jsx
// imports App, so modules that read it when they load see the right values.
// It never changes afterwards: picking another university, or signing in to
// one, reloads the page.
const universityConfig = {}

export default universityConfig
