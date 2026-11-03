# Verification

A run is **community** until a maintainer reruns it. The rerun uses the same suite, the same model
(reference, quantization and digest), the same task-set hash and scoring version, and the same
profile and sampling settings. The hardware may differ.

```bash
node tb.mjs verify results/standard-v1/<submitted>.json <our rerun>.json
```

## Tolerance

The rerun agrees when all of these hold:

- The overall medians differ by at most `max(5, the widest overall range of the two runs)` points.
- Every task median differs by at most 10 points.
- Drafting reliability differs by at most 0.15.

Why: a fixed seed fixes the sampler, not the runtime, so two correct runs on different hardware or
runtime versions drift. The overall range of three seeded repeats is the run's own measure of that
spread; the floor of 5 points covers runs whose three repeats happened to agree closely.

## Outcomes

- `verified`: within tolerance. The record names the rerun file, kept in `verification/reruns/`.
- `disputed`: outside tolerance. Both numbers stay visible; the submission is not deleted.
- `not-comparable`: different task set, scoring version, model, quantization or settings. Nothing
  is recorded; rerun with matching settings.

Records are files in `verification/`, one per submitted run; run files are never edited.
The leaderboard row for a model setting uses the best status (verified, then community, then
disputed) and, among equals, the latest run.
