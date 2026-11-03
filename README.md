# Tabletop Benchmark

A benchmark of how well language models generate tabletop exercises: the scenario, the master
scenario events list (MSEL) and the review of it. It runs open-weight models locally and scores
the output without a judge model, so any result can be re-run and checked.

There are two benchmarks on the same scoring:

- **Tabletop Benchmark**: the full benchmark, an evening per model. It ranks models.
- **Tabletop Mini Benchmark**: a screening, a few minutes per model. Four fixed model calls and a
  verdict, **will work**, **risky** or **won't work**, with the reasons. It is never ranked with the
  full benchmark.

Tabletop Benchmark is made by the [Action Stations](https://actionstations.ai) project. It runs the Action
Stations app's own generation pipeline on fixed, versioned task sets.

- Leaderboard: [actionstations.ai/tabletop-bench](https://actionstations.ai/tabletop-bench/), and a Hugging Face Space (`actionstations/tabletop-benchmark-leaderboard`) once published
- Dataset (tasks, results): in this repository, and on Hugging Face (`actionstations/tabletop-benchmark`) once published

## Results

<!-- leaderboard:begin -->

### Tabletop Benchmark

First results coming.

### Tabletop Mini Benchmark

A screening: a verdict in minutes, never ranked with the full benchmark.

First results coming.

<!-- leaderboard:end -->

No numbers are published yet for either benchmark. The first runs will use the model-card sampling settings of the
app's model profiles, and each row will show whether we reproduced it:

- `community`: submitted by someone, not yet reproduced by us.
- `verified`: we reran it and the rerun agrees within the tolerance in [docs/VERIFYING.md](docs/VERIFYING.md).
- `disputed`: our rerun disagreed; both numbers are shown.

## What it measures

Three tasks on fictional example organizations (an airport, a city water utility, a county 911
center), scored 0 to 100 by rules, never by a model:

| Task     | The model                                                                                  |
| -------- | ------------------------------------------------------------------------------------------ |
| Drafting | writes a full scenario with an MSEL from a fixed brief, citing the source plans            |
| Critique | reviews a corrected scenario in which defects were planted (wrong order, duplicate, etc.)  |
| Ideation | proposes six distinct scenario ideas grounded in the plans                                 |

Overall = 0.5 drafting + 0.25 critique + 0.25 ideation. [docs/METHODS.md](docs/METHODS.md) lists
every scored part, its weight, the seeds and the threshold for "unstable".

## The Mini Benchmark

Four calls on fixed inputs taken from the bundled example organizations, plus timing. About ten
minutes for a 30B model; the same command runs a list of models.

| Probe       | The model                                                                              | What decides it                                                      |
| ----------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Format      | writes the scenario overview as structured output                                      | a valid answer; repair rounds                                        |
| Long prompt | writes the last MSEL phase of a chemical plant scenario from a 20 to 30K-token prompt  | lint, citations and structure of that phase; a length cut-off fails  |
| Long output | writes the controller handbook for a water utility MSEL                                | finishes, has its sections, does not loop                            |
| Review      | reviews a county 911 scenario with planted defects                                     | defects found or fixed, damage to correct rows                       |
| Speed       | (the calls above)                                                                      | output tokens per second, time for the long prompt                   |

A call that runs longer than three minutes is cancelled and counts as a failure. The verdict:
*won't work* if a generation call fails, is cut off or times out; *risky* if everything ran but a
call needed repair, the handbook repeats itself, the review damages 10% or more of correct rows,
output is slow, or the score is low; *will work* otherwise. [docs/METHODS.md](docs/METHODS.md)
has the thresholds. A Mini result is a screening and is always listed as `community`; it is
never `verified`. One held-out review case is kept by the maintainers and is not in the task set.

## Task sets

`tasks/<suite>-v<N>/` holds a task set: the suite file, planted defects, gold statistics, judge
files and the briefs. `taskset.json` carries a sha256 over all of them. A published task set is
never edited; a change is a new version. `node tb.mjs check` verifies the hashes.

## Run it

You need the Action Stations app checked out and built (`pnpm install && pnpm build:app`),
LM Studio or Ollama on this machine, and Node 20 or later here.

```bash
export ACTIONSTATIONS_APP=~/Code/actionstations
node tb.mjs run --suite mini --models lmstudio:qwen/qwen3.5-9b,lmstudio:google/gemma-3-12b   # minutes per model; loads and unloads LM Studio models
node tb.mjs run --suite quick --models lmstudio:qwen/qwen3.5-9b       # about an hour for a 9B model
node tb.mjs run --suite standard --models ollama:qwen3.5:9b --add     # an evening; --add also adds the result
```

`tb run` stops if the app's task set differs from the one in `tasks/`, so a result never mixes
task sets. The scoring code is the app's, not copied here (see [docs/METHODS.md](docs/METHODS.md)).
Only loopback endpoints are allowed: nothing is sent to a hosted model.

## Submit a result

```bash
node tb.mjs add incoming/<run file>.json    # validates, copies to results/, rebuilds the tables
```

Then open a pull request with the new file under `results/` and the regenerated tables. Details in
[docs/SUBMITTING.md](docs/SUBMITTING.md). Run files hold scores, model metadata and coarse
hardware (platform, chip, RAM rounded to GB); `tb add` refuses a file with paths, host names or
user names.

## Commands

| Command                       | What it does                                             |
| ----------------------------- | -------------------------------------------------------- |
| `node tb.mjs check`           | Verify every task set against its hash                   |
| `node tb.mjs run ...`         | Run a suite through the app and collect the run file     |
| `node tb.mjs add <run.json>`  | Validate and add a result, then rebuild                  |
| `node tb.mjs verify <a> <b>`  | Compare a maintainer rerun with a submitted run          |
| `node tb.mjs build`           | Regenerate leaderboard files, this table and `dist/hf/`  |
| `npm test`                    | Tests of the tooling                                     |

## Cite

```bibtex
@misc{tabletopbenchmark2026,
  title        = {Tabletop Benchmark: a benchmark of how well language models generate tabletop exercises},
  author       = {Crowley, Matt},
  year         = {2026},
  howpublished = {\url{https://github.com/actionstations-ai/tabletop-bench}},
  note         = {Version 0.1.0}
}
```

`CITATION.cff` has the same data for GitHub's "Cite this repository".

## License

Task sets, results, verification records and leaderboard data: [CC BY 4.0](LICENSE-DATA.md).
Code (`tb.mjs`, `lib/`, `tests/`): PolyForm Internal Use License 1.0.0 with the education
permission, the same as the Action Stations app ([LICENSE.md](LICENSE.md),
[LICENSE-EDUCATION.md](LICENSE-EDUCATION.md)).
