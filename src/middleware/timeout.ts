import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Request timeout middleware - aborts slow requests after 30 seconds
 * and returns 408 Request Timeout to prevent client hangs.
 */
export function requestTimeoutMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = 30_000; // 30 second hard limit
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
          message: "Request exceeded 30 second limit",
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
