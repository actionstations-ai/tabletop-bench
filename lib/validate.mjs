// Validation of a run file (the BenchRun format of the Action Stations app). Run files are
// untrusted data: shape is checked here, and no string may look like an absolute path or a
// field name a host, user or path.
import { findTaskSetByHash } from './taskset.mjs'

const FORBIDDEN_KEYS = new Set(['hostname', 'host', 'username', 'user', 'home', 'path', 'cwd'])
const ABSOLUTE = /^(\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,150}\.json$/
const LOCAL_TOOLS = new Set(['lmstudio', 'ollama'])

export const isSafeFileName = (name) => SAFE_FILE.test(name)

/** JSON paths of strings that look like absolute paths and keys that name a host or user. */
export function findForbidden(value, at = '$') {
  if (typeof value === 'string') return ABSOLUTE.test(value) ? [at] : []
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbidden(v, `${at}[${i}]`))
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN_KEYS.has(k.toLowerCase()) ? [`${at}.${k}`] : []),
      ...findForbidden(v, `${at}.${k}`),
    ])
  return []
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)

function checkShape(run, problems) {
  const need = (cond, msg) => cond || problems.push(msg)
  need(isObj(run), 'not an object')
  if (!isObj(run)) return
  need(run.formatVersion === 1, 'formatVersion must be 1')
  need(typeof run.suite === 'string', 'suite missing')
  need(Number.isInteger(run.suiteVersion), 'suiteVersion missing')
  need(Number.isInteger(run.scoringVersion), 'scoringVersion missing')
  need(/^[0-9a-f]{64}$/.test(run.taskSetHash ?? ''), 'taskSetHash missing (run with a current app)')
  need(typeof run.startedAt === 'string', 'startedAt missing')
  need(isObj(run.model) && typeof run.model.ref === 'string', 'model.ref missing')
  need(LOCAL_TOOLS.has(run.model?.tool), 'model.tool must be lmstudio or ollama')
  need(
    typeof run.model?.inference?.profile === 'string',
    'model.inference.profile missing: runs need the model-card settings of the model profiles',
  )
  need(isObj(run.hardware) && isNum(run.hardware.ramGb), 'hardware.ramGb missing')
  need(isNum(run.median?.overall), 'median.overall missing')
  need(isObj(run.median?.tasks), 'median.tasks missing')
  need(
    Array.isArray(run.range?.overall) && run.range.overall.every(isNum),
    'range.overall missing',
  )
  need(Array.isArray(run.repeats) && run.repeats.length > 0, 'repeats missing')
}

const MINI_LEVELS = new Set(['recommended', 'usable', 'not_recommended'])
const isRange = (r) => isObj(r) && isNum(r.value) && isNum(r.min) && isNum(r.max) && r.min <= r.max

/** Shape of a Tabletop Mini Benchmark run file (`kind: "mini"`, suite version 2: Quality x Completion). */
function checkMiniShape(run, problems) {
  const need = (cond, msg) => cond || problems.push(msg)
  need(isObj(run), 'not an object')
  if (!isObj(run)) return
  need(run.formatVersion === 1, 'formatVersion must be 1')
  need(run.kind === 'mini' && run.suite === 'mini', 'not a Mini run file')
  need(Number.isInteger(run.suiteVersion), 'suiteVersion missing')
  need(Number.isInteger(run.scoringVersion), 'scoringVersion missing')
  need(/^[0-9a-f]{64}$/.test(run.taskSetHash ?? ''), 'taskSetHash missing (run with a current app)')
  need(typeof run.startedAt === 'string', 'startedAt missing')
  need(isObj(run.model) && typeof run.model.ref === 'string', 'model.ref missing')
  need(LOCAL_TOOLS.has(run.model?.tool), 'model.tool must be lmstudio or ollama')
  need(typeof run.model?.inference?.profile === 'string', 'model.inference.profile missing')
  need(isObj(run.hardware) && isNum(run.hardware.ramGb), 'hardware.ramGb missing')
  need(isObj(run.result), 'result missing')
  need(isRange(run.result?.score), 'result.score must be { value, min, max }')
  need(isRange(run.result?.completion), 'result.completion must be { value, min, max }')
  need(isRange(run.result?.perCallRate), 'result.perCallRate must be { value, min, max }')
  need(isRange(run.result?.repairRate), 'result.repairRate must be { value, min, max }')
  need(isNum(run.result?.failedCalls) && isNum(run.result?.calls), 'result.failedCalls and result.calls missing')
  need(MINI_LEVELS.has(run.verdict?.level), 'verdict.level missing')
  need(Array.isArray(run.repeats) && run.repeats.length >= 2, 'repeats: the Mini runs every probe twice')
  need(
    Array.isArray(run.repeats) && run.repeats.every((r) => isObj(r.probes) && isObj(r.probes.format) && isObj(r.probes.review)),
    'repeats[].probes missing',
  )
  need(isObj(run.stream), 'stream missing (the stall and repetition limits)')
}

/** { ok, problems, taskSet }: shape, forbidden fields, and a known task-set hash. */
export function validateRun(run, taskSets) {
  const problems = []
  if (isObj(run) && run.kind === 'mini') checkMiniShape(run, problems)
  else checkShape(run, problems)
  if (isObj(run)) {
    for (const at of findForbidden(run)) problems.push(`${at}: path, host or user information`)
  }
  const taskSet = problems.length ? undefined : findTaskSetByHash(taskSets, run.taskSetHash)
  if (!problems.length && !taskSet)
    problems.push('taskSetHash matches no task set in tasks/ (a newer or modified task set?)')
  if (taskSet && (taskSet.manifest.suite !== run.suite || taskSet.manifest.suiteVersion !== run.suiteVersion))
    problems.push('suite and suiteVersion do not match the task set')
  if (taskSet && taskSet.manifest.scoringVersion !== run.scoringVersion)
    problems.push('scoringVersion does not match the task set')
  return { ok: problems.length === 0, problems, taskSet }
}
