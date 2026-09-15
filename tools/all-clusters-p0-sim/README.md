# All Clusters — P0 resilience simulator (BEFORE vs AFTER)

A code-verified, dependency-free model that proves what **P0** (see `p7.txt`)
changes and — just as important — what it does **not** change. It runs each
scenario through the **current code** behaviour (BEFORE) and the **P0**
behaviour (AFTER) so the fix and its safety are both demonstrable without
touching the app.

**All data is generic/synthetic** — no real cluster names, hosts, tokens, or
namespaces. Every BEFORE constant/rule was re-read from source and confirmed by
the live baseline (STEP V0: "spec matches code exactly, zero drift"). Sources
are cited inline in `model.mjs`.

## Run
```bash
node tools/all-clusters-p0-sim/run.mjs                 # print BEFORE vs AFTER
node --test tools/all-clusters-p0-sim/p0.test.mjs      # 13 assertions
```

## What P0 is (modelled here)
- `authTimeout` 5s → **15s**
- open-gate `retry` 0 → **1** (jittered)
- **keep-last-good** on a blip (408/502/network) with **debounce threshold 2**
- **401/403 always immediate** (keep-last-good never hides a real auth failure)
- poll backoff gains **±15% jitter**; `staleTime` (3m) / `gcTime` (5m) untouched

## Results (BEFORE → AFTER)
| Scenario | BEFORE (bug) | AFTER (P0) |
| --- | --- | --- |
| F1 table + 1 blip | Ready→**Unavailable**→Ready (flicker) | Ready→Ready→Ready |
| F2 open slow auth 6s (valid) | **gate** (5s timeout) | opens (15s) |
| F3 return 4min, re-check blips | **gate** | page kept + reconnecting |
| F4 genuinely down | gate on fail #1 | reconnecting, then honest gate on **#2** (bounded) |
| F5 token expired (401/403) | gate | gate **immediately** (unchanged, safe) |
| P+1 fast open / P+3 first-open / P+5 OIDC | cluster / checking / login | **same** (unchanged) |
| return 6min cold + genuine fail | gate | **gate** (keep-last-good does NOT apply once gc-ed — honest) |

## Honest boundaries (what P0 does NOT do)
- A **cold** (>5 min, gc-ed) return whose re-check genuinely fails still gates —
  there is no cached last-good to keep, so the gate is honest (BEFORE === AFTER).
- A truly-down cluster still turns red — after **2** consecutive fails, not
  never. keep-last-good is bounded, never infinite "reconnecting".
- P0 does not touch data-fetching/watch (that is P1) or the backend latency
  (that is a separate track).

## Files
- `model.mjs` — verified constants + probe + BEFORE deciders + AFTER (P0) deciders.
- `flows.mjs` — the 5 negative + 5 positive scenarios + return-after-away.
- `p0.test.mjs` — 13 `node:test` assertions locking BEFORE-bug / AFTER-fixed /
  positives-unchanged.
- `run.mjs` — prints the BEFORE vs AFTER table above.
