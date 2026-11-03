// Verification of a community run by a maintainer rerun (docs/VERIFYING.md).
// The rerun must be comparable (same task set, scoring, model and settings) and agree within
// tolerance: overall within max(5, widest repeat range of the two runs), every task within 10,
// drafting reliability within 0.15. Hardware may differ.

export const TOLERANCE = { overallFloor: 5, task: 10, reliability: 0.15 }

const width = (run) => (run.range?.overall ? run.range.overall[1] - run.range.overall[0] : 0)
const round1 = (n) => Math.round(n * 10) / 10

/** Why two runs cannot be compared; empty when they can. */
export function incomparable(a, b) {
  const why = []
  if (a.taskSetHash !== b.taskSetHash) why.push('different task set')
  if (a.scoringVersion !== b.scoringVersion) why.push('different scoring version')
  if (a.model.ref !== b.model.ref) why.push('different model')
  if (a.model.digest && b.model.digest && a.model.digest !== b.model.digest)
    why.push('different model digest')
  if ((a.model.quantization ?? '') !== (b.model.quantization ?? '')) why.push('different quantization')
  const pa = JSON.stringify(a.model.inference ?? null)
  const pb = JSON.stringify(b.model.inference ?? null)
  if (pa !== pb) why.push('different profile or sampling settings')
  return why
}

/** { status: 'verified' | 'disputed' | 'not-comparable', deltas, tolerance, reasons } */
export function compareRuns(submitted, rerun) {
  const reasons = incomparable(submitted, rerun)
  if (reasons.length) return { status: 'not-comparable', deltas: {}, tolerance: {}, reasons }
  const overallTol = Math.max(TOLERANCE.overallFloor, width(submitted), width(rerun))
  const deltas = {
    overall: round1(rerun.median.overall - submitted.median.overall),
    tasks: Object.fromEntries(
      Object.keys(submitted.median.tasks).map((t) => [
        t,
        round1((rerun.median.tasks[t] ?? 0) - submitted.median.tasks[t]),
      ]),
    ),
  }
  const rel = (submitted.median.draftingReliability ?? null) !== null
  if (rel)
    deltas.reliability = round1(
      ((rerun.median.draftingReliability ?? 0) - submitted.median.draftingReliability) * 100,
    ) / 100
  const miss = []
  if (Math.abs(deltas.overall) > overallTol) miss.push(`overall differs by ${deltas.overall}`)
  for (const [t, d] of Object.entries(deltas.tasks))
    if (Math.abs(d) > TOLERANCE.task) miss.push(`${t} differs by ${d}`)
  if (rel && Math.abs(deltas.reliability) > TOLERANCE.reliability)
    miss.push(`drafting reliability differs by ${deltas.reliability}`)
  return {
    status: miss.length ? 'disputed' : 'verified',
    deltas,
    tolerance: { overall: overallTol, task: TOLERANCE.task, reliability: TOLERANCE.reliability },
    reasons: miss,
  }
}
