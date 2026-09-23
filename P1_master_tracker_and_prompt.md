# P1 — MASTER TRACKER (Bucket A + Bucket B), updated 2026-09-22

## P1 kya hai — recap

P0 band ho chuka hai (cluster tak pahunchna, status sacha dikhna — sab verified).
P1 iske aage ki cheez hai: **ek baar cluster ke andar ghus gaye, uske baad kya hota hai.**

P1 ke do buckets hain:
- **Bucket A** — auth/permission state cluster ke andar baithe rehte hue bhi khud-ba-khud update hoti hai ya nahi
- **Bucket B** — live data (Pods/Deployments/etc.) WebSocket se fresh rehta hai ya nahi, agar connection tootey to kya hota hai

---

## TABLE 1 — Bucket A vs Bucket B, overall status

| Bucket | Kya | Status | Priority |
|---|---|---|---|
| **A** — Inside-cluster auth auto-recovery | Design hi nahi bana abhi tak (koi code nahi likha gaya) | ⬜ NOT STARTED | High (security-relevant), par abhi shuru nahi kiya |
| **B** — Live watch/WebSocket data trustworthiness | Provenance + claims verify ho chuke; ab deep simulator testing chal rahi hai | 🔄 IN PROGRESS | Yahi abhi active hai |
| P1-3 — V2 API path (`fetch.ts`) error message | Chhota, kam-priority gap, P0 se bacha hua | ⬜ NOT STARTED | Low |

---

## TABLE 2 — Bucket B, PROVEN SO FAR (evidence-based, already closed)

| # | Kya prove hua | Kaise | Status |
|---|---|---|---|
| P1 | Poora Bucket B code humara apna hai, upstream ka nahi | B10-jaisi provenance check (real upstream diff) | ✅ Confirmed |
| P2 | p1.txt ke 6/6 daave code mein sahi nikle (reconnect, chip, BOOKMARK, ERROR, fallback, dedup) | Code-trace | ✅ Confirmed |
| P3 | 36 jagah live watch istemal hota hai, sab ek hi shared hook (`useKubeObjectList`) se | Code grep + live inventory | ✅ Confirmed |
| P4 | Workloads Overview page akela 9 resources ek saath watch karta hai | Live browser Part A | ✅ Confirmed |
| P5 | Close event par reconnect 1s→2s→4s backoff se hota hai | Simulator Test 1 | ✅ Confirmed |
| P6 | Silent death (no close event) par khud-ba-khud reconnect nahi hota (expected, bug nahi) | Simulator Test 2 | ✅ Confirmed |
| P7 | 90-second fallback safety-net ka mechanism REAL `useKubeObjectList` hook se sahi taar se juda hai | Simulator Test 3 (abhi fix ho raha hai — 2 bugs mile) | 🟡 Almost, 2 chhoti khaamiyan theek karni hain |
| P8 | Socket mount hote hi turant (same tick) banta hai; same-resource re-render par naya socket nahi banta; navigation par purana pehle band hokar naya khulta hai | Simulator Test 4 | ✅ Confirmed |

---

## TABLE 3 — Bucket B, ABHI TAK NAHI HUA (poori checklist, ek-ek karke)

| Part | # | Kya check karna hai | Kyun zaroori hai |
|---|---|---|---|
| **1. Lifecycle** | 1.2 | Navigation par NAYA socket kitni jaldi banta hai (delay hai ya nahi) | Confirm karna ki page badalte hi turant watch shuru hota hai |
| | 1.5 | Multi-watch page (9 resources) — kya har ek ka apna independent socket hai, legacy path mein koi sharing to nahi | Overload/resource-leak check |
| | 1.6 | Poora unmount hone par socket + interval/timeout dono clear hote hain ya nahi | Memory leak check |
| **2. Messages** | 2.1 | ADDED event — naya item cache mein sahi add hota hai | Basic data correctness |
| | 2.2 | MODIFIED event — item update hota hai, duplicate nahi banta | Basic data correctness |
| | 2.3 | DELETED event — item cache se hat jaata hai | Basic data correctness |
| | 2.4 | BOOKMARK — sirf resourceVersion badhta hai, list nahi badalti, koi warning nahi | Noise-free confirm |
| | 2.5 | ERROR frame — list corrupt nahi hoti, invalidateQueries chalta hai | Real-user safety |
| | 2.6 | Anjaan/malformed event type — silently ignore hota hai ya crash | Robustness |
| | 2.7 | Malformed JSON message — crash hota hai ya gracefully handle hota hai | Robustness |
| **3. Reconnect deep-dive** | 3.1 | 30s cap ke baad bhi wahi 30s par ruka rehta hai, aage nahi badhta | Cap-hold verify |
| | 3.2 | Successful reconnect ke baad agar wahi socket fir se toote, backoff wapas 1s se shuru hota hai ya jahan chhoda tha wahin se | Reset logic |
| | 3.3 | `WATCH_RECONNECT=false` par koi bhi reconnect attempt nahi hota | Flag-respect check |
| | 3.4 | Agar listener hata diya jaaye (navigate away) EXACTLY jab reconnect schedule ho chuka ho, kya wo "zombie" reconnect phir bhi chalta hai | Resource-leak, real-user concern |
| | 3.5 | Socket baar-baar khulta-bandh hota (flapping) to backoff sahi badhta hai ya kahin reset ho jaata hai galti se | Edge-case robustness |
| **4. Fallback deep-dive** | 4.1 | `WATCH_FALLBACK_REFETCH_MS=0` par fallback kabhi nahi chalta | Disabled-case verify |
| | 4.2 | Paginated list (continue token) par fallback disable hota hai (already claimed, verify karna hai) | User ka page-position bachana |
| | 4.3 | Pehle 90s ke baad bhi agar socket mara hi raha, kya 180s, 270s par phir chalta hai (repeat) ya sirf ek baar chalta hai | Long-term staleness |
| | 4.4 | Agar reconnect 90s se pehle hi ho jaaye, kya fallback timer cancel hota hai ya bekaar mein bhi chal jaata hai | Duplicate-fetch check |
| **5. Freshness chip — SABSE ZAROORI** | 5.1 | `useAnyWatchReconnecting()` aur `watchStates` map — kaunsi jagah se ye state likhi jaati hai, poori list | Foundation samajhna |
| | 5.2 | **Silent death mein chip kabhi 'reconnecting' set hoti hai ya nahi — yahi asli sawaal hai jiske liye ye poora P1 shuru hua tha** | User ko pata chalta hai ya nahi |
| | 5.3 | Successful reconnect ke baad chip wapas 'live' ho jaati hai ya nahi | Recovery confirm |
| **6. Multiplexer** | 6.1 | Multiplexer path mein reconnect/BOOKMARK/ERROR/fallback mein se kuch hai ya sab genuinely gayab hai | Completeness, low priority (off by default) |

**Total: 20 items abhi baaki hain (Table 2 ke 8 already-proven items ko chhodkar).**

---

## SAFETY — humesha yaad rakhna

- `watch-test` naam ka ek **alag, independent test cluster** bana hua hai — sirf isi par kaam karna hai
- **Real/production `default` cluster ko kabhi nahi chhoona** — na dekhna, na uspar koi command chalana
- ConfigMap sabse halka object hai testing ke liye — koi scheduling, koi workload impact nahi
- Har `oc create`/`delete` command **user khud** terminal mein chalayega — Claude sirf browser/code observe karega

---

# COPY-PASTE PROMPT — apne Claude ko ye poora bhejiye

> **CONTEXT — read fully before starting:**
>
> We are working on P1 Bucket B (WebSocket watch/reconnect trustworthiness) for a Headlamp fork (NetOps2/GT_D_V1). Bucket B's code is 100% ours (confirmed via upstream diff — not inherited from upstream Headlamp). We already have a simulator test file with 4 passing tests covering: (1) close-driven reconnect backoff timing, (2) silent death producing zero reconnects, (3) a 90-second HTTP fallback safety-net wired to the real `useKubeObjectList` hook (currently being fixed — see below), (4) socket lifecycle timing on mount/re-render/navigation.
>
> **A SEPARATE, INDEPENDENT test cluster named `watch-test` exists specifically for this work — it is completely isolated from any real/production cluster. ONLY ever interact with `watch-test`. Never touch, query, or reference the real `default` cluster in any test. I (the user) will run every `oc create`/`oc delete` command myself in the terminal — you only observe code, simulator output, or the browser.**
>
> ---
>
> **STANDING RULES for everything below:**
> - Never guess a cause. If something can't be verified, say "not observed" explicitly.
> - Every claim must be backed by a REAL, passing test that uses the ACTUAL production code (`webSocket.ts`, `useKubeObjectList.ts`, `resilience.ts`) — never a hand-written substitute pretending to be the real logic. If you can't reach the real code path in a given test, say so plainly instead of faking it.
> - Do not modify any production code unless explicitly asked to fix a confirmed bug — this phase is testing/verification only.
> - Add all new tests to the SAME existing simulator file. Do not create parallel/duplicate test files.
> - After every batch, run the ENTIRE simulator file (not just the new tests) and confirm no previously-passing test broke.
> - Report exact pass/fail counts and full console output for every test — not a summary, the raw numbers.
>
> ---
>
> **STEP 0 — First, fix the two known bugs in the existing Test 3 ("triggers safety-net HTTP refetch after silent death"):**
>
> 1. The final `console.log` references `safetyInterval`, which is not defined in the current version of this test — this will throw a ReferenceError. Fix this (remove the reference or replace it with the already-captured `intervalMs` value).
> 2. Currently the socket is only `.open()`-ed and then left alone — confirm explicitly whether this correctly represents "silent death" (no event ever fires, by definition), or whether `SimulatorWebSocket` needs an explicit `.goSilent()` method that marks it dead without firing any event, to clearly distinguish "healthy and idle" from "silently dead." If you add this method, use it in Test 3 between opening and advancing time.
>
> Run just this test after fixing, report raw pass/fail and console output, confirm via `git diff` that only the test file changed.
>
> **STOP after Step 0 and report. Do not proceed to Step 1 until this is confirmed clean.**
>
> ---
>
> **STEP 1 — Then work through this checklist, ONE BATCH AT A TIME, stopping after each batch for review:**
>
> **BATCH A — Socket lifecycle gaps (items 1.2, 1.5, 1.6):**
> - 1.2: Measure and report exact delay (in simulated ms) between a navigation event and the new socket's construction.
> - 1.5: For a simulated multi-resource page (e.g. 2-3 different resource types mounted together), confirm each gets its own independent socket instance in the legacy (non-multiplexer) path — quote the real code that proves this.
> - 1.6: Simulate a full unmount and confirm BOTH the socket's close() AND any pending reconnect timer/fallback interval are cleared — quote the real cleanup code and prove it via the simulator (e.g., advance time after unmount and confirm no further activity occurs).
>
> **BATCH B — Message handling (items 2.1–2.7):**
> For each of ADDED, MODIFIED, DELETED, BOOKMARK, ERROR, an unknown/malformed event type, and malformed JSON: feed a real fake message through the real socket's `message` handler (using the real code path, not a hand-simulated cache update) and report the actual resulting state of the React Query cache (or lack of crash, for the malformed cases).
>
> **BATCH C — Reconnect deep-dive (items 3.1–3.5):**
> - 3.1: Simulate 6-8 consecutive closes, confirm the interval caps at `WATCH_RECONNECT_CAP_MS` and stays there (does not keep doubling).
> - 3.2: After a successful reconnect, close that new socket too — does backoff restart from base, or continue from the capped/previous value? Quote the real reset logic.
> - 3.3: Temporarily simulate `WATCH_RECONNECT` as false (if this is testable without modifying production code — check how the constant is imported) and confirm zero reconnect attempts after a close.
> - 3.4: Close a socket, let reconnect get scheduled, then simulate removing all listeners BEFORE the scheduled reconnect fires — does the reconnect still happen (a leak) or does it correctly get cancelled? Quote the exact "remaining listeners" check.
> - 3.5: Simulate 5 rapid open/close cycles within a short window and report the full sequence of computed backoff intervals — confirm they increase correctly each time with no unexpected reset.
>
> **BATCH D — Fallback deep-dive (items 4.1–4.4):**
> - 4.1: Confirm via the real `watchFallbackRefetchInterval` (or equivalent) function that a `0` value disables the fallback entirely — quote the exact guard.
> - 4.2: Simulate a query result WITH a pagination `continue` token present, confirm the real function returns false/disabled. Then simulate WITHOUT one and confirm it returns the real interval. Report both actual values.
> - 4.3: After the first fallback fetch at 90s, if the socket is STILL silently dead, advance time further and confirm whether a SECOND fallback fetch fires at 180s (repeating) or not.
> - 4.4: Simulate a successful reconnect happening BEFORE the 90s fallback would fire — does the fallback timer get cancelled, or does a redundant fetch still occur anyway? Quote the real interaction code.
>
> **BATCH E — Freshness chip (items 5.1–5.3) — THIS IS THE MOST IMPORTANT BATCH:**
> - 5.1: Quote the complete real `useAnyWatchReconnecting()` hook and the `watchStates` map. List every single place in the real code that writes to this state.
> - 5.2: **This is the critical question the whole investigation is really about.** Using the simulator, after a socket goes silently dead (Step 0's fixed method), check the actual value of `watchStates` for that connection. Does it ever become 'reconnecting', or does it stay 'live' (or whatever the healthy value is) the entire time, since no close event ever fired to trigger any state change? Report the raw state value at 0s, 30s, 60s, and 90s+ after the silent death. **Do not conclude anything — just report the raw state values with evidence, quoting the exact code path (or absence of one) responsible.**
> - 5.3: After a successful reconnect (following a real close+reconnect, not silent death), confirm via the simulator that `watchStates` correctly returns to 'live'.
>
> **BATCH F — Multiplexer (item 6.1) — low priority, do last:**
> - Confirm explicitly, with file/line evidence: does the multiplexer path (`multiplexer.ts`) have ANY equivalent of reconnect, BOOKMARK handling, ERROR handling, or fallback refetch? Since it's off by default (`REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER=false`), this is low priority — just document what exists vs. what's genuinely absent.
>
> ---
>
> **After EVERY batch:** report a clean summary table — item number, one-line finding, evidence (file:line or test name), pass/fail. Do not move to the next batch until I've reviewed the current one.
>
> **Once ALL of Batches A–F are done and the full simulator file passes cleanly, STOP and report a final summary. Do NOT proceed to any live browser or `watch-test` cluster interaction without my explicit go-ahead — that will be a separate, later phase once the simulator is fully complete and trustworthy.**

---

## Ye prompt kyun sahi tarike se likha gaya hai

- **Step 0 pehle** — purani do galtiyan theek kiye bina aage badhna galat hota, isliye pehle wahi
- **Batch-by-batch** — 20 items ek saath dene se agent overwhelmed ho sakta hai ya galtiyan chhod sakta hai; ek-ek batch se rigor bana rehta hai
- **Batch E sabse important** — explicitly likha hai ki yahi poore P1 Bucket B ka asli maksad hai
- **`watch-test` cluster ka zikr** — safety rule crystal clear hai, real cluster kabhi nahi chhuna
- **Har jagah "quote the real code"** — koi bhi fake/hand-written substitute allow nahi, jaisa humne pehle Test 3 mein pakda tha
