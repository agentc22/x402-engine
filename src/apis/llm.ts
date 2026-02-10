import { Router, type Request, type Response } from "express";
import { chatCompletion, createEmbedding } from "../providers/openrouter.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

const MODELS: Record<string, { model: string; serviceId: string }> = {
  haiku: { model: "anthropic/claude-3.5-haiku", serviceId: "llm-haiku" },
  sonnet: { model: "anthropic/claude-3.5-sonnet", serviceId: "llm-sonnet" },
  "gpt4o-mini": { model: "openai/gpt-4o-mini", serviceId: "llm-gpt4o-mini" },
  llama: { model: "meta-llama/llama-3.1-70b-instruct", serviceId: "llm-llama" },
};

function chatHandler(slug: string) {
  const { model, serviceId } = MODELS[slug];
  const endpoint = `/api/llm/${slug}`;

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

    const maxTokens = Math.min(Math.max(parseInt(max_tokens) || 1024, 1), 4096);

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
