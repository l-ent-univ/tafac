import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDemoMoodleCourseContentsPayload,
  buildDemoMoodleCoursesPayload,
  getDemoAssignmentDetails,
  removeDemoAssignmentFile,
  submitDemoAssignment,
} from '../src/demoAccount.js'
import { getRouteFromPath } from '../src/appRoute.js'

test('buildDemoMoodleCoursesPayload returns formatted enrolled courses', () => {
  const payload = buildDemoMoodleCoursesPayload()
  assert.ok(Array.isArray(payload.courses))
  assert.ok(payload.courses.length >= 5)

  const firstCourse = payload.courses[0]
  assert.ok(Number.isFinite(firstCourse.id))
  assert.ok(typeof firstCourse.fullname === 'string' && firstCourse.fullname.length > 0)
  assert.ok(typeof firstCourse.shortname === 'string' && firstCourse.shortname.length > 0)
  assert.ok(typeof firstCourse.category === 'string')
})

test('buildDemoMoodleCourseContentsPayload returns sections and modules with file items', () => {
  const payload = buildDemoMoodleCourseContentsPayload(101)
  assert.equal(payload.courseId, 101)
  assert.ok(Array.isArray(payload.sections))
  assert.ok(payload.sections.length > 0)

  const fileModule = payload.sections
    .flatMap((s) => s.modules)
    .find((m) => m.contents && m.contents.length > 0)

  assert.ok(fileModule)
  const file = fileModule.contents[0]
  assert.ok(file.filename.endsWith('.pdf') || file.filename.endsWith('.zip'))
  assert.ok(Number.isFinite(file.filesize) && file.filesize > 0)
  assert.ok(file.fileurl)
})

test('routing recognizes moodle and its alias', () => {
  assert.equal(getRouteFromPath('/moodle'), 'moodle')
  assert.equal(getRouteFromPath('/cours'), 'moodle')
})

test('buildDemoMoodleCourseContentsPayload returns folder modules with multiple files', () => {
  const payload = buildDemoMoodleCourseContentsPayload(101)
  const folderModule = payload.sections
    .flatMap((s) => s.modules)
    .find((m) => m.modname === 'folder')

  assert.ok(folderModule, 'Folder module should exist in demo course 101')
  assert.ok(Array.isArray(folderModule.contents))
  assert.ok(folderModule.contents.length >= 2, 'Folder module should contain multiple files')
  for (const file of folderModule.contents) {
    assert.ok(file.filename)
    assert.ok(Number.isFinite(file.filesize))
    assert.ok(file.fileurl)
  }
})

test('getDemoAssignmentDetails returns initial assignment state', () => {
  const assignment = getDemoAssignmentDetails(2008, 101)
  assert.ok(assignment)
  assert.equal(assignment.cmid, 2008)
  assert.equal(assignment.status, 'not_submitted')
  assert.ok(assignment.canSubmit)
  assert.ok(Array.isArray(assignment.acceptedTypes))
  assert.ok(assignment.acceptedTypes.includes('.md'))
})

test('submitDemoAssignment uploads files and updates status to submitted', () => {
  const result = submitDemoAssignment({
    cmid: 2008,
    files: [
      {
        name: 'rendu.md',
        size: 8192,
        type: 'text/markdown',
        base64: 'IyBUUCBOwrAx',
      },
    ],
    onlineText: 'Voici mon rendu pour le TP 1.',
  })

  assert.ok(result)
  assert.equal(result.status, 'submitted')
  assert.equal(result.statusLabel, 'Remis pour évaluation')
  assert.ok(result.submittedFiles.some((f) => f.filename === 'rendu.md'))

  // Verify deletion
  const afterRemove = removeDemoAssignmentFile({ cmid: 2008, filename: 'rendu.md' })
  assert.ok(!afterRemove.submittedFiles.some((f) => f.filename === 'rendu.md'))
  assert.equal(afterRemove.status, 'not_submitted')
})
