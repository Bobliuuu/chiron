#!/usr/bin/env bash
# Start a local OpenAI-compatible server for Chiron using llama.cpp's
# llama-server, so LLM_PROVIDER=local works with no OpenAI key.
#
# Usage:
#   ./scripts/serve-local-model.sh [path-to-gguf] [port]
#
# It finds llama-server on PATH, or via $LLAMA_SERVER_BIN, or in the default
# build dir used by scripts/setup-llama.sh (~/src/llama.cpp/build/bin).
#
# Then set in .env.local:
#   LLM_PROVIDER=local
#   LOCAL_LLM_ENABLED=true
#   LOCAL_LLM_BASE_URL=http://localhost:<port>/v1
#   LOCAL_LLM_MODEL=<basename of the gguf>

set -euo pipefail

MODEL="${1:-./models/Qwen3-8B-Q4_K_M.gguf}"
PORT="${2:-8080}"
CTX="${LLAMA_CTX:-8192}"
NGL="${LLAMA_NGL:-99}"   # layers offloaded to GPU (99 = all; ignored on CPU builds)

# Locate the llama-server binary.
if [[ -n "${LLAMA_SERVER_BIN:-}" && -x "${LLAMA_SERVER_BIN}" ]]; then
  BIN="$LLAMA_SERVER_BIN"
elif command -v llama-server >/dev/null 2>&1; then
  BIN="$(command -v llama-server)"
elif [[ -x "$HOME/src/llama.cpp/build/bin/llama-server" ]]; then
  BIN="$HOME/src/llama.cpp/build/bin/llama-server"
else
  echo "error: llama-server not found. Run scripts/setup-llama.sh first," >&2
  echo "       or set LLAMA_SERVER_BIN to the binary path." >&2
  exit 1
fi

if [[ ! -f "$MODEL" ]]; then
  echo "error: model file not found: $MODEL" >&2
  echo "Run scripts/setup-llama.sh to download it (see docs/local-model.md)." >&2
  exit 1
fi

echo "Serving $MODEL"
echo "  via $BIN"
echo "  on  http://localhost:${PORT}/v1  (ctx=${CTX}, gpu-layers=${NGL})"
exec "$BIN" \
  -m "$MODEL" \
  --jinja \
  --host 0.0.0.0 \
  --port "$PORT" \
  -c "$CTX" \
  -ngl "$NGL"
