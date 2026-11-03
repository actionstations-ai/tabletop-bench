// Task-set folders under tasks/: read them and check their hash. The hash definition is the one
// in the Action Stations app (scripts/bench/taskset.mjs): sha256 over the sorted
// "<path>\0<sha256 of the file>\n" lines. This code only checks hashes; it does no scoring.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

export function hashFiles(files) {
  const lines = Object.keys(files)
    .sort()
    .map((p) => `${p}\0${sha256(files[p])}\n`)
  return sha256(lines.join(''))
}

/** All task sets: [{ dir, name, manifest }] sorted by name. */
export function listTaskSets(root) {
  const base = join(root, 'tasks')
  if (!existsSync(base)) return []
  return readdirSync(base)
    .sort()
    .filter((name) => existsSync(join(base, name, 'taskset.json')))
    .map((name) => ({
      name,
      dir: join(base, name),
      manifest: JSON.parse(readFileSync(join(base, name, 'taskset.json'), 'utf8')),
    }))
}

/** Recomputes the hash from the files on disk; returns { ok, problems }. */
export function checkTaskSet({ dir, manifest }) {
  const problems = []
  const files = {}
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const file = join(dir, rel)
    if (!existsSync(file)) {
      problems.push(`${rel}: missing`)
      continue
    }
    files[rel] = readFileSync(file, 'utf8')
    if (sha256(files[rel]) !== expected) problems.push(`${rel}: changed`)
  }
  if (!problems.length && hashFiles(files) !== manifest.hash) problems.push('hash does not match')
  return { ok: problems.length === 0, problems }
}

export const findTaskSetByHash = (sets, hash) => sets.find((s) => s.manifest.hash === hash)
