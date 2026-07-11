# Models

<sup>English · [中文](MODELS.zh-CN.md)</sup>

Four independent model slots (see [Configuration](CONFIGURATION.md#model-slots) for the env vars). This doc covers which models to put in which slot.

## Cloud preset (OpenAI API)

One direct OpenAI preset ships in `.env.example`. Copy it and put the same
OpenAI API key (`sk-...`) in the listed key slots.

Each slot controls a different quality axis:

| Slot | Controls | Key finding |
|---|---|---|
| **Default** | Persona richness, sim density | `gpt-5.4-mini` keeps bulk setup work fast |
| **Smart** | Report quality (#1 lever) | `gpt-5.4` is the quality slot for reports, ontology, and graph reasoning |
| **NER** | Extraction reliability | `gpt-5.4-mini` handles deterministic JSON extraction |
| **Wonderwall** | Cost (biggest consumer) | `gpt-5.4-nano` keeps the 850+ call sim loop around ~$1-2/run |

### Cloud mode — ~$1-2/run, ~10 min

Direct OpenAI uses `gpt-5.4-mini` for default/NER, `gpt-5.4` for Smart, and
`gpt-5.4-nano` for the Wonderwall sim loop.

| Slot | Model | Notes |
|---|---|---|
| Default | `gpt-5.4-mini` | Persona generation, sim config, memory compaction |
| Smart | `gpt-5.4` | Report ReACT loop — only ~19 calls/run |
| NER | `gpt-5.4-mini` | Stable JSON extraction |
| Wonderwall | `gpt-5.4-nano` | 850+ agent-action calls/run; keeps the sim loop around ~$1-2/run |

Embeddings use `text-embedding-3-large` (truncated to 768 dims via Matryoshka).
`WEB_SEARCH_MODEL` is blank by default; web enrichment skips model-only browsing
unless SearXNG is configured. OpenRouter `:online` models remain available as
per-slot overrides.

> **Provider note** — per-slot OpenRouter and self-hosted overrides still work.
> `LLM_DISABLE_REASONING=true` only injects OpenRouter's
> `reasoning: {enabled: false}` body when the effective slot base URL contains
> `openrouter`; direct OpenAI calls do not receive that provider-specific field.

### Custom endpoint for Wonderwall

The Wonderwall slot accepts a per-slot endpoint override so you can run a self-hosted or fine-tuned model alongside the Default/Smart/NER slots:

```bash
WONDERWALL_BASE_URL=https://your-endpoint.example.com/v1
WONDERWALL_API_KEY=not-checked          # any string for open endpoints
WONDERWALL_MODEL_NAME=your-model-id
```

Either field can be omitted — a blank `WONDERWALL_BASE_URL` reuses `LLM_BASE_URL`, a blank `WONDERWALL_API_KEY` reuses `LLM_API_KEY`. Useful for routing the 850+ agent-action calls per run to a vLLM / Modal / Ollama-on-a-server deployment while keeping the report and graph-build slots on OpenAI, OpenRouter, or another hosted provider.

## Local mode (Ollama)

> **Context override required.** Ollama defaults to 4096 tokens, but MiroShark prompts need 10–30k. Create a custom Modelfile:
>
> ```bash
> printf 'FROM qwen3:14b\nPARAMETER num_ctx 32768' > Modelfile
> ollama create mirosharkai -f Modelfile
> ```

| Model | VRAM | Speed | Notes |
|---|---|---|---|
| `qwen2.5:32b` | 20GB+ | ~40 t/s | Default in `.env.example` — solid all-rounder |
| `qwen3:30b-a3b` *(MoE)* | 18GB | ~110 t/s | Fastest — MoE activates only 3B params per token |
| `qwen3:14b` | 12GB | ~60 t/s | Good balance for mid-range GPUs |
| `qwen3:8b` | 8GB | ~42 t/s | Minimum viable; drop Wonderwall rounds if context is tight |

### Hardware quick-pick

| Setup | Model |
|---|---|
| RTX 3090/4090 or M2 Pro 32GB+ | `qwen2.5:32b` |
| RTX 4080 / M2 Pro 16GB | `qwen3:30b-a3b` |
| RTX 4070 / M1 Pro | `qwen3:14b` |
| 8GB VRAM / laptop | `qwen3:8b` |

**Embeddings locally:** `ollama pull nomic-embed-text` — 768 dimensions, matches the Neo4j default.

## Hybrid mode

Most users land here naturally: run local for the high-volume simulation rounds, route to Claude for reports.

```bash
LLM_MODEL_NAME=qwen2.5:32b
SMART_PROVIDER=claude-code
SMART_MODEL_NAME=claude-sonnet-4-20250514
```
