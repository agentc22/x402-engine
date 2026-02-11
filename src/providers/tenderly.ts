import { keyPool } from "../lib/key-pool.js";
import { config } from "../config.js";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function simulateTransaction(
  networkId: string,
  from: string,
  to: string,
  value?: string,
  data?: string,
  gas?: number,
): Promise<{ success: boolean; gasUsed: number; logs: any[]; trace: any }> {
  const key = keyPool.acquire("tenderly");
  if (!key) {
    throw Object.assign(new Error("Tenderly not configured"), { status: 502 });
  }

  const account = config.tenderlyAccount;
  const project = config.tenderlyProject;
  if (!account || !project) {
    throw Object.assign(new Error("Tenderly account/project not configured"), { status: 502 });
  }

  const url = `https://api.tenderly.co/api/v1/account/${encodeURIComponent(account)}/project/${encodeURIComponent(project)}/simulate`;

  const body: any = {
    network_id: networkId,
    from,
    to,
    save: false,
    save_if_fails: false,
    simulation_type: "full",
  };
  if (value) body.value = value;
  if (data) body.input = data;
  if (gas) body.gas = gas;

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[tenderly] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-Access-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`Tenderly ${res.status}`), { status: res.status });
        continue;
      }

      const responseData = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(responseData.error?.message || "Tenderly API error"), {
          status: res.status,
          upstream: responseData,
        });
      }

      const tx = responseData.transaction;
      return {
        success: tx?.status ?? false,
        gasUsed: tx?.gas_used ?? 0,
        logs: tx?.transaction_info?.logs ?? [],
        trace: tx?.transaction_info?.call_trace ?? null,
      };
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
