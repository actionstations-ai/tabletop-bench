// Tests of the Tabletop Benchmark tooling: task-set hashes, run validation, verification tolerance,
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
  it('ship with the quick, standard and mini suites and every file matches its hash', () => {
    assert.deepEqual(sets.map((s) => s.name), ['mini-v2', 'quick-v1', 'standard-v1'])
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
    const text = leaderboardMarkdown(board)
    assert.equal(text.split(EMPTY_TEXT).length - 1, 2)
    assert.match(text, /### Tabletop Mini Benchmark/)
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

describe('Tabletop Mini Benchmark', () => {
  const mini = sets.find((s) => s.name === 'mini-v2')
  const range = (value, min = value, max = value) => ({ value, min, max })
  const probe = () => ({ ok: true, firstTry: true, score: 80, criteria: [], metrics: {} })
  const repeat = (seed) => ({
    seed,
    probes: { format: probe(), longContext: probe(), longOutput: probe(), review: probe() },
  })
  const makeMini = (over = {}) => ({
    formatVersion: 1,
    kind: 'mini',
    suite: 'mini',
    suiteVersion: 2,
    scoringVersion: 1,
    taskSetHash: mini.manifest.hash,
    appVersion: '0.6.2',
    appCommit: 'abc',
    startedAt: '2026-11-10T10:00:00.000Z',
    model: {
      ref: 'lmstudio:vendor/model-9b',
      tool: 'lmstudio',
      name: 'vendor/model-9b',
      quantization: '4bit',
      inference: { profile: 'model-9b' },
    },
    hardware: { platform: 'darwin', arch: 'arm64', ramGb: 64 },
    stream: { firstTokenSeconds: 600, stallSeconds: 60, loopMinChars: 400, loopMinRepeats: 5 },
    repeats: [repeat(11), repeat(12)],
    result: {
      score: range(78, 74, 82),
      quality: range(80, 78, 82),
      perCallRate: range(100),
      completion: range(100),
      damage: range(2, 0, 4),
      draftMinutes: range(30, 28, 32),
      calls: 8,
      firstTryCalls: 8,
    },
    verdict: { level: 'usable', reasons: ['Quality 80'], notes: [] },
    ...over,
  })
  const entry = (file, run) => ({ file, suiteDir: 'mini-v2', run })

  it('accepts a complete Mini run and refuses a bad verdict, a mock model and paths', () => {
    assert.equal(validateRun(makeMini(), sets).ok, true)
    assert.match(validateRun(makeMini({ verdict: { level: 'great' } }), sets).problems.join(), /verdict/)
    assert.equal(validateRun(makeMini({ model: { ...makeMini().model, tool: 'mock' } }), sets).ok, false)
    assert.equal(validateRun(makeMini({ note: '/Users/someone/run' }), sets).ok, false)
  })

  it('refuses a Mini run with one repeat or a score without a range', () => {
    assert.match(validateRun(makeMini({ repeats: [repeat(11)] }), sets).problems.join(), /twice/)
    const bad = makeMini()
    bad.result.score = { value: 78 }
    assert.match(validateRun(bad, sets).problems.join(), /result\.score/)
  })

  it('keeps the Mini task set apart from the others', () => {
    assert.equal(validateRun(makeMini({ taskSetHash: standard.manifest.hash }), sets).ok, false)
  })

  it('lists Mini results in their own table with the verdict as text, never with the full ranking', () => {
    const board = buildLeaderboard([entry('m.json', makeMini()), { file: 'a.json', suiteDir: 'standard-v1', run: makeRun() }], {})
    assert.equal(board.rows.length, 1)
    assert.equal(board.mini.length, 1)
    const text = leaderboardMarkdown(board)
    assert.match(text, /### Tabletop Mini Benchmark/)
    assert.match(text, /\| Usable with editing \| 78 \(74 to 82\) \|/)
    assert.match(text, /\| community \|/)
  })

  it('says first results are coming for each benchmark with no results', () => {
    const board = buildLeaderboard([entry('m.json', makeMini())], {})
    assert.equal(board.empty, false)
    assert.match(leaderboardMarkdown(board), /### Tabletop Benchmark\n\nFirst results coming\./)
    assert.match(leaderboardMarkdown(buildLeaderboard([], {})), /First results coming\./)
  })

  it('shows the latest run of a model setting', () => {
    const newer = makeMini({
      startedAt: '2026-12-01T00:00:00.000Z',
      verdict: { level: 'not_recommended', reasons: ['x'], notes: [] },
    })
    const board = buildLeaderboard([entry('old.json', makeMini()), entry('new.json', newer)], {})
    assert.deepEqual(board.mini.map((r) => [r.file, r.band]), [['new.json', 'not_recommended']])
  })

  it('ranks Mini rows by score and shows overlapping score ranges as a tie', () => {
    const named = (name, score) => {
      const run = makeMini()
      run.model = { ...run.model, ref: `lmstudio:${name}`, name }
      run.result.score = score
      return entry(`${name}.json`, run)
    }
    const board = buildLeaderboard(
      [named('a', range(90, 86, 94)), named('b', range(85, 80, 89)), named('c', range(60, 58, 62))],
      {},
    )
    assert.deepEqual(board.mini.map((r) => [r.model, r.rank, r.tied]), [['a', 1, true], ['b', 1, true], ['c', 3, false]])
    assert.match(leaderboardMarkdown(board), /\| 1= \| a \|/)
    assert.match(leaderboardMarkdown(board), /\| 3 \| c \|/)
  })
})
