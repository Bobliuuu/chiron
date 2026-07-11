# Running Chiron on a local model (llama.cpp)

Chiron can run its agent orchestrator against a **local GGUF model** served by
**[llama.cpp](https://github.com/ggml-org/llama.cpp)** instead of the hosted
OpenAI API — useful for offline dev, privacy, or avoiding API costs.

The reference model is **`Qwen3-8B-Q4_K_M.gguf`** (4-bit quantized Qwen3-8B,
~4.7 GB, strong tool-calling for its size), from the official
[`Qwen/Qwen3-8B-GGUF`](https://huggingface.co/Qwen/Qwen3-8B-GGUF) repo.

> Note: the original spec mentioned `Qwen3.5-9B-Q4_K_M.gguf`, but Qwen has no
> "3.5" line or 9B size. `Qwen3-8B-Q4_K_M` is the closest real release. To use a
> different GGUF, just set `LOCAL_LLM_MODEL` (and download that file).

The integration is provider-agnostic: llama.cpp's `llama-server` exposes an
**OpenAI-compatible `/v1/chat/completions` endpoint with tool calling**, so
Chiron simply points its OpenAI SDK client at it. Ollama / LM Studio work too.

## Quick setup (one command)

```bash
./scripts/setup-llama.sh
```

This clones and builds llama.cpp (auto-detecting CUDA for a GPU build, else
CPU-only) and downloads the model into `./models/`. It's idempotent. Then:

```bash
./scripts/serve-local-model.sh                 # serves ./models/Qwen3-8B-Q4_K_M.gguf on :8080
```

and set `.env.local`:

```bash
LLM_PROVIDER=local
LOCAL_LLM_ENABLED=true
LOCAL_LLM_BASE_URL=http://localhost:8080/v1
LOCAL_LLM_MODEL=Qwen3-8B-Q4_K_M.gguf
```

The rest of this doc explains the manual steps `setup-llama.sh` automates.

## Provider order

The effective provider is chosen by `LLM_PROVIDER` (default `auto`):

```
auto:  OPENAI_API_KEY set?  → openai
       else LOCAL_LLM_ENABLED=true?  → local
       else  → mock (rule-based planner, no model)
```

You can also force a provider: `LLM_PROVIDER=local`.

If a live model call fails at runtime (server down, bad response), the
orchestrator **automatically falls back to the mock planner** so the app never
hard-fails.

## Option A — llama.cpp (`llama-server`)

1. Get the model (e.g. from Hugging Face):

   ```bash
   mkdir -p models
   # Download Qwen3.5-9B-Q4_K_M.gguf into ./models
   # huggingface-cli download <repo> Qwen3.5-9B-Q4_K_M.gguf --local-dir ./models
   ```

2. Build llama.cpp. For an NVIDIA GPU (e.g. A100), build with CUDA:

   ```bash
   git clone --depth 1 https://github.com/ggml-org/llama.cpp.git ~/src/llama.cpp
   cmake -S ~/src/llama.cpp -B ~/src/llama.cpp/build \
     -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF \
     -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=80   # 80 = A100; omit CUDA flags for CPU-only
   cmake --build ~/src/llama.cpp/build --target llama-server llama-cli -j"$(nproc)"
   ```

   Then start the server with tool-calling enabled (`--jinja` is required for
   OpenAI-style tool calls; `-ngl 99` offloads all layers to the GPU):

   ```bash
   ~/src/llama.cpp/build/bin/llama-server \
     -m ./models/Qwen3-8B-Q4_K_M.gguf \
     --jinja --host 0.0.0.0 --port 8080 -c 8192 -ngl 99
   ```

   A convenience wrapper is provided (it auto-locates the binary):
   `./scripts/serve-local-model.sh`.

3. Point Chiron at it in `.env.local`:

   ```bash
   LLM_PROVIDER=local          # or leave as auto with no OPENAI_API_KEY
   LOCAL_LLM_ENABLED=true
   LOCAL_LLM_BASE_URL=http://localhost:8080/v1
   LOCAL_LLM_MODEL=Qwen3.5-9B-Q4_K_M.gguf
   ```

## Option B — Ollama

```bash
ollama serve
# Register the GGUF once via a Modelfile, then:
```

`.env.local`:

```bash
LLM_PROVIDER=local
LOCAL_LLM_ENABLED=true
LOCAL_LLM_BASE_URL=http://localhost:11434/v1
LOCAL_LLM_MODEL=qwen3.5:9b       # the name you gave it in Ollama
```

## Notes on tool calling

- Local models are less reliable at structured tool calls than frontier models.
  Chiron mitigates this: bounded tool rounds, defensive JSON parsing of tool
  arguments, and automatic fallback to the rule-based planner on any error.
- If your local model rarely emits tool calls, prefer a build/template with
  strong function-calling support (Qwen2.5/Qwen3 instruct variants + `--jinja`).
- Larger context (`-c`) helps when many events are returned to the model.
