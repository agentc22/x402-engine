import { keyPool } from "../lib/key-pool.js";

const EXA_BASE = "https://api.exa.ai";
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function exaFetch(path: string, body: any): Promise<any> {
  const key = keyPool.acquire("exa");
  if (!key) {
    throw Object.assign(new Error("Exa not configured"), { status: 502 });
  }

  const url = `${EXA_BASE}${path}`;

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[exa] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`Exa ${res.status}`), { status: res.status });
        continue;
      }

      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Exa API error"), {
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

export async function search(
  query: string,
  opts?: { numResults?: number; includeDomains?: string[]; category?: string; includeText?: boolean },
): Promise<any> {
  const body: any = {
    query,
    type: "auto",
    numResults: opts?.numResults ?? 10,
    contents: {
      highlights: true,
      ...(opts?.includeText ? { text: true } : {}),
    },
  };
  if (opts?.includeDomains?.length) body.includeDomains = opts.includeDomains;
  if (opts?.category) body.category = opts.category;

  const data = await exaFetch("/search", body);
  return {
    results: (data.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      publishedDate: r.publishedDate,
      highlights: r.highlights || [],
      ...(r.text ? { text: r.text } : {}),
    })),
    autopromptString: data.autopromptString,
  };
}

export async function getContents(
  urls: string[],
): Promise<any> {
  const data = await exaFetch("/contents", {
    ids: urls,
    text: true,
  });
  return {
    contents: (data.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      text: r.text || "",
    })),
  };
}
