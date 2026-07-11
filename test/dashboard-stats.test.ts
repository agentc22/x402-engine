import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const dashboardSource = readFileSync("src/apis/dashboard.ts", "utf8");

describe("dashboard stats", () => {
  it("keeps the headline total as all logged request rows", () => {
    expect(dashboardSource).toContain("SELECT COUNT(*)::int AS count FROM requests`");
    expect(dashboardSource).toContain("apiTotal");
    expect(dashboardSource).toContain("paymentEvents");
  });

  it("does not hide internal payment verification rows from recent activity", () => {
    expect(dashboardSource).toContain("WHEN service = 'megaeth-payment' THEN 'payment-verification'");
    expect(dashboardSource).toContain("FROM requests ORDER BY created_at DESC LIMIT 50");
  });

  it("keeps revenue calculations API-only to avoid double-counting MegaETH direct payments", () => {
    expect(dashboardSource).toContain("FROM requests WHERE amount IS NOT NULL AND service != 'megaeth-payment'");
  });

  it("exposes read-only admin diagnostics for counter investigations", () => {
    expect(dashboardSource).toContain('router.get("/api/dashboard/diagnostics"');
    expect(dashboardSource).toContain("older_than_90d");
    expect(dashboardSource).toContain("estimated_rows");
    expect(dashboardSource).toContain("current_database()");
  });

  it("shows audited lifetime settlements separately from retained rows", () => {
    expect(dashboardSource).toContain("calculateLifetimeMetrics");
    expect(dashboardSource).toContain("Lifetime Sold Requests");
    expect(dashboardSource).toContain("Tracked API Rows");
    expect(dashboardSource).toContain("Est. Lifetime Profit");
  });
});
