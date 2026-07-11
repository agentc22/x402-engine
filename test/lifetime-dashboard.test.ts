import { describe, expect, it } from "vitest";
import { calculateLifetimeMetrics, LIFETIME_AUDIT } from "../src/dashboard/lifetime.js";

describe("lifetime dashboard accounting", () => {
  it("preserves the audited on-chain request and revenue baseline", () => {
    const requests = LIFETIME_AUDIT.chains.reduce((sum, chain) => sum + chain.requests, 0);
    const revenue = LIFETIME_AUDIT.chains.reduce((sum, chain) => sum + chain.revenueUsd, 0);

    expect(requests).toBe(30_168);
    expect(revenue).toBeCloseTo(227.97, 6);
  });

  it("adds post-audit settlements without double-counting the baseline", () => {
    const result = calculateLifetimeMetrics(
      [
        { network: "eip155:8453", count: 2, total_raw: "6000" },
        { network: "eip155:4326", count: 1, total_raw: "10000000000000000" },
      ],
      [{ service: "known", count: 10 }],
      [{ service: "known", count: 2 }],
      { known: 0.001 },
    );

    expect(result.totalRequests).toBe(30_171);
    expect(result.totalRevenue).toBeCloseTo(227.986, 6);
    expect(result.byChain.find((chain) => chain.id === "base")?.totalRequests).toBe(27_780);
  });

  it("labels profit as estimated and covers settlements without service attribution", () => {
    const result = calculateLifetimeMetrics(
      [{ network: "eip155:4326", count: 3, total_raw: "3000000000000000" }],
      [{ service: "known", count: 100 }],
      [],
      { known: 0.0002 },
    );

    expect(result.profit.estimated).toBe(true);
    expect(result.profit.unattributedIncrementalRequests).toBe(3);
    expect(result.profit.totalCost).toBeGreaterThan(0);
    expect(result.profit.totalProfit).toBeLessThan(result.totalRevenue);
  });
});
