import { Router, type Request, type Response } from "express";
import { transcribe } from "../providers/deepgram.js";
import { logRequest } from "../db/ledger.js";
import { isPublicUrl } from "../lib/validation.js";

const router = Router();

router.post("/api/transcribe", async (req: Request, res: Response) => {
  const {
    audio_url,
    audio_base64,
    audio_mimetype,
    language,
    diarize,
    punctuate,
    model,
  } = req.body || {};

  if (!audio_url && !audio_base64) {
    res.status(400).json({ error: "Either audio_url or audio_base64 is required" });
    return;
  }

  // SSRF protection on audio_url
  if (audio_url) {
    const urlCheck = isPublicUrl(audio_url);
    if (!urlCheck.valid) {
      res.status(400).json({ error: urlCheck.reason });
      return;
    }
  }

  if (audio_base64 && !audio_mimetype) {
    res.status(400).json({ error: "audio_mimetype required when using audio_base64 (e.g. 'audio/mp3')" });
    return;
  }
  if (audio_base64 && audio_base64.length > 50 * 1024 * 1024) {
    res.status(400).json({ error: "Audio file too large (max 50MB base64)" });
    return;
  }
  if (model && !["nova-3", "whisper-large"].includes(model)) {
    res.status(400).json({ error: "model must be nova-3 or whisper-large" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const result = await transcribe({
      audio_url,
      audio_base64,
      audio_mimetype,
      language,
      diarize,
      punctuate,
      model,
    });
    upstreamStatus = 200;

    res.json({
      service: "transcribe",
      data: result,
    });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    const status = err.status === 502 ? 502 : 500;
    res.status(status).json({ error: "Transcription failed" });
  } finally {
    logRequest({
      service: "transcribe",
      endpoint: "/api/transcribe",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
