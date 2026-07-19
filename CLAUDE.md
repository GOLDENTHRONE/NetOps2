# NetOps2 — Claude instructions

## graphify (knowledge graph — use it first)

This project maintains a Graphify knowledge graph at `graphify-out/` (god nodes, community structure, cross-file relationships). It is built automatically at session start by `.claude/hooks/session-start.sh` and exists to save tokens: query the graph instead of re-reading or grepping source files from scratch.

Token-optimization workflow:
1. **Use the Graphify report/graph first.** Before opening source files to answer a codebase question, run `graphify query "<question>"` — it returns a scoped subgraph (default budget ~2000 tokens) that is far cheaper than reading files.
2. Only read the specific files/lines the query output cites (`source_location`), not whole directories.
3. `graphify-out/` is gitignored (graph.json is ~18 MB); if it is missing, run `graphify update .` once — it is deterministic, AST-only, and needs no API key.
4. The `/graphify` skill (`.claude/skills/graphify/SKILL.md`) handles full rebuilds and advanced flows.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
