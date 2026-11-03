# Methods

## Design principles

1. **Scoring is deterministic and model-free.** No judge model enters a score. Checks are rules
   run over the generated scenario: lint findings, citation resolution and grounding, a structure
   rubric from a gold exercise, planted-defect recall, and rule-based distinctness.
2. **Fixed, versioned, hashed inputs.** Every case, weight and threshold lives in a task set whose
   hash is recorded in each result. Results from different hashes or scoring versions are never
   ranked together.
3. **The product is the reference.** The benchmark runs the Action Stations app's own pipeline, so
   it measures what a user of the app gets from a model.
4. **Local and open-weight.** Published results come from models run on the contributor's machine
   through LM Studio or Ollama (MLX through LM Studio on Apple Silicon). The runner refuses any
   endpoint that is not on this machine.
5. **Model-card settings.** Sampling comes from the model's published recommendations through the
   app's model profiles, and the profile and values are recorded in each result.

## One source of truth for scoring

The scoring code is in the Action Stations repository (`scripts/bench/score/`). This repository
holds the task sets, the results and the tooling that aggregates them, and no scoring code, so
there is one implementation that cannot drift. `tb run` compares the task-set hash the app exports
(`pnpm bench:export`) with `tasks/` and refuses to run when they differ. Each result records
`appVersion` and `appCommit`; to reproduce one, check out that commit.

## Tasks

| Task     | Input                                                                | Output scored                                                                                                    |
| -------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Ideation | the plans of an example organization, empty brief, six ideas         | valid ideas, distinctness, citation resolution, threat-family spread, grounding of the "why it teaches" text      |
| Drafting | a fixed brief (audience, duration, phases, threat family, objectives) | the scenario through the app's stages up to critique and revision (no injects or media)                          |
| Critique | a corrected scenario with planted defects, the critique stage rerun   | planted defects found (a note on the right row with defect words, or undone by the revision), minus damage to correct rows and a light penalty for notes on clean rows |

Planted defect kinds: time order broken; an expected action contradicting its cited section; an
inject from a player role; a duplicate row; a missing decision point; a facility identifier not in
the facts; an implausibly fast restoration; an outside agency deciding for the organization.

## Scores

Each part is 0 to 100. Weights are in `tasks/<suite>-v<N>/suite.json` and are part of the hash.

- **Drafting** = reliability 0.25, lint 0.20, citations 0.20, structure 0.35.
  - Reliability: share of pipeline stages that succeeded (a stage never reached after a failure counts as failed).
  - Lint: the app's scenario lint findings weighted by severity, per 10 MSEL rows, capped.
  - Citations: key resolution 0.3, support from the app's deterministic grounding check 0.4, coverage of non-control rows 0.3.
  - Structure: pass or fail items from the gold exercise (pace band, purpose-tag mix, decision point in the decision phase, start and end markers, every player role in every phase, brief identifiers used, no reference leak), weighted.
- **Critique** = recall 0.65, noise 0.10, intact 0.25.
  - Recall: a planted defect counts as found when a note names it or the revision undid it: the edited row is back closer to its correct form than to the planted one, a removed decision point is restored, or a duplicated row is removed or made distinct. Deleting a defective row (other than a duplicate) counts as damage, not a fix. The share fixed by the revision is reported apart.
  - Damage: the weighted share of rows outside the planted defects that the revision removed, gave a different sender, or rewrote past 60% word overlap in the event or expected action. Pressure, misinformation, clue and red-herring rows weigh three times the others because their content is deliberate. Intact is 100 minus 2 points per percent of damage, floored at 0.
  - Critique is **advisory**: it is reported but is not part of the recommendation floor.
- **Ideation** = valid 0.25, distinct 0.20, citation resolution 0.20, threat-family spread 0.15, grounding 0.20. Distinctness uses term-frequency cosine (a pair at 0.85 or more is a duplicate), so it is identical on every machine.
- **Overall** = drafting 0.5, critique 0.25, ideation 0.25.
- **Floor** (a result is recommendable): drafting at least 50, drafting reliability at least 90%, ideation at least 50, stable across repeats. Critique recall, fixed and damage are published next to the floor with a plain warning when recall is under 50 or damage is over 10%.

With repeats, a result stores every repeat (seeds 11, 23, 37 in the standard suite), reports the
median, and the overall range. A range wider than 15 points is flagged **unstable**.

## Suites

- `quick`: one case per task on one organization plus a second critique case. A check that a model works at all.
- `standard`: three organizations, five briefs, six critique cases, three seeded repeats. The suite for the leaderboard.

Context length is 32,768 tokens; stages send up to about 30,000 input tokens.

## Tabletop Mini Benchmark

A screening, not a ranking. Task set `mini-v1`; one seed (11); context 32,768 tokens. Each probe
re-runs one stage of the app's pipeline on a bundled example's hand-corrected scenario, so the
upstream inputs (phase plan, roles, MSEL, corpus) are the same for every model, and each probe
works on its own copy of the example.

| Probe | Call | Scored with |
| --- | --- | --- |
| Format | `scenario_overview`, city water | valid structured output; repair rounds |
| Long prompt | `msel_phase`, last phase, chemical plant (the prompt carries the corpus, plan, roles and the earlier phases' rows) | the lint, citation (resolution, coverage, source check) and structure scorers of the full benchmark, on that phase's rows: lint 0.3, citations 0.3, structure 0.4 |
| Long output | `controller_handbook`, city water | sections present (0.5) and share of repeated 6-word phrases (0.5); a length cut-off is a failed call |
| Review | critique and revision of the county 911 case with planted defects | the full benchmark's critique scorer: recall, fixed, damage to correct rows, noise |
| Speed | the calls above | output tokens per second; size and time of the long-prompt call |

**Time cap.** A call that runs longer than 180 seconds is cancelled and recorded as a failure.

**Mini score** = format 0.10, long prompt 0.35, long output 0.20, review 0.35.

**Verdict.**

- *Won't work*: the format, long-prompt or long-output call failed, was cut off or timed out; or the Mini score is under 45.
- *Risky*: all calls ran and any of: score under 60; a repair round in a generation call; a handbook with 25% or more repeated phrases; a review that damages 10% or more of correct rows, finds under 30% of planted defects, or failed; under 15 output tokens per second; the long prompt taking over 150 seconds.
- *Will work*: none of the above.

Thresholds are in `tasks/mini-v1/suite.json` and are part of the task-set hash. The review damage
warning follows from the 2026-11-03 runs, where one model's review rewrote correct rows; critique
remains advisory in the full benchmark. A held-out review case on another organization is run by
the maintainers and is not in the published task set. A model whose failure depends on its own
earlier output can pass the Mini's fixed inputs; the full benchmark is the check for that.

## Fields in every result

(The Mini run file has the same identifying fields plus `probes`, `speed`, `score` and `verdict`
instead of repeats and medians.)


Suite, suite version, scoring version, task-set hash, app version and commit, prompt hashes,
corpus hashes, embedder, model (name, tool, quantization, size, digest, context length,
`inference`: profile, sampling, reasoning level), coarse hardware, start time, every repeat's
scores and failures, median, range, unstable flag.

## Limits

- The task inputs are public, so a model trained on them could overfit. Four held-out critique cases on other organizations are kept out of the published task sets; a private held-out suite for the other tasks is a possible later addition and would be labelled as such.
- Deterministic scoring checks structure, grounding and planted defects; it cannot judge whether an exercise is good for a particular team. A model's rank here is evidence about reliability and rule-following, not a replacement for exercise-design review.
- Seeds fix the sampler, not the runtime: the same seed on different hardware or runtime versions can differ. That is why verification uses a tolerance.
- Small task sets give wide ranges. Read the range, not only the median.
