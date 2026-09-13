# All Clusters — status & auth simulator

A tiny, dependency-free simulator that reproduces exactly what the **All Clusters**
tab does, so the confusing "a cluster shows **Active** but then asks me to
authenticate" behaviour can be demonstrated, tested, and reasoned about without a
real cluster.

Everything here uses **generic, invented data**. No real cluster names, hosts,
tenants, tokens, or namespaces appear anywhere.

## Why this exists

The table's **Status** column and the act of **opening a cluster** are driven by
**two different requests, made at two different times, that can disagree**:

| Signal | Request | Where |
| --- | --- | --- |
| Table `Status = Active` | `GET /clusters/{cluster}/version` → 200 | `useClustersVersion` in `frontend/src/lib/k8s/index.ts` |
| Opening the cluster | `POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews` (`testAuth`, 5s timeout) | `AuthRoute` in `frontend/src/components/App/RouteSwitcher.tsx` |

So `Active` only means **"the last `/version` probe succeeded"** — not "you are
authorized" and not "opening will work". That semantic gap is the root cause of
the `Active → Connecting → Authentication` experience.

## Files

- `clusterStatusModel.mjs` — faithful, traceable port of the pure decision logic
  (status mapping, labels, backoff, warnings cap, the open-cluster auth gate).
  Each function names the exact source file it mirrors.
- `simulator.mjs` — drives a cluster through both probes and the open() flow.
- `scenarios.mjs` — a generic fleet covering every state.
- `run.mjs` — CLI that prints the table, the open() outcomes, and the backoff.
- `clusterStatusModel.test.mjs` — rigorous `node:test` suite (29 tests).

## Run it

```bash
# print the simulated table + open() flows + backoff
node tools/cluster-status-simulator/run.mjs

# one scenario as JSON
node tools/cluster-status-simulator/run.mjs active-but-open-auth-401

# just the failure backoff timeline
node tools/cluster-status-simulator/run.mjs --backoff

# run the tests
node --test tools/cluster-status-simulator/clusterStatusModel.test.mjs
```

## What it proves

- `Active` is derived only from a successful `/version`.
- A cluster can be `Active` **and** still land on the token/login screen when
  opened (`active-but-open-auth-401`, `active-but-open-timeout`).
- `⋯` in the **OCP Version** column for a plain Kubernetes cluster is normal
  (the OpenShift endpoint 404s), not a fault.
- Failed `/version` polling backs off `10s → 20 → 40 → 60` (capped).
- Warnings are a separate query, capped at `50+`, and can go stale if the live
  watch (WebSocket) fails while the count still shows.

## An interactive version

`interactive-simulator.html` is a self-contained page that renders the table and
lets you flip each probe's outcome to watch the table label and the open() flow
change live — useful for explaining the gap to others.
