#!/usr/bin/env bash
# One-shot setup for Chiron's local LLM backend: build llama.cpp and download
# the Qwen GGUF used by the local provider.
#
# Auto-detects CUDA and builds with GPU acceleration when available, otherwise
# a CPU build. Idempotent: re-running skips work that's already done.
#
# Usage:  ./scripts/setup-llama.sh
#
# Env overrides:
#   LLAMA_DIR    (default ~/src/llama.cpp)   where to clone/build llama.cpp
#   MODELS_DIR   (default ./models)          where to put the GGUF
#   MODEL_FILE   (default Qwen3-8B-Q4_K_M.gguf)
#   MODEL_REPO   (default Qwen/Qwen3-8B-GGUF)
#   CUDA_ARCH    (default autodetect, e.g. 80 for A100)

set -euo pipefail

LLAMA_DIR="${LLAMA_DIR:-$HOME/src/llama.cpp}"
MODELS_DIR="${MODELS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/models}"
MODEL_FILE="${MODEL_FILE:-Qwen3-8B-Q4_K_M.gguf}"
MODEL_REPO="${MODEL_REPO:-Qwen/Qwen3-8B-GGUF}"

echo "==> llama.cpp: $LLAMA_DIR"
echo "==> model:     $MODELS_DIR/$MODEL_FILE (from $MODEL_REPO)"

# --- 1. clone -------------------------------------------------------------
if [[ ! -d "$LLAMA_DIR/.git" ]]; then
  mkdir -p "$(dirname "$LLAMA_DIR")"
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
else
  echo "==> llama.cpp already cloned, skipping."
fi

# --- 2. build -------------------------------------------------------------
CUDA_FLAGS=()
if command -v nvcc >/dev/null 2>&1; then
  ARCH="${CUDA_ARCH:-}"
  if [[ -z "$ARCH" ]] && command -v nvidia-smi >/dev/null 2>&1; then
    # e.g. "8.0" -> "80"
    ARCH="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -1 | tr -d '.')"
  fi
  ARCH="${ARCH:-80}"
  echo "==> CUDA detected — building with GPU support (arch $ARCH)."
  CUDA_FLAGS=(-DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="$ARCH")
else
  echo "==> No CUDA — building CPU-only."
fi

if [[ ! -x "$LLAMA_DIR/build/bin/llama-server" ]]; then
  cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLAMA_CURL=OFF \
    "${CUDA_FLAGS[@]}"
  cmake --build "$LLAMA_DIR/build" --config Release \
    --target llama-server llama-cli -j "$(nproc)"
else
  echo "==> llama-server already built, skipping."
fi

# --- 3. download model ----------------------------------------------------
mkdir -p "$MODELS_DIR"
if [[ ! -f "$MODELS_DIR/$MODEL_FILE" ]]; then
  echo "==> Downloading $MODEL_FILE ..."
  curl -L -C - --retry 5 --retry-delay 5 \
    -o "$MODELS_DIR/$MODEL_FILE" \
    "https://huggingface.co/$MODEL_REPO/resolve/main/$MODEL_FILE?download=true"
else
  echo "==> Model already present, skipping."
fi

echo
echo "Done. Start the server with:"
echo "  LLAMA_SERVER_BIN=$LLAMA_DIR/build/bin/llama-server \\"
echo "    ./scripts/serve-local-model.sh $MODELS_DIR/$MODEL_FILE 8080"
echo
echo "Then in .env.local:"
echo "  LLM_PROVIDER=local"
echo "  LOCAL_LLM_ENABLED=true"
echo "  LOCAL_LLM_BASE_URL=http://localhost:8080/v1"
echo "  LOCAL_LLM_MODEL=$MODEL_FILE"
