// ─────────────────────────────────────────────────────────────────────────────
// Morlock Server — Framework-agnostic middleware
//
// Security pipeline (v0.2):
//   rate limit → command lookup (generic 404) → auth → idempotency
//   → param validation → execute → record idempotency
// ─────────────────────────────────────────────────────────────────────────────

import {
  MorlockManifest,
  MorlockRequest,
  MorlockResponse,
  MorlockErrors,
  MorlockAuth,
  CommandSchema,
} from "../shared/types";

import {
  enforceAuth,
  validateAuthConfig,
  type AuthVerifier,
  type MorlockAuthOptions,
} from "./auth";

import {
  checkIdempotency,
  recordIdempotency,
  type IdempotencyOptions,
  type IdempotencyRecord,
} from "./idempotency";

import {
  checkRateLimit,
  resolveClientIp,
  type RateLimitOptions,
} from "./rate-limit";

export type CommandHandler = (
  args: Record<string, unknown>,
  ctx: MorlockContext
) => Promise<unknown> | unknown;

export interface MorlockContext {
  requestId?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  /** Authenticated principal, set after auth verification */
  principal?: string;
  /** Resolved client IP (after proxy trust resolution) */
  clientIp: string;
  /** The idempotency key, if provided */
  idempotencyKey?: string | null;
}

export interface CommandDefinition extends CommandSchema {
  handler: CommandHandler;
}

export interface MorlockConfig {
  name: string;
  baseUrl: string;
  endpoint?: string;

  auth?: MorlockAuth;

  /**
   * Auth verifier. REQUIRED when auth.type !== "none".
   * Called before every non-public command execution.
   */
  verifier?: AuthVerifier;

  commands: Record<string, CommandDefinition>;

  /**
   * Rate limiting options. Set to false to disable entirely.
   * Default: enabled with 60 req/min, trustedProxyCount=0.
   */
  rateLimit?: RateLimitOptions | false;

  /** Idempotency options. */
  idempotency?: IdempotencyOptions;

  /**
   * CORS origins. Default: [] (no cross-origin access).
   * Use "*" only for public, read-only, unauthenticated manifests.
   */
  corsOrigins?: string[] | "*";

  contact?: string;

  /** One-liner that agents carry into conversations */
  tagline?: string;
  /** Tone/personality hint for agents rendering this site's responses */
  voice?: string;
  /** Registry name for this site's agent identity, e.g. "morlock/acme-search" */
  agentName?: string;

  onRequest?: (req: MorlockRequest, ctx: MorlockContext) => void;
  onError?: (err: unknown, req: MorlockRequest) => void;
}

// ─── Core Morlock Instance ────────────────────────────────────────────────────

export class Morlock {
  private config: MorlockConfig;
  private endpoint: string;
  private auth: MorlockAuth;
  private authOpts: MorlockAuthOptions;

  constructor(config: MorlockConfig) {
    this.config = config;
    this.endpoint = config.endpoint ?? "/.well-known/morlock";
    this.auth = config.auth ?? { type: "none" };
    this.authOpts = { verifier: config.verifier };

    // Fail-closed: crash at startup if auth is declared but no verifier provided
    validateAuthConfig(this.auth, this.authOpts);

    // Warn about missing safety annotations and unregistered handlers
    for (const [name, def] of Object.entries(config.commands)) {
      if (def.safety === undefined) {
        console.warn(
          `[morlock] Command "${name}" has no safety annotation. ` +
            `Defaulting to "unsafe" (requires auth + idempotency key). ` +
            `Set safety: "read" | "write" | "unsafe" explicitly.`
        );
      }
    }
  }

  // ── Manifest ──────────────────────────────────────────────────────────────

  manifest(): MorlockManifest {
    const commands: Record<string, CommandSchema> = {};
    for (const [name, def] of Object.entries(this.config.commands)) {
      const { handler: _handler, ...schema } = def;
      commands[name] = schema;
    }

    return {
      morlock: "0.2",
      name: this.config.name,
      baseUrl: this.config.baseUrl,
      endpoint: `${this.config.baseUrl}${this.endpoint}`,
      auth: this.auth,
      commands,
      rateLimit: this.config.rateLimit !== false && this.config.rateLimit
        ? {
            requests: this.config.rateLimit.maxRequests ?? 60,
            windowMs: this.config.rateLimit.windowMs ?? 60_000,
          }
        : undefined,
      contact: this.config.contact,
      tagline: this.config.tagline,
      voice: this.config.voice,
      agentName: this.config.agentName,
    };
  }

  // ── Execute a command (full security pipeline) ────────────────────────────

  async execute(
    request: MorlockRequest,
    ctx: MorlockContext
  ): Promise<MorlockResponse> {
    const start = Date.now();
    const requestId = request.requestId ?? crypto.randomUUID();

    this.config.onRequest?.(request, ctx);

    // 1. Rate limiting
    if (this.config.rateLimit !== false) {
      const rlOpts = this.config.rateLimit ?? {};
      const xff = ctx.headers["x-forwarded-for"];
      const rl = await checkRateLimit(ctx.ip, xff, rlOpts);

      if (!rl.allowed) {
        return {
          ok: false,
          requestId,
          error: {
            code: MorlockErrors.RATE_LIMITED,
            message: "The machinery needs rest. Too many requests.",
          },
          meta: {
            rateLimitRemaining: rl.remaining,
            rateLimitReset: rl.resetAt,
          },
        };
      }
    }

    // 2. Command lookup — generic 404 to avoid enumeration
    const commandDef = this.config.commands[request.command];
    if (!commandDef) {
      return {
        ok: false,
        requestId,
        error: {
          code: MorlockErrors.UNKNOWN_COMMAND,
          message: "Nothing stirs in the dark. Command not found.",
        },
      };
    }

    const safety = commandDef.safety ?? "unsafe";
    const isSafeRead = safety === "read";

    // 3. Auth enforcement
    const authResult = await enforceAuth(
      ctx.headers,
      request.command,
      commandDef,
      this.auth,
      this.authOpts
    );

    if (!authResult.ok) {
      return {
        ok: false,
        requestId,
        error: {
          code: authResult.status === 401 ? MorlockErrors.AUTH_REQUIRED : MorlockErrors.FORBIDDEN,
          message: authResult.reason,
        },
      };
    }

    // 4. Idempotency check
    const idempCheck = await checkIdempotency(
      ctx.headers,
      request.command,
      isSafeRead,
      this.config.idempotency
    );

    if (idempCheck.status === "rejected") {
      return {
        ok: false,
        requestId,
        error: {
          code: MorlockErrors.IDEMPOTENCY_KEY_REQUIRED,
          message: idempCheck.reason,
        },
      };
    }

    if (idempCheck.status === "duplicate") {
      const cached = idempCheck.record.body as MorlockResponse;
      return {
        ...cached,
        requestId,
        meta: {
          ...(cached.meta ?? {}),
          cached: true,
          idempotentReplayed: true,
        },
      };
    }

    // 5. Param validation
    const validationError = this.validateParams(request.args ?? {}, commandDef);
    if (validationError) {
      return {
        ok: false,
        requestId,
        error: {
          code: MorlockErrors.INVALID_PARAMS,
          message: validationError,
        },
      };
    }

    // 6. Build enriched context and execute
    const trustedProxyCount =
      (this.config.rateLimit !== false && this.config.rateLimit?.trustedProxyCount) || 0;
    const xffHeader = ctx.headers["x-forwarded-for"];
    const xffStr = Array.isArray(xffHeader) ? xffHeader[0] : xffHeader;

    const enrichedCtx: MorlockContext = {
      ...ctx,
      requestId,
      principal: (authResult as { principal?: string }).principal,
      clientIp: resolveClientIp(ctx.ip, xffStr, trustedProxyCount),
      idempotencyKey: idempCheck.key,
    };

    let response: MorlockResponse;
    let recordStatus: number;
    try {
      const result = await commandDef.handler(request.args ?? {}, enrichedCtx);
      response = {
        ok: true,
        requestId,
        result,
        meta: {
          executionMs: Date.now() - start,
          ...(idempCheck.key ? { idempotencyKey: idempCheck.key } : {}),
        },
      };
      recordStatus = 200;
    } catch (err) {
      this.config.onError?.(err, request);
      response = {
        ok: false,
        requestId,
        error: {
          code: MorlockErrors.COMMAND_FAILED,
          message: err instanceof Error ? err.message : "The gears jammed. Command execution failed.",
        },
        meta: {
          executionMs: Date.now() - start,
          ...(idempCheck.key ? { idempotencyKey: idempCheck.key } : {}),
        },
      };
      recordStatus = 500;
    }

    // 7. Record idempotency result (success OR failure) so retries don't
    // re-execute a handler that already ran — including ones that threw
    // after producing side effects (charged card, sent email, etc.).
    if (idempCheck.key) {
      const record: IdempotencyRecord = {
        status: recordStatus,
        body: response,
        completedAt: Date.now(),
      };
      await recordIdempotency(idempCheck.key, record, this.config.idempotency);
    }

    return response;
  }

  // ── CORS helper ─────────────────────────────────────────────────────────

  private getCorsHeaders(origin: string | undefined): Record<string, string> {
    const allowed = this.config.corsOrigins ?? [];

    if (allowed === "*") {
      return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Api-Key, X-Morlock-Idempotency-Key, X-Morlock-Request-Id",
        "X-Morlock": "0.2",
      };
    }

    if (!origin || !allowed.includes(origin)) {
      return { "X-Morlock": "0.2" };
    }

    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Api-Key, X-Morlock-Idempotency-Key, X-Morlock-Request-Id",
      "Vary": "Origin",
      "X-Morlock": "0.2",
    };
  }

  // ── Adapters ──────────────────────────────────────────────────────────────

  /** Express / Connect middleware */
  express() {
    return async (req: any, res: any, next: any) => {
      const url = req.url?.split("?")[0];
      const origin = req.headers["origin"] as string | undefined;
      const corsHeaders = this.getCorsHeaders(origin);

      if (req.method === "OPTIONS" && url === this.endpoint) {
        res.writeHead(204, corsHeaders);
        return res.end();
      }

      if (req.method === "GET" && url === this.endpoint) {
        for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
        return res.json(this.manifest());
      }

      if (req.method === "POST" && url === this.endpoint) {
        // Express doesn't parse JSON by default. Fail loudly rather than
        // crashing inside execute() when body is undefined.
        if (!req.body || typeof req.body !== "object") {
          for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
          return res.status(400).json({
            ok: false,
            error: {
              code: MorlockErrors.INVALID_PARAMS,
              message:
                "Request body was not parsed as JSON. " +
                "Install express.json() middleware before morlock.express().",
            },
          });
        }

        const ctx: MorlockContext = {
          headers: req.headers,
          ip: req.socket?.remoteAddress,
          clientIp: req.socket?.remoteAddress ?? "unknown",
          requestId: req.headers["x-request-id"] as string,
        };

        const response = await this.execute(req.body as MorlockRequest, ctx);
        const status = response.ok ? 200 : this.errorStatus(response);
        for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
        return res.status(status).json(response);
      }

      next();
    };
  }

  /** Next.js App Router handler */
  nextjs() {
    return {
      GET: async (request: Request): Promise<Response> => {
        const origin = request.headers.get("origin") ?? undefined;
        return Response.json(this.manifest(), {
          headers: this.getCorsHeaders(origin),
        });
      },
      POST: async (request: Request): Promise<Response> => {
        const origin = request.headers.get("origin") ?? undefined;
        const corsHeaders = this.getCorsHeaders(origin);

        let body: MorlockRequest;
        try {
          body = await request.json() as MorlockRequest;
        } catch {
          return Response.json(
            {
              ok: false,
              error: {
                code: MorlockErrors.INVALID_PARAMS,
                message: "Request body must be valid JSON.",
              },
            },
            { status: 400, headers: corsHeaders }
          );
        }

        // ip is intentionally undefined: Request has no socket IP, and trusting
        // leftmost X-Forwarded-For would let callers spoof their rate-limit key.
        // resolveClientIp() uses trustedProxyCount + XFF from headers.
        const ctx: MorlockContext = {
          headers: Object.fromEntries(request.headers.entries()),
          ip: undefined,
          clientIp: "unknown",
        };

        const response = await this.execute(body, ctx);
        const status = response.ok ? 200 : this.errorStatus(response);
        return Response.json(response, { status, headers: corsHeaders });
      },
    };
  }

  /** Raw fetch handler — works with Cloudflare Workers, Bun, Deno */
  fetch() {
    return async (request: Request): Promise<Response | null> => {
      const url = new URL(request.url);
      if (url.pathname !== this.endpoint) return null;

      const origin = request.headers.get("origin") ?? undefined;
      const corsHeaders = this.getCorsHeaders(origin);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method === "GET") {
        return Response.json(this.manifest(), { headers: corsHeaders });
      }

      if (request.method === "POST") {
        let body: MorlockRequest;
        try {
          body = await request.json() as MorlockRequest;
        } catch {
          return Response.json(
            {
              ok: false,
              error: {
                code: MorlockErrors.INVALID_PARAMS,
                message: "Request body must be valid JSON.",
              },
            },
            { status: 400, headers: corsHeaders }
          );
        }
        // ip undefined on purpose — see Next.js adapter for rationale.
        const ctx: MorlockContext = {
          headers: Object.fromEntries(request.headers.entries()),
          ip: undefined,
          clientIp: "unknown",
        };
        const response = await this.execute(body, ctx);
        const status = response.ok ? 200 : this.errorStatus(response);
        return Response.json(response, { status, headers: corsHeaders });
      }

      return null;
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private validateParams(
    args: Record<string, unknown>,
    def: CommandDefinition
  ): string | null {
    if (!def.params) return null;

    for (const [key, schema] of Object.entries(def.params)) {
      const value = args[key];
      if (schema.required && (value === undefined || value === null)) {
        return `Missing required param: "${key}"`;
      }
      if (value !== undefined && schema.type) {
        const actualType = Array.isArray(value) ? "array" : typeof value;
        if (actualType !== schema.type) {
          return `Param "${key}" should be ${schema.type}, got ${actualType}`;
        }
      }
      if (schema.enum && value !== undefined && !schema.enum.includes(String(value))) {
        return `Param "${key}" must be one of: ${schema.enum.join(", ")}`;
      }
    }

    return null;
  }

  private errorStatus(response: MorlockResponse): number {
    switch (response.error?.code) {
      case MorlockErrors.AUTH_REQUIRED: return 401;
      case MorlockErrors.FORBIDDEN: return 403;
      case MorlockErrors.UNKNOWN_COMMAND: return 404;
      case MorlockErrors.IDEMPOTENCY_KEY_REQUIRED: return 409;
      case MorlockErrors.INVALID_PARAMS: return 422;
      case MorlockErrors.RATE_LIMITED: return 429;
      case MorlockErrors.COMMAND_FAILED:
      case MorlockErrors.INTERNAL_ERROR: return 500;
      default: return 400;
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createMorlock(config: MorlockConfig): Morlock {
  return new Morlock(config);
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export * from "../shared/types";
export type { AuthVerifier, AuthResult, AuthVerifierInput, MorlockAuthOptions } from "./auth";
export type { IdempotencyStore, IdempotencyOptions, IdempotencyRecord } from "./idempotency";
export { InMemoryIdempotencyStore } from "./idempotency";
export type { RateLimiterStore, RateLimitOptions, RateLimitResult } from "./rate-limit";
export { InMemoryRateLimiterStore, resolveClientIp } from "./rate-limit";
