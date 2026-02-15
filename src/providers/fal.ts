import { fal } from "@fal-ai/client";
import { config } from "../config.js";
import { keyPool } from "../lib/key-pool.js";

export function initFal(): void {
  if (!keyPool.has("fal")) {
    console.log("  fal.ai API key not configured — image/video endpoints will return 502");
    return;
  }
  // Configure with the first key — will be rotated per-request
  const firstKey = keyPool.acquire("fal");
  if (firstKey) fal.config({ credentials: firstKey });
  console.log(`  fal.ai client configured (${keyPool.count("fal")} key${keyPool.count("fal") > 1 ? "s" : ""})`);
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
  const apiKey = keyPool.acquire("fal");
  if (!apiKey) {
    throw Object.assign(new Error("fal.ai not configured"), { status: 502 });
  }

  // Rotate key before each call. fal.ai SDK is a singleton, but image
  // generation takes 2-10s so concurrent contention is rare.
  fal.config({ credentials: apiKey });

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

// ── Video Generation ────────────────────────────────────────────────

export interface VideoGenerationRequest {
  prompt: string;
  modelId: string;
  duration?: string;        // "5" | "10" (Kling)
  aspect_ratio?: string;    // "16:9" | "9:16" | "1:1" (Kling)
  image_url?: string;       // for image-to-video
  negative_prompt?: string;
}

export interface VideoGenerationResponse {
  video: { url: string; content_type?: string; file_size?: number };
  model: string;
  inference_time_ms: number;
}

export async function generateVideo(req: VideoGenerationRequest): Promise<VideoGenerationResponse> {
  const apiKey = keyPool.acquire("fal");
  if (!apiKey) {
    throw Object.assign(new Error("fal.ai not configured"), { status: 502 });
  }

  fal.config({ credentials: apiKey });

  const input: Record<string, any> = { prompt: req.prompt };
  if (req.duration) input.duration = req.duration;
  if (req.aspect_ratio) input.aspect_ratio = req.aspect_ratio;
  if (req.image_url) input.image_url = req.image_url;
  if (req.negative_prompt) input.negative_prompt = req.negative_prompt;

  const start = Date.now();

  const result = await fal.subscribe(req.modelId, { input });
  const data = result.data as any;

  const video = data.video || {};
  return {
    video: {
      url: video.url,
      content_type: video.content_type || "video/mp4",
      file_size: video.file_size,
    },
    model: req.modelId,
    inference_time_ms: Date.now() - start,
  };
}
