import { Router, type Request, type Response } from "express";
import multer from "multer";
import { pinJson, pinFile, pinFromUrl, getFile } from "../providers/ipfs.js";
import { logRequest } from "../db/ledger.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
});

router.post("/api/ipfs/pin", upload.single("file"), async (req: Request, res: Response) => {
  // Determine pin type from body: json, url, or file upload
  const start = Date.now();
  let upstreamStatus = 0;

  try {
    let result;

    if (req.file) {
      // File upload via multipart
      result = await pinFile(req.file.buffer, req.file.originalname);
    } else if (req.body?.json) {
      // Pin JSON object
      const json = typeof req.body.json === "string" ? JSON.parse(req.body.json) : req.body.json;
      result = await pinJson(json, req.body.name);
    } else if (req.body?.url) {
      // Pin from URL
      result = await pinFromUrl(req.body.url, req.body.name);
    } else {
      res.status(400).json({
        error: "Provide 'json' object, 'url' string, or upload a 'file' via multipart form",
      });
      return;
    }

    upstreamStatus = 200;
    res.json({ service: "ipfs-pin", data: result });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    if (err.status === 502) {
      res.status(502).json({ error: "Upstream error", message: err.message });
    } else {
      res.status(500).json({ error: "IPFS pin failed", message: err.message });
    }
  } finally {
    logRequest({
      service: "ipfs-pin",
      endpoint: "/api/ipfs/pin",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/ipfs/get", async (req: Request, res: Response) => {
  const cid = req.query.cid as string | undefined;

  if (!cid) {
    res.status(400).json({ error: "Provide 'cid' query param" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const { data, contentType } = await getFile(cid);
    upstreamStatus = 200;

    // If it's JSON, return as JSON; otherwise return raw
    if (contentType.includes("json")) {
      res.json({ service: "ipfs-get", cid, data: JSON.parse(data.toString()) });
    } else {
      res.setHeader("Content-Type", contentType);
      res.send(data);
    }
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(err.status === 404 ? 404 : 502).json({
      error: "IPFS fetch failed",
      message: err.message,
    });
  } finally {
    logRequest({
      service: "ipfs-get",
      endpoint: "/api/ipfs/get",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
