# All Clusters — final consolidated simulator

The single, code-verified model of the "All Clusters" status + cluster-open
behaviour on GT_D_V1. It reproduces every symptom investigated:

- the **timeout mismatch** (`/version` 120s vs `testAuth` 5s),
- **flapping** (`retry:false` → one blip flips the row, backoff makes it linger),
- the **open paradox** (valid token, slow SAR → "not responding"),
- the **return-to-page** behaviour at 2 / 4 / 6 minutes, including the verified
  react-query crux (a failed background re-check on cached success flips
  `isSuccess`→false, so AuthRoute shows the gate).

**All data is generic/synthetic.** No real cluster names, hosts, tokens, or
namespaces appear anywhere. Every constant/rule cites its source file:line in
`finalModel.mjs`; the react-query lifecycle rules were confirmed by running the
real `@tanstack/react-query` v5.51 engine headless.

## Run
```bash
node tools/all-clusters-final-sim/run.mjs
node --test tools/all-clusters-final-sim/final.test.mjs   # 12 tests
```

## Verified return-to-page matrix
| Away | cache | re-check runs? | you see |
| --- | --- | --- | --- |
| < 3 min | fresh | no | page instantly (backend speed irrelevant) |
| 3–5 min | stale, kept | yes (background) | page instantly; **if re-check slow/fails → flips to "not responding"** |
| > 5 min | gc-ed | yes (cold) | "Checking…" first, then page or gate |

## Files
- `finalModel.mjs` — verified constants, probe, readiness, AuthRoute gate mapping.
- `finalSim.mjs` — open paradox, poll flap, return-after-away lifecycle.
- `final.test.mjs` — 12 `node:test` cases locking the verified behaviour.
- `run.mjs` — prints all scenarios.
