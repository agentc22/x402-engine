import { Router, type Request, type Response } from "express";
import { executeCode } from "../providers/e2b.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

router.post("/api/code/run", async (req: Request, res: Response) => {
  const { code, language, timeout, files } = req.body || {};

  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code is required (string)" });
    return;
  }
  if (language && !["python", "javascript", "bash", "r"].includes(language)) {
    res.status(400).json({ error: "language must be python, javascript, bash, or r" });
    return;
  }
  if (timeout !== undefined && (timeout < 1 || timeout > 300)) {
    res.status(400).json({ error: "timeout must be 1-300 seconds" });
    return;
  }
  if (code.length > 100000) {
    res.status(400).json({ error: "code too large (max 100KB)" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const result = await executeCode({
      code,
      language: language || "python",
      timeout,
      files,
    });
    upstreamStatus = 200;

    res.json({
      service: "code-run",
      success: result.exit_code === 0,
      data: result,
    });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    if (err.message?.includes("timeout")) {
      res.status(408).json({ error: "Code execution exceeded time limit" });
    } else {
      const status = err.status === 502 ? 502 : 500;
      res.status(status).json({ error: "Code execution failed" });
    }
  } finally {
    logRequest({
      service: "code-run",
      endpoint: "/api/code/run",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
