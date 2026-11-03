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

A screening, not a ranking. Task set `mini-v2`; seeds 11 and 12, so every probe runs twice; context
32,768 tokens. Each probe re-runs one stage of the app's pipeline on a bundled example's
hand-corrected scenario, so the upstream inputs (phase plan, roles, MSEL, corpus) are the same for
every model, and each probe works on its own copy of the example in each run.

**Independence.** Nothing in the Mini's scoring, bands or token budget reads a result of the full
Tabletop Benchmark. Quality is measured against the Scenario 3 reference and the planted defects;
the bands are the requirements below, not a calibration against another benchmark. Agreement with
the full benchmark may be reported as a cross-check and changes nothing here.

| Probe | Call |
| --- | --- |
| Format | `scenario_overview`, city water |
| Long prompt | `msel_phase`, last phase, chemical plant, stretched to 180 minutes so the model writes a full phase (18 rows asked, 21 allowed) with the corpus, plan, roles and every earlier phase's rows in the prompt |
| Long output | `controller_handbook`, city water |
| Review | critique and revision of the county 911 case with planted defects |

### Mini score = Quality x Completion

**Completion** is the chance that a full scenario drafts with no failed stage. A call is a
*first-try success* when it returns a usable reply with no failure, no repair round and no reply
cut off at the length limit and asked again. The per-call rate is the share of first-try successes
over every Mini call of both runs. Completion is that rate raised to the number of model calls in a
scenario. The pipeline makes one call per stage and one `msel_phase` call per phase: scenario
overview, objectives and roles, phase plan, four MSEL phases, controller handbook, rubric,
evaluation guides, player briefing, hot wash, situation manual and review, which is **14 calls**.
Completion falls fast: 98% of calls succeeding first time gives 75%, and one failure in eight Mini
calls gives 15%.

**Quality** is the share of criteria met, 0 to 100, over the replies the model delivered. A call
that returned nothing adds no criteria; it costs completion, so a failure is counted once. The
criteria are fixed pass/fail statements; thresholds are in `tasks/mini-v2/suite.json`.

| Probe | Criteria |
| --- | --- |
| Long prompt | at least 15 rows in the phase; rows per hour within 0.8 to 1.25 of the Scenario 3 band (5 to 6); every purpose-tag group of the reference present (the decision point is excepted: it belongs to one middle phase); opens with its time jump and, as the last phase, ends with the ENDEX; every role receives an inject; the brief ids are used; no text copied from the reference; citations resolved at least 90%; rows citing a source at least 80%; claims supported by the source at least 70% (only when the source check found claim-bearing rows); no lint errors; lint penalty at most 5 per 10 rows |
| Handbook | all 5 sections; at least 1,000 words (the bundled handbooks run 1,500 to 1,650); under 25% repeated 6-word phrases |
| Review | one criterion per planted defect: found by a note, or no longer in the revised MSEL |

The format probe adds no criteria; it counts in completion.

### Shown alongside, not mixed in

- **Review damage %**: the share of correct rows the review's revision changed, with the deliberate
  content (pressure, misinformation, clue and red-herring rows) weighted three times, as in the full
  benchmark's critique scorer. Mean of the review calls of a run.
- **Draft time**: minutes for a full scenario on this hardware. Per run, the calls' own timings give
  a prompt rate P and a generation rate G by least squares on `seconds = input / P + output / G`
  (one pooled rate if the fit is not usable). Draft time is `input / P + output / G` for the
  token budget of a scenario: **237,242 input and 37,839 output tokens**, the mean over the
  bundled example scenarios of the token counts recorded for each pipeline stage (a phase call times
  four). The recorded counts come from the models that drafted the examples; a model that thinks at
  length writes more. Injects and media are not part of the scenario pipeline and are not counted.

### Bands

Requirements, applied to the reported values:

- **Recommended**: completion at least 90%, quality at least 80 and review damage at most 5%.
- **Usable with editing**: completion at least 75% and quality at least 60.
- **Not recommended**: anything else.

When the ranges over the two runs reach into another band, the run file says so (`uncertain`).

### No time cap

A call is never ended for taking long. The adapter streams the reply and ends the call only on:

- a **stall**: no new output token for 60 seconds once the reply has started, or for 600 seconds
  before the first token (the time the prompt is read); or
- a **loop**: the end of the reply is one unit repeated at least 5 times and over at least 400
  characters.

The limits are in the suite file and are part of the task-set hash. A stalled or looping call is a
failed call; the run file keeps its kind and the last 400 characters of the reply.

### Ranges and ties

Every figure is the mean of the two runs with its minimum and maximum. The score's range is the two
runs' own scores, widened to include the reported score. Two models whose score ranges overlap are a
tie and share a rank; the leaderboard marks them.

A held-out review case on another organization is run by the maintainers and is not in the
published task set. A model whose failure depends on its own earlier output can pass the Mini's
fixed inputs; the full benchmark is the check for that.

## Fields in every result

(The Mini run file has the same identifying fields plus the stream limits, two `repeats` with their
probes, criteria and failures, a `result` with every figure and its range, and the `verdict` band.)


Suite, suite version, scoring version, task-set hash, app version and commit, prompt hashes,
corpus hashes, embedder, model (name, tool, quantization, size, digest, context length,
`inference`: profile, sampling, reasoning level), coarse hardware, start time, every repeat's
scores and failures, median, range, unstable flag.

## Limits

- The task inputs are public, so a model trained on them could overfit. Four held-out critique cases on other organizations are kept out of the published task sets; a private held-out suite for the other tasks is a possible later addition and would be labelled as such.
- Deterministic scoring checks structure, grounding and planted defects; it cannot judge whether an exercise is good for a particular team. A model's rank here is evidence about reliability and rule-following, not a replacement for exercise-design review.
- Seeds fix the sampler, not the runtime: the same seed on different hardware or runtime versions can differ. That is why verification uses a tolerance.
- Small task sets give wide ranges. Read the range, not only the median.
