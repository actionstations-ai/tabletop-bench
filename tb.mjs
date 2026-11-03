#!/usr/bin/env node
// Tabletop Benchmark command line. Node 20+, no dependencies. See docs/SUBMITTING.md.
//
//   node tb.mjs check                       verify every task set against its hash
//   node tb.mjs run --app <checkout> --suite standard|quick|mini --models lmstudio:<id>[,…] [--add]
//   node tb.mjs add <run.json>              validate a run file, copy it to results/, rebuild
//   node tb.mjs verify <results file> <rerun.json>   compare a maintainer rerun, record the outcome
//   node tb.mjs build                       regenerate the leaderboard, README table and dist/hf
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildLeaderboard,
  leaderboardMarkdown,
  loadResults,
  loadVerifications,
  resultsJsonl,
  spliceBetween,
} from './lib/leaderboard.mjs'
import { checkTaskSet, findTaskSetByHash, listTaskSets } from './lib/taskset.mjs'
import { isSafeFileName, validateRun } from './lib/validate.mjs'
import { compareRuns } from './lib/verify.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))
const writeJson = (f, v) => {
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`)
}
const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

function check() {
  const sets = listTaskSets(ROOT)
  if (!sets.length) fail('no task sets in tasks/')
  let bad = 0
  for (const s of sets) {
    const { ok, problems } = checkTaskSet(s)
    console.log(`${ok ? 'ok     ' : 'CHANGED'} ${s.name} ${s.manifest.hash.slice(0, 12)}`)
    for (const p of problems) console.log(`         ${p}`)
    if (!ok) bad++
  }
  if (bad) process.exit(1)
}

function appHash(app, suite) {
  const r = spawnSync('node', ['scripts/bench/taskset.mjs', '--suite', suite], { cwd: app, encoding: 'utf8' })
  const hash = /([0-9a-f]{64})\s*$/m.exec(r.stdout ?? '')?.[1]
  if (r.status !== 0 || !hash) fail(`The app checkout cannot export its task set (needs a version with pnpm bench:export):\n${r.stderr}`)
  return hash
}

function run(args) {
  const get = (name) => args[args.indexOf(name) + 1]
  const app = resolve(get('--app') ?? process.env.ACTIONSTATIONS_APP ?? '')
  const suite = get('--suite') ?? 'standard'
  if (!existsSync(join(app, 'scripts', 'bench', 'run.mjs')))
    fail('Pass --app <Action Stations checkout> or set ACTIONSTATIONS_APP. It must be built (pnpm build:app).')
  const ours = listTaskSets(ROOT).filter((s) => s.manifest.suite === suite)
  const theirs = appHash(app, suite)
  if (!ours.some((s) => s.manifest.hash === theirs))
    fail(
      `Task set mismatch for "${suite}".\n  this repository: ${ours.map((s) => s.manifest.hash).join(', ') || 'none'}\n  app checkout:    ${theirs}\nUse the app commit named in docs/METHODS.md for this task set.`,
    )
  const out = mkdtempSync(join(tmpdir(), 'tabletop-bench-'))
  const passthrough = args.filter((a) => a !== '--add' && a !== '--app' && a !== get('--app'))
  const script = suite === 'mini' ? 'bench:mini' : 'bench'
  const r = spawnSync('pnpm', [script, '--', '--out', out, ...passthrough], { cwd: app, stdio: 'inherit' })
  if (r.status !== 0) fail('The app benchmark failed; nothing was added.')
  const files = readdirSync(out).filter((f) => f.endsWith('.json') && f !== 'state.json')
  for (const f of files) {
    const target = join(ROOT, 'incoming', f)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(out, f), target)
    console.log(`run file: incoming/${f}`)
    if (args.includes('--add')) add(target)
  }
  rmSync(out, { recursive: true, force: true })
  if (!args.includes('--add')) console.log('Next: node tb.mjs add incoming/<file>.json')
}

function add(file) {
  const src = resolve(file ?? '')
  if (!file || !existsSync(src)) fail('Usage: node tb.mjs add <run.json>')
  let runFile
  try {
    runFile = readJson(src)
  } catch {
    fail('Not valid JSON.')
  }
  const sets = listTaskSets(ROOT)
  const { ok, problems, taskSet } = validateRun(runFile, sets)
  if (!ok) fail(`Refused:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  const name = basename(src)
  if (!isSafeFileName(name)) fail(`File name "${name}" must be lower-case letters, digits, dot, dash or underscore.`)
  const dest = join(ROOT, 'results', taskSet.name, name)
  if (existsSync(dest)) fail(`results/${taskSet.name}/${name} exists; run files are never replaced.`)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest)
  console.log(`added results/${taskSet.name}/${name} (community)`)
  build()
}

function verify(resultName, rerunPath) {
  if (!resultName || !rerunPath) fail('Usage: node tb.mjs verify <results/<set>/<file>.json> <rerun.json>')
  const submittedPath = resolve(resultName)
  const submitted = readJson(submittedPath)
  const rerun = readJson(resolve(rerunPath))
  if (submitted.kind === 'mini' || rerun.kind === 'mini')
    fail('Mini results are screenings and are not verified. Run the full benchmark to verify a model.')
  const sets = listTaskSets(ROOT)
  for (const [label, r] of [['submitted', submitted], ['rerun', rerun]]) {
    const v = validateRun(r, sets)
    if (!v.ok) fail(`${label} run is not valid:\n${v.problems.join('\n')}`)
  }
  const result = compareRuns(submitted, rerun)
  const name = basename(submittedPath)
  const rerunName = basename(rerunPath)
  if (result.status !== 'not-comparable') {
    mkdirSync(join(ROOT, 'verification', 'reruns'), { recursive: true })
    cpSync(resolve(rerunPath), join(ROOT, 'verification', 'reruns', rerunName))
    writeJson(join(ROOT, 'verification', name), {
      formatVersion: 1,
      run: name,
      rerun: rerunName,
      checkedAt: new Date().toISOString(),
      ...result,
    })
  }
  console.log(`${result.status}${result.reasons.length ? `: ${result.reasons.join('; ')}` : ''}`)
  if (result.status !== 'not-comparable') build()
}

function build() {
  const results = loadResults(ROOT)
  const verifications = loadVerifications(ROOT)
  const board = buildLeaderboard(results, verifications)
  const body = leaderboardMarkdown(board)
  writeJson(join(ROOT, 'leaderboard', 'leaderboard.json'), board)
  writeFileSync(join(ROOT, 'leaderboard', 'LEADERBOARD.md'), `# Tabletop Benchmark leaderboard\n\n${body}`)
  const readme = join(ROOT, 'README.md')
  if (existsSync(readme)) writeFileSync(readme, spliceBetween(readFileSync(readme, 'utf8'), body))
  buildHf(results, verifications)
  console.log(board.empty ? 'leaderboard: no results yet' : `leaderboard: ${board.rows.length} row(s)`)
}

function buildHf(results, verifications) {
  const dist = join(ROOT, 'dist', 'hf')
  rmSync(dist, { recursive: true, force: true })
  const dataset = join(dist, 'dataset')
  const space = join(dist, 'space')
  mkdirSync(dataset, { recursive: true })
  mkdirSync(space, { recursive: true })
  for (const dir of ['tasks', 'results', 'verification'])
    if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(dataset, dir), { recursive: true })
  for (const f of ['LICENSE-DATA.md', 'CITATION.cff'])
    if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dataset, f))
  writeFileSync(join(dataset, 'results.jsonl'), `${resultsJsonl(results, verifications)}\n`)
  cpSync(join(ROOT, 'hf', 'dataset-card.md'), join(dataset, 'README.md'))
  cpSync(join(ROOT, 'hf', 'space'), space, { recursive: true })
  cpSync(join(ROOT, 'leaderboard', 'leaderboard.json'), join(space, 'leaderboard.json'))
  if (existsSync(join(ROOT, 'LICENSE-DATA.md'))) cpSync(join(ROOT, 'LICENSE-DATA.md'), join(space, 'LICENSE-DATA.md'))
}

const [cmd, ...rest] = process.argv.slice(2)
const commands = {
  check: () => check(),
  run: () => run(rest),
  add: () => add(rest[0]),
  verify: () => verify(rest[0], rest[1]),
  build: () => build(),
}
if (!commands[cmd]) fail('Commands: check, run, add, verify, build. See docs/SUBMITTING.md.')
commands[cmd]()
