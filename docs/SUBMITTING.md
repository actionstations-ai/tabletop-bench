# Submitting a result

Anyone can submit a run by pull request.

1. Check out the Action Stations app at the commit named for the task set you want to run (see
   `docs/METHODS.md`), then `pnpm install` and `pnpm build:app`.
2. Start LM Studio or Ollama and load the model with a 32K context (Ollama: automatic; LM Studio:
   `lms load <id> --context-length 32768 -y`). Leave the sampling to the app's model profile so that
   the settings come from the model card and are recorded.
3. Run the standard suite:

   ```bash
   export ACTIONSTATIONS_APP=~/path/to/actionstations
   node tb.mjs run --suite standard --models lmstudio:<model id>
   ```

   It stops if the app's task set differs from `tasks/`.
4. Add it:

   ```bash
   node tb.mjs add incoming/<run file>.json
   ```

   This refuses a file that has no task-set hash, no recorded profile, a mock model, a hash we do
   not publish, or any path, host or user information. It copies the file to
   `results/<suite>-v<N>/` and rebuilds `leaderboard/` and the README table.
5. Open a pull request with the new file and the regenerated tables. Do not edit other results.
   Say in the description what hardware you used and anything unusual (a model you converted yourself, a patched runtime).

To submit a Tabletop Mini Benchmark result instead, run
`node tb.mjs run --suite mini --models lmstudio:<id>[,<id>…]` (LM Studio models are loaded at a
32K context and unloaded for you; pass `--no-load` to manage them yourself) and add each file the
same way. A Mini run makes every call twice, with no time limit (a stalled or looping reply ends a
call), so a slow model takes as long as it takes. A Mini result is a screening: it is always listed
as `community` and cannot be verified.

Your run is listed as `community`. We rerun it on our hardware when we can; if the rerun agrees
within the tolerance in `VERIFYING.md` it becomes `verified`.

Run files are never replaced. To correct a run, submit a new one.
