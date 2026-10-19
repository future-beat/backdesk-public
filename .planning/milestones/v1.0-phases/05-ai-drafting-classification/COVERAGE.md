# API Coverage — Anthropic Claude API

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Surface enumerated from the bundled claude-api skill + `@anthropic-ai/sdk` 0.122.0 (05-RESEARCH.md, verified 2026-08-30).

| capability | decision | reason |
|---|---|---|
| `messages.parse` structured outputs (`output_config.format`) | INTEGRATE | |
| `claude-sonnet-5` (drafting model) | INTEGRATE | |
| `claude-opus-5` (classification model) | INTEGRATE | user decision 2026-08-31 (superseded haiku-4-5, then sonnet-5) |
| System prompts (structured system blocks) | INTEGRATE | |
| Prompt caching (`cache_control: ephemeral` on drafting voice block) | INTEGRATE | |
| Sampling params on classification calls | OPT-OUT | `claude-opus-5` rejects temperature/top_p/top_k with a 400 — none sent |
| Typed error classes (`RateLimitError`, `APIError`, etc.) | INTEGRATE | |
| SDK `timeout` (ms) + `maxRetries: 2` transport controls | INTEGRATE | |
| `usage` counters (`cache_read_input_tokens`, input/output tokens) | INTEGRATE | |
| `stop_reason` inspection (`refusal`, `max_tokens`) | INTEGRATE | |
| Raw `messages.create` (free-form text, no output schema) | OPT-OUT | free-text LLM parsing is on the project's What-NOT-to-Use list; every call is schema-constrained through `parse` |
| Tool use (`tools` parameter, tool runner, `betaZodTool`) | OPT-OUT | explicitly out of scope — AI-03 requires classification be schema-only with NO tools; absence of the `tools` key is the safety property |
| Prompt caching on classification calls | OPT-OUT | not needed — classification prompts are far below the cacheable-prefix minimum |
| Streaming (`messages.stream`) | OPT-OUT | not needed — short completions (≤400 tokens) inside a per-minute tick; buffered parse is simpler and schema-safe |
| Message Batches API | OPT-OUT | not needed — drafts must land within the tick with review lead time; volume (~25/tick cap) is trivial; sequential per-tenant calls already exploit cache |
| Token counting endpoint (`messages.count_tokens`) | OPT-OUT | not needed — usage read from responses; no pre-flight budgeting at this volume |
| Extended thinking (`thinking` parameter) | OPT-OUT | not needed — parameter omitted on both models; opus-5's default adaptive thinking fits inside the classification token cap (proven live) |
| Sampling params on Sonnet 5 (`temperature`/`top_p`/`top_k`) | OPT-OUT | removed by the API on `claude-sonnet-5` — sending them is a 400 (research Pitfall 1) |
| Assistant prefill | OPT-OUT | removed on current models — designing around it is a 400 |
| `claude-opus-5` QA escalation for drafting | OPT-OUT | not needed yet — drafting stays on sonnet-5; opus-5 now serves classification instead |
| Files / PDFs / citations / vision inputs | OPT-OUT | not needed — inputs are short text (quote facts, SMS bodies) |
| Computer use / MCP connector / web search tool | OPT-OUT | explicitly out of scope — no agentic surface in this phase; AI-03 least-privilege |
