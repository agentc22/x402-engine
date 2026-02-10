import Amadeus from "amadeus";
import { config } from "../config.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const TIMEOUT_MS = 30_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Create one Amadeus client per key pair, round-robin between them.
let clients: any[] = [];
let clientIndex = 0;

export function initAmadeus(): void {
  const ids = config.keys.amadeus;
  const secrets = config.keys.amadeusSecret;

  if (ids.length === 0 || secrets.length === 0) {
    console.warn("[amadeus] No API keys configured — travel endpoints will fail");
    return;
  }

  const pairs = Math.min(ids.length, secrets.length);
  clients = [];
  for (let i = 0; i < pairs; i++) {
    clients.push(
      new Amadeus({
        clientId: ids[i],
        clientSecret: secrets[i],
        hostname: config.amadeusHostname as "production" | "test",
      }),
    );
  }
  console.log(`  Amadeus: ${clients.length} client(s) initialized (${config.amadeusHostname})`);
}

function getClient(): any {
  if (clients.length === 0) {
    throw Object.assign(new Error("Amadeus not configured"), { status: 503 });
  }
  const client = clients[clientIndex];
  clientIndex = (clientIndex + 1) % clients.length;
  return client;
}

async function amadeusCall(fn: (client: any) => Promise<any>): Promise<any> {
  let lastErr: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[amadeus] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await fn(getClient());
        clearTimeout(timer);
        return response.data;
      } catch (err: any) {
        clearTimeout(timer);
        throw err;
      }
    } catch (err: any) {
      const status = err.response?.statusCode ?? err.status ?? 0;

      // 5xx or timeout — retry
      if ((status >= 500 || err.code === "ABORT_ERR" || err.code === "ETIMEDOUT") && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`Amadeus ${status || err.code}`), { status });
        continue;
      }

      // Client errors — throw immediately
      throw Object.assign(new Error(err.response?.result || err.message || "Amadeus API error"), {
        status: status || 500,
        upstream: err.response?.result,
      });
    }
  }

  throw lastErr;
}

export async function searchFlights(params: {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  adults: number;
  returnDate?: string;
  max?: number;
  nonStop?: boolean;
  currencyCode?: string;
}): Promise<any> {
  return amadeusCall((client) =>
    client.shopping.flightOffersSearch.get(params),
  );
}

export async function searchLocations(
  keyword: string,
  subType: string = "AIRPORT,CITY",
): Promise<any> {
  return amadeusCall((client) =>
    client.referenceData.locations.get({ keyword, subType }),
  );
}

export async function searchHotels(params: {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults?: number;
  roomQuantity?: number;
  priceRange?: string;
  currency?: string;
}): Promise<any> {
  // Step 1: Get hotel IDs by city
  const hotelList = await amadeusCall((client) =>
    client.referenceData.locations.hotels.byCity.get({ cityCode: params.cityCode }),
  );

  if (!hotelList || hotelList.length === 0) {
    return [];
  }

  // Take up to 20 hotel IDs to keep response time reasonable
  const hotelIds = hotelList
    .slice(0, 20)
    .map((h: any) => h.hotelId)
    .join(",");

  // Step 2: Get offers for those hotels
  const offerParams: Record<string, any> = {
    hotelIds,
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    adults: String(params.adults ?? 1),
    roomQuantity: String(params.roomQuantity ?? 1),
  };
  if (params.priceRange) offerParams.priceRange = params.priceRange;
  if (params.currency) offerParams.currency = params.currency;

  return amadeusCall((client) =>
    client.shopping.hotelOffersSearch.get(offerParams),
  );
}

export async function searchCheapestDates(params: {
  origin: string;
  destination: string;
  departureDate?: string;
  oneWay?: boolean;
}): Promise<any> {
  return amadeusCall((client) =>
    client.shopping.flightDates.get(params),
  );
}
