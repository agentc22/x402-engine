import { Router, type Request, type Response } from "express";
import { generateImage } from "../providers/fal.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

function imageHandler(model: "fast" | "quality" | "text", serviceId: string, endpoint: string) {
  return async (req: Request, res: Response) => {
    const { prompt, width, height, seed } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required (string)" });
      return;
    }
    if (width !== undefined && (width < 256 || width > 2048)) {
      res.status(400).json({ error: "width must be 256-2048" });
      return;
    }
    if (height !== undefined && (height < 256 || height > 2048)) {
      res.status(400).json({ error: "height must be 256-2048" });
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

      res.json({
        service: serviceId,
        data: result,
      });
    } catch (err: any) {
      upstreamStatus = err.status || 500;
      const status = err.status === 502 ? 502 : 500;
      res.status(status).json({ error: "Image generation failed" });
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

export default router;
