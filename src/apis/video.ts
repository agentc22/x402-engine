import { Router, type Request, type Response } from "express";
import { generateVideo } from "../providers/fal.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

interface VideoModelConfig {
  modelId: string;
  serviceId: string;
  supportsI2V?: boolean;       // image-to-video
  supportsDuration?: boolean;  // 5 or 10 sec
  supportsAspectRatio?: boolean;
}

const MODELS: Record<string, VideoModelConfig> = {
  fast: {
    modelId: "fal-ai/kling-video/v1.6/standard/text-to-video",
    serviceId: "video-fast",
    supportsDuration: true,
    supportsAspectRatio: true,
  },
  quality: {
    modelId: "fal-ai/kling-video/v2.6/pro/text-to-video",
    serviceId: "video-quality",
    supportsDuration: true,
    supportsAspectRatio: true,
  },
  hailuo: {
    modelId: "fal-ai/minimax/hailuo-02/pro/text-to-video",
    serviceId: "video-hailuo",
  },
  animate: {
    modelId: "fal-ai/kling-video/v2.6/pro/image-to-video",
    serviceId: "video-animate",
    supportsI2V: true,
    supportsDuration: true,
    supportsAspectRatio: true,
  },
};

const VALID_DURATIONS = ["5", "10"];
const VALID_ASPECT_RATIOS = ["16:9", "9:16", "1:1"];

function videoHandler(slug: string) {
  const cfg = MODELS[slug];
  const endpoint = `/api/video/${slug}`;

  return async (req: Request, res: Response) => {
    const { prompt, duration, aspect_ratio, image_url, negative_prompt } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required (string)" });
      return;
    }
    if (prompt.length > 2000) {
      res.status(400).json({ error: "prompt must be under 2000 characters" });
      return;
    }

    if (cfg.supportsI2V && !image_url) {
      res.status(400).json({ error: "image_url is required for image-to-video" });
      return;
    }

    if (duration && (!cfg.supportsDuration || !VALID_DURATIONS.includes(duration))) {
      res.status(400).json({ error: `duration must be ${VALID_DURATIONS.join(" or ")} seconds` });
      return;
    }
    if (aspect_ratio && (!cfg.supportsAspectRatio || !VALID_ASPECT_RATIOS.includes(aspect_ratio))) {
      res.status(400).json({ error: `aspect_ratio must be ${VALID_ASPECT_RATIOS.join(", ")}` });
      return;
    }

    const start = Date.now();
    let upstreamStatus = 0;

    try {
      const result = await generateVideo({
        prompt,
        modelId: cfg.modelId,
        duration: cfg.supportsDuration ? (duration || "5") : undefined,
        aspect_ratio: cfg.supportsAspectRatio ? (aspect_ratio || "16:9") : undefined,
        image_url: cfg.supportsI2V ? image_url : undefined,
        negative_prompt,
      });
      upstreamStatus = 200;
      res.json(result);
    } catch (err: any) {
      upstreamStatus = err.status || 500;
      console.error(`[${cfg.serviceId}] upstream error: status=${upstreamStatus} message=${err.message}`);
      res.setHeader("Retry-After", "10");
      res.status(503).json({ error: "Video generation failed", retryable: true });
    } finally {
      logRequest({
        service: cfg.serviceId,
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

for (const slug of Object.keys(MODELS)) {
  router.post(`/api/video/${slug}`, videoHandler(slug));
}

export default router;
