import { PinataSDK } from "pinata";
import { config } from "../config.js";

let pinata: PinataSDK | null = null;

export function initIpfs(): void {
  if (!config.pinataJwt) {
    console.log("  Pinata JWT not configured — IPFS endpoints will return 502");
    return;
  }
  pinata = new PinataSDK({
    pinataJwt: config.pinataJwt,
    pinataGateway: config.pinataGateway,
  });
  console.log("  Pinata IPFS client initialized");
}

function getPinata(): PinataSDK {
  if (!pinata) {
    throw Object.assign(new Error("Pinata IPFS not configured"), { status: 502 });
  }
  return pinata;
}

export interface PinResponse {
  cid: string;
  size: number;
  name: string;
  gateway_url: string;
  ipfs_url: string;
}

export async function pinJson(json: object, name?: string): Promise<PinResponse> {
  const p = getPinata();
  const fileName = name || "metadata.json";
  const result = await p.upload.public.json(json).name(fileName);

  return {
    cid: result.cid,
    size: result.size,
    name: fileName,
    gateway_url: `https://${config.pinataGateway}/ipfs/${result.cid}`,
    ipfs_url: `ipfs://${result.cid}`,
  };
}

export async function pinFile(buffer: Buffer, filename: string): Promise<PinResponse> {
  const p = getPinata();
  const file = new File([new Uint8Array(buffer)], filename);
  const result = await p.upload.public.file(file).name(filename);

  return {
    cid: result.cid,
    size: result.size,
    name: filename,
    gateway_url: `https://${config.pinataGateway}/ipfs/${result.cid}`,
    ipfs_url: `ipfs://${result.cid}`,
  };
}

export async function pinFromUrl(url: string, name?: string): Promise<PinResponse> {
  const p = getPinata();
  const builder = p.upload.public.url(url);
  if (name) builder.name(name);
  const result = await builder;

  return {
    cid: result.cid,
    size: result.size,
    name: name || url,
    gateway_url: `https://${config.pinataGateway}/ipfs/${result.cid}`,
    ipfs_url: `ipfs://${result.cid}`,
  };
}

export async function getFile(cid: string): Promise<{ data: Buffer; contentType: string }> {
  const res = await fetch(`https://${config.pinataGateway}/ipfs/${cid}`);

  if (!res.ok) {
    throw Object.assign(new Error(`Failed to fetch CID: ${cid}`), { status: 404 });
  }

  const data = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return { data, contentType };
}
