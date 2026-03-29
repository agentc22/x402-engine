import { Router, type Request, type Response } from "express";
import { generateImage } from "../providers/fal.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

function isValidOptionalNumber(value: unknown): value is number {
  return value === undefined || typeof value === "number";
}

function validatePromptAndSize(req: Request, res: Response, prompt: unknown, width: unknown, height: unknown): prompt is string {
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required (string)" });
    return false;
  }
  if (width !== undefined && (typeof width !== "number" || width < 256 || width > 2048)) {
    res.status(400).json({ error: "width must be 256-2048" });
    return false;
  }
  if (height !== undefined && (typeof height !== "number" || height < 256 || height > 2048)) {
    res.status(400).json({ error: "height must be 256-2048" });
    return false;
  }
  return true;
}

function imageHandler(model: "fast" | "quality" | "text", serviceId: string, endpoint: string) {
  return async (req: Request, res: Response) => {
    const { prompt, width, height, seed } = req.body || {};

    if (!validatePromptAndSize(req, res, prompt, width, height)) {
      return;
    }

    const start = Date.now();
    let upstreamStatus = 0;

    try {
      const result = await generateImage({
        prompt,
        model,
        width: width || 1024,
        height: height || 1024,
        seed,
      });
      upstreamStatus = 200;

      res.json(result);
    } catch (err: any) {
      upstreamStatus = err.status || 500;
      console.error(`[${serviceId}] upstream error: status=${upstreamStatus} message=${err.message}`);
      if (upstreamStatus === 403) {
        res.status(503).json({ error: "Image generation temporarily unavailable (upstream auth)", retryable: false });
      } else {
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "Image generation failed", retryable: true });
      }
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

function faceSwapHandler() {
  const serviceId = "face-swap";
  const endpoint = "/api/image/face-swap";

  return async (req: Request, res: Response) => {
    const {
      prompt,
      width,
      height,
      seed,
      image_url,
      reference_image_url,
      negative_prompt,
      guidance_scale,
      start_step,
      true_cfg,
      id_weight,
      enable_safety_checker,
      max_sequence_length,
    } = req.body || {};

    if (!validatePromptAndSize(req, res, prompt, width, height)) {
      return;
    }

    const referenceImageUrl = reference_image_url || image_url;
    if (!referenceImageUrl || typeof referenceImageUrl !== "string") {
      res.status(400).json({ error: "reference_image_url is required (string)" });
      return;
    }

    if (
      !isValidOptionalNumber(seed) ||
      !isValidOptionalNumber(guidance_scale) ||
      !isValidOptionalNumber(start_step) ||
      !isValidOptionalNumber(true_cfg) ||
      !isValidOptionalNumber(id_weight)
    ) {
      res.status(400).json({ error: "seed, guidance_scale, start_step, true_cfg, and id_weight must be numbers when provided" });
      return;
    }
    if (negative_prompt !== undefined && typeof negative_prompt !== "string") {
      res.status(400).json({ error: "negative_prompt must be a string" });
      return;
    }
    if (enable_safety_checker !== undefined && typeof enable_safety_checker !== "boolean") {
      res.status(400).json({ error: "enable_safety_checker must be a boolean" });
      return;
    }
    if (
      max_sequence_length !== undefined &&
      !["128", "256", "512"].includes(String(max_sequence_length))
    ) {
      res.status(400).json({ error: "max_sequence_length must be 128, 256, or 512" });
      return;
    }

    const start = Date.now();
    let upstreamStatus = 0;

    try {
      const result = await generateImage({
        prompt,
        model: "face-swap",
        width: width || 1024,
        height: height || 1024,
        seed,
        image_url: typeof image_url === "string" ? image_url : undefined,
        reference_image_url: referenceImageUrl,
        negative_prompt,
        guidance_scale,
        start_step,
        true_cfg,
        id_weight,
        enable_safety_checker,
        max_sequence_length: max_sequence_length ? String(max_sequence_length) as "128" | "256" | "512" : undefined,
      });
      upstreamStatus = 200;

      res.json(result);
    } catch (err: any) {
      upstreamStatus = err.status || 500;
      console.error(`[${serviceId}] upstream error: status=${upstreamStatus} message=${err.message}`);
      if (upstreamStatus === 403) {
        res.status(503).json({ error: "Image generation temporarily unavailable (upstream auth)", retryable: false });
      } else if (upstreamStatus === 400) {
        res.status(400).json({ error: err.message || "Face swap request invalid" });
      } else {
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "Image generation failed", retryable: true });
      }
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

function nanoBananaHandler() {
  const serviceId = "image-nano-banana";
  const endpoint = "/api/image/nano-banana";

  return async (req: Request, res: Response) => {
    const { prompt, aspect_ratio, seed, output_format } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required (string)" });
      return;
    }
    if (prompt.length > 50000) {
      res.status(400).json({ error: "prompt must be under 50000 characters" });
      return;
    }

    const validAspectRatios = ["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"];
    if (aspect_ratio && !validAspectRatios.includes(aspect_ratio)) {
      res.status(400).json({ error: `aspect_ratio must be one of: ${validAspectRatios.join(", ")}` });
      return;
    }

    const validFormats = ["png", "jpeg", "webp"];
    if (output_format && !validFormats.includes(output_format)) {
      res.status(400).json({ error: `output_format must be one of: ${validFormats.join(", ")}` });
      return;
    }

    const start = Date.now();
    let upstreamStatus = 0;

    try {
      const result = await generateImage({
        prompt,
        model: "nano-banana",
        aspect_ratio: aspect_ratio || "1:1",
        output_format: output_format || "png",
        seed,
      });
      upstreamStatus = 200;
      res.json(result);
    } catch (err: any) {
      upstreamStatus = err.status || 500;
      console.error(`[${serviceId}] upstream error: status=${upstreamStatus} message=${err.message}`);
      if (upstreamStatus === 403) {
        res.status(503).json({ error: "Image generation temporarily unavailable (upstream auth)", retryable: false });
      } else {
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "Image generation failed", retryable: true });
      }
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

router.post("/api/image/fast", imageHandler("fast", "image-fast", "/api/image/fast"));
router.post("/api/image/quality", imageHandler("quality", "image-quality", "/api/image/quality"));
router.post("/api/image/text", imageHandler("text", "image-text", "/api/image/text"));
router.post("/api/image/face-swap", faceSwapHandler());
router.post("/api/image/nano-banana", nanoBananaHandler());

export default router;
