import { Router, type Request, type Response } from "express";
import { searchFlights, searchLocations, searchHotels, searchCheapestDates } from "../providers/amadeus.js";
import { logRequest } from "../db/ledger.js";
import { clampInt } from "../lib/validation.js";
import { TTLCache } from "../lib/cache.js";

const router = Router();

const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// TTL caches — flights/hotels change fast, locations are stable
const flightCache = new TTLCache<any>(5 * 60_000);      // 5 min
const locationCache = new TTLCache<any>(60 * 60_000);    // 60 min
const hotelCache = new TTLCache<any>(5 * 60_000);        // 5 min
const cheapestCache = new TTLCache<any>(30 * 60_000);    // 30 min

// --- Flight Search ---

router.get("/api/travel/flights", async (req: Request, res: Response) => {
  const origin = (req.query.origin as string || "").toUpperCase();
  const destination = (req.query.destination as string || "").toUpperCase();
  const departureDate = req.query.departureDate as string;

  if (!IATA_RE.test(origin)) {
    res.status(400).json({ error: "Invalid 'origin' — must be 3-letter IATA code (e.g. JFK)" });
    return;
  }
  if (!IATA_RE.test(destination)) {
    res.status(400).json({ error: "Invalid 'destination' — must be 3-letter IATA code (e.g. LAX)" });
    return;
  }
  if (!departureDate || !DATE_RE.test(departureDate)) {
    res.status(400).json({ error: "Invalid 'departureDate' — must be YYYY-MM-DD" });
    return;
  }

  const adults = clampInt(req.query.adults as string, 1, 9, 1);
  const max = clampInt(req.query.max as string, 1, 50, 10);
  const returnDate = req.query.returnDate as string | undefined;
  const nonStop = req.query.nonStop === "true";
  const currencyCode = (req.query.currencyCode as string || "").toUpperCase() || undefined;

  if (returnDate && !DATE_RE.test(returnDate)) {
    res.status(400).json({ error: "Invalid 'returnDate' — must be YYYY-MM-DD" });
    return;
  }

  const cacheKey = `flights:${origin}:${destination}:${departureDate}:${returnDate}:${adults}:${max}:${nonStop}:${currencyCode}`;
  const cached = flightCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const params: any = {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      adults,
      max,
    };
    if (returnDate) params.returnDate = returnDate;
    if (nonStop) params.nonStop = nonStop;
    if (currencyCode) params.currencyCode = currencyCode;

    const data = await searchFlights(params);
    upstreamStatus = 200;
    flightCache.set(cacheKey, data);
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[travel-flights] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "travel-flights",
      endpoint: "/api/travel/flights",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

// --- Location / Airport Search ---

router.get("/api/travel/locations", async (req: Request, res: Response) => {
  const keyword = (req.query.keyword as string || "").trim();

  if (keyword.length < 2) {
    res.status(400).json({ error: "Provide 'keyword' with at least 2 characters" });
    return;
  }
  if (keyword.length > 50 || !/^[a-zA-Z0-9 _.-]+$/.test(keyword)) {
    res.status(400).json({ error: "Invalid keyword format" });
    return;
  }

  const subType = (req.query.subType as string) || "AIRPORT,CITY";

  const cacheKey = `locations:${keyword.toLowerCase()}:${subType}`;
  const cached = locationCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await searchLocations(keyword, subType);
    upstreamStatus = 200;
    locationCache.set(cacheKey, data);
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[travel-locations] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "travel-locations",
      endpoint: "/api/travel/locations",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

// --- Hotel Search ---

router.get("/api/travel/hotels", async (req: Request, res: Response) => {
  const cityCode = (req.query.cityCode as string || "").toUpperCase();
  const checkInDate = req.query.checkInDate as string;
  const checkOutDate = req.query.checkOutDate as string;

  if (!IATA_RE.test(cityCode)) {
    res.status(400).json({ error: "Invalid 'cityCode' — must be 3-letter IATA code (e.g. PAR)" });
    return;
  }
  if (!checkInDate || !DATE_RE.test(checkInDate)) {
    res.status(400).json({ error: "Invalid 'checkInDate' — must be YYYY-MM-DD" });
    return;
  }
  if (!checkOutDate || !DATE_RE.test(checkOutDate)) {
    res.status(400).json({ error: "Invalid 'checkOutDate' — must be YYYY-MM-DD" });
    return;
  }

  const adults = clampInt(req.query.adults as string, 1, 9, 1);
  const roomQuantity = clampInt(req.query.roomQuantity as string, 1, 9, 1);
  const priceRange = req.query.priceRange as string | undefined;
  const currency = (req.query.currency as string || "").toUpperCase() || undefined;

  const cacheKey = `hotels:${cityCode}:${checkInDate}:${checkOutDate}:${adults}:${roomQuantity}:${priceRange}:${currency}`;
  const cached = hotelCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await searchHotels({
      cityCode,
      checkInDate,
      checkOutDate,
      adults,
      roomQuantity,
      priceRange,
      currency,
    });
    upstreamStatus = 200;
    hotelCache.set(cacheKey, data);
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[travel-hotels] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "travel-hotels",
      endpoint: "/api/travel/hotels",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

// --- Cheapest Dates ---

router.get("/api/travel/cheapest-dates", async (req: Request, res: Response) => {
  const origin = (req.query.origin as string || "").toUpperCase();
  const destination = (req.query.destination as string || "").toUpperCase();

  if (!IATA_RE.test(origin)) {
    res.status(400).json({ error: "Invalid 'origin' — must be 3-letter IATA code (e.g. JFK)" });
    return;
  }
  if (!IATA_RE.test(destination)) {
    res.status(400).json({ error: "Invalid 'destination' — must be 3-letter IATA code (e.g. LAX)" });
    return;
  }

  const departureDate = req.query.departureDate as string | undefined;
  const oneWay = req.query.oneWay === "true";

  if (departureDate && !DATE_RE.test(departureDate)) {
    res.status(400).json({ error: "Invalid 'departureDate' — must be YYYY-MM-DD" });
    return;
  }

  const cacheKey = `cheapest:${origin}:${destination}:${departureDate}:${oneWay}`;
  const cached = cheapestCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await searchCheapestDates({ origin, destination, departureDate, oneWay });
    upstreamStatus = 200;
    cheapestCache.set(cacheKey, data);
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[travel-cheapest] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "travel-cheapest-dates",
      endpoint: "/api/travel/cheapest-dates",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
