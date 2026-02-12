import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Request timeout middleware with smart timeouts based on endpoint type.
 * - Compute-heavy (image, LLM, TTS, transcribe): 90s
 * - Travel APIs (slow external APIs): 60s
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
  // Compute-heavy endpoints: 90 seconds
  if (
    path.startsWith("/api/image/") ||
    path.startsWith("/api/llm/") ||
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

  // Standard endpoints: 30 seconds (crypto, blockchain, web, etc.)
  return 30_000;
}
