#!/usr/bin/env bash
# Publish the dataset and the leaderboard Space to Hugging Face with the hf CLI (already logged in:
# `hf auth whoami`). Usage: scripts/publish-hf.sh [hf user or org, default mdctric]
# Run `node tb.mjs build` first; this uploads dist/hf/dataset and dist/hf/space.
set -euo pipefail
cd "$(dirname "$0")/.."
OWNER="${1:-mdctric}"
[ -d dist/hf/dataset ] || node tb.mjs build
hf repo create "$OWNER/tabletop-bench" --repo-type dataset --exist-ok
hf upload "$OWNER/tabletop-bench" dist/hf/dataset . --repo-type dataset \
  --commit-message "Update Tabletop Bench dataset"
hf repo create "$OWNER/tabletop-bench-leaderboard" --repo-type space --space_sdk static --exist-ok
hf upload "$OWNER/tabletop-bench-leaderboard" dist/hf/space . --repo-type space \
  --commit-message "Update leaderboard"
echo "https://huggingface.co/datasets/$OWNER/tabletop-bench"
echo "https://huggingface.co/spaces/$OWNER/tabletop-bench-leaderboard"
