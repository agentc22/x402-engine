import type { Express } from "express";

export function mountMcp(app: Express): void {
  // MCP endpoint stub - actual implementation in separate package
  app.get("/mcp", (_req, res) => {
    res.json({
      name: "x402engine",
      version: "1.0.0",
      description: "MCP server for x402 paid APIs",
    });
  });
}
