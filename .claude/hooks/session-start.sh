#!/bin/bash
# SessionStart hook: make the Graphify knowledge graph available in every
# Claude Code on the web session for this repo.
#
# It installs the graphify CLI (PyPI package "graphifyy"), registers its
# Claude skill, and builds the code-only knowledge graph into graphify-out/
# (gitignored). Code extraction is fully local (tree-sitter) and needs no API
# key. The container state is cached after the hook completes, so subsequent
# sessions start with the tool installed and the extraction cache warm.
set -euo pipefail

# Web sessions only; local checkouts are left untouched.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

# 1. Install the graphify CLI (idempotent: skip if already present).
if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy
  else
    pip3 install --user graphifyy
  fi
fi

# 2. Register the Claude skill (~/.claude/skills/graphify). Safe to re-run.
graphify install

# 3. Build/refresh the code-only knowledge graph. Incremental: unchanged
#    files come from the cache, so re-runs are fast.
cd "$CLAUDE_PROJECT_DIR"
graphify extract . --code-only

# 4. Make the CLI available on PATH for the rest of the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

echo "graphify ready: $(graphify --version 2>/dev/null); graph at graphify-out/graph.json"
