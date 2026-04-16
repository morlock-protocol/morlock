// ─────────────────────────────────────────────────────────────────────────────
// Morlock Server — Rate limiting (hardened)
//
// IP extraction no longer blindly trusts x-forwarded-for.
// Deployers declare trustedProxyCount explicitly.
// In-memory limiter is advisory only — use an external store for
// multi-process deployments.
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimiterStore {
  /**
   * Increment the counter for `key` and return both the post-increment count
   * and the timestamp (ms since epoch) at which the window will reset.
   *
   * Implementations should create a fresh bucket on first increment and when
   * the previous bucket has expired. TTL must equal the remaining window.
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export interface RateLimitOptions {
  /** Max requests per window per IP. Default: 60. */
  maxRequests?: number;

  /** Window duration in ms. Default: 60_000 (1 minute). */
  windowMs?: number;

  /**
   * How many proxy hops sit in front of this server.
   * 0 = use socket IP directly (default, safest).
   * 1 = trust one proxy, use second-rightmost XFF entry.
   * n = trust n proxies, use (n+1)-rightmost XFF entry.
   *
   * SECURITY: If trustedProxyCount is wrong:
   *  - Too high → attacker spoofs leftmost XFF entries → rate limit bypass.
   *  - Too low → all clients share the proxy IP → over-aggressive limiting.
   */
  trustedProxyCount?: number;

  /**
   * Backing store. Default: in-memory (NOT suitable for multi-process).
   *
   * SECURITY: The in-memory store is per-process. In any multi-instance
   * deployment the limit is per instance, not global. Use a Redis/KV store
   * for enforceable rate limiting.
   */
  store?: RateLimiterStore;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  resolvedIp: string;
}

// --- In-memory store (default, single-process, advisory only) ---

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiterStore implements RateLimiterStore {
  private buckets = new Map<string, Bucket>();
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(sweepIntervalMs = 60_000) {
    if (typeof setInterval !== "undefined") {
      this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs);
      if (this.sweepInterval && typeof (this.sweepInterval as any).unref === "function") {
        (this.sweepInterval as any).unref();
      }
    }
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || now >= existing.resetAt) {
      const bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
      return { count: 1, resetAt: bucket.resetAt };
    }

    existing.count++;
    return { count: existing.count, resetAt: existing.resetAt };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }

  destroy(): void {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
  }
}

// --- IP extraction ---

/**
 * Resolve the client IP from request metadata.
 *
 * @param socketIp  The IP of the direct TCP connection (req.socket.remoteAddress).
 * @param xForwardedFor  Raw X-Forwarded-For header value (may be undefined).
 * @param trustedProxyCount  How many proxy hops to trust (0 = ignore XFF).
 */
export function resolveClientIp(
  socketIp: string | undefined,
  xForwardedFor: string | undefined,
  trustedProxyCount: number
): string {
  if (trustedProxyCount === 0 || !xForwardedFor) {
    return socketIp ?? "unknown";
  }

  const ips = xForwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const clientIndex = ips.length - 1 - trustedProxyCount;
  if (clientIndex < 0) {
    return socketIp ?? "unknown";
  }

  return ips[clientIndex] ?? socketIp ?? "unknown";
}

// --- Rate limiter ---

const defaultStore = new InMemoryRateLimiterStore();

export async function checkRateLimit(
  socketIp: string | undefined,
  xForwardedFor: string | string[] | undefined,
  opts: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const {
    maxRequests = 60,
    windowMs = 60_000,
    trustedProxyCount = 0,
    store = defaultStore,
  } = opts;

  const xff = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
  const resolvedIp = resolveClientIp(socketIp, xff, trustedProxyCount);

  const key = `rl:${resolvedIp}`;
  const { count, resetAt } = await store.increment(key, windowMs);

  return {
    allowed: count <= maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetAt,
    resolvedIp,
  };
}
