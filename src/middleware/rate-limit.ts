import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";

/**
 * Strict rate limit for free endpoints (health, discovery, facilitator).
 * 60 requests per minute per IP.
 */
export const freeEndpointLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — try again later" },
});

/**
 * General rate limit for paid endpoints.
 * 300 requests per minute per IP — the payment requirement is the primary guard,
 * this just prevents abuse from a single IP flooding the payment middleware.
 */
export const paidEndpointLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — try again later" },
});

/**
 * Very strict rate limit for expensive free endpoints (stats, facilitator status).
 * 10 requests per minute per IP.
 */
export const expensiveEndpointLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests to this endpoint — try again later" },
});
