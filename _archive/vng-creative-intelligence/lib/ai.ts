// Central model config. AI SDK (v5, the verified baseline) accepts a plain "provider/model" string and
// routes it through the Vercel AI Gateway when AI_GATEWAY_API_KEY (or Vercel
// OIDC) is present — no provider SDK import needed.
//
// To use a provider directly instead, install @ai-sdk/anthropic (or
// @ai-sdk/openrouter) and replace these strings with e.g. anthropic("claude-opus-4-8").

/** Reasoning / orchestration brain. */
export const AGENT_MODEL = "anthropic/claude-opus-4-8";

/** Cheap, high-volume classification / rationale generation. */
export const CHEAP_MODEL = "anthropic/claude-haiku-4-5";
