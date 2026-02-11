import { keyPool } from "../lib/key-pool.js";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function firecrawlFetch(path: string, body: any): Promise<any> {
  const key = keyPool.acquire("firecrawl");
  if (!key) {
    throw Object.assign(new Error("Firecrawl not configured"), { status: 502 });
  }

  const url = `${FIRECRAWL_BASE}${path}`;

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[firecrawl] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`Firecrawl ${res.status}`), { status: res.status });
        continue;
      }

      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Firecrawl API error"), {
          status: res.status,
          upstream: data,
        });
      }
      return data;
    } catch (err: any) {
      if ((err.status >= 500 || err.name === "TimeoutError") && attempt < MAX_RETRIES) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

export async function scrapeUrl(
  url: string,
  formats: string[] = ["markdown"],
): Promise<{ content: string; markdown?: string; metadata: any }> {
  const data = await firecrawlFetch("/scrape", { url, formats });
  return {
    content: data.data?.markdown || data.data?.content || "",
    markdown: data.data?.markdown,
    metadata: data.data?.metadata || {},
  };
}

export async function screenshotUrl(
  url: string,
  fullPage: boolean = false,
): Promise<{ screenshot: string; metadata: any }> {
  const data = await firecrawlFetch("/scrape", {
    url,
    formats: ["screenshot" + (fullPage ? "@fullPage" : "")],
  });
  return {
    screenshot: data.data?.screenshot || "",
    metadata: data.data?.metadata || {},
  };
}
