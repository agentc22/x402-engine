import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { pinJson, pinFile, pinFromUrl, getFile } from "../providers/ipfs.js";
import { logRequest } from "../db/ledger.js";
import { isPublicUrl, isValidCid, safeErrorMessage } from "../lib/validation.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
});

router.post("/api/ipfs/pin", upload.single("file"), async (req: Request, res: Response) => {
  const start = Date.now();
  let upstreamStatus = 0;

  try {
    let result;

    if (req.file) {
      // Sanitize filename
      const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
      result = await pinFile(req.file.buffer, safeName);
    } else if (req.body?.json) {
      const json = typeof req.body.json === "string" ? JSON.parse(req.body.json) : req.body.json;
      const name = typeof req.body.name === "string" ? req.body.name.slice(0, 100) : undefined;
      result = await pinJson(json, name);
    } else if (req.body?.url) {
      // SSRF protection: validate URL is public
      const urlCheck = isPublicUrl(req.body.url);
      if (!urlCheck.valid) {
        res.status(400).json({ error: urlCheck.reason });
        return;
      }
      const name = typeof req.body.name === "string" ? req.body.name.slice(0, 100) : undefined;
      result = await pinFromUrl(urlCheck.url, name);
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
    const status = err.status === 502 ? 502 : 500;
    res.status(status).json({ error: "IPFS pin failed" });
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

  if (!isValidCid(cid)) {
    res.status(400).json({ error: "Invalid CID format" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const { data, contentType } = await getFile(cid);
    upstreamStatus = 200;

    if (contentType.includes("json")) {
      res.json({ service: "ipfs-get", cid, data: JSON.parse(data.toString()) });
    } else {
      // Set safe content type — never pass through text/html
      const safeType = contentType.startsWith("text/html") ? "application/octet-stream" : contentType;
      res.setHeader("Content-Type", safeType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(data);
    }
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(err.status === 404 ? 404 : 502).json({ error: "IPFS fetch failed" });
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
