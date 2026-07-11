import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ledgerSource = readFileSync("src/db/ledger.ts", "utf8");

describe("request log retention", () => {
  it("keeps dashboard request history by default", () => {
    expect(ledgerSource).toContain("REQUEST_LOG_RETENTION_DAYS");
    expect(ledgerSource).toContain("retentionDays > 0");
    expect(ledgerSource).toContain("request log retention disabled");
    expect(ledgerSource).not.toContain("cleanupOldRequests(90)");
  });
});
