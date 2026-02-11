import { Router, type Request, type Response } from "express";
import { chatCompletion, createEmbedding } from "../providers/openrouter.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

interface ModelConfig {
  model: string;
  serviceId: string;
  reasoning?: boolean; // reasoning models need higher token limits (reasoning eats into max_tokens)
}

const MODELS: Record<string, ModelConfig> = {
  // OpenAI
  "gpt-4o": { model: "openai/gpt-4o", serviceId: "llm-gpt-4o" },
  "gpt-4o-mini": { model: "openai/gpt-4o-mini", serviceId: "llm-gpt-4o-mini" },
  "gpt-4.1": { model: "openai/gpt-4.1", serviceId: "llm-gpt-4.1" },
  "gpt-4.1-mini": { model: "openai/gpt-4.1-mini", serviceId: "llm-gpt-4.1-mini" },
  "gpt-5": { model: "openai/gpt-5", serviceId: "llm-gpt-5", reasoning: true },
  "gpt-5-mini": { model: "openai/gpt-5-mini", serviceId: "llm-gpt-5-mini", reasoning: true },
  "o3": { model: "openai/o3", serviceId: "llm-o3", reasoning: true },
  "o4-mini": { model: "openai/o4-mini", serviceId: "llm-o4-mini", reasoning: true },
  // Anthropic
  "claude-opus": { model: "anthropic/claude-opus-4.6", serviceId: "llm-claude-opus" },
  "claude-sonnet": { model: "anthropic/claude-sonnet-4.5", serviceId: "llm-claude-sonnet" },
  "claude-haiku": { model: "anthropic/claude-haiku-4.5", serviceId: "llm-claude-haiku" },
  // Google
  "gemini-pro": { model: "google/gemini-2.5-pro", serviceId: "llm-gemini-pro", reasoning: true },
  "gemini-flash": { model: "google/gemini-2.5-flash", serviceId: "llm-gemini-flash" },
  // DeepSeek
  "deepseek": { model: "deepseek/deepseek-chat", serviceId: "llm-deepseek" },
  "deepseek-r1": { model: "deepseek/deepseek-r1", serviceId: "llm-deepseek-r1", reasoning: true },
  // Meta
  "llama": { model: "meta-llama/llama-3.3-70b-instruct", serviceId: "llm-llama" },
  // xAI
  "grok": { model: "x-ai/grok-4", serviceId: "llm-grok" },
  // Qwen
  "qwen": { model: "qwen/qwen3-235b-a22b", serviceId: "llm-qwen", reasoning: true },
  // Mistral
  "mistral": { model: "mistralai/mistral-large-2512", serviceId: "llm-mistral" },
  // Perplexity (search-augmented)
  "perplexity": { model: "perplexity/sonar-pro", serviceId: "llm-perplexity" },
};

// Reasoning models burn tokens on chain-of-thought before generating content.
// On OpenRouter, reasoning tokens count against max_tokens, so we need higher
// defaults and caps to ensure non-empty output.
const TOKEN_DEFAULTS = { default: 1024, max: 4096 } as const;
const TOKEN_REASONING = { default: 4096, max: 16384 } as const;

function chatHandler(slug: string) {
  const { model, serviceId, reasoning } = MODELS[slug];
  const endpoint = `/api/llm/${slug}`;
  const limits = reasoning ? TOKEN_REASONING : TOKEN_DEFAULTS;

  return async (req: Request, res: Response) => {
    const { messages, max_tokens } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Provide 'messages' array with at least one message" });
      return;
    }

    for (const msg of messages) {
      if (!msg.role || !msg.content || typeof msg.content !== "string") {
        res.status(400).json({ error: "Each message must have 'role' and 'content' (string)" });
        return;
      }
      if (msg.content.length > 100_000) {
        res.status(400).json({ error: "Message content exceeds 100k character limit" });
        return;
      }
    }

    if (messages.length > 100) {
      res.status(400).json({ error: "Maximum 100 messages per request" });
      return;
    }

    const maxTokens = Math.min(Math.max(parseInt(max_tokens) || limits.default, 1), limits.max);

    const start = Date.now();
    let upstreamStatus = 0;

    try {
      const result = await chatCompletion(model, messages, maxTokens);
      upstreamStatus = 200;
      res.json(result);
    } catch (err: any) {
      upstreamStatus = err.status || 500;
      console.error(`[${serviceId}] upstream error: status=${upstreamStatus} message=${err.message}`);
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
    } finally {
      logRequest({
        service: serviceId,
        endpoint,
        payer: (req as any).x402?.payer,
        network: (req as any).x402?.network,
        amount: (req as any).x402?.amount,
        upstreamStatus,
        latencyMs: Date.now() - start,
      });
    }
  };
}

// Register all LLM chat endpoints
for (const slug of Object.keys(MODELS)) {
  router.post(`/api/llm/${slug}`, chatHandler(slug));
}

// Embeddings endpoint
router.post("/api/embeddings", async (req: Request, res: Response) => {
  const { text, texts } = req.body || {};

  let inputTexts: string[];
  if (texts && Array.isArray(texts)) {
    if (texts.length === 0 || texts.length > 100) {
      res.status(400).json({ error: "Provide 1-100 texts in 'texts' array" });
      return;
    }
    for (const t of texts) {
      if (typeof t !== "string" || t.length === 0 || t.length > 50_000) {
        res.status(400).json({ error: "Each text must be a non-empty string (max 50k chars)" });
        return;
      }
    }
    inputTexts = texts;
  } else if (text && typeof text === "string") {
    if (text.length === 0 || text.length > 50_000) {
      res.status(400).json({ error: "Text must be non-empty (max 50k chars)" });
      return;
    }
    inputTexts = [text];
  } else {
    res.status(400).json({ error: "Provide 'text' (string) or 'texts' (array of strings)" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const embeddings = await createEmbedding(inputTexts);
    upstreamStatus = 200;

    if (inputTexts.length === 1 && !texts) {
      res.json({ embedding: embeddings[0] });
    } else {
      res.json({ embeddings });
    }
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[embeddings] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "embeddings",
      endpoint: "/api/embeddings",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
