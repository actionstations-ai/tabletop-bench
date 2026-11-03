---
license: cc-by-4.0
pretty_name: Tabletop Benchmark
language:
  - en
tags:
  - benchmark
  - tabletop-exercises
  - emergency-management
  - llm-evaluation
size_categories:
  - n<1K
configs:
  - config_name: results
    data_files: results.jsonl
---

# Tabletop Benchmark

A benchmark of how well language models generate tabletop exercises: a scenario, its master
scenario events list (MSEL) with citations to source plans, and a review that finds planted
defects. Scoring is rule-based and uses no judge model. The dataset also holds the Tabletop Mini
Benchmark, a screening that makes four fixed model calls and returns a verdict (will work, risky,
won't work) in minutes; its results are never ranked with the full benchmark. Made by the
[Action Stations](https://actionstations.ai) project.

- Code and methods: https://github.com/actionstations-ai/tabletop-bench
- Leaderboard: https://huggingface.co/spaces/actionstations/tabletop-benchmark-leaderboard
- Site: https://actionstations.ai/tabletop-bench/

## Contents

| Path | What |
| --- | --- |
| `tasks/<suite>-v<N>/` | The task set: suite file, planted defects, gold statistics, briefs, judge files, `taskset.json` with its sha256 hash |
| `results/<suite>-v<N>/*.json` | One run file per run (scores, model, settings, coarse hardware) |
| `verification/` | Records of maintainer reruns and their outcome |
| `results.jsonl` | One flattened run per line, for the dataset viewer; `benchmark` is `full` or `mini` |

`results.jsonl` is empty until the first results are published. The status column is
`community` (submitted, not reproduced), `verified` (reproduced within tolerance) or `disputed`.

## Using the task sets

The cases drive the Action Stations app's generation pipeline, so a run needs the app (see the
GitHub repository). The `corpus.json` file lists the example organizations by corpus hash and
gives each drafting brief in full.

## Limits

The task inputs are public, so contamination is possible. Seeds fix the sampler, not the runtime,
so reruns on other hardware differ slightly; verification uses a stated tolerance.

## License and citation

CC BY 4.0. Cite as in `CITATION.cff` (Crowley, M., 2026, Tabletop Benchmark, version 0.1.0).
