// ─────────────────────────────────────────────────────────────────────────────
// Morlock Client — Agent-side discovery and execution SDK
// ─────────────────────────────────────────────────────────────────────────────

import { MorlockManifest, MorlockRequest, MorlockResponse, CommandSafety } from "../shared/types";

export interface MorlockClientOptions {
  apiKey?: string;
  bearerToken?: string;
  timeoutMs?: number;         // default 10000
  retries?: number;           // default 2
  userAgent?: string;         // default "morlock-client/0.2"
}

export interface MorlockRunResult {
  result: unknown;
  /** True if the server returned a cached idempotent replay */
  replayed: boolean;
  /** The idempotency key used, if any */
  idempotencyKey?: string;
}

// ── Connected Site ────────────────────────────────────────────────────────────

export class MorlockSite {
  readonly manifest: MorlockManifest;
  private options: MorlockClientOptions;

  constructor(manifest: MorlockManifest, options: MorlockClientOptions = {}) {
    this.manifest = manifest;
    this.options = options;
  }

  /** List all available commands on this site */
  commands(): string[] {
    return Object.keys(this.manifest.commands);
  }

  /** Describe a specific command */
  describe(command: string) {
    return this.manifest.commands[command] ?? null;
  }

  /** Execute a command */
  async run(
    command: string,
    args: Record<string, unknown> = {},
    opts: { idempotencyKey?: string } = {}
  ): Promise<MorlockRunResult> {
    const request: MorlockRequest = {
      command,
      args,
      requestId: crypto.randomUUID(),
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": this.options.userAgent ?? "morlock-client/0.2",
      "X-Morlock": "0.2",
    };

    if (this.options.bearerToken) {
      headers["Authorization"] = `Bearer ${this.options.bearerToken}`;
    }

    if (
      this.manifest.auth?.type === "apikey" &&
      this.manifest.auth.keyHeader &&
      this.options.apiKey
    ) {
      headers[this.manifest.auth.keyHeader] = this.options.apiKey;
    }

    // Generate idempotency key for non-read commands; reuse the same key on retries
    const schema = this.manifest.commands[command];
    const safety: CommandSafety = schema?.safety ?? "unsafe";
    const idempotencyKey =
      safety !== "read"
        ? (opts.idempotencyKey ?? crypto.randomUUID())
        : undefined;

    if (idempotencyKey) {
      headers["X-Morlock-Idempotency-Key"] = idempotencyKey;
    }

    const timeout = this.options.timeoutMs ?? 10_000;
    const retries = this.options.retries ?? 2;

    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const res = await fetch(this.manifest.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        clearTimeout(timer);

        const response: MorlockResponse = await res.json();

        if (!response.ok) {
          throw new MorlockClientError(
            response.error?.message ?? "Command failed",
            response.error?.code ?? "UNKNOWN"
          );
        }

        return {
          result: response.result,
          replayed: response.meta?.idempotentReplayed === true,
          idempotencyKey,
        };
      } catch (err) {
        lastError = err;
        if (err instanceof MorlockClientError) throw err;
        if (attempt < retries) {
          await sleep(200 * Math.pow(2, attempt));
        }
      }
    }

    throw lastError;
  }

  /** Convenience: check if a command exists before running */
  has(command: string): boolean {
    return command in this.manifest.commands;
  }

  toString(): string {
    return `MorlockSite(${this.manifest.name} @ ${this.manifest.baseUrl}) [${this.commands().join(", ")}]`;
  }
}

// ── Client (discovery) ────────────────────────────────────────────────────────

export class MorlockClient {
  private options: MorlockClientOptions;
  private cache: Map<string, MorlockManifest> = new Map();

  constructor(options: MorlockClientOptions = {}) {
    this.options = options;
  }

  /**
   * Connect to a Morlock-enabled site.
   * Fetches and validates the manifest from /.well-known/morlock
   */
  async connect(siteUrl: string): Promise<MorlockSite> {
    const baseUrl = normalizeUrl(siteUrl);
    const cached = this.cache.get(baseUrl);
    if (cached) return new MorlockSite(cached, this.options);

    const discoveryUrl = `${baseUrl}/.well-known/morlock`;

    const res = await fetch(discoveryUrl, {
      headers: {
        "User-Agent": this.options.userAgent ?? "morlock-client/0.2",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      throw new MorlockClientError(
        `Site does not appear to be Morlock-enabled (${res.status} at ${discoveryUrl})`,
        "NOT_MORLOCK_ENABLED"
      );
    }

    const manifest: MorlockManifest = await res.json();

    if (!manifest.morlock || !manifest.commands) {
      throw new MorlockClientError(
        "Invalid Morlock manifest returned from site",
        "INVALID_MANIFEST"
      );
    }

    this.cache.set(baseUrl, manifest);
    return new MorlockSite(manifest, this.options);
  }

  /**
   * Check if a site is Morlock-enabled without throwing.
   */
  async probe(siteUrl: string): Promise<boolean> {
    try {
      await this.connect(siteUrl);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Connect to multiple sites in parallel.
   * Skips sites that aren't Morlock-enabled (no throw).
   */
  async connectMany(siteUrls: string[]): Promise<MorlockSite[]> {
    const results = await Promise.allSettled(
      siteUrls.map((url) => this.connect(url))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<MorlockSite> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  /** Clear the manifest cache */
  clearCache() {
    this.cache.clear();
  }
}

// ── Error ────────────────────────────────────────────────────────────────────

export class MorlockClientError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "MorlockClientError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  if (!url.startsWith("http")) url = `https://${url}`;
  return url.replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Convenience factory ───────────────────────────────────────────────────────

export function createClient(options?: MorlockClientOptions): MorlockClient {
  return new MorlockClient(options);
}

export * from "../shared/types";
