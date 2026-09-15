# All Clusters — P1 watch simulator (BEFORE vs AFTER)

A deterministic, dependency-free model of the "watch" (WebSocket) lifecycle for
the list views, comparing the **current code** (BEFORE) with the **P1** design
(AFTER). It proves the fix for the silent-stale bug and its safety boundaries
without touching the app. See `p13.txt` for the full spec.

**Plain terms:** a "watch" is an open phone call to the cluster that pushes live
updates. Today, if the call drops the app does not redial and does not fall back
to asking — so the list silently freezes. P1 auto-redials (with backoff), keeps a
light backup refetch, and shows whether the data is live or stale.

**All data is generic/synthetic.** BEFORE facts are cited from source in
`model.mjs` (webSocket.ts has no close/reconnect; watch and refetch are mutually
exclusive) and match the 36-min live capture (26 WS errors, no auto-reopen).

## Run
```bash
node tools/all-clusters-p1-sim/run.mjs                # print BEFORE vs AFTER
node --test tools/all-clusters-p1-sim/p1.test.mjs     # 12 assertions
```

## Scenarios (BEFORE → AFTER)
| # | Scenario | BEFORE | AFTER (P1) |
| --- | --- | --- | --- |
| W1 | single drop, healthy | stale forever, no redial | auto-reconnect → live |
| W2 | repeated drops | (no redial) | backoff 1s→2s→4s, no storm, recovers |
| W3 | socket silently dead | never refreshed | safety-net refetch heals in ≤ fallback window |
| W4 | resume bookmark too old (410) | (no redial) | fresh re-list → live |
| W5 | leave page mid-reconnect | n/a | redial loop stops, no leaked socket |
| W6 | freshness | (no signal) | live → reconnecting → live |
| P1+ | healthy watch | live | **unchanged** (still live, no re-list) |
| rollback | RECONNECT off | — | behaves like BEFORE (stale) — instant rollback |

## Honest boundaries
- This is a MODEL of the intended behaviour (like the P0 sim), not the real
  `webSocket.ts` running. The real code will be proven by real component/unit
  tests during implementation.
- P1 does not add a circuit-breaker for genuinely-down clusters (that is P2); the
  backoff cap bounds redial frequency for now.

## Files
- `model.mjs` — constants + `WatchBefore` / `WatchAfter` lifecycle models.
- `p1.test.mjs` — 12 `node:test` assertions (W1-W6, positive, rollback).
- `run.mjs` — prints the BEFORE vs AFTER table above.
