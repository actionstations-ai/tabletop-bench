// Leaderboard generation from results/ and verification/ only. It aggregates scores that the
// Action Stations app already computed; it computes no scores.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const EMPTY_TEXT = 'First results coming.'
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

/** One row per model setting and task set: the best status, then the latest run. */
export function buildLeaderboard(results, verifications, now = new Date()) {
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
  return { formatVersion: 1, generatedAt: now.toISOString(), empty: rows.length === 0, rows }
}

const num = (n) => (n === null || n === undefined ? 'n/a' : String(n))

export function leaderboardMarkdown(board) {
  if (board.empty) return `${EMPTY_TEXT}\n`
  const out = []
  for (const set of [...new Set(board.rows.map((r) => r.taskSet))]) {
    out.push(`### ${md(set)}`, '')
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
  return out.join('\n')
}

/** results.jsonl for the Hugging Face dataset viewer: one flattened run per line. */
export function resultsJsonl(results, verifications) {
  return results
    .map(({ file, suiteDir, run }) =>
      JSON.stringify({
        file,
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
