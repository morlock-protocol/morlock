// ─────────────────────────────────────────────────────────────────────────────
// Morlock Protocol v0.2 — Shared Types
// ─────────────────────────────────────────────────────────────────────────────

export type ParamType = "string" | "number" | "boolean" | "object" | "array";

export interface ParamSchema {
  type: ParamType;
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

/**
 * "read"   — No side effects (GET-equivalent). May bypass auth if allowPublicRead.
 * "write"  — Side effects, idempotent (PUT/PATCH-equivalent). Auth required.
 * "unsafe" — Side effects, NOT idempotent (POST/DELETE-equivalent). Auth + idempotency key required.
 *
 * Defaults to "unsafe" if omitted — fail-closed.
 */
export type CommandSafety = "read" | "write" | "unsafe";

export interface CommandSchema {
  description: string;
  params?: Record<string, ParamSchema>;
  returns?: string;
  examples?: Array<{
    params: Record<string, unknown>;
    result: unknown;
  }>;

  /**
   * Safety classification. Defaults to "unsafe" if not specified,
   * which requires auth and an idempotency key — the safe default.
   */
  safety?: CommandSafety;

  /**
   * OAuth2 / fine-grained scopes required to call this command.
   * Passed to the auth verifier. Empty array = any authenticated caller.
   */
  requiredScopes?: string[];

  /**
   * For "write" commands: is the operation naturally idempotent?
   * e.g., setPreference(key, value) is idempotent; appendToCart is not.
   * When true, servers may relax the idempotency key requirement.
   */
  idempotent?: boolean;
}

export interface MorlockManifest {
  morlock: string;            // protocol version e.g. "0.2"
  name: string;              // human-readable site name
  baseUrl: string;           // canonical base URL
  endpoint: string;          // where to POST commands e.g. "/.well-known/morlock"
  auth?: MorlockAuth;
  commands: Record<string, CommandSchema>;
  rateLimit?: {
    requests: number;
    windowMs: number;
  };
  contact?: string;          // abuse/support email

  /** One-liner that agents carry into conversations */
  tagline?: string;
  /** Tone/personality hint for agents rendering this site's responses */
  voice?: string;
  /** Registry name for this site's agent identity, e.g. "morlock/acme-search" */
  agentName?: string;
}

export type MorlockAuthType = "none" | "bearer" | "apikey" | "oauth2";

export interface MorlockAuth {
  type: MorlockAuthType;
  keyHeader?: string;        // for apikey: which header
  tokenUrl?: string;         // for oauth2
  scopes?: string[];
  /**
   * If true, commands with safety === "read" bypass auth verification.
   * Only meaningful when type !== "none". Default: false.
   */
  allowPublicRead?: boolean;
}

export interface MorlockRequest {
  command: string;
  args?: Record<string, unknown>;
  requestId?: string;        // for tracing
}

export interface MorlockResponse {
  ok: boolean;
  requestId?: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    executionMs?: number;
    cached?: boolean;
    idempotentReplayed?: boolean;
    idempotencyKey?: string;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
    [key: string]: unknown;
  };
}

// Error codes
export const MorlockErrors = {
  UNKNOWN_COMMAND:            "UNKNOWN_COMMAND",
  INVALID_PARAMS:             "INVALID_PARAMS",
  AUTH_REQUIRED:              "AUTH_REQUIRED",
  FORBIDDEN:                  "FORBIDDEN",
  RATE_LIMITED:               "RATE_LIMITED",
  IDEMPOTENCY_KEY_REQUIRED:   "IDEMPOTENCY_KEY_REQUIRED",
  INTERNAL_ERROR:             "INTERNAL_ERROR",
  COMMAND_FAILED:             "COMMAND_FAILED",
} as const;

export type MorlockErrorCode = typeof MorlockErrors[keyof typeof MorlockErrors];
