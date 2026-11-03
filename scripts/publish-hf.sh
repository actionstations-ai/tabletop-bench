#!/usr/bin/env bash
# Publish the dataset and the leaderboard Space to Hugging Face with the hf CLI. The write token is
# HF_TOKEN in ~/.actionstations/secrets.env (the project secrets file); it is read here and never
# printed. Both benchmarks are in the same dataset and Space: the full Tabletop Benchmark and the
# Tabletop Mini Benchmark (tasks/, results/, results.jsonl, leaderboard.json).
#
# Usage: scripts/publish-hf.sh
# Run `node tb.mjs build` first (or let this do it); this uploads dist/hf/dataset and dist/hf/space
# to the repositories actionstations/tabletop-benchmark (dataset) and
# actionstations/tabletop-benchmark-leaderboard (static Space). Both stay private until the
# maintainer makes them public in the Hugging Face settings.
set -euo pipefail
cd "$(dirname "$0")/.."
SECRETS="$HOME/.actionstations/secrets.env"
if [ -f "$SECRETS" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$SECRETS"
  set +a
fi
: "${HF_TOKEN:?HF_TOKEN is not set: add it to ~/.actionstations/secrets.env}"
export HF_TOKEN
ORG="actionstations"
DATASET="$ORG/tabletop-benchmark"
SPACE="$ORG/tabletop-benchmark-leaderboard"
node tb.mjs check
node tb.mjs build
hf repo create "$DATASET" --repo-type dataset --private --exist-ok
hf upload "$DATASET" dist/hf/dataset . --repo-type dataset \
  --commit-message "Update Tabletop Benchmark and Tabletop Mini Benchmark dataset"
hf repo create "$SPACE" --repo-type space --space_sdk static --private --exist-ok
hf upload "$SPACE" dist/hf/space . --repo-type space \
  --commit-message "Update leaderboard"
echo "https://huggingface.co/datasets/$DATASET"
echo "https://huggingface.co/spaces/$SPACE"
