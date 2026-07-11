#!/usr/bin/env bash
# Start a local OpenAI-compatible server for Chiron using llama.cpp.
#
# Requires `llama-server` on PATH (from llama.cpp) and the model file.
# Usage:
#   ./scripts/serve-local-model.sh [path-to-gguf] [port]
#
# Then set in .env.local:
#   LLM_PROVIDER=local
#   LOCAL_LLM_ENABLED=true
#   LOCAL_LLM_BASE_URL=http://localhost:<port>/v1

set -euo pipefail

MODEL="${1:-./models/Qwen3.5-9B-Q4_K_M.gguf}"
PORT="${2:-8080}"
CTX="${LLAMA_CTX:-8192}"

if ! command -v llama-server >/dev/null 2>&1; then
  echo "error: 'llama-server' not found on PATH. Install llama.cpp first." >&2
  echo "  https://github.com/ggml-org/llama.cpp" >&2
  exit 1
fi

if [[ ! -f "$MODEL" ]]; then
  echo "error: model file not found: $MODEL" >&2
  echo "Download Qwen3.5-9B-Q4_K_M.gguf into ./models (see docs/local-model.md)." >&2
  exit 1
fi

echo "Serving $MODEL on http://localhost:${PORT}/v1 (ctx=${CTX}) ..."
exec llama-server \
  -m "$MODEL" \
  --jinja \
  --host 0.0.0.0 \
  --port "$PORT" \
  -c "$CTX"
