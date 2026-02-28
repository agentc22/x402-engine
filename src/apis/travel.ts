import { Router, type Request, type Response } from "express";
import { searchFlightsSerpApi, searchHotelsSerpApi } from "../providers/serpapi.js";
import { logRequest } from "../db/ledger.js";
import { TTLCache } from "../lib/cache.js";

const router = Router();

const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// TTL caches — flights/hotels change fast
const flightCache = new TTLCache<any>(5 * 60_000);      // 5 min
const hotelCache = new TTLCache<any>(5 * 60_000);        // 5 min

// --- Flight Search (Google Flights via SerpApi) ---

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

  const returnDate = req.query.returnDate as string | undefined;
  const adults = req.query.adults as string | undefined;
  const children = req.query.children as string | undefined;
  const travelClass = req.query.travelClass as string | undefined;
  const stops = req.query.stops as string | undefined;
  const maxPrice = req.query.maxPrice as string | undefined;
  const currency = (req.query.currency as string || "").toUpperCase() || undefined;

  if (returnDate && !DATE_RE.test(returnDate)) {
    res.status(400).json({ error: "Invalid 'returnDate' — must be YYYY-MM-DD" });
    return;
  }

  // Round trip if returnDate provided, otherwise one-way
  const type = returnDate ? "1" : "2";

  const cacheKey = `flights:${origin}:${destination}:${departureDate}:${returnDate}:${adults}:${travelClass}:${stops}:${maxPrice}:${currency}`;
  const cached = flightCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await searchFlightsSerpApi({
      departure_id: origin,
      arrival_id: destination,
      outbound_date: departureDate,
      return_date: returnDate,
      type,
      adults,
      children,
      travel_class: travelClass,
      stops,
      max_price: maxPrice,
      currency,
    });
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

// --- Hotel Search (Google Hotels via SerpApi) ---

router.get("/api/travel/hotels", async (req: Request, res: Response) => {
  const q = (req.query.q as string || "").trim();
  const checkInDate = req.query.checkInDate as string;
  const checkOutDate = req.query.checkOutDate as string;

  if (q.length < 2) {
    res.status(400).json({ error: "Provide 'q' with at least 2 characters (city or hotel name)" });
    return;
  }
  if (q.length > 100) {
    res.status(400).json({ error: "Query too long (max 100 characters)" });
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

  const adults = req.query.adults as string | undefined;
  const children = req.query.children as string | undefined;
  const sortBy = req.query.sortBy as string | undefined;
  const minPrice = req.query.minPrice as string | undefined;
  const maxPrice = req.query.maxPrice as string | undefined;
  const hotelClass = req.query.hotelClass as string | undefined;
  const currency = (req.query.currency as string || "").toUpperCase() || undefined;

  const cacheKey = `hotels:${q.toLowerCase()}:${checkInDate}:${checkOutDate}:${adults}:${sortBy}:${minPrice}:${maxPrice}:${hotelClass}:${currency}`;
  const cached = hotelCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await searchHotelsSerpApi({
      q,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      adults,
      children,
      sort_by: sortBy,
      min_price: minPrice,
      max_price: maxPrice,
      hotel_class: hotelClass,
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

export default router;
