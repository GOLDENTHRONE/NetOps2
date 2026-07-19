#!/bin/bash
# SessionStart hook: build/refresh the Graphify knowledge graph so Claude can
# answer codebase questions from graphify-out/ instead of re-reading files.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# 1) Ensure the graphify CLI is available (package name is graphifyy, CLI is graphify).
if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy -q >/dev/null 2>&1 || true
  fi
fi
if ! command -v graphify >/dev/null 2>&1; then
  python3 -m pip install -q graphifyy 2>/dev/null \
    || python3 -m pip install -q graphifyy --break-system-packages 2>/dev/null \
    || true
fi

if ! command -v graphify >/dev/null 2>&1; then
  echo "graphify CLI unavailable; skipping knowledge-graph refresh" >&2
  exit 0
fi

# 2) Build or incrementally refresh the graph (AST-only, deterministic, no LLM/API key).
#    A stale rebuild lock from a killed session must not wedge every future session.
rm -f graphify-out/.rebuild.lock 2>/dev/null || true
if graphify update . >/tmp/graphify-session-start.log 2>&1; then
  echo "Graphify knowledge graph ready at graphify-out/ (query with: graphify query \"<question>\")"
else
  echo "graphify update failed (see /tmp/graphify-session-start.log); session continues without a fresh graph" >&2
fi

exit 0
