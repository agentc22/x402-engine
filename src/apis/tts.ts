import { Router, type Request, type Response } from "express";
import {
  textToSpeech as openaiTTS,
  VALID_VOICES as OPENAI_VOICES,
  VALID_MODELS as OPENAI_MODELS,
  VALID_FORMATS as OPENAI_FORMATS,
  type OpenAIVoice,
  type OpenAITTSModel,
  type OpenAITTSFormat,
} from "../providers/openai-tts.js";
import {
  textToSpeech as elevenlabsTTS,
} from "../providers/elevenlabs.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

router.post("/api/tts/openai", async (req: Request, res: Response) => {
  const { text, voice, model, format } = req.body || {};

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Provide 'text' (string, required)" });
    return;
  }
  if (text.length > 4096) {
    res.status(400).json({ error: "Text exceeds 4096 character limit" });
    return;
  }

  if (voice && !(OPENAI_VOICES as readonly string[]).includes(voice)) {
    res.status(400).json({ error: `Invalid voice. Options: ${OPENAI_VOICES.join(", ")}` });
    return;
  }
  if (model && !(OPENAI_MODELS as readonly string[]).includes(model)) {
    res.status(400).json({ error: `Invalid model. Options: ${OPENAI_MODELS.join(", ")}` });
    return;
  }
  if (format && !(OPENAI_FORMATS as readonly string[]).includes(format)) {
    res.status(400).json({ error: `Invalid format. Options: ${OPENAI_FORMATS.join(", ")}` });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const result = await openaiTTS(
      text,
      (voice as OpenAIVoice) || undefined,
      (model as OpenAITTSModel) || undefined,
      (format as OpenAITTSFormat) || undefined,
    );
    upstreamStatus = 200;
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[tts-openai] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "tts-openai",
      endpoint: "/api/tts/openai",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.post("/api/tts/elevenlabs", async (req: Request, res: Response) => {
  const { text, voice_id, model_id, format } = req.body || {};

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Provide 'text' (string, required)" });
    return;
  }
  if (text.length > 5000) {
    res.status(400).json({ error: "Text exceeds 5000 character limit" });
    return;
  }

  if (voice_id && (typeof voice_id !== "string" || voice_id.length > 100)) {
    res.status(400).json({ error: "Invalid voice_id" });
    return;
  }
  if (model_id && (typeof model_id !== "string" || model_id.length > 100)) {
    res.status(400).json({ error: "Invalid model_id" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const result = await elevenlabsTTS(text, voice_id, model_id, format);
    upstreamStatus = 200;
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[tts-elevenlabs] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "tts-elevenlabs",
      endpoint: "/api/tts/elevenlabs",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
