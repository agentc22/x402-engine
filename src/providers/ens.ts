import { JsonRpcProvider } from "ethers";

const RPC_URLS = [
  "https://cloudflare-eth.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
];

let providerIndex = 0;

function getProvider(): JsonRpcProvider {
  const url = RPC_URLS[providerIndex];
  providerIndex = (providerIndex + 1) % RPC_URLS.length;
  return new JsonRpcProvider(url);
}

export async function resolveEns(name: string): Promise<string | null> {
  let lastErr: any;
  for (let i = 0; i < RPC_URLS.length; i++) {
    try {
      const provider = getProvider();
      const address = await provider.resolveName(name);
      return address;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[ens] resolve failed on RPC ${i + 1}/${RPC_URLS.length}: ${err.message}`);
    }
  }
  throw Object.assign(new Error(lastErr?.message || "ENS resolution failed"), { status: 502 });
}

export async function reverseEns(address: string): Promise<string | null> {
  let lastErr: any;
  for (let i = 0; i < RPC_URLS.length; i++) {
    try {
      const provider = getProvider();
      const name = await provider.lookupAddress(address);
      return name;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[ens] reverse failed on RPC ${i + 1}/${RPC_URLS.length}: ${err.message}`);
    }
  }
  throw Object.assign(new Error(lastErr?.message || "ENS reverse lookup failed"), { status: 502 });
}
