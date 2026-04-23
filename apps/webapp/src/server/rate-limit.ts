/**
 * Agent-chat rate limiter — Upstash Redis + sliding window.
 *
 * Why rate-limit at all: the `/api/agent/chat` endpoint hits Vercel
 * AI Gateway with a paid token. Without a throttle a single visitor
 * (or a crawler hitting `/api/agent/chat` directly) can burn through
 * the budget in minutes. A sliding window keyed by client IP is the
 * standard first line.
 *
 * Budget: 20 requests per 2 hours per IP. Tuned for an onboarding /
 * demo workload — enough for a human to explore several Manifesto
 * domains, too little for sustained abuse. Change via
 * `AGENT_RATELIMIT_{MAX,WINDOW}` env vars if you need to.
 *
 * Graceful dev bypass: when `UPSTASH_REDIS_REST_URL` is unset we
 * skip the limiter entirely and log once so local dev doesn't
 * require an Upstash project. Production deployments should always
 * have it configured.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const DEFAULT_MAX = 20;
const DEFAULT_WINDOW = "2 h";

type SlidingWindowDuration = `${number} ${"s" | "m" | "h" | "d"}`;

let cachedLimiter: Ratelimit | null | undefined = undefined;
let missingEnvWarned = false;

function getLimiter(): Ratelimit | null {
  if (cachedLimiter !== undefined) return cachedLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url === undefined || url === "" || token === undefined || token === "") {
    if (!missingEnvWarned) {
      missingEnvWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[rate-limit] UPSTASH_REDIS_REST_URL / _TOKEN not set — " +
          "skipping rate limit (ok for dev, NOT ok for production).",
      );
    }
    cachedLimiter = null;
    return null;
  }
  const max = parsePositiveInt(
    process.env.AGENT_RATELIMIT_MAX,
    DEFAULT_MAX,
  );
  const window = parseSlidingWindow(
    process.env.AGENT_RATELIMIT_WINDOW,
    DEFAULT_WINDOW,
  );
  cachedLimiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(max, window),
    // Analytics off — we don't display usage; the env vars are our
    // only control. Leaves less data in Upstash.
    analytics: false,
    prefix: "manifesto:agent-chat",
  });
  return cachedLimiter;
}

export type RateLimitDecision =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "limited";
      readonly retryAfterSeconds: number;
      readonly limit: number;
      readonly remaining: number;
      readonly reset: number;
    }
  | { readonly kind: "skipped" };

/**
 * Check the limiter against the caller IP. `identifier` is whatever
 * the caller considers unique — we use the first entry of
 * `x-forwarded-for`, falling back to `"anonymous"` if nothing
 * useful is present. Returns one of:
 *
 *   - `{kind:"allowed"}` — under budget, proceed.
 *   - `{kind:"limited", retryAfterSeconds, ...}` — block the call.
 *   - `{kind:"skipped"}` — no limiter configured (dev).
 */
export async function enforceChatRateLimit(
  identifier: string,
): Promise<RateLimitDecision> {
  const limiter = getLimiter();
  if (limiter === null) return { kind: "skipped" };
  const res = await limiter.limit(identifier);
  if (res.success) return { kind: "allowed" };
  const now = Date.now();
  const retryAfterSeconds = Math.max(1, Math.ceil((res.reset - now) / 1000));
  return {
    kind: "limited",
    retryAfterSeconds,
    limit: res.limit,
    remaining: Math.max(0, res.remaining),
    reset: res.reset,
  };
}

/**
 * Best-effort IP extraction from a Web Request. Prefers the
 * `x-forwarded-for` header (Vercel sets it to the real client IP);
 * falls back to `x-real-ip`; last resort is `"anonymous"` (which
 * means every un-forwarded call shares a single bucket — still
 * useful as a dampener).
 */
export function identifyRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff !== null && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp !== null && realIp.length > 0) return realIp;
  return "anonymous";
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseSlidingWindow(
  v: string | undefined,
  fallback: SlidingWindowDuration,
): SlidingWindowDuration {
  if (v === undefined) return fallback;
  const match = v.trim().match(/^(\d+)\s*([smhd])$/);
  if (match === null) return fallback;
  return `${match[1]} ${match[2]}` as SlidingWindowDuration;
}
