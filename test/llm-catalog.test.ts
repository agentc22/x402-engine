import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

type Service = {
  id: string;
  path: string;
};

const services = JSON.parse(readFileSync("config/services.json", "utf8")).services as Service[];
const llmServices = services.filter((service) => service.path.startsWith("/api/llm/"));
const llmSource = readFileSync("src/apis/llm.ts", "utf8");

const routeSlugs = new Set(
  [...llmSource.matchAll(/"([^"]+)": \{ model:/g)].map((match) => match[1]),
);

const routeServiceIds = new Set(
  [...llmSource.matchAll(/serviceId: "([^"]+)"/g)].map((match) => match[1]),
);

const catalogServiceIds = new Set(llmServices.map((service) => service.id));

describe("LLM catalog", () => {
  it("registers every configured LLM service route", () => {
    const missingRoutes = llmServices
      .map((service) => service.path.replace("/api/llm/", ""))
      .filter((slug) => !routeSlugs.has(slug));

    expect(missingRoutes).toEqual([]);
  });

  it("uses service IDs that exist in the paid service catalog", () => {
    const missingServiceIds = [...routeServiceIds].filter((id) => !catalogServiceIds.has(id));
    const unroutedServiceIds = [...catalogServiceIds].filter((id) => !routeServiceIds.has(id));

    expect(missingServiceIds).toEqual([]);
    expect(unroutedServiceIds).toEqual([]);
  });

  it("includes the current OpenRouter model additions", () => {
    expect([...routeSlugs]).toEqual(
      expect.arrayContaining([
        "claude-opus-4.8",
        "qwen3.7-plus",
        "qwen3.7-max",
        "glm-5.2",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "minimax-m3",
      ]),
    );
  });

  it("does not advertise stale Grok 4 Fast routes", () => {
    expect(llmSource).not.toContain("grok-4-fast");
    expect(JSON.stringify(llmServices)).not.toContain("grok-4-fast");
  });

  it("does not point routes at deprecated or unavailable OpenRouter model IDs", () => {
    expect(llmSource).not.toContain("x-ai/grok-4\"");
    expect(llmSource).not.toContain("x-ai/grok-code-fast-1");
    expect(llmSource).not.toContain("google/gemini-3-pro-preview");
    expect(llmSource).not.toContain("deepseek/deepseek-v3.2-speciale");
  });
});
