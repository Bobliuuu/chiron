# Running Chiron on a local model

Chiron can run its agent orchestrator against a **local GGUF model** instead of
the hosted OpenAI API — useful for offline dev, privacy, or avoiding API costs.
The reference model is **`Qwen3.5-9B-Q4_K_M.gguf`** (a 4-bit quantized Qwen,
~5–6 GB, good tool-calling for its size).

The integration is provider-agnostic: any server that exposes an
**OpenAI-compatible `/v1/chat/completions` endpoint with tool calling** works.
Chiron just points its OpenAI SDK client at that endpoint.

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

2. Build/install llama.cpp, then start the server with tool-calling enabled.
   `--jinja` is required for OpenAI-style tool calls:

   ```bash
   llama-server \
     -m ./models/Qwen3.5-9B-Q4_K_M.gguf \
     --jinja \
     --host 0.0.0.0 --port 8080 \
     -c 8192
   ```

   A convenience wrapper is provided: `./scripts/serve-local-model.sh`.

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
