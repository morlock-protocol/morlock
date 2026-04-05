// ─────────────────────────────────────────────────────────────────────────────
// Morlock Server — Framework-agnostic middleware
// ─────────────────────────────────────────────────────────────────────────────

import {
  MorlockManifest,
  MorlockRequest,
  MorlockResponse,
  MorlockErrors,
  CommandSchema,
  MorlockAuth,
} from "../shared/types";

export type CommandHandler = (
  args: Record<string, unknown>,
  ctx: MorlockContext
) => Promise<unknown> | unknown;

export interface MorlockContext {
  requestId?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

export interface CommandDefinition extends CommandSchema {
  handler: CommandHandler;
}

export interface MorlockConfig {
  name: string;
  baseUrl: string;
  endpoint?: string;          // defaults to "/.well-known/morlock"
  auth?: MorlockAuth;
  commands: Record<string, CommandDefinition>;
  rateLimit?: {
    requests: number;
    windowMs: number;
  };
  contact?: string;
  onRequest?: (req: MorlockRequest, ctx: MorlockContext) => void;
  onError?: (err: unknown, req: MorlockRequest) => void;
}

// ─── Core Morlock Instance ────────────────────────────────────────────────────

export class Morlock {
  private config: MorlockConfig;
  private endpoint: string;
  private rateLimitStore: Map<string, number[]> = new Map();

  constructor(config: MorlockConfig) {
    this.config = config;
    this.endpoint = config.endpoint ?? "/.well-known/morlock";
  }

  // ── Manifest ──────────────────────────────────────────────────────────────

  manifest(): MorlockManifest {
    const commands: Record<string, CommandSchema> = {};
    for (const [name, def] of Object.entries(this.config.commands)) {
      const { handler: _handler, ...schema } = def;
      commands[name] = schema;
    }

    return {
      morlock: "0.1",
      name: this.config.name,
      baseUrl: this.config.baseUrl,
      endpoint: `${this.config.baseUrl}${this.endpoint}`,
      auth: this.config.auth ?? { type: "none" },
      commands,
      rateLimit: this.config.rateLimit,
      contact: this.config.contact,
    };
  }

  // ── Execute a command ─────────────────────────────────────────────────────

  async execute(
    request: MorlockRequest,
    ctx: MorlockContext
  ): Promise<MorlockResponse> {
    const start = Date.now();
    const requestId = request.requestId ?? crypto.randomUUID();

    this.config.onRequest?.(request, ctx);

    // Rate limiting
    if (this.config.rateLimit && ctx.ip) {
      const limited = this.checkRateLimit(
        ctx.ip,
        this.config.rateLimit.requests,
        this.config.rateLimit.windowMs
      );
      if (limited) {
        return {
          ok: false,
          requestId,
          error: {
            code: MorlockErrors.RATE_LIMITED,
            message: "Too many requests. Slow down.",
          },
        };
      }
    }

    // Command lookup
    const commandDef = this.config.commands[request.command];
    if (!commandDef) {
      return {
        ok: false,
        requestId,
        error: {
          code: MorlockErrors.UNKNOWN_COMMAND,
          message: `Unknown command: "${request.command}". Available: ${Object.keys(this.config.commands).join(", ")}`,
        },
      };
    }

    // Param validation
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

    // Execute
    try {
      const result = await commandDef.handler(request.args ?? {}, ctx);
      return {
        ok: true,
        requestId,
        result,
        meta: { executionMs: Date.now() - start },
      };
    } catch (err) {
      this.config.onError?.(err, request);
      return {
        ok: false,
        requestId,
        error: {
          code: MorlockErrors.COMMAND_FAILED,
          message: err instanceof Error ? err.message : "Command execution failed",
        },
        meta: { executionMs: Date.now() - start },
      };
    }
  }

  // ── Adapters ──────────────────────────────────────────────────────────────

  /** Express / Connect middleware */
  express() {
    return async (req: any, res: any, next: any) => {
      const url = req.url?.split("?")[0];

      // Manifest discovery
      if (req.method === "GET" && url === this.endpoint) {
        return res.json(this.manifest());
      }

      // Command execution
      if (req.method === "POST" && url === this.endpoint) {
        const ctx: MorlockContext = {
          headers: req.headers,
          ip: req.ip ?? req.socket?.remoteAddress,
          requestId: req.headers["x-request-id"] as string,
        };

        const response = await this.execute(req.body as MorlockRequest, ctx);
        return res.status(response.ok ? 200 : 400).json(response);
      }

      next();
    };
  }

  /** Next.js App Router handler — use at app/api/agent/route.ts */
  nextjs() {
    return {
      GET: async (request: Request): Promise<Response> => {
        return Response.json(this.manifest());
      },
      POST: async (request: Request): Promise<Response> => {
        const body = await request.json() as MorlockRequest;
        const ctx: MorlockContext = {
          headers: Object.fromEntries(request.headers.entries()),
          ip: request.headers.get("x-forwarded-for") ?? undefined,
        };
        const response = await this.execute(body, ctx);
        return Response.json(response, { status: response.ok ? 200 : 400 });
      },
    };
  }

  /** Raw fetch handler — works with Cloudflare Workers, Bun, Deno */
  fetch() {
    return async (request: Request): Promise<Response | null> => {
      const url = new URL(request.url);
      if (url.pathname !== this.endpoint) return null;

      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "X-Morlock": "0.1",
      };

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      if (request.method === "GET") {
        return Response.json(this.manifest(), { headers: corsHeaders });
      }

      if (request.method === "POST") {
        const body = await request.json() as MorlockRequest;
        const ctx: MorlockContext = {
          headers: Object.fromEntries(request.headers.entries()),
          ip: request.headers.get("x-forwarded-for") ?? undefined,
        };
        const response = await this.execute(body, ctx);
        return Response.json(response, {
          status: response.ok ? 200 : 400,
          headers: corsHeaders,
        });
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

  private checkRateLimit(ip: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const hits = this.rateLimitStore.get(ip) ?? [];
    const recent = hits.filter((t) => now - t < windowMs);
    recent.push(now);
    this.rateLimitStore.set(ip, recent);
    return recent.length > max;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createMorlock(config: MorlockConfig): Morlock {
  return new Morlock(config);
}

export * from "../shared/types";
