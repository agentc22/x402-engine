import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Request timeout middleware with smart timeouts based on endpoint type.
 * - Video generation: 300s (models take 30-120s)
 * - LLM endpoints: 180s (reasoning models are slow)
 * - Compute-heavy (image, TTS, transcribe, code): 90s
 * - Standard (crypto, blockchain, web): 30s
 */
export function requestTimeoutMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = getTimeoutForPath(req.path);
    const start = Date.now();

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        const elapsed = Date.now() - start;
        console.error(
          `[timeout] Request exceeded ${timeout}ms - aborting`,
          `method=${req.method}`,
          `path=${req.path}`,
          `elapsed=${elapsed}ms`
        );

        res.status(408).json({
          error: "Request timeout",
          message: `Request exceeded ${timeout / 1000} second limit`,
          retryable: true,
          timeout_ms: timeout,
          elapsed_ms: elapsed,
        });
      }
    }, timeout);

    // Clear timeout when response finishes
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}

function getTimeoutForPath(path: string): number {
  // LLM endpoints: 180 seconds (some models like o1, gemini-pro can be very slow)
  if (path.startsWith("/api/llm/")) {
    return 180_000;
  }

  // Video generation: 300 seconds (video models can take 30-120s)
  if (path.startsWith("/api/video/")) {
    return 300_000;
  }

  // Compute-heavy endpoints: 90 seconds
  if (
    path.startsWith("/api/image/") ||
    path.startsWith("/api/tts/") ||
    path.startsWith("/api/transcribe") ||
    path.startsWith("/api/code/")
  ) {
    return 90_000;
  }

  // Travel endpoints: 60 seconds (external APIs can be slow)
  if (path.startsWith("/api/travel/")) {
    return 60_000;
  }

  // IPFS: 60 seconds (gateway can be slow)
  if (path.startsWith("/api/ipfs/")) {
    return 60_000;
  }

  // Standard endpoints: 30 seconds (crypto, blockchain, web, etc.)
  return 30_000;
}
