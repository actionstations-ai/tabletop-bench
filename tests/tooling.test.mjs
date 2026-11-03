// Tests of the Tabletop Bench tooling: task-set hashes, run validation, verification tolerance,
// leaderboard selection and escaping. They double as documentation of the rules.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BEGIN,
  buildLeaderboard,
  END,
  EMPTY_TEXT,
  leaderboardMarkdown,
  md,
  spliceBetween,
} from '../lib/leaderboard.mjs'
import { checkTaskSet, hashFiles, listTaskSets } from '../lib/taskset.mjs'
import { findForbidden, validateRun } from '../lib/validate.mjs'
import { compareRuns, incomparable } from '../lib/verify.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sets = listTaskSets(ROOT)
const standard = sets.find((s) => s.name === 'standard-v1')

function makeRun(over = {}) {
  return {
    formatVersion: 1,
    suite: 'standard',
    suiteVersion: 1,
    scoringVersion: 1,
    taskSetHash: standard.manifest.hash,
    appVersion: '0.6.2',
    appCommit: 'abc',
    startedAt: '2026-11-10T10:00:00.000Z',
    model: {
      ref: 'lmstudio:vendor/model-9b',
      tool: 'lmstudio',
      name: 'vendor/model-9b',
      quantization: '4bit',
      sizeBytes: 5_000_000_000,
      inference: { profile: 'model-9b', sampling: { temperature: 0.7 } },
    },
    hardware: { platform: 'darwin', arch: 'arm64', ramGb: 64 },
    repeats: [{ seed: 11 }],
    median: { overall: 60, tasks: { drafting: 65, critique: 50, ideation: 60 }, draftingReliability: 0.9 },
    range: { overall: [58, 62] },
    unstable: false,
    ...over,
  }
}

describe('task sets', () => {
  it('ship with both suites and every file matches its hash', () => {
    assert.deepEqual(sets.map((s) => s.name), ['quick-v1', 'standard-v1'])
    for (const s of sets) assert.deepEqual(checkTaskSet(s), { ok: true, problems: [] })
  })

  it('hash changes when one file changes', () => {
    const a = { 'a.json': '1', 'b.json': '2' }
    assert.notEqual(hashFiles(a), hashFiles({ ...a, 'b.json': '3' }))
    assert.equal(hashFiles(a), hashFiles({ 'b.json': '2', 'a.json': '1' }))
  })
})

describe('run validation', () => {
  it('accepts a complete run for a known task set', () => {
    assert.equal(validateRun(makeRun(), sets).ok, true)
  })

  it('refuses a run with no model profile', () => {
    const run = makeRun()
    delete run.model.inference
    assert.match(validateRun(run, sets).problems.join(), /inference/)
  })

  it('refuses a mock model and a hash we do not publish', () => {
    assert.equal(validateRun(makeRun({ model: { ...makeRun().model, tool: 'mock' } }), sets).ok, false)
    assert.match(validateRun(makeRun({ taskSetHash: 'f'.repeat(64) }), sets).problems.join(), /matches no task set/)
  })

  it('refuses absolute paths and host or user fields', () => {
    assert.deepEqual(findForbidden({ a: { note: '/Users/someone/x' } }), ['$.a.note'])
    assert.deepEqual(findForbidden({ hostname: 'm' }), ['$.hostname'])
    assert.equal(validateRun(makeRun({ extra: 'C:\\Users\\a' }), sets).ok, false)
  })
})

describe('verification', () => {
  it('verifies a rerun inside the tolerance, with different hardware', () => {
    const rerun = makeRun({ median: { overall: 63, tasks: { drafting: 68, critique: 55, ideation: 60 }, draftingReliability: 0.85 }, hardware: { platform: 'linux', arch: 'x64', ramGb: 32 } })
    assert.equal(compareRuns(makeRun(), rerun).status, 'verified')
  })

  it('disputes a rerun whose overall score is more than 5 points away', () => {
    const rerun = makeRun({ median: { overall: 50, tasks: { drafting: 65, critique: 50, ideation: 60 }, draftingReliability: 0.9 } })
    const r = compareRuns(makeRun(), rerun)
    assert.equal(r.status, 'disputed')
    assert.match(r.reasons[0], /overall differs by -10/)
  })

  it('widens the overall tolerance to the runs\' own range', () => {
    const wide = { overall: [50, 64] }
    const rerun = makeRun({ range: wide, median: { overall: 67, tasks: { drafting: 65, critique: 50, ideation: 60 }, draftingReliability: 0.9 } })
    assert.equal(compareRuns(makeRun({ range: wide }), rerun).status, 'verified')
  })

  it('disputes a task that differs by more than 10 points', () => {
    const rerun = makeRun({ median: { overall: 60, tasks: { drafting: 65, critique: 38, ideation: 60 }, draftingReliability: 0.9 } })
    assert.equal(compareRuns(makeRun(), rerun).status, 'disputed')
  })

  it('refuses to compare different settings, model digests or task sets', () => {
    const other = makeRun({ model: { ...makeRun().model, inference: { profile: 'model-9b', sampling: { temperature: 1 } } } })
    assert.deepEqual(incomparable(makeRun(), other), ['different profile or sampling settings'])
    assert.equal(compareRuns(makeRun(), makeRun({ taskSetHash: 'a'.repeat(64) })).status, 'not-comparable')
  })
})

describe('leaderboard', () => {
  const entry = (file, run) => ({ file, suiteDir: 'standard-v1', run })

  it('says first results are coming when there are no results', () => {
    const board = buildLeaderboard([], {})
    assert.equal(board.empty, true)
    assert.equal(leaderboardMarkdown(board).trim(), EMPTY_TEXT)
  })

  it('ranks by overall score and shows status as text', () => {
    const a = entry('a.json', makeRun())
    const b = entry('b.json', makeRun({ model: { ...makeRun().model, ref: 'lmstudio:x/y', name: 'x/y' }, median: { overall: 70, tasks: {} } }))
    const board = buildLeaderboard([a, b], {})
    assert.deepEqual(board.rows.map((r) => r.model), ['x/y', 'vendor/model-9b'])
    assert.match(leaderboardMarkdown(board), /\| community \|/)
  })

  it('prefers a verified run over a newer community run of the same model setting', () => {
    const old = entry('old.json', makeRun())
    const newer = entry('new.json', makeRun({ startedAt: '2026-12-01T00:00:00.000Z', median: { overall: 80, tasks: {} } }))
    const board = buildLeaderboard([old, newer], { 'old.json': { status: 'verified' } })
    assert.equal(board.rows.length, 1)
    assert.equal(board.rows[0].file, 'old.json')
    assert.equal(board.rows[0].status, 'verified')
    assert.equal(board.rows[0].runs, 2)
  })

  it('escapes Markdown in model names and keeps README markers', () => {
    assert.equal(md('a|b*c'), 'a\\|b\\*c')
    const text = `x\n${BEGIN}\nold\n${END}\ny`
    assert.equal(spliceBetween(text, 'new'), `x\n${BEGIN}\n\nnew\n\n${END}\ny`)
  })
})
