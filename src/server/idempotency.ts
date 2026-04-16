// ─────────────────────────────────────────────────────────────────────────────
// Morlock Server — Idempotency / replay protection
//
// Write/unsafe commands require X-Morlock-Idempotency-Key.
// Duplicate requests within the dedup window get the cached response.
// The store is pluggable — default is in-memory (single-process only).
// ─────────────────────────────────────────────────────────────────────────────

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
}

export interface IdempotencyRecord {
  status: number;
  body: unknown;
  completedAt: number;
}

export interface IdempotencyOptions {
  /**
   * Store implementation. Default: in-memory (single process only, not HA).
   * For production, provide a Redis/Upstash/KV-backed store.
   */
  store?: IdempotencyStore;

  /**
   * How long to remember a completed response. Default: 24 hours.
   */
  dedupeWindowMs?: number;

  /**
   * Whether to reject write commands that arrive without an idempotency key.
   * Default: true. Set to false only during migration/testing.
   */
  requireKeyForWrites?: boolean;
}

// --- In-memory store (default, not HA) ---

interface InMemoryEntry {
  record: IdempotencyRecord;
  expiresAt: number;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, InMemoryEntry>();
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(sweepIntervalMs = 60_000) {
    if (typeof setInterval !== "undefined") {
      this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs);
      // In Node.js, unref() prevents the timer from keeping the process alive
      if (this.sweepInterval && typeof (this.sweepInterval as any).unref === "function") {
        (this.sweepInterval as any).unref();
      }
    }
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.record;
  }

  async set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
    this.map.set(key, { record, expiresAt: Date.now() + ttlMs });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (now > entry.expiresAt) this.map.delete(key);
    }
  }

  destroy(): void {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
  }
}

// --- Idempotency enforcement ---

const DEFAULT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const IDEMPOTENCY_HEADER = "x-morlock-idempotency-key";

// Bounds on the key itself. A key that's 10 MB long is not an idempotency key,
// it's a denial-of-service vector against the store. 255 chars is comfortably
// large for UUIDs, ULIDs, or path-like composite keys.
const MAX_KEY_LENGTH = 255;
// Printable-ASCII subset: alphanumerics plus common separators. Rejects control
// chars, spaces, unicode, quotes, and anything that could confuse downstream
// logging / storage systems.
const VALID_KEY_RE = /^[A-Za-z0-9_\-:.]+$/;

export function isValidIdempotencyKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH && VALID_KEY_RE.test(key);
}

export type IdempotencyCheckResult =
  | { status: "proceed"; key: string | null }
  | { status: "duplicate"; record: IdempotencyRecord; key: string }
  | { status: "rejected"; reason: string; code: "key-required" | "key-malformed" };

/**
 * Check idempotency before executing a write command.
 *
 * Returns "proceed" (execute handler), "duplicate" (return cached),
 * or "rejected" (missing key on a write command).
 */
export async function checkIdempotency(
  headers: Record<string, string | string[] | undefined>,
  commandName: string,
  isSafeRead: boolean,
  opts: IdempotencyOptions = {}
): Promise<IdempotencyCheckResult> {
  const {
    store = defaultStore,
    requireKeyForWrites = true,
  } = opts;

  const rawKey = headers[IDEMPOTENCY_HEADER];
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

  if (isSafeRead) {
    return { status: "proceed", key: null };
  }

  if (!key) {
    if (requireKeyForWrites) {
      return {
        status: "rejected",
        code: "key-required",
        reason:
          `Command "${commandName}" is a write operation and requires an ` +
          `${IDEMPOTENCY_HEADER} header for replay protection.`,
      };
    }
    return { status: "proceed", key: null };
  }

  if (!isValidIdempotencyKey(key)) {
    // Reject rather than silently truncating. A malformed key suggests a broken
    // client, not a best-effort attempt we should normalize.
    return {
      status: "rejected",
      code: "key-malformed",
      reason:
        `${IDEMPOTENCY_HEADER} must be 1..${MAX_KEY_LENGTH} chars of [A-Za-z0-9_\\-:.]`,
    };
  }

  const existing = await store.get(key);
  if (existing) {
    return { status: "duplicate", record: existing, key };
  }

  return { status: "proceed", key };
}

/**
 * Record a successful write result for future deduplication.
 */
export async function recordIdempotency(
  key: string | null,
  record: IdempotencyRecord,
  opts: IdempotencyOptions = {}
): Promise<void> {
  if (!key) return;
  const { store = defaultStore, dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS } = opts;
  await store.set(key, record, dedupeWindowMs);
}

const defaultStore = new InMemoryIdempotencyStore();
