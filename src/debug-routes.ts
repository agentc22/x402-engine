import type { Request, Response } from "express";
import { buildRoutesConfig } from "./services/registry.js";

export function debugRoutes(req: Request, res: Response): void {
  const routes = buildRoutesConfig();
  const firstRoute = Object.entries(routes)[0];
  
  res.json({
    totalRoutes: Object.keys(routes).length,
    firstRouteKey: firstRoute[0],
    firstRouteAccepts: firstRoute[1].accepts,
    sampleMegaETH: firstRoute[1].accepts[1],
    hasAsset: !!firstRoute[1].accepts[1]?.asset,
    hasAmount: !!firstRoute[1].accepts[1]?.amount,
  });
}
