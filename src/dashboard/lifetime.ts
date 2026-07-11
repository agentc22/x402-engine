export interface LifetimeAuditChain {
  id: "base" | "megaeth" | "solana";
  network: string;
  requests: number;
  revenueUsd: number;
  auditedThrough: string;
  auditedBlock?: number;
}

export const LIFETIME_AUDIT = {
  methodology: "Canonical stablecoin settlements matched to historical engine prices",
  chains: [
    {
      id: "base",
      network: "eip155:8453",
      requests: 27_778,
      revenueUsd: 176.035,
      auditedThrough: "2026-07-11T02:16:27.000Z",
      auditedBlock: 48_473_420,
    },
    {
      id: "megaeth",
      network: "eip155:4326",
      requests: 1_736,
      revenueUsd: 38.26,
      auditedThrough: "2026-07-11T02:18:41.000Z",
      auditedBlock: 20_939_310,
    },
    {
      id: "solana",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      requests: 654,
      revenueUsd: 13.675,
      auditedThrough: "2026-07-11T02:18:41.000Z",
    },
  ] satisfies LifetimeAuditChain[],
} as const;

export interface SettlementRow {
  network: string;
  count: number | string;
  total_raw: string | number;
}

export interface ServiceCountRow {
  service: string;
  count: number | string;
}

export function rawToUsd(raw: string | number, network: string): number {
  const amount = Number(raw);
  if (!amount) return 0;
  return network.includes("4326") ? amount / 1e18 : amount / 1e6;
}

function serviceCost(rows: ServiceCountRow[], costMap: Record<string, number>) {
  return rows.reduce(
    (summary, row) => {
      const count = Number(row.count) || 0;
      summary.requests += count;
      summary.cost += (costMap[row.service] || 0) * count;
      return summary;
    },
    { requests: 0, cost: 0 },
  );
}

export function calculateLifetimeMetrics(
  settlementRows: SettlementRow[],
  preAuditServiceRows: ServiceCountRow[],
  postAuditServiceRows: ServiceCountRow[],
  costMap: Record<string, number>,
) {
  const auditedRequests = LIFETIME_AUDIT.chains.reduce((sum, chain) => sum + chain.requests, 0);
  const auditedRevenue = LIFETIME_AUDIT.chains.reduce((sum, chain) => sum + chain.revenueUsd, 0);
  const increments = new Map(
    settlementRows.map((row) => [
      row.network,
      {
        requests: Number(row.count) || 0,
        revenueUsd: rawToUsd(row.total_raw, row.network),
      },
    ]),
  );

  const byChain = LIFETIME_AUDIT.chains.map((chain) => {
    const increment = increments.get(chain.network) || { requests: 0, revenueUsd: 0 };
    return {
      ...chain,
      incrementalRequests: increment.requests,
      incrementalRevenueUsd: increment.revenueUsd,
      totalRequests: chain.requests + increment.requests,
      totalRevenueUsd: chain.revenueUsd + increment.revenueUsd,
    };
  });

  const incrementalRequests = byChain.reduce((sum, chain) => sum + chain.incrementalRequests, 0);
  const incrementalRevenue = byChain.reduce((sum, chain) => sum + chain.incrementalRevenueUsd, 0);
  const preAudit = serviceCost(preAuditServiceRows, costMap);
  const postAudit = serviceCost(postAuditServiceRows, costMap);
  const averageCostPerRequest = preAudit.requests > 0 ? preAudit.cost / preAudit.requests : 0;
  const unattributedIncrementalRequests = Math.max(0, incrementalRequests - postAudit.requests);
  const estimatedCost =
    auditedRequests * averageCostPerRequest +
    postAudit.cost +
    unattributedIncrementalRequests * averageCostPerRequest;
  const totalRevenue = auditedRevenue + incrementalRevenue;
  const estimatedProfit = totalRevenue - estimatedCost;

  return {
    methodology: LIFETIME_AUDIT.methodology,
    auditedRequests,
    auditedRevenue,
    incrementalRequests,
    incrementalRevenue,
    totalRequests: auditedRequests + incrementalRequests,
    totalRevenue,
    byChain,
    profit: {
      estimated: true,
      estimateMethod: "Retained paid-call service mix at configured upstream costs",
      averageCostPerRequest,
      attributedIncrementalRequests: postAudit.requests,
      unattributedIncrementalRequests,
      totalCost: estimatedCost,
      totalProfit: estimatedProfit,
      margin: totalRevenue > 0 ? (estimatedProfit / totalRevenue) * 100 : 0,
    },
  };
}
