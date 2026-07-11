import type { Express } from "express";

export function mountMcp(app: Express): void {
  // MCP endpoint stub - actual implementation lives in the npm package.
  // Keep this remote endpoint JSON-RPC compatible enough for probes so the
  // advertised /mcp URL does not show up as a 404 in production monitoring.
  app.get("/mcp", (_req, res) => {
    res.json({
      name: "x402engine",
      version: "3.0.0",
      description: "MCP server for x402 paid APIs",
      protocol: "mcp",
      recommended: "npx -y x402engine-mcp",
    });
  });

  app.post("/mcp", (req, res) => {
    const message = req.body ?? {};
    const id = message.id ?? null;

    if (message.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "x402engine",
            version: "3.0.0",
          },
          instructions: "For the full local MCP server, run: npx -y x402engine-mcp",
        },
      });
      return;
    }

    if (message.method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "discover_x402_services",
              description: "Fetch the x402engine service catalog and payment requirements.",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
        },
      });
      return;
    }

    if (message.method === "notifications/initialized") {
      res.status(202).end();
      return;
    }

    res.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: "Method not found on remote stub. Use npx -y x402engine-mcp for full tools.",
      },
    });
  });
}
