// Leaderboard generation from results/ and verification/ only. It aggregates scores that the
// Action Stations app already computed; it computes no scores.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const EMPTY_TEXT = 'First results coming.'
export const isMini = (run) => run.kind === 'mini'
export const LEVEL_TEXT = { recommended: 'Recommended', usable: 'Usable with editing', not_recommended: 'Not recommended' }
const TASKS = ['drafting', 'critique', 'ideation']
const RANK = { verified: 2, community: 1, disputed: 0 }

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
export const md = (s) => String(s ?? '').replace(/[\\`*_{}[\]<>|#]/g, (c) => `\\${c}`).replace(/\s+/g, ' ')

/** [{ file, suiteDir, run }] for every run under results/<task set>/. */
export function loadResults(root) {
  const base = join(root, 'results')
  if (!existsSync(base)) return []
  return readdirSync(base)
    .sort()
    .filter((name) => statSync(join(base, name)).isDirectory())
    .flatMap((suiteDir) => {
      const dir = join(base, suiteDir)
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((file) => ({ file, suiteDir, run: readJson(join(dir, file)) }))
    })
}

export function loadVerifications(root) {
  const dir = join(root, 'verification')
  if (!existsSync(dir)) return {}
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f, readJson(join(dir, f))]),
  )
}

const rowKey = (r) =>
  [r.suiteDir, r.run.model.ref, r.run.model.quantization ?? '', r.run.model.inference?.profile].join('|')

function toRow({ file, suiteDir, run }, verification) {
  const status = verification?.status === 'verified' || verification?.status === 'disputed' ? verification.status : 'community'
  return {
    taskSet: suiteDir,
    taskSetHash: run.taskSetHash,
    model: run.model.name,
    ref: run.model.ref,
    tool: run.model.tool,
    quantization: run.model.quantization ?? null,
    sizeGb: run.model.sizeBytes ? Math.round(run.model.sizeBytes / 1e8) / 10 : null,
    profile: run.model.inference.profile,
    overall: run.median.overall,
    tasks: Object.fromEntries(TASKS.map((t) => [t, run.median.tasks[t] ?? null])),
    range: run.range.overall,
    unstable: Boolean(run.unstable),
    status,
    date: run.startedAt.slice(0, 10),
    hardware: `${run.hardware.platform} ${run.hardware.arch}, ${run.hardware.ramGb} GB`,
    appVersion: run.appVersion ?? null,
    file,
  }
}

const better = (a, b) =>
  RANK[a.status] - RANK[b.status] || a.date.localeCompare(b.date) || a.file.localeCompare(b.file)

const rangeFigure = (r) => (r ? { value: r.value, min: r.min, max: r.max } : null)

/** A Tabletop Mini Benchmark row: a screening result, always `community`. Every figure keeps its range. */
function toMiniRow({ file, suiteDir, run }) {
  const r = run.result
  return {
    taskSet: suiteDir,
    taskSetHash: run.taskSetHash,
    model: run.model.name,
    ref: run.model.ref,
    quantization: run.model.quantization ?? null,
    profile: run.model.inference.profile,
    band: run.verdict.level,
    reasons: run.verdict.reasons,
    uncertain: run.verdict.uncertain ?? [],
    score: rangeFigure(r.score),
    quality: rangeFigure(r.quality),
    completion: rangeFigure(r.completion),
    perCallRate: rangeFigure(r.perCallRate),
    repairRate: rangeFigure(r.repairRate),
    failedCalls: r.failedCalls,
    calls: r.calls,
    damage: rangeFigure(r.damage),
    draftMinutes: rangeFigure(r.draftMinutes),
    status: 'community',
    date: run.startedAt.slice(0, 10),
    hardware: `${run.hardware.platform} ${run.hardware.arch}, ${run.hardware.ramGb} GB`,
    appVersion: run.appVersion ?? null,
    file,
  }
}

/** Do two { min, max } ranges overlap? Models whose score ranges overlap are a tie. */
export const rangesOverlap = (a, b) => a.min <= b.max && b.min <= a.max

/**
 * Rank rows by score; a row whose score range overlaps the first row of the current group is
 * tied with it and shares its rank (`tied: true`).
 */
export function rankWithTies(rows) {
  const out = []
  let lead
  rows.forEach((row, i) => {
    if (lead && rangesOverlap(row.score, lead.score)) {
      out.push({ ...row, rank: lead.rank, tied: true })
      lead.tied = true
      return
    }
    const ranked = { ...row, rank: i + 1, tied: false }
    out.push(ranked)
    lead = ranked
  })
  return out
}

/** One Mini row per model setting: the latest run, ranked with ties. */
function buildMiniRows(results) {
  const latest = new Map()
  for (const r of results) {
    const row = toMiniRow(r)
    const key = rowKey(r)
    if (!latest.has(key) || row.date.localeCompare(latest.get(key).date) >= 0) latest.set(key, row)
  }
  const sorted = [...latest.values()].sort((a, b) => b.score.value - a.score.value || a.model.localeCompare(b.model))
  return rankWithTies(sorted)
}

/** One row per model setting and task set: the best status, then the latest run. */
export function buildLeaderboard(allResults, verifications, now = new Date()) {
  const results = allResults.filter((r) => !isMini(r.run))
  const mini = buildMiniRows(allResults.filter((r) => isMini(r.run)))
  const best = new Map()
  const counts = new Map()
  for (const r of results) {
    const row = toRow(r, verifications[r.file])
    const key = rowKey(r)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (!best.has(key) || better(row, best.get(key)) > 0) best.set(key, row)
  }
  const rows = [...best.entries()]
    .map(([key, row]) => ({ ...row, runs: counts.get(key) }))
    .sort((a, b) => a.taskSet.localeCompare(b.taskSet) || b.overall - a.overall || a.model.localeCompare(b.model))
  return {
    formatVersion: 1,
    generatedAt: now.toISOString(),
    empty: rows.length === 0 && mini.length === 0,
    rows,
    mini,
  }
}

const num = (n) => (n === null || n === undefined ? 'n/a' : String(n))

function fullMarkdown(board) {
  if (!board.rows.length) return [EMPTY_TEXT, '']
  const out = []
  for (const set of [...new Set(board.rows.map((r) => r.taskSet))]) {
    out.push(`#### ${md(set)}`, '')
    out.push('| Rank | Model | Quantization | Profile | Overall | Range | Drafting | Critique | Ideation | Status | Runs |')
    out.push('|---:|---|---|---|---:|---|---:|---:|---:|---|---:|')
    board.rows
      .filter((r) => r.taskSet === set)
      .forEach((r, i) =>
        out.push(
          `| ${i + 1} | ${md(r.model)} | ${md(r.quantization ?? 'n/a')} | ${md(r.profile)} | ${r.overall}${r.unstable ? ' (unstable)' : ''} | ${r.range[0]} to ${r.range[1]} | ${num(r.tasks.drafting)} | ${num(r.tasks.critique)} | ${num(r.tasks.ideation)} | ${r.status} | ${r.runs} |`,
        ),
    )
    out.push('')
  }
  return out
}

const fig = (f, unit = '') => (f ? (f.min === f.max ? `${f.value}${unit}` : `${f.value}${unit} (${f.min} to ${f.max})`) : 'n/a')

function miniMarkdown(board) {
  const rows = board.mini ?? []
  if (!rows.length) return [EMPTY_TEXT, '']
  const out = [
    '| Rank | Model | Quantization | Profile | Band | Score | Quality | Completion | Repair rate | Review damage | Draft time | Status |',
    '|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|',
  ]
  for (const r of rows)
    out.push(
      `| ${r.rank}${r.tied ? '=' : ''} | ${md(r.model)} | ${md(r.quantization ?? 'n/a')} | ${md(r.profile)} | ${LEVEL_TEXT[r.band]} | ${fig(r.score)} | ${fig(r.quality)} | ${fig(r.completion, '%')} (${r.failedCalls} failures in ${r.calls} calls) | ${fig(r.repairRate, '%')} | ${fig(r.damage, '%')} | ${fig(r.draftMinutes, ' min')} | ${r.status} |`,
    )
  out.push('', 'Rows marked = have overlapping score ranges over the two runs and are a tie.', '')
  return out
}

export function leaderboardMarkdown(board) {
  return [
    '### Tabletop Benchmark',
    '',
    ...fullMarkdown(board),
    '### Tabletop Mini Benchmark',
    '',
    'A screening: score = quality x completion, a band from stated requirements, never ranked with the full benchmark.',
    '',
    ...miniMarkdown(board),
  ].join('\n')
}

/** results.jsonl for the Hugging Face dataset viewer: one flattened run per line. */
export function resultsJsonl(results, verifications) {
  return results
    .map(({ file, suiteDir, run }) =>
      isMini(run)
        ? JSON.stringify({
            file,
            benchmark: 'mini',
            taskSet: suiteDir,
            status: 'community',
            model: run.model.name,
            ref: run.model.ref,
            quantization: run.model.quantization ?? null,
            profile: run.model.inference?.profile ?? null,
            band: run.verdict.level,
            score: run.result.score.value,
            scoreLow: run.result.score.min,
            scoreHigh: run.result.score.max,
            quality: run.result.quality?.value ?? null,
            completion: run.result.completion.value,
            perCallRate: run.result.perCallRate.value,
            repairRate: run.result.repairRate.value,
            failedCalls: run.result.failedCalls,
            calls: run.result.calls,
            reviewDamage: run.result.damage?.value ?? null,
            draftMinutes: run.result.draftMinutes?.value ?? null,
            taskSetHash: run.taskSetHash,
            scoringVersion: run.scoringVersion,
            appVersion: run.appVersion ?? null,
            ramGb: run.hardware.ramGb,
            startedAt: run.startedAt,
          })
        : JSON.stringify({
        file,
        benchmark: 'full',
        taskSet: suiteDir,
        status: verifications[file]?.status ?? 'community',
        model: run.model.name,
        ref: run.model.ref,
        tool: run.model.tool,
        quantization: run.model.quantization ?? null,
        profile: run.model.inference?.profile ?? null,
        overall: run.median.overall,
        ...Object.fromEntries(TASKS.map((t) => [t, run.median.tasks[t] ?? null])),
        draftingReliability: run.median.draftingReliability ?? null,
        rangeLow: run.range.overall[0],
        rangeHigh: run.range.overall[1],
        unstable: Boolean(run.unstable),
        taskSetHash: run.taskSetHash,
        scoringVersion: run.scoringVersion,
        appVersion: run.appVersion ?? null,
        appCommit: run.appCommit ?? null,
        ramGb: run.hardware.ramGb,
        platform: run.hardware.platform,
        arch: run.hardware.arch,
        startedAt: run.startedAt,
      }),
    )
    .join('\n')
}

export const BEGIN = '<!-- leaderboard:begin -->'
export const END = '<!-- leaderboard:end -->'

/** Replaces the text between the markers (they must exist). */
export function spliceBetween(text, body) {
  const a = text.indexOf(BEGIN)
  const b = text.indexOf(END)
  if (a < 0 || b < a) throw new Error('README markers not found')
  return `${text.slice(0, a + BEGIN.length)}\n\n${body.trim()}\n\n${text.slice(b)}`
}
