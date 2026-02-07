import { fal } from "@fal-ai/client";
import { config } from "../config.js";

export function initFal(): void {
  if (!config.falApiKey) {
    console.log("  fal.ai API key not configured — image endpoints will return 502");
    return;
  }
  fal.config({ credentials: config.falApiKey });
  console.log("  fal.ai client configured");
}

export interface ImageGenerationRequest {
  prompt: string;
  model: "fast" | "quality" | "text";
  width?: number;
  height?: number;
  seed?: number;
}

export interface ImageGenerationResponse {
  images: Array<{ url: string; width: number; height: number }>;
  seed: number;
  model: string;
  inference_time_ms: number;
}

const MODEL_MAP: Record<string, string> = {
  fast: config.computeProviders.fal.models.fast,
  quality: config.computeProviders.fal.models.quality,
  text: config.computeProviders.fal.models.text,
};

export async function generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  if (!config.falApiKey) {
    throw Object.assign(new Error("fal.ai not configured"), { status: 502 });
  }

  const modelId = MODEL_MAP[req.model] || MODEL_MAP.fast;
  const start = Date.now();

  const result = await fal.subscribe(modelId, {
    input: {
      prompt: req.prompt,
      image_size: {
        width: req.width || 1024,
        height: req.height || 1024,
      },
      seed: req.seed,
      num_images: 1,
    },
  });

  const data = result.data as any;

  return {
    images: (data.images || []).map((img: any) => ({
      url: img.url,
      width: img.width || req.width || 1024,
      height: img.height || req.height || 1024,
    })),
    seed: data.seed ?? 0,
    model: modelId,
    inference_time_ms: Date.now() - start,
  };
}
