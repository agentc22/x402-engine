import { config } from "../config.js";

const BASE_URL = "https://serpapi.com/search.json";
const TIMEOUT_MS = 30_000;

function getApiKey(): string {
  const keys = config.keys.serpapi;
  if (keys.length === 0) {
    throw Object.assign(new Error("SerpApi not configured"), { status: 503 });
  }
  return keys[Math.floor(Math.random() * keys.length)];
}

async function serpApiCall(params: Record<string, string>): Promise<any> {
  const url = new URL(BASE_URL);
  url.searchParams.set("api_key", getApiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`SerpApi ${res.status}: ${text.slice(0, 200)}`), {
        status: res.status,
      });
    }

    return res.json();
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw Object.assign(new Error("SerpApi timeout"), { status: 504 });
    }
    throw err;
  }
}

export async function searchFlightsSerpApi(params: {
  departure_id: string;
  arrival_id: string;
  outbound_date: string;
  return_date?: string;
  type?: string;         // 1=round trip, 2=one way, 3=multi-city
  adults?: string;
  children?: string;
  travel_class?: string; // 1=economy, 2=premium economy, 3=business, 4=first
  stops?: string;        // 0=nonstop, 1=1 stop, 2=2+ stops
  max_price?: string;
  currency?: string;
  deep_search?: string;
}): Promise<any> {
  const query: Record<string, string> = {
    engine: "google_flights",
    departure_id: params.departure_id,
    arrival_id: params.arrival_id,
    outbound_date: params.outbound_date,
    type: params.type || "2",  // default one-way
  };
  if (params.return_date) query.return_date = params.return_date;
  if (params.adults) query.adults = params.adults;
  if (params.children) query.children = params.children;
  if (params.travel_class) query.travel_class = params.travel_class;
  if (params.stops) query.stops = params.stops;
  if (params.max_price) query.max_price = params.max_price;
  if (params.currency) query.currency = params.currency;
  if (params.deep_search) query.deep_search = params.deep_search;

  const data = await serpApiCall(query);

  return {
    best_flights: data.best_flights || [],
    other_flights: data.other_flights || [],
    price_insights: data.price_insights || null,
    airports: data.airports || [],
  };
}

export async function searchHotelsSerpApi(params: {
  q: string;
  check_in_date: string;
  check_out_date: string;
  adults?: string;
  children?: string;
  sort_by?: string;       // 3=lowest price, 8=highest rating, 13=most reviewed
  min_price?: string;
  max_price?: string;
  hotel_class?: string;   // 2-5 stars
  currency?: string;
}): Promise<any> {
  const query: Record<string, string> = {
    engine: "google_hotels",
    q: params.q,
    check_in_date: params.check_in_date,
    check_out_date: params.check_out_date,
  };
  if (params.adults) query.adults = params.adults;
  if (params.children) query.children = params.children;
  if (params.sort_by) query.sort_by = params.sort_by;
  if (params.min_price) query.min_price = params.min_price;
  if (params.max_price) query.max_price = params.max_price;
  if (params.hotel_class) query.hotel_class = params.hotel_class;
  if (params.currency) query.currency = params.currency;

  const data = await serpApiCall(query);

  return {
    properties: data.properties || [],
    brands: data.brands || [],
  };
}

export function initSerpApi(): void {
  const keys = config.keys.serpapi;
  if (keys.length === 0) {
    console.warn("[serpapi] No API keys configured — SerpApi travel endpoints will fail");
    return;
  }
  console.log(`  SerpApi: ${keys.length} key(s) initialized`);
}
