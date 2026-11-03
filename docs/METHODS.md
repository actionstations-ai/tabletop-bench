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
| Critique | a corrected scenario with planted defects, the critique stage rerun   | recall of planted defects (right row, defect words), plus a light penalty for notes on clean rows                |

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
- **Critique** = recall 0.85, noise 0.15.
- **Ideation** = valid 0.25, distinct 0.20, citation resolution 0.20, threat-family spread 0.15, grounding 0.20. Distinctness uses term-frequency cosine (a pair at 0.85 or more is a duplicate), so it is identical on every machine.
- **Overall** = drafting 0.5, critique 0.25, ideation 0.25.

With repeats, a result stores every repeat (seeds 11, 23, 37 in the standard suite), reports the
median, and the overall range. A range wider than 15 points is flagged **unstable**.

## Suites

- `quick`: one case per task on one organization plus a second critique case. A check that a model works at all.
- `standard`: three organizations, five briefs, six critique cases, three seeded repeats. The suite for the leaderboard.

Context length is 32,768 tokens; stages send up to about 30,000 input tokens.

## Fields in every result

Suite, suite version, scoring version, task-set hash, app version and commit, prompt hashes,
corpus hashes, embedder, model (name, tool, quantization, size, digest, context length,
`inference`: profile, sampling, reasoning level), coarse hardware, start time, every repeat's
scores and failures, median, range, unstable flag.

## Limits

- The task inputs are public, so a model trained on them could overfit. A private held-out suite is a possible later addition and would be labelled as such.
- Deterministic scoring checks structure, grounding and planted defects; it cannot judge whether an exercise is good for a particular team. A model's rank here is evidence about reliability and rule-following, not a replacement for exercise-design review.
- Seeds fix the sampler, not the runtime: the same seed on different hardware or runtime versions can differ. That is why verification uses a tolerance.
- Small task sets give wide ranges. Read the range, not only the median.
