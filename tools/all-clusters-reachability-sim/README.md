# All Clusters — reachability / "not reachable" simulator

A tiny, dependency-free simulator that reproduces **why a cluster flips to
"not reachable" / an error screen even when the token is perfectly valid** — the
intermittent problem seen while working in the All Clusters tab.

All data here is generic/synthetic. No real cluster names, hosts, tokens, or
namespaces appear anywhere.

## The two root causes it demonstrates

**1. A timeout mismatch + `retry: false` makes transient blips look fatal.**

| Request | Timeout | Source |
| --- | --- | --- |
| `/version` (reachability) | **120 s** (`DEFAULT_TIMEOUT`) | `api/v1/constants.ts` |
| `testAuth` (open + the "Ready" poll) | **5 s** | `api/v1/clusterApi.ts` |

An aborted request becomes **HTTP 408** (`clusterRequests.ts`), which maps to
`Unavailable`. Because every poll uses `retry: false` (`lib/k8s/index.ts`), a
**single** slow/blipped response instantly flips the row — and exponential
backoff (10→20→40→60 s) then makes that wrong state **linger up to ~60 s**.

**2. The open-cluster paradox.** The row can read **Ready** (`/version` 200)
while opening the cluster lands on **"This cluster is not responding"**, because
opening runs a *separate* `testAuth` with the tight **5 s** timeout. A
slow-but-alive API server (or a busy Headlamp proxy) trips it — the token was
never the problem.

## Files
- `reachabilityModel.mjs` — faithful port of the timeouts, status mapping,
  readiness, backoff, and the access-gate outcome (each names its source).
- `reachabilitySim.mjs` — the status-poll-over-time engine + the open paradox.
- `run.mjs` — prints the scenarios.
- `reachability.test.mjs` — `node:test` suite (13 tests).

## Run
```bash
node tools/all-clusters-reachability-sim/run.mjs
node --test tools/all-clusters-reachability-sim/reachability.test.mjs
```

## What it proves (and the fix directions)
- One transient blip → `Unavailable` for ~20 s (backoff applies on the first
  failure); a short outage → up to ~60 s to recover.
- A 6 s (valid) auth call → row `Reachable`, but **opening** shows "not
  responding".

Low-risk directions to make it stop happening (not yet implemented):
1. **Add a small retry** (1–2, short delay) to the version/auth polls so a
   single blip doesn't flip the row.
2. **Require 2 consecutive failures** before showing `Unavailable` (debounce).
3. **Raise the `testAuth` timeout** (e.g. 10–15 s) and/or **retry once** on the
   open path, so a slow SAR call doesn't read as "not responding".
4. **Distinguish "timed out" from "unreachable"** in the gate copy, and keep the
   last-known-good status during a refetch instead of flipping to the error.
